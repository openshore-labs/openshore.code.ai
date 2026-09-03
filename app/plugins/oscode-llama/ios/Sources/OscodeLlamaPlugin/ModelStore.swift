import Foundation

/// Downloads GGUF weights straight from their public source (Hugging Face
/// resolve URLs) into storage, and keeps the local inventory. OpenShore never
/// rehosts weights; this store is the phone reaching the source directly.
///
/// A model lands in one of two homes:
///   - device: the app's own Application Support/Models directory, excluded
///     from device backup because the weights are re-downloadable.
///   - icloud: the app's iCloud Drive container under Documents/Models, so a
///     model too big for the phone still has a home. iCloud may evict it to a
///     placeholder; ensureLocal pulls it back before a load, when online.
///
/// Downloads run on a BACKGROUND URLSession, not a foreground one. That is the
/// whole point of this file: a foreground session is suspended the moment the
/// app is backgrounded and killed when the app is closed, so a multi-GB model
/// download died if the user so much as switched apps. A background session is
/// owned by the system daemon: it keeps transferring while the app is
/// suspended or fully terminated, and relaunches the app in the background to
/// finish. Because the app can be relaunched from scratch, the store is a
/// process-wide singleton, recreates the same named session on launch, and
/// recovers which model each in-flight task belongs to from the task's
/// taskDescription (which the system preserves across relaunch). The chosen
/// home rides in that same taskDescription, so a transfer that finishes after a
/// relaunch still lands in the right place.
public final class ModelStore: NSObject, URLSessionDownloadDelegate {

    /// Where a model's bytes live. The raw value is what the JS layer reads.
    enum StorageTarget: String {
        case device
        case icloud
    }

    struct LocalModel {
        let id: String
        let fileName: String
        let sizeBytes: Int64
        let location: StorageTarget
        /// True for an iCloud model whose bytes are not on this device yet.
        let evicted: Bool
    }

    typealias ProgressHandler = (_ id: String, _ completed: Int64, _ total: Int64) -> Void
    typealias CompletionHandler = (_ id: String, _ location: String, _ result: Result<URL, Error>) -> Void

    /// One store, one background session, for the whole process. A background
    /// URLSession must be a singleton per identifier; recreating it would be a
    /// runtime error, and it also has to survive an app relaunch triggered
    /// purely to finish a transfer.
    static let shared = ModelStore()

    /// Stable name for the background session. It has to match on every launch
    /// so the system can hand the app's pending transfers back to the same
    /// session object.
    static let backgroundSessionIdentifier = "ai.openshore.oscode.model-downloads"

    /// The iCloud container, matched to the entitlement and the OscodeIcloud
    /// plugin so models sit beside the Vault in the same Drive folder.
    static let iCloudContainerId = "iCloud.ai.openshore.oscode"

    /// Set by the AppDelegate when iOS wakes the app to finish background
    /// transfers; called once all delegate events have been delivered so the
    /// system can snapshot and re-suspend the app.
    private static var backgroundEventsCompletion: (() -> Void)?

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.backgroundSessionIdentifier)
        // Very large weights over a slow link: give the whole transfer plenty
        // of room rather than timing out a legitimate long download.
        config.timeoutIntervalForResource = 60 * 60 * 24
        // Start immediately instead of waiting for wifi and a charger. The user
        // pressed download; honor it now.
        config.isDiscretionary = false
        config.allowsCellularAccess = true
        // Relaunch the app in the background to run the completion delegate
        // callbacks when a transfer finishes while the app is not running.
        config.sessionSendsLaunchEvents = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    private var taskIds = [Int: String]() // URLSession task id -> encoded description
    private var activeTasks = [String: URLSessionDownloadTask]() // logical model id -> task
    private var onProgress: ProgressHandler?
    private var onComplete: CompletionHandler?
    private let lock = NSLock()

    // Recovery gate. On launch the store asks the session which transfers it is
    // still running (getAllTasks, async). Until that answer is in, a fresh
    // download request is held so it cannot start a duplicate of a transfer the
    // system is already carrying. Any request that arrives early is queued and
    // flushed once recovery finishes.
    private var recovered = false
    private var queuedStarts = [(id: String, url: URL, target: StorageTarget)]()

    override init() {
        super.init()
        // Realize the session now so its delegate is attached and the system
        // can immediately deliver any completion callbacks that piled up while
        // the app was not running, then reconnect to whatever is still going.
        recoverActiveTasks()
    }

    /// Entry point for the AppDelegate's handleEventsForBackgroundURLSession.
    /// Stashes the system completion handler and makes sure the singleton (and
    /// therefore its session and delegate) exists so pending events flow.
    public static func handleBackgroundSessionEvents(
        identifier: String, completionHandler: @escaping () -> Void
    ) {
        guard identifier == backgroundSessionIdentifier else {
            completionHandler()
            return
        }
        backgroundEventsCompletion = completionHandler
        _ = shared.session
    }

    // ------------------------------------------------------- task description

    // The chosen home travels inside the task description so a transfer that
    // finishes after a background relaunch still lands in the right place. A
    // device transfer keeps the bare id, for backward compatibility with any
    // task started before this seam existed.
    private static let icloudPrefix = "icloud\u{1}"

    private func encodeDesc(_ id: String, _ target: StorageTarget) -> String {
        target == .icloud ? "\(Self.icloudPrefix)\(id)" : id
    }

    private func decodeDesc(_ desc: String) -> (id: String, target: StorageTarget) {
        if desc.hasPrefix(Self.icloudPrefix) {
            return (String(desc.dropFirst(Self.icloudPrefix.count)), .icloud)
        }
        return (desc, .device)
    }

    private func decoded(_ task: URLSessionTask) -> (id: String, target: StorageTarget)? {
        guard let desc = task.taskDescription else { return nil }
        return decodeDesc(desc)
    }

    // ------------------------------------------------------------- inventory

    /// The device home. Created lazily and marked do-not-back-up: the weights
    /// are re-downloadable, so they never belong in a device or iCloud backup.
    var directory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        var dir = base.appendingPathComponent("Models", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? dir.setResourceValues(values)
        }
        return dir
    }

    /// The iCloud home under the container's Documents/Models, or nil when
    /// iCloud is not available (signed out, or the capability is not
    /// provisioned). Created on first use so it shows up in the Files app.
    func iCloudModelsRoot() -> URL? {
        guard let container = FileManager.default.url(forUbiquityContainerIdentifier: Self.iCloudContainerId)
        else { return nil }
        let dir = container
            .appendingPathComponent("Documents", isDirectory: true)
            .appendingPathComponent("Models", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    func deviceURL(for id: String) -> URL {
        directory.appendingPathComponent("\(sanitize(id)).gguf")
    }

    func iCloudURL(for id: String) -> URL? {
        iCloudModelsRoot()?.appendingPathComponent("\(sanitize(id)).gguf")
    }

    /// Kept as the historical name some call sites used; the device home.
    func localURL(for id: String) -> URL { deviceURL(for: id) }

    /// The readable path for a model wherever it lives: the device copy first,
    /// then the iCloud copy. Nil when the model is not present in either home.
    /// An iCloud copy that is still an evicted placeholder returns its real URL
    /// anyway; ensureLocal must run before a load to pull the bytes down.
    func resolvedURL(for id: String) -> URL? {
        let device = deviceURL(for: id)
        if FileManager.default.fileExists(atPath: device.path) { return device }
        if let cloud = iCloudURL(for: id), cloudItemPresent(cloud) { return cloud }
        return nil
    }

    func list() -> [LocalModel] {
        deviceModels() + iCloudModels()
    }

    private func deviceModels() -> [LocalModel] {
        let files = (try? FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: [.fileSizeKey])) ?? []
        return files.compactMap { url in
            guard url.pathExtension == "gguf" else { return nil }
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize).flatMap { Int64($0) } ?? 0
            return LocalModel(
                id: url.deletingPathExtension().lastPathComponent,
                fileName: url.lastPathComponent,
                sizeBytes: size,
                location: .device,
                evicted: false)
        }
    }

    private func iCloudModels() -> [LocalModel] {
        guard let root = iCloudModelsRoot() else { return [] }
        let keys: [URLResourceKey] = [.fileSizeKey, .ubiquitousItemDownloadingStatusKey]
        let urls = (try? FileManager.default.contentsOfDirectory(
            at: root, includingPropertiesForKeys: keys)) ?? []
        var out: [LocalModel] = []
        for url in urls {
            // A not-yet-downloaded file surfaces as a ".<name>.icloud"
            // placeholder; strip that to recover the logical name so an evicted
            // model still lists as owned, not missing.
            var name = url.lastPathComponent
            var placeholder = false
            if name.hasSuffix(".icloud") {
                placeholder = true
                name = String(name.dropLast(".icloud".count))
                if name.hasPrefix(".") { name = String(name.dropFirst()) }
            }
            guard name.hasSuffix(".gguf") else { continue }
            let id = String(name.dropLast(".gguf".count))
            let vals = try? url.resourceValues(forKeys: Set(keys))
            let status = vals?.ubiquitousItemDownloadingStatus
            let evicted = placeholder || (status != nil && status != .current)
            out.append(LocalModel(
                id: id,
                fileName: "\(id).gguf",
                sizeBytes: Int64(vals?.fileSize ?? 0),
                location: .icloud,
                evicted: evicted))
        }
        return out
    }

    /// Is a model's iCloud item present at all (downloaded or an evicted
    /// placeholder), as opposed to genuinely not in the container?
    private func cloudItemPresent(_ url: URL) -> Bool {
        let fm = FileManager.default
        if fm.fileExists(atPath: url.path) { return true }
        // The placeholder for a not-downloaded item is a hidden sibling.
        let placeholder = url.deletingLastPathComponent()
            .appendingPathComponent(".\(url.lastPathComponent).icloud")
        return fm.fileExists(atPath: placeholder.path)
    }

    func delete(id: String) {
        try? FileManager.default.removeItem(at: deviceURL(for: id))
        if let cloud = iCloudURL(for: id) {
            var coordError: NSError?
            NSFileCoordinator().coordinate(writingItemAt: cloud, options: [.forDeleting], error: &coordError) { u in
                try? FileManager.default.removeItem(at: u)
            }
        }
    }

    /// Make an iCloud-stored model present on this device, downloading it if it
    /// was evicted. A no-op for a device model or one already materialized.
    /// Bounded so it never blocks the bridge for long: if the item is not
    /// current within the window it returns downloading, and the caller retries
    /// once the background pull has had time to land.
    func ensureLocal(id: String) -> (ready: Bool, downloading: Bool) {
        let fm = FileManager.default
        if fm.fileExists(atPath: deviceURL(for: id).path) { return (true, false) }
        guard let cloud = iCloudURL(for: id), cloudItemPresent(cloud) else {
            // Not an iCloud model (or not owned at all); let load speak to it.
            return (true, false)
        }
        func status() -> URLUbiquitousItemDownloadingStatus? {
            (try? cloud.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]))?
                .ubiquitousItemDownloadingStatus
        }
        if status() == .current, fm.fileExists(atPath: cloud.path) { return (true, false) }
        try? fm.startDownloadingUbiquitousItem(at: cloud)
        var waited = 0.0
        while status() != .current, waited < 8.0 {
            Thread.sleep(forTimeInterval: 0.3)
            waited += 0.3
        }
        if status() == .current, fm.fileExists(atPath: cloud.path) { return (true, false) }
        // Still coming down (or offline): not ready yet, a pull is under way, so
        // the caller shows a guided "downloading, try again" message.
        return (false, true)
    }

    /// Model ids the background session is currently transferring. Lets the JS
    /// side re-show a progress bar for a download that was still running when
    /// the app was reopened.
    func activeIds() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return Array(activeTasks.keys)
    }

    // ------------------------------------------------------------- downloads

    func setHandlers(progress: @escaping ProgressHandler, completion: @escaping CompletionHandler) {
        lock.lock()
        onProgress = progress
        onComplete = completion
        lock.unlock()
    }

    func download(id: String, from url: URL, target: StorageTarget) {
        // The weights may already be on disk in either home (a background
        // transfer that finished while the app was closed). Do not re-download;
        // report it done so the caller records it as present.
        if FileManager.default.fileExists(atPath: deviceURL(for: id).path) {
            reportComplete(id: id, location: .device, result: .success(deviceURL(for: id)))
            return
        }
        if let cloud = iCloudURL(for: id), cloudItemPresent(cloud) {
            reportComplete(id: id, location: .icloud, result: .success(cloud))
            return
        }
        lock.lock()
        if let existing = activeTasks[id] {
            lock.unlock()
            existing.resume() // already going (possibly recovered after relaunch)
            return
        }
        if !recovered {
            // Hold the start until recovery tells us whether the system is
            // already carrying this transfer, so we never launch a duplicate.
            queuedStarts.append((id: id, url: url, target: target))
            lock.unlock()
            return
        }
        startTask(id: id, url: url, target: target)
        lock.unlock()
    }

    private func reportComplete(id: String, location: StorageTarget, result: Result<URL, Error>) {
        lock.lock()
        let complete = onComplete
        lock.unlock()
        complete?(id, location.rawValue, result)
    }

    /// Caller must hold `lock`.
    private func startTask(id: String, url: URL, target: StorageTarget) {
        let task = session.downloadTask(with: url)
        // Survives an app relaunch: this is how a background transfer tells us
        // which model it belongs to, and which home it was headed for.
        task.taskDescription = encodeDesc(id, target)
        taskIds[task.taskIdentifier] = task.taskDescription
        activeTasks[id] = task
        task.resume()
    }

    func cancel(id: String) {
        lock.lock()
        let task = activeTasks[id]
        activeTasks[id] = nil
        if let task { taskIds[task.taskIdentifier] = nil }
        queuedStarts.removeAll { $0.id == id }
        lock.unlock()
        task?.cancel()
    }

    private func recoverActiveTasks() {
        session.getAllTasks { [weak self] tasks in
            guard let self else { return }
            self.lock.lock()
            for task in tasks {
                guard let desc = task.taskDescription,
                      let download = task as? URLSessionDownloadTask,
                      task.state == .running || task.state == .suspended
                else { continue }
                let id = self.decodeDesc(desc).id
                self.taskIds[task.taskIdentifier] = desc
                self.activeTasks[id] = download
            }
            self.recovered = true
            // Flush any download requests that arrived before recovery, minus
            // the ones the system was already carrying (now in activeTasks).
            let pending = self.queuedStarts
            self.queuedStarts.removeAll()
            for start in pending where self.activeTasks[start.id] == nil {
                self.startTask(id: start.id, url: start.url, target: start.target)
            }
            self.lock.unlock()
        }
    }

    // ------------------------------------------------- URLSessionDownloadDelegate

    public func urlSession(
        _ session: URLSession, downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64, totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        lock.lock()
        let progress = onProgress
        lock.unlock()
        guard let id = decoded(downloadTask)?.id else { return }
        progress?(id, totalBytesWritten, totalBytesExpectedToWrite)
    }

    public func urlSession(
        _ session: URLSession, downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        guard let (id, target) = decoded(downloadTask) else { return }
        lock.lock()
        let complete = onComplete
        lock.unlock()

        if let http = downloadTask.response as? HTTPURLResponse, http.statusCode >= 400 {
            complete?(id, target.rawValue, .failure(NSError(
                domain: "OscodeLlama", code: http.statusCode,
                userInfo: [NSLocalizedDescriptionKey: "The source answered \(http.statusCode). The model may have moved."])))
            clear(id: id, taskId: downloadTask.taskIdentifier)
            return
        }

        // The temp file at `location` is only valid for the length of this
        // callback, so move it into place synchronously, right here. This runs
        // even when the app was relaunched in the background purely to finish
        // the transfer, so the weights land with no app UI involved.
        do {
            let dest = try place(temp: location, id: id, target: target)
            complete?(id, target.rawValue, .success(dest))
        } catch {
            complete?(id, target.rawValue, .failure(error))
        }
        clear(id: id, taskId: downloadTask.taskIdentifier)
    }

    /// Move a finished download into its home. Device: straight into the
    /// backup-excluded Models directory. iCloud: staged locally first, then
    /// handed to iCloud with setUbiquitous so it syncs across the user's
    /// devices and can be evicted and pulled back later.
    private func place(temp: URL, id: String, target: StorageTarget) throws -> URL {
        let fm = FileManager.default
        switch target {
        case .device:
            let dest = deviceURL(for: id)
            try? fm.removeItem(at: dest)
            try fm.moveItem(at: temp, to: dest)
            return dest
        case .icloud:
            guard let dest = iCloudURL(for: id) else {
                // iCloud went away between the request and the finish. Fall back
                // to the device home so the download is never lost.
                let device = deviceURL(for: id)
                try? fm.removeItem(at: device)
                try fm.moveItem(at: temp, to: device)
                return device
            }
            // setUbiquitous moves an item, and cannot move the session's temp
            // file directly, so stage it in the app's tmp first.
            let staged = fm.temporaryDirectory.appendingPathComponent("\(sanitize(id)).gguf")
            try? fm.removeItem(at: staged)
            try fm.moveItem(at: temp, to: staged)
            try? fm.removeItem(at: dest)
            do {
                try fm.setUbiquitous(true, itemAt: staged, destinationURL: dest)
            } catch {
                // Could not hand it to iCloud; keep it on the device rather than
                // drop it, so the user still has the model they downloaded.
                let device = deviceURL(for: id)
                try? fm.removeItem(at: device)
                try fm.moveItem(at: staged, to: device)
                return device
            }
            return dest
        }
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return } // success already handled above
        guard let (id, target) = decoded(task) else { return }
        lock.lock()
        let complete = onComplete
        lock.unlock()
        if (error as NSError).code != NSURLErrorCancelled {
            complete?(id, target.rawValue, .failure(error))
        }
        clear(id: id, taskId: task.taskIdentifier)
    }

    /// Fired once all background events for this session have been delivered.
    /// Calling the stashed system handler on the main thread lets iOS re-suspend
    /// the app cleanly.
    public func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        let handler = Self.backgroundEventsCompletion
        Self.backgroundEventsCompletion = nil
        DispatchQueue.main.async { handler?() }
    }

    // ---------------------------------------------------------------- helpers

    private func clear(id: String, taskId: Int) {
        lock.lock()
        taskIds[taskId] = nil
        activeTasks[id] = nil
        lock.unlock()
    }

    private func sanitize(_ id: String) -> String {
        id.replacingOccurrences(of: "[^A-Za-z0-9._-]", with: "_", options: .regularExpression)
    }
}
