// Project memory: every coding project gets a small, durable set of markdown
// notes in the Vault, so context is never lost between sessions. The model
// reads the Current State top sheet first and digs page by page only when it
// needs more, which keeps planning and debugging cheap. The person can open
// any of the notes in the Vault at any time.
//
// The notes live under Projects/<project>/ in the personal Vault (private, not
// committed to any repo). The coding agent (the os-code harness) keeps them
// current; this module is the single source of truth for their names, order,
// and starting templates, mirrored in os-code/src/core/agent/projectMemory.ts.
import type { Project } from '../state/types.js';

/** The vault folder that holds every project's memory folder. */
export const PROJECTS_ROOT = 'Projects';

/** The top sheet: read this first, a 2 to 5 minute catch up. */
export const CURRENT_STATE_FILE = 'Current State';

/** One preset note: its title (and filename), plus the body it starts with. */
export interface MemoryFile {
  /** Note title, which is also its filename without the .md extension. */
  title: string;
  /** The markdown the note is seeded with on first open. */
  seed: string;
}

// The five presets, in display order. Current State leads on purpose: it is the
// top sheet, kept short, with the fuller record in the notes beneath it. None
// of these bodies may carry an em dash (repo policy is total here).
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
 *  usable is left (the caller falls back to the project id). */
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

/** Map every project to its memory folder segment, keeping segments unique so
 *  two projects with the same (or empty) sanitized name never share one memory
 *  folder. Collisions and empties fall back to a short slice of the project id.
 *  Returns a Map keyed by project id. */
export function projectFolders(projects: Project[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const p of projects) {
    let seg = sanitizeFolderSegment(p.name);
    if (!seg || taken.has(seg.toLowerCase())) {
      const suffix = p.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 6) || 'project';
      seg = seg ? `${seg} ${suffix}` : suffix;
    }
    taken.add(seg.toLowerCase());
    out.set(p.id, seg);
  }
  return out;
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

/** Whether a vault path is one of the five managed memory presets under a
 *  Projects/<one segment>/ folder. This is the gate the harness uses to decide
 *  what may auto-write, so it is deliberately strict: exactly three path parts,
 *  the first being the Projects root, the last being a known preset. */
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

/** True when a vault folder is exactly one project's memory folder
 *  ("Projects/<segment>"), so the UI can pin the Current State top sheet there. */
export function isProjectMemoryFolder(folder: string): boolean {
  const parts = folder.split('/');
  return parts.length === 2 && parts[0] === PROJECTS_ROOT && Boolean(parts[1]);
}

/** The notes to seed so every project starts with the full preset set. A
 *  project is seeded only when it has NONE of its memory files yet (true first
 *  open); once any exist, the person and the agent own the folder and deletions
 *  are respected. Pure: it reads the current path list and returns the writes,
 *  it does not perform them. */
export function seedPlan(
  projects: Project[],
  existingPaths: string[],
): Array<{ path: string; text: string }> {
  const present = new Set(existingPaths.map((p) => p.toLowerCase()));
  const folders = projectFolders(projects);
  const writes: Array<{ path: string; text: string }> = [];
  for (const p of projects) {
    const seg = folders.get(p.id)!;
    const hasAny = MEMORY_FILES.some((f) =>
      present.has(memoryFilePath(seg, f.title).toLowerCase()),
    );
    if (hasAny) continue;
    for (const f of MEMORY_FILES) {
      writes.push({ path: memoryFilePath(seg, f.title), text: f.seed });
    }
  }
  return writes;
}
