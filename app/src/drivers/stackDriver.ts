// The phone-side router and play runner. Chatting with "your stack" runs
// through here. A capable reasoning anchor frames the prompt and composes a
// play (an ordered set of handoffs to the stack's specialists with
// dependencies), briefs the user as todos-with-owners, runs the steps in
// dependency order handing each to its owner, re-plans at bounded checkpoints,
// and streams a final synthesis (see lib/play.ts for the pure core). The flow
// degrades to a single routed turn whenever the anchor is a weak or unreachable
// model, the plan will not parse, or the play is a single step, so a modest
// stack still just answers. Image turns route by capability (routeVision), and
// the Codemagic tool loop keeps its own single-turn path.
//
// Backends: on-device (llama.cpp), Anthropic, or an OpenAI-compatible cloud
// endpoint. A play step that must edit files or run commands (needsTools) runs
// on the paired computer's engine when docked, over one shared RemoteDriver
// session, with its real tool approvals surfaced in the chat; when not docked
// (or no local workspace is bound) the step is described instead. Still v1: the
// fallback classifier is a keyword heuristic, not a model; on-device models are
// text-only (no vision, not driven for autonomous sub-steps); the image-gen
// category routes as text and does not yet render images; "home" models require
// pairing.
import Anthropic from '@anthropic-ai/sdk';
import type { PluginListenerHandle } from '@capacitor/core';
import type {
  ApprovalAnswer,
  ApprovalRequest,
  FetchLike,
  HarnessCurrentsHandle,
  ProvenanceFields,
  VaultPrivacy,
} from 'os-code/protocol';
import {
  LOCAL_ONLY_STUB,
  uxStandardPrompt,
  humanizerStandardPrompt,
  JevAdvisor,
  ThinkTagSplitter,
  mergeProvenance,
  readFrontmatter,
  readProvenance,
  type ModelClass,
  type ThoughtPiece,
} from 'os-code/protocol';
import {
  activeHarnessId,
  harnessCurrentInfo,
  type HarnessCurrentId,
} from '../lib/harnessCurrents.js';
import { SHIPS_CURRENTS } from '../lib/focus.js';
import { Llama } from '../lib/llamaPlugin.js';
import {
  ABORT_BEAT_MS,
  DEVICE_CONTEXT_TOKENS,
  STALL_TIMEOUT_MS,
  emptyReplyMessage,
  ensureDeviceModel,
  fitDeviceHistory,
  forgetDeviceModel,
} from './deviceModel.js';
import { secretGet, storeGetJson } from '../lib/platform.js';
import {
  CODEMAGIC_TOOL_NAME,
  codemagicOpenAiTool,
  codemagicSystemNote,
  codemagicToolSpec,
  parseCodemagicArgs,
  runCodemagicTool,
  type CodemagicToolInput,
} from '../lib/codemagicTool.js';
import { nativeFetch } from '../lib/nativeFetch.js';
import { streamingFetch } from '../lib/streamingFetch.js';
import {
  chainOfThoughtLine,
  chainOfThoughtOn,
  claudeRequestThinking,
} from '../lib/chainOfThought.js';
import {
  ProviderUnavailable as RouteUnavailable,
  SLOW_START_LINE,
  abortError,
  anthropicClient,
  isAbortError,
  openAiCompatibleClient,
  raceAbort,
  warmingLine,
  watchFirstWord,
  type OaiMessage,
  type OpenAiSeat,
  type ProviderClient,
  type ProviderEvent,
  type ProviderToolCall,
} from './providerClient.js';
import { SearchTurn } from './searchTurn.js';
import { claudeHistoryCache, claudeSystem, promptCacheOn } from '../lib/claudeCache.js';
import { PROVIDERS, providerInfo, providerSecretKey } from '../lib/providers.js';
import { imageBlockParts, type Attachment } from '../lib/attachments.js';
import { claudeModelLabel, visionFallbackClaudeModel } from '../lib/claudeModels.js';
import { buildVisionContent, describeError, opensOnUser } from './cloudClaudeDriver.js';
import { frameLabel, videoContextHeader, VIDEO_FRAMES_SYSTEM_NOTE } from '../lib/videoAttach.js';
import {
  PlanReplyFilter,
  briefTodos,
  handoffNote,
  mergeReplan,
  ownerFor,
  parsePlan,
  parseReplan,
  planPrompt,
  readySteps,
  replanPrompt,
  type Play,
  type PlayStep,
  type StepResult,
} from '../lib/play.js';
import { effortDirective } from '../lib/effort.js';
import { vaultProposalRecords } from '../lib/vaultCopy.js';
import type { SeedTurn } from '../state/types.js';
import { byomSecretKey } from '../lib/byom.js';
import { isCurrentBenchId } from '../lib/currents.js';
import { buildHarborSystemPrompt, isHarbor } from '../lib/harbor.js';
import { buildHarborMiniSystemPrompt, guidedSetupLine, isHarborMini } from '../lib/harborMini.js';
import { prepareGuideTurn, searchOffered, webOnlineNow } from '../lib/localSearch.js';
import { locationAllowed, type ProfileId } from '../lib/profiles.js';
import {
  harborRef,
  pickVisionRef,
  refName,
  type AppStack,
  type Placement,
  type StackCategory,
  type StackModelRef,
} from '../lib/stack.js';
import type { CrewAgent } from '../state/types.js';
import type { WriteGuard, WriteResult } from '../lib/gitos/providers.js';
import {
  VAULT_PROPOSALS_MAX,
  isAppVaultToolName,
  parseVaultToolArgs,
  runVaultTool,
  vaultAnthropicTool,
  vaultApproveRefusal,
  vaultArgsHelp,
  vaultOpenAiTool,
  vaultPolicyFor,
  vaultToolInputFrom,
  vaultToolSlice,
  type AppVaultToolName,
  type VaultProposal,
  type VaultToolContext,
  type VaultToolInput,
} from '../lib/vaultTool.js';
import type { ChatDriver, DriverEventSink, DriverVaultOptions, PackSeat } from './types.js';
import { DriverEmitter, isLocalOnlyFinal, textFinal } from './types.js';
import { RemoteDriver, daemonCreateSession, type DaemonTarget } from './remoteDriver.js';
import type { DriverEvent, VaultOverrides } from 'os-code/protocol';

/** Extra context a chat carries into the router: its project and its crew. */
export interface StackContext {
  projectName?: string;
  projectInstructions?: string;
  /** Crew that speaks in this chat (already scoped to project + level). */
  crew?: CrewAgent[];
  /** Humanize Writing setting: when true (the default), written output is held
   *  to the plain, specific, honest voice that avoids AI writing tells. Off
   *  drops the standard from the prompt, so the model runs on a shorter prompt. */
  humanize?: boolean;
  /** The Wayfinding Memory switch (memoryOverride): false when the person
   *  turned Memory off, so a play's engine step opens its session with project
   *  memory off. Undefined leaves the project's config in charge. App-side
   *  chats keep no project memory, so nothing else here reads it. */
  memory?: false;
  /** The device's vault switches (Vault M7, CTO L13): Notes in chats and
   *  Handoff off, and Room for notes, off-only and lower-only
   *  (`appVaultOverrides`). A play's engine step carries them the way a chat's
   *  session does; empty or undefined leaves the computer's config in charge.
   *  App-side seats read the device settings directly, not this. */
  vaultOverrides?: VaultOverrides;
  /** Codemagic Access is on (and Codemagic is connected), so the model may drive
   *  App Launch builds. Offers the codemagic tool on the Anthropic path, where
   *  native tool use runs the trigger/status/logs loop on-device. Off leaves the
   *  chat exactly as it was, single turn and tool-less. */
  codemagicAccess?: boolean;
  /** The paired computer, when docked. A play step that must edit files or run
   *  commands (needsTools) runs on the engine there, with real tool approvals
   *  surfaced in the chat. Absent means not docked, so such a step is described
   *  instead of executed. */
  daemon?: DaemonTarget;
  /** The local workspace this chat is bound to, where an engine step works. A
   *  GitHub-only or repo-less chat leaves this undefined, so a tool step is
   *  described rather than run against an invented cwd. */
  repoCwd?: string;
  /** This conversation's id, so a bench model that keeps a session of its own
   *  on another service (a Hermes box, via its session header) continues the
   *  same thread turn after turn instead of starting over per call. */
  conversationId?: string;
  /** Research (default off): a local model's web search runs on the connected
   *  Perplexity key instead of the Settings provider (see resolveSearchKey). */
  researchOn?: boolean;
  /** The Harness Current that is on (Jev), as its handle with the resolved key.
   *  When present, a paid/cloud turn is steered by Jev: it may re-route to a
   *  cheaper reachable seat (the gate) or to the seat placed for the work kind
   *  (the classifier), in one cloud call. Absent leaves routing exactly as it
   *  was. Scoped to a paid seat, so a free local turn never spends on Jev. */
  harnessCurrents?: HarnessCurrentsHandle;
  /** Prompt caching on Claude (`settings.promptCache`, default off, CTO J16,
   *  J17): on, the stable head of the system prompt goes as its own block
   *  marked for caching and the request asks for automatic caching of the
   *  growing history. Off sends the same blocks with no marker. Unset reads
   *  the live setting (`promptCacheOn`). */
  promptCache?: boolean;
}

/** The app vault seam the Stack's vault tools read and write through (Vault
 *  M5, CTO J10). The personal vault only: the store passes `teamVault` true
 *  while the team vault is the one on screen, and no tool is offered then. */
export interface StackVaultTools {
  /** The compiled privacy rules (`appVaultPrivacy`). A rejection offers no
   *  vault answer at all (fail closed). */
  privacy: () => Promise<VaultPrivacy>;
  search: VaultToolContext['search'];
  read: VaultToolContext['read'];
  resolve?: VaultToolContext['resolve'];
  /** One guarded write through the vault seam, made only after the person
   *  approves the end-of-send card. */
  write: (path: string, text: string, guard: WriteGuard) => Promise<WriteResult>;
  /** True while the team vault is the target (D15: never in context). */
  teamVault?: () => boolean;
  /** The paths an approved card wrote, for "Recently from your agent". */
  onWritten?: (paths: string[]) => void;
  /** The personal vault's `agent.folder` (Vault M7, CTO L2), read at each
   *  offer and again at approve; undefined is anywhere in the vault. */
  agentFolder?: () => string | undefined;
  /** Whether a note a model writes carries its provenance lines (CTO L9).
   *  Absent is on. */
  provenance?: () => boolean;
}

/** The Stack driver's trailing options (CTO J1, J5, J10). */
export interface StackDriverOptions extends DriverVaultOptions {
  /** The seat a ref answers as (`packSeatFor(ref, ctx)`), or null for no pack
   *  and no vault tools. Absent: no seat is known, so no pack, no vault tools,
   *  and every network seat is treated as leaving this network. */
  packSeat?: (ref: StackModelRef) => PackSeat | null;
  /** The vault tools' seam; absent offers none. */
  vaultTools?: StackVaultTools;
}

/** A seed turn, carrying the local-only mark (CTO I5) when the transcript
 *  kept it. */
export type StackSeedTurn = SeedTurn & { localOnly?: true };

/** The extra request headers a bench model carries. An Agentic Current's model
 *  (id `current-<id>`) sends one session id per conversation, which the Hermes
 *  API server reads as X-Hermes-Session-Id; other OpenAI-compatible servers
 *  ignore an unknown header, so it is harmless to send on any current. */
export function benchExtraHeaders(
  refId: string,
  conversationId: string | undefined,
): Record<string, string> {
  if (!isCurrentBenchId(refId) || !conversationId) return {};
  return { 'x-hermes-session-id': `oscode-${conversationId}` };
}

/** How a play's engine step opens its session on the paired computer.
 *  acceptEdits, the same mapping routines use: in-jail edits flow, while shell,
 *  push, and cloud spend still raise an approval into the chat. The project's
 *  name and standing instructions ride along the way a desktop-created session
 *  carries them, so the step works to the project's instructions and files
 *  project memory in the same folder, or keeps none when the Memory switch is
 *  off. projectSecrets are deliberately never sent to the docked session. */
export function engineStepSessionOpts(
  context: StackContext,
): NonNullable<Parameters<typeof daemonCreateSession>[2]> {
  return {
    permissionMode: 'acceptEdits',
    humanize: context.humanize,
    projectName: context.projectName,
    instructions: context.projectInstructions,
    ...(context.memory === false ? { memory: false } : {}),
    ...(context.vaultOverrides && Object.keys(context.vaultOverrides).length
      ? { vaultOverrides: { ...context.vaultOverrides } }
      : {}),
  };
}

/** Whether the Humanize Writing standard rides into this model's prompt. On by
 *  default; off when the person turned the setting off. On-device pocket models
 *  are skipped to protect their small context (they are not the surface where
 *  real writing happens), the same carve-out the UX standard makes; the desktop
 *  engine carries the standard through its own config, not this path. */
export function humanizerApplies(
  ref: StackModelRef,
  humanize?: boolean,
  modelClass?: ModelClass,
): boolean {
  return humanize !== false && ref.kind !== 'device' && !leanSeat(modelClass);
}

/** A seat too small to carry the long standing standards (build 2026-09-29,
 *  B2): a tiny or small model on any host. The UX standard (about 1.3k
 *  tokens) and the humanizer (about 2k) would take a third of a 8k window on
 *  every turn and push out the chat itself; the engine's own class profiles
 *  already leave them out for these seats. An unknown class keeps them. */
export function leanSeat(modelClass?: ModelClass): boolean {
  return modelClass === 'tiny' || modelClass === 'small';
}

const BASE_SYSTEM = [
  'You are OpenShore, a warm, capable coding companion.',
  'Answer directly and concretely. Use markdown, and fence code with a language tag.',
  'Whenever the person must paste something (a command, a query, a config line), put it in its own fenced code block, one per step, nothing else in the block. Never inline a command in a sentence.',
  'Never use em dashes. Use a period or a comma instead.',
].join('\n');

/** A crude keyword classifier. Placeholder for a real routing model. */
export function classifyTask(text: string): StackCategory | 'reasoning' {
  const t = text.toLowerCase();
  if (
    /\b(code|coding|function|bug|refactor|compile|regex|api|typescript|javascript|python|sql|stack ?trace|npm|git|class|import|debug)\b/.test(
      t,
    )
  )
    return 'coding';
  if (
    /\b(write|draft|essay|email|blog|copy|rephrase|proofread|paragraph|story|caption|tone)\b/.test(
      t,
    )
  )
    return 'writing';
  if (
    /\b(calculate|analy|data|numbers|statistic|math|equation|spreadsheet|percentage|forecast|chart)\b/.test(
      t,
    )
  )
    return 'analysis';
  if (/\b(image|picture|draw|illustrat|logo|render|generate an? image)\b/.test(t))
    return 'image-gen';
  return 'reasoning';
}

/** One history entry. `localOnly` marks a reply written after a local-only
 *  vault read (CTO I5, mirroring the engine's `ChatMessage.localOnly`): a
 *  later turn on a seat that leaves this network gets `LOCAL_ONLY_STUB` in
 *  its place, while a local seat still sees it. */
type Msg = { role: 'user' | 'assistant'; content: string; localOnly?: true };

/** The history as a seat receives it: a leaving seat gets the stub for every
 *  local-only entry. The kept history is never changed. */
export function historyForSeat<M extends { content: string; localOnly?: true }>(
  history: readonly M[],
  leaves: boolean,
): M[] {
  return leaves
    ? history.map((m) => (m.localOnly ? { ...m, content: LOCAL_ONLY_STUB } : m))
    : history.slice();
}

/** One play step's output, marked when it was written after a local-only
 *  read (I5): its seat's pack carried a local-only note, or a marked earlier
 *  output reached that seat whole. */
type PlayStepResult = StepResult & { localOnly?: true };

/** The step outputs as a seat sees them: a marked output is
 *  `LOCAL_ONLY_STUB` on a seat that leaves this network, whole on one that
 *  does not (the same rule as `historyForSeat`). */
export function resultsForSeat<R extends StepResult & { localOnly?: true }>(
  results: readonly R[],
  leaves: boolean,
): R[] {
  return leaves
    ? results.map((r) => (r.localOnly ? { ...r, text: LOCAL_ONLY_STUB } : r))
    : results.slice();
}

/** A system prompt in two parts (CTO J16): the stable head (static, then per
 *  chat) and the volatile tail (per task), so the head can be cached. With
 *  prompt caching off, every seat gets `legacy` instead: the same pieces in
 *  the order the app sent before M5, byte for byte, the pack appended last. */
interface SystemParts {
  stable: string;
  tail: string[];
  legacy: string;
}

/** A local seat's search line for one pass (drivers/searchTurn.ts). */
interface SearchPrompt {
  note: string;
  mayAsk: boolean;
}

/** The system prompt as one string: stable to volatile with caching on, the
 *  pre-M5 prompt with it off (off is byte-identical to before M5). */
function joinSystem(parts: SystemParts, cache: boolean): string {
  return cache ? [parts.stable, ...parts.tail].filter(Boolean).join('\n\n') : parts.legacy;
}

/** A proposal's first lines, for the approval card. */
function proposalPreview(text: string, max = 600): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}\n[and ${t.length - max} more characters]` : t;
}

/** An appended note's text: the note, one blank line, the addition. */
function appendedText(current: string, addition: string): string {
  const head = current.replace(/\s+$/, '');
  const body = addition.replace(/^\s+/, '').replace(/\s*$/, '\n');
  return head ? `${head}\n\n${body}` : body;
}

/** The seat's provenance lines for a note a model writes (Vault M7, CTO L9):
 *  its model, where it ran (judged by address, the pack seat's
 *  `leavesNetwork`), its class and, off this network, its provider. */
export function seatProvenance(ref: StackModelRef, seat: PackSeat): ProvenanceFields {
  const model = ref.kind === 'device' ? ref.modelName : ref.model;
  const provider = ref.kind === 'cloud' ? ref.provider : ref.kind === 'byom' ? ref.label : '';
  return {
    ...(model ? { 'oscode-model': model } : {}),
    'oscode-where': seat.leavesNetwork ? 'cloud' : 'local',
    'oscode-size': seat.modelClass,
    'oscode-provider': seat.leavesNetwork && provider ? provider : null,
  };
}

/** `text` with provenance merged byte for byte (L10), or `text` as it is
 *  when the merge skips (invalid or large frontmatter, a failed verify). */
export function withProvenance(text: string, fields: ProvenanceFields): string {
  try {
    const merged = mergeProvenance(text, fields);
    return 'text' in merged ? merged.text : text;
  } catch {
    return text;
  }
}

/** Build the OpenAI-compatible content array for a user turn that carries
 *  images. Video frames are labeled and led by a context header, the same
 *  shape the Anthropic path uses, so a stack routed to an OpenAI-style vision
 *  model reads a clip in order too. */
function openAiVisionContent(text: string, images: Attachment[]): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  if (images.some((a) => a.frame)) {
    const header = videoContextHeader(images);
    if (header) parts.push({ type: 'text', text: header });
  }
  for (const a of images) {
    const p = imageBlockParts(a);
    if (!p) continue;
    if (a.frame) parts.push({ type: 'text', text: frameLabel(a.frame) });
    parts.push({ type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.base64}` } });
  }
  parts.push({ type: 'text', text });
  return parts;
}

/** Whether a turn's attachments carry video frames (as opposed to plain
 *  screenshots), so the frame-reading system note is added only when it earns
 *  its place. */
function hasVideoFrames(images: Attachment[]): boolean {
  return images.some((a) => a.frame);
}

// Monotonic request ids, so two sends in the same millisecond cannot share an
// id and interleave their token streams into one answer.
let stackRequestSeq = 0;

/** The line under every card this driver asks with (build 2026-09-29). */
export const ASK_STOP_LINE = 'Or press Stop to skip it.';

/** The turn's end when the person keeps an image off the cloud. */
export const IMAGE_NOT_SENT =
  'You declined, so the image was not sent. Set a model for Image reading in Stack and images go to it without asking.';

// A routed specialist could not run this turn (no key, load failure, HTTP
// error) throws RouteUnavailable (the provider client's ProviderUnavailable).
// Distinct from a generic failure so run() can degrade to the Reasoning anchor
// instead of dead-ending the turn, the way the engine's router does.

/** A seat's identity for the tools-refused memo. */
function seatKey(ref: StackModelRef): string {
  return ref.kind === 'byom'
    ? `byom:${ref.id}:${ref.model}`
    : ref.kind === 'cloud'
      ? `cloud:${ref.provider}:${ref.model}`
      : `device:${ref.modelId}`;
}

function locationOf(ref: StackModelRef): 'home' | 'cloud' | 'device' {
  // A BYOM endpoint goes over the network (its own or someone else's server),
  // so it shares the cloud reachability rules: available online, held back on
  // the strictest offline profile. Only a truly on-device model is 'device'.
  return ref.kind === 'device' ? 'device' : 'cloud';
}

export class StackDriver implements ChatDriver {
  readonly kind = 'stack' as const;
  private emitter = new DriverEmitter();
  private history: Msg[] = [];
  private aborted = false;
  private answer = '';
  private activeRequestId?: string;
  /** The device model writing the live reply, named if it ends with no words. */
  private deviceModelName?: string;
  // A framing turn that asked the user to clarify: the original request is held
  // here so the next message can be folded back in and re-framed.
  private pendingClarify?: { text: string };
  // The one engine session a play opens (lazily, on its first tool step) to run
  // repo/tool steps on the paired computer. Shared across every tool step in the
  // play so working-tree state and cwd carry forward; torn down with the driver.
  private engineDriver?: RemoteDriver;
  private engineUnsub?: () => void;
  // The in-flight engine turn's collected final text, and a settler called on
  // task-done or on abort, so a stop never leaves the play awaiting a turn that
  // will not report back.
  private engineTurnText = '';
  /** The engine's turn read a local-only note (I5). */
  private engineTurnLocalOnly = false;
  private engineTurnSettle?: () => void;
  private listenersReady: Promise<void>;
  private deviceListeners: PluginListenerHandle[] = [];
  private abortController?: AbortController;
  // The turn is over (finished, stopped, or failed): its ending was said once,
  // so whatever an unwinding run still says is dropped, and the partial
  // answer is pushed to history exactly once.
  private turnClosed = true;
  // A device reply stopped from here: the turn closed at once, and a beat
  // later the slot is dropped if the runner never confirmed the stop.
  private stoppingRequestId?: string;
  // B2 (UI-1 for the stack): a started device reply that goes quiet is ended
  // from this side, and a stop the native runner never acknowledges is ended
  // a beat later, so a "My Stack" chat on the phone can never stick busy.
  private watchdog?: ReturnType<typeof setTimeout>;
  private abortBeat?: ReturnType<typeof setTimeout>;
  // The Harness Current advisor, when one is on. Built once; undefined leaves
  // every turn routed exactly as before. Its calls go through the native HTTP
  // layer, the same path every other cloud call takes. The id and label come
  // from the roster, never hardcoded here (a room renders a current through the
  // roster, the same rule the agentic currents hold).
  private readonly harness?: { id: HarnessCurrentId; label: string; advisor: JevAdvisor };
  // Web search for local models: the one search turn per message (the filter
  // that keeps a SEARCH: line off the screen on every pass, the prompt note,
  // the history line), the device seat to hand the results back to, and
  // Harbor Lite's pre-searched prompt for this turn.
  private search = new SearchTurn();
  // Chain of Thought for the message in flight (read once when it starts, so a
  // flip mid-reply cannot half-apply), and the device reply's <think> splitter.
  private cot = false;
  private thinkSplitter = new ThinkTagSplitter();
  private deviceTurn?: { ref: Extract<StackModelRef, { kind: 'device' }>; placement?: Placement };
  private guidePrompt?: string;
  // A card this driver put in front of the person (an image bound for a model
  // not placed for Image reading), waiting on their tap.
  private pendingAsk?: { id: string; settle: (approved: boolean) => void };
  // The vault pack for this send (CTO J1, J5): prepared once after task-start,
  // rendered for each seat that answers once the seat is known. `turnPack` is
  // the rendered text for the single-turn seat in flight.
  private packPrepared: Promise<void> = Promise.resolve();
  private turnPack?: { ref: StackModelRef; text?: string };
  // Effort, read once per send so a flip mid-reply cannot move the prompt.
  private sendEffort = effortDirective();
  // CTO I5: this send read a local-only note, so its reply is marked.
  private sendLocalOnly = false;
  // The vault writes this send proposed, shown on one card at its end (D4),
  // and the privacy rules, loaded once per send.
  private proposals: VaultProposal[] = [];
  private sendPrivacy?: Promise<VaultPrivacy | undefined>;
  // Seats whose server refused a request with tools on it (an Ollama model
  // with no tool template answers 400): they get the plain path afterwards.
  private noToolSeats = new Set<string>();

  constructor(
    private readonly stack: AppStack,
    private readonly profile: ProfileId,
    private readonly context: StackContext = {},
    seed?: StackSeedTurn[],
    private readonly opts: StackDriverOptions = {},
  ) {
    // A mid-chat switch seeds the prior turns so the stack continues the thread.
    if (seed) {
      this.history = seed.map((t) => ({
        role: t.role,
        content: t.text,
        ...(t.localOnly ? { localOnly: true as const } : {}),
      }));
    }
    const jevFetch: FetchLike = (url, init) =>
      nativeFetch(url, {
        method: init.method as 'GET' | 'POST',
        headers: init.headers,
        body: init.body,
      });
    const id = activeHarnessId(context.harnessCurrents);
    // Harness Currents are v2: the gate folds to false in a Personal build, so
    // the advisor (and its words) stays out of that bundle (lib/focus.ts).
    const advisor = SHIPS_CURRENTS ? JevAdvisor.from(context.harnessCurrents, jevFetch) : undefined;
    if (id && advisor) this.harness = { id, label: harnessCurrentInfo(id).label, advisor };
    this.listenersReady = this.attachDeviceListeners();
  }

  subscribe(sink: DriverEventSink): () => void {
    return this.emitter.subscribe(sink);
  }

  send(text: string, attachments?: Attachment[]): void {
    // One run at a time: a message sent after a Stop that landed mid warm-up
    // waits for that run to unwind (a model load cannot be cancelled) rather
    // than racing it on the shared history and model slot.
    this.running = this.running.then(() => this.run(text, attachments)).catch(() => undefined);
  }

  /** The run in flight, so the next one starts only once it has unwound. */
  private running: Promise<void> = Promise.resolve();
  /** The turn already ended (a Stop during warm-up closes it at once), so
   *  whatever the unwinding run still says is dropped, its ending too. */
  private settled = false;

  private emit = (e: Parameters<DriverEmitter['emit']>[0]) => {
    if (e.type === 'task-start') this.settled = false;
    else if (this.settled) return;
    if (e.type === 'task-done') this.settled = true;
    this.emitter.emit(e);
  };

  // ---- routing ------------------------------------------------------------

  private reachable(ref: StackModelRef): boolean {
    return locationAllowed(this.profile, locationOf(ref));
  }

  /** The web is in reach whenever the cloud is: not on the Offline profile. */
  private webReachable(): boolean {
    return locationAllowed(this.profile, 'cloud');
  }

  /** Pick the model for this turn: a placed specialist if reachable, else the
   *  Reasoning LLM, else any reachable model. */
  private route(text: string): {
    ref: StackModelRef;
    placement?: Placement;
    category: StackCategory | 'reasoning';
  } {
    const category = classifyTask(text);
    if (category !== 'reasoning') {
      const specialist = this.stack.active.find(
        (m) => m.placement.category === category && this.reachable(m.ref),
      );
      if (specialist) return { ref: specialist.ref, placement: specialist.placement, category };
    }
    const reasoning = this.stack.reasoning ?? harborRef();
    if (this.reachable(reasoning)) return { ref: reasoning, category };
    // Last resort: any reachable placed model, then any reachable at all.
    const anyActive = this.stack.active.find((m) => this.reachable(m.ref));
    if (anyActive) return { ref: anyActive.ref, placement: anyActive.placement, category };
    return { ref: reasoning, category }; // will surface an unreachable error
  }

  /** Let the Harness Current (Jev) steer a turn that would otherwise spend on a
   *  paid/cloud seat, in ONE cheap decision call. The gate may send it to a
   *  reachable local seat instead; the classifier may send it to the seat
   *  placed for the work kind. Each decision shows as a card. Never throws and
   *  never blocks: with Jev off, the target unreachable-checked seat is device
   *  (local), or the call failing, the routed target is returned unchanged. */
  private async jevSteer(
    text: string,
    target: { ref: StackModelRef; placement?: Placement; category: StackCategory | 'reasoning' },
  ): Promise<typeof target> {
    // Only steer where there is spend to steer: the seat about to answer is a
    // paid/cloud one. A device (free, local) seat is left alone.
    if (!this.harness || target.ref.kind === 'device') return target;
    const categories = this.placedCategories();
    // A stop while Jev decides unwinds at once (the turn is already closed).
    const decision = await raceAbort(
      this.harness.advisor.steer({ request: text, categories }),
      this.abortController?.signal,
    ).catch(() => undefined);
    if (!decision) return target;
    // The gate first: a local seat that can carry this saves the paid call.
    if (decision.gate && !decision.gate.escalate) {
      const local = this.stack.active.find((m) => m.ref.kind === 'device' && this.reachable(m.ref));
      const localReasoning =
        this.stack.reasoning?.kind === 'device' && this.reachable(this.stack.reasoning)
          ? this.stack.reasoning
          : undefined;
      const seat = localReasoning ?? local?.ref;
      if (seat) {
        this.emitHarness('gate', decision.gate.line);
        return { ref: seat, category: target.category };
      }
    }
    // Then the classifier: the seat placed for this kind of work, when it is a
    // different reachable seat than the one routing picked.
    if (decision.classify) {
      const specialist = this.stack.active.find(
        (m) => m.placement.category === decision.classify!.category && this.reachable(m.ref),
      );
      if (specialist && specialist.ref !== target.ref) {
        this.emitHarness('classify', decision.classify.line);
        return {
          ref: specialist.ref,
          placement: specialist.placement,
          category: decision.classify.category as StackCategory,
        };
      }
    }
    return target;
  }

  /** The reachable placed specialists as a {category: description} map, for the
   *  Jev classifier to choose among. Only categories with a seat behind them,
   *  so a route never points at an empty position. */
  private placedCategories(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const m of this.stack.active) {
      if (this.reachable(m.ref))
        out[m.placement.category] = `work best handled by the ${m.placement.category} seat`;
    }
    return out;
  }

  private emitHarness(job: 'gate' | 'classify', line: string): void {
    if (!this.harness) return;
    this.emit({
      type: 'harness-current',
      current: this.harness.id,
      label: this.harness.label,
      job,
      line,
      spend: true,
    });
  }

  /** The live question, for Harbor Lite's per-turn fact lookup. */
  private lastUserText(): string {
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i]!.role === 'user') return this.history[i]!.content;
    }
    return '';
  }

  /** `search` is set only on a local model's own answer turn: the note this
   *  pass reads (it may search, it already searched, or it has no web) and
   *  whether it may ask. Unset (a play step, a cloud seat), the prompt says
   *  nothing about it. `pack` is the vault pack rendered for this seat,
   *  placed last. */
  private systemFor(
    ref: StackModelRef,
    placement?: Placement,
    search?: SearchPrompt,
    pack?: string,
  ): string {
    return joinSystem(this.systemParts(ref, placement, search, pack), this.promptCache());
  }

  /** This message's search prompt for a local seat, read now. */
  private searchPrompt(): SearchPrompt {
    const offered = this.webReachable() && searchOffered();
    return { note: this.search.note(offered), mayAsk: this.search.mayAsk(offered) };
  }

  /** A seat's class (build 2026-09-29, B2): the pack seat's own reading (by
   *  name and size, `packSeatFor`), else undefined for a seat nobody can
   *  judge (an Agentic Current's bench model), which keeps every standard. */
  private seatClass(ref: StackModelRef): ModelClass | undefined {
    return this.seatFor(ref)?.modelClass;
  }

  /** The system prompt, stable to volatile (CTO J16): the base or guide, the
   *  search note, the UX standard, the humanizer and the Codemagic note (all
   *  static), then the project, crew and persona (per chat), and last the
   *  effort directive, the walk line and the vault pack (per task). */
  private systemParts(
    ref: StackModelRef,
    placement?: Placement,
    search?: SearchPrompt,
    pack?: string,
  ): SystemParts {
    const guideSystem =
      ref.kind === 'device' && isHarborMini(ref.modelId)
        ? (this.guidePrompt ??
          buildHarborMiniSystemPrompt(this.lastUserText(), this.context.conversationId))
        : ref.kind === 'device' && isHarbor(ref.modelId)
          ? buildHarborSystemPrompt(search?.mayAsk === true, search?.note)
          : undefined;
    // Harbor's persona carries its own search line, and Harbor Lite's guide
    // harness searches for it; every other local model reads the rule here.
    const stable = [guideSystem ?? BASE_SYSTEM];
    if (!guideSystem && search !== undefined) stable.push(search.note);
    // The pre-M5 order (caching off): the head, the effort line, the project,
    // the walk, the crew and the persona, then the standards and the notes.
    const legacyHead = stable.slice();
    const standards: string[] = [];
    // A tiny or small seat on any host carries neither long standard (B2).
    const modelClass = this.seatClass(ref);
    // Premium UX out of the box for whatever writes code in this chat: the
    // coding specialist, and a cloud or BYOM reasoning anchor. On-device
    // pocket models, and any seat too small to hold it, skip it to protect
    // their context (the engine's agent on the desktop carries it by class).
    const buildsCode = placement?.category === 'coding' || (!placement && ref.kind !== 'device');
    if (buildsCode && !leanSeat(modelClass)) standards.push(uxStandardPrompt());
    // Humanize Writing out of the box: any written output (not just code) reads
    // plain, specific, and honest, avoiding AI writing tells, unless the person
    // turned the setting off (humanizerStandard.ts, config in Settings).
    if (humanizerApplies(ref, this.context.humanize, modelClass)) {
      standards.push(humanizerStandardPrompt());
    }
    // Codemagic Access is on: tell the model it can drive App Launch builds. The
    // tool is offered on every network model (Anthropic native tool use, and
    // OpenAI-compatible + BYOM function calling), so the note earns its place on
    // any non-device model. On-device pocket models are too small for reliable
    // tool use and stay guidance only.
    if (this.context.codemagicAccess && ref.kind !== 'device') {
      standards.push(codemagicSystemNote());
    }
    stable.push(...standards);
    // Project context: name + standing instructions, injected into every turn.
    const proj = this.context.projectInstructions?.trim();
    let project: string | undefined;
    if (this.context.projectName || proj) {
      const head = this.context.projectName
        ? `You are working in the project "${this.context.projectName}".`
        : '';
      project = [head, proj].filter(Boolean).join('\n');
      stable.push(project);
    }
    const perChat: string[] = [];
    const crewNote = this.crewGuidance();
    if (crewNote) perChat.push(crewNote);
    if (placement?.persona && placement.persona.trim()) {
      perChat.push(`Persona for this specialist: ${placement.persona.trim()}`);
    }
    stable.push(...perChat);
    // The volatile tail. Reasoning effort: a specialist's own effort when it
    // was placed with one (the Vision position sets this), otherwise the
    // composer choice, read once for this send.
    const effort = placement?.effort ? effortDirective(placement.effort) : this.sendEffort;
    const tail = [effort];
    // Mid-walk, whatever seat answers still needs to know where setup stands
    // (Harbor Lite already reads it inside its own prompt).
    let walk: string | undefined;
    if (!(ref.kind === 'device' && isHarborMini(ref.modelId))) {
      walk = guidedSetupLine(this.context.conversationId);
      if (walk) tail.push(walk);
    }
    if (pack) tail.push(pack);
    const legacy = [
      ...legacyHead,
      effort,
      ...(project !== undefined ? [project] : []),
      ...(walk ? [walk] : []),
      ...perChat,
      ...standards,
      ...(pack ? [pack] : []),
    ].join('\n\n');
    return { stable: stable.filter(Boolean).join('\n\n'), tail: tail.filter(Boolean), legacy };
  }

  /** The pack rendered for the single-turn seat in flight, when `ref` is it. */
  private turnPackFor(ref: StackModelRef): string | undefined {
    return this.turnPack?.ref === ref ? this.turnPack.text : undefined;
  }

  // ---- vault seat, pack and privacy (CTO J1, J2, J5, I5) ------------------

  /** The seat `ref` answers as, or null: an Agentic Current bench ref never
   *  gets one (no pack, no vault tools), and a seat the store cannot judge
   *  gets none either. */
  private seatFor(ref: StackModelRef): PackSeat | null {
    if (ref.kind === 'byom' && isCurrentBenchId(ref.id)) return null;
    if (!this.opts.packSeat) return null;
    try {
      return this.opts.packSeat(ref);
    } catch {
      return null;
    }
  }

  /** Whether `ref`'s requests leave this network. A device seat is this
   *  phone; any other seat that cannot be judged reads as leaving, the safe
   *  reading. */
  private leaves(ref: StackModelRef): boolean {
    if (ref.kind === 'device') return false;
    return this.seatFor(ref)?.leavesNetwork ?? true;
  }

  /** The history as `ref` receives it (CTO I5). */
  private historyFor(ref: StackModelRef): Msg[] {
    return historyForSeat(this.history, this.leaves(ref));
  }

  /** Render this send's pack for the seat that answers, emitting its card.
   *  Never throws: a pack that cannot render leaves the seat without one. */
  private async packFor(ref: StackModelRef): Promise<string | undefined> {
    return (await this.packRender(ref)).text;
  }

  /** `packFor`, also saying whether the text carries a local-only note, so a
   *  play step's output can be tainted by it (I5). */
  private async packRender(ref: StackModelRef): Promise<{ text?: string; localOnly: boolean }> {
    const pack = this.opts.vaultPack;
    if (!pack) return { localOnly: false };
    const seat = this.seatFor(ref);
    if (!seat) return { localOnly: false };
    await this.packPrepared;
    if (this.aborted) return { localOnly: false };
    let rendered: ReturnType<typeof pack.render>;
    try {
      rendered = pack.render(seat);
    } catch {
      return { localOnly: false };
    }
    if (rendered.event) this.emit(rendered.event);
    const text = rendered.text?.trim() || undefined;
    // A local seat's pack that carried a local-only note marks the reply,
    // the same as a local-only tool read (I5).
    const localOnly = Boolean(text && rendered.localOnly);
    if (localOnly) this.sendLocalOnly = true;
    return { text, localOnly };
  }

  /** The vault tools `ref` is offered on the single-turn path (CTO J10). */
  private vaultSliceFor(ref: StackModelRef): AppVaultToolName[] {
    if (!this.opts.vaultTools || ref.kind === 'device') return [];
    const seat = this.seatFor(ref);
    if (!seat) return [];
    let teamVault = false;
    try {
      teamVault = this.opts.vaultTools.teamVault?.() === true;
    } catch {
      teamVault = true;
    }
    return vaultToolSlice({
      kind: ref.kind,
      mergedVaultTool: vaultPolicyFor(seat.modelClass).mergedVaultTool,
      currentBench: ref.kind === 'byom' && isCurrentBenchId(ref.id),
      playStep: false,
      teamVault,
    });
  }

  /** The tools a single turn on `ref` carries: Codemagic when its access is
   *  on, and the vault slice unless this seat's server refused tools. */
  private toolsFor(ref: StackModelRef): { codemagic: boolean; vault: AppVaultToolName[] } {
    const codemagic = this.context.codemagicAccess === true && ref.kind !== 'device';
    const vault = this.noToolSeats.has(seatKey(ref)) ? [] : this.vaultSliceFor(ref);
    return { codemagic, vault };
  }

  /** The runner's context for `ref`, or undefined when the vault cannot be
   *  judged (no seat, or no privacy rules: fail closed). */
  private async vaultContextFor(ref: StackModelRef): Promise<VaultToolContext | undefined> {
    const tools = this.opts.vaultTools;
    const seat = this.seatFor(ref);
    if (!tools || !seat) return undefined;
    this.sendPrivacy ??= tools.privacy().catch(() => undefined);
    const privacy = await this.sendPrivacy;
    if (!privacy) return undefined;
    return {
      seat,
      privacy,
      search: tools.search,
      read: tools.read,
      ...(tools.resolve ? { resolve: tools.resolve } : {}),
      readCapChars: vaultPolicyFor(seat.modelClass).readCapChars,
      propose: (p) => this.queueProposal(this.stampProposal(tools, ref, seat, p)),
      ...(this.agentFolder(tools) ? { agentFolder: this.agentFolder(tools)! } : {}),
    };
  }

  /** The vault's agent folder now, or undefined (anywhere). */
  private agentFolder(tools: StackVaultTools | undefined): string | undefined {
    try {
      return tools?.agentFolder?.() || undefined;
    } catch {
      return undefined;
    }
  }

  /** The provenance a proposal carries (Vault M7, CTO L9, L10), merged NOW,
   *  before the card, so the person approves the exact bytes that land: a
   *  new note's text carries its lines; an addition's final text (the note as
   *  the model read it, the addition, and the property change) is computed
   *  here and written only while the note is still that version. The card
   *  names the property change in words (`records`). An addition to a note
   *  the model could not see has no known base, so it carries no lines and
   *  the card shows exactly what it adds. */
  private stampProposal(
    tools: StackVaultTools,
    ref: StackModelRef,
    seat: PackSeat,
    p: VaultProposal,
  ): VaultProposal {
    let on = true;
    try {
      on = tools.provenance?.() ?? true;
    } catch {
      on = true;
    }
    const fields = seatProvenance(ref, seat);
    const where = fields['oscode-where'] === 'cloud' ? 'cloud' : 'local';
    const model = fields['oscode-model'] ?? undefined;
    if (p.mode === 'create') {
      if (!on) return p;
      const text = withProvenance(p.text, {
        'oscode-source': 'agent',
        ...fields,
        'oscode-created': new Date().toISOString(),
      });
      return {
        ...p,
        text,
        ...(text !== p.text ? { records: vaultProposalRecords({ model, where }) } : {}),
      };
    }
    if (p.baseText === undefined || p.baseVersion === undefined) return p;
    const plain = appendedText(p.baseText, p.text);
    if (!on) return { ...p, final: plain };
    // A model's addition to a note it did not create reads "Edited by"
    // (L9), and a review mark no longer holds for the new text.
    let prior: { source?: string; reviewed?: string } = {};
    try {
      prior = readProvenance(readFrontmatter(p.baseText));
    } catch {
      prior = {};
    }
    const edit = prior.source !== 'agent';
    const final = withProvenance(plain, {
      'oscode-source': edit ? 'agent-edit' : 'agent',
      ...fields,
      'oscode-reviewed': null,
    });
    return {
      ...p,
      final,
      ...(final !== plain
        ? {
            records: vaultProposalRecords({
              model,
              where,
              edit,
              clearsReview: prior.reviewed !== undefined,
            }),
          }
        : {}),
    };
  }

  /** Queue a write for the end-of-send card; a later proposal for the same
   *  note replaces the earlier one. */
  private queueProposal(p: VaultProposal): void {
    const at = this.proposals.findIndex((q) => q.path === p.path);
    if (at >= 0) {
      this.proposals[at] = p;
      return;
    }
    if (this.proposals.length >= VAULT_PROPOSALS_MAX) {
      throw new Error(
        `this reply already proposes ${VAULT_PROPOSALS_MAX} notes, the most one reply can`,
      );
    }
    this.proposals.push(p);
  }

  /** Run one vault tool call for `ref` and return the observation. */
  private async runVaultToolCall(
    ref: StackModelRef,
    name: string,
    call: VaultToolInput | null,
  ): Promise<string> {
    if (!call) return vaultArgsHelp(name);
    const i = call.input as { query?: string; path?: string };
    this.emit({
      type: 'status',
      message:
        call.name === 'vaultPropose'
          ? `Proposing a note for your vault: ${call.input.path}.`
          : i.query
            ? `Searching your vault for "${i.query}".`
            : `Reading ${i.path} from your vault.`,
    });
    const ctx = await this.vaultContextFor(ref);
    if (!ctx) return 'The vault is not available in this chat right now.';
    const result = await runVaultTool(call, ctx);
    if (result.localOnly) this.sendLocalOnly = true;
    return result.content;
  }

  /** The end of a send that proposed vault writes: one card lists every
   *  queued write (D4, always ask). Approve writes each through the seam
   *  with its guard; decline, or a stop, writes nothing. */
  private async settleProposals(): Promise<void> {
    const queued = this.proposals;
    this.proposals = [];
    const tools = this.opts.vaultTools;
    if (!queued.length || !tools || this.aborted) return;
    const n = queued.length;
    const approved = await this.askFirst({
      kind: 'tool',
      toolName: 'vaultPropose',
      risk: 'write',
      alwaysAsk: true,
      summary:
        n === 1
          ? `${queued[0]!.mode === 'create' ? 'Save' : 'Add to'} ${queued[0]!.path} in your vault?`
          : `Save ${n} notes to your vault?`,
      detail: [
        ...queued.map(
          (p) =>
            `${p.mode === 'create' ? 'New note' : 'Add to'} ${p.path}\n${proposalPreview(p.text)}${p.records ? `\n${p.records}` : ''}`,
        ),
        'Nothing is written until you approve.',
      ].join('\n\n'),
    });
    if (!approved) {
      if (!this.aborted)
        this.emit({
          type: 'status',
          message: 'Nothing was written. The proposed notes were dropped.',
        });
      return;
    }
    const saved: string[] = [];
    const notSaved: string[] = [];
    const refused: string[] = [];
    for (const p of queued) {
      // Checked again right before the write (CTO L8): the settings folder,
      // and the vault's agent folder as it is now.
      const refusal = vaultApproveRefusal(p, { agentFolder: this.agentFolder(tools) });
      if (refusal) {
        refused.push(refusal);
        continue;
      }
      const ok = await this.writeProposal(tools, p).catch(() => false);
      (ok ? saved : notSaved).push(p.path);
    }
    for (const line of refused) this.emit({ type: 'status', message: line });
    if (saved.length) {
      this.emit({
        type: 'status',
        message:
          saved.length === 1
            ? `Wrote ${saved[0]}.`
            : `Wrote ${saved.length} notes: ${saved.join(', ')}.`,
      });
      try {
        tools.onWritten?.(saved);
      } catch {
        // a listener's failure never undoes a write
      }
    }
    if (notSaved.length) {
      this.emit({
        type: 'status',
        message: `Not written, because the note changed or already exists: ${notSaved.join(', ')}.`,
      });
    }
  }

  /** One approved write: create only while the name is free; an addition
   *  writes the exact text the card was built from, and only while the note
   *  is still the version the model read (compare and swap: a changed note
   *  is refused, never merged). */
  private async writeProposal(tools: StackVaultTools, p: VaultProposal): Promise<boolean> {
    if (p.mode === 'create') {
      return (await tools.write(p.path, p.text, { ifAbsent: true })).ok;
    }
    if (p.final !== undefined && p.baseVersion !== undefined) {
      return (await tools.write(p.path, p.final, { ifMatch: p.baseVersion })).ok;
    }
    const cur = await tools.read(p.path);
    if (!cur || (p.baseVersion !== undefined && cur.version !== p.baseVersion)) return false;
    return (await tools.write(p.path, appendedText(cur.text, p.text), { ifMatch: cur.version })).ok;
  }

  /** Claude's `system` for these parts (CTO J16): the one app builder,
   *  `claudeSystem`, so the Stack and the Claude driver send the same shape. */
  private claudeSystem(
    parts: SystemParts,
    extraTail: string[] = [],
  ): string | Anthropic.TextBlockParam[] {
    if (!this.promptCache()) return [parts.legacy, ...extraTail].join('\n');
    return claudeSystem(parts.stable, [...parts.tail, ...extraTail], true);
  }

  /** Prompt caching for this request: the store's value for this chat, else
   *  the live setting. Off by default (no claim without the eval). */
  private promptCache(): boolean {
    return this.context.promptCache ?? promptCacheOn();
  }

  /** Top-level automatic caching for the growing history, with caching on. */
  private claudeCacheParam(): { cache_control?: Anthropic.CacheControlEphemeral } {
    return claudeHistoryCache(this.promptCache());
  }

  /** Describe the crew this chat can draw on. "auto" members may be consulted
   *  by the Reasoning LLM on its own; "request" members wait to be named. */
  private crewGuidance(): string | undefined {
    const crew = this.context.crew ?? [];
    if (!crew.length) return undefined;
    const describe = (a: CrewAgent) => {
      const when = a.whenCalled?.trim() ? ` Called when: ${a.whenCalled.trim()}.` : '';
      return `- ${a.name}: ${a.persona.trim()}.${when}`;
    };
    const auto = crew.filter((a) => a.activityLevel === 'auto');
    const request = crew.filter((a) => a.activityLevel === 'request');
    const lines: string[] = ['Your crew (user-authored perspectives you can bring in):'];
    if (auto.length) {
      lines.push(
        'You may consult these on your own when they would help. Speak in their voice when you do, and say which crew member you are channeling:',
      );
      lines.push(...auto.map(describe));
    }
    if (request.length) {
      lines.push('These wait to be summoned. Bring one in only when the user names it:');
      lines.push(...request.map(describe));
    }
    return lines.join('\n');
  }

  // ---- turn ---------------------------------------------------------------

  private async run(text: string, attachments?: Attachment[]): Promise<void> {
    this.aborted = false;
    this.abortController = new AbortController();
    this.search.begin();
    this.cot = chainOfThoughtOn();
    this.guidePrompt = undefined;
    this.sendEffort = effortDirective();
    this.sendLocalOnly = false;
    this.proposals = [];
    this.sendPrivacy = undefined;
    this.turnPack = undefined;
    this.answer = '';
    this.history.push({ role: 'user', content: text });
    this.turnClosed = false;
    this.emit({ type: 'task-start', input: text });
    // The vault pack for this send, gathered while routing runs (CTO J5); it
    // is rendered for each seat once that seat is known.
    const pack = this.opts.vaultPack;
    this.packPrepared = pack
      ? pack.prepare(text, this.abortController.signal).catch(() => undefined)
      : Promise.resolve();

    try {
      await this.runTurn(text, attachments);
    } catch (err) {
      // A stop is a calm end (abort() already closed the turn with whatever
      // streamed so far); anything else ends the turn with its partial answer
      // kept in the chat and in history.
      if (this.aborted || isAbortError(err)) this.finish('aborted');
      else this.finish('error', describeError(err));
    }
  }

  private async runTurn(text: string, attachments?: Attachment[]): Promise<void> {
    // Continue a pending clarification: fold the reply into the original ask and
    // re-frame, rather than answering the reply on its own.
    if (this.pendingClarify) {
      const original = this.pendingClarify.text;
      this.pendingClarify = undefined;
      const handled = await this.tryRunPlay(
        original,
        `The user was asked to clarify and replied: "${text}". Use this to settle the framing of the original request, and do not ask again unless something is still genuinely blocking.`,
      );
      if (handled) return;
      // Planning could not run; fall through and answer the reply directly.
    }

    // Plan-first flow: for a text-only turn (no build-tool loop) on a stack
    // with someone to hand off to, the reasoning LLM frames the request and
    // composes a play, or answers a simple request itself in the same call
    // (B2). A stack with only its anchor (and no docked workspace) has no one
    // to hand off to, so it skips the framing call and answers in one. It
    // hands back to the single-turn path below when the anchor is a weak or
    // unreachable model, the plan will not parse, or the play is a single
    // specialist step.
    if (
      !(attachments ?? []).some((a) => a.isImage) &&
      !this.context.codemagicAccess &&
      this.hasHandoff()
    ) {
      const handled = await this.tryRunPlay(text);
      if (handled) return;
    }

    // An image-bearing turn routes by capability, not by the text classifier:
    // the model placed for image reading if it can see and is reachable, else a
    // vision-capable model already in the stack, else a connected cloud
    // provider (the founder's "if there isn't one available and capable it can
    // go to a cloud provider"). A device model cannot read images on this
    // build, so a local model placed for vision falls back to the cloud here.
    const images = (attachments ?? []).filter((a) => a.isImage);
    let target: {
      ref: StackModelRef;
      placement?: Placement;
      category: StackCategory | 'reasoning';
    };
    if (images.length) {
      const vision = await this.routeVision();
      if (!vision) {
        this.finish(
          'error',
          `No image-reading model is reachable while ${this.profile}. Put an image-reading model in Stack, or connect a cloud model that reads images (Claude reads them out of the box).`,
        );
        return;
      }
      // Only a model placed for Image reading takes an image without a word
      // (founder, 2026-09-25). Any other reader, the anchor or a connected cloud
      // model filling the gap, waits on a card the person taps (tenet 4).
      if (!vision.dedicated && !(await this.askToReadImage(vision.ref, images.length))) {
        if (this.aborted) this.finish('aborted');
        else this.finish('declined', IMAGE_NOT_SENT);
        return;
      }
      target = vision;
    } else {
      target = this.route(text);
      if (!this.reachable(target.ref)) {
        this.finish(
          'error',
          `Nothing in your stack is reachable while ${this.profile}. Download an on-device model or change your connection.`,
        );
        return;
      }
      // Harness Current: when a paid/cloud seat would answer and Jev is on, let
      // it steer this turn (a cheaper local seat, or the seat placed for the
      // work kind). Scoped to a cloud target so a free local turn never spends
      // on Jev, and safe: any failure leaves the routed target as it was.
      target = await this.jevSteer(text, target);
    }
    // Stopped while routing (a card, Jev, a key lookup): nothing is sent.
    if (this.aborted) throw abortError();

    this.emit({
      type: 'turn-start',
      turn: this.history.length,
      model: refName(target.ref),
      providerKind: target.ref.kind === 'device' ? 'local' : 'cloud',
    });
    // Rendered only now, after routing and any Jev steer, so the pack fits
    // the seat that actually answers (CTO J5).
    this.turnPack = { ref: target.ref, text: await this.packFor(target.ref) };
    if (images.length) {
      this.emit({
        type: 'status',
        message: `Reading ${images.length === 1 ? 'this image' : `these ${images.length} images`} with ${refName(target.ref)}.`,
      });
    } else if (target.category !== 'reasoning' && target.placement) {
      this.emit({
        type: 'status',
        message: `Routing this to ${refName(target.ref)} for ${target.category}.`,
      });
    }

    this.answer = '';
    const reasoning = this.stack.reasoning ?? harborRef();
    try {
      await this.runRef(target.ref, target.placement, images);
    } catch (err) {
      if (this.aborted || isAbortError(err)) throw err;
      // Graceful degradation is the contract: if a placed specialist could not
      // run, fall back to the Reasoning anchor for this turn rather than
      // dead-ending, exactly as the desktop router does. An image turn is the
      // exception: routeVision already chose the best reachable reader (and the
      // reasoning anchor may not read images at all), so it never falls back
      // here, it fails with the clear message above. A specialist that already
      // wrote part of its answer keeps it: the turn ends with the error and the
      // partial, never a second answer on top.
      const isSpecialist = !images.length && target.category !== 'reasoning' && !!target.placement;
      const canFallback =
        err instanceof RouteUnavailable &&
        isSpecialist &&
        !this.answer.trim() &&
        refName(reasoning) !== refName(target.ref) &&
        this.reachable(reasoning);
      if (!canFallback) throw err;
      this.emit({
        type: 'status',
        message: `${refName(target.ref)} is not available right now. Falling back to ${refName(reasoning)}.`,
      });
      this.emit({
        type: 'turn-start',
        turn: this.history.length,
        model: refName(reasoning),
        providerKind: reasoning.kind === 'device' ? 'local' : 'cloud',
      });
      // The anchor is a different seat: its own pack, sized for it.
      this.turnPack = { ref: reasoning, text: await this.packFor(reasoning) };
      this.answer = '';
      await this.runRef(reasoning, undefined, []);
    }
  }

  /** Someone a play could hand a step to, the only case a multi-step play
   *  can use: a placed specialist (reachable, and not a pocket model, whose
   *  step the anchor would cover itself), or the paired computer's engine
   *  for a step that edits files (docked, with a workspace bound). */
  private hasHandoff(): boolean {
    if (this.stack.active.some((m) => m.ref.kind !== 'device' && this.reachable(m.ref))) {
      return true;
    }
    return (
      locationAllowed(this.profile, 'home') &&
      Boolean(this.context.daemon) &&
      Boolean(this.context.repoCwd)
    );
  }

  private async runRef(
    ref: StackModelRef,
    placement?: Placement,
    images: Attachment[] = [],
  ): Promise<void> {
    // Device inference is text-only on this build, so images never reach it
    // (routeVision excludes a device ref); the argument is dropped there.
    if (ref.kind === 'device') await this.runDevice(ref, placement);
    else if (ref.kind === 'byom') await this.runByom(ref, placement, images);
    else await this.runCloud(ref, placement, images);
  }

  // ---- vision routing -----------------------------------------------------

  /** Pick the target for an image-bearing turn, or undefined when nothing can
   *  read it. A capable model placed in (or anchoring) the stack wins; otherwise
   *  a connected cloud provider that reads images is the fallback. `dedicated`
   *  marks a reader placed for Image reading, the one case that never asks. */
  private async routeVision(): Promise<
    | { ref: StackModelRef; placement?: Placement; category: 'vision'; dedicated: boolean }
    | undefined
  > {
    const pick = pickVisionRef(this.stack, (r) => this.reachable(r));
    if (pick) {
      return {
        ref: pick.ref,
        placement: pick.placement,
        category: 'vision',
        dedicated: pick.placement?.category === 'vision',
      };
    }
    const fallback = await this.cloudVisionFallback();
    if (fallback) return { ref: fallback, category: 'vision', dedicated: false };
    return undefined;
  }

  /** Ask before an image goes to a model not placed for Image reading. Amber
   *  (Cloud spend) when the reader is a cloud model, plain when it is your own. */
  private askToReadImage(ref: StackModelRef, count: number): Promise<boolean> {
    const what = count === 1 ? 'this image' : `these ${count} images`;
    const reader = refName(ref);
    const cloud = ref.kind === 'cloud';
    return this.askFirst({
      kind: cloud ? 'cloud-spend' : 'tool',
      toolName: 'analyzeImage',
      risk: cloud ? 'cloud-spend' : 'network',
      summary: `Read ${what} with ${reader}?`,
      detail: `Nothing in Stack is set for Image reading, so ${what} would go to ${reader}${cloud ? ' on your own API key' : ''}. Nothing is sent until you approve. Set a model for Image reading in Stack and images go to it without asking.`,
    });
  }

  /** Put a card in front of the person and wait for their tap. A stop counts
   *  as a no, and the card says so: the turn waits on the tap with no timer,
   *  so Stop is the way past it without answering. */
  private askFirst(request: Omit<ApprovalRequest, 'id'>): Promise<boolean> {
    const id = `ask_${Date.now().toString(36)}_${(stackRequestSeq++).toString(36)}`;
    request = {
      ...request,
      detail: request.detail ? `${request.detail}\n\n${ASK_STOP_LINE}` : ASK_STOP_LINE,
    };
    return new Promise<boolean>((resolve) => {
      this.pendingAsk = {
        id,
        settle: (approved) => {
          this.pendingAsk = undefined;
          this.emit({ type: 'approval-resolved', id, approved });
          resolve(approved);
        },
      };
      this.emit({ type: 'approval-request', request: { id, ...request } });
    });
  }

  /** A connected, reachable cloud model that reads images, when the stack holds
   *  none. Claude first (its whole lineup reads images, so the one that costs
   *  the person least), then the first other provider with a stored key and a
   *  vision-capable model. The label names the model, so the card says
   *  exactly which one the image would go to. */
  private async cloudVisionFallback(): Promise<StackModelRef | undefined> {
    const claude = visionFallbackClaudeModel();
    const anthropic: StackModelRef = {
      kind: 'cloud',
      provider: 'anthropic',
      model: claude.id,
      label: `Claude ${claudeModelLabel(claude.id)}`,
    };
    if (this.reachable(anthropic) && (await secretGet(providerSecretKey('anthropic')))) {
      return anthropic;
    }
    for (const p of PROVIDERS) {
      if (p.id === 'anthropic') continue;
      const visionModel = p.models.find((m) => m.categories?.includes('vision'));
      if (!visionModel) continue;
      const ref: StackModelRef = {
        kind: 'cloud',
        provider: p.id,
        model: visionModel.id,
        label: `${p.name} ${visionModel.label}`,
      };
      if (this.reachable(ref) && (await secretGet(providerSecretKey(p.id)))) return ref;
    }
    return undefined;
  }

  // ---- plan-first orchestration -------------------------------------------

  /** Frame the prompt with the reasoning LLM and, when it is clear and needs
   *  more than one model, run the play. A clear request the lead would do
   *  alone in one step is answered in that same call (B2): its prose streams
   *  as the answer, so a simple message costs one model call. Returns true
   *  when it handled the turn (answered, ran the play, or asked the user to
   *  clarify); false to fall back to the single-turn path. The whole flow
   *  degrades to single-turn whenever the reasoning anchor is a weak or
   *  unreachable model or the plan cannot be used, so a modest stack still
   *  just answers. */
  private async tryRunPlay(text: string, contextNote?: string): Promise<boolean> {
    const reasoning = this.stack.reasoning ?? harborRef();
    // A local pocket model cannot plan reliably; let the single-turn path (and
    // its own honest device handling) take it.
    if (reasoning.kind === 'device' || !this.reachable(reasoning)) return false;

    this.emit({ type: 'status', message: 'Framing the request.' });
    const reply = new PlanReplyFilter();
    let answering = false;
    this.answer = '';
    try {
      const pack = await this.packFor(reasoning);
      await this.completeOnce(
        reasoning,
        undefined,
        planPrompt(
          text,
          this.stack,
          contextNote,
          this.conversationDigest(this.leaves(reasoning)),
          true,
        ),
        {
          pack,
          onDelta: (d) => {
            const shown = reply.push(d);
            if (!shown) return;
            if (!answering) {
              answering = true;
              this.emit({
                type: 'turn-start',
                turn: this.history.length,
                model: refName(reasoning),
                providerKind: 'cloud',
              });
            }
            this.showAnswer(shown);
          },
        },
      );
    } catch (err) {
      if (this.aborted || isAbortError(err)) throw err;
      // An answer that began and then failed keeps what it wrote.
      if (answering) throw err;
      return false;
    }
    const ended = reply.end();
    if (ended.mode === 'answer') {
      this.finish('complete');
      return true;
    }
    const framing = parsePlan(ended.plan);
    if (!framing) return false;

    // Not clear: ask the questions as a tappable picker and wait for the reply.
    // The reply (a tapped option or free text) is folded back into the framing.
    if (!framing.clear && framing.questions.length) {
      this.pendingClarify = { text };
      this.emit({ type: 'clarify', summary: framing.summary, questions: framing.questions });
      this.answer = '';
      this.finish('complete');
      return true;
    }

    // A single-step (or empty) play is one specialist's answer; let the
    // single-turn path route it, so behavior is unchanged for those prompts.
    if (framing.steps.length <= 1) return false;

    await this.executePlay({ summary: framing.summary, steps: framing.steps }, text);
    return true;
  }

  /** Run the play: brief the user (todos with owners), execute steps in
   *  dependency order handing each to its owner, re-plan at bounded checkpoints,
   *  then stream a final synthesis. */
  private async executePlay(initial: Play, userText: string): Promise<void> {
    const reasoning = this.stack.reasoning ?? harborRef();
    let play = initial;
    // Each step's output, tainted (`localOnly`) when it was written on a seat
    // that read a local-only note: its pack carried one, or a tainted earlier
    // output reached it whole. A prompt for a seat that leaves this network
    // gets `LOCAL_ONLY_STUB` in a tainted output's place (I5, as history).
    const results: PlayStepResult[] = [];
    const done = new Set<string>();
    const status = new Map<string, 'pending' | 'in_progress' | 'completed'>();
    const showTodos = () =>
      this.emit({ type: 'todos', items: briefTodos(play, this.stack, status) });

    this.emit({
      type: 'status',
      message: `Running a ${play.steps.length}-step play. Handoffs are shown below.`,
    });
    showTodos();

    let replans = 0;
    const MAX_REPLANS = 2;
    while (done.size < play.steps.length) {
      if (this.aborted) {
        this.finish('aborted');
        return;
      }
      const ready = readySteps(play.steps, done, new Set());
      if (!ready.length) break; // nothing runnable (residual cycle); stop cleanly
      for (const step of ready) {
        if (this.aborted) break;
        status.set(step.id, 'in_progress');
        showTodos();
        this.emit({ type: 'status', message: handoffNote(step, this.stack) });

        const owner = ownerFor(step, this.stack);
        // A device owner (or an unreachable one) is not run autonomously; the
        // reasoning anchor covers the step instead.
        let ref = owner.ref;
        let placement = owner.placement;
        if (ref.kind === 'device' || !this.reachable(ref)) {
          ref = reasoning;
          placement = undefined;
        }
        let out = '';
        let tainted = false;
        try {
          // A repo/tool step runs on the paired computer's engine when docked
          // (real tools, real approvals). When that is not available it returns
          // null and we fall through to a chat model that describes the change.
          const onEngine = step.needsTools
            ? await this.runToolStepOnEngine(step, play, results)
            : null;
          if (onEngine !== null) {
            out = onEngine;
            // The engine is on the person's own computer: it read tainted
            // earlier outputs whole, and it may have read a local-only note
            // itself (its tool-end or pack card said so), so its text is
            // tainted in either case (I5).
            tainted = this.engineTurnLocalOnly || results.some((r) => r.localOnly === true);
            if (this.engineTurnLocalOnly) this.sendLocalOnly = true;
          } else {
            const pack = await this.packRender(ref);
            // A seat that stays here reads tainted earlier outputs whole, so
            // what it writes is tainted too.
            tainted =
              pack.localOnly || (!this.leaves(ref) && results.some((r) => r.localOnly === true));
            out = await this.completeOnce(
              ref,
              placement,
              this.stepPrompt(step, play, results, ref),
              { pack: pack.text },
            );
          }
        } catch (err) {
          out = `(this step could not run: ${err instanceof Error ? err.message : String(err)})`;
        }
        results.push({
          id: step.id,
          title: step.title,
          text: out,
          ...(tainted ? { localOnly: true as const } : {}),
        });
        done.add(step.id);
        status.set(step.id, 'completed');
        showTodos();
        if (this.aborted) {
          this.finish('aborted');
          return;
        }
      }

      // Hybrid re-plan: after a wave, let the reasoning LLM revise what remains,
      // bounded so a run cannot loop forever.
      if (done.size < play.steps.length && replans < MAX_REPLANS) {
        replans++;
        try {
          const revised = parseReplan(
            await this.completeOnce(
              reasoning,
              undefined,
              replanPrompt(play, resultsForSeat(results, this.leaves(reasoning))),
            ),
          );
          if (revised && revised.length) {
            play = mergeReplan(play, done, revised);
            showTodos();
          }
        } catch {
          // keep the current plan
        }
      }
    }

    // Final synthesis, streamed as the answer.
    this.answer = '';
    try {
      const pack = await this.packFor(reasoning);
      await this.completeOnce(reasoning, undefined, this.synthesisPrompt(userText, play, results), {
        pack,
        onDelta: (d) => {
          if (this.aborted) return;
          this.answer += d;
          this.emit({ type: 'text-delta', text: d });
        },
      });
    } catch (err) {
      if (!this.answer) this.answer = results.map((r) => `${r.title}:\n${r.text}`).join('\n\n');
      this.emit({ type: 'text-delta', text: this.answer });
      void err;
    }
    this.finish(this.aborted ? 'aborted' : 'complete');
  }

  /** The earlier turns of this chat, newest kept, for the play's prompts: a
   *  step cannot resolve "it" or "that" without them, and a thread carried in
   *  from another model lives only here. Bounded, so a long chat never crowds
   *  out the step itself. The live message (the last entry) is left out; each
   *  prompt carries it on its own. */
  private conversationDigest(leaves: boolean, maxChars = 6000): string | undefined {
    // A seat that leaves this network reads the stub for a local-only reply.
    const earlier = historyForSeat(this.history.slice(0, -1), leaves);
    const lines: string[] = [];
    let used = 0;
    for (let i = earlier.length - 1; i >= 0; i--) {
      const m = earlier[i]!;
      const line = `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`;
      if (used + line.length > maxChars) break;
      lines.unshift(line);
      used += line.length;
    }
    return lines.length ? lines.join('\n') : undefined;
  }

  /** The prompt for one step: the goal, this step's brief, and the prior steps'
   *  results as context so a handoff carries the work forward. */
  private stepPrompt(
    step: PlayStep,
    play: Play,
    results: PlayStepResult[],
    ref?: StackModelRef,
  ): string {
    // No ref is the paired computer's engine, whose model may be a cloud one.
    const leaves = ref ? this.leaves(ref) : true;
    const prior = resultsForSeat(results, leaves);
    const priorLines = prior.length
      ? ['Work done so far by the team:', ...prior.map((r) => `- ${r.title}: ${r.text}`), '']
      : [];
    const conversation = this.conversationDigest(leaves);
    return [
      conversation ? `The conversation so far, for context:\n${conversation}\n` : '',
      `Overall goal: ${play.summary}`,
      ...priorLines,
      `Your step: ${step.title}.`,
      step.brief ? step.brief : '',
      step.needsTools
        ? 'If this needs file edits or commands, describe the exact change (a diff or precise steps); the actual edit runs on the paired computer.'
        : '',
      'Do only your step. Return just its result, no preamble.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** The final synthesis: compose the answer to the user from the team's work. */
  private synthesisPrompt(userText: string, play: Play, results: PlayStepResult[]): string {
    const leaves = this.leaves(this.stack.reasoning ?? harborRef());
    const conversation = this.conversationDigest(leaves);
    const work = resultsForSeat(results, leaves);
    return [
      "Compose the final answer to the user, using the team's work below. Do not mention the internal steps or handoffs; just give the finished result.",
      ...(conversation ? [`The conversation so far, for context:\n${conversation}`] : []),
      `User request: ${userText}`,
      `Goal: ${play.summary}`,
      'Team work:',
      ...work.map((r) => `- ${r.title}: ${r.text}`),
    ].join('\n');
  }

  // ---- engine execution of a tool step (when docked) ----------------------

  /** Run a repo/tool step on the paired computer's engine, with real tools and
   *  real approvals surfaced in the chat. Returns the step's result text, or
   *  null to degrade to describe-only (not docked, no bound workspace, or the
   *  daemon refused the session, e.g. a member on a non-provisioned workspace).
   *  One engine session is opened per play (lazily) and shared across tool
   *  steps so working-tree state and cwd carry forward. Approvals are never
   *  auto-answered; they flow to the chat and back through answerApproval. */
  private async runToolStepOnEngine(
    step: PlayStep,
    play: Play,
    results: PlayStepResult[],
  ): Promise<string | null> {
    // The engine lives on your home system (the hub), which is reachable only
    // in the docked profile. Offshore and offline never reach for it, so a tool
    // step there goes straight to describe-only with no wasted hub attempt.
    if (!locationAllowed(this.profile, 'home')) return null;
    const target = this.context.daemon;
    const cwd = this.context.repoCwd;
    if (!target || !cwd) return null;
    try {
      if (!this.engineDriver) {
        const sessionId = await daemonCreateSession(
          target,
          cwd,
          engineStepSessionOpts(this.context),
        );
        this.engineDriver = new RemoteDriver(sessionId, target);
        this.engineUnsub = this.engineDriver.subscribe((event) => this.forwardEngineEvent(event));
      }
      this.emit({
        type: 'status',
        message: `Running "${step.title}" on your computer.`,
      });
      return await this.runEngineTurn(this.engineDriver, this.stepPrompt(step, play, results));
    } catch (err) {
      // A refused session (403 for a member, an unreachable hub) degrades to
      // describe-only rather than dead-ending the play.
      this.emit({
        type: 'status',
        message: `Could not run that on your computer (${err instanceof Error ? err.message : 'unavailable'}); describing the change instead.`,
      });
      return null;
    }
  }

  /** Forward the engine session's user-visible events into the chat: its tool
   *  cards, approvals, and status. The step's own final text is captured for the
   *  play's synthesis; task-done settles the turn. */
  private forwardEngineEvent(event: DriverEvent): void {
    switch (event.type) {
      case 'text-final':
        this.engineTurnText = event.text;
        if (isLocalOnlyFinal(event)) this.engineTurnLocalOnly = true;
        break;
      case 'task-done':
        if (!this.engineTurnText && event.reason === 'error') {
          this.engineTurnText = event.message ?? '(the step failed on your computer)';
        }
        this.engineTurnSettle?.();
        break;
      case 'tool-end':
        if (event.result.localOnly === true) this.engineTurnLocalOnly = true;
        this.emit(event);
        break;
      case 'tool-start':
      case 'tool-denied':
      case 'approval-request':
      case 'approval-resolved':
      case 'command-start':
      case 'command-output':
      case 'command-end':
      case 'status':
      case 'note':
        this.emit(event);
        break;
      default:
        break;
    }
  }

  /** Send one turn to the engine session and resolve with its final text. The
   *  turn also settles on abort (see abort()), so a stopped play never hangs. */
  private runEngineTurn(driver: RemoteDriver, prompt: string): Promise<string> {
    this.engineTurnText = '';
    this.engineTurnLocalOnly = false;
    return new Promise<string>((resolve) => {
      this.engineTurnSettle = () => {
        this.engineTurnSettle = undefined;
        resolve(this.engineTurnText.trim());
      };
      driver.send(prompt);
    });
  }

  /** One reusable completion on a cloud or BYOM model, returning its text.
   *  Streams to onDelta when given (the final synthesis, or a framing call
   *  that answers directly). Device models are not driven here; callers route
   *  a device owner to the reasoning anchor. An internal step shows no
   *  thinking, so the client's thinking events are dropped here. */
  private async completeOnce(
    ref: StackModelRef,
    placement: Placement | undefined,
    prompt: string,
    opts?: { images?: Attachment[]; onDelta?: (delta: string) => void; pack?: string },
  ): Promise<string> {
    const parts = this.systemParts(ref, placement, undefined, opts?.pack);
    if (ref.kind === 'device') {
      throw new RouteUnavailable('A local model cannot run this step.');
    }
    const signal = this.abortController?.signal;
    let out = '';
    const take = (ev: ProviderEvent) => {
      if (ev.type !== 'text') return;
      out += ev.text;
      opts?.onDelta?.(ev.text);
    };
    if (ref.kind === 'cloud' && ref.provider === 'anthropic') {
      const key = await secretGet(providerSecretKey('anthropic'));
      if (!key) throw new RouteUnavailable('Connect Claude under Cloud Connections first.');
      const client = anthropicClient(await this.claudeClient(key), {
        model: ref.model,
        max_tokens: 4096,
        system: this.claudeSystem(parts),
      });
      const content = opts?.images?.length
        ? buildVisionContent(prompt, opts.images).content
        : prompt;
      for await (const ev of client.stream([{ role: 'user', content }], [], signal)) take(ev);
      return out;
    }
    // OpenAI-compatible: a built-in cloud provider or a BYOM endpoint.
    const seat = await this.openAiSeat(ref);
    const userContent = opts?.images?.length ? openAiVisionContent(prompt, opts.images) : prompt;
    const messages: OaiMessage[] = [
      { role: 'system', content: joinSystem(parts, this.promptCache()) },
      { role: 'user', content: userContent },
    ];
    for await (const ev of openAiCompatibleClient(seat).stream(messages, [], signal)) take(ev);
    return out;
  }

  /** The OpenAI-compatible seat for a cloud provider or your own server: its
   *  address, key and extra headers. A cloud provider needs its key; a BYOM
   *  server may take none (a local server often asks for nothing). */
  private async openAiSeat(ref: Exclude<StackModelRef, { kind: 'device' }>): Promise<OpenAiSeat> {
    if (ref.kind === 'byom') {
      return {
        label: ref.label,
        baseUrl: ref.baseUrl,
        key: (await secretGet(byomSecretKey(ref.id))) ?? undefined,
        model: ref.model,
        extraHeaders: benchExtraHeaders(ref.id, this.context.conversationId),
      };
    }
    const base = providerInfo(ref.provider)?.openaiBaseUrl;
    if (!base) throw new RouteUnavailable(`No endpoint configured for ${refName(ref)}.`);
    const key = await secretGet(providerSecretKey(ref.provider));
    if (!key) {
      throw new RouteUnavailable(`Connect ${ref.provider} under Cloud Connections first.`);
    }
    return { label: refName(ref), baseUrl: base, key, model: ref.model };
  }

  /** A piece of the model's thinking, shown only while Chain of Thought is on. */
  private emitThought(text: string | undefined): void {
    if (!text || this.aborted) return;
    // A thought is the model at work: the slow-start line is not needed.
    this.clearSlowStart();
    if (this.cot) this.emit({ type: 'thinking-delta', text });
  }

  /** Show a piece of the answer and keep it for history (only what the
   *  search filter let through, so a search line never lands in either). */
  private showAnswer(text: string): void {
    if (!text || this.aborted) return;
    this.clearSlowStart();
    this.answer += text;
    this.emit({ type: 'text-delta', text });
  }

  /** The system prompt plus the think-in-tags line, for a model that does not
   *  reason through its own API, while Chain of Thought is on. */
  private withThinking(system: string, model: string): string {
    const line = chainOfThoughtLine(model, this.cot);
    return line ? `${system}\n\n${line}` : system;
  }

  /** Route a split slice of a reply: answer text to `text`, thinking to the
   *  thinking block (while on) or nowhere (while off). */
  private routeThought(pieces: ThoughtPiece[], text: (delta: string) => void): void {
    for (const p of pieces) {
      if (p.kind === 'text') text(p.text);
      else this.emitThought(p.text);
    }
  }

  /** End the turn, once: the answer so far (whole, or the part that streamed
   *  before a stop or a failure) goes to history and the chat, the raw search
   *  results give way to one line, and the turn's ending is said. A second
   *  call (a run unwinding after Stop already closed the turn) does nothing. */
  private finish(reason: 'complete' | 'aborted' | 'error' | 'declined', message?: string): void {
    if (this.turnClosed) return;
    this.turnClosed = true;
    this.clearSlowStart();
    const text = this.answer.trim();
    this.search.settle(this.history);
    if (text) {
      this.history.push({
        role: 'assistant',
        content: text,
        ...(this.sendLocalOnly ? { localOnly: true as const } : {}),
      });
    }
    this.emit(textFinal(text, this.sendLocalOnly));
    this.emit({ type: 'task-done', reason, message });
  }

  // ---- the wait before the first word (CX ruling 5) -------------------------

  private slowStart?: { word(): void; stop(): void };
  /** Local seats this chat has already asked, so "Warming up" is said on the
   *  first request (when a server most likely loads the model), not on every
   *  turn to a model that is already warm. */
  private warmedSeats = new Set<string>();

  /** A model on your computer is about to be asked: the first time, say it
   *  is warming up; on any turn, once, if no word comes in 30 seconds, that
   *  it can be slow to start and Stop works any time. Only for a local seat
   *  that is not this device (a pocket model says its own load). */
  private watchLocalStart(ref: StackModelRef): void {
    this.clearSlowStart();
    if (ref.kind !== 'byom' || this.leaves(ref)) return;
    if (!this.warmedSeats.has(seatKey(ref))) {
      this.warmedSeats.add(seatKey(ref));
      this.emit({ type: 'status', message: warmingLine(refName(ref)) });
    }
    this.slowStart = watchFirstWord(() => {
      this.slowStart = undefined;
      if (!this.turnClosed && !this.answer) {
        this.emit({ type: 'status', message: SLOW_START_LINE });
      }
    });
  }

  /** A word arrived (or the turn ended): the slow-start line is not needed. */
  private clearSlowStart(): void {
    this.slowStart?.stop();
    this.slowStart = undefined;
  }

  // ---- on-device backend --------------------------------------------------

  private async attachDeviceListeners(): Promise<void> {
    this.deviceListeners.push(
      await Llama.addListener('token', ({ requestId, delta }) => {
        if (requestId !== this.activeRequestId) return;
        this.armWatchdog(requestId);
        this.routeThought(this.thinkSplitter.push(delta), (t) => this.deviceText(t));
      }),
    );
    this.deviceListeners.push(
      await Llama.addListener('generationDone', ({ requestId, stopReason, detail }) => {
        // The runner confirmed a stop this driver already closed the turn on.
        if (requestId === this.stoppingRequestId) {
          this.stoppingRequestId = undefined;
          this.clearAbortBeat();
        }
        if (requestId !== this.activeRequestId) return;
        this.clearDeviceTimers();
        this.activeRequestId = undefined;
        this.routeThought(this.thinkSplitter.end(), (t) => this.deviceText(t));
        const turn = this.deviceTurn;
        const decision = this.search.decide(this.webReachable() && searchOffered());
        if (stopReason === 'end' && turn && !this.aborted && decision.kind !== 'answer') {
          if (decision.kind === 'refused') {
            // A second search line (or one with no search to run) is never
            // shown and never run: the reply had no answer in it.
            this.finish('error', emptyReplyMessage(turn.ref.modelName));
            return;
          }
          void this.answerWithSearch(decision.query, turn.ref.modelName, 'local', () =>
            this.runDevice(turn.ref, turn.placement),
          ).catch((err) =>
            this.aborted || isAbortError(err)
              ? this.finish('aborted')
              : this.finish('error', describeError(err)),
          );
          return;
        }
        if (decision.kind === 'answer') this.showAnswer(decision.flush);
        if (stopReason === 'error') {
          // Whatever the slot holds after an error is suspect; reload next time.
          forgetDeviceModel();
          this.finish('error', detail ?? 'The on-device model hit a problem.');
        } else if (stopReason === 'end' && !this.answer.trim() && this.deviceModelName) {
          // A finished reply with no words is a failure, not a quiet success.
          this.finish('error', emptyReplyMessage(this.deviceModelName));
        } else this.finish(stopReason === 'stopped' ? 'aborted' : 'complete');
      }),
    );
  }

  /** Answer text from the device model, through the search-line filter. */
  private deviceText(delta: string): void {
    this.showAnswer(this.search.push(delta));
  }

  private async runDevice(
    ref: Extract<StackModelRef, { kind: 'device' }>,
    placement?: Placement,
  ): Promise<void> {
    await this.listenersReady;
    // The phone's one model slot is shared with every device chat (APP-3):
    // confirm the slot holds this model before every reply, never assume it.
    // A load cannot be cancelled; a Stop during it has already closed the
    // turn, and the check below keeps the reply from starting.
    const ready = await ensureDeviceModel(
      {
        id: ref.modelId,
        name: ref.modelName,
        contextSize: DEVICE_CONTEXT_TOKENS,
      },
      (message) => this.emit({ type: 'status', message }),
    );
    // Stopped while the model loaded: the turn is already closed (abort), so
    // never start the reply the person asked to stop.
    if (this.aborted) throw abortError();
    if (!ready.ok) throw new RouteUnavailable(ready.detail);
    const guide = isHarborMini(ref.modelId);
    if (guide && this.guidePrompt === undefined) {
      this.guidePrompt = (
        await raceAbort(
          prepareGuideTurn(
            this.lastUserText(),
            this.context.researchOn === true,
            this.emit,
            // The real reach: this chat's profile, and the device right now.
            this.webReachable() && webOnlineNow(),
            this.context.conversationId,
          ),
          this.abortController?.signal,
        )
      ).prompt;
      // Stopped during the guide's web search: unwind the way a stopped load does.
      if (this.aborted) throw abortError();
    }
    this.deviceTurn = { ref, placement };
    // Harbor Lite never speaks the search protocol (its harness searched for
    // it); every other pocket model is filtered on every pass.
    this.search.startPass(!guide);
    const requestId = `req_${Date.now().toString(36)}_${(stackRequestSeq++).toString(36)}`;
    this.activeRequestId = requestId;
    this.deviceModelName = ref.modelName;
    // Chain of Thought: Harbor Lite's guide turns are left alone (a 512-token
    // reply cannot carry a thought); any other pocket model thinks in tags,
    // with room for the thought beside the answer.
    this.thinkSplitter = new ThinkTagSplitter();
    const base = this.systemFor(ref, placement, this.searchPrompt(), this.turnPackFor(ref));
    const system = guide ? base : this.withThinking(base, ref.modelId);
    const maxTokens = guide ? 512 : this.cot ? 2048 : 1024;
    const res = await Llama.generate({
      requestId,
      system,
      messages: fitDeviceHistory(
        system,
        this.history.map((m) => ({ role: m.role, content: m.content })),
        maxTokens,
      ),
      maxTokens,
      temperature: 0.6,
    });
    // A refused start already reported generationDone; only a started reply
    // needs the watchdog.
    if (res?.started === false) return;
    this.armWatchdog(requestId);
  }

  // A started reply that produces no token for STALL_TIMEOUT_MS is over as far
  // as this chat is concerned: the native side lost it (a memory warning
  // unloaded the model mid-reply, another chat's load took the slot, or the
  // runner wedged). Tell it to stop, drop the slot claim so the next send
  // reloads, and end the task honestly.
  private armWatchdog(requestId: string): void {
    this.clearWatchdog();
    this.watchdog = setTimeout(() => {
      this.watchdog = undefined;
      if (this.activeRequestId !== requestId) return;
      this.activeRequestId = undefined;
      this.clearAbortBeat();
      void Llama.stop({ requestId }).catch(() => {});
      forgetDeviceModel();
      this.finish('error', 'The on-device model stopped answering. Try again.');
    }, STALL_TIMEOUT_MS);
  }

  private clearWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = undefined;
  }

  private clearAbortBeat(): void {
    if (this.abortBeat) clearTimeout(this.abortBeat);
    this.abortBeat = undefined;
  }

  private clearDeviceTimers(): void {
    this.clearWatchdog();
    this.clearAbortBeat();
  }

  // ---- local web search ---------------------------------------------------

  /** A local model asked for a search: run it on the Settings provider, hand
   *  the results back as the next turn, and let the same model answer for
   *  real. Once per message (searchTurn.ts), so a confused model cannot loop.
   *  The SEARCH: line never reaches the transcript or the history, and once
   *  the answer is in, the results give way to one line in history. */
  private async answerWithSearch(
    query: string,
    model: string,
    providerKind: 'local' | 'cloud',
    again: () => Promise<void>,
  ): Promise<void> {
    const resultText = await this.search.run(
      query,
      this.context.researchOn === true,
      this.emit,
      this.abortController?.signal,
    );
    this.answer = '';
    if (this.aborted) throw abortError();
    this.history.push({ role: 'user', content: resultText });
    this.emit({ type: 'turn-start', turn: this.history.length, model, providerKind });
    await again();
  }

  // ---- cloud backends -----------------------------------------------------

  private async runCloud(
    ref: Extract<StackModelRef, { kind: 'cloud' }>,
    placement?: Placement,
    images: Attachment[] = [],
  ): Promise<void> {
    const parts = this.systemParts(ref, placement, undefined, this.turnPackFor(ref));
    // An image turn takes the plain vision path (it needs no tools); otherwise
    // the turn carries its tools (Codemagic Access, or the vault slice), and
    // one with none is a single round of the same loop.
    const tools = images.length ? { codemagic: false, vault: [] } : this.toolsFor(ref);
    if (ref.provider === 'anthropic') {
      const key = await secretGet(providerSecretKey(ref.provider));
      if (!key) {
        throw new RouteUnavailable(`Connect ${ref.provider} under Cloud Connections first.`);
      }
      await this.runAnthropic(key, ref, parts, images, tools);
      return;
    }
    const seat = await this.openAiSeat(ref);
    await this.runOpenAi(ref, seat, joinSystem(parts, this.promptCache()), images, {
      tools,
      searchable: false,
    });
  }

  private async runByom(
    ref: Extract<StackModelRef, { kind: 'byom' }>,
    placement?: Placement,
    images: Attachment[] = [],
  ): Promise<void> {
    // A plain text turn on your own model may search the web the way a pocket
    // model does. An Agentic Current's bench model brings its own tools.
    const searchable = !images.length && !this.context.codemagicAccess && !isCurrentBenchId(ref.id);
    const system = this.systemFor(
      ref,
      placement,
      searchable ? this.searchPrompt() : undefined,
      this.turnPackFor(ref),
    );
    // An image turn takes the plain vision path; otherwise the turn carries
    // its tools, and one with none is a single round of the same loop. A key
    // is optional: a local or trusted-network server may take none.
    const tools = images.length ? { codemagic: false, vault: [] } : this.toolsFor(ref);
    const seat = await this.openAiSeat(ref);
    await this.runOpenAi(ref, seat, system, images, {
      tools,
      searchable,
      // The answer pass after a search rebuilds the prompt, so it reads that
      // the search is spent.
      again: () => this.runByom(ref, placement, images),
    });
  }

  /** A Claude client on the person's own key (and workspace, when set). */
  private async claudeClient(key: string): Promise<Anthropic> {
    const ws = (
      await storeGetJson<{ anthropicWorkspaceId?: string }>('oscode.settings.v1')
    )?.anthropicWorkspaceId?.trim();
    return new Anthropic({
      apiKey: key,
      dangerouslyAllowBrowser: true,
      fetch: streamingFetch,
      ...(ws ? { defaultHeaders: { 'anthropic-workspace-id': ws } } : {}),
    });
  }

  /** One streamed round on any seat: thinking to the thinking block (only
   *  while Chain of Thought is on), answer text to the chat (through the
   *  search filter on a searchable seat), and the round's end. A later
   *  round's prose is set apart from the one before it. */
  private async streamRound<M, T>(
    client: ProviderClient<M, T>,
    messages: M[],
    tools: T[],
    round: number,
    searchable: boolean,
  ): Promise<Extract<ProviderEvent, { type: 'done' }>> {
    let started = false;
    let done: Extract<ProviderEvent, { type: 'done' }> | undefined;
    const show = (text: string) => this.showAnswer(searchable ? this.search.push(text) : text);
    for await (const ev of client.stream(messages, tools, this.abortController?.signal)) {
      if (this.aborted) throw abortError();
      if (ev.type === 'thinking') this.emitThought(ev.text);
      else if (ev.type === 'text') {
        if (!started && round > 0 && this.answer && !this.answer.endsWith('\n')) show('\n\n');
        started = true;
        show(ev.text);
      } else if (ev.type === 'done') done = ev;
    }
    if (this.aborted) throw abortError();
    if (!done) throw new RouteUnavailable('The reply ended before it finished.');
    return done;
  }

  // Claude, with or without tools. The turn's tools (Codemagic when its access
  // is on, and the vault slice, CTO J10) are offered; each tool_use runs
  // on-device (the Codemagic token in the Keychain, never sent to the model; a
  // vault read judged by the privacy rules), the observation is fed back, and
  // the loop continues until the model answers with no tool call. Bounded so
  // a loop cannot run away. A vault write is only queued; one card at the end
  // asks for all. A turn with images folds them into the live user turn.
  private async runAnthropic(
    key: string,
    ref: Extract<StackModelRef, { kind: 'cloud' }>,
    parts: SystemParts,
    images: Attachment[],
    tools: { codemagic: boolean; vault: AppVaultToolName[] },
  ): Promise<void> {
    const model = ref.model;
    const messages: Anthropic.MessageParam[] = opensOnUser(
      this.historyFor(ref).map((m) => ({ role: m.role, content: m.content })),
    );
    const extraTail: string[] = [];
    if (images.length && messages.length) {
      // Fold the images into the current (last) user turn as image blocks, with
      // frame labels and a context header when they came from a video. History
      // stays text-only; only this turn carries the pixels.
      const last = messages[messages.length - 1]!;
      const built = buildVisionContent(String(last.content ?? ''), images);
      last.content = built.content;
      if (hasVideoFrames(images)) extraTail.push(VIDEO_FRAMES_SYSTEM_NOTE);
    }
    const offered: Anthropic.Tool[] = [
      ...(tools.codemagic ? [codemagicToolSpec as unknown as Anthropic.Tool] : []),
      ...tools.vault.map(
        (n) =>
          vaultAnthropicTool(
            n,
            this.agentFolder(this.opts.vaultTools),
          ) as unknown as Anthropic.Tool,
      ),
    ];
    // Chain of Thought on: Claude thinks through its own API, and the summary
    // streams into the thinking block above the answer. The assistant turn is
    // replayed with its final content, so a thinking turn's signed blocks ride
    // back with its tool_use, as the API requires.
    const client = anthropicClient(await this.claudeClient(key), {
      model,
      ...claudeRequestThinking(model, 2048, this.cot),
      system: this.claudeSystem(parts, extraTail),
      ...this.claudeCacheParam(),
    });
    const MAX_ROUNDS = 16;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (this.aborted) throw abortError();
      const done = await this.streamRound(client, messages, offered, round, false);
      if (!done.toolCalls.length) {
        await this.settleProposals();
        this.finish('complete');
        return;
      }
      messages.push({ role: 'assistant', content: done.replay as Anthropic.ContentBlockParam[] });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tc of done.toolCalls) {
        const observation = await this.runToolCall(ref, tools, tc.name, { parsed: tc.parsed });
        results.push({ type: 'tool_result', tool_use_id: tc.id, content: observation });
      }
      messages.push({ role: 'user', content: results });
    }
    // Ran the round budget without a final answer: settle with what we have so
    // the chat does not hang, and let the person pick up from here.
    this.emit({
      type: 'status',
      message: 'Paused the tool loop after several rounds. Send a message to continue.',
    });
    await this.settleProposals();
    this.finish('complete');
  }

  /** Dispatch one tool call to the tool it names, when that tool was offered. */
  private async runToolCall(
    ref: StackModelRef,
    tools: { codemagic: boolean; vault: AppVaultToolName[] },
    name: string,
    args: Pick<ProviderToolCall, 'parsed' | 'raw'>,
  ): Promise<string> {
    if (isAppVaultToolName(name) && tools.vault.includes(name)) {
      const call =
        args.raw !== undefined
          ? parseVaultToolArgs(name, args.raw)
          : vaultToolInputFrom(name, args.parsed);
      return this.runVaultToolCall(ref, name, call);
    }
    if (tools.codemagic && name === CODEMAGIC_TOOL_NAME) {
      const input =
        args.raw !== undefined
          ? parseCodemagicArgs(args.raw)
          : (args.parsed as unknown as CodemagicToolInput);
      return input
        ? this.runCodemagicToolCall(name, input)
        : 'Those tool arguments could not be parsed. Call the codemagic tool with JSON like {"action":"trigger"} or {"action":"status","buildId":"..."}.';
    }
    return `Unknown tool ${name}.`;
  }

  // Execute one codemagic tool call on-device and return the observation. Shared
  // by the Anthropic and OpenAI-compatible loops so the two behave identically.
  private async runCodemagicToolCall(name: string, input: CodemagicToolInput): Promise<string> {
    if (name !== CODEMAGIC_TOOL_NAME) return `Unknown tool ${name}.`;
    this.emit({
      type: 'status',
      message: `Codemagic: ${input.action}${input.buildId ? ` ${input.buildId}` : ''}.`,
    });
    return runCodemagicTool(input);
  }

  // Every OpenAI-compatible seat, the built-in cloud providers AND your own
  // model server (BYOM), with or without tools, on the one provider client
  // (streamed on every shell). Each tool call runs on-device and the
  // observation is fed back until the model answers with no tool call. Bounded
  // so a loop cannot run away. A server that refuses tools on the first round
  // of a vault-only turn (a local model with no tool template) gets the plain
  // path instead, and this seat stays on it for the rest of the chat. A
  // searchable seat (a local model's own turn) may ask for one web search.
  private async runOpenAi(
    ref: Exclude<StackModelRef, { kind: 'device' }>,
    seat: OpenAiSeat,
    system: string,
    images: Attachment[],
    o: {
      tools: { codemagic: boolean; vault: AppVaultToolName[] };
      searchable: boolean;
      again?: () => Promise<void>;
    },
  ): Promise<void> {
    const withVideo =
      images.length && hasVideoFrames(images) ? `${system}\n${VIDEO_FRAMES_SYSTEM_NOTE}` : system;
    const messages: OaiMessage[] = [
      { role: 'system', content: this.withThinking(withVideo, seat.model) },
      ...this.historyFor(ref).map((m) => ({ role: m.role, content: m.content as unknown })),
    ];
    if (images.length && messages.length > 1) {
      // Fold the images into the current (last) user turn as image_url parts,
      // with frame labels and a context header when they came from a video.
      const last = messages[messages.length - 1]!;
      last.content = openAiVisionContent(String(last.content ?? ''), images);
    }
    const offered = [
      ...(o.tools.codemagic ? [codemagicOpenAiTool] : []),
      ...o.tools.vault.map((n) => vaultOpenAiTool(n, this.agentFolder(this.opts.vaultTools))),
    ];
    if (o.searchable) this.search.startPass();
    this.watchLocalStart(ref);
    const client = openAiCompatibleClient(seat);
    const MAX_ROUNDS = 16;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (this.aborted) throw abortError();
      let done: Extract<ProviderEvent, { type: 'done' }>;
      try {
        done = await this.streamRound(client, messages, offered, round, o.searchable);
      } catch (err) {
        const refused =
          round === 0 &&
          offered.length > 0 &&
          !o.tools.codemagic &&
          !this.aborted &&
          !this.answer &&
          err instanceof RouteUnavailable &&
          (err.status === 400 || err.status === 404 || err.status === 422);
        if (!refused) throw err;
        this.noToolSeats.add(seatKey(ref));
        await this.runOpenAi(ref, seat, system, images, {
          ...o,
          tools: { codemagic: false, vault: [] },
        });
        return;
      }
      if (!done.toolCalls.length) {
        if (o.searchable) {
          const decision = this.search.decide(this.webReachable() && searchOffered());
          if (decision.kind === 'search' && o.again) {
            await this.answerWithSearch(decision.query, seat.label, 'cloud', o.again);
            return;
          }
          if (decision.kind !== 'answer') {
            // A second search line (or one with no search to run) is never
            // shown and never run: the reply had no answer in it.
            this.finish('error', emptyReplyMessage(seat.label));
            return;
          }
          this.showAnswer(decision.flush);
        }
        await this.settleProposals();
        this.finish('complete');
        return;
      }
      messages.push(done.replay as OaiMessage);
      for (const tc of done.toolCalls) {
        const observation = await this.runToolCall(ref, o.tools, tc.name, { raw: tc.raw });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: observation });
      }
    }
    if (o.searchable) {
      const decision = this.search.decide(false);
      if (decision.kind === 'answer') this.showAnswer(decision.flush);
    }
    this.emit({
      type: 'status',
      message: 'Paused the tool loop after several rounds. Send a message to continue.',
    });
    await this.settleProposals();
    this.finish('complete');
  }

  // ---- lifecycle ----------------------------------------------------------

  abort(): void {
    this.aborted = true;
    this.abortController?.abort();
    this.pendingAsk?.settle(false);
    const requestId = this.activeRequestId;
    if (requestId) {
      // Late tokens (and the runner's own done) for this request are dropped
      // by id from here: the turn closes below, now.
      this.activeRequestId = undefined;
      this.clearWatchdog();
      void Llama.stop({ requestId }).catch(() => {});
      // The runner normally confirms with generationDone('stopped'). When it
      // does not (the request was already lost), drop the slot claim a beat
      // later so the next send reloads rather than trusting a wedged slot.
      this.stoppingRequestId = requestId;
      this.clearAbortBeat();
      this.abortBeat = setTimeout(() => {
        this.abortBeat = undefined;
        if (this.stoppingRequestId !== requestId) return;
        this.stoppingRequestId = undefined;
        forgetDeviceModel();
      }, ABORT_BEAT_MS);
    }
    // Stop any engine turn a tool step has running on the paired computer, and
    // settle the awaited turn so the play does not hang on a stopped run.
    this.engineDriver?.abort();
    this.engineTurnSettle?.();
    // Stop answers at once on every seat (CTO ruling 7): the turn closes now
    // with whatever streamed so far, kept in the chat and in history. A model
    // load cannot be stopped, but the turn can; the run drops out when the
    // load, the shim, or the search it is waiting on comes back.
    this.finish('aborted');
  }

  recordLine(turn: SeedTurn): void {
    this.history.push({ role: turn.role, content: turn.text });
  }

  answerApproval(id: string, answer: ApprovalAnswer): void {
    // This driver's own card (an image bound for the cloud) settles here; a
    // tool step's approval is the engine's, so it passes through to it.
    if (this.pendingAsk?.id === id) {
      this.pendingAsk.settle(answer.approve);
      return;
    }
    this.engineDriver?.answerApproval(id, answer);
  }

  dispose(): void {
    // Silent first: a teardown is not a Stop the chat should record.
    this.emitter.clear();
    this.abort();
    // Nothing is listening after dispose; the timers armed above have no
    // turn left to finish.
    this.clearDeviceTimers();
    this.engineUnsub?.();
    this.engineDriver?.dispose();
    this.engineDriver = undefined;
    for (const h of this.deviceListeners) void h.remove();
    this.deviceListeners = [];
  }
}
