// Standing instructions for a workspace, the way Claude Code reads CLAUDE.md.
// A power user expects their existing files to just work, so the reader looks
// for OSCODE.md, CLAUDE.md, and AGENTS.md at the workspace root, in that
// order of precedence, and takes the first that exists. Capped so a sprawling
// file cannot eat a small local context window.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const INSTRUCTION_FILES = ['OSCODE.md', 'CLAUDE.md', 'AGENTS.md'] as const;

/** Keep the standing instructions to roughly this many characters. */
const MAX_CHARS = 24_000;

export interface RepoInstructions {
  file: string;
  text: string;
  truncated: boolean;
}

export function readRepoInstructions(cwd: string): RepoInstructions | undefined {
  for (const name of INSTRUCTION_FILES) {
    const path = join(cwd, name);
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, 'utf8');
      const truncated = raw.length > MAX_CHARS;
      return { file: name, text: truncated ? raw.slice(0, MAX_CHARS) : raw, truncated };
    } catch {
      continue;
    }
  }
  return undefined;
}

/** The instruction block the system prompt carries. */
export function instructionsPrompt(
  repo: RepoInstructions | undefined,
  project: string | undefined,
): string | undefined {
  const parts: string[] = [];
  if (project?.trim()) {
    parts.push(`Standing instructions from the person for this project:\n${project.trim()}`);
  }
  if (repo) {
    parts.push(
      `Standing instructions from the repository (${repo.file}${repo.truncated ? ', truncated' : ''}). Follow them the way you would follow a teammate's working notes:\n${repo.text.trim()}`,
    );
  }
  return parts.length ? parts.join('\n\n') : undefined;
}

export { INIT_PROMPT } from './initPrompt.js';
