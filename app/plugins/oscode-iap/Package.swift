// swift-tools-version: 5.9
import PackageDescription

// The native half of the OscodeIap Capacitor plugin. StoreKit 2 handles the
// auto-renewable Personal subscription entirely from the system framework, so
// there are no third-party dependencies here beyond Capacitor itself.
let package = Package(
    name: "OscodeIap",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "OscodeIap",
            targets: ["OscodeIapPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "OscodeIapPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/OscodeIapPlugin")
    ]
)
