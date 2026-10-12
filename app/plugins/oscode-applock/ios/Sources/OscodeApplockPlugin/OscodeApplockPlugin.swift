import Foundation
import Capacitor
import LocalAuthentication
import UIKit

/// App Lock (founder 2026-10-12, CX ruling Q3). The lock uses the device's own
/// unlock only: biometrics with the device passcode as the fallback
/// (LAPolicy.deviceOwnerAuthentication), never an OpenShore passcode, so there
/// is no "forgot passcode" path that would either wipe data or get around the
/// lock. While the lock is on, a plain cover goes over the app the moment it
/// leaves the foreground, so the app switcher's snapshot shows nothing.
///
/// The lock hides the interface only: work already running keeps running.
///
/// The JS contract lives in app/src/lib/appLock.ts; keep the two in lockstep.
@objc(OscodeApplockPlugin)
public class OscodeApplockPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OscodeApplockPlugin"
    public let jsName = "OscodeAppLock"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unlock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCover", returnType: CAPPluginReturnPromise),
    ]

    private var coverOn = false
    private var cover: UIView?

    override public func load() {
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(willResign),
                           name: UIApplication.willResignActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(didBecomeActive),
                           name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    /// Whether this device can ask for its owner (a passcode is set), and
    /// which biometry it has, for the Settings row's words.
    @objc func status(_ call: CAPPluginCall) {
        let context = LAContext()
        var error: NSError?
        let available = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
        let biometry: String
        switch context.biometryType {
        case .faceID: biometry = "faceID"
        case .touchID: biometry = "touchID"
        case .opticID: biometry = "opticID"
        default: biometry = "none"
        }
        call.resolve(["available": available, "biometry": biometry])
    }

    @objc func unlock(_ call: CAPPluginCall) {
        let reason = call.getString("reason") ?? "Unlock OpenShore"
        let context = LAContext()
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, error in
            if ok {
                call.resolve(["ok": true])
                return
            }
            let code = (error as? LAError)?.code
            if code == .userCancel || code == .appCancel || code == .systemCancel {
                call.reject("Unlock was cancelled.", "canceled")
            } else if code == .passcodeNotSet {
                call.reject("This device has no passcode.", "no_passcode")
            } else {
                call.reject(error?.localizedDescription ?? "Unlock failed.", "failed")
            }
        }
    }

    /// Turn the app switcher cover on or off (on while App Lock is on).
    @objc func setCover(_ call: CAPPluginCall) {
        coverOn = call.getBool("on") ?? false
        if !coverOn { DispatchQueue.main.async { self.removeCover() } }
        call.resolve()
    }

    @objc private func willResign() {
        guard coverOn else { return }
        DispatchQueue.main.async {
            guard self.cover == nil, let window = self.bridge?.viewController?.view.window else { return }
            let view = UIView(frame: window.bounds)
            view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            view.backgroundColor = UIColor(red: 0x0b / 255, green: 0x14 / 255, blue: 0x17 / 255, alpha: 1)
            window.addSubview(view)
            self.cover = view
        }
    }

    @objc private func didBecomeActive() {
        DispatchQueue.main.async { self.removeCover() }
    }

    private func removeCover() {
        cover?.removeFromSuperview()
        cover = nil
    }
}
