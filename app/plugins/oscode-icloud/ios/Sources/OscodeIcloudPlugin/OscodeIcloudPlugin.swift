import Foundation
import Capacitor

// iCloud Drive storage for the Vault. Files live under the app's ubiquity
// container at Documents/<resourceId>/<path>, so they appear in the Files app
// under iCloud Drive (Documents scope is public, see Info.plist), sync across
// the user's devices for free, and open in Obsidian mobile unchanged.
//
// Every read and write goes through NSFileCoordinator so a concurrent iCloud
// sync never hands us a torn file, and reads first ask iCloud to materialize a
// not-yet-downloaded placeholder. The container id must match the entitlement
// (com.apple.developer.icloud-container-identifiers) and the App ID capability
// enabled in the Apple Developer portal, or url(forUbiquityContainerIdentifier)
// returns nil and availability() honestly reports false.
@objc(OscodeIcloudPlugin)
public class OscodeIcloudPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OscodeIcloudPlugin"
    public let jsName = "OscodeIcloud"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    private let containerId = "iCloud.ai.openshore.oscode"
    private let coordinatorQueue = DispatchQueue(label: "ai.openshore.oscode.icloud")

    /// The container's Documents root, or nil when iCloud is unavailable (the
    /// user is signed out, or the capability is not provisioned).
    private func documentsRoot() -> URL? {
        guard let container = FileManager.default.url(forUbiquityContainerIdentifier: containerId)
        else { return nil }
        return container.appendingPathComponent("Documents", isDirectory: true)
    }

    private func resourceRoot(_ resourceId: String) -> URL? {
        // A resource id names one vault or repo; it is never a path. Reject any
        // separators or dot-dot so it cannot climb out of the Documents scope.
        if resourceId.contains("/") || resourceId.contains("\\") || resourceId.contains("..") {
            return nil
        }
        return documentsRoot()?.appendingPathComponent(resourceId, isDirectory: true)
    }

    /// Resolve a note path under a resource root, refusing any result that
    /// escapes the root. The JS layer already strips dot-dot, but the plugin
    /// must not trust it: a climb here could overwrite a sibling resource's
    /// files or its lock (SEC path jail, native side).
    private func confinedURL(_ root: URL, _ path: String) -> URL? {
        let candidate = root.appendingPathComponent(path).standardizedFileURL
        let base = root.standardizedFileURL
        let basePrefix = base.path.hasSuffix("/") ? base.path : base.path + "/"
        guard candidate.path != base.path, candidate.path.hasPrefix(basePrefix) else {
            return nil
        }
        return candidate
    }

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": documentsRoot() != nil])
    }

    @objc func list(_ call: CAPPluginCall) {
        guard let resourceId = call.getString("resourceId") else {
            call.reject("list needs a resourceId.")
            return
        }
        guard let root = resourceRoot(resourceId) else {
            call.reject("iCloud is not available on this device.")
            return
        }
        coordinatorQueue.async {
            let fm = FileManager.default
            var files: [[String: Any]] = []
            let keys: [URLResourceKey] = [.contentModificationDateKey, .fileSizeKey, .isRegularFileKey]
            if let e = fm.enumerator(at: root, includingPropertiesForKeys: keys) {
                for case let url as URL in e {
                    let vals = try? url.resourceValues(forKeys: Set(keys))
                    guard vals?.isRegularFile == true else { continue }
                    // The ".icloud" placeholder name is how a not-yet-downloaded
                    // file shows up; skip it, read() materializes on demand.
                    let rel = url.path.replacingOccurrences(of: root.path + "/", with: "")
                    if rel.hasSuffix(".icloud") { continue }
                    let mtime = (vals?.contentModificationDate ?? Date()).iso8601
                    files.append([
                        "path": rel,
                        "updatedAt": mtime,
                        "size": vals?.fileSize ?? 0
                    ])
                }
            }
            call.resolve(["files": files])
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        guard let resourceId = call.getString("resourceId"), let path = call.getString("path") else {
            call.reject("read needs a resourceId and a path.")
            return
        }
        guard let root = resourceRoot(resourceId) else {
            call.reject("iCloud is not available on this device.")
            return
        }
        guard let url = confinedURL(root, path) else {
            call.reject("Invalid path.")
            return
        }
        coordinatorQueue.async {
            let fm = FileManager.default
            // Ask iCloud to pull down a placeholder before the coordinated read.
            try? fm.startDownloadingUbiquitousItem(at: url)
            func downloadingStatus() -> URLUbiquitousItemDownloadingStatus? {
                return (try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]))?
                    .ubiquitousItemDownloadingStatus
            }
            // A not-yet-downloaded note is a placeholder, not a missing file.
            // Wait briefly for it to materialize so the app is never told the
            // note does not exist (which would open it empty and save the empty
            // body back over the cloud copy). Bounded so a genuinely missing
            // file still returns promptly.
            var waited = 0.0
            while let status = downloadingStatus(), status != .current, waited < 3.0 {
                Thread.sleep(forTimeInterval: 0.2)
                waited += 0.2
            }
            var text: String?
            var updatedAt = Date().iso8601
            var coordError: NSError?
            NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordError) { u in
                guard let data = try? Data(contentsOf: u) else { return }
                text = String(data: data, encoding: .utf8)
                if let m = try? u.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate {
                    updatedAt = m.iso8601
                }
            }
            if let text = text {
                call.resolve(["found": true, "text": text, "updatedAt": updatedAt])
            } else if let status = downloadingStatus(), status != .current {
                // The file exists in iCloud but is not downloaded here yet. Tell
                // the app so it shows a downloading state, never an empty note.
                call.resolve(["found": false, "downloading": true])
            } else {
                call.resolve(["found": false])
            }
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let resourceId = call.getString("resourceId"),
              let path = call.getString("path"),
              let text = call.getString("text") else {
            call.reject("write needs a resourceId, a path, and text.")
            return
        }
        guard let root = resourceRoot(resourceId) else {
            call.reject("iCloud is not available on this device.")
            return
        }
        guard let url = confinedURL(root, path) else {
            call.reject("Invalid path.")
            return
        }
        coordinatorQueue.async {
            let fm = FileManager.default
            try? fm.createDirectory(at: url.deletingLastPathComponent(),
                                    withIntermediateDirectories: true)
            var coordError: NSError?
            var writeError: Error?
            NSFileCoordinator().coordinate(writingItemAt: url, options: [.forReplacing], error: &coordError) { u in
                do { try Data(text.utf8).write(to: u, options: .atomic) }
                catch { writeError = error }
            }
            if let err = writeError ?? coordError {
                call.reject("iCloud write failed: \(err.localizedDescription)")
                return
            }
            let updatedAt = (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)?.iso8601 ?? Date().iso8601
            call.resolve(["updatedAt": updatedAt])
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let resourceId = call.getString("resourceId"), let path = call.getString("path") else {
            call.reject("remove needs a resourceId and a path.")
            return
        }
        guard let root = resourceRoot(resourceId) else {
            call.reject("iCloud is not available on this device.")
            return
        }
        guard let url = confinedURL(root, path) else {
            call.reject("Invalid path.")
            return
        }
        coordinatorQueue.async {
            var coordError: NSError?
            NSFileCoordinator().coordinate(writingItemAt: url, options: [.forDeleting], error: &coordError) { u in
                try? FileManager.default.removeItem(at: u)
            }
            call.resolve()
        }
    }
}

private extension Date {
    var iso8601: String { ISO8601DateFormatter().string(from: self) }
}
