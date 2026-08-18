import Foundation
import LLM

/// One loaded model, one generation at a time: the realistic shape of local
/// inference on a phone. Wraps LLM.swift (llama.cpp on Metal). Models ship
/// with embedded chat templates, which LLM.swift reads from the GGUF itself.
final class LlamaRunner {

    private var llm: LLM?
    private(set) var loadedId: String?
    private var currentRequestId: String?
    private var stopRequested = false

    var isLoaded: Bool { llm != nil }

    func load(id: String, path: String, contextSize: Int32) -> (ok: Bool, detail: String?) {
        unload()
        guard let model = LLM(from: path, maxTokenCount: contextSize) else {
            return (false, "The model would not load. The file may be incomplete, or too large for this iPhone's memory.")
        }
        llm = model
        loadedId = id
        return (true, nil)
    }

    func unload() {
        llm?.stop()
        llm = nil
        loadedId = nil
        currentRequestId = nil
    }

    /// Streams a reply. `messages` is the whole visible conversation; the last
    /// user message is the live input, everything before it becomes history.
    func generate(
        requestId: String,
        system: String,
        messages: [(role: String, content: String)],
        onDelta: @escaping (String) -> Void,
        onDone: @escaping (_ stopReason: String, _ detail: String?) -> Void
    ) -> Bool {
        guard let llm else {
            onDone("error", "No model is loaded on this iPhone yet.")
            return false
        }
        guard currentRequestId == nil else {
            onDone("error", "A reply is already being written. Stop it first.")
            return false
        }
        guard let last = messages.last, last.role == "user" else {
            onDone("error", "There is nothing to respond to.")
            return false
        }

        currentRequestId = requestId
        stopRequested = false

        if !system.isEmpty { llm.systemPrompt = system }
        llm.history = messages.dropLast().map { message in
            (role: message.role == "user" ? Role.user : Role.bot, content: message.content)
        }
        llm.update = { [weak self] outputDelta in
            guard let self, self.currentRequestId == requestId else { return }
            if let outputDelta, !outputDelta.isEmpty { onDelta(outputDelta) }
        }

        Task { [weak self] in
            await llm.respond(to: last.content)
            guard let self, self.currentRequestId == requestId else { return }
            let reason = self.stopRequested ? "stopped" : "end"
            self.currentRequestId = nil
            onDone(reason, nil)
        }
        return true
    }

    func stop(requestId: String) {
        guard currentRequestId == requestId else { return }
        stopRequested = true
        llm?.stop()
    }
}
