import Foundation
import Capacitor
import AuthenticationServices
import UIKit

/// Repo OAuth for OpenShore through ASWebAuthenticationSession, the system's
/// purpose-built auth flow. It opens the provider consent page in a system sheet
/// and, because it is told the app's callback scheme, intercepts the return to
/// oscode://repo-oauth and hands the callback URL straight back through the
/// completion handler. So connecting a repo is one tap: no "return to the app"
/// bounce page to press, and no deep-link round trip that an app eviction could
/// drop midway. Nothing but a code and the ephemeral state ever passes through;
/// the client secret stays on the server, exactly as before.
///
/// The JS contract lives in app/src/lib/authSessionPlugin.ts; keep the two in
/// lockstep.
@objc(OscodeAuthSessionPlugin)
public class OscodeAuthSessionPlugin: CAPPlugin, CAPBridgedPlugin,
    ASWebAuthenticationPresentationContextProviding {
    public let identifier = "OscodeAuthSessionPlugin"
    public let jsName = "OscodeAuthSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
    ]

    // A strong reference for the life of the flow. Without it ARC releases the
    // session, the sheet disappears, and the completion handler never fires.
    private var session: ASWebAuthenticationSession?

    // ASWebAuthenticationSession exists on every iOS this app supports (16+), so
    // the one-tap path is always available on a device. The web build reports
    // false and the caller keeps the deep-link path.
    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": true])
    }

    @objc func start(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("A sign-in URL is required.", "invalid_url")
            return
        }
        guard let scheme = call.getString("callbackScheme"), !scheme.isEmpty else {
            call.reject("A callback scheme is required.", "invalid_scheme")
            return
        }
        // Sharing the Safari session (the default) means a person already signed
        // in to the provider is not asked to sign in again. An ephemeral session
        // is available for callers that want an isolated one.
        let ephemeral = call.getBool("ephemeral") ?? false

        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(
                url: url, callbackURLScheme: scheme
            ) { [weak self] callbackURL, error in
                self?.session = nil
                if let error = error {
                    let nsError = error as NSError
                    // The person closed the sheet: a cancel, not a failure. The
                    // JS side turns this code into "Sign-in did not finish."
                    if nsError.domain == ASWebAuthenticationSessionError.errorDomain
                        && nsError.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        call.reject("Sign-in was cancelled.", "canceled")
                    } else {
                        call.reject(error.localizedDescription, "session_failed")
                    }
                    return
                }
                guard let callbackURL = callbackURL else {
                    call.reject("The sign-in returned no address.", "no_url")
                    return
                }
                call.resolve(["url": callbackURL.absoluteString])
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = ephemeral
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("The sign-in could not start.", "start_failed")
            }
        }
    }

    // Present the sheet over the app's own window. Called on the main thread by
    // the system, so it touches UIKit directly.
    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        if let window = bridge?.viewController?.view.window {
            return window
        }
        let keyWindow = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }
        return keyWindow ?? UIWindow()
    }
}
