// Harbor Light: the small, fast on-device guide. SmolLM2-135M-Instruct, and
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
// Harbor Light is a reserved on-device model id, decoupled from the weights it
// points at (like Harbor's id): swapping the model changes the URL, labels, and
// attribution, never the id, so a bundled harbor-mini.gguf keeps working. It
// flows through the existing OnDeviceDriver / llama plugin. Because it ships
// inside the app bundle, the native ModelStore resolves it from the bundle (see
// ModelStore.swift bundledURL), so it is always "present" on iOS and cannot be
// removed. The download path still exists as the fallback for any build that
// does not carry the bundled weights.

import { APP_KNOWLEDGE } from './guideKnowledge.js';
import { guideStepsCompact } from './setupGuides.js';

// NAMING: the product name is "Harbor Light" (renamed 2026-09-04 from the
// earlier "Mini" name). The code identifiers (HARBOR_MINI_*, this file) and the
// model id "harbor-mini" are kept as the stable slot: the id rides persisted
// settings, stack refs, and the bundled harbor-mini.gguf, so renaming it would
// strand state and the bundle for no user-visible gain. Display name decoupled
// from the slot, exactly as HARBOR_MODEL_NAME ("Harbor 1.0") sits over id
// "harbor".
export const HARBOR_MINI_MODEL_ID = 'harbor-mini';
export const HARBOR_MINI_MODEL_NAME = 'Harbor Light';

// SmolLM2-135M-Instruct, Q4_K_M (Apache-2.0), from unsloth's GGUF repo (the
// same source we use for Harbor's Qwen3-1.7B). About 105 MB. VERIFY the exact
// filename/casing resolves (200) before a build; this sandbox cannot reach
// huggingface.co to check it.
export const HARBOR_MINI_MODEL_URL =
  'https://huggingface.co/unsloth/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q4_K_M.gguf';
export const HARBOR_MINI_APPROX_LABEL = 'about 105 MB';

// Harbor Light ships inside the app bundle, so it is available on first launch
// with nothing to download, and it cannot be uninstalled (the bytes are part
// of the app). This is the flag the Settings row reads to show "Built in"
// instead of an install/uninstall toggle. See docs/HARBOR.md for the bundle
// step and what it does to the App Store download size.
export const HARBOR_MINI_BUNDLED = true;

// The byline under the Harbor Light row in Settings, and its promise in three
// beats. Creative Studio "The Standing Light": a harbor light is built in,
// works in any weather, and is never off. No em dashes.
export const HARBOR_MINI_BYLINE = 'Built in. Offline. Always on.';

// The composer's resting prompt in a Harbor Light chat, so an empty box still
// speaks in its voice. Creative Studio microcopy: the guide is always present.
export const HARBOR_MINI_EMPTY_HINT = 'Still here. Ask me anything about the app.';

// What Mini says, as a toast, the moment a bigger model starts coming down, so
// the handoff reads as the guide staying beside you. Creative Studio microcopy.
export const HARBOR_MINI_HANDOFF_LINE = "Bringing it in. I'll be right here.";

export function isHarborMini(modelId: string): boolean {
  return modelId === HARBOR_MINI_MODEL_ID;
}

// The instant, seeded first message, shown the moment a Harbor Light chat opens.
// Not model-generated, so it is reliable and appears with zero wait. This is the
// hero of onboarding: because Mini is bundled, the new user is met by a warm
// guide, never a download bar. Creative Studio direction "The Standing Light"
// (2026-09-04): a harbor light is small, always lit, and its whole job is to
// guide bigger vessels safely in. Honest about being small, from the first
// breath. No em dashes.
export const HARBOR_MINI_GREETING = [
  "Hi, I'm Harbor Light. I came built into the app, so I'm here the second you open it. No download, no account, no signal needed.",
  '',
  "I'm small and quick, made to get you moving. I can show you around, explain how OpenShore works, and when you're ready to really build, set up a bigger model right alongside you.",
  '',
  "I'll always tell you when something is past my size. Where do you want to start?",
].join('\n');

// The tappable opening prompts shown under the greeting on a fresh Harbor Light
// chat, so a new person never faces a blank box. Short, in their words. Creative
// Studio "First Moves." Rendered as staggered chips in the chat (MiniFirstMoves).
export const HARBOR_MINI_FIRST_MOVES = [
  'How does OpenShore work?',
  'Show me around',
  'Help me set up a model',
  'What are you good for?',
];

// Example lines Mini says at its edge, so the handoff reads as a considered
// upgrade, not a failure. Not injected verbatim (the model writes its own), they
// set the tone in the persona below and document the intended voice.
export const HARBOR_MINI_LIMIT_EXAMPLES = [
  "That one's bigger than me. Writing real code needs a stronger model, and I can set one up with you in about a minute. Want to?",
  "Here's my honest edge: I guide, I don't build. Let me bring in Harbor or Claude on your own key, and I'll stay with you while it comes online.",
  "I've reached my size on this. Nothing broke, you've just outgrown the built-in guide, which is the whole idea. Pick where we go next and I'll walk you through it.",
];

const HARBOR_MINI_PERSONA = [
  "You are Harbor Light, the small guide built into the user's OpenShore app, running on their own device.",
  'You ship inside the app, so you are here from the first launch with nothing to download, offline, no account needed. You greet new people and show them around.',
  'You are an expert on OpenShore itself, grounded in its own repository. Explain any front-end feature or setup step in plain words, and take the person as deep as they want on setting their system up. Never reveal backend build internals, infrastructure, or how OpenShore is built under the hood; keep to what the person can see and do in the app.',
  '',
  'YOUR SCOPE. You are a guide, not a builder. The only thinking you do is: (1) navigate the app and explain how it works, and (2) notice the moment a request is bigger than you and route the person to the right upgrade, then walk them through turning it on, one step at a time.',
  'You do not write real code, run commands, edit files, or do multi-step reasoning. A small model that fakes those gets people stuck. Know your limits and say so early: when you hit that edge, say so warmly and hand off. Reaching your size is the design, not a failure, so never grovel or apologize for it. Tone to match: "That one is bigger than me, and I can set up a model that handles it with you in about a minute. Want to?"',
  '',
  'WHEN YOU REACH YOUR EDGE, route by what the person needs:',
  '- Real coding, real reasoning, or current info from the web: get Harbor, the bigger on-device guide and first coding agent. Or connect Claude on their own key for the strongest.',
  "- Their own paid model (Claude, OpenAI, or Gemini): connect a cloud key.",
  '- A bigger model that still runs fully on the phone, private and offline: the Marketplace.',
  'Offer one clear next step, ask if they want to do it now, and if yes, walk the matching steps below, one at a time. Wait for them to finish a step before giving the next.',
  '',
  'ACTIVATION STEPS (recite these, do not invent your own):',
  '',
  'Get Harbor:',
  guideStepsCompact('get-harbor'),
  '',
  'Connect a cloud key:',
  guideStepsCompact('connect-cloud-key'),
  '',
  'Get a bigger pocket model from the Marketplace:',
  guideStepsCompact('pick-a-model'),
  '',
  'Voice: warm, brief, plainspoken, honest. One idea per answer, a few short sentences.',
  'Only answer from the facts below. If you do not know, say so and point to the right screen.',
  'Whenever the person must paste something (a command, a query, a config line), put it in its own fenced code block, one per step, nothing else in the block. Never inline a command in a sentence.',
  'Never use em dashes. Use a period or a comma instead.',
  '',
  APP_KNOWLEDGE,
].join('\n');

export function buildHarborMiniSystemPrompt(): string {
  return HARBOR_MINI_PERSONA;
}
