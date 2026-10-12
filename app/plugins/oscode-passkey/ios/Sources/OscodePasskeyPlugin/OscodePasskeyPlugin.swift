import Foundation
import Capacitor
import AuthenticationServices
import UIKit

/// Passkeys for OpenShore sign-in (founder, CTO 2026-10-12). The relying party
/// is openshore.ai; only a native ceremony can speak for it from inside the
/// app, because the WebView's own origin is capacitor://localhost. The app
/// must carry the webcredentials:openshore.ai associated domain, and
/// https://openshore.ai/.well-known/apple-app-site-association must name this
/// app (docs/passwordless-runbook.md); without them the system refuses the
/// request and this plugin says so.
///
/// User verification is required (Face ID, Touch ID, or the device passcode),
/// whatever the server would accept. Every binary field crosses the bridge as
/// base64url, the way WebAuthn's JSON spells it.
///
/// The JS contract lives in app/src/lib/passkeys.ts; keep the two in lockstep.
@objc(OscodePasskeyPlugin)
public class OscodePasskeyPlugin: CAPPlugin, CAPBridgedPlugin,
    ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "OscodePasskeyPlugin"
    public let jsName = "OscodePasskey"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "register", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "assert", returnType: CAPPluginReturnPromise),
    ]

    // One ceremony at a time, held for its life so ARC keeps the controller.
    // Main queue only (see run).
    private var pending: CAPPluginCall?
    private var controller: ASAuthorizationController?

    // Platform passkeys exist on every iOS this app supports (16+).
    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": true])
    }

    @objc func register(_ call: CAPPluginCall) {
        guard let rpId = call.getString("rpId"), rpId == "openshore.ai",
              let challenge = call.getString("challenge").flatMap(Self.decode),
              let userId = call.getString("userId").flatMap(Self.decode),
              let userName = call.getString("userName"), !userName.isEmpty else {
            call.reject("The passkey request was not complete.", "invalid_options")
            return
        }
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)
        let request = provider.createCredentialRegistrationRequest(
            challenge: challenge, name: userName, userID: userId)
        request.userVerificationPreference = .required
        if #available(iOS 17.4, *) {
            let exclude = (call.getArray("exclude", String.self) ?? []).compactMap(Self.decode)
            request.excludedCredentials = exclude.map {
                ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0)
            }
        }
        run(request, for: call)
    }

    @objc func assert(_ call: CAPPluginCall) {
        guard let rpId = call.getString("rpId"), rpId == "openshore.ai",
              let challenge = call.getString("challenge").flatMap(Self.decode) else {
            call.reject("The passkey request was not complete.", "invalid_options")
            return
        }
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)
        let request = provider.createCredentialAssertionRequest(challenge: challenge)
        request.userVerificationPreference = .required
        run(request, for: call)
    }

    // `pending` and `controller` are read and written on the main queue only:
    // the bridge calls in on its own queue, and the delegate answers on main.
    private func run(_ request: ASAuthorizationRequest, for call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.pending != nil {
                call.reject("A passkey request is already open.", "busy")
                return
            }
            self.pending = call
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.controller = controller
            controller.performRequests()
        }
    }

    // Called from the delegate, on main.
    private func finish() -> CAPPluginCall? {
        let call = pending
        pending = nil
        controller = nil
        return call
    }

    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        guard let call = finish() else { return }
        if let made = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration {
            guard let attestation = made.rawAttestationObject else {
                call.reject("The passkey came back without its public key.", "no_attestation")
                return
            }
            call.resolve([
                "id": Self.encode(made.credentialID),
                "clientDataJSON": Self.encode(made.rawClientDataJSON),
                "attestationObject": Self.encode(attestation),
            ])
            return
        }
        if let proof = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion {
            var out: [String: Any] = [
                "id": Self.encode(proof.credentialID),
                "clientDataJSON": Self.encode(proof.rawClientDataJSON),
                "authenticatorData": Self.encode(proof.rawAuthenticatorData),
                "signature": Self.encode(proof.signature),
            ]
            if !proof.userID.isEmpty { out["userHandle"] = Self.encode(proof.userID) }
            call.resolve(out)
            return
        }
        call.reject("The passkey answer was not one this app asked for.", "unexpected")
    }

    public func authorizationController(
        controller: ASAuthorizationController, didCompleteWithError error: Error
    ) {
        guard let call = finish() else { return }
        let nsError = error as NSError
        if nsError.domain == ASAuthorizationError.errorDomain
            && nsError.code == ASAuthorizationError.canceled.rawValue {
            call.reject("The passkey was cancelled.", "canceled")
        } else {
            call.reject(error.localizedDescription, "passkey_failed")
        }
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        if Thread.isMainThread, let window = bridge?.viewController?.view.window {
            return window
        }
        return ASPresentationAnchor()
    }

    // base64url, no padding, as WebAuthn's JSON spells binary fields.
    static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func decode(_ text: String) -> Data? {
        var s = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while s.count % 4 != 0 { s += "=" }
        return Data(base64Encoded: s)
    }
}
