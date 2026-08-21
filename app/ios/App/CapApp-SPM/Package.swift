// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.0"),
        .package(name: "CapacitorApp", path: "../../../../node_modules/.pnpm/@capacitor+app@8.1.1_@capacitor+core@8.5.0/node_modules/@capacitor/app"),
        .package(name: "CapacitorHaptics", path: "../../../../node_modules/.pnpm/@capacitor+haptics@8.0.1_@capacitor+core@8.5.0/node_modules/@capacitor/haptics"),
        .package(name: "CapacitorPreferences", path: "../../../../node_modules/.pnpm/@capacitor+preferences@8.0.1_@capacitor+core@8.5.0/node_modules/@capacitor/preferences"),
        .package(name: "OscodeIap", path: "../../../../node_modules/.pnpm/oscode-iap@file+app+plugins+oscode-iap_@capacitor+core@8.5.0/node_modules/oscode-iap"),
        .package(name: "OscodeLlama", path: "../../../../node_modules/.pnpm/oscode-llama@file+app+plugins+oscode-llama_@capacitor+core@8.5.0/node_modules/oscode-llama")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorHaptics", package: "CapacitorHaptics"),
                .product(name: "CapacitorPreferences", package: "CapacitorPreferences"),
                .product(name: "OscodeIap", package: "OscodeIap"),
                .product(name: "OscodeLlama", package: "OscodeLlama")
            ]
        )
    ]
)
