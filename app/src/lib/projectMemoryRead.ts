// Reading a project's memory notes for the app's read-only view. The notes live
// in the project's primary repo under "OpenShore Project <name> MDs/"; this
// module picks where to read them from (the local clone on desktop, or GitHub
// otherwise) and lists/reads them through a small reader interface, so the
// screen stays platform-agnostic and the logic stays testable.
import { isGithubRepoId } from './chatRepos.js';
import { ghListDir, ghReadFile, parseGithubRepoId } from './github.js';
import {
  MEMORY_FILES,
  memoryFilePath,
  memoryFolder,
  orderMemoryTitlesFirst,
  sanitizeFolderSegment,
} from './projectMemory.js';

/** Where a project's notes are read from. */
export type RepoSource =
  | { kind: 'local'; root: string }
  | { kind: 'github'; owner: string; repo: string };

/** The bridge methods the local reader needs (a subset of OscodeBridge). */
export interface RepoFileBridge {
  repoReadDir(root: string, subdir: string): Promise<string[] | null>;
  repoReadFile(root: string, relPath: string): Promise<string | null>;
}

/** The read seam: list a folder's filenames, read a file's text. undefined
 *  means "not there" (a missing folder or file), distinct from an error, which
 *  throws. */
export interface RepoReader {
  listDir(rel: string): Promise<string[] | undefined>;
  readFile(rel: string): Promise<string | undefined>;
}

/** Choose where to read a project's notes from. On desktop with a local clone,
 *  read the working tree (it shows uncommitted edits too); otherwise read the
 *  primary GitHub repo. Undefined when there is nothing readable (for example a
 *  local-only project opened on a phone). */
export function primaryRepoSource(
  repoIds: readonly string[],
  opts: { canReadLocal: boolean },
): RepoSource | undefined {
  const workspace = repoIds.find((id) => !isGithubRepoId(id));
  if (opts.canReadLocal && workspace) return { kind: 'local', root: workspace };
  const githubId = repoIds.find((id) => isGithubRepoId(id));
  if (githubId) {
    const parsed = parseGithubRepoId(githubId);
    if (parsed) return { kind: 'github', owner: parsed.owner, repo: parsed.repo };
  }
  return undefined;
}

/** A reader over a local clone, backed by the Electron bridge. */
export function localRepoReader(root: string, bridge: RepoFileBridge): RepoReader {
  return {
    async listDir(rel) {
      return (await bridge.repoReadDir(root, rel)) ?? undefined;
    },
    async readFile(rel) {
      return (await bridge.repoReadFile(root, rel)) ?? undefined;
    },
  };
}

/** A reader over a GitHub repo, backed by the contents API. */
export function githubRepoReader(
  owner: string,
  repo: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): RepoReader {
  return {
    async listDir(rel) {
      const entries = await ghListDir(token, owner, repo, rel, fetchImpl);
      return entries?.filter((e) => e.type === 'file').map((e) => e.name);
    },
    async readFile(rel) {
      return ghReadFile(token, owner, repo, rel, fetchImpl);
    },
  };
}

/** One note in the read-only view. */
export interface MemoryNoteRef {
  title: string;
  path: string;
  /** Whether the file actually exists in the repo yet. */
  present: boolean;
}

/** The notes for a project's memory folder, Current State first. `folderExists`
 *  is false when the folder is not in the repo yet (the agent has not created
 *  it), which the UI shows as a friendly "not set up yet" rather than an error. */
export interface MemoryListing {
  folderExists: boolean;
  notes: MemoryNoteRef[];
}

/** List a project's memory notes through a reader. The segment is the sanitized
 *  project name (the middle of the folder name). */
export async function listMemoryNotes(reader: RepoReader, segment: string): Promise<MemoryListing> {
  const folder = memoryFolder(segment);
  const names = await reader.listDir(folder);
  const present = new Set((names ?? []).map((n) => n.toLowerCase()));
  const notes = MEMORY_FILES.map((f) => ({
    title: f.title,
    path: memoryFilePath(segment, f.title),
    present: present.has(`${f.title.toLowerCase()}.md`),
  }));
  return {
    folderExists: names !== undefined,
    notes: orderMemoryTitlesFirst(notes, (n) => n.title),
  };
}

/** Read one note's markdown, or undefined when it is not there. */
export async function readMemoryNote(
  reader: RepoReader,
  path: string,
): Promise<string | undefined> {
  return reader.readFile(path);
}

/** The sanitized folder segment for a project name (re-exported for the screen
 *  so it does not reach into projectMemory directly). */
export function segmentForProject(name: string): string {
  return sanitizeFolderSegment(name);
}
