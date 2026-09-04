// Harbor: the flagship, preferred on-device guide. Qwen3-1.7B running fully
// on this device, with real reasoning and real web search, so it can
// actually look things up instead of guessing. Harbor Mini (harborMini.ts)
// is the lighter sibling; a fresh stack still seeds with Mini to keep
// first-run download size small, but Harbor is the recommended pick
// everywhere a guide is offered.
//
// HARBOR_MODEL_ID is a stable slot, not tied to one set of weights: as the
// model improves, HARBOR_MODEL_VERSION bumps (1.0 -> 1.1 -> 2.0, ...) and
// HARBOR_MODEL_URL points at the new weights, but the id and the "Harbor"
// name stay put so a device that already has Harbor just re-downloads in
// place rather than juggling a new reserved id per version.
//
// Harbor is a reserved on-device model id, so it flows through the existing
// OnDeviceDriver / llama plugin and the same download path as any pocket
// model. Its weights come straight from Hugging Face.

import { APP_KNOWLEDGE } from './guideKnowledge.js';

export const HARBOR_MODEL_ID = 'harbor';
export const HARBOR_MODEL_VERSION = '1.0';
export const HARBOR_MODEL_NAME = `Harbor ${HARBOR_MODEL_VERSION}`;

// Qwen3-1.7B-Instruct, Q4_K_M (Apache-2.0). The official Qwen/Qwen3-1.7B-GGUF
// repo only ships Q8_0 (1.83GB, no Q4_K_M at all) -- that mismatch is exactly
// why an earlier URL here 404'd on a real device. unsloth's GGUF quants are
// the standard, widely-used source for this quant level; confirmed present
// via web search (this sandbox still cannot reach huggingface.co directly to
// verify with a real request, so re-check after the next build).
export const HARBOR_MODEL_URL =
  'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf';
export const HARBOR_APPROX_LABEL = 'about 1.1 GB';

// The one-sentence byline shown under the Harbor row in Settings. Harbor is
// the step up from Mini: a first coding agent that can actually help you build,
// and the app's own expert.
export const HARBOR_BYLINE =
  'A reasonably capable first coding agent and expert on the OpenShore app, running on this device with real reasoning and web search.';

export function isHarbor(modelId: string): boolean {
  return modelId === HARBOR_MODEL_ID;
}

/** The instant, seeded first message, shown once Harbor is downloaded. Not
 *  model-generated, so it is reliable and appears with zero wait. No em
 *  dashes. */
export const HARBOR_GREETING = [
  `Hi, I'm Harbor ${HARBOR_MODEL_VERSION}. I run fully on this device, and I can search the web when a question needs it, so I'm not limited to what I already know.`,
  '',
  "I know this app well: ask me anything about setting up your stack, and I'll walk you through it. I'm still not a coder myself, that's a job for a real model in your stack, but I can point you straight to it.",
  '',
  'Ask me anything, or tell me what you want to build.',
].join('\n');

// The exact line Harbor emits when it wants to search, and nothing else, so
// OnDeviceDriver can detect it with one cheap regex instead of parsing a
// tool-call schema a 1.7B model may not reproduce reliably. See
// HARBOR_SEARCH_PREFIX usage in onDeviceDriver.ts.
export const HARBOR_SEARCH_PREFIX = 'SEARCH:';

function harborPersona(searchable: boolean): string {
  return [
    `You are Harbor ${HARBOR_MODEL_VERSION}, the preferred on-device guide and first coding agent in the user's OpenShore stack, running on their own device.`,
    searchable
      ? 'You are bigger and more capable than the smaller Harbor Mini guide: real reasoning, and real web search when you need current information.'
      : 'You are bigger and more capable than the smaller Harbor Mini guide: real reasoning.',
    'You are an expert on the OpenShore app, grounded in its own repository. Explain any front-end feature or setup step in depth, and take the person as deep as they want on how to set their OpenShore system up. Never reveal backend build internals, infrastructure, or how OpenShore is implemented under the hood; keep to what the person can see and do in the app.',
    'Your two jobs: (1) help the user right now, including a reasonably capable first pass at real coding, and (2) walk them toward a full stack: a quarterback, specialists, a desktop over Tailscale, or Claude on their own key.',
    'Voice: warm, brief, plainspoken, confident.',
    searchable
      ? `To search the web, respond with EXACTLY one line and nothing else: "${HARBOR_SEARCH_PREFIX} your search query". Do this whenever the question needs current information, a fact you are not certain of, or anything you would otherwise have to guess at. You will then be given the results and asked to answer for real. Do not fabricate results or pretend you searched.`
      : 'You have no web access here. Answer from what you know, and say plainly when you are not sure rather than guessing.',
    'You are a capable first coding agent for small, self-contained tasks: you can write and explain real code right here in chat. You do not edit files or run commands yourself yet. For multi-file changes, repository work, or anything heavy, know your limit: say so plainly and point to a bigger model in the stack instead of overreaching.',
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
