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
        .package(name: "CapacitorHaptics", path: "../../../../node_modules/.pnpm/@capacitor+haptics@8.0.1_@capacitor+core@8.5.0/node_modules/@capacitor/haptics"),
        .package(name: "CapacitorPreferences", path: "../../../../node_modules/.pnpm/@capacitor+preferences@8.0.1_@capacitor+core@8.5.0/node_modules/@capacitor/preferences"),
        .package(name: "OscodeLlama", path: "../../../../node_modules/.pnpm/oscode-llama@file+app+plugins+oscode-llama_@capacitor+core@8.5.0/node_modules/oscode-llama"),
        .package(name: "OscodeIap", path: "../../../../app/plugins/oscode-iap")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorHaptics", package: "CapacitorHaptics"),
                .product(name: "CapacitorPreferences", package: "CapacitorPreferences"),
                .product(name: "OscodeLlama", package: "OscodeLlama"),
                .product(name: "OscodeIap", package: "OscodeIap")
            ]
        )
    ]
)
