import Foundation
import Capacitor
import LocalAuthentication
import UIKit

/// App Lock (founder 2026-10-12, CX ruling Q3; CTO review the same day). The
/// lock uses the device's own unlock only: biometrics with the device passcode
/// as the fallback (LAPolicy.deviceOwnerAuthentication), never an OpenShore
/// passcode, so there is no "forgot passcode" path that would either wipe data
/// or get around the lock.
///
/// The decision to lock on return is made here, not in JS, for two reasons
/// the CTO's review found:
/// - Time away is measured on the system uptime clock, which a person cannot
///   move by changing the device's date and time.
/// - A cover goes over the app the moment it leaves the foreground (so the app
///   switcher's snapshot shows nothing) and, when a return must lock, it stays
///   up until JS has drawn the lock screen and calls reveal(). Taking it down
///   on return and letting JS decide afterwards showed the last screen for a
///   few frames.
/// Only a real trip to the background counts. Our own Face ID sheet, a
/// passkey sheet, or Control Center make the app inactive without leaving, and
/// never lock it.
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
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reveal", returnType: CAPPluginReturnPromise),
    ]

    // Read and written on the main queue only.
    private var lockOn = false
    private var lockAfter: TimeInterval = 60
    private var backgroundedAt: TimeInterval?
    private var holdCover = false
    private var cover: UIView?

    override public func load() {
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(willResign),
                           name: UIApplication.willResignActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(didEnterBackground),
                           name: UIApplication.didEnterBackgroundNotification, object: nil)
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
        default:
            // Optic ID exists from iOS 17; the app supports 16.
            if #available(iOS 17.0, *), context.biometryType == .opticID {
                biometry = "opticID"
            } else {
                biometry = "none"
            }
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

    /// The setting, as JS holds it: on or off, and the seconds away before a
    /// return locks (0, 60, or 900).
    @objc func configure(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        let after = TimeInterval(call.getInt("after") ?? 60)
        DispatchQueue.main.async {
            self.lockOn = on
            self.lockAfter = max(0, after)
            if !on {
                self.holdCover = false
                self.backgroundedAt = nil
                self.removeCover()
            }
            call.resolve()
        }
    }

    /// JS has drawn the lock screen: the cover can come down.
    @objc func reveal(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.holdCover = false
            self.removeCover()
            call.resolve()
        }
    }

    @objc private func willResign() {
        DispatchQueue.main.async {
            guard self.lockOn else { return }
            self.addCover()
        }
    }

    @objc private func didEnterBackground() {
        DispatchQueue.main.async {
            guard self.lockOn else { return }
            self.addCover()
            // Only the first leave counts, so a second notification never
            // restarts the clock.
            if self.backgroundedAt == nil {
                self.backgroundedAt = ProcessInfo.processInfo.systemUptime
            }
        }
    }

    @objc private func didBecomeActive() {
        DispatchQueue.main.async {
            defer { self.backgroundedAt = nil }
            guard self.lockOn, let left = self.backgroundedAt else {
                if !self.holdCover { self.removeCover() }
                return
            }
            let away = ProcessInfo.processInfo.systemUptime - left
            if away >= self.lockAfter {
                // Keep the cover until the lock screen is drawn.
                self.holdCover = true
                self.addCover()
                self.notifyListeners("lockRequired", data: [:])
            } else if !self.holdCover {
                self.removeCover()
            }
        }
    }

    private func addCover() {
        guard cover == nil, let window = bridge?.viewController?.view.window else { return }
        let view = UIView(frame: window.bounds)
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.backgroundColor = UIColor(red: 0x0b / 255, green: 0x14 / 255, blue: 0x17 / 255, alpha: 1)
        window.addSubview(view)
        cover = view
    }

    private func removeCover() {
        cover?.removeFromSuperview()
        cover = nil
    }
}
