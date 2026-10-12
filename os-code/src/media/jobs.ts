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
