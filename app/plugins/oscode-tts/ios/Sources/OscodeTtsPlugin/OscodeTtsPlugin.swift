import Foundation
import Capacitor
import AVFoundation

/// On-device text-to-speech for OpenShore voice mode. Synthesis runs through
/// AVSpeechSynthesizer, entirely on the phone, so a reply can be spoken with no
/// connection and no audio ever leaves the device, which matches the app's
/// "your machine, your keys" posture. Voices are the system voices the person
/// has installed, including Apple's downloadable enhanced and premium (neural)
/// voices, so the picker lists real installed voices rather than a cloud roster.
///
/// The JS contract lives in app/src/lib/ttsPlugin.ts; keep the two in lockstep.
///
/// Events (each carries the utteranceId passed to speak, so the JS turn loop can
/// tell which utterance finished):
///   start { utteranceId }                the synthesizer began speaking it
///   done  { utteranceId, cancelled }     it finished, or was stopped
///   error { utteranceId, message }       it could not be spoken
@objc(OscodeTtsPlugin)
public class OscodeTtsPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "OscodeTtsPlugin"
    public let jsName = "OscodeTts"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "voices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private let synthesizer = AVSpeechSynthesizer()
    // The id the JS side gave the utterance now speaking, so start/done events
    // name it. AVSpeechUtterance has no field we can stash it on, so a small map
    // keyed by the utterance object carries it through the delegate callbacks.
    private var utteranceIds: [ObjectIdentifier: String] = [:]

    override public func load() {
        synthesizer.delegate = self
    }

    // TTS is available wherever AVSpeechSynthesizer is (iOS 16+ here) and at
    // least one voice is installed. Unlike dictation there is no server path to
    // avoid, so this is effectively always true on a real device.
    @objc func available(_ call: CAPPluginCall) {
        let ok = !AVSpeechSynthesisVoice.speechVoices().isEmpty
        call.resolve(["available": ok])
    }

    // The installed system voices, so the picker lists exactly what the person
    // has (including any enhanced or premium voices they have downloaded). Newest
    // and highest quality first, so the best voice is the easy pick.
    @objc func voices(_ call: CAPPluginCall) {
        let voices = AVSpeechSynthesisVoice.speechVoices()
            .map { voice -> [String: Any] in
                [
                    "id": voice.identifier,
                    "name": voice.name,
                    "lang": voice.language,
                    "quality": Self.qualityName(voice.quality),
                ]
            }
            .sorted { a, b in
                // Premium and enhanced voices first, then by name, so the list
                // opens on the voices worth choosing.
                let ra = Self.qualityRank(a["quality"] as? String)
                let rb = Self.qualityRank(b["quality"] as? String)
                if ra != rb { return ra > rb }
                return ((a["name"] as? String) ?? "") < ((b["name"] as? String) ?? "")
            }
        call.resolve(["voices": voices])
    }

    @objc func speak(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else {
            call.reject("Nothing to speak.")
            return
        }
        let utteranceId = call.getString("utteranceId") ?? UUID().uuidString

        let utterance = AVSpeechUtterance(string: text)
        if let voiceId = call.getString("voiceId"),
            let voice = AVSpeechSynthesisVoice(identifier: voiceId) {
            utterance.voice = voice
        } else if let voice = AVSpeechSynthesisVoice(language: AVSpeechSynthesisVoice.currentLanguageCode()) {
            utterance.voice = voice
        }
        // rate arrives normalized 0...1 from JS, where 0.5 is the natural default,
        // so one slider reads the same on both platforms. Map it onto the
        // AVSpeechUtterance range with the default anchored at the midpoint.
        utterance.rate = Self.mapRate(call.getDouble("rate"))
        if let pitch = call.getDouble("pitch") {
            utterance.pitchMultiplier = Float(max(0.5, min(2.0, pitch)))
        }

        utteranceIds[ObjectIdentifier(utterance)] = utteranceId

        // Spoken audio that ducks other players and, being playback, is heard
        // even with the ringer switched to silent (what a voice assistant does).
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            utteranceIds[ObjectIdentifier(utterance)] = nil
            call.reject("Could not start audio: \(error.localizedDescription)")
            return
        }

        synthesizer.speak(utterance)
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        // Immediate: a barge-in (the person starting to talk) must cut the reply
        // off now, not at the next word boundary.
        synthesizer.stopSpeaking(at: .immediate)
        call.resolve()
    }

    // MARK: AVSpeechSynthesizerDelegate

    public func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance
    ) {
        notifyListeners("start", data: ["utteranceId": idFor(utterance)])
    }

    public func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance
    ) {
        finish(utterance, cancelled: false)
    }

    public func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance
    ) {
        finish(utterance, cancelled: true)
    }

    private func finish(_ utterance: AVSpeechUtterance, cancelled: Bool) {
        let id = idFor(utterance)
        utteranceIds[ObjectIdentifier(utterance)] = nil
        notifyListeners("done", data: ["utteranceId": id, "cancelled": cancelled])
        // Release the session once nothing else is queued, so the person's music
        // (or the next listen turn's record session) can take over cleanly.
        if !synthesizer.isSpeaking {
            try? AVAudioSession.sharedInstance().setActive(
                false, options: .notifyOthersOnDeactivation)
        }
    }

    private func idFor(_ utterance: AVSpeechUtterance) -> String {
        utteranceIds[ObjectIdentifier(utterance)] ?? ""
    }

    private static func qualityName(_ quality: AVSpeechSynthesisVoiceQuality) -> String {
        switch quality {
        case .premium: return "premium"
        case .enhanced: return "enhanced"
        default: return "default"
        }
    }

    private static func qualityRank(_ name: String?) -> Int {
        switch name {
        case "premium": return 2
        case "enhanced": return 1
        default: return 0
        }
    }

    // 0 -> slowest, 0.5 -> the system default, 1 -> fastest. Piecewise so the
    // default sits exactly at the midpoint of the slider.
    private static func mapRate(_ normalized: Double?) -> Float {
        let n = Float(max(0.0, min(1.0, normalized ?? 0.5)))
        let minR = AVSpeechUtteranceMinimumSpeechRate
        let defR = AVSpeechUtteranceDefaultSpeechRate
        let maxR = AVSpeechUtteranceMaximumSpeechRate
        if n <= 0.5 {
            return minR + (defR - minR) * (n / 0.5)
        }
        return defR + (maxR - defR) * ((n - 0.5) / 0.5)
    }

    deinit {
        synthesizer.stopSpeaking(at: .immediate)
    }
}
