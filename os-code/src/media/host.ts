// The media host (the model library, 2026-10-12): the one object behind the
// media tools. It reads which model fills each media job (config
// stack.media), reaches that job's program (ComfyUI, the speech server, or
// audio-separator and deepFilter run as programs), screens every prompt and
// labels every picture through the ethics layer (MediaGuard, handed out only
// by the provider registry), and saves what comes back under OpenShore's own
// media folder. The tools (core/tools/media.ts) resolve the person's files
// through the workspace jail before anything reaches here.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { MediaPlacement, OscConfig } from '../config/schema.js';
import type { MediaGuard, MediaScreen } from '../core/ethics/guardedMedia.js';
import { isLocalUrl } from '../core/security/egress.js';
import { ComfyClient, ComfyError, type ComfyFile } from './comfyui.js';
import { buildGraph, graphFor, graphNodes, versionAtLeast, type GraphInput } from './graphs.js';
import {
  MEDIA_JOBS,
  callJob,
  cloneAllowed,
  MEDIA_JOB_INFO,
  type MediaJob,
  type MediaRuntime,
  type MediaToolName,
} from './jobs.js';
import { MediaPrograms } from './programs.js';
import { SpeechClient, formatSpeakerLines, type TranscriptFormat } from './speech.js';

/** Each runtime's address or program when the person placed a job in it but
 *  set no address: the program's own default. */
const DEFAULTS = {
  comfyui: 'http://127.0.0.1:8188',
  speech: 'http://127.0.0.1:8080',
  separator: 'audio-separator',
  denoiser: 'deepFilter',
} as const;

export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaError';
  }
}

export interface MediaHostDeps {
  config: OscConfig;
  guard: MediaGuard;
  /** Where outputs are saved (OpenShore's own media folder). */
  outRoot: string;
  fetchImpl?: typeof fetch;
  programs?: MediaPrograms;
  /** The speech server's key, read by the caller from its variable. */
  speechKey?: string;
  comfySleep?: (ms: number) => Promise<void>;
}

export class MediaHost {
  private comfyClient?: ComfyClient;
  private speechClient?: SpeechClient;
  private readonly programs: MediaPrograms;
  private readonly checked = new Map<string, Promise<string | undefined>>();

  constructor(private readonly deps: MediaHostDeps) {
    const media = deps.config.media;
    this.programs =
      deps.programs ??
      new MediaPrograms({
        separatorCommand: media.separator?.command ?? DEFAULTS.separator,
        ...(media.separator?.modelDir ? { separatorModelDir: media.separator.modelDir } : {}),
        denoiserCommand: media.denoiser?.command ?? DEFAULTS.denoiser,
        outRoot: deps.outRoot,
      });
  }

  /** The placement for a job, when one is placed. */
  placement(job: MediaJob): MediaPlacement | undefined {
    return this.deps.config.stack.media[job];
  }

  /** The jobs placed in this Stack, in the Stack's order. */
  jobs(): MediaJob[] {
    return MEDIA_JOBS.filter((job) => this.placement(job));
  }

  /** The tools those jobs need. */
  tools(): MediaToolName[] {
    return [...new Set(this.jobs().map((job) => MEDIA_JOB_INFO[job].tool))];
  }

  /** Where a runtime is reached: its address, or its program's name. */
  where(runtime: MediaRuntime): string {
    const media = this.deps.config.media;
    if (runtime === 'comfyui') return media.comfyui?.baseUrl ?? DEFAULTS.comfyui;
    if (runtime === 'speech') return media.speech?.baseUrl ?? DEFAULTS.speech;
    if (runtime === 'separator') return media.separator?.command ?? DEFAULTS.separator;
    return media.denoiser?.command ?? DEFAULTS.denoiser;
  }

  /** Whether a runtime's address is off this computer's network, judged by
   *  address. A program on this computer never leaves. */
  leaves(runtime: MediaRuntime): boolean {
    if (runtime === 'separator' || runtime === 'denoiser') return false;
    return !isLocalUrl(this.where(runtime));
  }

  /** Where a media tool call goes, judged before it runs (security review,
   *  2026-10-12): its job, the runtime and address that job is placed on,
   *  and whether that address is off this network. Undefined when the job
   *  is not placed (the tool then says so and sends nothing). */
  target(
    tool: MediaToolName,
    args: Record<string, unknown>,
  ): { job: MediaJob; placement: MediaPlacement; where: string; leaves: boolean } | undefined {
    const job = callJob(tool, args);
    const placement = job ? this.placement(job) : undefined;
    if (!job || !placement) return undefined;
    return {
      job,
      placement,
      where: this.where(placement.runtime),
      leaves: this.leaves(placement.runtime),
    };
  }

  /** Whether any placed job's runtime leaves this network. */
  anyLeaves(tool?: MediaToolName): boolean {
    return this.jobs()
      .filter((job) => !tool || MEDIA_JOB_INFO[job].tool === tool)
      .some((job) => this.leaves(this.placement(job)!.runtime));
  }

  /** A server's address, refused when it is plain http to a machine off
   *  this network (security review, 2026-10-12): the person's photos and
   *  recordings, and the speech server's key, would cross the internet
   *  unencrypted. On this network, the tailnet included, http is fine. */
  private address(runtime: 'comfyui' | 'speech'): string {
    const url = this.where(runtime);
    if (/^http:/i.test(url) && !isLocalUrl(url)) {
      const name = runtime === 'comfyui' ? 'ComfyUI' : 'The speech server';
      throw new MediaError(
        `${name} is set to ${url}, off this network over plain http, so nothing was sent. Give it an https address, or reach it over your tailnet.`,
      );
    }
    return url;
  }

  private comfy(): ComfyClient {
    this.comfyClient ??= new ComfyClient({
      baseUrl: this.address('comfyui'),
      ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
      ...(this.deps.comfySleep ? { sleep: this.deps.comfySleep } : {}),
    });
    return this.comfyClient;
  }

  private speech(): SpeechClient {
    this.speechClient ??= new SpeechClient({
      baseUrl: this.address('speech'),
      ...(this.deps.speechKey ? { apiKey: this.deps.speechKey } : {}),
      ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
    });
    return this.speechClient;
  }

  private need(job: MediaJob, runtime?: MediaRuntime): MediaPlacement {
    const placed = this.placement(job);
    if (!placed) {
      throw new MediaError(
        `Nothing in your Stack does ${MEDIA_JOB_INFO[job].plain.toLowerCase()} yet. Get one from the Marketplace and place it.`,
      );
    }
    if (runtime && placed.runtime !== runtime) {
      throw new MediaError(
        `The model placed for ${MEDIA_JOB_INFO[job].plain} does not run in ${runtime}.`,
      );
    }
    return placed;
  }

  private save(job: MediaJob, name: string, bytes: Uint8Array): string {
    const dir = join(this.deps.outRoot, job);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${Date.now()}-${basename(name)}`);
    writeFileSync(file, bytes);
    return file;
  }

  /** The reason a ComfyUI job cannot run here, or undefined when it can:
   *  ComfyUI too old for the workflow, or a node it does not have. Checked
   *  once per workflow for the host's life. */
  private preflight(
    key: string,
    spec: NonNullable<ReturnType<typeof graphFor>>,
  ): Promise<string | undefined> {
    let check = this.checked.get(key);
    if (!check) {
      check = (async () => {
        const comfy = this.comfy();
        const health = await comfy.health();
        if (!health.ok) return health.detail;
        if (health.version && !versionAtLeast(health.version, spec.minComfyVersion)) {
          return `This needs ComfyUI ${spec.minComfyVersion} or later; this one is ${health.version}. Update ComfyUI.`;
        }
        const missing = await comfy.missingNodes(graphNodes(spec));
        if (!missing.length) return undefined;
        const pack = spec.nodePack
          ? ` Install the ${spec.nodePack} node pack in ComfyUI.`
          : ' Update ComfyUI.';
        return `Your ComfyUI is missing ${missing.join(', ')}.${pack}`;
      })();
      this.checked.set(key, check);
      // A failed check is asked again next time (ComfyUI may have started).
      void check.then((reason) => {
        if (reason) this.checked.delete(key);
      });
    }
    return check;
  }

  /** Run a ComfyUI job: upload its pictures, fill its workflow, run it, and
   *  save what it made. */
  private async comfyJob(
    job: MediaJob,
    input: GraphInput & { imagePath?: string; maskPath?: string },
    signal?: AbortSignal,
  ): Promise<Array<{ file: ComfyFile; bytes: Uint8Array; mediaType: string }>> {
    const placed = this.need(job, 'comfyui');
    const family = placed.graph;
    const spec = family ? graphFor(family, job) : undefined;
    if (!family || !spec) {
      throw new MediaError(
        `OpenShore has no ComfyUI workflow for ${family ?? 'this model'} to ${MEDIA_JOB_INFO[job].plain.toLowerCase()}.`,
      );
    }
    const why = await this.preflight(`${family}:${job}`, spec);
    if (why) throw new MediaError(why);
    const comfy = this.comfy();
    const filled: GraphInput = { ...input };
    if (input.imagePath)
      filled.image = await comfy.upload(readFileSync(input.imagePath), basename(input.imagePath));
    if (input.maskPath)
      filled.mask = await comfy.upload(readFileSync(input.maskPath), basename(input.maskPath));
    const graph = buildGraph(spec, filled, placed.files ?? {});
    const outputs = await comfy.run(graph, signal);
    const out = [];
    for (const file of outputs) out.push({ file, ...(await comfy.fetchFile(file)) });
    return out;
  }

  // -------------------------------------------------------------------------
  // Pictures
  // -------------------------------------------------------------------------

  /** Make a picture from a description (Image creation). */
  async createImage(prompt: string, signal?: AbortSignal): Promise<string[]> {
    const screen = await this.deps.guard.screen(prompt);
    const made = await this.comfyJob('create', { prompt }, signal);
    return made.map((m) => this.saveImage('create', m, screen));
  }

  /** Find what is named in a picture and save its mask (white is selected). */
  async select(imagePath: string, what: string, signal?: AbortSignal): Promise<string> {
    await this.deps.guard.screen(what);
    // SAM 3 keeps only the best match for a bare word; ":10" asks for every
    // match, up to ten (ComfyUI's SAM3_Detect).
    const prompt = /:\d+$/.test(what.trim()) ? what.trim() : `${what.trim()}:10`;
    const made = await this.comfyJob('select', { imagePath, prompt }, signal);
    const first = made[0]!;
    return this.save('select', first.file.filename, first.bytes);
  }

  /** Take something out of a picture: by a mask, or by naming it, which needs
   *  Find and select placed too. */
  async remove(
    imagePath: string,
    target: { maskPath?: string; what?: string },
    signal?: AbortSignal,
  ): Promise<{ files: string[]; mask?: string }> {
    let maskPath = target.maskPath;
    let mask: string | undefined;
    if (!maskPath) {
      if (!target.what) throw new MediaError('Say what to remove, or give a mask picture of it.');
      if (!this.placement('select')) {
        throw new MediaError(
          'Removing something by name needs Find and select in your Stack too. Get it from the Marketplace, or give a mask picture.',
        );
      }
      mask = await this.select(imagePath, target.what, signal);
      maskPath = mask;
    }
    const screen = await this.deps.guard.screen(
      `remove ${target.what ?? 'the masked area'} from the picture`,
    );
    const made = await this.comfyJob('remove', { imagePath, maskPath }, signal);
    return {
      files: made.map((m) => this.saveImage('remove', m, screen)),
      ...(mask ? { mask } : {}),
    };
  }

  /** Cut the subject out onto a clear background. */
  async removeBackground(imagePath: string, signal?: AbortSignal): Promise<string[]> {
    const screen = await this.deps.guard.screen('remove the background from the picture');
    const made = await this.comfyJob('background', { imagePath }, signal);
    return made.map((m) => this.saveImage('background', m, screen));
  }

  async upscale(imagePath: string, signal?: AbortSignal): Promise<string[]> {
    const screen = await this.deps.guard.screen('upscale and restore the picture');
    const made = await this.comfyJob('upscale', { imagePath }, signal);
    return made.map((m) => this.saveImage('upscale', m, screen));
  }

  /** Change a picture the way an instruction says. */
  async instruct(imagePath: string, instruction: string, signal?: AbortSignal): Promise<string[]> {
    const screen = await this.deps.guard.screen(instruction);
    const made = await this.comfyJob('instruct', { imagePath, prompt: instruction }, signal);
    return made.map((m) => this.saveImage('instruct', m, screen));
  }

  private saveImage(
    job: MediaJob,
    made: { file: ComfyFile; bytes: Uint8Array; mediaType: string },
    screen: MediaScreen,
  ): string {
    const model = this.placement(job)?.catalogId ?? this.placement(job)?.graph ?? 'ComfyUI';
    const bytes = this.deps.guard.labelImage(made.bytes, screen, {
      model,
      mediaType: made.mediaType,
    });
    return this.save(job, made.file.filename, bytes);
  }

  // -------------------------------------------------------------------------
  // Video, music and sound
  // -------------------------------------------------------------------------

  async video(
    input: { prompt: string; imagePath?: string; seconds?: number },
    signal?: AbortSignal,
  ): Promise<string[]> {
    const job: MediaJob = input.imagePath ? 'image-to-video' : 'text-to-video';
    const screen = await this.deps.guard.screen(input.prompt);
    this.deps.guard.checkUnlabeled(screen, 'video');
    const made = await this.comfyJob(
      job,
      { prompt: input.prompt, ...(input.imagePath ? { imagePath: input.imagePath } : {}) },
      signal,
    );
    return made.map((m) => this.save(job, m.file.filename, m.bytes));
  }

  async sound(
    kind: 'music' | 'effects',
    input: { prompt: string; lyrics?: string; seconds?: number },
    signal?: AbortSignal,
  ): Promise<string[]> {
    const screen = await this.deps.guard.screen(
      [input.prompt, input.lyrics].filter(Boolean).join('\n'),
    );
    this.deps.guard.checkUnlabeled(screen, 'audio');
    const made = await this.comfyJob(
      kind,
      {
        prompt: input.prompt,
        tags: input.prompt,
        lyrics: input.lyrics ?? '',
        ...(input.seconds ? { seconds: input.seconds } : {}),
      },
      signal,
    );
    return made.map((m) => this.save(kind, m.file.filename, m.bytes));
  }

  // -------------------------------------------------------------------------
  // Speech
  // -------------------------------------------------------------------------

  async transcribe(
    audioPath: string,
    opts: { speakers?: boolean; language?: string; format?: TranscriptFormat },
    signal?: AbortSignal,
  ): Promise<string> {
    const audio = readFileSync(audioPath);
    const filename = basename(audioPath);
    if (opts.speakers) {
      const placed = this.need('speakers', 'speech');
      const lines = await this.speech().diarize({
        audio,
        filename,
        model: placed.model ?? '',
        ...(signal ? { signal } : {}),
      });
      return formatSpeakerLines(lines);
    }
    const placed = this.need('transcribe', 'speech');
    return this.speech().transcribe({
      audio,
      filename,
      model: placed.model ?? '',
      ...(opts.language ? { language: opts.language } : {}),
      ...(opts.format ? { format: opts.format } : {}),
      ...(signal ? { signal } : {}),
    });
  }

  /** Read text aloud, in a natural voice or (`own`) the voice set up for
   *  the clone job. A copy of a voice runs only on a model whose own
   *  watermark marks every output, by the rule in code (cloneAllowed). */
  async speak(text: string, own: boolean, signal?: AbortSignal): Promise<string> {
    const job: MediaJob = own ? 'clone' : 'speak';
    const placed = this.need(job, 'speech');
    if (own && !cloneAllowed(placed)) {
      throw new MediaError(
        'Your own voice runs only on a model that watermarks everything it says. The one placed does not, so nothing was made.',
      );
    }
    const screen = await this.deps.guard.screen(text);
    this.deps.guard.checkUnlabeled(screen, 'audio');
    const { audio, mediaType } = await this.speech().speak({
      text,
      model: placed.model ?? '',
      ...(placed.voice ? { voice: placed.voice } : {}),
      format: 'mp3',
      ...(signal ? { signal } : {}),
    });
    return this.save(job, mediaType.includes('wav') ? 'speech.wav' : 'speech.mp3', audio);
  }

  // -------------------------------------------------------------------------
  // Stems and clean-up (programs on this computer)
  // -------------------------------------------------------------------------

  async stems(audioPath: string, vocalsOnly: boolean, signal?: AbortSignal): Promise<string[]> {
    const placed = this.need('stems', 'separator');
    if (!placed.model) throw new MediaError('The stem separator placed names no model file.');
    const result = await this.programs.separate({
      file: audioPath,
      model: placed.model,
      vocalsOnly,
      ...(signal ? { signal } : {}),
    });
    return result.files;
  }

  async cleanup(audioPath: string, signal?: AbortSignal): Promise<string[]> {
    const placed = this.need('cleanup', 'denoiser');
    const result = await this.programs.denoise({
      file: audioPath,
      ...(placed.model ? { model: placed.model } : {}),
      ...(signal ? { signal } : {}),
    });
    return result.files;
  }
}

/** Plain words for a media failure, for the tool's observation. */
export function mediaFailure(err: unknown): string {
  if (err instanceof MediaError || err instanceof ComfyError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

/** The extension a saved output has, for the tool's line ("a .mp4 clip"). */
export function kindOf(file: string): string {
  return extname(file).slice(1).toLowerCase();
}
