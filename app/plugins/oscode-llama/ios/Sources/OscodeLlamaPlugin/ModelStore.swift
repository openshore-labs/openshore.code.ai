import Foundation

/// Downloads GGUF weights straight from their public source (Hugging Face
/// resolve URLs) into the app's own storage, and keeps the local inventory.
/// OpenShore never rehosts weights; this store is the phone reaching the
/// source directly.
final class ModelStore: NSObject, URLSessionDownloadDelegate {

    struct LocalModel {
        let id: String
        let fileName: String
        let sizeBytes: Int64
    }

    typealias ProgressHandler = (_ id: String, _ completed: Int64, _ total: Int64) -> Void
    typealias CompletionHandler = (_ id: String, _ result: Result<URL, Error>) -> Void

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 60 * 60 * 6 // big files, slow links
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    private var taskIds = [Int: String]() // URLSession task id -> model id
    private var activeTasks = [String: URLSessionDownloadTask]()
    private var onProgress: ProgressHandler?
    private var onComplete: CompletionHandler?
    private let lock = NSLock()

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

    // ------------------------------------------------------------- downloads

    func setHandlers(progress: @escaping ProgressHandler, completion: @escaping CompletionHandler) {
        lock.lock()
        onProgress = progress
        onComplete = completion
        lock.unlock()
    }

    func download(id: String, from url: URL) {
        lock.lock()
        if let existing = activeTasks[id] {
            lock.unlock()
            existing.resume() // already going; make sure it is running
            return
        }
        let task = session.downloadTask(with: url)
        taskIds[task.taskIdentifier] = id
        activeTasks[id] = task
        lock.unlock()
        task.resume()
    }

    func cancel(id: String) {
        lock.lock()
        let task = activeTasks[id]
        activeTasks[id] = nil
        if let task { taskIds[task.taskIdentifier] = nil }
        lock.unlock()
        task?.cancel()
    }

    // ------------------------------------------------- URLSessionDownloadDelegate

    func urlSession(
        _ session: URLSession, downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64, totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        lock.lock()
        let id = taskIds[downloadTask.taskIdentifier]
        let progress = onProgress
        lock.unlock()
        guard let id else { return }
        progress?(id, totalBytesWritten, totalBytesExpectedToWrite)
    }

    func urlSession(
        _ session: URLSession, downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        lock.lock()
        let id = taskIds[downloadTask.taskIdentifier]
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

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return } // success already handled above
        lock.lock()
        let id = taskIds[task.taskIdentifier]
        let complete = onComplete
        lock.unlock()
        guard let id else { return }
        if (error as NSError).code != NSURLErrorCancelled {
            complete?(id, .failure(error))
        }
        clear(id: id, taskId: task.taskIdentifier)
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
