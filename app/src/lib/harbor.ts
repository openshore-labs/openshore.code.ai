// Harbor: the mobile coder. A small coder running fully on this device for
// short edits, with web search so it can look things up instead of guessing;
// longer work happens on the person's computer (DeepBlue). Harbor Lite
// (harborMini.ts) is the tiny built-in guide; a fresh stack seeds with Harbor
// Lite to keep the first-run download small, and Harbor is the coder a person
// adds when they want to code on the phone. Founder scope 2026-09-21: the three
// curated models are Harbor Lite (pocket guide), Harbor (this, the mobile
// coder), and DeepBlue (the desktop coder).
//
// HARBOR_MODEL_ID is a stable slot, not tied to one set of weights: as the
// model changes, HARBOR_MODEL_VERSION bumps and HARBOR_MODEL_URL points at the
// new weights, but the id and the "Harbor" name stay put. Version history:
// 1.x was the Qwen3-1.7B guide; 2.0 was Qwen 2.5 Coder 3B, pulled 2026-09-24
// because it is under the Qwen Research License (non-commercial only, see
// os-code/DECISIONS.md); 2.1 is Qwen2.5-Coder-1.5B-Instruct (Apache 2.0).
//
// The native store keys the file by the slot id and will not re-download over
// a file that is already there, so a device holding an older Harbor keeps it
// until the person acts: harborIsStale() drives a card that offers the new
// Harbor and the removal of the old file, and nothing is deleted silently.
//
// Harbor is a reserved on-device model id, so it flows through the existing
// OnDeviceDriver / llama plugin and the same download path as any pocket
// model. Its weights come straight from Hugging Face.

import { APP_KNOWLEDGE } from './guideKnowledge.js';

export const HARBOR_MODEL_ID = 'harbor';
export const HARBOR_MODEL_VERSION = '2.1';
// The display name is just "Harbor" (the version rides the slot, not the copy).
export const HARBOR_MODEL_NAME = 'Harbor';

// The honest name of the weights behind the slot, for the license lines
// (Settings, MODEL-LICENSES.md). Copy that speaks as Harbor never names them.
export const HARBOR_WEIGHTS_NAME = 'Qwen2.5-Coder-1.5B-Instruct';
export const HARBOR_ATTRIBUTION = `On this iPhone, Harbor is ${HARBOR_WEIGHTS_NAME}, used under the Apache License 2.0.`;

// Qwen2.5-Coder-1.5B-Instruct, Q4_K_M (Apache-2.0), from unsloth's GGUF repo
// (the standard source for this quant level, the same we use for Harbor Lite).
// About 1 GB. VERIFY the exact filename/casing resolves (200) before a build;
// this sandbox cannot reach huggingface.co to check it.
export const HARBOR_MODEL_URL =
  'https://huggingface.co/unsloth/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-1.5B-Instruct-Q4_K_M.gguf';
export const HARBOR_APPROX_LABEL = 'about 1 GB';

// The one-sentence byline shown under the Harbor row in Settings. What it is,
// in plain words: no size, no number, no benchmark.
export const HARBOR_BYLINE =
  'A small coder on this iPhone for short edits, with web search; longer work happens on your computer.';

export function isHarbor(modelId: string): boolean {
  return modelId === HARBOR_MODEL_ID;
}

/** Is the Harbor on this device older weights than the current slot? A device
 *  that downloaded Harbor before the version was recorded (the 2.0 Qwen 2.5
 *  Coder 3B, or the 1.x guide before it) has no version, so it reads stale.
 *  Stale never deletes anything: it only shows the upgrade card. */
export function harborIsStale(s: { harborReady?: boolean; harborVersion?: string }): boolean {
  return Boolean(s.harborReady) && s.harborVersion !== HARBOR_MODEL_VERSION;
}

/** The upgrade card's copy. The old file stays until the person taps. */
export const HARBOR_UPGRADE_TITLE = 'A new Harbor is ready';
export const HARBOR_UPGRADE_LINE = `This iPhone has an older Harbor that OpenShore no longer ships. Get the new one (${HARBOR_APPROX_LABEL}) in its place, or just remove the old file to free the space. Nothing is removed until you tap.`;

/** The instant, seeded first message, shown once Harbor is downloaded. Not
 *  model-generated, so it is reliable and appears with zero wait. No em
 *  dashes. */
export const HARBOR_GREETING = [
  "Hi, I'm Harbor, a small coder that lives on this iPhone. I'm here for short edits and quick explanations, and I can search the web when a question needs it.",
  '',
  'Longer work, like changes across a whole repository, happens on your computer. Dock to it, or pick a bigger model in your stack, and I will hand it over.',
  '',
  'What do you want to fix first?',
].join('\n');

// The exact line Harbor emits when it wants to search, and nothing else, so
// OnDeviceDriver can detect it with one cheap regex instead of parsing a
// tool-call schema a small model may not reproduce reliably. See
// HARBOR_SEARCH_PREFIX usage in onDeviceDriver.ts.
export const HARBOR_SEARCH_PREFIX = 'SEARCH:';

function harborPersona(searchable: boolean): string {
  return [
    "You are Harbor, a small coder running fully on the user's iPhone, part of their OpenShore stack.",
    searchable
      ? 'You are for short edits and quick explanations, and you can search the web when you need current information.'
      : 'You are for short edits and quick explanations.',
    "Your main job is coding: write and explain code right here in chat for small, self-contained tasks. You do not edit files or run commands yourself yet. Longer work happens on the person's computer: for multi-file changes, repository work, or anything heavy, say so plainly and point to docking to the computer or a bigger model in the stack, instead of overreaching.",
    'Never claim a benchmark score, a model size, or a speed for yourself.',
    'You can also answer questions about the OpenShore app, grounded in its own repository. Explain any front-end feature or setup step, and take the person as deep as they want on setting their system up. Never reveal backend build internals, infrastructure, or how OpenShore is implemented under the hood; keep to what the person can see and do in the app.',
    'Voice: warm, brief, plainspoken, confident.',
    searchable
      ? `To search the web, respond with EXACTLY one line and nothing else: "${HARBOR_SEARCH_PREFIX} your search query". Do this whenever the question needs current information, a fact you are not certain of, or anything you would otherwise have to guess at. You will then be given the results and asked to answer for real. Do not fabricate results or pretend you searched.`
      : 'You have no web access here. Answer from what you know, and say plainly when you are not sure rather than guessing.',
    'Ground app questions in the facts below. If you do not know, say so and point to the right screen.',
    'Whenever the person must paste something (a command, a query, a config line), put it in its own fenced code block, one per step, nothing else in the block. Never inline a command in a sentence.',
    'Never use em dashes. Use a period or a comma instead.',
    '',
    APP_KNOWLEDGE,
  ].join('\n');
}

/** searchable: false for a driver that cannot act on the SEARCH: protocol
 *  (the full stack path has no tool use yet, see stackDriver.ts); Harbor
 *  must not be told to emit a command nothing will ever execute. */
export function buildHarborSystemPrompt(searchable = true): string {
  return harborPersona(searchable);
}
