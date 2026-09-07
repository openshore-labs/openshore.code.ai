// swift-tools-version: 5.9
import PackageDescription

// The native half of the OscodeAuthSession Capacitor plugin: repo OAuth through
// ASWebAuthenticationSession, from the system AuthenticationServices framework
// only, so no third-party dependency beyond Capacitor. The session runs the
// provider consent in a system sheet and, because it watches for the app's
// oscode:// callback scheme, returns the callback URL straight to the completion
// handler. That means one tap, no "return to the app" bounce page, and no
// deep-link round trip that a memory eviction could drop.
//
// This plugin is reached purely through the Capacitor JS bridge (registerPlugin),
// so nothing imports its Swift module directly and no manual Xcode-project
// linking is needed: cap sync lists it in CapApp-SPM/Package.swift and Capacitor
// discovers it at runtime.
let package = Package(
    name: "OscodeAuthSession",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "OscodeAuthSession",
            targets: ["OscodeAuthSessionPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "OscodeAuthSessionPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/OscodeAuthSessionPlugin")
    ]
)
