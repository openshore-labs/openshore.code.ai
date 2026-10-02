import UIKit
import Capacitor
import WebKit

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
/// gives the web view the app's --bg in both themes: #f6f4ef light, #0b1417
/// dark (the same values as theme.css and the index.html boot splash).
class ShellViewController: CAPBridgeViewController {
    private static let ground = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0x0b / 255.0, green: 0x14 / 255.0, blue: 0x17 / 255.0, alpha: 1)
            : UIColor(red: 0xf6 / 255.0, green: 0xf4 / 255.0, blue: 0xef / 255.0, alpha: 1)
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.backgroundColor = Self.ground
        webView?.scrollView.backgroundColor = Self.ground
        bridge?.registerPluginInstance(OscodeSnapshotPlugin())
    }
}

/// Slack Water's floor (app/src/lib/screenSnapshot.ts, docs/slack-water.md):
/// one picture of the web view as it is on screen, so the ripple that carries
/// a new person from the setup walk to the main chat page can bend the app's
/// own words and buttons the way a pond bends what lies under it. The picture
/// is held in memory for that one transition and never saved or sent anywhere.
@objc(OscodeSnapshotPlugin)
public class OscodeSnapshotPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OscodeSnapshotPlugin"
    public let jsName = "OscodeSnapshot"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capture", returnType: CAPPluginReturnPromise),
    ]

    @objc func capture(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let web = self.bridge?.webView else {
                call.reject("No web view to picture.")
                return
            }
            let config = WKSnapshotConfiguration()
            config.afterScreenUpdates = false
            web.takeSnapshot(with: config) { image, _ in
                guard let image = image else {
                    call.reject("The web view could not be pictured.")
                    return
                }
                // Twice the point size at most: the water blurs the floor's
                // finest detail anyway, and a smaller picture crosses the
                // bridge and decodes faster.
                let format = UIGraphicsImageRendererFormat()
                format.scale = min(2, image.scale)
                format.opaque = true
                let scaled = UIGraphicsImageRenderer(size: image.size, format: format).image { _ in
                    image.draw(in: CGRect(origin: .zero, size: image.size))
                }
                guard let jpeg = scaled.jpegData(compressionQuality: 0.85) else {
                    call.reject("The picture could not be encoded.")
                    return
                }
                call.resolve(["dataUrl": "data:image/jpeg;base64," + jpeg.base64EncodedString()])
            }
        }
    }
}
