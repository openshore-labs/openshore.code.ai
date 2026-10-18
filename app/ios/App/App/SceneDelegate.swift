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
        bridge?.registerPluginInstance(OscodePastePlugin())
    }

    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        return ShellWebView(frame: frame, configuration: configuration)
    }
}

/// The web view, able to paste a picture into the composer. WebKit offers
/// Paste in a plain text field only when the clipboard holds text, so a copied
/// screenshot could never be pasted into the chat: the menu had no Paste and
/// Command-V did nothing. While the composer is focused (it says so through
/// OscodePaste.setTarget) and the clipboard holds images and no text, Paste
/// is offered here, and pasting hands the images to the composer, which shows
/// each one as a thumbnail chip the way a picked photo shows. Text, and
/// anything pasted outside the composer, goes through WebKit as before.
/// Checking for images (`hasImages`) reads nothing; the images are read only
/// on the person's own Paste.
class ShellWebView: WKWebView {
    private var pastesImages: Bool {
        let board = UIPasteboard.general
        return OscodePastePlugin.composerFocused && board.hasImages && !board.hasStrings
    }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(UIResponderStandardEditActions.paste(_:)) && pastesImages {
            return true
        }
        return super.canPerformAction(action, withSender: sender)
    }

    override func paste(_ sender: Any?) {
        guard pastesImages, let images = UIPasteboard.general.images, !images.isEmpty else {
            super.paste(sender)
            return
        }
        OscodePastePlugin.deliver(images)
    }
}

/// The composer's side of pasting a picture (app/src/lib/nativePaste.ts):
/// `setTarget` while the composer is focused, and an `images` event carrying
/// each pasted image as a JPEG no longer than 2048 on its long side (the
/// composer's own IMAGE_MAX_DIM), so a full-resolution screenshot crosses the
/// bridge small. Nothing is saved; the images live in the composer until sent
/// or removed.
@objc(OscodePastePlugin)
public class OscodePastePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OscodePastePlugin"
    public let jsName = "OscodePaste"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setTarget", returnType: CAPPluginReturnPromise),
    ]

    static var composerFocused = false
    private static weak var live: OscodePastePlugin?
    private static let maxSide: CGFloat = 2048
    private static let maxImages = 10

    override public func load() {
        Self.live = self
    }

    @objc func setTarget(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            Self.composerFocused = on
            call.resolve()
        }
    }

    static func deliver(_ images: [UIImage]) {
        guard let plugin = live else { return }
        let picked = Array(images.prefix(maxImages))
        DispatchQueue.global(qos: .userInitiated).async {
            let urls: [String] = picked.compactMap { image in
                let size = image.size
                let scale = min(1, maxSide / max(size.width, size.height, 1))
                let target = CGSize(width: max(1, (size.width * scale).rounded()),
                                    height: max(1, (size.height * scale).rounded()))
                let format = UIGraphicsImageRendererFormat()
                format.scale = 1
                format.opaque = true
                let drawn = UIGraphicsImageRenderer(size: target, format: format).image { ctx in
                    UIColor.white.setFill()
                    ctx.fill(CGRect(origin: .zero, size: target))
                    image.draw(in: CGRect(origin: .zero, size: target))
                }
                guard let jpeg = drawn.jpegData(compressionQuality: 0.9) else { return nil }
                return "data:image/jpeg;base64," + jpeg.base64EncodedString()
            }
            guard !urls.isEmpty else { return }
            DispatchQueue.main.async {
                plugin.notifyListeners("images", data: ["dataUrls": urls])
            }
        }
    }
}

/// Slack Water's floor (app/src/lib/screenSnapshot.ts, docs/design/slack-water.md):
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
