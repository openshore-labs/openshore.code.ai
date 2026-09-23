import Foundation
import UIKit
import UserNotifications

/// Local notices: the banner that tells you something you walked away from is
/// done. The pattern is the Claude app's: a notice only when you are not
/// looking (a foreground app shows it live instead), the permission is asked the
/// first time you start something worth waiting for, never at launch, and a tap
/// opens the thing the notice is about.
///
/// Download notices are posted HERE, natively, not from JS. A model download
/// runs on the background URLSession and often finishes while the app is
/// suspended or closed, when iOS relaunches the app in the background purely to
/// run the completion delegate and the web layer may never wake. So the JS side
/// hands its copy over when the download starts (setDownloadCopy), it rides
/// UserDefaults across a relaunch, and ModelStore calls downloadFinished.
/// Every other notice is posted from JS through the plugin's postNotice.
public enum Notices {
    private static let defaults = UserDefaults.standard
    private static let downloadsKey = "oscode.notice.downloads"
    private static func copyKey(_ id: String) -> String { "oscode.notice.copy.\(id)" }

    /// The person's "Downloads" notice toggle, mirrored from the app settings so
    /// a background relaunch can read it with no web layer. Undefined means on.
    static var downloadsEnabled: Bool {
        get { defaults.object(forKey: downloadsKey) as? Bool ?? true }
        set { defaults.set(newValue, forKey: downloadsKey) }
    }

    /// Stash the words and the tap route for one download, keyed by model id.
    /// Keys: doneTitle, doneBody, failTitle, failBody, route (all strings).
    static func setDownloadCopy(id: String, copy: [String: String]) {
        defaults.set(copy, forKey: copyKey(id))
    }

    /// The download was cancelled on purpose: drop its copy so no notice fires.
    static func forgetDownload(id: String) {
        defaults.removeObject(forKey: copyKey(id))
    }

    /// Called by ModelStore when a transfer ends, in the foreground, the
    /// background, or a background relaunch. Posts only when the app is not
    /// active; the copy is consumed either way so a notice fires at most once.
    static func downloadFinished(id: String, ok: Bool) {
        guard let copy = defaults.dictionary(forKey: copyKey(id)) as? [String: String] else { return }
        forgetDownload(id: id)
        guard downloadsEnabled else { return }
        let title = ok ? copy["doneTitle"] : copy["failTitle"]
        let body = ok ? copy["doneBody"] : copy["failBody"]
        guard let title, let body else { return }
        DispatchQueue.main.async {
            guard UIApplication.shared.applicationState != .active else { return }
            post(id: "download.\(id)", title: title, body: body, route: copy["route"], thread: "downloads")
        }
    }

    /// Post a notice now. A notice with the same id replaces the earlier one
    /// rather than stacking, and one thread groups a conversation's notices.
    /// Without permission iOS drops it silently, which is the right outcome.
    static func post(id: String, title: String, body: String, route: String?, thread: String?) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        if let thread { content.threadIdentifier = thread }
        if let route { content.userInfo = ["route": route] }
        let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    /// The authorization state in the words the JS layer reads.
    static func status(_ completion: @escaping (String) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .notDetermined: completion("prompt")
            case .denied: completion("denied")
            default: completion("granted")
            }
        }
    }
}
