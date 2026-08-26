import UIKit
import Capacitor
import OscodeLlamaPlugin
import UserNotifications
import WebKit

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
        // Let the web layer raise the keyboard from code, so the empty chat
        // screen can open with the keyboard already up (the Claude app does the
        // same). Guarded end to end, see ProgrammaticKeyboard below.
        ProgrammaticKeyboard.install()
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

// Allow the web layer to raise the keyboard from code. WKWebView normally
// refuses to show the keyboard for a field focused without a real touch, so a
// JS `element.focus()` on load leaves the field blinking with no keyboard. The
// empty chat screen wants the keyboard up immediately, so we swizzle
// WKContentView's private focus entry point to report the focus as user-driven.
//
// Every step is guarded: if the private class or selector is ever missing on a
// future iOS, `install()` simply does nothing and normal touch-driven focus is
// untouched. Nothing here can crash; the worst case is the keyboard again
// waiting for a tap. The selector below is the iOS 13.4+ form, which covers our
// 16.0 deployment minimum.
enum ProgrammaticKeyboard {
    private static var installed = false

    static func install() {
        guard !installed else { return }
        installed = true

        guard let contentViewClass = NSClassFromString("WKContentView") else { return }
        let selector = sel_registerName(
            "_elementDidFocus:userIsInteracting:blurPreviousNode:changingActivityState:userObject:")
        guard let method = class_getInstanceMethod(contentViewClass, selector) else { return }

        typealias FocusIMP = @convention(c) (
            AnyObject, Selector, UnsafeRawPointer, Bool, Bool, Bool, AnyObject?) -> Void
        let original = unsafeBitCast(method_getImplementation(method), to: FocusIMP.self)

        let replacement: @convention(block) (
            AnyObject, UnsafeRawPointer, Bool, Bool, Bool, AnyObject?) -> Void = {
            me, node, _, blurPrevious, changingActivity, userObject in
            // Force userIsInteracting to true so the keyboard is allowed to show.
            original(me, selector, node, true, blurPrevious, changingActivity, userObject)
        }
        _ = method_setImplementation(method, imp_implementationWithBlock(replacement))
    }
}
