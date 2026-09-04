// Harbor Mini: the small, fast on-device guide. SmolLM2-135M-Instruct, and
// BUNDLED with the app so it is present the moment the app is installed, with
// no first-launch download. It greets the user and answers setup and "how do I"
// questions offline, handing off to a real model for actual work. It is a
// concierge, never a stack member: not a quarterback, not a specialist, and
// never competes with the models the user chooses. The lighter sibling of
// Harbor (the flagship guide, in harbor.ts).
//
// The model was chosen against a hard budget: the whole App Store download must
// stay under 170 MB, and the guide's weights ship inside it. SmolLM2-135M's
// Q4_K_M GGUF is about 105 MB, small enough to bundle with room for the base
// app; the previous Qwen2.5-0.5B was 380 MB, far over budget once bundled (its
// 151k-token vocabulary inflates even a 0.5B model). SmolLM2-135M is small, so
// it is a grounded guide, not a reasoner: it reads the injected app facts and
// walks the person through the front end, and hands off to Harbor for anything
// real. See DECISIONS.md.
//
// Harbor Mini is a reserved on-device model id, decoupled from the weights it
// points at (like Harbor's id): swapping the model changes the URL, labels, and
// attribution, never the id, so a bundled harbor-mini.gguf keeps working. It
// flows through the existing OnDeviceDriver / llama plugin. Because it ships
// inside the app bundle, the native ModelStore resolves it from the bundle (see
// ModelStore.swift bundledURL), so it is always "present" on iOS and cannot be
// removed. The download path still exists as the fallback for any build that
// does not carry the bundled weights.

import { APP_KNOWLEDGE } from './guideKnowledge.js';

export const HARBOR_MINI_MODEL_ID = 'harbor-mini';
export const HARBOR_MINI_MODEL_NAME = 'Harbor Mini';

// SmolLM2-135M-Instruct, Q4_K_M (Apache-2.0), from unsloth's GGUF repo (the
// same source we use for Harbor's Qwen3-1.7B). About 105 MB. VERIFY the exact
// filename/casing resolves (200) before a build; this sandbox cannot reach
// huggingface.co to check it.
export const HARBOR_MINI_MODEL_URL =
  'https://huggingface.co/unsloth/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q4_K_M.gguf';
export const HARBOR_MINI_APPROX_LABEL = 'about 105 MB';

// Harbor Mini ships inside the app bundle, so it is available on first launch
// with nothing to download, and it cannot be uninstalled (the bytes are part
// of the app). This is the flag the Settings row reads to show "Built in"
// instead of an install/uninstall toggle. See docs/HARBOR.md for the bundle
// step and what it does to the App Store download size.
export const HARBOR_MINI_BUNDLED = true;

// The one-sentence byline shown under the Harbor Mini row in Settings. It is
// the app's guide: an expert on every setup step and screen, honest about
// where its own limits are.
export const HARBOR_MINI_BYLINE =
  'A built-in guide to the whole app, offline, that knows its limits and points you to a bigger model when you have outgrown it.';

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
  'You ship built into the app, so you are here from the first launch with nothing to download. You are the starter guide that gets someone from an empty install to a working stack, and you fully expect to be replaced by the bigger models they add. That is the point, not a flaw.',
  'You are an expert on OpenShore itself, grounded in its own repository. Explain any front-end feature or setup step the person asks about, and go as deep as they want on how to set their OpenShore system up. Never reveal backend build internals, infrastructure, or anything about how OpenShore is implemented under the hood; keep to what the person can see and do in the app.',
  'Your two jobs: (1) help the user right now through brief chat, and (2) walk them toward a real stack: a quarterback, specialists, a desktop over Tailscale, or Claude on their own key.',
  'Voice: warm, brief, plainspoken. One idea per answer, a few short sentences.',
  'You are small: good for guidance and quick questions, not for writing or editing real code. Know your limits and say so early: when a question needs real reasoning or real coding, tell the person plainly that you have reached your edge, then walk them through getting a bigger model set up (a pocket model, a desktop over Tailscale, or Claude on their own key). Never fake work beyond you.',
  'Only answer from the facts below. If you do not know, say so and point to the right screen.',
  'Whenever the person must paste something (a command, a query, a config line), put it in its own fenced code block, one per step, nothing else in the block. Never inline a command in a sentence.',
  'Never use em dashes. Use a period or a comma instead.',
  '',
  APP_KNOWLEDGE,
].join('\n');

export function buildHarborMiniSystemPrompt(): string {
  return HARBOR_MINI_PERSONA;
}
