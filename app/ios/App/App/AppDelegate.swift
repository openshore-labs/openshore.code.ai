import UIKit
import Capacitor
import OscodeLlama
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    // iOS calls this when it has relaunched the app in the background to finish
    // model downloads that kept running on the background URLSession while the
    // app was suspended or closed. Hand the completion handler to the store,
    // which owns that session; it calls the handler once every delegate event
    // has been delivered so the system can re-suspend the app cleanly.
    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        ModelStore.handleBackgroundSessionEvents(
            identifier: identifier, completionHandler: completionHandler)
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Own the notification-center delegate so a completion push that arrives
        // while the app is foreground can be suppressed (the user is already
        // here). Registration itself is requested contextually from JS, not at
        // launch.
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    // APNs handed us a device token. Hex-encode it (the wire form APNs expects)
    // and pass it to the plugin, which caches it and emits it to the web layer.
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        OscodeLlamaPlugin.deliverPushToken(hex)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        NSLog("OpenShore: APNs registration failed: \(error.localizedDescription)")
    }

    // A push that arrives while the app is foreground is redundant: the user is
    // looking at OpenShore and will see the run update live. Suppress the banner so
    // it is not shown on top of the very session it is about.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([])
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
