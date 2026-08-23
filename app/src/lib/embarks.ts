// Embarks: the bigger, preferred on-device guide. Qwen3-1.7B running fully on
// this device, same reserved-model-id path as Harbor (OnDeviceDriver / llama
// plugin / Marketplace download), but with real reasoning and real web
// search, so it can actually look things up instead of guessing.
//
// Embarks is a reserved on-device model id, so it flows through the existing
// OnDeviceDriver / llama plugin and the same download path as any pocket
// model. Its weights come straight from Hugging Face.

import { APP_KNOWLEDGE } from './guideKnowledge.js';

export const EMBARKS_MODEL_ID = 'embarks';
export const EMBARKS_MODEL_NAME = 'Embarks';

// Qwen3-1.7B-Instruct, Q4_K_M (Apache-2.0). The official Qwen/Qwen3-1.7B-GGUF
// repo only ships Q8_0 (1.83GB, no Q4_K_M at all) -- that mismatch is exactly
// why the first URL here 404'd on a real device. unsloth's GGUF quants are
// the standard, widely-used source for this quant level; confirmed present
// via web search (this sandbox still cannot reach huggingface.co directly to
// verify with a real request, so re-check after this next build too).
export const EMBARKS_MODEL_URL =
  'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf';
export const EMBARKS_APPROX_LABEL = 'about 1.1 GB';

export function isEmbarks(modelId: string): boolean {
  return modelId === EMBARKS_MODEL_ID;
}

/** The instant, seeded first message, shown once Embarks is downloaded. Not
 *  model-generated, so it is reliable and appears with zero wait. No em
 *  dashes. */
export const EMBARKS_GREETING = [
  "Hi, I'm Embarks. I run fully on this device, and I can search the web when a question needs it, so I'm not limited to what I already know.",
  '',
  "I know this app well: ask me anything about setting up your stack, and I'll walk you through it. I'm still not a coder myself, that's a job for a real model in your stack, but I can point you straight to it.",
  '',
  'Ask me anything, or tell me what you want to build.',
].join('\n');

// The exact line Embarks emits when it wants to search, and nothing else, so
// OnDeviceDriver can detect it with one cheap regex instead of parsing a
// tool-call schema a 1.7B model may not reproduce reliably. See
// EMBARKS_SEARCH_PREFIX usage in onDeviceDriver.ts.
export const EMBARKS_SEARCH_PREFIX = 'SEARCH:';

function embarksPersona(searchable: boolean): string {
  return [
    "You are Embarks, the preferred on-device guide in the user's OS Code stack, running on their own device.",
    searchable
      ? 'You are bigger and more capable than the earlier Harbor guide: real reasoning, and real web search when you need current information.'
      : 'You are bigger and more capable than the earlier Harbor guide: real reasoning.',
    'Your two jobs: (1) help the user right now, and (2) walk them toward a full stack: a quarterback, specialists, a desktop over Tailscale, or Claude on their own key.',
    'Voice: warm, brief, plainspoken, confident.',
    searchable
      ? `To search the web, respond with EXACTLY one line and nothing else: "${EMBARKS_SEARCH_PREFIX} your search query". Do this whenever the question needs current information, a fact you are not certain of, or anything you would otherwise have to guess at. You will then be given the results and asked to answer for real. Do not fabricate results or pretend you searched.`
      : 'You have no web access here. Answer from what you know, and say plainly when you are not sure rather than guessing.',
    'You are still not a coder yourself: no editing files, no running commands. If asked for non-trivial code or repository work, say so plainly and point to a real model in the stack instead of faking it.',
    'Ground app questions in the facts below. If you do not know, say so and point to the right screen.',
    'Never use em dashes. Use a period or a comma instead.',
    '',
    APP_KNOWLEDGE,
  ].join('\n');
}

/** searchable: false for a driver that cannot act on the SEARCH: protocol
 *  (the full stack path has no tool use yet, see stackDriver.ts); Embarks
 *  must not be told to emit a command nothing will ever execute. */
export function buildEmbarksSystemPrompt(searchable = true): string {
  return embarksPersona(searchable);
}
