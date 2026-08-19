import Foundation

/// Harbor, the built-in guide model, ships as an On-Demand Resource tagged
/// "HarborModel" and marked for initial install. That keeps it present offline
/// at first launch (it rides the first download and counts toward the app
/// size) while staying OS-purgeable and re-downloadable from Apple's CDN, so it
/// is removable to free space and re-addable without OpenShore hosting a weight.
///
/// XCODE SETUP (see docs/HARBOR.md): add the Qwen2.5-0.5B-Instruct Q4_K_M GGUF
/// to the app target, assign it the resource tag "HarborModel", and set that
/// tag's prefetch order to "Initial install tags". The file's base name must
/// match `fileName` below.
final class HarborResource {
    static let tag = "HarborModel"
    static let fileName = "qwen2.5-0.5b-instruct-q4_k_m"
    static let ext = "gguf"

    private var request: NSBundleResourceRequest?

    /// Make the weights available and hand back their on-disk URL. Cheap when
    /// the tag is already present (initial-install), which is the common case.
    func ensure(_ completion: @escaping (Result<URL, Error>) -> Void) {
        // A plain bundle lookup first: an initial-install tag is usually right
        // there, no resource request needed.
        if let url = Bundle.main.url(forResource: Self.fileName, withExtension: Self.ext) {
            completion(.success(url))
            return
        }
        let req = NSBundleResourceRequest(tags: [Self.tag])
        request = req
        req.beginAccessingResources { error in
            if let error {
                completion(.failure(error))
                return
            }
            if let url = req.bundle.url(forResource: Self.fileName, withExtension: Self.ext) {
                completion(.success(url))
            } else {
                completion(.failure(NSError(
                    domain: "OscodeLlama", code: 404,
                    userInfo: [NSLocalizedDescriptionKey:
                        "Harbor is not bundled in this build. See docs/HARBOR.md."])))
            }
        }
    }

    /// Let iOS reclaim the space when the user removes Harbor from the library.
    func release() {
        request?.endAccessingResources()
        request = nil
    }
}
