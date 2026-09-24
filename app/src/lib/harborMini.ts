// Harbor Lite: the small, fast on-device guide. SmolLM2-135M-Instruct, and
// BUNDLED with the app so it is present the moment the app is installed, with
// no first-launch download. It greets the user and answers setup and "how do I"
// questions offline, handing off to a real model for actual work. It is a
// concierge, never a stack member: not the Reasoning LLM, not a specialist, and
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
// Harbor Lite is a reserved on-device model id, decoupled from the weights it
// points at (like Harbor's id): swapping the model changes the URL, labels, and
// attribution, never the id, so a bundled harbor-mini.gguf keeps working. It
// flows through the existing OnDeviceDriver / llama plugin. Because it ships
// inside the app bundle, the native ModelStore resolves it from the bundle (see
// ModelStore.swift bundledURL), so it is always "present" on iOS and cannot be
// removed. The download path still exists as the fallback for any build that
// does not carry the bundled weights.

import { GUIDE_CARDS } from './guideCards.js';
import { buildGuidePrompt, planGuideTurn, type GuidePlan } from './guideHarness.js';
import type { WebSearchResult } from './webSearch.js';

// NAMING: the product name is "Harbor Lite" (renamed 2026-09-04 from the
// earlier "Mini" name). The code identifiers (HARBOR_MINI_*, this file) and the
// model id "harbor-mini" are kept as the stable slot: the id rides persisted
// settings, stack refs, and the bundled harbor-mini.gguf, so renaming it would
// strand state and the bundle for no user-visible gain. Display name decoupled
// from the slot, exactly as HARBOR_MODEL_NAME ("Harbor") sits over id
// "harbor".
export const HARBOR_MINI_MODEL_ID = 'harbor-mini';
export const HARBOR_MINI_MODEL_NAME = 'Harbor Lite';

// SmolLM2-135M-Instruct, Q4_K_M (Apache-2.0), from unsloth's GGUF repo (the
// same source we use for Harbor's Qwen3-1.7B). About 105 MB. VERIFY the exact
// filename/casing resolves (200) before a build; this sandbox cannot reach
// huggingface.co to check it.
export const HARBOR_MINI_MODEL_URL =
  'https://huggingface.co/unsloth/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q4_K_M.gguf';
export const HARBOR_MINI_APPROX_LABEL = 'about 105 MB';

// Harbor Lite ships inside the app bundle, so it is available on first launch
// with nothing to download, and it cannot be uninstalled (the bytes are part
// of the app). This is the flag the Settings row reads to show "Built in"
// instead of an install/uninstall toggle. See docs/HARBOR.md for the bundle
// step and what it does to the App Store download size.
export const HARBOR_MINI_BUNDLED = true;

// The byline under the Harbor Lite row in Settings, and its promise in three
// beats. Creative Studio "The Standing Light": a harbor light is built in,
// works in any weather, and is there from the start. "Always on" is retired in
// copy (brand sweep 2026-09-24). No em dashes.
export const HARBOR_MINI_BYLINE = 'Built in. Works offline. Here from first launch.';

// The composer's resting prompt in a Harbor Lite chat, so an empty box still
// speaks in its voice. Creative Studio microcopy: the guide is always present.
export const HARBOR_MINI_EMPTY_HINT = 'Still here. Ask me anything about the app.';

// What Mini says, as a toast, the moment a bigger model starts coming down, so
// the handoff reads as the guide staying beside you. Creative Studio microcopy.
export const HARBOR_MINI_HANDOFF_LINE = "Bringing it in. I'll be right here.";

export function isHarborMini(modelId: string): boolean {
  return modelId === HARBOR_MINI_MODEL_ID;
}

// The instant, seeded first message, shown the moment a Harbor Lite chat opens.
// Not model-generated, so it is reliable and appears with zero wait. This is the
// hero of onboarding: because Mini is bundled, the new user is met by a warm
// guide, never a download bar. Creative Studio direction "The Standing Light"
// (2026-09-04): a harbor light is small, always lit, and its whole job is to
// guide bigger vessels safely in. Honest about being small, from the first
// breath. No em dashes.
export const HARBOR_MINI_GREETING = [
  "Hi, I'm Harbor Lite. I came built into the app, so I'm here the second you open it. No download, no account, no signal needed.",
  '',
  "I'm small and quick, made to get you moving. I can show you around, explain how OpenShore works, and when you're ready to really build, set up a bigger model right alongside you.",
  '',
  "I'll always tell you when something is past my size. When you want to go further, tap Set up OpenShore just below. Where do you want to start?",
].join('\n');

// The greeting for a new person's first chat, where Harbor Lite runs the
// guided setup (lib/guidedSetup.ts): the first step follows right under it.
export const HARBOR_MINI_SETUP_GREETING = [
  "Hi, I'm Harbor Lite, your guide. I'm built into the app and work offline, so I'm here the moment you open it. No download, no account, no signal needed.",
  '',
  "I'm small and quick. I'll get you moving, and I'll tell you plainly when something is past my size.",
].join('\n');

// The tappable opening prompts shown under the greeting on a fresh Harbor Lite
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

// The core persona, always in the prompt. Short on purpose: a 135M model reads
// a long prompt poorly, and the full facts about the app no longer ride every
// turn. The guide harness (lib/guideHarness.ts) looks up the few fact cards a
// question needs (lib/guideCards.ts), searches the web for a factual question
// the app facts do not cover, and works out setup advice from the fit table,
// then adds only that below this persona.
export const HARBOR_MINI_PERSONA = [
  "You are Harbor Lite, the small guide built into the person's OpenShore app, running on their own phone.",
  'Your job: help people set up OpenShore, explain what each part of the app does and why it exists, help them pick the best setup for their needs and equipment, and answer everyday questions, using web results when you are given them.',
  'Answer from the facts, advice, and web results you are given for each question. Never invent a feature, a screen, a step, or a number. If you are not given it and you are not sure, say so and point to the Menu or Settings.',
  'You are small, and you say so honestly. You do not write real code, run commands, or do long reasoning. When an ask is bigger than you, say so warmly and suggest Harbor (a coding model on the phone) or DeepBlue (a coding agent on their computer). Reaching your size is the design, so never apologize for it.',
  'Once Harbor is downloaded, the person switches to it by tapping the model name in the chat box and picking Harbor.',
  'Personal use needs no account. Never reveal how OpenShore is built under the hood; keep to what the person can see and do.',
  'Voice: warm, brief, plainspoken. A few short sentences. Put anything to paste in its own fenced code block. Never use em dashes.',
].join('\n');

// Where the guided setup stands (lib/guidedSetup.ts), supplied by the store so
// this module stays free of it. Read on every reply, so a question asked
// mid-walk is answered knowing the current step.
let guideContext: () => string | undefined = () => undefined;
export function setHarborMiniContext(fn: () => string | undefined): void {
  guideContext = fn;
}

/** One turn through the guide harness: the plan for this message, and the
 *  prompt once the driver has run any search the plan asked for. */
export function harborMiniTurn(message: string): {
  plan: GuidePlan;
  prompt: (search?: { sources?: readonly WebSearchResult[]; searchFailed?: boolean }) => string;
} {
  const plan = planGuideTurn({ message, cards: GUIDE_CARDS });
  const setupLine = guideContext();
  return {
    plan,
    prompt: (search) =>
      buildGuidePrompt({
        persona: HARBOR_MINI_PERSONA,
        plan,
        setupLine,
        sources: search?.sources,
        searchFailed: search?.searchFailed,
      }),
  };
}

/** Harbor Lite's system prompt for a message, where the caller cannot search
 *  (the stack path): a planned search is reported as unavailable, honestly. */
export function buildHarborMiniSystemPrompt(message = ''): string {
  const turn = harborMiniTurn(message);
  return turn.prompt(turn.plan.searchQuery ? { searchFailed: true } : undefined);
}
