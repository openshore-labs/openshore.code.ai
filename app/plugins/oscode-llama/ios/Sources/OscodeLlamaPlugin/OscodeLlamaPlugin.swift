import Foundation
import Capacitor
import UIKit
import UserNotifications

/// A finite-length background task assertion. On-device inference (loading
/// multi-GB weights, streaming a reply) is not a URLSession, so the system does
/// not keep it alive on its own the way it does a background download. Holding
/// this assertion asks iOS not to suspend the app while that work is in flight,
/// so a load or a reply that is mid-stream when the user glances away keeps
/// going through the OS grace period instead of being cut off instantly.
final class BackgroundActivity {
    private var taskId: UIBackgroundTaskIdentifier = .invalid
    private let name: String
    private let lock = NSLock()

    init(_ name: String) { self.name = name }

    func begin() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.lock.lock()
            defer { self.lock.unlock() }
            guard self.taskId == .invalid else { return }
            self.taskId = UIApplication.shared.beginBackgroundTask(withName: self.name) { [weak self] in
                self?.end()
            }
        }
    }

    func end() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.lock.lock()
            defer { self.lock.unlock() }
            guard self.taskId != .invalid else { return }
            UIApplication.shared.endBackgroundTask(self.taskId)
            self.taskId = .invalid
        }
    }
}

/// The Capacitor bridge for on-device inference. The JS contract lives in
/// app/src/lib/llamaPlugin.ts; keep the two in lockstep. Events:
/// downloadProgress, token, generationDone.
@objc(OscodeLlamaPlugin)
public class OscodeLlamaPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OscodeLlamaPlugin"
    public let jsName = "OscodeLlama"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deviceCapacity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listModels", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloadModel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ensureLocal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "activeDownloads", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteModel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPushPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPushToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "secureGet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "secureSet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "secureDelete", returnType: CAPPluginReturnPromise)
    ]

    // The one process-wide store, so its background download session is shared
    // with the copy the AppDelegate reconnects on a background relaunch.
    private let store = ModelStore.shared
    private let runner = LlamaRunner()
    // Every kept-alive call waiting on a download, per model id. A second
    // downloadModel for the same id used to overwrite the first and leave its
    // JS promise hanging forever (UI-11); now all of them settle together.
    private var pendingDownloads = [String: [CAPPluginCall]]()
    private let downloadsLock = NSLock()

    // APNs device token plumbing. The AppDelegate's
    // didRegisterForRemoteNotificationsWithDeviceToken callback lands in the app
    // target, not here, so it hands the token to this static, which caches it (so
    // a getPushToken after the fact still answers) and forwards it to the live
    // plugin instance as a JS 'pushToken' event.
    private static weak var live: OscodeLlamaPlugin?
    private static var cachedPushToken: String?

    // Which APNs host the issued token is valid against, read from the actual
    // aps-environment in the embedded provisioning profile so the label always
    // matches how the build was signed: "development" (a local Xcode build) means
    // the sandbox host, "production" (TestFlight, App Store) means the production
    // host. An App Store build carries no embedded profile, and App Store uses
    // production APNs, so the absence defaults to production. Computed once.
    private static let apsEnvironment: String = {
        guard
            let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
            let data = try? Data(contentsOf: url),
            let text = String(data: data, encoding: .isoLatin1),
            let start = text.range(of: "<plist"),
            let end = text.range(of: "</plist>")
        else {
            return "production"
        }
        let plistText = String(text[start.lowerBound..<end.upperBound])
        guard
            let plistData = plistText.data(using: .isoLatin1),
            let plist = try? PropertyListSerialization.propertyList(from: plistData, options: [], format: nil) as? [String: Any],
            let entitlements = plist["Entitlements"] as? [String: Any],
            let aps = entitlements["aps-environment"] as? String
        else {
            return "production"
        }
        return aps == "development" ? "sandbox" : "production"
    }()

    public static func deliverPushToken(_ token: String) {
        cachedPushToken = token
        live?.notifyListeners("pushToken", data: ["token": token, "environment": apsEnvironment])
    }

    override public func load() {
        Self.live = self
        // If the token already arrived before the bridge was up, surface it now.
        if let token = Self.cachedPushToken {
            self.notifyListeners("pushToken", data: ["token": token, "environment": Self.apsEnvironment])
        }
        store.setHandlers(
            progress: { [weak self] id, completed, total in
                self?.notifyListeners("downloadProgress", data: [
                    "id": id,
                    "completed": completed,
                    "total": total
                ])
            },
            completion: { [weak self] id, location, result in
                guard let self else { return }
                self.downloadsLock.lock()
                let calls = self.pendingDownloads.removeValue(forKey: id) ?? []
                self.downloadsLock.unlock()
                for call in calls {
                    switch result {
                    case .success(let url):
                        call.resolve(["path": url.path, "location": location])
                    case .failure(let error):
                        call.reject("The download did not finish: \(error.localizedDescription)")
                    }
                }
            }
        )
    }

    // ---------------------------------------------------------------- device

    @objc func isSupported(_ call: CAPPluginCall) {
        #if targetEnvironment(simulator)
        call.resolve(["supported": true, "reason": "Simulator run: slower than a real iPhone."])
        #else
        // Harbor Light (135M, bundled) and other pocket models run comfortably on
        // ~3GB phones; keep this gate low so the built-in guide is available
        // broadly. The marketplace is where larger pocket models get sized per device.
        let ramGB = Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824
        if ramGB < 2.9 {
            call.resolve([
                "supported": false,
                "reason": "This iPhone does not have enough memory to run a local model well."
            ])
        } else {
            call.resolve(["supported": true])
        }
        #endif
    }

    @objc func deviceCapacity(_ call: CAPPluginCall) {
        // Free and total storage for this app's volume, plus physical memory for
        // sizing a machine recommendation. importantUsage is what iOS says the
        // app may actually use (it can exceed the raw free bytes by reclaiming
        // purgeable space), which is the honest number for "will this fit."
        let home = URL(fileURLWithPath: NSHomeDirectory())
        var freeBytes: Int64 = 0
        var totalBytes: Int64 = 0
        if let vals = try? home.resourceValues(forKeys: [
            .volumeAvailableCapacityForImportantUsageKey,
            .volumeTotalCapacityKey
        ]) {
            freeBytes = Int64(vals.volumeAvailableCapacityForImportantUsage ?? 0)
            totalBytes = Int64(vals.volumeTotalCapacity ?? 0)
        }
        call.resolve([
            "freeBytes": freeBytes,
            "totalBytes": totalBytes,
            "ramBytes": Int64(ProcessInfo.processInfo.physicalMemory)
        ])
    }

    // ---------------------------------------------------------------- models

    @objc func listModels(_ call: CAPPluginCall) {
        let models = store.list().map { model in
            [
                "id": model.id,
                "fileName": model.fileName,
                "sizeBytes": model.sizeBytes,
                "location": model.location.rawValue,
                "evicted": model.evicted
            ] as [String: Any]
        }
        call.resolve(["models": models])
    }

    @objc func downloadModel(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let urlString = call.getString("url"),
              let url = URL(string: urlString), url.scheme == "https"
        else {
            call.reject("downloadModel needs an id and an https url.")
            return
        }
        // MP-S2: pocket-model weights come only from Hugging Face. The builder
        // gate already enforces this host, so this is defense in depth: a
        // tampered catalog cannot point the phone at an arbitrary GGUF to feed
        // llama.cpp. The CDN redirect (cdn-lfs.huggingface.co) is followed by
        // URLSession AFTER this check, which is fine.
        let host = url.host ?? ""
        guard host == "huggingface.co" || host.hasSuffix(".huggingface.co") else {
            call.reject("downloadModel only accepts a huggingface.co url.")
            return
        }
        let target: ModelStore.StorageTarget =
            call.getString("target") == "icloud" ? .icloud : .device
        if target == .icloud, store.iCloudModelsRoot() == nil {
            call.reject("iCloud is not available on this iPhone. Sign in to iCloud, or download to this device instead.")
            return
        }
        call.keepAlive = true
        downloadsLock.lock()
        pendingDownloads[id, default: []].append(call)
        downloadsLock.unlock()
        store.download(id: id, from: url, target: target)
    }

    @objc func ensureLocal(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("ensureLocal needs a model id.")
            return
        }
        // Materializing an evicted iCloud model can block while iCloud pulls the
        // bytes down, so run it off the plugin queue and hold a background
        // assertion so a fetch in progress is not suspended the instant the app
        // leaves the foreground.
        let activity = BackgroundActivity("oscode.ensureLocal")
        activity.begin()
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { activity.end(); return }
            let result = self.store.ensureLocal(id: id)
            activity.end()
            call.resolve(["ready": result.ready, "downloading": result.downloading])
        }
    }

    @objc func activeDownloads(_ call: CAPPluginCall) {
        call.resolve(["ids": store.activeIds()])
    }

    @objc func cancelDownload(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("cancelDownload needs an id.")
            return
        }
        store.cancel(id: id)
        downloadsLock.lock()
        let pending = pendingDownloads.removeValue(forKey: id) ?? []
        downloadsLock.unlock()
        for waiting in pending { waiting.reject("Download cancelled.") }
        call.resolve()
    }

    @objc func deleteModel(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("deleteModel needs an id.")
            return
        }
        if runner.loadedId == id { runner.unload(reason: "The model was deleted.") }
        store.delete(id: id)
        call.resolve()
    }

    // ------------------------------------------------------------- inference

    @objc func load(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("load needs a model id.")
            return
        }
        let contextSize = Int32(call.getInt("contextSize") ?? 4096)
        // Resolve the model wherever it lives: the device copy first, then the
        // iCloud copy. The JS load path calls ensureLocal before this, so an
        // iCloud model's bytes are already materialized by the time we get here.
        guard let path = store.resolvedURL(for: id)?.path,
              FileManager.default.fileExists(atPath: path) else {
            call.resolve(["ok": false, "detail": "That model is not on this iPhone yet. Download it first."])
            return
        }
        // Loading multi-GB weights blocks; keep it off the plugin queue. Hold a
        // background assertion so a load in progress is not suspended the moment
        // the app leaves the foreground.
        let activity = BackgroundActivity("oscode.load")
        activity.begin()
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { activity.end(); return }
            let result = self.runner.load(id: id, path: path, contextSize: contextSize)
            var payload: [String: Any] = ["ok": result.ok]
            if let detail = result.detail { payload["detail"] = detail }
            activity.end()
            call.resolve(payload)
        }
    }

    @objc func unload(_ call: CAPPluginCall) {
        runner.unload()
        call.resolve()
    }

    @objc func generate(_ call: CAPPluginCall) {
        guard let requestId = call.getString("requestId") else {
            call.reject("generate needs a requestId.")
            return
        }
        let system = call.getString("system") ?? ""
        let raw = call.getArray("messages") ?? []
        let messages: [(role: String, content: String)] = raw.compactMap { entry in
            guard let dict = entry as? [String: Any],
                  let role = dict["role"] as? String,
                  let content = dict["content"] as? String
            else { return nil }
            return (role: role, content: content)
        }

        // Keep a reply that is mid-stream alive through the OS grace period if
        // the user backgrounds the app while it is still writing.
        let activity = BackgroundActivity("oscode.generate")
        activity.begin()
        let started = runner.generate(
            requestId: requestId,
            system: system,
            messages: messages,
            onDelta: { [weak self] delta in
                self?.notifyListeners("token", data: [
                    "requestId": requestId,
                    "delta": delta
                ])
            },
            onDone: { [weak self] stopReason, detail in
                activity.end()
                var payload: [String: Any] = [
                    "requestId": requestId,
                    "stopReason": stopReason
                ]
                if let detail { payload["detail"] = detail }
                self?.notifyListeners("generationDone", data: payload)
            }
        )
        if !started { activity.end() }
        call.resolve(["started": started])
    }

    @objc func stop(_ call: CAPPluginCall) {
        guard let requestId = call.getString("requestId") else {
            call.reject("stop needs a requestId.")
            return
        }
        runner.stop(requestId: requestId)
        call.resolve()
    }

    // ------------------------------------------------------------------- push

    @objc func requestPushPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            if granted {
                // Registration must run on the main thread; the token then lands
                // in the AppDelegate and flows back through deliverPushToken.
                DispatchQueue.main.async {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
            call.resolve(["granted": granted])
        }
    }

    @objc func getPushToken(_ call: CAPPluginCall) {
        call.resolve([
            "token": Self.cachedPushToken ?? NSNull(),
            "environment": Self.apsEnvironment
        ])
    }

    // ---------------------------------------------------------------- secrets

    @objc func secureGet(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else {
            call.reject("secureGet needs a key.")
            return
        }
        call.resolve(["value": Keychain.get(key) ?? NSNull()])
    }

    @objc func secureSet(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let value = call.getString("value") else {
            call.reject("secureSet needs a key and a value.")
            return
        }
        Keychain.set(value, for: key)
        call.resolve()
    }

    @objc func secureDelete(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else {
            call.reject("secureDelete needs a key.")
            return
        }
        Keychain.delete(key)
        call.resolve()
    }
}
