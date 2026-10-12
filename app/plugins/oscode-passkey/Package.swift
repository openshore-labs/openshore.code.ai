// swift-tools-version: 5.9
import PackageDescription

// The native half of the OscodePasskey Capacitor plugin: passkey sign-in for
// openshore.ai through the system AuthenticationServices framework only, so no
// dependency beyond Capacitor. Reached through the Capacitor JS bridge
// (registerPlugin in app/src/lib/passkeys.ts); cap sync lists it in
// CapApp-SPM/Package.swift.
//
// The package and product name are "OscodePasskey": cap sync capitalizes the
// first letter of each hyphen-separated segment of "oscode-passkey" (see the
// note in oscode-authsession/Package.swift for why this matters).
let package = Package(
    name: "OscodePasskey",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "OscodePasskey",
            targets: ["OscodePasskeyPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "OscodePasskeyPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/OscodePasskeyPlugin")
    ]
)
