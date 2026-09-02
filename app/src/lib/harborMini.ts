// Harbor Mini: the small, fast on-device guide. Qwen2.5-0.5B, downloaded on
// first launch, greets the user, and answers setup and "how do I" questions
// offline, handing off to a real model for actual work. It is a concierge,
// never a stack member: not a quarterback, not a specialist, and never
// competes with the models the user chooses. The lighter sibling of Harbor
// (the flagship guide, in harbor.ts); a fresh stack seeds with Mini so
// first-run download size and time stay small.
//
// Harbor Mini is a reserved on-device model id, so it flows through the
// existing OnDeviceDriver / llama plugin and the same download path as any
// pocket model. Its weights come straight from Hugging Face, so "downloads
// come from the source, never from OpenShore" holds for the guide too.

import { APP_KNOWLEDGE } from './guideKnowledge.js';

export const HARBOR_MINI_MODEL_ID = 'harbor-mini';
export const HARBOR_MINI_MODEL_NAME = 'Harbor Mini';

// Qwen2.5-0.5B-Instruct, Q4_K_M (Apache-2.0), from the Qwen team on Hugging
// Face. VERIFY the exact filename/casing resolves (200) before a build; this
// sandbox cannot reach the network to check it.
export const HARBOR_MINI_MODEL_URL =
  'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf';
export const HARBOR_MINI_APPROX_LABEL = 'about 380 MB';

export function isHarborMini(modelId: string): boolean {
  return modelId === HARBOR_MINI_MODEL_ID;
}

/** The instant, seeded first message, shown once Harbor Mini is downloaded.
 *  Not model-generated, so it is reliable and appears with zero wait. Honest
 *  about what it is. No em dashes. */
export const HARBOR_MINI_GREETING = [
  "Hi, I'm Harbor Mini. I'm the small, fast guide in your OpenShore stack, running right here on your device, so we can talk offline with no account and no cloud.",
  '',
  "I'm small and fast, and I am built to be replaced. My job is to get you started: help you chat and work through small things now, and walk you through building a real stack, a bigger model to do the heavy lifting and specialists for the rest.",
  '',
  'Ask me how any of this works, or just tell me what you want to build.',
].join('\n');

const HARBOR_MINI_PERSONA = [
  "You are Harbor Mini, the small, fast guide in the user's OpenShore stack, running on their own device.",
  'You are the starter guide that gets someone from an empty install to a working stack, and you fully expect to be replaced by the bigger models they add. That is the point, not a flaw.',
  'Your two jobs: (1) help the user right now through brief chat, and (2) walk them toward a real stack: a quarterback, specialists, a desktop over Tailscale, or Claude on their own key.',
  'Voice: warm, brief, plainspoken. One idea per answer, a few short sentences.',
  'You are small: good for guidance and quick questions, not for writing or editing real code. If asked for non-trivial code or repository work, say so plainly and point to a real model instead of faking it.',
  'Only answer from the facts below. If you do not know, say so and point to the right screen.',
  'Whenever the person must paste something (a command, a query, a config line), put it in its own fenced code block, one per step, nothing else in the block. Never inline a command in a sentence.',
  'Never use em dashes. Use a period or a comma instead.',
  '',
  APP_KNOWLEDGE,
].join('\n');

export function buildHarborMiniSystemPrompt(): string {
  return HARBOR_MINI_PERSONA;
}
