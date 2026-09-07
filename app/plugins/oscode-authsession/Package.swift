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
//
// The package and product name below MUST be exactly "OscodeAuthsession"
// (lowercase "s" in "session"), not the nicer-looking "OscodeAuthSession": cap
// sync derives the name CapApp-SPM looks for by capitalizing only the first
// letter of each hyphen-separated segment of the npm package name
// ("oscode-authsession" has no hyphen inside "authsession", so that whole word
// is one segment, giving "Oscode" plus "Authsession"). A capital "S" here caused
// "product 'OscodeAuthsession' ... not found in package 'OscodeAuthSession'" on
// a real build (2026-09-07). The target name and the Swift plugin's jsName and
// identifier are a separate JS-bridge lookup, unrelated to this SPM product
// name, so those keep their readable casing.
let package = Package(
    name: "OscodeAuthsession",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "OscodeAuthsession",
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
