// swift-tools-version: 5.9
import PackageDescription

// The native half of the OscodeLlama Capacitor plugin. Inference is llama.cpp
// (Metal) with its media library (mtmd, for a model that reads pictures),
// called directly from LlamaRunner.swift. The prebuilt xcframework comes from
// the official ggml-org release, pinned by build and checksum so CI is
// repeatable. b10068 is the build LLM.swift 3.0.3 shipped (the wrapper this
// replaced, which had no picture path); it carries mtmd.h and the qwen35
// architecture.
let package = Package(
    name: "OscodeLlama",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "OscodeLlama",
            targets: ["OscodeLlamaPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "OscodeLlamaPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                "llama"
            ],
            path: "ios/Sources/OscodeLlamaPlugin"),
        .binaryTarget(
            name: "llama",
            url: "https://github.com/ggml-org/llama.cpp/releases/download/b10068/llama-b10068-xcframework.zip",
            checksum: "5238397dd4ca305c9db537c3ae106948909ba2605e77d2d3463ac2d2ca08cc8a")
    ]
)
