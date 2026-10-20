import Foundation
import llama

/// One loaded model, one generation at a time: the realistic shape of local
/// inference on a phone. Talks to llama.cpp (Metal) directly, with its media
/// library (mtmd) for a model that reads pictures: such a model ships a second
/// file, its vision file, opened the first time a picture arrives so a text
/// chat never pays its memory.
///
/// Every piece of bookkeeping (which model, which request, its completion
/// callback) is touched only under `state`, so a load arriving from one chat
/// while another chat's reply streams can never race that reply's completion
/// (UI-1). A load or an unload that interrupts a reply stops it and reports
/// "stopped" to its caller exactly once, so no chat is left waiting forever.
/// Every llama.cpp call runs on `work`, one at a time, so a reply, a load and
/// the freeing of a model never touch the same memory at once.
final class LlamaRunner {

    /// How a reply picks each next word. The JS side sends a model's own
    /// recommended values; these defaults are for a caller that sends none.
    struct Sampling {
        var temperature: Float = 0.8
        var topK: Int32 = 40
        var topP: Float = 0.95
        var minP: Float = 0
        var repeatPenalty: Float = 1.1
        var penaltyLastN: Int32 = 64
    }

    /// The most tokens one picture may take in the window. A Qwen vision model
    /// sizes a picture by its pixels, and a full-size photo would fill a phone's
    /// window by itself; at this cap a picture reads at about 700 pixels a side.
    static let imageMaxTokens: Int32 = 512

    private var _loadedId: String?
    private var currentRequestId: String?
    private var currentOnDone: ((_ stopReason: String, _ detail: String?) -> Void)?
    private var stopRequested = false
    /// Guards every field above. Never call out (stop, onDone) while holding it.
    private let state = DispatchQueue(label: "ai.openshore.oscode.llama.state")

    /// Owns everything below: every llama.cpp call runs here.
    private let work = DispatchQueue(label: "ai.openshore.oscode.llama.work", qos: .userInitiated)
    private var model: OpaquePointer?
    private var context: OpaquePointer?
    private var vocab: OpaquePointer?
    private var template: String?
    private var visionPath: String?
    private var vision: OpaquePointer?
    private let batchSize: Int32 = 512
    /// The tokens the context holds, for a text conversation, so the next reply
    /// decodes only what is new after them (a model whose memory cannot be
    /// trimmed starts over instead).
    private var cached: [llama_token] = []
    /// The context holds a conversation that is not in `cached` (one with
    /// pictures), so the next reply starts from an empty context.
    private var memoryDirty = false

    /// Read by llama.cpp mid-decode, from the work thread, so a Stop or an
    /// unload does not wait out a long prompt.
    private let abortLock = NSLock()
    private var abortDecode = false

    /// What one reply took, for a test build's timing line: the prompt read,
    /// the thought, and the answer, each in tokens and seconds.
    struct ReplyStats {
        var promptTokens = 0
        var promptSeconds = 0.0
        var thoughtTokens = 0
        var thoughtSeconds = 0.0
        var answerTokens = 0
        var answerSeconds = 0.0
    }

    private static let backend: Void = { llama_backend_init() }()

    private static let threads: Int32 = {
        Int32(max(2, min(4, ProcessInfo.processInfo.activeProcessorCount - 2)))
    }()

    var isLoaded: Bool { state.sync { _loadedId != nil } }
    var loadedId: String? { state.sync { _loadedId } }

    /// The words for a picture this model cannot read: it has no vision file,
    /// or the file would not open.
    static let visionMissing =
        "This model cannot read images on this iPhone. Send the message without the picture, or download the model again from Settings."

    func load(id: String, path: String, visionPath: String?, contextSize: Int32) -> (ok: Bool, detail: String?) {
        // Whatever was in the slot goes first, and any reply it was writing is
        // ended for its caller before the new weights take the memory.
        unload(reason: "Another model was loaded.")
        return work.sync { () -> (ok: Bool, detail: String?) in
            _ = LlamaRunner.backend
            setAbort(false)
            var modelParams = llama_model_default_params()
            #if targetEnvironment(simulator)
            modelParams.n_gpu_layers = 0
            #else
            modelParams.n_gpu_layers = 999
            #endif
            guard let loaded = llama_model_load_from_file(path, modelParams) else {
                return (false, "The model would not load. The file may be incomplete, or too large for this iPhone's memory.")
            }
            var params = llama_context_default_params()
            params.n_ctx = UInt32(max(512, contextSize))
            params.n_batch = UInt32(batchSize)
            params.n_ubatch = UInt32(batchSize)
            params.n_threads = LlamaRunner.threads
            params.n_threads_batch = LlamaRunner.threads
            params.abort_callback = { data in
                guard let data else { return false }
                return Unmanaged<LlamaRunner>.fromOpaque(data).takeUnretainedValue().shouldAbort()
            }
            params.abort_callback_data = Unmanaged.passUnretained(self).toOpaque()
            guard let made = llama_init_from_model(loaded, params) else {
                llama_model_free(loaded)
                return (false, "The model would not start. This iPhone may be short on free memory right now. Close other apps and try again.")
            }
            model = loaded
            context = made
            vocab = llama_model_get_vocab(loaded)
            template = llama_model_chat_template(loaded, nil).map { String(cString: $0) }
            self.visionPath = visionPath
            cached = []
            memoryDirty = false
            state.sync { _loadedId = id }
            return (true, nil)
        }
    }

    /// Drop the loaded model. A reply in flight is stopped and its caller told
    /// "stopped" with `reason`, once, before the state is cleared; the memory
    /// is freed on the work queue as soon as that reply lets go of it.
    func unload(reason: String = "The model was unloaded.") {
        let done = state.sync { () -> ((String, String?) -> Void)? in
            let d = currentOnDone
            _loadedId = nil
            currentRequestId = nil
            currentOnDone = nil
            stopRequested = false
            return d
        }
        setAbort(true)
        done?("stopped", reason)
        work.async { [self] in freeModel() }
    }

    /// Streams a reply. `turns` is the whole visible conversation; the last
    /// turn is the person's, and its pictures (and any earlier ones the JS side
    /// kept) go to the vision file. With thinking on and a `thinkBudget`, the
    /// thought may take that many tokens before the runner closes it with
    /// `PromptFormat.thoughtCutoff`, and `maxTokens` caps the answer alone;
    /// without a budget the thought shares `maxTokens`.
    func generate(
        requestId: String,
        system: String,
        turns: [ChatTurn],
        maxTokens: Int,
        sampling: Sampling,
        thinking: Bool,
        thinkBudget: Int = 0,
        onDelta: @escaping (String) -> Void,
        onStats: ((ReplyStats) -> Void)? = nil,
        onDone: @escaping (_ stopReason: String, _ detail: String?) -> Void
    ) -> Bool {
        guard let last = turns.last, last.role == "user" else {
            onDone("error", "There is nothing to respond to.")
            return false
        }
        // Claim the slot under the lock; the refusal reasons are decided there
        // and reported outside it.
        let refusal: String? = state.sync {
            guard _loadedId != nil else { return "No model is loaded on this iPhone yet." }
            guard currentRequestId == nil else { return "A reply is already being written. Stop it first." }
            currentRequestId = requestId
            currentOnDone = onDone
            stopRequested = false
            return nil
        }
        if let refusal {
            onDone("error", refusal)
            return false
        }
        work.async { [self] in
            reply(
                requestId: requestId, system: system, turns: turns, maxTokens: maxTokens,
                sampling: sampling, thinking: thinking, thinkBudget: thinkBudget, onDelta: onDelta,
                onStats: onStats)
        }
        return true
    }

    func stop(requestId: String) {
        let hit: Bool = state.sync {
            guard currentRequestId == requestId else { return false }
            stopRequested = true
            return true
        }
        if hit { setAbort(true) }
    }

    // ------------------------------------------------------------ work queue

    private func reply(
        requestId: String,
        system: String,
        turns: [ChatTurn],
        maxTokens: Int,
        sampling: Sampling,
        thinking: Bool,
        thinkBudget: Int,
        onDelta: @escaping (String) -> Void,
        onStats: ((ReplyStats) -> Void)?
    ) {
        // Unloaded or replaced before this reply began: that already reported.
        guard status(requestId).live else { return }
        setAbort(false)
        let began = Date()
        guard let context, let model, let vocab else {
            finish(requestId, "error", "No model is loaded on this iPhone yet.")
            return
        }
        let windowSize = Int(llama_n_ctx(context))
        let memory = llama_get_memory(context)
        let tooLong = "This chat is too long for the model on this iPhone. Start a new chat, or send a shorter message."
        var position: llama_pos = 0
        /// The cells the prompt fills in the window. For words it equals the
        /// position; a picture under Qwen's M-RoPE takes more cells than
        /// positions, so the reply's room is counted from this, not `position`.
        var filled = 0
        let pictures = turns.contains { !$0.images.isEmpty }
        /// The prompt ends inside an open thought (the template's own thinking
        /// branch), so the reply starts mid-thought.
        let opensThought = thinking && PromptFormat.isChatML(template) && PromptFormat.hasThinkingSwitch(template)

        if pictures {
            guard let vision = openVision(model) else {
                finish(requestId, "error", LlamaRunner.visionMissing)
                return
            }
            let marker = String(cString: mtmd_default_marker())
            let prompt = render(system: system, turns: turns, marker: marker, thinking: thinking)
            var bitmaps: [OpaquePointer?] = []
            defer { for bitmap in bitmaps { if let bitmap { mtmd_bitmap_free(bitmap) } } }
            for turn in turns {
                for image in turn.images {
                    let wrapper = image.withUnsafeBytes { raw in
                        mtmd_helper_bitmap_init_from_buf(
                            vision, raw.bindMemory(to: UInt8.self).baseAddress, raw.count, false)
                    }
                    if let video = wrapper.video_ctx { mtmd_helper_video_free(video) }
                    guard let bitmap = wrapper.bitmap else {
                        finish(requestId, "error", "One of the pictures could not be read. Send it as a PNG or a JPEG.")
                        return
                    }
                    bitmaps.append(bitmap)
                }
            }
            guard let chunks = mtmd_input_chunks_init() else {
                finish(requestId, "error", "The pictures could not be prepared. Try again.")
                return
            }
            defer { mtmd_input_chunks_free(chunks) }
            let tokenized: Int32 = prompt.withCString { text in
                var input = mtmd_input_text(
                    text: text, text_len: prompt.utf8.count, add_special: true, parse_special: true)
                let pictureCount = bitmaps.count
                return bitmaps.withUnsafeMutableBufferPointer { list in
                    mtmd_tokenize(vision, chunks, &input, list.baseAddress, pictureCount)
                }
            }
            guard tokenized == 0 else {
                finish(requestId, "error", "The pictures could not be prepared. Try again.")
                return
            }
            filled = Int(mtmd_helper_get_n_tokens(chunks))
            guard filled + 16 < windowSize else {
                finish(requestId, "error", tooLong)
                return
            }
            // A conversation with pictures starts from an empty context.
            llama_memory_clear(memory, true)
            cached = []
            memoryDirty = true
            var next: llama_pos = 0
            let evaluated = mtmd_helper_eval_chunks(
                vision, context, chunks, 0, 0, batchSize, true, &next)
            guard evaluated == 0 else {
                decodeFailed(requestId, memory: memory)
                return
            }
            position = next
        } else {
            let prompt = render(system: system, turns: turns, marker: "", thinking: thinking)
            let tokens = tokenize(prompt, vocab: vocab)
            guard !tokens.isEmpty else {
                finish(requestId, "error", "There is nothing to respond to.")
                return
            }
            guard tokens.count + 16 < windowSize else {
                finish(requestId, "error", tooLong)
                return
            }
            if memoryDirty {
                llama_memory_clear(memory, true)
                cached = []
                memoryDirty = false
            }
            // Reuse what the context already holds; at least the last token is
            // decoded again, since its logits pick the first word.
            var common = 0
            while common < cached.count && common < tokens.count && cached[common] == tokens[common] {
                common += 1
            }
            if common == tokens.count { common -= 1 }
            if common < cached.count {
                if common == 0 || !llama_memory_seq_rm(memory, 0, llama_pos(common), -1) {
                    llama_memory_clear(memory, true)
                    common = 0
                }
            }
            cached = Array(tokens[0..<common])
            guard decode(tokens[common...], from: common, context: context) else {
                decodeFailed(requestId, memory: memory)
                return
            }
            cached = tokens
            position = llama_pos(tokens.count)
            filled = tokens.count
        }

        guard let sampler = makeSampler(sampling) else {
            finish(requestId, "error", "The model could not start its reply. Try again.")
            return
        }
        defer { llama_sampler_free(sampler) }
        var single = llama_batch_init(1, 0, 1)
        defer { llama_batch_free(single) }
        var stats = ReplyStats(promptTokens: max(filled, Int(position)), promptSeconds: Date().timeIntervalSince(began))
        var thoughtEnded: Date?
        let replyBegan = Date()
        var pending: [UInt8] = []
        // The thought the prompt opened is shown with its tag, so the JS side
        // keeps it out of the answer like any other thought.
        var inThought = opensThought
        if inThought { onDelta(PromptFormat.openThought) }
        let budgeted = inThought && thinkBudget > 0
        var thought = 0
        var answered = 0
        /// The last few characters written, to see the thought's end tag even
        /// when it arrives in pieces.
        var tail = ""
        let room = windowSize - max(filled, Int(position)) - 1
        // A budgeted thought and its answer each have a cap, and together the
        // window's room; otherwise the thought and the answer share maxTokens.
        let cap = budgeted ? room : min(maxTokens, room)
        while thought + answered < cap {
            if budgeted && answered >= maxTokens { break }
            let now = status(requestId)
            guard now.live else { return }
            if now.stopped { break }
            if budgeted && inThought && thought >= thinkBudget {
                // The thought ran out of room: close it the way Qwen documents,
                // and the answer starts from what was thought so far.
                let close = tokenize(PromptFormat.thoughtCutoff, vocab: vocab, addSpecial: false)
                guard thought + close.count + 1 < room else { break }
                if !pending.isEmpty {
                    onDelta(String(decoding: pending, as: UTF8.self))
                    pending = []
                }
                guard decode(close[...], from: Int(position), context: context) else {
                    decodeFailed(requestId, memory: memory)
                    return
                }
                onDelta(PromptFormat.thoughtCutoff)
                position += llama_pos(close.count)
                if !memoryDirty { cached += close }
                thought += close.count
                inThought = false
                thoughtEnded = Date()
                continue
            }
            let token = llama_sampler_sample(sampler, context, -1)
            if llama_vocab_is_eog(vocab, token) { break }
            pending += piece(token, vocab: vocab)
            let text = PromptFormat.takeCompleteUTF8(&pending)
            if !text.isEmpty {
                onDelta(text)
                if inThought {
                    tail = String((tail + text).suffix(16))
                    if tail.contains(PromptFormat.thoughtEnd) {
                        inThought = false
                        thoughtEnded = Date()
                    }
                }
            }
            single.n_tokens = 1
            single.token[0] = token
            single.pos[0] = position
            single.n_seq_id[0] = 1
            single.seq_id[0]![0] = 0
            single.logits[0] = 1
            guard llama_decode(context, single) == 0 else {
                decodeFailed(requestId, memory: memory)
                return
            }
            position += 1
            if !memoryDirty { cached.append(token) }
            if inThought {
                thought += 1
            } else {
                answered += 1
            }
        }
        if !pending.isEmpty { onDelta(String(decoding: pending, as: UTF8.self)) }
        let ended = Date()
        stats.thoughtTokens = thought
        stats.thoughtSeconds = opensThought ? (thoughtEnded ?? ended).timeIntervalSince(replyBegan) : 0
        stats.answerTokens = answered
        stats.answerSeconds = ended.timeIntervalSince(thoughtEnded ?? replyBegan)
        if status(requestId).live { onStats?(stats) }
        finish(requestId, status(requestId).stopped ? "stopped" : "end", nil)
    }

    /// A decode that did not finish leaves the context half written, so it is
    /// emptied. A Stop or an unload that cut the decode short is not an error.
    private func decodeFailed(_ requestId: String, memory: llama_memory_t?) {
        llama_memory_clear(memory, true)
        cached = []
        memoryDirty = false
        let now = status(requestId)
        guard now.live else { return }
        if now.stopped {
            finish(requestId, "stopped", nil)
        } else {
            finish(requestId, "error", "The model could not read this conversation. Try again, or start a new chat.")
        }
    }

    private func render(system: String, turns: [ChatTurn], marker: String, thinking: Bool) -> String {
        if PromptFormat.isChatML(template) {
            return PromptFormat.chatML(
                system: system, turns: turns, marker: marker,
                thinkingOff: !thinking && PromptFormat.hasThinkingSwitch(template),
                thoughtOpen: thinking && PromptFormat.hasThinkingSwitch(template))
        }
        // Any other family goes through llama.cpp's own template table.
        var pairs: [(role: String, content: String)] = []
        if !system.isEmpty { pairs.append(("system", system)) }
        for turn in turns {
            pairs.append((turn.role == "assistant" ? "assistant" : "user", PromptFormat.withMarkers(turn, marker: marker)))
        }
        let roles = pairs.map { strdup($0.role) }
        let contents = pairs.map { strdup($0.content) }
        defer { for pointer in roles + contents { free(pointer) } }
        var messages = zip(roles, contents).map {
            llama_chat_message(role: UnsafePointer($0), content: UnsafePointer($1))
        }
        let count = messages.count
        var capacity = pairs.reduce(0) { $0 + $1.content.utf8.count } * 2 + 1024
        var buffer = [CChar](repeating: 0, count: capacity)
        var length = llama_chat_apply_template(template, &messages, count, true, &buffer, Int32(capacity))
        if Int(length) > capacity {
            capacity = Int(length) + 1
            buffer = [CChar](repeating: 0, count: capacity)
            length = llama_chat_apply_template(template, &messages, count, true, &buffer, Int32(capacity))
        }
        guard length > 0, Int(length) <= capacity else {
            // A template llama.cpp does not know: ChatML is the safest guess.
            return PromptFormat.chatML(system: system, turns: turns, marker: marker, thinkingOff: false)
        }
        return String(decoding: buffer[0..<Int(length)].map { UInt8(bitPattern: $0) }, as: UTF8.self)
    }

    /// `addSpecial` false for words that continue a reply (no start token).
    private func tokenize(_ text: String, vocab: OpaquePointer, addSpecial: Bool = true) -> [llama_token] {
        let length = Int32(text.utf8.count)
        var room = Int32(length) + 8
        var tokens = [llama_token](repeating: 0, count: Int(room))
        var count = llama_tokenize(vocab, text, length, &tokens, room, addSpecial, true)
        if count < 0 {
            room = -count
            tokens = [llama_token](repeating: 0, count: Int(room))
            count = llama_tokenize(vocab, text, length, &tokens, room, addSpecial, true)
        }
        return count > 0 ? Array(tokens[0..<Int(count)]) : []
    }

    /// The prompt's new tokens, in batches, with only the last one's logits
    /// kept. Positions are written out, so a model that places words in more
    /// than one dimension (Qwen's) reads them the way its own tools do.
    private func decode(_ tokens: ArraySlice<llama_token>, from start: Int, context: OpaquePointer) -> Bool {
        var batch = llama_batch_init(batchSize, 0, 1)
        defer { llama_batch_free(batch) }
        var at = tokens.startIndex
        var position = start
        while at < tokens.endIndex {
            let end = min(at + Int(batchSize), tokens.endIndex)
            batch.n_tokens = 0
            for index in at..<end {
                let slot = Int(batch.n_tokens)
                batch.token[slot] = tokens[index]
                batch.pos[slot] = llama_pos(position)
                batch.n_seq_id[slot] = 1
                batch.seq_id[slot]![0] = 0
                batch.logits[slot] = index == tokens.endIndex - 1 ? 1 : 0
                batch.n_tokens += 1
                position += 1
            }
            guard llama_decode(context, batch) == 0 else { return false }
            at = end
        }
        return true
    }

    /// A token as the bytes it spells. Control tokens (the template's own
    /// markers) spell nothing; a model's thinking tags are not control tokens,
    /// so they reach the JS side, which keeps a thought out of the answer.
    private func piece(_ token: llama_token, vocab: OpaquePointer) -> [UInt8] {
        if llama_vocab_is_control(vocab, token) { return [] }
        var room: Int32 = 64
        var buffer = [CChar](repeating: 0, count: Int(room))
        var length = llama_token_to_piece(vocab, token, &buffer, room, 0, true)
        if length < 0 {
            room = -length
            buffer = [CChar](repeating: 0, count: Int(room))
            length = llama_token_to_piece(vocab, token, &buffer, room, 0, true)
        }
        guard length > 0 else { return [] }
        return buffer[0..<Int(length)].map { UInt8(bitPattern: $0) }
    }

    private func makeSampler(_ sampling: Sampling) -> UnsafeMutablePointer<llama_sampler>? {
        guard let chain = llama_sampler_chain_init(llama_sampler_chain_default_params()) else { return nil }
        if sampling.repeatPenalty != 1 {
            llama_sampler_chain_add(
                chain, llama_sampler_init_penalties(sampling.penaltyLastN, sampling.repeatPenalty, 0, 0))
        }
        if sampling.temperature <= 0 {
            llama_sampler_chain_add(chain, llama_sampler_init_greedy())
            return chain
        }
        llama_sampler_chain_add(chain, llama_sampler_init_top_k(sampling.topK))
        llama_sampler_chain_add(chain, llama_sampler_init_top_p(sampling.topP, 1))
        if sampling.minP > 0 { llama_sampler_chain_add(chain, llama_sampler_init_min_p(sampling.minP, 1)) }
        llama_sampler_chain_add(chain, llama_sampler_init_temp(sampling.temperature))
        llama_sampler_chain_add(chain, llama_sampler_init_dist(UInt32.random(in: .min ... .max)))
        return chain
    }

    /// The vision file, opened on the first picture and kept while the model
    /// stays loaded. Nil when the model has none, or it would not open.
    private func openVision(_ model: OpaquePointer) -> OpaquePointer? {
        if let vision { return vision }
        guard let visionPath, FileManager.default.fileExists(atPath: visionPath) else { return nil }
        var params = mtmd_context_params_default()
        #if targetEnvironment(simulator)
        params.use_gpu = false
        #else
        params.use_gpu = true
        #endif
        params.print_timings = false
        params.warmup = false
        params.n_threads = LlamaRunner.threads
        params.image_max_tokens = LlamaRunner.imageMaxTokens
        guard let opened = mtmd_init_from_file(visionPath, model, params) else { return nil }
        guard mtmd_support_vision(opened) else {
            mtmd_free(opened)
            return nil
        }
        vision = opened
        return opened
    }

    private func freeModel() {
        if let vision { mtmd_free(vision) }
        if let context { llama_free(context) }
        if let model { llama_model_free(model) }
        vision = nil
        context = nil
        model = nil
        vocab = nil
        template = nil
        visionPath = nil
        cached = []
        memoryDirty = false
    }

    // ------------------------------------------------------------- bookkeeping

    /// Whether this request still owns the slot, and whether Stop was pressed.
    private func status(_ requestId: String) -> (live: Bool, stopped: Bool) {
        state.sync {
            (live: currentRequestId == requestId, stopped: currentRequestId == requestId && stopRequested)
        }
    }

    /// Finish only if this request still owns the slot. An unload or a load in
    /// the meantime already reported "stopped" for it.
    private func finish(_ requestId: String, _ reason: String, _ detail: String?) {
        let done = state.sync { () -> ((String, String?) -> Void)? in
            guard currentRequestId == requestId else { return nil }
            let d = currentOnDone
            currentRequestId = nil
            currentOnDone = nil
            stopRequested = false
            return d
        }
        done?(reason, detail)
    }

    private func setAbort(_ value: Bool) {
        abortLock.lock()
        abortDecode = value
        abortLock.unlock()
    }

    fileprivate func shouldAbort() -> Bool {
        abortLock.lock()
        defer { abortLock.unlock() }
        return abortDecode
    }
}
