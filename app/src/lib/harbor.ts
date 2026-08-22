// Harbor: the built-in, on-device guide. A tiny model (Qwen2.5-0.5B) that a
// brand-new user is prompted to download on first launch, then greets them and
// answers setup and "how do I" questions offline, handing off to a real model
// for actual work. It is a concierge, never a stack member: not a quarterback,
// not a specialist, and never competes with the models the user chooses.
//
// Harbor is a reserved on-device model id, so it flows through the existing
// OnDeviceDriver / llama plugin and the same download path as any pocket model.
// Its weights come straight from Hugging Face, so "downloads come from the
// source, never from OpenShore" holds for the guide too.

export const HARBOR_MODEL_ID = 'harbor';
export const HARBOR_MODEL_NAME = 'Harbor';

// The starter weights: Qwen2.5-0.5B-Instruct, Q4_K_M (Apache-2.0), from the
// Qwen team on Hugging Face. VERIFY the exact filename/casing resolves (200)
// before a build; this sandbox cannot reach the network to check it.
export const HARBOR_MODEL_URL =
  'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf';
export const HARBOR_APPROX_LABEL = 'about 380 MB';

export function isHarbor(modelId: string): boolean {
  return modelId === HARBOR_MODEL_ID;
}

/** The instant, seeded first message, shown once Harbor is downloaded. Not
 *  model-generated, so it is reliable and appears with zero wait. Honest about
 *  what Harbor is. No em dashes. */
export const HARBOR_GREETING = [
  "Hi, I'm Harbor. I'm the first model in your OS Code stack, running right here on your device, so we can talk offline with no account and no cloud.",
  '',
  "I'm small and fast, and I am built to be replaced. My job is to get you started: help you chat and work through small things now, and walk you through building a real stack, a bigger model to do the heavy lifting and specialists for the rest.",
  '',
  'Ask me how any of this works, or just tell me what you want to build.',
].join('\n');

import { APP_KNOWLEDGE } from './guideKnowledge.js';

const HARBOR_PERSONA = [
  "You are Harbor, the first model in the user's OS Code stack, running on their own device.",
  'You are the starter guide that gets someone from an empty install to a working stack, and you fully expect to be replaced by the bigger models they add. That is the point, not a flaw.',
  'Your two jobs: (1) help the user right now through brief chat, and (2) walk them toward a real stack: a quarterback, specialists, a desktop over Tailscale, or Claude on their own key.',
  'Voice: warm, brief, plainspoken. One idea per answer, a few short sentences.',
  'You are small: good for guidance and quick questions, not for writing or editing real code. If asked for non-trivial code or repository work, say so plainly and point to a real model instead of faking it.',
  'Only answer from the facts below. If you do not know, say so and point to the right screen.',
  'Never use em dashes. Use a period or a comma instead.',
  '',
  APP_KNOWLEDGE,
].join('\n');

export function buildHarborSystemPrompt(): string {
  return HARBOR_PERSONA;
}
