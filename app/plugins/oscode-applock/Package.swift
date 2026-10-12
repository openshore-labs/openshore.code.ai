// swift-tools-version: 5.9
import PackageDescription

// The native half of the OscodeAppLock Capacitor plugin: the device's own
// unlock through LocalAuthentication, and a cover over the app switcher's
// snapshot, from system frameworks only. Reached through the Capacitor JS
// bridge (registerPlugin in app/src/lib/appLock.ts).
//
// The package and product name are "OscodeApplock" (lowercase "l"): cap sync
// capitalizes only the first letter of each hyphen-separated segment of
// "oscode-applock" (see oscode-authsession/Package.swift). The target and the
// Swift jsName keep their readable casing; they are a separate lookup.
let package = Package(
    name: "OscodeApplock",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "OscodeApplock",
            targets: ["OscodeApplockPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "OscodeApplockPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/OscodeApplockPlugin")
    ]
)
