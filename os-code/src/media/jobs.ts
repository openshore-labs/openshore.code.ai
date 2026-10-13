// The media jobs (the model library, founder 2026-10-12). A media slot in the
// Stack (Image creation, Photo editing, Video, Transcription, Voice, Music and
// sound) is not a chat seat: each of its jobs is a model on a local server the
// engine calls as a tool, the way it already calls the image server. One model
// is placed per job, so "Remove objects" and "Remove background" can be two
// different models in the one Photo editing slot.
//
// Pure data, free of Node built-ins: the config schema, the tools, the library
// (market/library.ts) and the apps all read it.

/** The Stack's media slots. */
export const MEDIA_SLOTS = ['imageGen', 'imageEdit', 'video', 'listen', 'voice', 'audio'] as const;
export type MediaSlot = (typeof MEDIA_SLOTS)[number];

/** The runtimes a media job runs in (each a program the person runs). */
export const MEDIA_RUNTIMES = ['comfyui', 'speech', 'separator', 'denoiser'] as const;
export type MediaRuntime = (typeof MEDIA_RUNTIMES)[number];

export const MEDIA_JOBS = [
  // Image creation
  'create',
  // Photo editing
  'select',
  'remove',
  'background',
  'upscale',
  'instruct',
  // Video
  'text-to-video',
  'image-to-video',
  // Transcription
  'transcribe',
  'speakers',
  // Voice
  'speak',
  'clone',
  // Music and sound
  'music',
  'effects',
  'stems',
  'cleanup',
] as const;
export type MediaJob = (typeof MEDIA_JOBS)[number];

export interface MediaJobInfo {
  id: MediaJob;
  slot: MediaSlot;
  /** The runtimes a model for this job may run in. */
  runtimes: MediaRuntime[];
  /** The tool the agent calls for it. */
  tool: MediaToolName;
  /** Plain words for the job, as the Stack's row says it. */
  plain: string;
}

export type MediaToolName =
  | 'generateImage'
  | 'editImage'
  | 'makeVideo'
  | 'transcribeAudio'
  | 'speakText'
  | 'makeAudio'
  | 'processAudio';

export const MEDIA_JOB_INFO: Record<MediaJob, MediaJobInfo> = {
  create: {
    id: 'create',
    slot: 'imageGen',
    runtimes: ['comfyui'],
    tool: 'generateImage',
    plain: 'Make pictures',
  },
  select: {
    id: 'select',
    slot: 'imageEdit',
    runtimes: ['comfyui'],
    tool: 'editImage',
    plain: 'Find and select',
  },
  remove: {
    id: 'remove',
    slot: 'imageEdit',
    runtimes: ['comfyui'],
    tool: 'editImage',
    plain: 'Remove objects',
  },
  background: {
    id: 'background',
    slot: 'imageEdit',
    runtimes: ['comfyui'],
    tool: 'editImage',
    plain: 'Remove background',
  },
  upscale: {
    id: 'upscale',
    slot: 'imageEdit',
    runtimes: ['comfyui'],
    tool: 'editImage',
    plain: 'Upscale and restore',
  },
  instruct: {
    id: 'instruct',
    slot: 'imageEdit',
    runtimes: ['comfyui'],
    tool: 'editImage',
    plain: 'Edit by asking',
  },
  'text-to-video': {
    id: 'text-to-video',
    slot: 'video',
    runtimes: ['comfyui'],
    tool: 'makeVideo',
    plain: 'Text to video',
  },
  'image-to-video': {
    id: 'image-to-video',
    slot: 'video',
    runtimes: ['comfyui'],
    tool: 'makeVideo',
    plain: 'Animate a picture',
  },
  transcribe: {
    id: 'transcribe',
    slot: 'listen',
    runtimes: ['speech'],
    tool: 'transcribeAudio',
    plain: 'Transcribe',
  },
  speakers: {
    id: 'speakers',
    slot: 'listen',
    runtimes: ['speech'],
    tool: 'transcribeAudio',
    plain: 'Who said what',
  },
  speak: {
    id: 'speak',
    slot: 'voice',
    runtimes: ['speech'],
    tool: 'speakText',
    plain: 'Read aloud',
  },
  clone: {
    id: 'clone',
    slot: 'voice',
    runtimes: ['speech'],
    tool: 'speakText',
    plain: 'Your own voice',
  },
  music: {
    id: 'music',
    slot: 'audio',
    runtimes: ['comfyui'],
    tool: 'makeAudio',
    plain: 'Make music',
  },
  effects: {
    id: 'effects',
    slot: 'audio',
    runtimes: ['comfyui'],
    tool: 'makeAudio',
    plain: 'Sound effects',
  },
  stems: {
    id: 'stems',
    slot: 'audio',
    runtimes: ['separator'],
    tool: 'processAudio',
    plain: 'Separate stems',
  },
  cleanup: {
    id: 'cleanup',
    slot: 'audio',
    runtimes: ['denoiser'],
    tool: 'processAudio',
    plain: 'Clean up a voice',
  },
};

/** The jobs in a media slot, in the order the Stack lists them. */
export function slotJobs(slot: MediaSlot): MediaJob[] {
  return MEDIA_JOBS.filter((job) => MEDIA_JOB_INFO[job].slot === slot);
}

/** The jobs a tool serves. */
export function toolJobs(tool: MediaToolName): MediaJob[] {
  return MEDIA_JOBS.filter((job) => MEDIA_JOB_INFO[job].tool === tool);
}

const MEDIA_TOOL_NAMES: ReadonlySet<string> = new Set<MediaToolName>([
  'generateImage',
  'editImage',
  'makeVideo',
  'transcribeAudio',
  'speakText',
  'makeAudio',
  'processAudio',
]);

/** Whether a tool name is one of the media tools. */
export function isMediaTool(name: string): name is MediaToolName {
  return MEDIA_TOOL_NAMES.has(name);
}

/** The job a media tool call runs, read from its arguments the way the tool
 *  reads them, so the loop can judge where the call goes before it runs. */
export function callJob(tool: MediaToolName, args: Record<string, unknown>): MediaJob | undefined {
  switch (tool) {
    case 'generateImage':
      return 'create';
    case 'editImage':
      return typeof args.job === 'string' &&
        ['select', 'remove', 'background', 'upscale', 'instruct'].includes(args.job)
        ? (args.job as MediaJob)
        : undefined;
    case 'makeVideo':
      return args.image ? 'image-to-video' : 'text-to-video';
    case 'transcribeAudio':
      return args.speakers === true ? 'speakers' : 'transcribe';
    case 'speakText':
      return args.ownVoice === true ? 'clone' : 'speak';
    case 'makeAudio':
      return args.kind === 'effects' ? 'effects' : 'music';
    case 'processAudio':
      return args.job === 'stems' || args.job === 'cleanup' ? args.job : undefined;
  }
}

/** The files a media tool call sends, as the person or the model named them. */
export function callFiles(tool: MediaToolName, args: Record<string, unknown>): string[] {
  const keys: Record<MediaToolName, string[]> = {
    generateImage: [],
    editImage: ['image', 'mask'],
    makeVideo: ['image'],
    transcribeAudio: ['audio'],
    speakText: [],
    makeAudio: [],
    processAudio: ['audio'],
  };
  return keys[tool].flatMap((k) => (typeof args[k] === 'string' && args[k] ? [args[k]] : []));
}

/** The voice models whose own watermark marks everything they say, by their
 *  library id and the name the speech server knows them by: Chatterbox, with
 *  Resemble AI's PerTh watermark. Copying a voice runs only on one of these
 *  (security review, 2026-10-12). It is a rule in code, so neither a config
 *  file, a project, nor a catalog can mark another model watermarked. */
export const WATERMARKED_VOICES: Readonly<Record<string, string>> = {
  chatterbox: 'chatterbox',
};

/** Whether a placement may copy a voice: a watermarked model, placed as
 *  itself (its library id and its model name agree). */
export function cloneAllowed(placement: { catalogId?: string; model?: string }): boolean {
  const model = placement.catalogId ? WATERMARKED_VOICES[placement.catalogId] : undefined;
  return model !== undefined && placement.model === model;
}
