// Project memory: every coding project keeps a small, durable set of markdown
// notes in the Vault, so the model never loses context between sessions. The
// agent reads the Current State top sheet first and digs page by page only when
// it needs more, which keeps planning and debugging cheap. The person can open
// any note in the Vault at any time.
//
// The notes live under Projects/<project>/ in the personal Vault. This module
// is the harness copy of the shared spec (names, order, templates); the app's
// copy is app/src/lib/projectMemory.ts, and projectMemory.test.ts pins the two
// against each other so they cannot drift. The agent keeps the notes current
// through the projectMemoryWrite tool, whose writes land silently but visibly
// (a narrow exception to the always-ask rule for general vault writes). No em
// dashes anywhere in this file, comments included (repo policy is total here).
import { basename } from 'node:path';

/** The vault folder that holds every project's memory folder. */
export const PROJECTS_ROOT = 'Projects';

/** The top sheet: read this first, a 2 to 5 minute catch up. */
export const CURRENT_STATE_FILE = 'Current State';

/** The dedicated tool that keeps the memory notes current. The permission
 *  engine auto-allows this tool by name (the tool is hard-scoped to the five
 *  managed files under a project's memory folder), while every general vault
 *  write stays always-ask. */
export const PROJECT_MEMORY_WRITE_TOOL = 'projectMemoryWrite';

/** One preset note: its title (and filename), plus the body it starts with. */
export interface MemoryFile {
  /** Note title, which is also its filename without the .md extension. */
  title: string;
  /** The markdown the note is seeded with on first open. */
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

/** Sanitize one project name into a single vault-safe folder segment: strip
 *  path separators and the characters forbidden on common filesystems or in
 *  Obsidian's link syntax, and collapse whitespace. Returns '' when nothing
 *  usable is left. Matches the app copy so both compute the same folder. */
export function sanitizeFolderSegment(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[/\\<>:"|?*#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // A segment of only dots ("." or "..") would climb out of the project folder
  // (Projects/../Skills.md resolves to a sibling in the vault). Treat it as
  // unusable so the caller falls back to the project id.
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

/** The vault folder for one project's memory, e.g. "Projects/My App". */
export function memoryFolder(segment: string): string {
  return `${PROJECTS_ROOT}/${segment}`;
}

/** The vault path of one preset inside a project, e.g.
 *  "Projects/My App/Current State.md". */
export function memoryFilePath(segment: string, title: string): string {
  return `${memoryFolder(segment)}/${title}.md`;
}

/** Whether a vault path is one of the five managed presets under a
 *  Projects/<one segment>/ folder. Deliberately strict: exactly three path
 *  parts, the first being the Projects root, the last being a known preset.
 *  This is the shape the permission engine and the write tool both trust. */
export function isMemoryFilePath(path: string): boolean {
  const parts = path.split('/');
  if (parts.length !== 3) return false;
  if (parts[0] !== PROJECTS_ROOT) return false;
  const segment = parts[1]!;
  // Reject a dot segment that would traverse out of the project folder, and an
  // empty one, before trusting the filename.
  if (!segment || segment === '.' || segment === '..') return false;
  const base = parts[2]!.replace(/\.md$/i, '').toLowerCase();
  return MEMORY_TITLES.has(base);
}

/** The system-prompt block that teaches the agent to use the project memory:
 *  read the top sheet first, dig deeper only as needed, and keep the five notes
 *  current through projectMemoryWrite. Injected when a memory segment exists. */
export function projectMemoryPrompt(segment: string): string {
  const folder = memoryFolder(segment);
  const titles = MEMORY_FILES.map((f) => f.title).join(', ');
  return [
    `PROJECT MEMORY (this project's durable knowledge, in the Vault under ${folder}/):`,
    `Five notes carry everything worth remembering across sessions: ${titles}. Reach for them for planning, for debugging, and to recall how something worked when it was healthy.`,
    'Read the top sheet first. Open "Current State" (a 2 to 5 minute catch up) before you start; it names what last landed, the key outstanding build and test actions, the immediate blockers, and the suggested next steps. Only open Progress, Decisions, Action Items, or Skills when you need the deeper record behind a line on the top sheet. Do not read all five up front.',
    `Keep them current as work lands, using the ${PROJECT_MEMORY_WRITE_TOOL} tool (these writes save without interrupting you; every other vault write still asks first):`,
    '- Current State: after a meaningful change lands, refresh all five sections and keep it short (a 2 to 5 minute read). It is a summary, not a log.',
    '- Progress: add one dated entry at the top per meaningful landing or deploy (what changed, why, how it was verified).',
    '- Decisions: add one line whenever you make an ambiguous call, so it is not relitigated later.',
    '- Action Items: keep the list ranked, check off what is done, add follow-ups you surfaced.',
    '- Skills: capture the reusable build, test, and ship recipes and the gotchas that worked, so the next session does not rediscover them.',
    'Never put a memory update in front of the person. Do the work they asked for first, then update the notes as it completes. If a note does not exist yet, writing it creates it from the standard template.',
  ].join('\n');
}
