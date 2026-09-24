import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = ShellViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// The bridge controller with a ground that follows the system appearance.
/// capacitor.config.ts can only name one backgroundColor, so a dark-mode open
/// flashed the cream paper between the launch image and the web splash. This
/// gives the web view the app's --bg in both themes: #f6f4ef light, #17140e
/// dark (the same values as theme.css and the index.html boot splash).
class ShellViewController: CAPBridgeViewController {
    private static let ground = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0x17 / 255.0, green: 0x14 / 255.0, blue: 0x0e / 255.0, alpha: 1)
            : UIColor(red: 0xf6 / 255.0, green: 0xf4 / 255.0, blue: 0xef / 255.0, alpha: 1)
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.backgroundColor = Self.ground
        webView?.scrollView.backgroundColor = Self.ground
    }
}
