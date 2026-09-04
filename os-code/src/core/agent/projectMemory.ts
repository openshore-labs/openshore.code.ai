// Project memory: every coding project keeps a small, durable set of markdown
// notes so the model never loses context between sessions. The agent reads the
// Current State top sheet first and digs page by page only when it needs more,
// which keeps planning and debugging cheap. The person can open the notes in
// any editor, or read them in the app's Vault section.
//
// The notes live INSIDE the project's primary repo, in a folder named
// "OpenShore Project <name> MDs/", committed with the code (not hosted by the
// app). This module is the harness copy of the shared spec (names, order,
// templates, folder convention); the app's copy is app/src/lib/projectMemory.ts,
// and projectMemory.test.ts pins the two against each other so they cannot
// drift. The agent keeps the notes current through the projectMemoryWrite tool,
// whose writes land silently but visibly (a narrow exception to the always-ask
// rule for general writes). No em dashes anywhere in this file, comments
// included (repo policy is total here).
import { basename } from 'node:path';

/** The memory folder is "OpenShore Project <name> MDs". The literal wrapper is
 *  deliberate: the fixed prefix and suffix mean the enclosed name can never be
 *  a bare ".." that climbs out of the repo, and the folder reads plainly in a
 *  file browser. */
export const MEMORY_FOLDER_PREFIX = 'OpenShore Project ';
export const MEMORY_FOLDER_SUFFIX = ' MDs';

/** The top sheet: read this first, a 2 to 5 minute catch up. */
export const CURRENT_STATE_FILE = 'Current State';

/** The dedicated tool that keeps the memory notes current. The permission
 *  engine auto-allows this tool by name (the tool is hard-scoped to the five
 *  managed files inside the project's memory folder), while every general write
 *  stays always-ask. */
export const PROJECT_MEMORY_WRITE_TOOL = 'projectMemoryWrite';

/** One preset note: its title (and filename), plus the body it starts with. */
export interface MemoryFile {
  /** Note title, which is also its filename without the .md extension. */
  title: string;
  /** The markdown the note is seeded with when the folder is first created. */
  seed: string;
}

// The five presets, in display order. Current State leads on purpose: it is the
// top sheet, kept short, with the fuller record in the notes beneath it. These
// bodies must match the app copy byte for byte (the parity test checks it).
export const MEMORY_FILES: MemoryFile[] = [
  {
    title: CURRENT_STATE_FILE,
    seed: `# Current State

A 2 to 5 minute catch up on where this project is. Kept short on purpose. The fuller record lives in the notes beside this one.

Updated: not yet

## What last landed and launched
Nothing yet. The first change to land is recorded here.

## Key outstanding build actions
- none captured yet

## Key outstanding test actions
- none captured yet

## Immediate blockers
- none

## Suggested next steps
- none captured yet
`,
  },
  {
    title: 'Progress',
    seed: `# Progress

The recent-state record for this project. Read the Current State top sheet first; this note holds the fuller history behind it.

## Current state
Where the project stands, in a few sentences.

## What remains
- open threads land here

## Log
Newest first. One entry per meaningful landing or deploy: what changed, why, and how it was verified.

<!-- Example entry, copy it upward:
### 2026-01-01  short title
- What: the change that landed
- Why: the reason it was made
- Verified: how it was checked
-->
`,
  },
  {
    title: 'Decisions',
    seed: `# Decisions

One line per ambiguous call, so a choice already made does not get relitigated. Newest first.

<!-- 2026-01-01  Chose X over Y because Z. -->
`,
  },
  {
    title: 'Action Items',
    seed: `# Action Items

The running to-do list for this project, highest priority first.

Legend: [P1] now  ·  [P2] next  ·  [P3] someday  ·  [x] done

- nothing captured yet
`,
  },
  {
    title: 'Skills',
    seed: `# Skills

How this project is built, tested, and shipped: the reusable recipes, commands, and gotchas that worked, so the next session does not rediscover them.

## Build
- commands to build

## Test
- commands to test

## Ship and deploy
- steps to release

## Gotchas and patterns
- hard-won notes land here
`,
  },
];

const MEMORY_TITLES = new Set(MEMORY_FILES.map((f) => f.title.toLowerCase()));

/** Sanitize one project name into the middle of the memory folder name: strip
 *  path separators and the characters forbidden on common filesystems, and
 *  collapse whitespace. Returns '' when nothing usable is left (the caller
 *  falls back to the workspace basename). Matches the app copy. */
export function sanitizeFolderSegment(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[/\\<>:"|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // A name of only dots is unusable (a bare "." or ".." reads oddly and adds
  // nothing); fall back to the workspace basename instead.
  if (/^\.+$/.test(cleaned)) return '';
  return cleaned;
}

/** The memory folder segment for this session: the project's name when the
 *  chat belongs to one, else the workspace folder's basename, so even a
 *  project-less desktop chat gets a stable memory folder. Empty when neither
 *  yields anything usable (the tool then refuses). */
export function memorySegment(projectName: string | undefined, cwd: string): string {
  const fromProject = projectName ? sanitizeFolderSegment(projectName) : '';
  if (fromProject) return fromProject;
  return sanitizeFolderSegment(basename(cwd));
}

/** The repo-relative memory folder for a project, e.g.
 *  "OpenShore Project My App MDs". */
export function memoryFolder(segment: string): string {
  return `${MEMORY_FOLDER_PREFIX}${segment}${MEMORY_FOLDER_SUFFIX}`;
}

/** The repo-relative path of one preset, e.g.
 *  "OpenShore Project My App MDs/Current State.md". */
export function memoryFilePath(segment: string, title: string): string {
  return `${memoryFolder(segment)}/${title}.md`;
}

/** The five notes to seed a project's folder with, from the standard templates.
 *  The tool ensures these exist before applying an update, so the set always
 *  materializes together. */
export function memorySeeds(segment: string): Array<{ path: string; text: string }> {
  return MEMORY_FILES.map((f) => ({ path: memoryFilePath(segment, f.title), text: f.seed }));
}

/** The enclosed name of a memory folder, or undefined when the folder is not a
 *  memory folder. Rejects an empty or dot-only inner name. */
export function memoryFolderName(folder: string): string | undefined {
  if (!folder.startsWith(MEMORY_FOLDER_PREFIX) || !folder.endsWith(MEMORY_FOLDER_SUFFIX)) {
    return undefined;
  }
  const inner = folder.slice(
    MEMORY_FOLDER_PREFIX.length,
    folder.length - MEMORY_FOLDER_SUFFIX.length,
  );
  if (!inner || /^\.+$/.test(inner)) return undefined;
  return inner;
}

/** Whether a repo-relative path is one of the five managed presets inside a
 *  memory folder. Deliberately strict: exactly two path parts, the first a
 *  valid memory folder, the last a known preset. This is the shape the
 *  permission engine and the write tool both trust. */
export function isMemoryFilePath(path: string): boolean {
  const parts = path.split('/');
  if (parts.length !== 2) return false;
  if (memoryFolderName(parts[0]!) === undefined) return false;
  const base = parts[1]!.replace(/\.md$/i, '').toLowerCase();
  return MEMORY_TITLES.has(base);
}

/** True when a folder is exactly one project's memory folder, so the UI can pin
 *  the Current State top sheet there. */
export function isProjectMemoryFolder(folder: string): boolean {
  return !folder.includes('/') && memoryFolderName(folder) !== undefined;
}

/** The system-prompt block that teaches the agent to use the project memory:
 *  read the top sheet first, dig deeper only as needed, and keep the five notes
 *  current through projectMemoryWrite. Injected when a memory segment exists. */
export function projectMemoryPrompt(segment: string): string {
  const folder = memoryFolder(segment);
  const titles = MEMORY_FILES.map((f) => f.title).join(', ');
  return [
    `PROJECT MEMORY (this project's durable knowledge, in this repo under "${folder}/"):`,
    `Five notes carry everything worth remembering across sessions: ${titles}. Reach for them for planning, for debugging, and to recall how something worked when it was healthy. They are committed with the repo, so they travel with the code.`,
    `Read the top sheet first. Open "${folder}/${CURRENT_STATE_FILE}.md" (a 2 to 5 minute catch up) before you start; it names what last landed, the key outstanding build and test actions, the immediate blockers, and the suggested next steps. Only open Progress, Decisions, Action Items, or Skills when you need the deeper record behind a line on the top sheet. Do not read all five up front.`,
    `Keep them current as work lands, using the ${PROJECT_MEMORY_WRITE_TOOL} tool (these writes save without interrupting you; every other write still asks first):`,
    '- Current State: after a meaningful change lands, refresh all five sections and keep it short (a 2 to 5 minute read). It is a summary, not a log.',
    '- Progress: add one dated entry at the top per meaningful landing or deploy (what changed, why, how it was verified).',
    '- Decisions: add one line whenever you make an ambiguous call, so it is not relitigated later.',
    '- Action Items: keep the list ranked, check off what is done, add follow-ups you surfaced.',
    '- Skills: capture the reusable build, test, and ship recipes and the gotchas that worked, so the next session does not rediscover them.',
    'Never put a memory update in front of the person. Do the work they asked for first, then update the notes as it completes. The notes ride into your commit alongside the change that prompted them; do not make a separate commit just for them.',
  ].join('\n');
}
