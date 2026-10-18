import Foundation

/// One turn of the conversation as the JS side hands it over: who spoke, what
/// they wrote, and the pictures that ride with it (encoded image files, JPEG or
/// PNG). Only a model with a vision file can read the pictures.
struct ChatTurn {
    let role: String
    let content: String
    let images: [Data]
}

/// How a conversation becomes the text a model reads. Pure (Foundation only,
/// no llama.cpp), so the rules here hold on any platform the runner builds on.
enum PromptFormat {

    /// Whether a model's chat template is the ChatML family (Qwen, SmolLM and
    /// most small models). A model with no template at all reads ChatML too,
    /// the same fallback llama.cpp uses.
    static func isChatML(_ template: String?) -> Bool {
        guard let template, !template.isEmpty else { return true }
        return template.contains("<|im_start|>")
    }

    /// Whether the template has Qwen's thinking switch. Such a model thinks
    /// before every answer unless the prompt hands it an empty thought, which is
    /// what the template itself does when thinking is turned off.
    static func hasThinkingSwitch(_ template: String?) -> Bool {
        template?.contains("enable_thinking") ?? false
    }

    /// The empty thought that turns thinking off, written where the template's
    /// own `enable_thinking=false` branch writes it.
    static let emptyThought = "<think>\n\n</think>\n\n"

    /// A turn's text with one media marker per picture in front of it, the
    /// order Qwen's template uses (the pictures, then the words).
    static func withMarkers(_ turn: ChatTurn, marker: String) -> String {
        guard !turn.images.isEmpty, !marker.isEmpty else { return turn.content }
        return String(repeating: marker, count: turn.images.count) + turn.content
    }

    /// The whole conversation in ChatML, ending on the open assistant turn.
    /// `thinkingOff` writes the empty thought there.
    static func chatML(system: String, turns: [ChatTurn], marker: String, thinkingOff: Bool) -> String {
        var out = ""
        if !system.isEmpty {
            out += "<|im_start|>system\n\(system)<|im_end|>\n"
        }
        for turn in turns {
            let role = turn.role == "assistant" ? "assistant" : "user"
            out += "<|im_start|>\(role)\n\(withMarkers(turn, marker: marker))<|im_end|>\n"
        }
        out += "<|im_start|>assistant\n"
        if thinkingOff { out += emptyThought }
        return out
    }

    /// How many bytes at the front of `bytes` form whole UTF-8 characters. A
    /// token can end partway through a character (an emoji, an accented
    /// letter), so the tail of an unfinished one waits for the next token
    /// rather than reaching the chat as a replacement character. A byte that
    /// can start no character counts as whole, so the decoder replaces it and
    /// the stream never stalls on it.
    static func completeUTF8Prefix(_ bytes: [UInt8]) -> Int {
        let count = bytes.count
        var index = count - 1
        var steps = 0
        while index >= 0 && steps < 4 {
            let byte = bytes[index]
            if byte & 0xC0 != 0x80 {
                let need: Int
                if byte & 0x80 == 0 {
                    need = 1
                } else if byte & 0xE0 == 0xC0 {
                    need = 2
                } else if byte & 0xF0 == 0xE0 {
                    need = 3
                } else if byte & 0xF8 == 0xF0 {
                    need = 4
                } else {
                    return count
                }
                return count - index >= need ? count : index
            }
            index -= 1
            steps += 1
        }
        return count
    }

    /// Take the whole characters off the front of `buffer` as text, leaving an
    /// unfinished one behind.
    static func takeCompleteUTF8(_ buffer: inout [UInt8]) -> String {
        let cut = completeUTF8Prefix(buffer)
        guard cut > 0 else { return "" }
        let text = String(decoding: buffer[0..<cut], as: UTF8.self)
        buffer.removeFirst(cut)
        return text
    }
}
