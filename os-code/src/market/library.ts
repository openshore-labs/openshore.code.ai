// The model library (founder, 2026-10-12): the Local Library as a store of
// recommended models, organized by the Stack it fills. One structure, in one
// place, shared by the engine and every app (through os-code/protocol), and
// free of Node built-ins so the phone can run it.
//
// The shape, top down:
//   - Sections group the categories, the way a store groups its aisles.
//   - A category is a Stack slot: Overall and Reasoning both fill the seat that
//     runs the show; every other category is a specialist slot.
//   - A shelf is one job, or one flavor of a job, inside a category ("Remove
//     objects" in Photo editing, "Translation" in Writing). Each shelf names
//     the job it fills, so placing a pick fills that job in the Stack.
//   - A pick is the catalog's choice for one shelf at one size class. The
//     catalog keys picks by size class, so a shelf holds AT MOST ONE model per
//     size: the cap is built into the data shape, not checked after the fact.
//   - A collection ("Made for") is a person's niche drawn from shelves already
//     on the list. It never adds a model of its own, so the cap holds there too.
//
// The taxonomy (names, blurbs, jobs) lives here because it is product copy and
// each job needs code behind it; the picks are curation data in the catalog
// (os-code/curation/library.json, merged by the builder).
import type { CapabilityCategory } from '../router/roles.js';
import { MEDIA_JOBS, MEDIA_JOB_INFO, MEDIA_SLOTS, slotJobs } from '../media/jobs.js';
import type { MediaJob, MediaSlot } from '../media/jobs.js';
import type { Catalog, CatalogModel } from './schema.js';

// ---------------------------------------------------------------------------
// Size classes
// ---------------------------------------------------------------------------

export const SIZE_CLASSES = ['phone', 'laptop', 'workstation', 'server'] as const;
export type SizeClass = (typeof SIZE_CLASSES)[number];

export interface SizeClassInfo {
  id: SizeClass;
  /** The label on a pick ("Laptop"). */
  name: string;
  /** One plain line on what machine the class means. */
  line: string;
  /** The memory, in GB, the class is sized for; null for a phone (its own
   *  floor rides each model's onDevice.minRamGB) and for a server (no top). */
  memoryGB: number | null;
  /** The largest download, in GB, a pick in this class may be. The builder
   *  refuses a pick over it, so a "laptop" pick is never a 20 GB file. */
  maxDownloadGB: number;
}

export const SIZE_CLASS_INFO: Record<SizeClass, SizeClassInfo> = {
  phone: {
    id: 'phone',
    name: 'Phone',
    line: 'Runs on the phone itself.',
    memoryGB: null,
    maxDownloadGB: 3.5,
  },
  laptop: {
    id: 'laptop',
    name: 'Laptop',
    line: 'Fits a computer with 16 GB of memory.',
    memoryGB: 16,
    maxDownloadGB: 12,
  },
  workstation: {
    id: 'workstation',
    name: 'Workstation',
    line: 'Fits a computer with 48 GB of memory or a 24 GB graphics card.',
    memoryGB: 48,
    maxDownloadGB: 30,
  },
  server: {
    id: 'server',
    name: 'Server',
    line: 'Needs a big computer or a server you rent.',
    memoryGB: null,
    maxDownloadGB: Number.POSITIVE_INFINITY,
  },
};

// ---------------------------------------------------------------------------
// Slots, jobs and runtimes
// ---------------------------------------------------------------------------

/** Where a category's pick goes in the Stack. `main` is the seat that runs the
 *  show; the rest are specialist slots. */
export type LibrarySlot =
  | 'main'
  | 'coding'
  | 'writing'
  | 'analysis'
  | 'embedding'
  | 'fast'
  | 'vision'
  | 'imageGen'
  | 'imageEdit'
  | 'video'
  | 'listen'
  | 'voice'
  | 'audio';

/** The media slots and their jobs live with the engine's Stack (media/jobs.ts):
 *  each runs on its own local server and is called as a tool, and a media slot
 *  holds one model per JOB where a chat slot holds one model. */
export { MEDIA_SLOTS, MEDIA_JOBS, MEDIA_JOB_INFO, slotJobs };
export type { MediaSlot, MediaJob };

export function isMediaSlot(slot: LibrarySlot): slot is MediaSlot {
  return (MEDIA_SLOTS as readonly string[]).includes(slot);
}

/** Every job a shelf can fill: a chat slot's one job, the embedder's, or a
 *  media job. */
export type LibraryJob = 'chat' | 'embed' | MediaJob;

/** How a model runs (RuntimeEnum in schema.ts). Absent on a catalog entry
 *  means Ollama (every entry before the library). The phone runs a model's
 *  `onDevice` file through llama.cpp whatever its runtime says. */
export type ModelRuntime = NonNullable<CatalogModel['runtime']>;

export interface RuntimeInfo {
  id: ModelRuntime;
  /** The program's name, as the person would install it. */
  name: string;
  /** One line on what it is, for the pick's "Runs in" row. */
  line: string;
}

export const RUNTIME_INFO: Record<ModelRuntime, RuntimeInfo> = {
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    line: 'Runs in Ollama on your computer or server.',
  },
  comfyui: {
    id: 'comfyui',
    name: 'ComfyUI',
    line: 'Runs in ComfyUI on your computer or server.',
  },
  speech: {
    id: 'speech',
    name: 'a speech server',
    line: 'Runs in a speech server on your computer or server.',
  },
  separator: {
    id: 'separator',
    name: 'audio-separator',
    line: 'Runs as audio-separator on your computer or server.',
  },
  denoiser: {
    id: 'denoiser',
    name: 'DeepFilterNet',
    line: 'Runs as DeepFilterNet on your computer or server.',
  },
};

/** The runtime a model runs in (Ollama when the entry does not say). */
export function runtimeOf(model: Pick<CatalogModel, 'runtime'>): ModelRuntime {
  return model.runtime ?? 'ollama';
}

// ---------------------------------------------------------------------------
// Sections, categories, shelves
// ---------------------------------------------------------------------------

export type SectionId = 'main' | 'words' | 'pictures' | 'sound';

export type CategoryId =
  | 'overall'
  | 'reasoning'
  | 'coding'
  | 'writing'
  | 'analysis'
  | 'embedding'
  | 'fast'
  | 'vision'
  | 'imageGen'
  | 'imageEdit'
  | 'video'
  | 'listen'
  | 'voice'
  | 'audio';

export interface LibrarySection {
  id: SectionId;
  name: string;
  categories: CategoryId[];
}

export interface LibraryCategory {
  id: CategoryId;
  /** The category's name in the store and the Stack, the same words in both
   *  (app/test/library.test.ts holds them to the Stack's own labels). */
  name: string;
  /** One plain line on what the category's models do. */
  blurb: string;
  section: SectionId;
  slot: LibrarySlot;
  /** The capability the category answers to, for the older capability views. */
  capability: CapabilityCategory;
  /** The runtimes a pick in this category may use. */
  runtimes: ModelRuntime[];
}

export interface LibraryShelf {
  /** `<category>.<name>`, stable: the catalog keys picks by it. */
  id: string;
  category: CategoryId;
  name: string;
  /** One plain line: what a pick on this shelf does for you. */
  blurb: string;
  /** The job a pick fills in its category's slot. Shelves that share a job are
   *  flavors of it ("Transcribe" and "Many languages"); the Stack holds one
   *  model per job. */
  job: LibraryJob;
}

export const LIBRARY_SECTIONS: LibrarySection[] = [
  { id: 'main', name: 'Main models', categories: ['overall', 'reasoning'] },
  {
    id: 'words',
    name: 'Words and code',
    categories: ['coding', 'writing', 'analysis', 'embedding', 'fast'],
  },
  {
    id: 'pictures',
    name: 'Pictures and video',
    categories: ['vision', 'imageGen', 'imageEdit', 'video'],
  },
  { id: 'sound', name: 'Sound', categories: ['listen', 'voice', 'audio'] },
];

const CHAT_RUNTIMES: ModelRuntime[] = ['ollama'];

export const LIBRARY_CATEGORIES: LibraryCategory[] = [
  {
    id: 'overall',
    name: 'Overall',
    blurb: 'Everyday all-rounders for chat, questions, and writing help.',
    section: 'main',
    slot: 'main',
    capability: 'reasoning',
    runtimes: CHAT_RUNTIMES,
  },
  {
    id: 'reasoning',
    name: 'Reasoning',
    blurb: 'They think a problem through step by step, then plan and hand out the work.',
    section: 'main',
    slot: 'main',
    capability: 'reasoning',
    runtimes: CHAT_RUNTIMES,
  },
  {
    id: 'coding',
    name: 'Coding',
    blurb: 'Writes and edits code, and sticks to a diff.',
    section: 'words',
    slot: 'coding',
    capability: 'coding',
    runtimes: CHAT_RUNTIMES,
  },
  {
    id: 'writing',
    name: 'Writing',
    blurb: 'Long-form prose, docs, copy, and translation.',
    section: 'words',
    slot: 'writing',
    capability: 'writing',
    runtimes: CHAT_RUNTIMES,
  },
  {
    id: 'analysis',
    name: 'Analysis',
    blurb: 'Math, science, and careful step-by-step work.',
    section: 'words',
    slot: 'analysis',
    capability: 'analysis',
    runtimes: CHAT_RUNTIMES,
  },
  {
    id: 'embedding',
    name: 'Retrieval',
    blurb: 'Indexes your files so the right ones are found when a model needs them.',
    section: 'words',
    slot: 'embedding',
    capability: 'embedding',
    runtimes: CHAT_RUNTIMES,
  },
  {
    id: 'fast',
    name: 'Fast',
    blurb: 'Small, quick models for simple questions and small edits.',
    section: 'words',
    slot: 'fast',
    capability: 'fast',
    runtimes: CHAT_RUNTIMES,
  },
  {
    id: 'vision',
    name: 'Image reading',
    blurb: 'Reads screenshots, photos, charts, and scanned pages.',
    section: 'pictures',
    slot: 'vision',
    capability: 'vision',
    runtimes: CHAT_RUNTIMES,
  },
  {
    id: 'imageGen',
    name: 'Image creation',
    blurb: 'Makes pictures from a description.',
    section: 'pictures',
    slot: 'imageGen',
    capability: 'image-gen',
    runtimes: ['comfyui'],
  },
  {
    id: 'imageEdit',
    name: 'Photo editing',
    blurb: 'Removes objects and backgrounds, sharpens, and edits a photo when you ask.',
    section: 'pictures',
    slot: 'imageEdit',
    capability: 'image-edit',
    runtimes: ['comfyui'],
  },
  {
    id: 'video',
    name: 'Video',
    blurb: 'Turns a description or a picture into a short clip.',
    section: 'pictures',
    slot: 'video',
    capability: 'video',
    runtimes: ['comfyui'],
  },
  {
    id: 'listen',
    name: 'Transcription',
    blurb: 'Turns recordings, meetings, and voice notes into text.',
    section: 'sound',
    slot: 'listen',
    capability: 'listen',
    runtimes: ['speech'],
  },
  {
    id: 'voice',
    name: 'Voice',
    blurb: 'Reads text aloud in a natural voice.',
    section: 'sound',
    slot: 'voice',
    capability: 'voice',
    runtimes: ['speech'],
  },
  {
    id: 'audio',
    name: 'Music and sound',
    blurb: 'Makes music and sound effects, and splits a song into its parts.',
    section: 'sound',
    slot: 'audio',
    capability: 'audio',
    runtimes: ['comfyui', 'separator', 'denoiser'],
  },
];

export const LIBRARY_SHELVES: LibraryShelf[] = [
  // Overall
  {
    id: 'overall.everyday',
    category: 'overall',
    name: 'Everyday',
    blurb: 'Questions, chat, and writing help: a bit of everything, done well.',
    job: 'chat',
  },
  {
    id: 'overall.long',
    category: 'overall',
    name: 'Long documents',
    blurb: 'Reads long files, contracts, and books in one go.',
    job: 'chat',
  },
  {
    id: 'overall.health',
    category: 'overall',
    name: 'Health and medicine',
    blurb: 'Trained on medical text and images, for research and learning. Not a diagnosis.',
    job: 'chat',
  },
  // Reasoning
  {
    id: 'reasoning.think',
    category: 'reasoning',
    name: 'Thinks it through',
    blurb: 'Works hard problems step by step before it answers.',
    job: 'chat',
  },
  {
    id: 'reasoning.tools',
    category: 'reasoning',
    name: 'Plans and uses tools',
    blurb: 'Calls tools reliably, so it runs a Stack of specialists well.',
    job: 'chat',
  },
  // Coding
  {
    id: 'coding.agent',
    category: 'coding',
    name: 'Writes and fixes code',
    blurb: 'Reads a project, edits files, and runs its tests.',
    job: 'chat',
  },
  // Writing
  {
    id: 'writing.prose',
    category: 'writing',
    name: 'Prose and copy',
    blurb: 'Essays, docs, and copy with a human ear.',
    job: 'chat',
  },
  {
    id: 'writing.translate',
    category: 'writing',
    name: 'Translation',
    blurb: 'Translates between many languages and keeps the meaning.',
    job: 'chat',
  },
  // Math and data
  {
    id: 'analysis.math',
    category: 'analysis',
    name: 'Math',
    blurb: 'Solves math problems step by step.',
    job: 'chat',
  },
  {
    id: 'analysis.science',
    category: 'analysis',
    name: 'Science',
    blurb: 'Trained for chemistry, materials, and biology.',
    job: 'chat',
  },
  // Finding files
  {
    id: 'embedding.files',
    category: 'embedding',
    name: 'Search your files',
    blurb: 'Finds the right notes, documents, and code for a question.',
    job: 'embed',
  },
  // Quick answers
  {
    id: 'fast.instant',
    category: 'fast',
    name: 'Instant replies',
    blurb: 'Answers simple things at once.',
    job: 'chat',
  },
  // Image reading
  {
    id: 'vision.photos',
    category: 'vision',
    name: 'Photos and screenshots',
    blurb: 'Describes a photo, reads a screenshot, and explains a chart.',
    job: 'chat',
  },
  {
    id: 'vision.documents',
    category: 'vision',
    name: 'Documents and receipts',
    blurb: 'Turns scanned pages, receipts, and forms into text and tables.',
    job: 'chat',
  },
  // Image creation
  {
    id: 'imageGen.create',
    category: 'imageGen',
    name: 'Make pictures',
    blurb: 'Photos, art, and illustrations from a description.',
    job: 'create',
  },
  {
    id: 'imageGen.text',
    category: 'imageGen',
    name: 'Text, posters and screens',
    blurb: 'Pictures with clear, correctly spelled words: posters, signs, and app screens.',
    job: 'create',
  },
  // Photo editing
  {
    id: 'imageEdit.select',
    category: 'imageEdit',
    name: 'Find and select',
    blurb: 'Finds what you name in a photo, like "the people in the back". Remove objects uses it.',
    job: 'select',
  },
  {
    id: 'imageEdit.remove',
    category: 'imageEdit',
    name: 'Remove objects',
    blurb: 'Takes something out of a photo and fills in what was behind it.',
    job: 'remove',
  },
  {
    id: 'imageEdit.background',
    category: 'imageEdit',
    name: 'Remove background',
    blurb: 'Cuts out the subject and leaves a clear background.',
    job: 'background',
  },
  {
    id: 'imageEdit.upscale',
    category: 'imageEdit',
    name: 'Upscale and restore',
    blurb: 'Makes a small or worn picture bigger and sharper.',
    job: 'upscale',
  },
  {
    id: 'imageEdit.instruct',
    category: 'imageEdit',
    name: 'Edit by asking',
    blurb: 'Changes a photo the way you describe: "make it sunset", "add a hat".',
    job: 'instruct',
  },
  // Video
  {
    id: 'video.text',
    category: 'video',
    name: 'Text to video',
    blurb: 'A short clip from a description.',
    job: 'text-to-video',
  },
  {
    id: 'video.image',
    category: 'video',
    name: 'Animate a picture',
    blurb: 'Brings a still picture to life as a short clip.',
    job: 'image-to-video',
  },
  // Transcription
  {
    id: 'listen.transcribe',
    category: 'listen',
    name: 'Transcribe',
    blurb: 'Turns a recording into text.',
    job: 'transcribe',
  },
  {
    id: 'listen.languages',
    category: 'listen',
    name: 'Any language',
    blurb: 'Transcribes speech in nearly any language.',
    job: 'transcribe',
  },
  {
    id: 'listen.speakers',
    category: 'listen',
    name: 'Who said what',
    blurb: 'Labels each speaker in a meeting or interview.',
    job: 'speakers',
  },
  // Voice
  {
    id: 'voice.read',
    category: 'voice',
    name: 'Read aloud',
    blurb: 'A natural voice for articles, drafts, and notes.',
    job: 'speak',
  },
  {
    id: 'voice.languages',
    category: 'voice',
    name: 'Many languages',
    blurb: 'Natural voices in many languages.',
    job: 'speak',
  },
  {
    id: 'voice.own',
    category: 'voice',
    name: 'Your own voice',
    blurb:
      'Reads in a voice copied from a sample you set up on your speech server, with a watermark in everything it says. Copy only your own voice, or one you have permission to use.',
    job: 'clone',
  },
  // Music and sound
  {
    id: 'audio.music',
    category: 'audio',
    name: 'Make music',
    blurb: 'A song or a backing track from a description, with or without lyrics.',
    job: 'music',
  },
  {
    id: 'audio.effects',
    category: 'audio',
    name: 'Sound effects',
    blurb: 'Rain, footsteps, a door: a sound from a description.',
    job: 'effects',
  },
  {
    id: 'audio.stems',
    category: 'audio',
    name: 'Separate stems',
    blurb: 'Splits a song into vocals, drums, bass, and the rest.',
    job: 'stems',
  },
  {
    id: 'audio.cleanup',
    category: 'audio',
    name: 'Clean up a voice',
    blurb: 'Takes the background noise out of a voice recording.',
    job: 'cleanup',
  },
];

// ---------------------------------------------------------------------------
// Collections: "Made for" a person's niche
// ---------------------------------------------------------------------------

export interface LibraryCollection {
  id: string;
  /** Who it is for, as a store row names it ("Lawyers and paralegals"). */
  name: string;
  /** One plain line on what the set does for them. */
  blurb: string;
  /** Shelves in the order the collection shows them. A collection draws only
   *  on shelves already on the list, so it never adds a model of its own. */
  shelves: string[];
}

export const LIBRARY_COLLECTIONS: LibraryCollection[] = [
  {
    id: 'developers',
    name: 'Developers',
    blurb: 'Write and fix code, find the right file, and read a screenshot of a bug.',
    shelves: [
      'coding.agent',
      'reasoning.tools',
      'embedding.files',
      'fast.instant',
      'vision.photos',
    ],
  },
  {
    id: 'writers',
    name: 'Writers and editors',
    blurb: 'Draft, revise, dictate, and hear your draft read back.',
    shelves: ['writing.prose', 'overall.long', 'listen.transcribe', 'voice.read'],
  },
  {
    id: 'students',
    name: 'Students and teachers',
    blurb: 'Work through math, read a photo of a page, and transcribe a lecture.',
    shelves: ['overall.everyday', 'analysis.math', 'vision.documents', 'listen.transcribe'],
  },
  {
    id: 'legal',
    name: 'Lawyers and paralegals',
    blurb:
      'Read long contracts, search your case files, and transcribe an interview, on your own machine.',
    shelves: ['overall.long', 'vision.documents', 'embedding.files', 'listen.speakers'],
  },
  {
    id: 'health',
    name: 'Health and care',
    blurb:
      'Medical reading, visit notes, and scanned forms, kept on your own machine. Not a diagnosis.',
    shelves: ['overall.health', 'listen.transcribe', 'vision.documents'],
  },
  {
    id: 'science',
    name: 'Science and research',
    blurb: 'Reason through a problem, read papers, and search your library.',
    shelves: [
      'reasoning.think',
      'analysis.science',
      'analysis.math',
      'vision.documents',
      'embedding.files',
    ],
  },
  {
    id: 'business',
    name: 'Business and finance',
    blurb: 'Reports, receipts, and meeting notes with every speaker named.',
    shelves: ['overall.everyday', 'overall.long', 'vision.documents', 'listen.speakers'],
  },
  {
    id: 'music',
    name: 'Musicians and producers',
    blurb: 'Sketch a track, split a song into stems, clean up a vocal take, and write down lyrics.',
    shelves: ['audio.music', 'audio.stems', 'audio.cleanup', 'listen.transcribe'],
  },
  {
    id: 'creators',
    name: 'Podcasters and video makers',
    blurb:
      'Transcripts with speakers, a clean voice, a voice-over, sound effects, and short clips.',
    shelves: ['listen.speakers', 'audio.cleanup', 'voice.read', 'audio.effects', 'video.text'],
  },
  {
    id: 'design',
    name: 'Designers and photographers',
    blurb: 'Make pictures, take out what you do not want, cut out a subject, and sharpen.',
    shelves: [
      'imageGen.create',
      'imageEdit.select',
      'imageEdit.remove',
      'imageEdit.background',
      'imageEdit.upscale',
      'imageEdit.instruct',
    ],
  },
  {
    id: 'languages',
    name: 'Many languages',
    blurb: 'Translate, transcribe, and read aloud in the languages you work in.',
    shelves: ['writing.translate', 'listen.languages', 'voice.languages'],
  },
  {
    id: 'access',
    name: 'Accessibility',
    blurb: 'Hear text read aloud, speak instead of typing, and have a photo described.',
    shelves: ['voice.read', 'listen.transcribe', 'vision.photos'],
  },
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function libraryCategory(id: CategoryId): LibraryCategory {
  const found = LIBRARY_CATEGORIES.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown library category: ${id}`);
  return found;
}

export function libraryShelf(id: string): LibraryShelf | undefined {
  return LIBRARY_SHELVES.find((s) => s.id === id);
}

export function categoryShelves(id: CategoryId): LibraryShelf[] {
  return LIBRARY_SHELVES.filter((s) => s.category === id);
}

export function libraryCollection(id: string): LibraryCollection | undefined {
  return LIBRARY_COLLECTIONS.find((c) => c.id === id);
}

/** The slot a shelf's pick fills. */
export function shelfSlot(shelf: LibraryShelf): LibrarySlot {
  return libraryCategory(shelf.category).slot;
}

// ---------------------------------------------------------------------------
// Picks
// ---------------------------------------------------------------------------

export interface LibraryPick {
  shelf: LibraryShelf;
  size: SizeClass;
  model: CatalogModel;
  /** One factual line on why this is the pick at this size. */
  why: string;
}

function modelById(catalog: Catalog): Map<string, CatalogModel> {
  return new Map(catalog.models.map((m) => [m.id, m]));
}

/** A shelf's picks, smallest size class first. A pick whose model is not in the
 *  catalog is skipped rather than shown broken. */
export function shelfPicks(catalog: Catalog, shelfId: string): LibraryPick[] {
  const shelf = libraryShelf(shelfId);
  const row = catalog.library?.picks[shelfId];
  if (!shelf || !row) return [];
  const byId = modelById(catalog);
  const out: LibraryPick[] = [];
  for (const size of SIZE_CLASSES) {
    const pick = row[size];
    if (!pick) continue;
    const model = byId.get(pick.model);
    if (!model) continue;
    out.push({ shelf, size, model, why: pick.why });
  }
  return out;
}

/** Every pick in a category, shelf by shelf in taxonomy order. */
export function categoryPicks(catalog: Catalog, id: CategoryId): LibraryPick[] {
  return categoryShelves(id).flatMap((s) => shelfPicks(catalog, s.id));
}

/** Shelves of a category that hold at least one pick, so the store never shows
 *  an empty shelf (a shelf the curators have not filled yet stays hidden). */
export function filledShelves(catalog: Catalog, id: CategoryId): LibraryShelf[] {
  return categoryShelves(id).filter((s) => shelfPicks(catalog, s.id).length > 0);
}

/** Categories that hold at least one pick, in section order. */
export function filledCategories(catalog: Catalog): LibraryCategory[] {
  return LIBRARY_SECTIONS.flatMap((section) =>
    section.categories
      .map((id) => libraryCategory(id))
      .filter((c) => filledShelves(catalog, c.id).length > 0),
  );
}

/** The ids of every model the library offers: the store's whole universe. */
export function libraryModelIds(catalog: Catalog): Set<string> {
  const byId = modelById(catalog);
  const out = new Set<string>();
  for (const row of Object.values(catalog.library?.picks ?? {})) {
    for (const size of SIZE_CLASSES) {
      const id = row?.[size]?.model;
      if (id && byId.has(id)) out.add(id);
    }
  }
  return out;
}

/** Where a model sits in the library: every shelf and size it is picked for. */
export function picksForModel(catalog: Catalog, modelId: string): LibraryPick[] {
  return LIBRARY_SHELVES.flatMap((s) => shelfPicks(catalog, s.id)).filter(
    (p) => p.model.id === modelId,
  );
}

// ---------------------------------------------------------------------------
// The device in hand
// ---------------------------------------------------------------------------

/** What the store knows about the device it is showing picks on. `memoryGB` is
 *  the computer's (or the docked machine's) memory when it has been read. */
export interface LibraryDevice {
  phone: boolean;
  memoryGB?: number;
  /** The host's own fit check, when it has one (the engine's memory budget,
   *  which counts a CPU-only computer's room more carefully than its size
   *  class does): a pick it says will not fit is never marked best here. */
  fits?: (model: CatalogModel) => boolean;
}

/** The size classes this device can run, smallest first. A phone runs only the
 *  phone class on itself; a computer runs every class whose memory fits, and
 *  a computer whose memory has not been read is assumed to be a laptop (never
 *  the biggest on a guess). */
export function sizesFor(device: LibraryDevice): SizeClass[] {
  if (device.phone) return ['phone'];
  const memory = device.memoryGB ?? SIZE_CLASS_INFO.laptop.memoryGB!;
  const out: SizeClass[] = ['phone', 'laptop'];
  if (memory >= SIZE_CLASS_INFO.workstation.memoryGB!) out.push('workstation');
  if (memory > SIZE_CLASS_INFO.workstation.memoryGB!) out.push('server');
  // A computer under the laptop class still runs the laptop picks, slowly; the
  // card's own fit line says so. Never drop the class it most likely is.
  return out;
}

/** The pick a shelf offers this device: the biggest size class that fits it,
 *  or undefined when nothing on the shelf does. */
export function bestPickFor(picks: LibraryPick[], device: LibraryDevice): LibraryPick | undefined {
  const fits = new Set(sizesFor(device));
  let best: LibraryPick | undefined;
  for (const pick of picks) {
    if (!fits.has(pick.size)) continue;
    if (pick.size === 'phone' && device.phone && !pick.model.onDevice) continue;
    if (device.fits && !device.fits(pick.model)) continue;
    best = pick;
  }
  return best;
}

/** A collection's picks for this device: one per shelf, the best that fits,
 *  skipping a shelf with nothing that fits. */
export function collectionPicks(
  catalog: Catalog,
  collectionId: string,
  device: LibraryDevice,
): LibraryPick[] {
  const collection = libraryCollection(collectionId);
  if (!collection) return [];
  const out: LibraryPick[] = [];
  for (const shelfId of collection.shelves) {
    const best = bestPickFor(shelfPicks(catalog, shelfId), device);
    if (best) out.push(best);
  }
  return out;
}

/** Collections with at least one pick, so a row never shows an empty card. */
export function filledCollections(catalog: Catalog): LibraryCollection[] {
  return LIBRARY_COLLECTIONS.filter((c) =>
    c.shelves.some((id) => shelfPicks(catalog, id).length > 0),
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function words(text: string): string {
  return text.toLowerCase();
}

/** Search the library: a model matches on its own name, id or tagline, or on
 *  the name or blurb of a shelf, category or collection it is picked in, so
 *  "remove background" finds the background shelf's picks. Each model appears
 *  once, in taxonomy order. */
export function searchLibrary(catalog: Catalog, query: string): LibraryPick[] {
  const q = words(query.trim());
  if (!q) return [];
  const terms = q.split(/\s+/);
  const seen = new Set<string>();
  const out: LibraryPick[] = [];
  for (const shelf of LIBRARY_SHELVES) {
    const category = libraryCategory(shelf.category);
    const collections = LIBRARY_COLLECTIONS.filter((c) => c.shelves.includes(shelf.id));
    for (const pick of shelfPicks(catalog, shelf.id)) {
      if (seen.has(pick.model.id)) continue;
      const hay = words(
        [
          pick.model.name,
          pick.model.id,
          pick.model.tagline,
          shelf.name,
          shelf.blurb,
          category.name,
          category.blurb,
          ...collections.map((c) => c.name),
        ].join(' '),
      );
      if (terms.every((t) => hay.includes(t))) {
        seen.add(pick.model.id);
        out.push(pick);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// A catalog from before the library
// ---------------------------------------------------------------------------

/** A catalog with a library: the one given when it has its own, otherwise
 *  the bundled library, with the bundled entries its picks name that the
 *  catalog lacks. An older engine, an older published file, or a cache from
 *  before the library still shows the store; the catalog's own entries win
 *  on every id they share. */
export function withLibrary(catalog: Catalog, bundled: Catalog): Catalog {
  if (catalog.library || !bundled.library) return catalog;
  const have = new Set(catalog.models.map((m) => m.id));
  const needed = libraryModelIds(bundled);
  const extra = bundled.models.filter((m) => needed.has(m.id) && !have.has(m.id));
  return { ...catalog, models: [...catalog.models, ...extra], library: bundled.library };
}

// ---------------------------------------------------------------------------
// Validation (the builder's gate, and a test over the bundled seed)
// ---------------------------------------------------------------------------

/** Every reason a catalog's library is not fit to publish. Empty means fit.
 *  The rules: every pick names a model in the catalog, on a known shelf; its
 *  license allows commercial use; it runs in a runtime its category takes;
 *  its download fits its size class; a phone pick has a phone file; and no
 *  shelf names a size class twice (the data shape already prevents that). */
export function libraryProblems(catalog: Catalog): string[] {
  const problems: string[] = [];
  const picks = catalog.library?.picks ?? {};
  const byId = modelById(catalog);
  for (const [shelfId, row] of Object.entries(picks)) {
    const shelf = libraryShelf(shelfId);
    if (!shelf) {
      problems.push(`${shelfId}: not a shelf in the library`);
      continue;
    }
    const category = libraryCategory(shelf.category);
    for (const size of SIZE_CLASSES) {
      const pick = row?.[size];
      if (!pick) continue;
      const where = `${shelfId} ${size}`;
      const model = byId.get(pick.model);
      if (!model) {
        problems.push(`${where}: ${pick.model} is not in the catalog`);
        continue;
      }
      if (!pick.why.trim()) problems.push(`${where}: the pick says no reason`);
      if (model.license.commercial === 'non-commercial' || !model.license.commercial) {
        problems.push(`${where}: ${model.id} does not allow commercial use`);
      }
      const runtime = runtimeOf(model);
      if (!category.runtimes.includes(runtime)) {
        problems.push(
          `${where}: ${model.id} runs in ${runtime}, which ${category.name} does not use`,
        );
      }
      if (size === 'phone') {
        if (!model.onDevice) problems.push(`${where}: ${model.id} has no phone file`);
        else if (model.onDevice.sizeGB > SIZE_CLASS_INFO.phone.maxDownloadGB) {
          problems.push(`${where}: ${model.id}'s phone file is too big for a phone`);
        }
      } else if (model.sizeGB > SIZE_CLASS_INFO[size].maxDownloadGB) {
        problems.push(
          `${where}: ${model.id} is ${model.sizeGB} GB, over the ${SIZE_CLASS_INFO[size].name} class's ${SIZE_CLASS_INFO[size].maxDownloadGB} GB`,
        );
      }
    }
  }
  return problems;
}
