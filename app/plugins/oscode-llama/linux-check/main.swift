import Foundation

// The runner check: the phone's own LlamaRunner.swift and PromptFormat.swift,
// compiled on Linux against the same llama.cpp build the iOS framework pins,
// and driven through the paths a chat takes. No Mac runs in CI, so this is how
// a maintainer proves the Swift compiles and the picture path answers before a
// phone build. run.sh builds it; see README.md.
//
// Arguments: <weights.gguf> <vision.gguf> <picture> [text the answer must hold]

let args = CommandLine.arguments
guard args.count >= 4 else {
    print("usage: RunnerCheck <weights.gguf> <vision.gguf> <picture> [expected text]")
    exit(2)
}
let expected = args.count > 4 ? args[4] : nil
let runner = LlamaRunner()
let sampling = LlamaRunner.Sampling(
    temperature: 0.7, topK: 20, topP: 0.8, minP: 0, repeatPenalty: 1.05, penaltyLastN: 64)
let system = "You are Harbor, a coding model running on the person's phone. Answer briefly."
var failures = 0

func check(_ name: String, _ ok: Bool, _ detail: String = "") {
    print("\(ok ? "PASS" : "FAIL")  \(name)\(detail.isEmpty ? "" : "  (\(detail))")")
    if !ok { failures += 1 }
}

/// One reply, waited for: its text, how it ended, and how many times it ended.
final class Reply: @unchecked Sendable {
    var text = ""
    var reason = ""
    var detail: String?
    var ends = 0
    let done = DispatchSemaphore(value: 0)
    let lock = NSLock()
}

func ask(
    _ id: String, _ turns: [ChatTurn], maxTokens: Int = 200, thinking: Bool = false, thinkBudget: Int = 0,
    after: ((Reply) -> Void)? = nil
) -> Reply {
    let reply = Reply()
    let started = Date()
    let ok = runner.generate(
        requestId: id, system: system, turns: turns, maxTokens: maxTokens, sampling: sampling,
        thinking: thinking, thinkBudget: thinkBudget,
        onDelta: { delta in
            reply.lock.lock()
            let first = reply.text.isEmpty
            reply.text += delta
            reply.lock.unlock()
            if first { after?(reply) }
        },
        onDone: { reason, detail in
            reply.lock.lock()
            reply.reason = reason
            reply.detail = detail
            reply.ends += 1
            reply.lock.unlock()
            reply.done.signal()
        })
    if ok { _ = reply.done.wait(timeout: .now() + 600) }
    // A second end would arrive within this beat.
    Thread.sleep(forTimeInterval: 0.3)
    let seconds = String(format: "%.1f", Date().timeIntervalSince(started))
    print("--- \(id) [\(reply.reason)\(reply.detail.map { ": \($0)" } ?? ""), \(seconds)s]\n\(reply.text)\n")
    return reply
}

let load = runner.load(id: "harbor", path: args[1], visionPath: args[2], contextSize: 8192)
check("loads the weights", load.ok, load.detail ?? "")
guard load.ok else { exit(1) }
let picture = try Data(contentsOf: URL(fileURLWithPath: args[3]))

// 1. Words only, then a follow-up that reuses the context's prefix.
let first = ask("text", [ChatTurn(role: "user", content: "Write a JavaScript function that reverses a string.", images: [])])
check("a reply in words ends cleanly", first.reason == "end" && !first.text.isEmpty)
check("no thought leaks while thinking is off", !first.text.contains("<think>") && !first.text.contains("</think>"))
let follow = ask("follow-up", [
    ChatTurn(role: "user", content: "Write a JavaScript function that reverses a string.", images: []),
    ChatTurn(role: "assistant", content: first.text, images: []),
    ChatTurn(role: "user", content: "Now make it handle emoji correctly.", images: []),
])
check("a follow-up ends cleanly", follow.reason == "end" && !follow.text.isEmpty)

// 2. A picture, then words after it (the context starts over both times).
let seen = ask("picture", [ChatTurn(role: "user", content: "What does this picture show? Quote any text in it exactly.", images: [picture])], maxTokens: 300)
check("a picture is read", seen.reason == "end" && !seen.text.isEmpty, seen.detail ?? "")
if let expected {
    check("the answer quotes the picture", seen.text.localizedCaseInsensitiveContains(expected), expected)
}
let after = ask("after-picture", [ChatTurn(role: "user", content: "Say hello in one word.", images: [])], maxTokens: 20)
check("words after a picture end cleanly", after.reason == "end" && !after.text.isEmpty)

// 3. Unicode comes through whole.
let unicode = ask("unicode", [ChatTurn(role: "user", content: "Repeat exactly: café 🚢 naïve", images: [])], maxTokens: 30)
check("unicode streams whole", unicode.text.contains("café") && unicode.text.contains("🚢") && !unicode.text.contains("\u{FFFD}"))

// 4. Stop ends the reply once, as stopped.
let stopped = ask("stop", [ChatTurn(role: "user", content: "Count from 1 to 500, one number per line.", images: [])], maxTokens: 2000) { _ in
    runner.stop(requestId: "stop")
}
check("Stop ends the reply as stopped, once", stopped.reason == "stopped" && stopped.ends == 1)

// 5. An unload mid-reply ends it once, as stopped, and a fresh load answers.
let unloaded = ask("unload", [ChatTurn(role: "user", content: "Count from 1 to 500, one number per line.", images: [])], maxTokens: 2000) { _ in
    DispatchQueue.global().async { runner.unload(reason: "test unload") }
}
check("an unload ends the reply as stopped, once", unloaded.reason == "stopped" && unloaded.ends == 1)
let reload = runner.load(id: "harbor", path: args[1], visionPath: args[2], contextSize: 8192)
check("loads again after an unload", reload.ok)
let again = ask("again", [ChatTurn(role: "user", content: "Say hello in one word.", images: [])], maxTokens: 20)
check("answers after the reload", again.reason == "end" && !again.text.isEmpty)

// 6. With thinking on, a model with a thinking switch thinks first.
let thought = ask("thinking", [ChatTurn(role: "user", content: "What is 17 times 23?", images: [])], maxTokens: 1500, thinking: true)
check("thinking on ends cleanly", thought.reason == "end" && !thought.text.isEmpty)
check("thinking on opens the thought with its tag", thought.text.hasPrefix(PromptFormat.openThought))
print("note: thinking on \(thought.text.contains(PromptFormat.thoughtEnd) ? "closed its thought" : "did not close its thought within the shared cap")")

// 6b. A coding request's thought is capped: at its budget the runner closes
// it, and the answer still gets its own room.
let capped = ask(
    "thought budget",
    [ChatTurn(role: "user", content: "Write a JavaScript function camelCase(s) that turns 'hello world-foo_bar' into 'helloWorldFooBar'.", images: [])],
    maxTokens: 400, thinking: true, thinkBudget: 64)
let afterThought = capped.text.components(separatedBy: PromptFormat.thoughtEnd).last ?? ""
check("a budgeted thought is cut at its budget", capped.text.contains(PromptFormat.thoughtCutoff))
check("the answer follows a cut thought", capped.reason == "end" && afterThought.contains("camelCase"))

// 7. A model without a vision file says so for a picture.
_ = runner.load(id: "harbor", path: args[1], visionPath: nil, contextSize: 8192)
let blind = ask("no-vision", [ChatTurn(role: "user", content: "What is this?", images: [picture])])
check("no vision file is an honest error", blind.reason == "error" && blind.detail == LlamaRunner.visionMissing)

print(failures == 0 ? "\nALL PASS" : "\n\(failures) FAILED")
exit(failures == 0 ? 0 : 1)
