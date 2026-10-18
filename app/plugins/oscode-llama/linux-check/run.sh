#!/usr/bin/env bash
# Compile the phone's llama runner on Linux and drive it with a real model.
#
#   ./run.sh <weights.gguf> <vision.gguf> <picture> [text the answer must hold]
#
# No Mac runs in CI, so this is how the phone's runner is checked: it builds
# llama.cpp at the build Package.swift pins (CPU, shared libraries with mtmd),
# copies LlamaRunner.swift and PromptFormat.swift, unchanged, beside main.swift
# in a throwaway Swift package, and drives them through the paths a chat takes
# (words, a follow-up, a picture, words after it, unicode, Stop, an unload mid
# reply, thinking, a picture with no vision file), printing PASS or FAIL for
# each. Run it after a change to the runner or the pinned build, and before a
# phone build that changes Harbor's weights. It proves the Swift and llama.cpp,
# not Metal or the Capacitor bridge, which only a device shows.
#
# Needs git, cmake, a C++ compiler and Swift 5.9 or newer (Fedora: sudo dnf
# install swift-lang cmake gcc-c++ git). WORK sets where it builds (default
# ~/.cache/oscode-llama-check).
set -euo pipefail

if [ "$#" -lt 3 ]; then
  sed -n '2,18p' "$0"
  exit 2
fi

here="$(cd "$(dirname "$0")" && pwd)"
plugin="$(dirname "$here")"
work="${WORK:-$HOME/.cache/oscode-llama-check}"
build="$(sed -n 's|.*releases/download/\(b[0-9]*\)/.*|\1|p' "$plugin/Package.swift" | head -1)"
if [ -z "$build" ]; then
  echo "Could not read the llama.cpp build from Package.swift." >&2
  exit 1
fi

mkdir -p "$work"
src="$work/llama.cpp-$build"
if [ ! -d "$src" ]; then
  git clone --quiet --depth 1 --branch "$build" https://github.com/ggml-org/llama.cpp "$src"
fi
lib="$src/build/bin"
if [ ! -e "$lib/libmtmd.so" ]; then
  cmake -S "$src" -B "$src/build" -DBUILD_SHARED_LIBS=ON -DLLAMA_CURL=OFF \
    -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=OFF \
    -DCMAKE_BUILD_TYPE=Release >/dev/null
  cmake --build "$src/build" -j"$(nproc)" --target llama mtmd >/dev/null
fi

pkg="$work/RunnerCheck"
rm -rf "$pkg"
mkdir -p "$pkg/Sources/llama" "$pkg/Sources/RunnerCheck"
cat >"$pkg/Package.swift" <<'EOF'
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "RunnerCheck",
    targets: [
        .systemLibrary(name: "llama", path: "Sources/llama"),
        .executableTarget(name: "RunnerCheck", dependencies: ["llama"], path: "Sources/RunnerCheck"),
    ]
)
EOF
cat >"$pkg/Sources/llama/module.modulemap" <<'EOF'
module llama [system] {
    header "shim.h"
    link "llama"
    link "mtmd"
    export *
}
EOF
printf '#include "llama.h"\n#include "mtmd.h"\n#include "mtmd-helper.h"\n' >"$pkg/Sources/llama/shim.h"
cp "$plugin/ios/Sources/OscodeLlamaPlugin/LlamaRunner.swift" \
  "$plugin/ios/Sources/OscodeLlamaPlugin/PromptFormat.swift" \
  "$here/main.swift" "$pkg/Sources/RunnerCheck/"

swift build --package-path "$pkg" -c release \
  -Xcc -I"$src/include" -Xcc -I"$src/ggml/include" -Xcc -I"$src/tools/mtmd" \
  -Xlinker -L"$lib" -Xlinker -rpath -Xlinker "$lib"
"$pkg/.build/release/RunnerCheck" "$@"
