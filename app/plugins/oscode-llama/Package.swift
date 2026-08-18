// swift-tools-version: 5.9
import PackageDescription

// The native half of the OscodeLlama Capacitor plugin. Inference is LLM.swift,
// which wraps llama.cpp (Metal) and pulls it as a prebuilt xcframework from
// the official ggml-org releases. Pinned to an exact tag so CI is repeatable.
let package = Package(
    name: "OscodeLlama",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "OscodeLlama",
            targets: ["OscodeLlamaPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/eastriverlee/LLM.swift.git", exact: "3.0.3")
    ],
    targets: [
        .target(
            name: "OscodeLlamaPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "LLM", package: "LLM.swift")
            ],
            path: "ios/Sources/OscodeLlamaPlugin")
    ]
)
