// Harbor: the mobile coder. Qwen 2.5 Coder 3B running fully on this device,
// with real reasoning and real web search, so it can write and explain real
// code and look things up instead of guessing. Harbor Lite (harborMini.ts) is
// the tiny built-in guide; a fresh stack seeds with Harbor Lite to keep the
// first-run download small, and Harbor is the coder a person adds when they
// want to build on the phone. Founder scope 2026-09-21: the three curated
// models are Harbor Lite (pocket guide), Harbor (this, the mobile coder), and
// DeepBlue (the desktop coder).
//
// HARBOR_MODEL_ID is a stable slot, not tied to one set of weights: as the
// model improves, HARBOR_MODEL_VERSION bumps and HARBOR_MODEL_URL points at the
// new weights, but the id and the "Harbor" name stay put so a device that
// already has Harbor just re-downloads in place. Version 2.0 is the recast from
// the earlier Qwen3-1.7B guide to the Qwen 2.5 Coder 3B mobile coder.
//
// Harbor is a reserved on-device model id, so it flows through the existing
// OnDeviceDriver / llama plugin and the same download path as any pocket
// model. Its weights come straight from Hugging Face.

import { APP_KNOWLEDGE } from './guideKnowledge.js';

export const HARBOR_MODEL_ID = 'harbor';
export const HARBOR_MODEL_VERSION = '2.0';
// The display name is just "Harbor" (the version rides the slot, not the copy).
export const HARBOR_MODEL_NAME = 'Harbor';

// Qwen2.5-Coder-3B-Instruct, Q4_K_M (Qwen Research License, not Apache: research
// and non-commercial use, commercial use needs Qwen's permission; checked on the
// model card 2026-09-24), from unsloth's GGUF repo (the
// standard source for this quant level, the same we use for Harbor Lite). About
// 1.9 GB. VERIFY the exact filename/casing resolves (200) before a build; this
// sandbox cannot reach huggingface.co to check it.
export const HARBOR_MODEL_URL =
  'https://huggingface.co/unsloth/Qwen2.5-Coder-3B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf';
export const HARBOR_APPROX_LABEL = 'about 1.9 GB';

// The byline shown under the Harbor row in Settings. Harbor is the coder that
// runs on the phone, a step up from the built-in Harbor Lite guide. It is a
// coding model, not an agent: the agent is DeepBlue (brand sweep 2026-09-24).
export const HARBOR_BYLINE =
  'A coding model that runs fully on your phone. It writes and explains code and searches the web.';

export function isHarbor(modelId: string): boolean {
  return modelId === HARBOR_MODEL_ID;
}

/** The instant, seeded first message, shown once Harbor is downloaded. Not
 *  model-generated, so it is reliable and appears with zero wait. No em
 *  dashes. */
export const HARBOR_GREETING = [
  "Hi, I'm Harbor. I'm a coding model that runs fully on this phone, and I can search the web when a question needs it, so I'm not limited to what I already know.",
  '',
  "Ask me to write or explain code, or ask how something in the app works and I'll walk you through it. For multi-file work on a whole repository, point me at a bigger model in your stack or dock to your computer.",
  '',
  'What do you want to build?',
].join('\n');

// The exact line Harbor emits when it wants to search, and nothing else, so
// OnDeviceDriver can detect it with one cheap regex instead of parsing a
// tool-call schema a small model may not reproduce reliably. See
// HARBOR_SEARCH_PREFIX usage in onDeviceDriver.ts.
export const HARBOR_SEARCH_PREFIX = 'SEARCH:';

function harborPersona(searchable: boolean): string {
  return [
    "You are Harbor, a coding model running fully on the user's phone, part of their OpenShore stack.",
    searchable
      ? 'You are bigger and more capable than the tiny built-in Harbor Lite guide: real reasoning, and real web search when you need current information.'
      : 'You are bigger and more capable than the tiny built-in Harbor Lite guide: real reasoning.',
    'Your main job is coding: write and explain real code right here in chat for small, self-contained tasks. You do not edit files or run commands yourself yet. For multi-file changes, repository work, or anything heavy, know your limit: say so plainly and point to a bigger model in the stack, or to docking to the computer, instead of overreaching.',
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
