// swift-tools-version: 5.9
import PackageDescription

// The native half of the OscodeSpeech Capacitor plugin: on-device dictation via
// SFSpeechRecognizer and AVAudioEngine, from the system frameworks only, so no
// third-party dependency beyond Capacitor. Audio never leaves the phone
// (requiresOnDeviceRecognition is forced on the recognition request). This
// plugin is reached purely through the Capacitor JS bridge (registerPlugin), so
// nothing imports its Swift module directly and no manual Xcode-project linking
// is needed: cap sync lists it in CapApp-SPM/Package.swift and Capacitor
// discovers it at runtime.
let package = Package(
    name: "OscodeSpeech",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "OscodeSpeech",
            targets: ["OscodeSpeechPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "OscodeSpeechPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/OscodeSpeechPlugin")
    ]
)
