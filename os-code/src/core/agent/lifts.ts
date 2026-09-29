// The harness lifts for 3B and 7B seats (CTO 6), the engine's side of
// retrieval before turn one. The budget, the search words and the block are
// the pure core's (harness/retrieval.ts); this reads the workspace through
// the keyword search and decides what is never read: a file that may hold a
// secret (the commit card's own test, by name and by content), a path the
// vault's privacy rules keep on this computer or hide, anything inside the
// vault folder (the vault pack speaks for notes), and a path the person's
// permission policy denies to readFile. The loop calls it only for a seat
// that stays on this network, and only with the switch on.
import { relative, sep } from 'node:path';
import type { OscConfig } from '../../config/schema.js';
import { keywordHits } from '../../context/index.js';
import { compileVaultPrivacy } from '../../harness/vault/privacy.js';
import { bodyVisibility } from '../../harness/vaultContext.js';
import { formatRetrieval, retrievalBudgetTokens, taskTerms } from '../../harness/retrieval.js';
import { stageSecretOf } from '../tools/git.js';
import { vaultPrivacyConfig } from './registry.js';
import type { AgentEvent } from './types.js';

/** How many files the search draws excerpts from; the budget usually stops
 *  it sooner. */
const RETRIEVAL_FILES = 6;

export interface FirstTurnRetrievalInput {
  cwd: string;
  /** The person's own words for the task. */
  task: string;
  /** The window the seat is served, in tokens. */
  servedWindow: number;
  config: OscConfig;
  /** The permission policy's verdict on a path (ToolContext.denies). */
  denies?: (toolName: string, path: string) => boolean;
  /** The vault folder, when this session has one. */
  vaultRoot?: string;
}

export interface FirstTurnRetrieval {
  /** The block that heads the task's first message. */
  text: string;
  /** The card's event. */
  event: Extract<AgentEvent, { type: 'retrieval' }>;
}

/** The excerpts for the task's first message, or undefined when the task has
 *  no search words, the window has no room, or nothing readable matched. */
export function firstTurnRetrieval(input: FirstTurnRetrievalInput): FirstTurnRetrieval | undefined {
  const budgetTokens = retrievalBudgetTokens(input.servedWindow);
  if (!budgetTokens) return undefined;
  const terms = taskTerms(input.task);
  if (!terms.length) return undefined;
  const privacy = compileVaultPrivacy(vaultPrivacyConfig(input.config));
  const vaultRel = vaultInside(input.cwd, input.vaultRoot);
  const skip = (rel: string, text: string): boolean => {
    if (
      vaultRel !== undefined &&
      (vaultRel === '' || rel === vaultRel || rel.startsWith(`${vaultRel}/`))
    ) {
      return true;
    }
    if (stageSecretOf(rel, () => text)) return true;
    const visibility = /\.md$/i.test(rel)
      ? bodyVisibility(privacy, rel, text)
      : privacy.visibility({ path: rel });
    if (visibility !== 'open') return true;
    return input.denies?.('readFile', rel) ?? false;
  };
  const hits = keywordHits(input.cwd, terms, RETRIEVAL_FILES, skip);
  const block = formatRetrieval(hits, budgetTokens);
  if (!block) return undefined;
  return {
    text: block.text,
    event: { type: 'retrieval', sources: block.sources, tokens: block.tokens, budgetTokens },
  };
}

/** The vault folder relative to the workspace, forward slashes, when the
 *  vault sits inside it ('' when it is the workspace itself). */
function vaultInside(cwd: string, vaultRoot: string | undefined): string | undefined {
  if (!vaultRoot) return undefined;
  const rel = relative(cwd, vaultRoot);
  if (rel.startsWith('..') || rel.startsWith(sep) || /^[A-Za-z]:/.test(rel)) return undefined;
  return rel.split(sep).join('/');
}
