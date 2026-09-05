import Foundation
import LLM

/// One loaded model, one generation at a time: the realistic shape of local
/// inference on a phone. Wraps LLM.swift (llama.cpp on Metal). Models ship
/// with embedded chat templates, which LLM.swift reads from the GGUF itself.
///
/// Every piece of bookkeeping (which model, which request, its completion
/// callback) is touched only under `state`, so a load arriving from one chat
/// while another chat's reply streams can never race that reply's completion
/// (UI-1). A load or an unload that interrupts a reply stops it and reports
/// "stopped" to its caller exactly once, so no chat is left waiting forever.
final class LlamaRunner {

    private var llm: LLM?
    private var _loadedId: String?
    private var currentRequestId: String?
    private var currentOnDone: ((_ stopReason: String, _ detail: String?) -> Void)?
    private var stopRequested = false
    /// Guards every field above. Never call out (stop, onDone) while holding it.
    private let state = DispatchQueue(label: "ai.openshore.oscode.llama.state")

    var isLoaded: Bool { state.sync { llm != nil } }
    var loadedId: String? { state.sync { _loadedId } }

    func load(id: String, path: String, contextSize: Int32) -> (ok: Bool, detail: String?) {
        // Whatever was in the slot goes first, and any reply it was writing is
        // ended for its caller before the new weights take the memory.
        unload(reason: "Another model was loaded.")
        guard let model = LLM(from: path, maxTokenCount: contextSize) else {
            return (false, "The model would not load. The file may be incomplete, or too large for this iPhone's memory.")
        }
        state.sync {
            llm = model
            _loadedId = id
        }
        return (true, nil)
    }

    /// Drop the loaded model. A reply in flight is stopped and its caller told
    /// "stopped" with `reason`, once, before the state is cleared.
    func unload(reason: String = "The model was unloaded.") {
        let (model, done) = state.sync { () -> (LLM?, ((String, String?) -> Void)?) in
            let m = llm
            let d = currentOnDone
            llm = nil
            _loadedId = nil
            currentRequestId = nil
            currentOnDone = nil
            stopRequested = false
            return (m, d)
        }
        model?.stop()
        done?("stopped", reason)
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
        guard let last = messages.last, last.role == "user" else {
            onDone("error", "There is nothing to respond to.")
            return false
        }
        // Claim the slot under the lock; the refusal reasons are decided there
        // and reported outside it.
        let claimed: (llm: LLM?, refusal: String?) = state.sync {
            guard let llm else { return (nil, "No model is loaded on this iPhone yet.") }
            guard currentRequestId == nil else {
                return (nil, "A reply is already being written. Stop it first.")
            }
            currentRequestId = requestId
            currentOnDone = onDone
            stopRequested = false
            return (llm, nil)
        }
        guard let llm = claimed.llm else {
            onDone("error", claimed.refusal)
            return false
        }

        if !system.isEmpty { llm.systemPrompt = system }
        llm.history = messages.dropLast().map { message in
            (role: message.role == "user" ? Role.user : Role.bot, content: message.content)
        }
        llm.update = { [weak self] outputDelta in
            guard let self, self.isCurrent(requestId) else { return }
            if let outputDelta, !outputDelta.isEmpty { onDelta(outputDelta) }
        }

        Task { [weak self] in
            await llm.respond(to: last.content)
            guard let self else { return }
            // Finish only if this request still owns the slot. An unload or a
            // load in the meantime already reported "stopped" for it.
            let finish: (reason: String, done: ((String, String?) -> Void)?)? = self.state.sync {
                guard self.currentRequestId == requestId else { return nil }
                let reason = self.stopRequested ? "stopped" : "end"
                let done = self.currentOnDone
                self.currentRequestId = nil
                self.currentOnDone = nil
                self.stopRequested = false
                return (reason, done)
            }
            if let finish { finish.done?(finish.reason, nil) }
        }
        return true
    }

    func stop(requestId: String) {
        let model: LLM? = state.sync {
            guard currentRequestId == requestId else { return nil }
            stopRequested = true
            return llm
        }
        model?.stop()
    }

    private func isCurrent(_ requestId: String) -> Bool {
        state.sync { currentRequestId == requestId }
    }
}
