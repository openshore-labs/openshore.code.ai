// Project memory: every coding project keeps a small, durable set of markdown
// notes so context is never lost between sessions. They live INSIDE the
// project's primary repo, in a folder named "OpenShore Project <name> MDs/",
// committed with the code (not hosted by the app). The coding agent (the
// os-code harness) creates and maintains them; the app reads them.
//
// This module is the app copy of the shared spec (names, order, templates,
// folder convention); the harness copy is
// os-code/src/core/agent/projectMemory.ts, and projectMemory.test.ts in each
// package pins the two against each other so they cannot drift.

/** The memory folder is "OpenShore Project <name> MDs". The literal wrapper is
 *  deliberate: the fixed prefix and suffix mean the enclosed name can never be
 *  a bare ".." that climbs out of the repo, and the folder reads plainly in a
 *  file browser. */
export const MEMORY_FOLDER_PREFIX = 'OpenShore Project ';
export const MEMORY_FOLDER_SUFFIX = ' MDs';

/** The top sheet: read this first, a 2 to 5 minute catch up. */
export const CURRENT_STATE_FILE = 'Current State';

/** One preset note: its title (and filename), plus the body it starts with. */
export interface MemoryFile {
  /** Note title, which is also its filename without the .md extension. */
  title: string;
  /** The markdown the note is seeded with when the folder is first created. */
  seed: string;
}

// The five presets, in display order. Current State leads on purpose: it is the
// top sheet, kept short, with the fuller record in the notes beneath it. These
// bodies must match the harness copy byte for byte (the parity test checks it).
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
 *  collapse whitespace. Returns '' when nothing usable is left. Matches the
 *  harness copy so both compute the same folder. */
export function sanitizeFolderSegment(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[/\\<>:"|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^\.+$/.test(cleaned)) return '';
  return cleaned;
}

/** The repo-relative memory folder for a project, e.g.
 *  "OpenShore Project My App MDs". Returns undefined when the name sanitizes to
 *  nothing usable. */
export function memoryFolderForProject(name: string): string | undefined {
  const segment = sanitizeFolderSegment(name);
  return segment ? memoryFolder(segment) : undefined;
}

/** The repo-relative memory folder for a sanitized segment. */
export function memoryFolder(segment: string): string {
  return `${MEMORY_FOLDER_PREFIX}${segment}${MEMORY_FOLDER_SUFFIX}`;
}

/** The repo-relative path of one preset, e.g.
 *  "OpenShore Project My App MDs/Current State.md". */
export function memoryFilePath(segment: string, title: string): string {
  return `${memoryFolder(segment)}/${title}.md`;
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
 *  memory folder: exactly two path parts, the first a valid memory folder, the
 *  last a known preset. */
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

/** Order note filenames so the Current State top sheet leads, the rest keeping
 *  their given order. Used by a read-only project view. */
export function orderMemoryTitlesFirst<T>(items: T[], titleOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    const av = titleOf(a) === CURRENT_STATE_FILE ? 0 : 1;
    const bv = titleOf(b) === CURRENT_STATE_FILE ? 0 : 1;
    return av - bv;
  });
}
