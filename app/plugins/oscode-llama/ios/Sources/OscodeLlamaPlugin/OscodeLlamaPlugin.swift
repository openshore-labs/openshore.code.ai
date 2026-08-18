import Foundation
import Capacitor

/// The Capacitor bridge for on-device inference. The JS contract lives in
/// app/src/lib/llamaPlugin.ts; keep the two in lockstep. Events:
/// downloadProgress, token, generationDone.
@objc(OscodeLlamaPlugin)
public class OscodeLlamaPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OscodeLlamaPlugin"
    public let jsName = "OscodeLlama"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listModels", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloadModel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteModel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let store = ModelStore()
    private let runner = LlamaRunner()
    private var pendingDownloads = [String: CAPPluginCall]()
    private let downloadsLock = NSLock()

    override public func load() {
        store.setHandlers(
            progress: { [weak self] id, completed, total in
                self?.notifyListeners("downloadProgress", data: [
                    "id": id,
                    "completed": completed,
                    "total": total
                ])
            },
            completion: { [weak self] id, result in
                guard let self else { return }
                self.downloadsLock.lock()
                let call = self.pendingDownloads.removeValue(forKey: id)
                self.downloadsLock.unlock()
                switch result {
                case .success(let url):
                    call?.resolve(["path": url.path])
                case .failure(let error):
                    call?.reject("The download did not finish: \(error.localizedDescription)")
                }
            }
        )
    }

    // ---------------------------------------------------------------- device

    @objc func isSupported(_ call: CAPPluginCall) {
        #if targetEnvironment(simulator)
        call.resolve(["supported": true, "reason": "Simulator run: slower than a real iPhone."])
        #else
        let ramGB = Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824
        if ramGB < 3.5 {
            call.resolve([
                "supported": false,
                "reason": "This iPhone does not have enough memory to run a local model well."
            ])
        } else {
            call.resolve(["supported": true])
        }
        #endif
    }

    // ---------------------------------------------------------------- models

    @objc func listModels(_ call: CAPPluginCall) {
        let models = store.list().map { model in
            [
                "id": model.id,
                "fileName": model.fileName,
                "sizeBytes": model.sizeBytes
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
        call.keepAlive = true
        downloadsLock.lock()
        pendingDownloads[id] = call
        downloadsLock.unlock()
        store.download(id: id, from: url)
    }

    @objc func cancelDownload(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("cancelDownload needs an id.")
            return
        }
        store.cancel(id: id)
        downloadsLock.lock()
        let pending = pendingDownloads.removeValue(forKey: id)
        downloadsLock.unlock()
        pending?.reject("Download cancelled.")
        call.resolve()
    }

    @objc func deleteModel(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("deleteModel needs an id.")
            return
        }
        if runner.loadedId == id { runner.unload() }
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
        let path = store.localURL(for: id).path
        guard FileManager.default.fileExists(atPath: path) else {
            call.resolve(["ok": false, "detail": "That model is not on this iPhone yet. Download it first."])
            return
        }
        // Loading multi-GB weights blocks; keep it off the plugin queue.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let result = self.runner.load(id: id, path: path, contextSize: contextSize)
            var payload: [String: Any] = ["ok": result.ok]
            if let detail = result.detail { payload["detail"] = detail }
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
                var payload: [String: Any] = [
                    "requestId": requestId,
                    "stopReason": stopReason
                ]
                if let detail { payload["detail"] = detail }
                self?.notifyListeners("generationDone", data: payload)
            }
        )
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
}
