// swift-tools-version: 5.9
import PackageDescription

// The native half of the OscodeTts Capacitor plugin: on-device text-to-speech
// via AVSpeechSynthesizer, from the system frameworks only, so no third-party
// dependency beyond Capacitor. Synthesis runs on the phone, so a spoken reply
// works with no connection and no audio is ever sent out. Voices come from the
// system (including Apple's downloadable enhanced and premium voices), so the
// picker lists what the person has installed rather than a cloud voice roster.
// This plugin is reached purely through the Capacitor JS bridge (registerPlugin),
// so nothing imports its Swift module directly and no manual Xcode-project
// linking is needed: cap sync lists it in CapApp-SPM/Package.swift and Capacitor
// discovers it at runtime.
let package = Package(
    name: "OscodeTts",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "OscodeTts",
            targets: ["OscodeTtsPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "OscodeTtsPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/OscodeTtsPlugin")
    ]
)
