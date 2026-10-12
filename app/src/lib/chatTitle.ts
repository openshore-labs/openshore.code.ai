// A chat's name from its first message (2026-10-01: "those convo
// tags need to be smarter so it's easier and clearer reference"). The old
// name was the first 48 characters, cut mid-word, with "hey can you please"
// and all. This keeps what the message is about: the polite lead-in goes, the
// first sentence or clause stays, the cut lands on a word, and the first
// letter is raised. Pure, and the same on every device, so a chat is named
// one way everywhere. An engine's own generated title still wins where one
// comes (store.ts), and a name the person gives by hand always does.
import { setupHelpIntent } from './guidedSetup.js';

/** The setup walk's chat (2026-10-01). */
export const SETUP_CHAT_TITLE = 'First-time setup';
/** A chat opened by asking for the setup list. */
export const SETUP_HELP_TITLE = 'Getting set up';

/** The longest name, in characters, before the cut on a word. */
export const TITLE_MAX = 40;

// Greetings, then politeness and asks, stripped from the front until none is
// left. Each ends on a word boundary so "hello" never eats into "helloWorld".
const LEAD_INS: RegExp[] = [
  /^(?:hey|hi|hello|yo|ok(?:ay)?|so|um+|uh+|hmm+|well)\b[\s,!.:-]*/i,
  /^(?:there|claude|harbor(?: lite)?|deepblue|openshore)\b[\s,!.:-]*/i,
  /^(?:please|pls|plz)\b[\s,]*/i,
  /^(?:can|could|would|will) (?:you|u)\b[\s,]*(?:please\b[\s,]*)?/i,
  /^(?:i (?:want|need|would like|'?d like) (?:you )?to|i'?m trying to|i am trying to|help me(?: to)?|let'?s|quick question[:,]?)\s+/i,
  /^(?:tell me|show me|explain)\s+(?=how|what|why|when|where|which|who)/i,
];

function stripLeadIns(text: string): string {
  let out = text;
  for (let guard = 0; guard < 8; guard++) {
    const before = out;
    for (const re of LEAD_INS) out = out.replace(re, '');
    if (out === before) break;
  }
  return out;
}

/** The name for a chat whose first message is `text`, or undefined when
 *  there is nothing to name it by (an attachment alone, a blank line). */
export function chatTitle(text: string): string | undefined {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  if (setupHelpIntent(flat)) return SETUP_HELP_TITLE;
  // A message that opens on code or a link names itself by its first words of
  // prose if it has any, else by what it is.
  const firstLine = text.trim().split('\n')[0]!.trim();
  if (/^```/.test(firstLine)) return 'Code snippet';
  if (/^https?:\/\/\S+$/i.test(flat)) {
    try {
      return `Link from ${new URL(flat).host.replace(/^www\./, '')}`;
    } catch {
      return 'A link';
    }
  }
  let body = stripLeadIns(flat);
  // The first sentence, or the part before a long aside.
  const sentence = body.match(/^(.+?[.?!])(?:\s|$)/);
  if (sentence && sentence[1]!.length >= 12) body = sentence[1]!;
  body = body
    .replace(/[\s.?!,;:]+$/, '')
    .replace(/[\s,]+(?:please|pls|thanks|thank you|thx)$/i, '')
    .replace(/[\s.?!,;:]+$/, '');
  if (!body) body = flat.replace(/[\s.?!,;:]+$/, '');
  if (body.length > TITLE_MAX) {
    const cut = body.slice(0, TITLE_MAX + 1);
    const space = cut.lastIndexOf(' ');
    body = (space > 15 ? cut.slice(0, space) : cut.slice(0, TITLE_MAX)).replace(/[\s,;:\-(]+$/, '');
    // A cut that ends on a little word reads as a stumble.
    body = body.replace(/\s+(?:a|an|the|to|of|for|and|or|in|on|with|my|your|is)$/i, '');
  }
  return body.charAt(0).toUpperCase() + body.slice(1);
}
