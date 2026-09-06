// swift-tools-version: 5.9
import PackageDescription

// The native half of the OscodeMedia Capacitor plugin. It needs only
// AVFoundation and UIKit, which ship with iOS, so there is no third-party
// dependency to pin beyond Capacitor itself. The JS contract lives in
// app/src/lib/mediaPlugin.ts; keep the two in lockstep.
let package = Package(
    name: "OscodeMedia",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "OscodeMedia",
            targets: ["OscodeMediaPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "OscodeMediaPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/OscodeMediaPlugin")
    ]
)
