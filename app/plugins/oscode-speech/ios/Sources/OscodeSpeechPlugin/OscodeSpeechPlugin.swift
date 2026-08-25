import Foundation
import Capacitor
import Speech
import AVFoundation

/// On-device voice-to-text for the OpenShore composer mic. Recognition runs with
/// requiresOnDeviceRecognition forced on, so mic audio never leaves the phone,
/// which matches the app's "your machine, your keys" posture. If the device or
/// the current language cannot do on-device speech, `available` reports false and
/// the JS side hides the mic rather than falling back to Apple's servers.
///
/// The JS contract lives in app/src/lib/speechPlugin.ts; keep the two in lockstep.
///
/// Events:
///   partial { text, isFinal } as the transcript grows
///   result  { text }          the final transcript for the session
///   error   { message }       a failure or an interruption (call, Siri)
@objc(OscodeSpeechPlugin)
public class OscodeSpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OscodeSpeechPlugin"
    public let jsName = "OscodeSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private let audioEngine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    override public func load() {
        // A phone call or Siri interrupting the audio session must stop dictation
        // cleanly, never leave the tap or session dangling.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: nil)
    }

    // Is on-device recognition usable on this device, in the device language,
    // right now? Both conditions are required; server recognition is never used.
    @objc func available(_ call: CAPPluginCall) {
        let rec = SFSpeechRecognizer()
        let ok = (rec?.isAvailable ?? false) && (rec?.supportsOnDeviceRecognition ?? false)
        call.resolve(["available": ok])
    }

    // Speech authorization AND microphone permission are two separate grants;
    // both are needed and each denial branch is reported, never a dead end.
    @objc func requestPermission(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                call.resolve(["granted": false, "reason": Self.speechReason(status)])
                return
            }
            AVAudioSession.sharedInstance().requestRecordPermission { micGranted in
                call.resolve(["granted": micGranted, "reason": micGranted ? "" : "microphone"])
            }
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
            call.reject("Speech recognition is not authorized.")
            return
        }
        guard let rec = SFSpeechRecognizer(), rec.isAvailable, rec.supportsOnDeviceRecognition else {
            call.reject("On-device speech is not available on this device.")
            return
        }
        recognizer = rec

        // Any prior session goes first, so a double start cannot stack taps.
        stopInternal()

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        // ON-DEVICE ONLY: the audio is transcribed on the phone, never sent out.
        req.requiresOnDeviceRecognition = true
        request = req

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            stopInternal()
            call.reject("Could not start the microphone: \(error.localizedDescription)")
            return
        }

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }
        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            stopInternal()
            call.reject("Could not start audio: \(error.localizedDescription)")
            return
        }

        task = rec.recognitionTask(with: req) { [weak self] result, error in
            guard let self else { return }
            if let result = result {
                let text = result.bestTranscription.formattedString
                self.notifyListeners("partial", data: ["text": text, "isFinal": result.isFinal])
                if result.isFinal {
                    self.notifyListeners("result", data: ["text": text])
                    self.stopInternal()
                }
            }
            if let error = error {
                self.notifyListeners("error", data: ["message": error.localizedDescription])
                self.stopInternal()
            }
        }
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        stopInternal()
        call.resolve()
    }

    private func stopInternal() {
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
        // Release the session so the user's other audio can resume. Leaking an
        // active record session is the classic field bug here.
        try? AVAudioSession.sharedInstance().setActive(
            false, options: .notifyOthersOnDeactivation)
    }

    @objc private func handleInterruption(_ notification: Notification) {
        guard
            let info = notification.userInfo,
            let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw)
        else { return }
        if type == .began {
            stopInternal()
            notifyListeners("error", data: ["message": "Dictation was interrupted."])
        }
    }

    private static func speechReason(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
        switch status {
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        case .authorized: return ""
        @unknown default: return "unknown"
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        stopInternal()
    }
}
