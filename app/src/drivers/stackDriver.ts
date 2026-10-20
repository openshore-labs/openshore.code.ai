// The phone-side router and play runner. Chatting with "your stack" runs
// through here. A capable reasoning anchor frames the prompt and composes a
// play (an ordered set of handoffs to the stack's specialists with
// dependencies), briefs the user as todos-with-owners, runs the steps in
// dependency order handing each to its owner, re-plans at bounded checkpoints,
// and streams a final synthesis (see lib/play.ts for the pure core). The flow
// degrades to a single routed turn whenever the anchor is a weak or unreachable
// model, the plan will not parse, or the play is a single step, so a modest
// stack still just answers. Image turns route by capability (routeVision);
// when nothing can read a picture, the turn answers with two doors, a local
// model to source and a cloud model to connect (lib/imageReading.ts). The
// Codemagic tool loop keeps its own single-turn path.
//
// Backends: on-device (llama.cpp), Anthropic, an OpenAI-compatible cloud
// endpoint, or an address you connect in either format. A play step that must
// edit files or run commands (needsTools) runs on the paired computer's engine
// when docked, over one shared RemoteDriver session, with its real tool
// approvals surfaced in the chat; when not docked (or no local workspace is
// bound) the step is described instead. Still v1: the fallback classifier is a
// keyword heuristic, not a model; on-device models are text-only (no vision,
// not driven for autonomous sub-steps); the image-gen category routes as text
// and does not yet render images; "home" models require pairing.
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
  STALL_TIMEOUT_MS,
  deviceLoadFor,
  deviceMessages,
  devicePictures,
  deviceTurnShape,
  emptyReplyMessage,
  ensureDeviceModel,
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
import { cloudImageReaders, providerInfo, providerSecretKey } from '../lib/providers.js';
import {
  heldImageModel,
  imageAskDetail,
  imageFallbackDetail,
  imageTurnLine,
} from '../lib/imageNote.js';
import type { ImageReaderGap } from '../lib/imageReading.js';
import { imageBlockParts, type Attachment } from '../lib/attachments.js';
import { buildVisionContent, describeError, opensOnUser } from './cloudClaudeDriver.js';
import { frameLabel, videoContextHeader, VIDEO_FRAMES_SYSTEM_NOTE } from '../lib/videoAttach.js';
import {
  PlanReplyFilter,
  briefTodos,
  handoffNote,
  mergeReplan,
  parsePlan,
  parseReplan,
  planCanRun,
  planPrompt,
  readySteps,
  replanPrompt,
  stepRunner,
  type Play,
  type PlayStack,
  type PlayStep,
  type StepResult,
} from '../lib/play.js';
import { effortDirective } from '../lib/effort.js';
import {
  privatePlanCloudEngineNote,
  privatePlanEngineNote,
  vaultProposalRecords,
} from '../lib/vaultCopy.js';
import type { SeedTurn } from '../state/types.js';
import { byomSecretKey, byomWireOf } from '../lib/byom.js';
import { addressAnthropic } from './addressClient.js';
import { isCurrentBenchId } from '../lib/currents.js';
import { buildHarborSystemPrompt, harborSearchesByDefault, isHarbor } from '../lib/harbor.js';
import { buildHarborMiniSystemPrompt, guidedSetupLine, isHarborMini } from '../lib/harborMini.js';
import {
  prepareGuideTurn,
  searchOffered,
  webOnlineNow,
  type AfterPrivate,
} from '../lib/localSearch.js';
import { PROFILES, locationAllowed, type ProfileId } from '../lib/profiles.js';
import {
  harborRef,
  pickVisionRef,
  refKey,
  refName,
  refStaysLocal,
  visionCapable,
  visionSlots,
  type ActiveMember,
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
import {
  DriverEmitter,
  PlaceholderNotice,
  PrivateHold,
  isLocalOnlyFinal,
  stubsReply,
  textFinal,
} from './types.js';
import {
  RemoteDriver,
  daemonCreateSession,
  daemonStack,
  type DaemonTarget,
} from './remoteDriver.js';
import type { DaemonStackInfo, DriverEvent, VaultOverrides } from 'os-code/protocol';
import { writingVoiceLine } from '../lib/writingVoice.js';
import { appActionsContract } from '../lib/appActions.js';

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
  /** Your writing voice (Settings, Writing; lib/writingVoice.ts): the
   *  person's own words for how a model writes for them. Rides to every seat,
   *  alone or beside the humanizer. */
  writingVoice?: string;
  /** The Wayfinding Memory switch (memoryOverride): false when the person
   *  turned Memory off, so a play's engine step opens its session with project
   *  memory off. Undefined leaves the project's config in charge. App-side
   *  chats keep no project memory, so nothing else here reads it. */
  memory?: false;
  /** The device's vault switches (Vault M7, tech review L13): Notes in chats and
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
  /** Prompt caching on Claude (`settings.promptCache`, default off, tech review J16,
   *  J17): on, the stable head of the system prompt goes as its own block
   *  marked for caching and the request asks for automatic caching of the
   *  growing history. Off sends the same blocks with no marker. Unset reads
   *  the live setting (`promptCacheOn`). */
  promptCache?: boolean;
}

/** The app vault seam the Stack's vault tools read and write through (Vault
 *  M5, tech review J10). The personal vault only: the store passes `teamVault` true
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
  /** Whether a write may be offered this turn (absent: yes). False: the
   *  chat still reads the notes the person made, but is never offered the
   *  proposal tool, so no card appears that could not land. Read each turn. */
  canWrite?: () => boolean;
  /** True while the team vault is the target (D15: never in context). */
  teamVault?: () => boolean;
  /** The paths an approved card wrote, for "Recently from your agent". */
  onWritten?: (paths: string[]) => void;
  /** The personal vault's `agent.folder` (Vault M7, tech review L2), read at each
   *  offer and again at approve; undefined is anywhere in the vault. */
  agentFolder?: () => string | undefined;
  /** Whether a note a model writes carries its provenance lines (tech review L9).
   *  Absent is on. */
  provenance?: () => boolean;
}

/** The Stack driver's trailing options (tech review J1, J5, J10). */
export interface StackDriverOptions extends DriverVaultOptions {
  /** The seat a ref answers as (`packSeatFor(ref, ctx)`), or null for no pack
   *  and no vault tools. Absent: no seat is known, so no pack, no vault tools,
   *  and every network seat is treated as leaving this network. */
  packSeat?: (ref: StackModelRef) => PackSeat | null;
  /** The vault tools' seam; absent offers none. */
  vaultTools?: StackVaultTools;
}

/** A seed turn, carrying the local-only mark (tech review I5) when the transcript
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
 *  vault read (tech review I5, mirroring the engine's `ChatMessage.localOnly`): a
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

/** One earlier turn as a play's prompts carry it (conversationDigest). */
function digestLine(m: Msg): string {
  return `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`;
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

/** A system prompt in two parts (tech review J16): the stable head (static, then per
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

/** A cloud seat with no key: the provider by the name Cloud Connections
 *  shows, never its id ("Connect Groq", not "Connect groq"; 2026-10-09). */
function connectFirst(providerId: string): string {
  return `Connect ${providerInfo(providerId)?.name ?? providerId} under Cloud Connections first.`;
}

/** The answer room an Anthropic-format address is given (2026-10-09): the
 *  format needs one, and a server built to it may cap a model's output lower
 *  than Claude's, so it is a modest, set number. */
export const BYOM_ANTHROPIC_MAX_TOKENS = 4096;

/** The chat as an Anthropic-format address takes it (2026-10-09): opening on
 *  a person's turn, no empty turn, and two turns in a row from one side
 *  merged into one (a search's results follow the question they answer as a
 *  second user turn), since a server built to the format may refuse either. */
export function anthropicTurns(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): Anthropic.MessageParam[] {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of history) {
    if (!m.content.trim()) continue;
    const last = out.at(-1);
    if (last && last.role === m.role) last.content = `${last.content}\n\n${m.content}`;
    else out.push({ role: m.role, content: m.content });
  }
  return opensOnUser(out);
}

/** This turn's images on the person's last turn, as image blocks (an
 *  Anthropic-format address, 2026-10-09). An image sent with no words leaves
 *  no turn of its own (`anthropicTurns` drops an empty one), so the images
 *  then open a turn of their own rather than ride on the reply before them,
 *  and no empty text block goes with them, which the format refuses. */
export function withTurnImages(
  messages: Anthropic.MessageParam[],
  images: Attachment[],
): Anthropic.MessageParam[] {
  if (!images.length) return messages;
  const last = messages.at(-1);
  const onUser = last?.role === 'user';
  const built = buildVisionContent(onUser ? String(last.content) : '', images).content;
  const content =
    typeof built === 'string' ? built : built.filter((b) => b.type !== 'text' || b.text.trim());
  if (onUser) return [...messages.slice(0, -1), { role: 'user', content }];
  return content.length ? [...messages, { role: 'user', content }] : messages;
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

/** The seat's provenance lines for a note a model writes (Vault M7, tech review L9):
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

/** The turn's end when the person keeps a picture the Local model failed on
 *  off the Cloud model (K): both slots are set, so only the first sentence
 *  of IMAGE_NOT_SENT is true here. Several pictures read as several. */
export const IMAGE_NOT_SENT_FALLBACK = 'You declined, so the image was not sent.';
export const IMAGES_NOT_SENT_FALLBACK = 'You declined, so the images were not sent.';

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
  // Nothing here can read images this send (an unread picture, or a plan's
  // image step on the text alone): the two-door offer, shown once, after the
  // answer and before the turn closes (finish).
  private pendingOffer?: ImageReaderGap;
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
  /** The person's own words this turn, so a device pass after a search still
   *  shapes itself on them, not on the search results. */
  private personAsk = '';
  /** A device reply's thought shows though Chain of Thought is off: the turn
   *  thinks on its own (a Harbor coding request). */
  private deviceShowsThought = false;
  private guidePrompt?: string;
  // A card this driver put in front of the person (an image bound for a model
  // not placed for Image reading), waiting on their tap.
  private pendingAsk?: { id: string; settle: (approved: boolean) => void };
  // The vault pack for this send (tech review J1, J5): prepared once after task-start,
  // rendered for each seat that answers once the seat is known. `turnPack` is
  // the rendered text for the single-turn seat in flight.
  private packPrepared: Promise<void> = Promise.resolve();
  private turnPack?: { ref: StackModelRef; text?: string };
  // Effort, read once per send so a flip mid-reply cannot move the prompt.
  private sendEffort = effortDirective();
  // tech review I5: this send read a local-only note, so its reply is marked.
  private sendLocalOnly = false;
  // This send's text already went to a model that leaves this network (the
  // framing call on such a Reasoning model), so the chat's reach for the
  // send reads cloud on every route, a model here answering it included.
  private sendLeft = false;
  // The vault writes this send proposed, shown on one card at its end (D4),
  // and the privacy rules, loaded once per send.
  private proposals: VaultProposal[] = [];
  private sendPrivacy?: Promise<VaultPrivacy | undefined>;
  // Seats whose server refused a request with tools on it (an Ollama model
  // with no tool template answers 400): they get the plain path afterwards.
  private noToolSeats = new Set<string>();
  // The placeholder line (F): once in this chat for each model off this
  // network, the first time it is sent the placeholder for a marked reply.
  private readonly placeholder = new PlaceholderNotice();
  // Whether this chat holds a private note's text, and why (H): a search a
  // model here writes then asks every time.
  private readonly hold = new PrivateHold();

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
      for (const t of seed) this.hold.keep(t.localOnly);
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
   *  Reasoning model, else any reachable model. */
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

  /** Every turn the person typed in this chat, oldest first. */
  private userTurns(): string[] {
    return this.history.filter((m) => m.role === 'user').map((m) => m.content);
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

  /** The system prompt, stable to volatile (tech review J16): the base or guide, the
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
    // The person's own writing voice: on every seat, small ones included,
    // since it is their instruction and a few lines long.
    const voice = writingVoiceLine(this.context.writingVoice);
    if (voice) standards.push(voice);
    // App actions: only a seat whose requests stay on this network is told it
    // may propose a settings change, and only once this chat asks for one
    // (lib/appActions.ts).
    const actions = appActionsContract(this.leaves(ref), this.userTurns());
    if (actions) standards.push(actions);
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

  // ---- vault seat, pack and privacy (tech review J1, J2, J5, I5) ------------------

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

  /** Whether `ref` answers on this person's own network, for the Image
   *  reading slots: the seat's own judgement when the store gives one (it
   *  knows this device's tailnet), else by address alone (`refStaysLocal`),
   *  so a model at a public address is never the Local slot. */
  private staysLocal(ref: StackModelRef): boolean {
    const seat = ref.kind === 'device' ? null : this.seatFor(ref);
    return seat ? !seat.leavesNetwork : refStaysLocal(ref);
  }

  /** Whether `ref`'s requests leave this network. A device seat is this
   *  phone; any other seat that cannot be judged reads as leaving, the safe
   *  reading. */
  private leaves(ref: StackModelRef): boolean {
    if (ref.kind === 'device') return false;
    return this.seatFor(ref)?.leavesNetwork ?? true;
  }

  /** The history as `ref` receives it (tech review I5), saying so the first time a
   *  model off this network is sent the placeholder for a marked reply (F). */
  private historyFor(ref: StackModelRef): Msg[] {
    const leaves = this.leaves(ref);
    this.notePlaceholder(
      ref,
      this.history.some((m) => stubsReply(m, leaves)),
    );
    return historyForSeat(this.history, leaves);
  }

  /** Say the placeholder line for `ref` once in this chat, when what it is
   *  about to be sent carries the placeholder for a marked reply (F). */
  private notePlaceholder(ref: StackModelRef, stubbed: boolean): void {
    const notice = this.placeholder.take(seatKey(ref), refName(ref), stubbed);
    if (notice) this.emit(notice);
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
    this.hold.pack(localOnly, rendered.pinOnly === true);
    return { text, localOnly };
  }

  /** The vault tools `ref` is offered on the single-turn path (tech review J10). */
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
    const slice = vaultToolSlice({
      kind: ref.kind,
      mergedVaultTool: vaultPolicyFor(seat.modelClass).mergedVaultTool,
      currentBench: ref.kind === 'byom' && isCurrentBenchId(ref.id),
      playStep: false,
      teamVault,
    });
    let canWrite = true;
    try {
      canWrite = this.opts.vaultTools.canWrite?.() ?? true;
    } catch {
      canWrite = false;
    }
    return canWrite ? slice : slice.filter((n) => n !== 'vaultPropose');
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

  /** The provenance a proposal carries (Vault M7, tech review L9, L10), merged NOW,
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
    if (result.localOnly) {
      this.sendLocalOnly = true;
      this.hold.read();
    }
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
      // Checked again right before the write (tech review L8): the settings folder,
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

  /** Claude's `system` for these parts (tech review J16): the one app builder,
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
   *  by the Reasoning model on its own; "request" members wait to be named. */
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
    this.hold.begin();
    this.sendLeft = false;
    this.proposals = [];
    this.pendingOffer = undefined;
    this.sendPrivacy = undefined;
    this.turnPack = undefined;
    this.answer = '';
    this.history.push({ role: 'user', content: text });
    this.personAsk = text;
    this.deviceShowsThought = false;
    this.turnClosed = false;
    this.emit({ type: 'task-start', input: text });
    // The vault pack for this send, gathered while routing runs (tech review J5); it
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
    // with someone to hand off to, the reasoning model frames the request and
    // composes a play, or answers a simple request itself in the same call
    // (B2). A stack with only its anchor (and no docked workspace) has no one
    // to hand off to, and an anchor on this device or out of reach cannot
    // frame, so it skips the framing call and answers in one (planCanRun,
    // the rule the Stack's Image reading rows read too). It hands back to
    // the single-turn path below when the plan will not parse, or the play
    // is a single specialist step.
    if (
      !(attachments ?? []).some((a) => a.isImage) &&
      !this.context.codemagicAccess &&
      planCanRun(this.stack, (r) => this.reachable(r), this.engineInReach())
    ) {
      const handled = await this.tryRunPlay(text);
      if (handled) return;
    }

    // An image-bearing turn routes by capability, not by the text classifier:
    // the model placed for image reading if it can see and is reachable, else a
    // vision-capable model already in the stack, else a connected cloud
    // provider (a maintainer's "if there isn't one available and capable it can
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
        // Nothing here can read it (2026-10-07): not an error, a
        // reply with two doors, a local model to source and a cloud model to
        // connect. The picture goes nowhere; the turn ends complete.
        this.pendingOffer = await this.imageGap('image');
        this.finish('complete');
        return;
      }
      // Only a model placed for Image reading takes an image without a word
      // (2026-09-25). Any other reader, the anchor or a connected cloud
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

    this.turnStart(refName(target.ref), target.ref.kind === 'device' ? 'local' : 'cloud');
    // Rendered only now, after routing and any Jev steer, so the pack fits
    // the seat that actually answers (tech review J5).
    this.turnPack = { ref: target.ref, text: await this.packFor(target.ref) };
    this.markIfReadsPrivateTurn(target.ref);
    if (images.length) {
      // With nothing set for Image reading, the line says so and names the
      // reader and what it runs on, the same words a plan's image step uses.
      const slots = visionSlots(this.stack);
      this.emit({
        type: 'status',
        message:
          !slots.local && !slots.cloud
            ? imageTurnLine(target.ref, this.stack.reasoning, images.length)
            : `Reading ${images.length === 1 ? 'this image' : `these ${images.length} images`} with ${refName(target.ref)}.`,
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
      // The Local model failed on a picture before writing a word, and the
      // Cloud slot holds a model that reads images and is in reach: a card
      // asks before the picture goes to it, once, with no second fallback
      // (UX and copy review, 2026-10-08, K).
      if (images.length) {
        const cloud = this.cloudAfterLocal(target.ref);
        if (cloud) {
          await this.readAfterLocalFailed(target.ref, cloud, images);
          return;
        }
      }
      // Graceful degradation is the contract: if a placed specialist could not
      // run, fall back to the Reasoning anchor for this turn rather than
      // dead-ending, exactly as the desktop router does. An image turn is the
      // exception: routeVision already chose the best reachable reader (and the
      // reasoning anchor may not read images at all), so it never falls back
      // here, it fails with the reader's own error. A specialist that already
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
      this.turnStart(refName(reasoning), reasoning.kind === 'device' ? 'local' : 'cloud');
      // The anchor is a different seat: its own pack, sized for it.
      this.turnPack = { ref: reasoning, text: await this.packFor(reasoning) };
      this.markIfReadsPrivateTurn(reasoning);
      this.answer = '';
      await this.runRef(reasoning, undefined, []);
    }
  }

  /** The Cloud slot's model, when a picture the Local slot's model just
   *  failed on may go to it (K): `ref` is the Local slot's model, nothing of
   *  its answer was written, and the Cloud slot holds a model that reads
   *  images and is in reach in this status. Otherwise undefined, and the
   *  turn ends with the Local model's own error, as before. */
  private cloudAfterLocal(ref: StackModelRef): ActiveMember | undefined {
    if (this.answer.trim()) return undefined;
    const { local, cloud } = visionSlots(this.stack, (r) => this.staysLocal(r));
    if (!local || !cloud || refKey(local.ref) !== refKey(ref)) return undefined;
    if (!visionCapable(cloud.ref) || !this.reachable(cloud.ref)) return undefined;
    return cloud;
  }

  /** Ask before a picture the Local model failed on goes to the Cloud
   *  model, amber for a cloud model (askToReadImage's kinds), then read it
   *  there once. A no sends nothing; a stop ends the turn; a failure on the
   *  Cloud model ends the turn with its own error (K). */
  private async readAfterLocalFailed(
    local: StackModelRef,
    cloud: ActiveMember,
    images: Attachment[],
  ): Promise<void> {
    const what = images.length === 1 ? 'this image' : `these ${images.length} images`;
    const spend = cloud.ref.kind === 'cloud';
    const approved = await this.askFirst({
      kind: spend ? 'cloud-spend' : 'tool',
      toolName: 'analyzeImage',
      risk: spend ? 'cloud-spend' : 'network',
      summary: `Read ${what} with ${refName(cloud.ref)}?`,
      detail: imageFallbackDetail(local, cloud.ref, images.length),
    });
    if (!approved) {
      if (this.aborted) this.finish('aborted');
      else {
        this.finish(
          'declined',
          images.length === 1 ? IMAGE_NOT_SENT_FALLBACK : IMAGES_NOT_SENT_FALLBACK,
        );
      }
      return;
    }
    if (this.aborted) throw abortError();
    this.emit({ type: 'status', message: `Reading ${what} with ${refName(cloud.ref)}.` });
    this.turnStart(refName(cloud.ref), 'cloud');
    // A different seat: its own pack, sized for it.
    this.turnPack = { ref: cloud.ref, text: await this.packFor(cloud.ref) };
    this.markIfReadsPrivateTurn(cloud.ref);
    this.answer = '';
    await this.runRef(cloud.ref, cloud.placement, images);
  }

  /** A seat that stays on this network reads the chat whole, a local-only
   *  turn included, so what it writes may quote that turn: the reply is
   *  marked too, or a later turn on a seat that leaves would read the quote
   *  whole (I5 and D5, the same rule a play's steps follow). */
  private markIfReadsPrivateTurn(ref: StackModelRef): void {
    if (!this.leaves(ref) && this.history.some((m) => m.localOnly === true)) {
      this.sendLocalOnly = true;
    }
  }

  /** The chat's reach for this send (what Chats and the top bar read): cloud
   *  once anything in the send went to a model that leaves this network,
   *  even when a model here answers it (M1). */
  private turnStart(model: string, kind: 'local' | 'cloud'): void {
    this.emit({
      type: 'turn-start',
      turn: this.history.length,
      model,
      providerKind: this.sendLeft ? 'cloud' : kind,
    });
  }

  /** Whether a play's tool step can run on the paired computer's engine:
   *  docked, with a workspace bound (runToolStepOnEngine's own checks). */
  private engineInReach(): boolean {
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
    // A device model gets the pictures only when it reads them (Harbor with
    // its vision file); routeVision picks no other device model for them.
    if (ref.kind === 'device') await this.runDevice(ref, placement, images);
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
    const pick = pickVisionRef(
      this.stack,
      (r) => this.reachable(r),
      (r) => this.staysLocal(r),
    );
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
   *  (Cloud spend) when the reader is a cloud model, plain when it is your own.
   *  A model set for Image reading that cannot take this picture (a model on
   *  this device, one that does not read images) is named with its reason,
   *  never called missing. */
  private askToReadImage(ref: StackModelRef, count: number): Promise<boolean> {
    const what = count === 1 ? 'this image' : `these ${count} images`;
    const cloud = ref.kind === 'cloud';
    const held = heldImageModel(
      this.stack,
      (r) => this.reachable(r),
      (r) => this.staysLocal(r),
    );
    return this.askFirst({
      kind: cloud ? 'cloud-spend' : 'tool',
      toolName: 'analyzeImage',
      risk: cloud ? 'cloud-spend' : 'network',
      summary: `Read ${what} with ${refName(ref)}?`,
      detail: imageAskDetail(ref, count, held, PROFILES[this.profile].label),
    });
  }

  /** Put a card in front of the person and wait for their tap. A stop counts
   *  as a no, and the card says so: the turn waits on the tap with no timer,
   *  so Stop is the way past it without answering. A detail written as one
   *  paragraph (the image card's) takes the stop line in the same paragraph,
   *  so the card shows it as wrapping prose; a line break would set it as a
   *  code block, cut at the sheet's edge on a phone. */
  private askFirst(request: Omit<ApprovalRequest, 'id'>): Promise<boolean> {
    const id = `ask_${Date.now().toString(36)}_${(stackRequestSeq++).toString(36)}`;
    const detail = request.detail;
    request = {
      ...request,
      detail: !detail
        ? ASK_STOP_LINE
        : detail.includes('\n')
          ? `${detail}\n\n${ASK_STOP_LINE}`
          : `${detail} ${ASK_STOP_LINE}`,
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

  /** Why nothing here can read images, for the offer's lead: a model set for
   *  Image reading that cannot read here (and why), and whether a connected
   *  cloud reader is out of reach in this status or missing. */
  private async imageGap(from: ImageReaderGap['from']): Promise<ImageReaderGap> {
    const placed = heldImageModel(
      this.stack,
      (r) => this.reachable(r),
      (r) => this.staysLocal(r),
    );
    let keyed = false;
    for (const reader of cloudImageReaders()) {
      if (await secretGet(providerSecretKey(reader.provider)).catch(() => null)) {
        keyed = true;
        break;
      }
    }
    // The status rides along whenever it is what holds reading back: a
    // reader set up but out of reach, or a status (Offline) in which nothing
    // that reads images is in reach, so adding one would not help until the
    // person leaves it.
    const held = placed?.why === 'out-of-reach' || keyed || !locationAllowed(this.profile, 'cloud');
    return {
      from,
      cloud: keyed ? 'out-of-reach' : 'none',
      ...(placed ? { placed } : {}),
      ...(held ? { status: PROFILES[this.profile].label } : {}),
    };
  }

  /** A connected, reachable cloud model that reads images, when the stack holds
   *  none: the first of cloudImageReaders (Claude's least costly model, then
   *  each other provider's image reader) with a stored key. The label names
   *  the model, so the card says exactly which one the image would go to, and
   *  it is the name the Stack's Image reading rows show (D13, 2026-10-07). */
  private async cloudVisionFallback(): Promise<StackModelRef | undefined> {
    for (const reader of cloudImageReaders()) {
      const ref: StackModelRef = { kind: 'cloud', ...reader };
      if (this.reachable(ref) && (await secretGet(providerSecretKey(reader.provider)))) return ref;
    }
    return undefined;
  }

  // ---- plan-first orchestration -------------------------------------------

  /** Frame the prompt with the reasoning model and, when it is clear and needs
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

    // The stack as the play reads it, with the model an image in the chat
    // would go to while nothing is placed for Image reading (routeVision).
    // A plan carries no picture, so its image step runs on the Reasoning
    // model whatever this holds (E); it says only whether anything here
    // reads images, for the step's note and the two-door offer.
    const roster: PlayStack = {
      ...this.stack,
      imageReader: (await this.routeVision())?.ref,
      reachable: (r) => this.reachable(r),
      staysLocal: (r) => this.staysLocal(r),
    };

    this.emit({ type: 'status', message: 'Framing the request.' });
    const reply = new PlanReplyFilter();
    let answering = false;
    this.answer = '';
    let framedLocalOnly = false;
    // A Reasoning model that stays on this network reads the chat whole (the
    // turns its digest carries): a private turn among them taints what it
    // writes, its own answer or the plan (D5, I5).
    const readPrivateTurn =
      !this.leaves(reasoning) && this.digestTurns(false).some((m) => m.localOnly === true);
    try {
      const framed = await this.packRender(reasoning);
      const pack = framed.text;
      framedLocalOnly = framed.localOnly;
      // The framing call carries the message and the chat: on a Reasoning
      // model that leaves, the send is a cloud one from here, whoever
      // answers it, and however it ends (M1).
      if (this.leaves(reasoning)) {
        this.sendLeft = true;
        this.turnStart(refName(reasoning), 'cloud');
      }
      await this.completeOnce(
        reasoning,
        undefined,
        planPrompt(
          text,
          roster,
          contextNote,
          this.conversationDigest(this.leaves(reasoning), reasoning),
          true,
        ),
        {
          pack,
          onDelta: (d) => {
            const shown = reply.push(d);
            if (!shown) return;
            if (!answering) {
              answering = true;
              if (readPrivateTurn) this.sendLocalOnly = true;
              this.turnStart(refName(reasoning), 'cloud');
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
      // The questions are this send's turn: one from a model here reads local
      // (one that leaves marked the send cloud when the framing call went).
      if (!this.sendLeft) this.turnStart(refName(reasoning), 'local');
      this.emit({ type: 'clarify', summary: framing.summary, questions: framing.questions });
      this.answer = '';
      this.finish('complete');
      return true;
    }

    // A single-step (or empty) play is one specialist's answer; let the
    // single-turn path route it, so behavior is unchanged for those prompts.
    if (framing.steps.length <= 1) return false;

    // D5 on a plan: an anchor that stays on this network read its pack and
    // the chat whole, so when either held a private note, the goal and the
    // briefs it wrote may quote it. No step of this plan then goes to a
    // model that leaves this network (executePlay).
    const planLocalOnly = (!this.leaves(reasoning) && framedLocalOnly) || readPrivateTurn;
    await this.executePlay(
      { summary: framing.summary, steps: framing.steps },
      text,
      roster,
      planLocalOnly,
    );
    return true;
  }

  /** Run the play: brief the user (todos with owners), execute steps in
   *  dependency order handing each to its owner, re-plan at bounded checkpoints,
   *  then stream a final synthesis. `localOnly` says the plan draws on a
   *  private note (tryRunPlay): every step whose model leaves this network
   *  then runs on the anchor instead, which stays (D5). */
  private async executePlay(
    initial: Play,
    userText: string,
    base: PlayStack,
    localOnly = false,
  ): Promise<void> {
    const reasoning = this.stack.reasoning ?? harborRef();
    let play = initial;
    // The stack as this plan reads it. While the plan draws on a private
    // note, stepRunner covers each step bound for a model that leaves, so
    // the task list, the working note and the runner all name the anchor.
    let privatePlan = localOnly;
    const keepPrivate = (r: StackModelRef) => this.leaves(r);
    let roster: PlayStack = privatePlan ? { ...base, keepPrivate } : base;
    // The answer is written from that plan, so it is marked as well (I5).
    if (privatePlan) this.sendLocalOnly = true;
    // Each step's output, tainted (`localOnly`) when it was written on a seat
    // that read a local-only note: its pack carried one, or a tainted earlier
    // output reached it whole, or the plan itself draws on one. A prompt for
    // a seat that leaves this network gets `LOCAL_ONLY_STUB` in a tainted
    // output's place (I5, as history).
    const results: PlayStepResult[] = [];
    const done = new Set<string>();
    const status = new Map<string, 'pending' | 'in_progress' | 'completed'>();
    const showTodos = () => this.emit({ type: 'todos', items: briefTodos(play, roster, status) });
    // The chat's reach for this send (what Chats and the top bar read): the
    // framing call went to the anchor, and once any step goes to a model
    // that leaves this network, or to your computer's agent (whose model may
    // be a cloud one), the send is marked cloud, as a cloud turn is.
    let reach: 'local' | 'cloud' | undefined;
    const markReach = (leaves: boolean) => {
      const next = leaves ? 'cloud' : 'local';
      if (reach === 'cloud' || reach === next) return;
      reach = next;
      this.turnStart(refName(reasoning), next);
    };
    markReach(this.leaves(reasoning));

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

        // A device owner (or an unreachable one) is not run autonomously; the
        // reasoning anchor covers the step instead. stepRunner is the one
        // rule, the same one the task list names its owner by.
        const { ref, placement } = stepRunner(step, roster);
        // Tenet 4 holds whole (UX and copy review, 2026-10-08, E): a plan never
        // carries a picture, so an image step with nothing set for Image
        // reading runs on the Reasoning model from the text, never on a
        // second model the person did not pick for it, and the note says so.
        // A model set for Image reading that cannot take the step here (one
        // on this phone) is named as such, with the model that covers it.
        this.emit({ type: 'status', message: handoffNote(step, roster) });
        // Nothing here reads images: the step still runs, the Reasoning model
        // working from the text, and the turn closes with the two-door offer,
        // once however many image steps the play holds.
        if (step.category === 'vision' && !roster.imageReader && !this.pendingOffer) {
          this.pendingOffer = await this.imageGap('play');
        }
        let out = '';
        let tainted = false;
        try {
          // A repo/tool step runs on the paired computer's engine when docked
          // (real tools, real approvals). When that is not available it returns
          // null and we fall through to a chat model that describes the change.
          // A plan that draws on a private note goes there only when the
          // computer, asked now, says its Reasoning model stays on its network
          // and it takes a local-only turn: the step then goes marked, so the
          // engine's own D5 rules hold for it (UX and copy review, 2026-10-08, J).
          // Otherwise the step is described here, and the note says why.
          let onEngine: string | null = null;
          let privateEngine = false;
          if (step.needsTools && !privatePlan) {
            onEngine = await this.runToolStepOnEngine(step, play, results);
          } else if (step.needsTools && privatePlan && this.engineInReach()) {
            const report = await this.engineStackReport();
            if (this.aborted) {
              this.finish('aborted');
              return;
            }
            if (report?.orchestrator?.kind === 'local' && report.acceptsLocalOnly === true) {
              privateEngine = true;
              onEngine = await this.runToolStepOnEngine(step, play, results, true);
            } else {
              this.emit({
                type: 'status',
                message:
                  report?.orchestrator?.kind === 'cloud'
                    ? privatePlanCloudEngineNote(step.title, refName(ref))
                    : privatePlanEngineNote(step.title, refName(ref)),
              });
            }
          }
          if (onEngine !== null) {
            out = onEngine;
            // A marked step on a computer whose Reasoning model stays there
            // reaches no model off its network (the engine refuses a handoff
            // and never escalates while it holds the step), so the send keeps
            // its reach; any other engine step may reach a cloud model.
            markReach(!privateEngine);
            // The engine is on the person's own computer: it read tainted
            // earlier outputs whole, and it may have read a local-only note
            // itself (its tool-end or pack card said so), so its text is
            // tainted in either case (I5). A marked step's always is.
            tainted =
              privateEngine ||
              this.engineTurnLocalOnly ||
              results.some((r) => r.localOnly === true);
            if (this.engineTurnLocalOnly) {
              this.sendLocalOnly = true;
              this.hold.read();
            }
          } else {
            markReach(this.leaves(ref));
            const pack = await this.packRender(ref);
            // A seat that stays here reads tainted earlier outputs whole, and
            // a plan that draws on a private note, so what it writes is
            // tainted too.
            tainted =
              pack.localOnly ||
              (!this.leaves(ref) && (privatePlan || results.some((r) => r.localOnly === true)));
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

      // Hybrid re-plan: after a wave, let the reasoning model revise what remains,
      // bounded so a run cannot loop forever.
      if (done.size < play.steps.length && replans < MAX_REPLANS) {
        replans++;
        try {
          const anchorLeaves = this.leaves(reasoning);
          const revised = parseReplan(
            await this.completeOnce(
              reasoning,
              undefined,
              replanPrompt(play, this.resultsFor(results, anchorLeaves, reasoning)),
            ),
          );
          if (revised && revised.length) {
            play = mergeReplan(play, done, revised);
            // An anchor that stays read a tainted output whole, so the
            // briefs it revised may quote a private note (D5).
            if (!anchorLeaves && !privatePlan && results.some((r) => r.localOnly === true)) {
              privatePlan = true;
              roster = { ...base, keepPrivate };
            }
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
  private conversationDigest(
    leaves: boolean,
    seat?: StackModelRef,
    maxChars = 6000,
  ): string | undefined {
    const turns = this.digestTurns(leaves, maxChars);
    // A model off this network that is sent the placeholder hears it said
    // once in this chat (F). The paired computer's engine (no seat here)
    // gets the placeholder inside its step's text, and nothing here names
    // the model it runs, so no line is said for it.
    if (seat) {
      this.notePlaceholder(
        seat,
        turns.some((m) => stubsReply(m, leaves)),
      );
    }
    const lines = turns.map(digestLine);
    return lines.length ? lines.join('\n') : undefined;
  }

  /** The turns `conversationDigest` carries, marks kept, so a plan can tell
   *  whether the chat its Reasoning model read held a private turn (D5). */
  private digestTurns(leaves: boolean, maxChars = 6000): Msg[] {
    // A seat that leaves this network reads the stub for a local-only reply.
    const earlier = historyForSeat(this.history.slice(0, -1), leaves);
    const kept: Msg[] = [];
    let used = 0;
    for (let i = earlier.length - 1; i >= 0; i--) {
      const m = earlier[i]!;
      const line = digestLine(m);
      if (used + line.length > maxChars) break;
      kept.unshift(m);
      used += line.length;
    }
    return kept;
  }

  /** The play's step outputs as `seat` receives them (resultsForSeat),
   *  saying the placeholder line the first time a model off this network is
   *  sent the placeholder in place of a step a local model wrote after a
   *  private read, as for a marked reply in the chat (F). No seat is the
   *  paired computer's engine, as in conversationDigest. */
  private resultsFor(
    results: PlayStepResult[],
    leaves: boolean,
    seat?: StackModelRef,
  ): PlayStepResult[] {
    if (seat) {
      this.notePlaceholder(seat, leaves && results.some((r) => r.localOnly === true));
    }
    return resultsForSeat(results, leaves);
  }

  /** The prompt for one step: the goal, this step's brief, and the prior steps'
   *  results as context so a handoff carries the work forward. */
  private stepPrompt(
    step: PlayStep,
    play: Play,
    results: PlayStepResult[],
    ref?: StackModelRef,
    engineKeepsPrivate = false,
  ): string {
    // No ref is the paired computer's engine, whose model may be a cloud one,
    // so it reads the placeholder for a marked turn; unless the step goes
    // marked local-only to an engine whose Reasoning model stays on its
    // network (J), which holds it to the engine's own D5 rules.
    const leaves = ref ? this.leaves(ref) : !engineKeepsPrivate;
    const prior = this.resultsFor(results, leaves, ref);
    const priorLines = prior.length
      ? ['Work done so far by the team:', ...prior.map((r) => `- ${r.title}: ${r.text}`), '']
      : [];
    const conversation = this.conversationDigest(leaves, ref);
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
    const reasoning = this.stack.reasoning ?? harborRef();
    const leaves = this.leaves(reasoning);
    const conversation = this.conversationDigest(leaves, reasoning);
    const work = this.resultsFor(results, leaves, reasoning);
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
    localOnly = false,
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
      return await this.runEngineTurn(
        this.engineDriver,
        this.stepPrompt(step, play, results, undefined, localOnly),
        localOnly,
      );
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
   *  turn also settles on abort (see abort()), so a stopped play never hangs.
   *  `localOnly` sends it marked (J). */
  private runEngineTurn(driver: RemoteDriver, prompt: string, localOnly = false): Promise<string> {
    this.engineTurnText = '';
    this.engineTurnLocalOnly = false;
    return new Promise<string>((resolve) => {
      this.engineTurnSettle = () => {
        this.engineTurnSettle = undefined;
        resolve(this.engineTurnText.trim());
      };
      driver.send(prompt, undefined, localOnly ? { localOnly: true } : {});
    });
  }

  /** The paired computer's stack, asked fresh for a private plan's step
   *  (J): what its Reasoning model is judged by (`orchestrator.kind`) and
   *  whether it takes a local-only turn. Undefined when it cannot say (out
   *  of reach, an error, a stop), which reads as an older daemon's silence. */
  private async engineStackReport(): Promise<DaemonStackInfo | undefined> {
    const target = this.context.daemon;
    if (!target) return undefined;
    try {
      return await raceAbort(daemonStack(target), this.abortController?.signal);
    } catch {
      return undefined;
    }
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
    if (ref.kind === 'byom' && byomWireOf(ref) === 'anthropic') {
      const client = anthropicClient(
        await this.addressClient(ref),
        {
          model: ref.model,
          max_tokens: BYOM_ANTHROPIC_MAX_TOKENS,
          system: joinSystem(parts, this.promptCache()),
        },
        { label: ref.label },
      );
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
    if (!key) throw new RouteUnavailable(connectFirst(ref.provider));
    return { label: refName(ref), baseUrl: base, key, model: ref.model };
  }

  /** A piece of the model's thinking, shown only while Chain of Thought is on. */
  private emitThought(text: string | undefined): void {
    if (!text || this.aborted) return;
    // A thought is the model at work: the slow-start line is not needed.
    this.clearSlowStart();
    if (this.cot || this.deviceShowsThought) this.emit({ type: 'thinking-delta', text });
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
    this.hold.settle(Boolean(text) && this.sendLocalOnly);
    this.emit(textFinal(text, this.sendLocalOnly));
    // The offer follows the answer, so it never splits a streaming reply, and
    // lands inside the turn; a stopped turn drops it.
    const offer = this.pendingOffer;
    this.pendingOffer = undefined;
    if (offer && reason === 'complete') this.emit({ type: 'image-reader-offer', ...offer });
    this.emit({ type: 'task-done', reason, message });
  }

  // ---- the wait before the first word (UX review ruling 5) -------------------------

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
          void this.answerWithSearch(decision.query, turn.ref, 'local', () =>
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
    images: Attachment[] = [],
  ): Promise<void> {
    await this.listenersReady;
    // The phone's one model slot is shared with every device chat (APP-3):
    // confirm the slot holds this model before every reply, never assume it.
    // A load cannot be cancelled; a Stop during it has already closed the
    // turn, and the check below keeps the reply from starting.
    const load = deviceLoadFor(ref.modelId);
    const ready = await ensureDeviceModel(
      { id: ref.modelId, name: ref.modelName, ...load },
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
    // A Harbor question about the world searches before Harbor writes a word
    // (harborSearchesByDefault), with the person's own words as the query; the
    // answer pass below is then told it already searched.
    if (
      !guide &&
      isHarbor(ref.modelId) &&
      this.search.mayAsk() &&
      harborSearchesByDefault(this.personAsk, Boolean(load.visionId) && images.length > 0)
    ) {
      const resultText = await this.search.run(
        this.personAsk.slice(0, 200),
        this.context.researchOn === true,
        this.emit,
        this.abortController?.signal,
        this.searchAfterPrivate(ref),
      );
      if (this.aborted) throw abortError();
      this.history.push({ role: 'user', content: resultText });
    }
    this.thinkSplitter = new ThinkTagSplitter();
    const base = this.systemFor(ref, placement, this.searchPrompt(), this.turnPackFor(ref));
    const system = guide ? base : this.withThinking(base, ref.modelId);
    // This turn's pictures ride the person's last message, when the model
    // reads them (load.visionId is set only then).
    const pictures = load.visionId ? devicePictures(images) : [];
    // A Harbor coding request thinks first with a capped thought; Chain of
    // Thought gives any other turn room for a thought beside the answer.
    const shape = deviceTurnShape(
      ref.modelId,
      { content: this.personAsk, pictures: pictures.length > 0 },
      { cot: this.cot, guide, base: guide ? 512 : 1024, temperature: 0.6 },
    );
    this.deviceShowsThought = shape.showThought;
    const lastUser = this.history.map((m) => m.role).lastIndexOf('user');
    const res = await Llama.generate({
      requestId,
      system,
      messages: deviceMessages(
        system,
        this.history.map((m, i) =>
          i === lastUser && pictures.length
            ? { role: m.role, content: m.content, images: pictures }
            : { role: m.role, content: m.content },
        ),
        shape.replyRoom,
        load.contextSize,
      ),
      maxTokens: shape.maxTokens,
      ...shape.sampling,
      thinking: shape.thinking,
      thinkBudget: shape.thinkBudget,
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
    ref: StackModelRef,
    providerKind: 'local' | 'cloud',
    again: () => Promise<void>,
  ): Promise<void> {
    const resultText = await this.search.run(
      query,
      this.context.researchOn === true,
      this.emit,
      this.abortController?.signal,
      this.searchAfterPrivate(ref),
    );
    this.answer = '';
    if (this.aborted) throw abortError();
    this.history.push({ role: 'user', content: resultText });
    this.turnStart(refName(ref), providerKind);
    await again();
  }

  /** A search the seat `ref` wrote, once this chat holds a private note's
   *  text on a seat that stays on this network (a read, a marked turn, or a
   *  private pin): it asks every time, and one bound for Perplexity does not
   *  run (UX and copy review, 2026-10-08, H). Undefined for a clean chat, and for a
   *  seat that leaves, which was never sent a private note's text. */
  private searchAfterPrivate(ref: StackModelRef): AfterPrivate | undefined {
    if (this.leaves(ref)) return undefined;
    const cause = this.hold.cause();
    return cause ? { afterPrivate: true, cause } : undefined;
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
      if (!key) throw new RouteUnavailable(connectFirst(ref.provider));
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
    const o = {
      tools,
      searchable,
      // The answer pass after a search rebuilds the prompt, so it reads that
      // the search is spent.
      again: () => this.runByom(ref, placement, images),
    };
    if (byomWireOf(ref) === 'anthropic') {
      await this.runByomAnthropic(ref, system, images, o);
      return;
    }
    const seat = await this.openAiSeat(ref);
    await this.runOpenAi(ref, seat, system, images, o);
  }

  /** A client for an address you connected in the Anthropic format: your key
   *  (or none, for a keyless server on your own network) and nothing of
   *  Claude's (addressClient.ts), on the transport Claude's own requests
   *  stream through. */
  private async addressClient(ref: Extract<StackModelRef, { kind: 'byom' }>): Promise<Anthropic> {
    const key = (await secretGet(byomSecretKey(ref.id)))?.trim() || null;
    return addressAnthropic({ baseUrl: ref.baseUrl, key, transport: streamingFetch });
  }

  /** Your own model at an address in the Anthropic format (2026-10-09): a
   *  conservative Messages request, plain system text, a set max_tokens,
   *  merged turns, no thinking parameter, no cache markers, and the same
   *  tools, search and fallback to no tools the OpenAI-compatible path has.
   *  With Chain of Thought on, a model that does not reason through its own
   *  API is prompted to think in tags, as any other model is. */
  private async runByomAnthropic(
    ref: Extract<StackModelRef, { kind: 'byom' }>,
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
    const messages = withTurnImages(anthropicTurns(this.historyFor(ref)), images);
    const offered: Anthropic.Tool[] = [
      ...(o.tools.codemagic ? [codemagicToolSpec as unknown as Anthropic.Tool] : []),
      ...o.tools.vault.map(
        (n) =>
          vaultAnthropicTool(
            n,
            this.agentFolder(this.opts.vaultTools),
          ) as unknown as Anthropic.Tool,
      ),
    ];
    if (o.searchable) this.search.startPass();
    this.watchLocalStart(ref);
    const client = anthropicClient(
      await this.addressClient(ref),
      {
        model: ref.model,
        max_tokens: BYOM_ANTHROPIC_MAX_TOKENS,
        system: this.withThinking(withVideo, ref.model),
      },
      { label: ref.label },
    );
    await this.runToolLoop(
      ref,
      ref.label,
      {
        client,
        messages,
        offered,
        replay: (done) => ({
          role: 'assistant' as const,
          content: done.replay as Anthropic.ContentBlockParam[],
        }),
        results: (rs) => [
          {
            role: 'user' as const,
            content: rs.map((r): Anthropic.ToolResultBlockParam => ({
              type: 'tool_result',
              tool_use_id: r.id,
              content: r.observation,
            })),
          },
        ],
        withoutTools: () =>
          this.runByomAnthropic(ref, system, images, {
            ...o,
            tools: { codemagic: false, vault: [] },
          }),
      },
      o,
    );
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
    let sources: Extract<ProviderEvent, { type: 'sources' }>['citations'] = [];
    const show = (text: string) => this.showAnswer(searchable ? this.search.push(text) : text);
    for await (const ev of client.stream(messages, tools, this.abortController?.signal)) {
      if (this.aborted) throw abortError();
      if (ev.type === 'thinking') this.emitThought(ev.text);
      else if (ev.type === 'text') {
        if (!started && round > 0 && this.answer && !this.answer.endsWith('\n')) show('\n\n');
        started = true;
        show(ev.text);
      } else if (ev.type === 'sources') sources = ev.citations;
      else if (ev.type === 'done') done = ev;
    }
    if (this.aborted) throw abortError();
    if (!done) throw new RouteUnavailable('The reply ended before it finished.');
    // A Perplexity seat's sources, once per round, the way its direct chat
    // shows them; a provider with none says nothing.
    if (sources.length) this.emit({ type: 'citations', citations: sources });
    return done;
  }

  // Claude, with or without tools. The turn's tools (Codemagic when its access
  // is on, and the vault slice, tech review J10) are offered; each tool_use runs
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
  // (streamed on every shell), through the one tool loop (runToolLoop). Each
  // tool call runs on-device and the observation is fed back until the model
  // answers with no tool call. A server that refuses tools on the first round
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
    await this.runToolLoop(
      ref,
      seat.label,
      {
        client: openAiCompatibleClient(seat),
        messages,
        offered,
        replay: (done) => done.replay as OaiMessage,
        results: (rs) =>
          rs.map((r) => ({ role: 'tool', tool_call_id: r.id, content: r.observation })),
        withoutTools: () =>
          this.runOpenAi(ref, seat, system, images, {
            ...o,
            tools: { codemagic: false, vault: [] },
          }),
      },
      o,
    );
  }

  /** One seat's rounds, in whichever format it speaks: stream a round, run
   *  each tool call it asks for on-device and feed the observation back, until
   *  it answers with no tool call. Bounded so a loop cannot run away. A server
   *  that refuses tools on the first round of a vault-only turn gets the same
   *  turn with none (`withoutTools`), and this seat stays on that for the rest
   *  of the chat. A searchable seat may ask for one web search. */
  private async runToolLoop<M, T>(
    ref: Exclude<StackModelRef, { kind: 'device' }>,
    label: string,
    turn: {
      client: ProviderClient<M, T>;
      messages: M[];
      offered: T[];
      /** The assistant turn to send back before its tool results. */
      replay: (done: Extract<ProviderEvent, { type: 'done' }>) => M;
      /** The tool results, as this format sends them. */
      results: (rs: Array<{ id: string; observation: string }>) => M[];
      /** The same turn with no tools, after the server refused them. */
      withoutTools: () => Promise<void>;
    },
    o: {
      tools: { codemagic: boolean; vault: AppVaultToolName[] };
      searchable: boolean;
      again?: () => Promise<void>;
    },
  ): Promise<void> {
    const { messages, offered } = turn;
    const MAX_ROUNDS = 16;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (this.aborted) throw abortError();
      let done: Extract<ProviderEvent, { type: 'done' }>;
      try {
        done = await this.streamRound(turn.client, messages, offered, round, o.searchable);
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
        await turn.withoutTools();
        return;
      }
      if (!done.toolCalls.length) {
        if (o.searchable) {
          const decision = this.search.decide(this.webReachable() && searchOffered());
          if (decision.kind === 'search' && o.again) {
            await this.answerWithSearch(decision.query, ref, 'cloud', o.again);
            return;
          }
          if (decision.kind !== 'answer') {
            // A second search line (or one with no search to run) is never
            // shown and never run: the reply had no answer in it.
            this.finish('error', emptyReplyMessage(label));
            return;
          }
          this.showAnswer(decision.flush);
        }
        await this.settleProposals();
        this.finish('complete');
        return;
      }
      messages.push(turn.replay(done));
      const observed: Array<{ id: string; observation: string }> = [];
      for (const tc of done.toolCalls) {
        const observation = await this.runToolCall(ref, o.tools, tc.name, {
          parsed: tc.parsed,
          raw: tc.raw,
        });
        observed.push({ id: tc.id, observation });
      }
      messages.push(...turn.results(observed));
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
    // Stop answers at once on every seat (tech review ruling 7): the turn closes now
    // with whatever streamed so far, kept in the chat and in history. A model
    // load cannot be stopped, but the turn can; the run drops out when the
    // load, the shim, or the search it is waiting on comes back.
    this.finish('aborted');
  }

  recordLine(turn: SeedTurn): void {
    // The mark rides along, as a seed's does (I5).
    this.history.push({
      role: turn.role,
      content: turn.text,
      ...(turn.localOnly ? { localOnly: true as const } : {}),
    });
    this.hold.keep(turn.localOnly);
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
