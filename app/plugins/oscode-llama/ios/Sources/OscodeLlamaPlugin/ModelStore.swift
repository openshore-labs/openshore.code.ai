import Foundation

/// Downloads GGUF weights straight from their public source (Hugging Face
/// resolve URLs) into the app's own storage, and keeps the local inventory.
/// OpenShore never rehosts weights; this store is the phone reaching the
/// source directly.
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
/// taskDescription (which the system preserves across relaunch).
public final class ModelStore: NSObject, URLSessionDownloadDelegate {

    struct LocalModel {
        let id: String
        let fileName: String
        let sizeBytes: Int64
    }

    typealias ProgressHandler = (_ id: String, _ completed: Int64, _ total: Int64) -> Void
    typealias CompletionHandler = (_ id: String, _ result: Result<URL, Error>) -> Void

    /// One store, one background session, for the whole process. A background
    /// URLSession must be a singleton per identifier; recreating it would be a
    /// runtime error, and it also has to survive an app relaunch triggered
    /// purely to finish a transfer.
    static let shared = ModelStore()

    /// Stable name for the background session. It has to match on every launch
    /// so the system can hand the app's pending transfers back to the same
    /// session object.
    static let backgroundSessionIdentifier = "ai.openshore.oscode.model-downloads"

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

    private var taskIds = [Int: String]() // URLSession task id -> model id
    private var activeTasks = [String: URLSessionDownloadTask]()
    private var onProgress: ProgressHandler?
    private var onComplete: CompletionHandler?
    private let lock = NSLock()

    // Recovery gate. On launch the store asks the session which transfers it is
    // still running (getAllTasks, async). Until that answer is in, a fresh
    // download request is held so it cannot start a duplicate of a transfer the
    // system is already carrying. Any request that arrives early is queued and
    // flushed once recovery finishes.
    private var recovered = false
    private var queuedStarts = [(id: String, url: URL)]()

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

    // ------------------------------------------------------------- inventory

    var directory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        var dir = base.appendingPathComponent("Models", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            // Weights are re-downloadable; keep them out of iCloud backups.
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? dir.setResourceValues(values)
        }
        return dir
    }

    func localURL(for id: String) -> URL {
        directory.appendingPathComponent("\(sanitize(id)).gguf")
    }

    func list() -> [LocalModel] {
        let files = (try? FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: [.fileSizeKey])) ?? []
        return files.compactMap { url in
            guard url.pathExtension == "gguf" else { return nil }
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize).flatMap { Int64($0) } ?? 0
            return LocalModel(
                id: url.deletingPathExtension().lastPathComponent,
                fileName: url.lastPathComponent,
                sizeBytes: size)
        }
    }

    func delete(id: String) {
        try? FileManager.default.removeItem(at: localURL(for: id))
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

    func download(id: String, from url: URL) {
        // MP-F4: the weights may already be on disk (a background transfer that
        // finished while the app was closed). Do not re-download; report it done
        // so the caller records it as present instead of pulling it again.
        let dest = localURL(for: id)
        if FileManager.default.fileExists(atPath: dest.path) {
            lock.lock()
            let complete = onComplete
            lock.unlock()
            complete?(id, .success(dest))
            return
        }
        lock.lock()
        if let existing = activeTasks[id] {
            lock.unlock()
            existing.resume() // already going (possibly recovered after relaunch); keep it running
            return
        }
        if !recovered {
            // Hold the start until recovery tells us whether the system is
            // already carrying this transfer, so we never launch a duplicate.
            queuedStarts.append((id: id, url: url))
            lock.unlock()
            return
        }
        startTask(id: id, url: url)
        lock.unlock()
    }

    /// Caller must hold `lock`.
    private func startTask(id: String, url: URL) {
        let task = session.downloadTask(with: url)
        // Survives an app relaunch: this is how a background transfer tells us
        // which model it belongs to when we get it back from getAllTasks.
        task.taskDescription = id
        taskIds[task.taskIdentifier] = id
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
                guard let id = task.taskDescription,
                      let download = task as? URLSessionDownloadTask,
                      task.state == .running || task.state == .suspended
                else { continue }
                self.taskIds[task.taskIdentifier] = id
                self.activeTasks[id] = download
            }
            self.recovered = true
            // Flush any download requests that arrived before recovery, minus
            // the ones the system was already carrying (now in activeTasks).
            let pending = self.queuedStarts
            self.queuedStarts.removeAll()
            for start in pending where self.activeTasks[start.id] == nil {
                self.startTask(id: start.id, url: start.url)
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
        let id = taskIds[downloadTask.taskIdentifier] ?? downloadTask.taskDescription
        let progress = onProgress
        lock.unlock()
        guard let id else { return }
        progress?(id, totalBytesWritten, totalBytesExpectedToWrite)
    }

    public func urlSession(
        _ session: URLSession, downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        lock.lock()
        let id = taskIds[downloadTask.taskIdentifier] ?? downloadTask.taskDescription
        let complete = onComplete
        lock.unlock()
        guard let id else { return }

        if let http = downloadTask.response as? HTTPURLResponse, http.statusCode >= 400 {
            complete?(id, .failure(NSError(
                domain: "OscodeLlama", code: http.statusCode,
                userInfo: [NSLocalizedDescriptionKey: "The source answered \(http.statusCode). The model may have moved."])))
            clear(id: id, taskId: downloadTask.taskIdentifier)
            return
        }

        // The temp file at `location` is only valid for the length of this
        // callback, so move it into place synchronously, right here. This runs
        // even when the app was relaunched in the background purely to finish
        // the transfer, so the weights land on disk with no app UI involved.
        let dest = localURL(for: id)
        do {
            try? FileManager.default.removeItem(at: dest)
            try FileManager.default.moveItem(at: location, to: dest)
            complete?(id, .success(dest))
        } catch {
            complete?(id, .failure(error))
        }
        clear(id: id, taskId: downloadTask.taskIdentifier)
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return } // success already handled above
        lock.lock()
        let id = taskIds[task.taskIdentifier] ?? task.taskDescription
        let complete = onComplete
        lock.unlock()
        guard let id else { return }
        if (error as NSError).code != NSURLErrorCancelled {
            complete?(id, .failure(error))
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
