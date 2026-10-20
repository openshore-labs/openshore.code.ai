// Harbor: the mobile coder. Qwen3.5 4B running fully on this device, with
// real reasoning, real web search and its own eyes: it reads screenshots,
// photos and the frames of a video, so it can write and explain real code,
// look things up instead of guessing, and see what the person sees. Harbor
// Lite (harborMini.ts) is the tiny built-in guide; a fresh stack seeds with
// Harbor Lite to keep the first-run download small, and Harbor is the coder a
// person adds when they want to build on the phone. Maintainer scope
// 2026-09-21: the three curated models are Harbor Lite (pocket guide), Harbor
// (this, the mobile coder), and DeepBlue (the desktop coder).
//
// HARBOR_MODEL_ID is a stable slot, not tied to one set of weights: as the
// model improves, HARBOR_MODEL_VERSION bumps and HARBOR_MODEL_URL points at the
// new weights, but the id and the "Harbor" name stay put so a device that
// already has Harbor just re-downloads in place. Version 2.0 was the recast from
// the earlier Qwen3-1.7B guide to the Qwen 2.5 Coder 3B mobile coder; 3.0 moved
// to Qwen3-4B-Instruct-2507 because the 3B is under the Qwen Research License
// (non-commercial) and Harbor must be sellable (2026-09-30); 4.0 moves to
// Qwen3.5 4B, a model that reads pictures as well as words, with its vision
// file beside the weights (founder, 2026-10-18: Harbor is the quarterback that
// handles everything). A device still holding older weights drops them at
// launch (harborWeightsStale), and the person gets the new Harbor from its row.
//
// Harbor is a reserved on-device model id, so it flows through the existing
// OnDeviceDriver / llama plugin and the same download path as any pocket
// model. Its weights come straight from Hugging Face.

import { NO_SEARCH_NOTE, SEARCH_PROTOCOL_NOTE } from 'os-code/protocol';
import { APP_KNOWLEDGE } from './guideKnowledge.js';
import { thisDeviceNoun } from './deviceNoun.js';

export const HARBOR_MODEL_ID = 'harbor';
export const HARBOR_MODEL_VERSION = '4.0';
// The display name is just "Harbor" (the version rides the slot, not the copy).
export const HARBOR_MODEL_NAME = 'Harbor';

// Qwen3.5 4B, Q4_K_M (Apache License 2.0, free for commercial use), from
// unsloth's GGUF repo (the standard source for this quant level, the same we
// use for Harbor Lite). The same file as the catalog's qwen3.5-4b onDevice
// entry. 2,740,937,888 bytes, and it needs a 6 GB phone (the catalog's
// minRamGB). Checked on the box 2026-10-18: the URL resolves (302, then 200)
// and the file's sha256 is 00fe7986...11a4, the repo's own LFS hash.
export const HARBOR_MODEL_URL =
  'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf';

/** Harbor's vision file (the multimodal projector, "mmproj"), kept on the
 *  device under its own id beside the weights. The runner opens it the first
 *  time a picture arrives, so a chat in words never pays its memory. */
export const HARBOR_VISION_MODEL_ID = 'harbor-vision';
// The F16 projector from the same repo, the file llama.cpp's mtmd reads. The
// repo offers no Q8_0 projector (F16, BF16 and F32 only), and BF16 is no
// smaller, so F16 is the smallest. 672,423,616 bytes; checked as above, sha256
// cd88edcf...f864. With the weights, 3.41 GB, said as about 3.5 GB.
export const HARBOR_VISION_URL =
  'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/mmproj-F16.gguf';

/** Harbor's download, said as one unit (the weights and the vision file):
 *  no-break spaces hold "about 3.5 GB" on one line, so a narrow window (Slide
 *  Over, 320pt) never leaves "3.5 GB" alone on the next. */
export const HARBOR_APPROX_LABEL = 'about\u00a03.5\u00a0GB';
/** The honest name of the weights behind the slot, for attribution copy. */
export const HARBOR_WEIGHTS_NAME = 'Qwen3.5 4B';

/** The window Harbor loads with. Its system prompt (persona and app facts)
 *  runs near 2,800 tokens by the app's estimate, and a picture takes up to
 *  HARBOR_IMAGE_TOKENS more, so the device default of 4,096 would leave no
 *  room for the conversation. Qwen3.5's hybrid attention keeps most layers
 *  free of a growing cache, so 8,192 costs a few hundred MB, not gigabytes. */
export const HARBOR_CONTEXT_TOKENS = 8192;

/** The most tokens one picture takes in Harbor's window: the native runner's
 *  cap (LlamaRunner.imageMaxTokens), about 700 pixels a side. */
export const HARBOR_IMAGE_TOKENS = 512;

/** The most pictures one Harbor turn carries. A video's frames are spread
 *  across this many; more would crowd out the conversation. */
export const HARBOR_MAX_IMAGES = 4;

/** How Harbor picks each next word: Qwen's own recommendation for an answer
 *  without thinking (temperature 0.7, top-p 0.8, top-k 20, no min-p), with a
 *  light repeat penalty, since code repeats brackets and names on purpose.
 *  The Harbor eval runs with these same numbers. */
export const HARBOR_SAMPLING = {
  temperature: 0.7,
  topK: 20,
  topP: 0.8,
  minP: 0,
  repeatPenalty: 1.05,
} as const;

/** A coding request thinks first; everything else answers at once (founder,
 *  2026-10-19: "capability to be right and build code is the main priority",
 *  and a coding request is not expected back instantly, unlike chat). On the
 *  box, the first eight code cases passed 4 of 8 without a thought and 6 of 8
 *  with one. */
const CODE_FENCE = /```/;
const CODE_VERB =
  /\b(write|implement|code|build|create|make|fix|debug|refactor|rewrite|optimi[sz]e|convert|port|translate)\b/i;
const CODE_NOUN =
  /\b(function|method|class|script|program|component|regex|regular expression|algorithm|sql|query string|unit tests?|bug|endpoint|snippet|code)\b/i;

/** A turn with pictures answers at once for now: the eval cannot yet hand
 *  Ollama a capped thought beside a picture, so that path has no number. */
export function harborThinks(message: string, pictures = false): boolean {
  if (pictures) return false;
  if (CODE_FENCE.test(message)) return true;
  return CODE_VERB.test(message) && CODE_NOUN.test(message);
}

/** A question about the world searches before Harbor writes a word; left to
 *  decide, a 4B model skips searches it needs (on the box, 2026-10-19: every
 *  wrong research answer was a skipped search, and searching by default took
 *  10 held-out questions from 5 right to 9, and answered faster). It skips
 *  only what stays true (how to do something, a concept, what a term means),
 *  a coding request, and a question about the app, which Harbor's own facts
 *  answer. A missed search costs a wrong answer; an extra one costs a
 *  search, since the answer then takes one pass instead of two. */
const STABLE =
  /^\s*(how (do|can|should|would|to) |explain|define|what('s| is| are) the difference|why (do|does|is|are|did) |what does .+ mean|can you (explain|show|help me (write|fix|understand)))/i;
const ABOUT_THE_APP =
  /\b(openshore|harbor(?![-\w])|harbor lite|deepblue|vault|stack|dock(ing|ed)?|pair(ing)?|tailscale|cloud connections|crew|routines?|local library|my keys?|api keys?|this app|the app)\b/i;
/** A question, not a request to do something ("Run npm test", "Convert 72 F"). */
const QUESTION =
  /(\?\s*$)|^\s*(who|what|when|where|which|why|how|is|are|was|were|does|do|did|can|could|has|have|will|should)\b/i;

export function harborSearchesByDefault(question: string, pictures = false): boolean {
  if (pictures || harborThinks(question) || !QUESTION.test(question)) return false;
  if (ABOUT_THE_APP.test(question) || STABLE.test(question)) return false;
  return true;
}

/** The most tokens a coding request's thought may take before the runner
 *  closes it and the answer starts (LlamaRunner's thought cutoff). The answer
 *  keeps its own cap beside it. */
export const HARBOR_THINK_BUDGET = 2048;

/** How Harbor picks words while it thinks: Qwen's own numbers for thinking on
 *  a precise task (temperature 0.6, top-p 0.95, top-k 20), with the same light
 *  repeat penalty as its answers. */
export const HARBOR_THINK_SAMPLING = {
  temperature: 0.6,
  topK: 20,
  topP: 0.95,
  minP: 0,
  repeatPenalty: 1.05,
} as const;

/** What the runner writes when a thought reaches its budget, the wording
 *  Qwen documents for cutting a thought short; LlamaRunner.swift's
 *  PromptFormat.thoughtCutoff says the same (a test holds the two together). */
export const HARBOR_THOUGHT_CUTOFF =
  '\n\nConsidering the limited time by the user, I have to give the solution based on the thinking directly now.\n</think>\n\n';

// Whether Harbor's vision file is on this device, mirrored from settings by
// the store on load and on every change (the chainOfThought.ts pattern: the
// store imports the drivers, so they cannot import the store).
let visionReady = false;

export function setHarborVision(ready: boolean): void {
  visionReady = ready;
}

/** Whether Harbor can read a picture on this device right now. */
export function harborReadsImages(): boolean {
  return visionReady;
}

// The byline shown under the Harbor row in Settings. Harbor is the coder that
// runs on the phone, a step up from the built-in Harbor Lite guide. It is a
// coding model, not an agent: the agent is DeepBlue (brand sweep 2026-09-24).
export const HARBOR_BYLINE = `A coding model that runs fully on ${thisDeviceNoun()}. It writes and explains code, reads screenshots and photos, and searches the web.`;

export function isHarbor(modelId: string): boolean {
  return modelId === HARBOR_MODEL_ID;
}

/** Are the Harbor weights on this device from an older version of the slot?
 *  A download records HARBOR_MODEL_VERSION; weights with no record predate
 *  3.0 (the research-licensed 3B), so they count as stale too. */
export function harborWeightsStale(recorded: string | undefined): boolean {
  return recorded !== HARBOR_MODEL_VERSION;
}

/** The instant, seeded first message, shown once Harbor is downloaded. Not
 *  model-generated, so it is reliable and appears with zero wait. No em
 *  dashes. */
export const HARBOR_GREETING = [
  `Hi, I'm Harbor. I'm a coding model that runs fully on ${thisDeviceNoun()}. I can read a screenshot or a photo you send, and I can search the web when a question needs it, so I'm not limited to what I already know.`,
  '',
  "Ask me to write or explain code, or ask how something in the app works and I'll walk you through it. For multi-file work on a whole repository, point me at a bigger model in your stack or dock to your computer.",
  '',
  'What do you want to build?',
].join('\n');

/** What Harbor is told about pictures, while its vision file is on the device. */
export const HARBOR_PICTURE_NOTE =
  'When the person sends a picture (a screenshot, a photo, a chart, or frames from a video, in order), read it closely before you answer: quote any text or error in it exactly, and say plainly what you cannot make out instead of guessing.';

/** Today's date, read from the device's clock each time the prompt is built,
 *  so "the latest" or "now" is read against today rather than the model's
 *  training, and its searches name this year (on the box, 2026-10-19, it
 *  searched for "latest iOS version 2025" without it). */
export function harborDateLine(now: Date = new Date()): string {
  const day = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `Today is ${day}.`;
}

function harborPersona(searchable: boolean, searchNote: string, sees: boolean): string {
  return [
    "You are Harbor, a coding model running fully on the user's phone, part of their OpenShore stack.",
    searchable
      ? 'You are bigger and more capable than the tiny built-in Harbor Lite guide: real reasoning, and real web search when you need current information.'
      : 'You are bigger and more capable than the tiny built-in Harbor Lite guide: real reasoning.',
    'Your main job is coding: write and explain real code right here in chat for small, self-contained tasks. You do not edit files or run commands yourself yet. For multi-file changes, repository work, or anything heavy, know your limit: say so plainly and point to a bigger model in the stack, or to docking to the computer, instead of overreaching.',
    sees ? HARBOR_PICTURE_NOTE : undefined,
    'You can also answer questions about the OpenShore app, grounded in its own repository. Explain any front-end feature or setup step, and take the person as deep as they want on setting their system up. Never reveal backend build internals, infrastructure, or how OpenShore is implemented under the hood; keep to what the person can see and do in the app.',
    'An everyday question that is not about code or the app gets a plain answer, and then you stop. Bring up OpenShore only when the person asks about the app; never add a note about what OpenShore is, does, or does not do.',
    'Voice: warm, brief, plainspoken, confident.',
    harborDateLine(),
    searchNote,
    'Ground app questions in the facts below. If you do not know, say so and point to the right screen.',
    'Whenever the person must paste something (a command, a query, a config line), put it in its own fenced code block, one per step, nothing else in the block. Never inline a command in a sentence.',
    'Never use em dashes. Use a period or a comma instead.',
    '',
    APP_KNOWLEDGE,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');
}

/** searchable: false when the web is out of reach (the Offline profile);
 *  Harbor must not be told to emit a command nothing will ever execute.
 *  `searchNote` is the search line for this pass when the driver knows better
 *  (the answer pass after a search, drivers/searchTurn.ts). `sees` adds the
 *  picture line, by default while the vision file is on this device. */
export function buildHarborSystemPrompt(
  searchable = true,
  searchNote: string = searchable ? SEARCH_PROTOCOL_NOTE : NO_SEARCH_NOTE,
  sees: boolean = harborReadsImages(),
): string {
  return harborPersona(searchable, searchNote, sees);
}
