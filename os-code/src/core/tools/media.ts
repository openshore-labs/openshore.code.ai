// The media tools (the model library, 2026-10-12): the Stack's media jobs
// reached the way generateImage reaches the image maker. Each tool is
// registered only when a job it serves is placed (MediaHost.tools), and it
// hands the work to the media host, which screens every prompt and labels
// every picture through the ethics layer.
//
// A file the person names is read through the workspace jail, or from
// OpenShore's own media folder (what an earlier media tool made), never from
// anywhere else. Outputs are saved in that media folder, not the workspace,
// so a media tool writes nothing the person did not see. A media server off
// this network gets the file the agent named, so the tool's risk is 'network'
// then; on this computer it is 'read'. The loop judges each call by the
// server its job is placed on (MediaHost.target, security review 2026-10-12):
// one off this network asks first on the amber card, once per task per model;
// it never gets a vault file kept on this computer, nor anything once the
// chat holds a local-only note's text from a seat that stays; and a result
// read from such a file on this computer is marked local-only.
import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import type { ToolContext, ToolDef } from './index.js';
import type { MediaToolName } from '../../media/jobs.js';
import { mediaFailure } from '../../media/host.js';
import { EthicsBlocked } from '../ethics/guardedProvider.js';
import { JailViolation } from '../security/jail.js';

/** Where the media tools save what they make: OpenShore's own folder. */
export function mediaOutRoot(home: string): string {
  return resolve(home, 'media');
}

/** True when a path is a file in OpenShore's own media or images folder
 *  (what a media tool or the image maker made). */
export function inOwnMedia(path: string, home: string): boolean {
  if (!isAbsolute(path)) return false;
  const abs = resolve(path);
  return [mediaOutRoot(home), resolve(home, 'images')].some((own) => {
    const rel = relative(own, abs);
    return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel);
  });
}

/** A path the person named, resolved: inside the workspace (through the
 *  jail), or inside OpenShore's own media or images folder. */
export function mediaInput(ctx: ToolContext, path: string, home: string): string {
  return inOwnMedia(path, home) ? resolve(path) : ctx.jail.resolve(path);
}

function unavailable(): { ok: false; content: string } {
  return {
    ok: false,
    content:
      'No media model is set up for this here. Get one from the Marketplace and place it in the Stack.',
  };
}

function failed(err: unknown): { ok: false; content: string } {
  // A refusal from the ethics layer is not a bug to report: hand the model the
  // plain message so it tells the person and moves on.
  if (err instanceof EthicsBlocked) return { ok: false, content: err.message };
  if (err instanceof JailViolation) return { ok: false, content: err.message };
  return { ok: false, content: mediaFailure(err) };
}

const saved = (files: string[], what: string) =>
  files.length === 1
    ? `${what} saved to ${files[0]}.`
    : `${what} saved:\n${files.map((f) => `- ${f}`).join('\n')}`;

// ---------------------------------------------------------------------------

const editSchema = z.object({
  job: z
    .enum(['remove', 'background', 'upscale', 'instruct', 'select'])
    .describe(
      'remove: take something out and fill in behind it; background: cut the subject onto a clear background; upscale: make it bigger and sharper; instruct: change it as the instruction says; select: save a mask of what is named',
    ),
  image: z
    .string()
    .min(1)
    .describe('The picture: a path in the workspace, or a file a media tool made'),
  what: z
    .string()
    .optional()
    .describe('For remove or select: what to find, as a short noun phrase ("person", "car")'),
  mask: z.string().optional().describe('For remove: a mask picture, white where to remove'),
  instruction: z.string().optional().describe('For instruct: the change, in plain words'),
});

const videoSchema = z.object({
  prompt: z.string().min(1).describe('What happens in the clip'),
  image: z.string().optional().describe('A picture to animate (a path), for image to video'),
});

const transcribeSchema = z.object({
  audio: z
    .string()
    .min(1)
    .describe('The recording: a path in the workspace, or a file a media tool made'),
  speakers: z.boolean().optional().describe('Label who said what'),
  language: z.string().optional().describe('The language code, when it is known ("en", "fr")'),
  format: z.enum(['text', 'srt', 'vtt']).optional().describe('Plain text, or subtitles'),
});

const speakSchema = z.object({
  text: z.string().min(1).max(5000).describe('What to read aloud'),
  ownVoice: z
    .boolean()
    .optional()
    .describe(
      'Use the voice copied for the Your own voice job (watermarked). Only when the person asks for it.',
    ),
});

const soundSchema = z.object({
  kind: z.enum(['music', 'effects']).describe('music: a song or track; effects: a sound effect'),
  prompt: z.string().min(1).describe('The style and mood, or the sound'),
  lyrics: z.string().optional().describe('For music: the words to sing'),
  seconds: z.number().int().min(1).max(600).optional().describe('How long'),
});

const processSchema = z.object({
  job: z
    .enum(['stems', 'cleanup'])
    .describe(
      'stems: split a song into its parts; cleanup: take the noise out of a voice recording',
    ),
  audio: z
    .string()
    .min(1)
    .describe('The recording: a path in the workspace, or a file a media tool made'),
  vocalsOnly: z.boolean().optional().describe('For stems: just the vocals and the rest'),
});

/** The media tools for a session, each with its risk: 'network' when a job
 *  it serves runs on a server off this network, 'read' otherwise. */
export function mediaTools(opts: {
  tools: MediaToolName[];
  leaves: (tool: MediaToolName) => boolean;
  home: string;
}): ToolDef[] {
  const risk = (tool: MediaToolName) =>
    (opts.leaves(tool) ? 'network' : 'read') as 'network' | 'read';
  const out: ToolDef[] = [];
  const want = new Set(opts.tools);
  const home = opts.home;
  // The path a permission rule judges: a workspace file. A file in
  // OpenShore's own media folder is the tool's own to check (mediaInput),
  // since the loop's jail would refuse it as outside the workspace.
  const ruled = (path: string | undefined) => (path && !inOwnMedia(path, home) ? path : undefined);

  if (want.has('editImage')) {
    const tool: ToolDef<typeof editSchema> = {
      name: 'editImage',
      description:
        "Edit a picture with the Stack's photo-editing models: remove something and fill in behind it, remove the background, upscale, change it as an instruction says, or save a mask of what is named. Returns the saved file. Edited pictures carry provenance marking them as AI-made.",
      schema: editSchema,
      risk: risk('editImage'),
      pathOf: (args) => ruled(args.image),
      async execute(args, ctx) {
        const media = ctx.media;
        if (!media) return unavailable();
        try {
          const image = mediaInput(ctx, args.image, home);
          const signal = ctx.signal;
          if (args.job === 'select') {
            if (!args.what) return { ok: false, content: 'Say what to select.' };
            return {
              ok: true,
              content: saved([await media.select(image, args.what, signal)], 'Mask'),
            };
          }
          if (args.job === 'remove') {
            const r = await media.remove(
              image,
              {
                ...(args.mask ? { maskPath: mediaInput(ctx, args.mask, home) } : {}),
                ...(args.what ? { what: args.what } : {}),
              },
              signal,
            );
            return {
              ok: true,
              content: `${saved(r.files, 'Edited picture')}${r.mask ? ` The mask it used is ${r.mask}.` : ''}`,
            };
          }
          if (args.job === 'background') {
            return {
              ok: true,
              content: saved(await media.removeBackground(image, signal), 'Cut-out'),
            };
          }
          if (args.job === 'upscale') {
            return {
              ok: true,
              content: saved(await media.upscale(image, signal), 'Upscaled picture'),
            };
          }
          if (!args.instruction) return { ok: false, content: 'Say what to change.' };
          return {
            ok: true,
            content: saved(await media.instruct(image, args.instruction, signal), 'Edited picture'),
          };
        } catch (err) {
          return failed(err);
        }
      },
    };
    out.push(tool);
  }

  if (want.has('makeVideo')) {
    const tool: ToolDef<typeof videoSchema> = {
      name: 'makeVideo',
      description:
        "Make a short video clip with the Stack's video model, from a description, or by animating a picture. Slow: minutes on a big graphics card, far longer without one. Returns the saved file.",
      schema: videoSchema,
      risk: risk('makeVideo'),
      pathOf: (args) => ruled(args.image),
      async execute(args, ctx) {
        if (!ctx.media) return unavailable();
        try {
          const files = await ctx.media.video(
            {
              prompt: args.prompt,
              ...(args.image ? { imagePath: mediaInput(ctx, args.image, home) } : {}),
            },
            ctx.signal,
          );
          return { ok: true, content: saved(files, 'Clip') };
        } catch (err) {
          return failed(err);
        }
      },
    };
    out.push(tool);
  }

  if (want.has('transcribeAudio')) {
    const tool: ToolDef<typeof transcribeSchema> = {
      name: 'transcribeAudio',
      description:
        "Turn a recording into text with the Stack's transcription model, or label who said what. Returns the transcript.",
      schema: transcribeSchema,
      risk: risk('transcribeAudio'),
      pathOf: (args) => ruled(args.audio),
      async execute(args, ctx) {
        if (!ctx.media) return unavailable();
        try {
          const text = await ctx.media.transcribe(
            mediaInput(ctx, args.audio, home),
            {
              ...(args.speakers ? { speakers: true } : {}),
              ...(args.language ? { language: args.language } : {}),
              ...(args.format ? { format: args.format } : {}),
            },
            ctx.signal,
          );
          return { ok: true, content: text || '(The recording has no words in it.)' };
        } catch (err) {
          return failed(err);
        }
      },
    };
    out.push(tool);
  }

  if (want.has('speakText')) {
    const tool: ToolDef<typeof speakSchema> = {
      name: 'speakText',
      description:
        "Read text aloud with the Stack's voice model and save the audio. ownVoice uses the voice the person copied onto their speech server for the Your own voice job, only when they ask; everything it says is watermarked. Returns the saved file.",
      schema: speakSchema,
      risk: risk('speakText'),
      async execute(args, ctx) {
        if (!ctx.media) return unavailable();
        try {
          const file = await ctx.media.speak(args.text, args.ownVoice === true, ctx.signal);
          return { ok: true, content: saved([file], 'Audio') };
        } catch (err) {
          return failed(err);
        }
      },
    };
    out.push(tool);
  }

  if (want.has('makeAudio')) {
    const tool: ToolDef<typeof soundSchema> = {
      name: 'makeAudio',
      description:
        "Make music or a sound effect with the Stack's music and sound models. Returns the saved file.",
      schema: soundSchema,
      risk: risk('makeAudio'),
      async execute(args, ctx) {
        if (!ctx.media) return unavailable();
        try {
          const files = await ctx.media.sound(
            args.kind,
            {
              prompt: args.prompt,
              ...(args.lyrics ? { lyrics: args.lyrics } : {}),
              ...(args.seconds ? { seconds: args.seconds } : {}),
            },
            ctx.signal,
          );
          return { ok: true, content: saved(files, args.kind === 'music' ? 'Track' : 'Sound') };
        } catch (err) {
          return failed(err);
        }
      },
    };
    out.push(tool);
  }

  if (want.has('processAudio')) {
    const tool: ToolDef<typeof processSchema> = {
      name: 'processAudio',
      description:
        'Split a song into its stems (vocals, drums, bass, the rest), or take the background noise out of a voice recording. Runs on this computer. Returns the saved files.',
      schema: processSchema,
      risk: 'read',
      pathOf: (args) => ruled(args.audio),
      async execute(args, ctx) {
        if (!ctx.media) return unavailable();
        try {
          const audio = mediaInput(ctx, args.audio, home);
          const files =
            args.job === 'stems'
              ? await ctx.media.stems(audio, args.vocalsOnly === true, ctx.signal)
              : await ctx.media.cleanup(audio, ctx.signal);
          return {
            ok: true,
            content: saved(files, args.job === 'stems' ? 'Stems' : 'Clean recording'),
          };
        } catch (err) {
          return failed(err);
        }
      },
    };
    out.push(tool);
  }

  return out;
}
