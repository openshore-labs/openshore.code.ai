// swift-tools-version: 5.9
import PackageDescription

// The native half of the OscodeIcloud Capacitor plugin. It reaches the app's
// iCloud Drive ubiquity container, which no cross-platform JS API can, and
// reads and writes the Vault's markdown files there under file coordination.
// No third-party dependency: this is Foundation's own ubiquity API.
let package = Package(
    name: "OscodeIcloud",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "OscodeIcloud",
            targets: ["OscodeIcloudPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "OscodeIcloudPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/OscodeIcloudPlugin")
    ]
)
