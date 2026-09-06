import Foundation
import Capacitor
import AVFoundation
import UIKit

/// The Capacitor bridge for native video framing. A model never receives a
/// video; it receives the video's frames. This plugin compresses a large clip
/// into the size band with AVAssetExportSession (its fileLengthLimit does the
/// work), then samples it into stills with AVAssetImageGenerator, downscaled
/// and JPEG-encoded so each frame is a small image block. The JS contract is in
/// app/src/lib/mediaPlugin.ts; keep the two in lockstep.
@objc(OscodeMediaPlugin)
public class OscodeMediaPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OscodeMediaPlugin"
    public let jsName = "OscodeMedia"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "processVideo", returnType: CAPPluginReturnPromise)
    ]

    @objc func isAvailable(_ call: CAPPluginCall) {
        // AVFoundation is always present on iOS 16+, the plugin's floor.
        call.resolve(["available": true])
    }

    @objc func processVideo(_ call: CAPPluginCall) {
        guard let pathArg = call.getString("path") else {
            call.reject("processVideo needs a path.")
            return
        }
        let maxFrames = max(1, call.getInt("maxFrames") ?? 12)
        let maxDimension = CGFloat(max(64, call.getInt("maxDimension") ?? 768))
        let frameQuality = CGFloat(call.getDouble("frameQuality") ?? 0.7)
        let compressThreshold = Int64(call.getDouble("compressThresholdBytes") ?? 0)
        let targetMax = Int64(call.getDouble("targetMaxBytes") ?? 0)

        let sourceURL = Self.fileURL(from: pathArg)

        // Everything below can block (an export, decoding frames), so run it off
        // the plugin's dispatch queue.
        DispatchQueue.global(qos: .userInitiated).async {
            let originalBytes = Self.fileSize(sourceURL)
            let asset = AVURLAsset(url: sourceURL)
            let durationSec = CMTimeGetSeconds(asset.duration)
            guard durationSec.isFinite, durationSec >= 0 else {
                call.reject("That video could not be read.")
                return
            }

            // Compress first when the clip is over the threshold and there is a
            // ceiling to aim under. The exported file is what gets framed.
            var framingURL = sourceURL
            var outputBytes = originalBytes
            var compressed = false
            var tempURL: URL?
            if originalBytes > compressThreshold, compressThreshold > 0, targetMax > 0 {
                if let out = Self.compress(asset: asset, fileLengthLimit: targetMax) {
                    framingURL = out
                    tempURL = out
                    outputBytes = Self.fileSize(out)
                    compressed = true
                }
            }

            let framingAsset = compressed ? AVURLAsset(url: framingURL) : asset
            let frames = Self.extractFrames(
                asset: framingAsset,
                durationSec: durationSec,
                maxFrames: maxFrames,
                maxDimension: maxDimension,
                quality: frameQuality
            )

            if let tempURL { try? FileManager.default.removeItem(at: tempURL) }

            guard !frames.isEmpty else {
                call.reject("No frames could be read from that video.")
                return
            }

            call.resolve([
                "frames": frames,
                "durationSec": durationSec,
                "originalBytes": originalBytes,
                "outputBytes": outputBytes,
                "compressed": compressed
            ])
        }
    }

    // MARK: - compression

    /// Export the asset under a byte ceiling. AVAssetExportSession's
    /// fileLengthLimit makes the encoder trade quality down until it fits, which
    /// is exactly the "land it under 29MB" job. Audio is kept out of the export
    /// since only frames are used downstream. Synchronous via a semaphore; the
    /// caller is already on a background queue.
    private static func compress(asset: AVAsset, fileLengthLimit: Int64) -> URL? {
        let preset = AVAssetExportSession.exportPresets(compatibleWith: asset)
            .contains(AVAssetExportPreset1280x720)
            ? AVAssetExportPreset1280x720
            : AVAssetExportPresetMediumQuality
        guard let session = AVAssetExportSession(asset: asset, presetName: preset) else {
            return nil
        }
        let out = FileManager.default.temporaryDirectory
            .appendingPathComponent("oscode-media-\(UUID().uuidString).mp4")
        session.outputURL = out
        session.outputFileType = .mp4
        session.fileLengthLimit = fileLengthLimit
        session.shouldOptimizeForNetworkUse = true

        let done = DispatchSemaphore(value: 0)
        session.exportAsynchronously { done.signal() }
        done.wait()

        if session.status == .completed, FileManager.default.fileExists(atPath: out.path) {
            return out
        }
        try? FileManager.default.removeItem(at: out)
        return nil
    }

    // MARK: - frames

    /// Evenly spaced sample times, taken at the midpoint of each slice so the
    /// first and last frames are never a black lead-in or tail. Mirrors
    /// planFrameTimes in app/src/lib/videoAttach.ts.
    private static func planTimes(_ duration: Double, _ maxFrames: Int) -> [Double] {
        if duration <= 0 { return [0] }
        let byPace = Int(ceil(duration / 1.5))
        let n = min(max(1, maxFrames), max(1, byPace))
        return (0..<n).map { duration * (Double($0) + 0.5) / Double(n) }
    }

    private static func extractFrames(
        asset: AVAsset,
        durationSec: Double,
        maxFrames: Int,
        maxDimension: CGFloat,
        quality: CGFloat
    ) -> [[String: Any]] {
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: maxDimension, height: maxDimension)
        // A small tolerance keeps decoding cheap while staying close to the mark.
        generator.requestedTimeToleranceBefore = CMTime(seconds: 0.2, preferredTimescale: 600)
        generator.requestedTimeToleranceAfter = CMTime(seconds: 0.2, preferredTimescale: 600)

        var frames: [[String: Any]] = []
        for t in planTimes(durationSec, maxFrames) {
            let time = CMTime(seconds: t, preferredTimescale: 600)
            var actual = CMTime.zero
            guard let cg = try? generator.copyCGImage(at: time, actualTime: &actual) else {
                continue
            }
            let image = UIImage(cgImage: cg)
            guard let data = image.jpegData(compressionQuality: max(0.1, min(1.0, quality))) else {
                continue
            }
            let stamp = CMTimeGetSeconds(actual)
            frames.append([
                "base64": data.base64EncodedString(),
                "mediaType": "image/jpeg",
                "timeSec": (stamp.isFinite ? stamp : t)
            ])
        }
        return frames
    }

    // MARK: - helpers

    private static func fileURL(from path: String) -> URL {
        if path.hasPrefix("file://"), let u = URL(string: path) { return u }
        if let u = URL(string: path), u.scheme != nil { return u }
        return URL(fileURLWithPath: path)
    }

    private static func fileSize(_ url: URL) -> Int64 {
        let values = try? url.resourceValues(forKeys: [.fileSizeKey])
        return Int64(values?.fileSize ?? 0)
    }
}
