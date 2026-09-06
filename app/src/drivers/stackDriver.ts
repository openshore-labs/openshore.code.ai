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
import type { ApprovalAnswer } from 'os-code/protocol';
import { uxStandardPrompt, humanizerStandardPrompt } from 'os-code/protocol';
import { Llama } from '../lib/llamaPlugin.js';
import { ensureDeviceModel, forgetDeviceModel } from './deviceModel.js';
import { platform, secretGet, storeGetJson } from '../lib/platform.js';
import {
  CODEMAGIC_TOOL_NAME,
  codemagicOpenAiTool,
  codemagicSystemNote,
  codemagicToolSpec,
  finalizeToolCalls,
  mergeToolCallDeltas,
  parseCodemagicArgs,
  runCodemagicTool,
  type CodemagicToolInput,
  type ToolCallAccum,
} from '../lib/codemagicTool.js';
import { nativeFetch } from '../lib/nativeFetch.js';
import { streamingFetch } from '../lib/streamingFetch.js';
import { PROVIDERS, providerInfo, providerSecretKey } from '../lib/providers.js';
import { imageBlockParts, type Attachment } from '../lib/attachments.js';
import { DEFAULT_CLAUDE_MODEL } from '../lib/claudeModels.js';
import { buildVisionContent } from './cloudClaudeDriver.js';
import { frameLabel, videoContextHeader, VIDEO_FRAMES_SYSTEM_NOTE } from '../lib/videoAttach.js';
import {
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
import type { SeedTurn } from '../state/types.js';
import { byomSecretKey } from '../lib/byom.js';
import { buildHarborSystemPrompt, isHarbor } from '../lib/harbor.js';
import { buildHarborMiniSystemPrompt, isHarborMini } from '../lib/harborMini.js';
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
import type { ChatDriver, DriverEventSink } from './types.js';
import { DriverEmitter } from './types.js';
import { RemoteDriver, daemonCreateSession, type DaemonTarget } from './remoteDriver.js';
import type { DriverEvent } from 'os-code/protocol';

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
}

/** Whether the Humanize Writing standard rides into this model's prompt. On by
 *  default; off when the person turned the setting off. On-device pocket models
 *  are skipped to protect their small context (they are not the surface where
 *  real writing happens), the same carve-out the UX standard makes; the desktop
 *  engine carries the standard through its own config, not this path. */
export function humanizerApplies(ref: StackModelRef, humanize?: boolean): boolean {
  return humanize !== false && ref.kind !== 'device';
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

type Msg = { role: 'user' | 'assistant'; content: string };

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

// A routed specialist could not run this turn (no key, load failure, HTTP
// error). Distinct from a generic failure so run() can degrade to the Reasoning
// anchor instead of dead-ending the turn, the way the engine's router does.
class RouteUnavailable extends Error {}

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
  private engineTurnSettle?: () => void;
  private listenersReady: Promise<void>;
  private deviceListeners: PluginListenerHandle[] = [];
  private abortController?: AbortController;

  constructor(
    private readonly stack: AppStack,
    private readonly profile: ProfileId,
    private readonly context: StackContext = {},
    seed?: SeedTurn[],
  ) {
    // A mid-chat switch seeds the prior turns so the stack continues the thread.
    if (seed) this.history = seed.map((t) => ({ role: t.role, content: t.text }));
    this.listenersReady = this.attachDeviceListeners();
  }

  subscribe(sink: DriverEventSink): () => void {
    return this.emitter.subscribe(sink);
  }

  send(text: string, attachments?: Attachment[]): void {
    void this.run(text, attachments);
  }

  private emit = (e: Parameters<DriverEmitter['emit']>[0]) => this.emitter.emit(e);

  // ---- routing ------------------------------------------------------------

  private reachable(ref: StackModelRef): boolean {
    return locationAllowed(this.profile, locationOf(ref));
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

  private systemFor(ref: StackModelRef, placement?: Placement): string {
    const guideSystem =
      ref.kind === 'device' && isHarborMini(ref.modelId)
        ? buildHarborMiniSystemPrompt()
        : ref.kind === 'device' && isHarbor(ref.modelId)
          ? buildHarborSystemPrompt(false)
          : undefined;
    // Harbor's own web-search protocol only exists in the standalone guide
    // chat (OnDeviceDriver); placed in a full stack it answers from what it
    // knows, same as any other Reasoning LLM here (no tool use in v1, see the
    // file header). Its persona still applies so it identifies itself
    // correctly and stays honest about not being a coder.
    const parts = [guideSystem ?? BASE_SYSTEM];
    // Reasoning effort: a specialist's own effort when it was placed with one
    // (the Vision position sets this), otherwise the live composer choice.
    parts.push(effortDirective(placement?.effort));
    // Project context: name + standing instructions, injected into every turn.
    const proj = this.context.projectInstructions?.trim();
    if (this.context.projectName || proj) {
      const head = this.context.projectName
        ? `You are working in the project "${this.context.projectName}".`
        : '';
      parts.push([head, proj].filter(Boolean).join('\n'));
    }
    const crewNote = this.crewGuidance();
    if (crewNote) parts.push(crewNote);
    if (placement?.persona && placement.persona.trim()) {
      parts.push(`Persona for this specialist: ${placement.persona.trim()}`);
    }
    // Premium UX out of the box for whatever writes code in this chat: the
    // coding specialist, and a cloud or BYOM reasoning anchor. On-device
    // pocket models skip it to protect their small context (the engine's
    // agent on the desktop always carries it).
    const buildsCode = placement?.category === 'coding' || (!placement && ref.kind !== 'device');
    if (buildsCode) parts.push(uxStandardPrompt());
    // Humanize Writing out of the box: any written output (not just code) reads
    // plain, specific, and honest, avoiding AI writing tells, unless the person
    // turned the setting off (humanizerStandard.ts, config in Settings).
    if (humanizerApplies(ref, this.context.humanize)) parts.push(humanizerStandardPrompt());
    // Codemagic Access is on: tell the model it can drive App Launch builds. The
    // tool is offered on every network model (Anthropic native tool use, and
    // OpenAI-compatible + BYOM function calling), so the note earns its place on
    // any non-device model. On-device pocket models are too small for reliable
    // tool use and stay guidance only.
    if (this.context.codemagicAccess && ref.kind !== 'device') {
      parts.push(codemagicSystemNote());
    }
    return parts.join('\n\n');
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
    this.history.push({ role: 'user', content: text });
    this.emit({ type: 'task-start', input: text });

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

    // Plan-first flow: for a text-only turn (no build-tool loop), the reasoning
    // LLM frames the request and composes a play. It hands back to the
    // single-turn path below when the anchor is a weak or unreachable model, the
    // plan will not parse, or the play is a single step.
    if (!(attachments ?? []).some((a) => a.isImage) && !this.context.codemagicAccess) {
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
        this.emit({
          type: 'task-done',
          reason: 'error',
          message: `No image-reading model is reachable while ${this.profile}. Put an image-reading model in your Stack, or connect a cloud model that reads images (Claude reads them out of the box).`,
        });
        return;
      }
      target = vision;
    } else {
      target = this.route(text);
      if (!this.reachable(target.ref)) {
        this.emit({
          type: 'task-done',
          reason: 'error',
          message: `Nothing in your stack is reachable while ${this.profile}. Download an on-device model or change your connection.`,
        });
        return;
      }
    }

    this.emit({
      type: 'turn-start',
      turn: this.history.length,
      model: refName(target.ref),
      providerKind: target.ref.kind === 'device' ? 'local' : 'cloud',
    });
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
      // A stop is a calm end, not an error: settle with whatever streamed so
      // far so the partial reply stays in context for the next turn.
      if (this.aborted || (err instanceof Error && err.name === 'AbortError')) {
        this.finish('aborted');
        return;
      }
      // Graceful degradation is the contract: if a placed specialist could not
      // run, fall back to the Reasoning anchor for this turn rather than
      // dead-ending, exactly as the desktop router does. An image turn is the
      // exception: routeVision already chose the best reachable reader (and the
      // reasoning anchor may not read images at all), so it never falls back
      // here, it fails with the clear message above.
      const isSpecialist = !images.length && target.category !== 'reasoning' && !!target.placement;
      const canFallback =
        err instanceof RouteUnavailable &&
        isSpecialist &&
        refName(reasoning) !== refName(target.ref) &&
        this.reachable(reasoning);
      if (canFallback) {
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
        this.answer = '';
        try {
          await this.runRef(reasoning, undefined, []);
        } catch (err2) {
          if (this.aborted || (err2 instanceof Error && err2.name === 'AbortError')) {
            this.finish('aborted');
            return;
          }
          this.emit({
            type: 'task-done',
            reason: 'error',
            message: err2 instanceof Error ? err2.message : String(err2),
          });
        }
        return;
      }
      this.emit({
        type: 'task-done',
        reason: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
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
   *  a connected cloud provider that reads images is the fallback. */
  private async routeVision(): Promise<
    { ref: StackModelRef; placement?: Placement; category: 'vision' } | undefined
  > {
    const pick = pickVisionRef(this.stack, (r) => this.reachable(r));
    if (pick) return { ref: pick.ref, placement: pick.placement, category: 'vision' };
    const fallback = await this.cloudVisionFallback();
    if (fallback) return { ref: fallback, category: 'vision' };
    return undefined;
  }

  /** A connected, reachable cloud model that reads images, when the stack holds
   *  none. Claude first (its whole lineup reads images), then the first other
   *  provider with a stored key and a vision-capable model. */
  private async cloudVisionFallback(): Promise<StackModelRef | undefined> {
    const anthropic: StackModelRef = {
      kind: 'cloud',
      provider: 'anthropic',
      model: DEFAULT_CLAUDE_MODEL,
      label: 'Claude',
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
        label: p.name,
      };
      if (this.reachable(ref) && (await secretGet(providerSecretKey(p.id)))) return ref;
    }
    return undefined;
  }

  // ---- plan-first orchestration -------------------------------------------

  /** Frame the prompt with the reasoning LLM and, when it is clear and needs
   *  more than one model, run the play. Returns true when it handled the turn
   *  (ran the play, or asked the user to clarify); false to fall back to the
   *  single-turn path. The whole flow degrades to single-turn whenever the
   *  reasoning anchor is a weak or unreachable model or the plan cannot be
   *  used, so a modest stack still just answers. */
  private async tryRunPlay(text: string, contextNote?: string): Promise<boolean> {
    const reasoning = this.stack.reasoning ?? harborRef();
    // A local pocket model cannot plan reliably; let the single-turn path (and
    // its own honest device handling) take it.
    if (reasoning.kind === 'device' || !this.reachable(reasoning)) return false;

    this.emit({ type: 'status', message: 'Framing the request.' });
    let planText: string;
    try {
      planText = await this.completeOnce(
        reasoning,
        undefined,
        planPrompt(text, this.stack, contextNote),
      );
    } catch {
      return false;
    }
    if (this.aborted) {
      this.finish('aborted');
      return true;
    }
    const framing = parsePlan(planText);
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

    // A single-step (or empty) play is just a normal answer; let the single-turn
    // path handle it so behavior is unchanged for simple prompts.
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
    const results: StepResult[] = [];
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
        try {
          // A repo/tool step runs on the paired computer's engine when docked
          // (real tools, real approvals). When that is not available it returns
          // null and we fall through to a chat model that describes the change.
          const onEngine = step.needsTools
            ? await this.runToolStepOnEngine(step, play, results)
            : null;
          out =
            onEngine ??
            (await this.completeOnce(ref, placement, this.stepPrompt(step, play, results)));
        } catch (err) {
          out = `(this step could not run: ${err instanceof Error ? err.message : String(err)})`;
        }
        results.push({ id: step.id, title: step.title, text: out });
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
            await this.completeOnce(reasoning, undefined, replanPrompt(play, results)),
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
      await this.completeOnce(reasoning, undefined, this.synthesisPrompt(userText, play, results), {
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

  /** The prompt for one step: the goal, this step's brief, and the prior steps'
   *  results as context so a handoff carries the work forward. */
  private stepPrompt(step: PlayStep, play: Play, results: StepResult[]): string {
    const priorLines = results.length
      ? ['Work done so far by the team:', ...results.map((r) => `- ${r.title}: ${r.text}`), '']
      : [];
    return [
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
  private synthesisPrompt(userText: string, play: Play, results: StepResult[]): string {
    return [
      "Compose the final answer to the user, using the team's work below. Do not mention the internal steps or handoffs; just give the finished result.",
      `User request: ${userText}`,
      `Goal: ${play.summary}`,
      'Team work:',
      ...results.map((r) => `- ${r.title}: ${r.text}`),
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
    results: StepResult[],
  ): Promise<string | null> {
    const target = this.context.daemon;
    const cwd = this.context.repoCwd;
    if (!target || !cwd) return null;
    try {
      if (!this.engineDriver) {
        // acceptEdits, the same mapping routines use: in-jail edits flow, while
        // shell, push, and cloud spend still raise an approval into the chat.
        // projectSecrets are deliberately never sent to the docked session.
        const sessionId = await daemonCreateSession(target, cwd, {
          permissionMode: 'acceptEdits',
          humanize: this.context.humanize,
        });
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
        break;
      case 'task-done':
        if (!this.engineTurnText && event.reason === 'error') {
          this.engineTurnText = event.message ?? '(the step failed on your computer)';
        }
        this.engineTurnSettle?.();
        break;
      case 'tool-start':
      case 'tool-end':
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
    return new Promise<string>((resolve) => {
      this.engineTurnSettle = () => {
        this.engineTurnSettle = undefined;
        resolve(this.engineTurnText.trim());
      };
      driver.send(prompt);
    });
  }

  /** One reusable completion on a cloud or BYOM model, returning its text.
   *  Streams to onDelta when given (the final synthesis). Device models are not
   *  driven here; callers route a device owner to the reasoning anchor. */
  private async completeOnce(
    ref: StackModelRef,
    placement: Placement | undefined,
    prompt: string,
    opts?: { images?: Attachment[]; onDelta?: (delta: string) => void },
  ): Promise<string> {
    const system = this.systemFor(ref, placement);
    if (ref.kind === 'device') {
      throw new RouteUnavailable('A local model cannot run this step.');
    }
    if (ref.kind === 'cloud' && ref.provider === 'anthropic') {
      const key = await secretGet(providerSecretKey('anthropic'));
      if (!key) throw new RouteUnavailable('Connect Claude under Cloud Connections first.');
      const ws = (
        await storeGetJson<{ anthropicWorkspaceId?: string }>('oscode.settings.v1')
      )?.anthropicWorkspaceId?.trim();
      const client = new Anthropic({
        apiKey: key,
        dangerouslyAllowBrowser: true,
        fetch: streamingFetch,
        ...(ws ? { defaultHeaders: { 'anthropic-workspace-id': ws } } : {}),
      });
      const content = opts?.images?.length
        ? buildVisionContent(prompt, opts.images).content
        : prompt;
      const stream = client.messages.stream(
        { model: ref.model, max_tokens: 4096, system, messages: [{ role: 'user', content }] },
        { signal: this.abortController?.signal },
      );
      let out = '';
      stream.on('text', (delta) => {
        if (this.aborted) return;
        out += delta;
        opts?.onDelta?.(delta);
      });
      await stream.finalMessage();
      return out;
    }
    // OpenAI-compatible: a built-in cloud provider or a BYOM endpoint.
    const base = ref.kind === 'byom' ? ref.baseUrl : providerInfo(ref.provider)?.openaiBaseUrl;
    if (!base) throw new RouteUnavailable(`No endpoint configured for ${refName(ref)}.`);
    const key =
      ref.kind === 'byom'
        ? ((await secretGet(byomSecretKey(ref.id))) ?? undefined)
        : ((await secretGet(providerSecretKey(ref.provider))) ?? undefined);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (key) headers.authorization = `Bearer ${key}`;
    const userContent = opts?.images?.length ? openAiVisionContent(prompt, opts.images) : prompt;
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ];
    if (platform() === 'ios' || platform() === 'electron') {
      const res = await nativeFetch(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: ref.model, stream: false, messages }),
      });
      if (!res.ok) throw new RouteUnavailable(`${refName(ref)} answered ${res.status}.`);
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const out = data?.choices?.[0]?.message?.content ?? '';
      if (out) opts?.onDelta?.(out);
      return out;
    }
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: ref.model, stream: true, messages }),
      signal: this.abortController?.signal,
    });
    if (!res.ok || !res.body) throw new RouteUnavailable(`${refName(ref)} answered ${res.status}.`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let out = '';
    let buffer = '';
    for (;;) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone || this.aborted) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) {
            out += delta;
            opts?.onDelta?.(delta);
          }
        } catch {
          // skip a keepalive or partial line
        }
      }
    }
    return out;
  }

  private finish(reason: 'complete' | 'aborted' | 'error', message?: string): void {
    const text = this.answer.trim();
    if (text) this.history.push({ role: 'assistant', content: text });
    this.emit({ type: 'text-final', text });
    this.emit({ type: 'task-done', reason, message });
  }

  // ---- on-device backend --------------------------------------------------

  private async attachDeviceListeners(): Promise<void> {
    this.deviceListeners.push(
      await Llama.addListener('token', ({ requestId, delta }) => {
        if (requestId !== this.activeRequestId) return;
        this.answer += delta;
        this.emit({ type: 'text-delta', text: delta });
      }),
    );
    this.deviceListeners.push(
      await Llama.addListener('generationDone', ({ requestId, stopReason, detail }) => {
        if (requestId !== this.activeRequestId) return;
        this.activeRequestId = undefined;
        if (stopReason === 'error') {
          // Whatever the slot holds after an error is suspect; reload next time.
          forgetDeviceModel();
          this.finish('error', detail ?? 'The on-device model hit a problem.');
        } else this.finish(stopReason === 'stopped' ? 'aborted' : 'complete');
      }),
    );
  }

  private async runDevice(
    ref: Extract<StackModelRef, { kind: 'device' }>,
    placement?: Placement,
  ): Promise<void> {
    await this.listenersReady;
    // The phone's one model slot is shared with every device chat (APP-3):
    // confirm the slot holds this model before every reply, never assume it.
    const ready = await ensureDeviceModel(
      {
        id: ref.modelId,
        name: ref.modelName,
        contextSize: isHarborMini(ref.modelId) ? 2048 : 4096,
      },
      (message) => this.emit({ type: 'status', message }),
    );
    if (!ready.ok) throw new RouteUnavailable(ready.detail);
    this.activeRequestId = `req_${Date.now().toString(36)}_${(stackRequestSeq++).toString(36)}`;
    await Llama.generate({
      requestId: this.activeRequestId,
      system: this.systemFor(ref, placement),
      messages: this.history,
      maxTokens: isHarborMini(ref.modelId) ? 512 : 1024,
      temperature: 0.6,
    });
  }

  // ---- cloud backends -----------------------------------------------------

  private async runCloud(
    ref: Extract<StackModelRef, { kind: 'cloud' }>,
    placement?: Placement,
    images: Attachment[] = [],
  ): Promise<void> {
    const key = await secretGet(providerSecretKey(ref.provider));
    if (!key) {
      throw new RouteUnavailable(`Connect ${ref.provider} under Cloud Connections first.`);
    }
    const system = this.systemFor(ref, placement);
    if (ref.provider === 'anthropic') {
      // An image turn takes the plain vision path (it needs no build tools);
      // otherwise Codemagic Access on runs the tool-use loop so the model can
      // drive builds, and off keeps the original single-turn path.
      if (images.length) await this.runAnthropic(key, ref.model, system, images);
      else if (this.context.codemagicAccess)
        await this.runAnthropicWithTools(key, ref.model, system);
      else await this.runAnthropic(key, ref.model, system, []);
    } else {
      const base = providerInfo(ref.provider)?.openaiBaseUrl;
      if (!base) {
        throw new RouteUnavailable(`No endpoint configured for ${ref.provider}.`);
      }
      if (images.length) {
        await this.runOpenAiCompatible(ref.provider, base, key, ref.model, system, images);
      } else if (this.context.codemagicAccess) {
        await this.runOpenAiCompatibleWithTools(ref.provider, base, key, ref.model, system);
      } else {
        await this.runOpenAiCompatible(ref.provider, base, key, ref.model, system, []);
      }
    }
  }

  private async runByom(
    ref: Extract<StackModelRef, { kind: 'byom' }>,
    placement?: Placement,
    images: Attachment[] = [],
  ): Promise<void> {
    // A BYOM key is optional: a local or trusted-network server may accept
    // unauthenticated requests, so an absent key is not an error here.
    const key = (await secretGet(byomSecretKey(ref.id))) ?? undefined;
    const system = this.systemFor(ref, placement);
    // An image turn takes the plain vision path; otherwise Codemagic Access on
    // runs the tool-use loop, off keeps the original single-turn path.
    if (images.length) {
      await this.runOpenAiCompatible(ref.label, ref.baseUrl, key, ref.model, system, images);
    } else if (this.context.codemagicAccess) {
      await this.runOpenAiCompatibleWithTools(ref.label, ref.baseUrl, key, ref.model, system);
    } else {
      await this.runOpenAiCompatible(ref.label, ref.baseUrl, key, ref.model, system, []);
    }
  }

  private async runAnthropic(
    key: string,
    model: string,
    system: string,
    images: Attachment[] = [],
  ): Promise<void> {
    const ws = (
      await storeGetJson<{ anthropicWorkspaceId?: string }>('oscode.settings.v1')
    )?.anthropicWorkspaceId?.trim();
    const client = new Anthropic({
      apiKey: key,
      dangerouslyAllowBrowser: true,
      fetch: streamingFetch,
      ...(ws ? { defaultHeaders: { 'anthropic-workspace-id': ws } } : {}),
    });
    const messages: Anthropic.MessageParam[] = this.history.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    let sys = system;
    if (images.length && messages.length) {
      // Fold the images into the current (last) user turn as image blocks, with
      // frame labels and a context header when they came from a video. History
      // stays text-only; only this turn carries the pixels.
      const last = messages[messages.length - 1]!;
      const built = buildVisionContent(String(last.content ?? ''), images);
      last.content = built.content;
      if (hasVideoFrames(images)) sys = `${system}\n${VIDEO_FRAMES_SYSTEM_NOTE}`;
    }
    const stream = client.messages.stream(
      { model, max_tokens: 2048, system: sys, messages },
      { signal: this.abortController?.signal },
    );
    stream.on('text', (delta) => {
      if (this.aborted) return;
      this.answer += delta;
      this.emit({ type: 'text-delta', text: delta });
    });
    try {
      await stream.finalMessage();
    } catch (err) {
      if (this.aborted) {
        this.finish('aborted');
        return;
      }
      throw err;
    }
    this.finish(this.aborted ? 'aborted' : 'complete');
  }

  // The Codemagic tool-use loop (Anthropic). Same streaming as runAnthropic, but
  // the model is offered the codemagic tool and each tool_use is executed
  // on-device (token in the Keychain, never sent to the model), the observation
  // fed back, and the loop continues until the model answers with no tool call.
  // Bounded so a build loop cannot run away. Used only when Codemagic Access is
  // on; otherwise runAnthropic keeps the original single-turn path.
  private async runAnthropicWithTools(key: string, model: string, system: string): Promise<void> {
    const ws = (
      await storeGetJson<{ anthropicWorkspaceId?: string }>('oscode.settings.v1')
    )?.anthropicWorkspaceId?.trim();
    const client = new Anthropic({
      apiKey: key,
      dangerouslyAllowBrowser: true,
      fetch: streamingFetch,
      ...(ws ? { defaultHeaders: { 'anthropic-workspace-id': ws } } : {}),
    });
    const messages: Anthropic.MessageParam[] = this.history.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const MAX_ROUNDS = 16;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (this.aborted) {
        this.finish('aborted');
        return;
      }
      const stream = client.messages.stream(
        {
          model,
          max_tokens: 2048,
          system,
          messages,
          tools: [codemagicToolSpec as unknown as Anthropic.Tool],
        },
        { signal: this.abortController?.signal },
      );
      // A newline between rounds so a second round's prose does not butt against
      // the first, once a tool result has come back.
      let started = false;
      stream.on('text', (delta) => {
        if (this.aborted) return;
        if (!started && round > 0 && this.answer && !this.answer.endsWith('\n')) {
          this.answer += '\n\n';
          this.emit({ type: 'text-delta', text: '\n\n' });
        }
        started = true;
        this.answer += delta;
        this.emit({ type: 'text-delta', text: delta });
      });
      let final: Anthropic.Message;
      try {
        final = await stream.finalMessage();
      } catch (err) {
        if (this.aborted) {
          this.finish('aborted');
          return;
        }
        throw err;
      }
      const toolUses = final.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      if (!toolUses.length) {
        this.finish(this.aborted ? 'aborted' : 'complete');
        return;
      }
      // Record the assistant turn (its tool_use blocks), run each tool on-device,
      // and hand the observations back as tool_result on the next user turn.
      messages.push({ role: 'assistant', content: final.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const observation = await this.runCodemagicToolCall(
          tu.name,
          tu.input as CodemagicToolInput,
        );
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: observation });
      }
      messages.push({ role: 'user', content: results });
    }
    // Ran the round budget without a final answer: settle with what we have so
    // the chat does not hang, and let the person pick up from here.
    this.emit({
      type: 'status',
      message: 'Paused the build loop after several rounds. Send a message to continue.',
    });
    this.finish(this.aborted ? 'aborted' : 'complete');
  }

  // The shared OpenAI-compatible path, driven by an explicit base URL and an
  // optional key, so it serves both the built-in cloud providers and a
  // bring-your-own-model endpoint. `label` names the source in error copy.
  private async runOpenAiCompatible(
    label: string,
    base: string,
    key: string | undefined,
    model: string,
    system: string,
    images: Attachment[] = [],
  ): Promise<void> {
    const sys =
      images.length && hasVideoFrames(images) ? `${system}\n${VIDEO_FRAMES_SYSTEM_NOTE}` : system;
    const messages: Array<{ role: string; content: unknown }> = [
      { role: 'system', content: sys },
      ...this.history.map((m) => ({ role: m.role, content: m.content as unknown })),
    ];
    if (images.length && messages.length > 1) {
      // Fold the images into the current (last) user turn as image_url parts,
      // with frame labels and a context header when they came from a video.
      const last = messages[messages.length - 1]!;
      last.content = openAiVisionContent(String(last.content ?? ''), images);
    }
    const authHeaders: Record<string, string> = { 'content-type': 'application/json' };
    if (key) authHeaders.authorization = `Bearer ${key}`;

    // On a device or the desktop shell, these providers send no CORS headers, so
    // the request goes through the native shim, which cannot stream. Ask for a
    // whole answer and emit it once. On the web (dev) we keep true streaming.
    if (platform() === 'ios' || platform() === 'electron') {
      const res = await nativeFetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ model, stream: false, messages }),
      });
      if (!res.ok) {
        throw new RouteUnavailable(`${label} answered ${res.status}.`);
      }
      if (!this.aborted) {
        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content === 'string' && content) {
          this.answer += content;
          this.emit({ type: 'text-delta', text: content });
        }
      }
      this.finish(this.aborted ? 'aborted' : 'complete');
      return;
    }

    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ model, stream: true, messages }),
      signal: this.abortController?.signal,
    });
    if (!res.ok || !res.body) {
      throw new RouteUnavailable(`${label} answered ${res.status}.`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done || this.aborted) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) {
            this.answer += delta;
            this.emit({ type: 'text-delta', text: delta });
          }
        } catch {
          // skip a partial or non-JSON keepalive line
        }
      }
    }
    this.finish(this.aborted ? 'aborted' : 'complete');
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

  // The Codemagic tool-use loop for every OpenAI-compatible backend: the built-in
  // cloud providers AND a bring-your-own-model endpoint, which both speak
  // function calling. Same request shape as runOpenAiCompatible (native shim on
  // device/desktop, true SSE on the web), plus the codemagic tool; each tool call
  // runs on-device (token in the Keychain, never sent to the model) and the
  // observation is fed back until the model answers with no tool call. Bounded so
  // a build loop cannot run away. Used only when Codemagic Access is on.
  private async runOpenAiCompatibleWithTools(
    label: string,
    base: string,
    key: string | undefined,
    model: string,
    system: string,
  ): Promise<void> {
    const authHeaders: Record<string, string> = { 'content-type': 'application/json' };
    if (key) authHeaders.authorization = `Bearer ${key}`;
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: system },
      ...this.history.map((m) => ({ role: m.role, content: m.content })),
    ];
    const nativeShim = platform() === 'ios' || platform() === 'electron';
    const MAX_ROUNDS = 16;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (this.aborted) {
        this.finish('aborted');
        return;
      }
      const { toolCalls, assistantMessage } = await this.oneOpenAiToolRound(
        label,
        base,
        authHeaders,
        model,
        messages,
        nativeShim,
        round,
      );
      if (this.aborted) {
        this.finish('aborted');
        return;
      }
      if (!toolCalls.length) {
        this.finish('complete');
        return;
      }
      messages.push(assistantMessage);
      for (const tc of toolCalls) {
        const input = parseCodemagicArgs(tc.args);
        const observation = input
          ? await this.runCodemagicToolCall(tc.name, input)
          : 'Those tool arguments could not be parsed. Call the codemagic tool with JSON like {"action":"trigger"} or {"action":"status","buildId":"..."}.';
        messages.push({ role: 'tool', tool_call_id: tc.id, content: observation });
      }
    }
    this.emit({
      type: 'status',
      message: 'Paused the build loop after several rounds. Send a message to continue.',
    });
    this.finish(this.aborted ? 'aborted' : 'complete');
  }

  // One request/response round of the OpenAI tool loop. Emits any assistant text
  // as it arrives and returns the tool calls plus the assistant message to append
  // to the running transcript. A newline separates a later round's prose from the
  // previous one so tool rounds do not butt together.
  private async oneOpenAiToolRound(
    label: string,
    base: string,
    authHeaders: Record<string, string>,
    model: string,
    messages: Array<Record<string, unknown>>,
    nativeShim: boolean,
    round: number,
  ): Promise<{ toolCalls: ToolCallAccum[]; assistantMessage: Record<string, unknown> }> {
    let started = false;
    const pushText = (delta: string) => {
      if (this.aborted || !delta) return;
      if (!started && round > 0 && this.answer && !this.answer.endsWith('\n')) {
        this.answer += '\n\n';
        this.emit({ type: 'text-delta', text: '\n\n' });
      }
      started = true;
      this.answer += delta;
      this.emit({ type: 'text-delta', text: delta });
    };
    const body = JSON.stringify({
      model,
      stream: !nativeShim,
      messages,
      tools: [codemagicOpenAiTool],
    });

    if (nativeShim) {
      const res = await nativeFetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: authHeaders,
        body,
      });
      if (!res.ok) throw new RouteUnavailable(`${label} answered ${res.status}.`);
      const data = (await res.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
            tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
          };
        }>;
      };
      const msg = data.choices?.[0]?.message;
      if (typeof msg?.content === 'string') pushText(msg.content);
      const raw = msg?.tool_calls ?? [];
      const toolCalls: ToolCallAccum[] = raw.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        args: tc.function.arguments,
      }));
      const assistantMessage: Record<string, unknown> = raw.length
        ? { role: 'assistant', content: msg?.content ?? '', tool_calls: raw }
        : { role: 'assistant', content: msg?.content ?? '' };
      return { toolCalls, assistantMessage };
    }

    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: authHeaders,
      body,
      signal: this.abortController?.signal,
    });
    if (!res.ok || !res.body) throw new RouteUnavailable(`${label} answered ${res.status}.`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const acc = new Map<number, ToolCallAccum>();
    let text = '';
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done || this.aborted) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const choice = (JSON.parse(payload) as { choices?: Array<Record<string, any>> })
            ?.choices?.[0];
          const dtext = choice?.delta?.content;
          if (typeof dtext === 'string' && dtext) {
            text += dtext;
            pushText(dtext);
          }
          mergeToolCallDeltas(acc, choice?.delta?.tool_calls);
        } catch {
          // skip a partial or non-JSON keepalive line
        }
      }
    }
    const toolCalls = finalizeToolCalls(acc);
    const assistantMessage: Record<string, unknown> = toolCalls.length
      ? {
          role: 'assistant',
          content: text || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.args },
          })),
        }
      : { role: 'assistant', content: text };
    return { toolCalls, assistantMessage };
  }

  // ---- lifecycle ----------------------------------------------------------

  abort(): void {
    this.aborted = true;
    this.abortController?.abort();
    if (this.activeRequestId) void Llama.stop({ requestId: this.activeRequestId });
    // Stop any engine turn a tool step has running on the paired computer, and
    // settle the awaited turn so the play does not hang on a stopped run.
    this.engineDriver?.abort();
    this.engineTurnSettle?.();
  }

  answerApproval(id: string, answer: ApprovalAnswer): void {
    // A tool step's approval is the engine's; pass the person's answer through
    // to the engine session running it. Nothing else in this driver asks.
    this.engineDriver?.answerApproval(id, answer);
  }

  dispose(): void {
    this.abort();
    this.engineUnsub?.();
    this.engineDriver?.dispose();
    this.engineDriver = undefined;
    for (const h of this.deviceListeners) void h.remove();
    this.deviceListeners = [];
    this.emitter.clear();
  }
}
