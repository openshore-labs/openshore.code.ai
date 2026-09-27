// The vault tools on app seats that call tools (Vault M5, CTO J10), on the
// codemagicTool.ts pattern: Anthropic and OpenAI specs plus one runner. The
// descriptions are the engine's own (`VAULT_TOOL_TEXT` from os-code/protocol),
// so both hosts teach search, then one section, then links.
//
// WAVE 0 CONTRACT. The names, input shapes and specs are the contract and are
// real data; `vaultToolSlice`, `parseVaultToolArgs` and `runVaultTool` are
// built by stream F and throw until then, since the runner applies privacy.
import { VAULT_TOOL_TEXT } from 'os-code/protocol';
import type { VaultPrivacy } from 'os-code/protocol';
import type { PackSeat } from '../drivers/types.js';

/** The vault tools an app seat may be offered. */
export type AppVaultToolName = 'vaultSearch' | 'vaultRead' | 'vaultLookup' | 'vaultPropose';

export const APP_VAULT_TOOL_NAMES: readonly AppVaultToolName[] = [
  'vaultSearch',
  'vaultRead',
  'vaultLookup',
  'vaultPropose',
];

export interface VaultSearchInput {
  query: string;
}
export interface VaultReadInput {
  path: string;
  section?: string;
}
/** Exactly one of query or path. */
export interface VaultLookupInput {
  query?: string;
  path?: string;
  section?: string;
}
export interface VaultProposeInput {
  path: string;
  text: string;
  mode: 'create' | 'append';
}

export type VaultToolInput =
  | { name: 'vaultSearch'; input: VaultSearchInput }
  | { name: 'vaultRead'; input: VaultReadInput }
  | { name: 'vaultLookup'; input: VaultLookupInput }
  | { name: 'vaultPropose'; input: VaultProposeInput };

/** A queued write, shown on the one approval card at the end of the send
 *  (D4). Approve writes each with `ifAbsent` (create) or `ifMatch` (append,
 *  against `baseVersion`); decline drops all. */
export interface VaultProposal extends VaultProposeInput {
  /** The note's version when the proposal was made (append only). */
  baseVersion?: string;
}

/** What the runner reads and where proposals go. */
export interface VaultToolContext {
  seat: PackSeat;
  privacy: VaultPrivacy;
  /** The personal vault only; never the team vault. */
  search: (query: string) => Promise<Array<{ path: string; heading?: string; snippet: string }>>;
  read: (path: string) => Promise<{ text: string; version: string } | undefined>;
  /** The class's `vaultReadCapChars`. */
  readCapChars: number;
  /** Queues a proposal for the end-of-send approval card. */
  propose: (p: VaultProposal) => void;
}

/** A tool result. `localOnly` marks a local-only read on a local seat, so
 *  the send's history entries are marked and a later leaving turn gets
 *  `LOCAL_ONLY_STUB` (I5). */
export interface VaultToolResult {
  content: string;
  localOnly?: true;
  isError?: true;
}

const SCHEMAS: Record<AppVaultToolName, Record<string, unknown>> = {
  vaultSearch: {
    type: 'object',
    properties: { query: { type: 'string', description: 'The words to search for.' } },
    required: ['query'],
  },
  vaultRead: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'A path, a bare note name, or an alias; "#Heading" reads one part.',
      },
      section: {
        type: 'string',
        description: 'Just this part: a heading\'s text, or "^id" for a block.',
      },
    },
    required: ['path'],
  },
  vaultLookup: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search the vault for these words.' },
      path: {
        type: 'string',
        description: 'Read this note (a path, bare name, or alias; "#Heading" reads one part).',
      },
      section: {
        type: 'string',
        description: 'With path: read only this heading or "^id" block.',
      },
    },
  },
  vaultPropose: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The note path, ending in .md.' },
      text: { type: 'string', description: 'The markdown to write or append.' },
      mode: { type: 'string', enum: ['create', 'append'] },
    },
    required: ['path', 'text', 'mode'],
  },
};

/** A tool as offered to an Anthropic model. */
export function vaultAnthropicTool(name: AppVaultToolName): {
  name: AppVaultToolName;
  description: string;
  input_schema: { type: 'object' } & Record<string, unknown>;
} {
  return {
    name,
    description: VAULT_TOOL_TEXT[name],
    input_schema: SCHEMAS[name] as { type: 'object' } & Record<string, unknown>,
  };
}

/** The same tool in OpenAI / BYOM function-calling shape. */
export function vaultOpenAiTool(name: AppVaultToolName): {
  type: 'function';
  function: { name: AppVaultToolName; description: string; parameters: Record<string, unknown> };
} {
  return {
    type: 'function',
    function: { name, description: VAULT_TOOL_TEXT[name], parameters: SCHEMAS[name] },
  };
}

/** Which tools a seat gets (J10): `vaultSearch`, `vaultRead` and
 *  `vaultPropose` on cloud and BYOM seats, `vaultLookup` alone in place of
 *  the two reads where the class's `mergedVaultTool` is set; none on a device
 *  seat, a current bench ref, a play step, or the team vault. */
export function vaultToolSlice(o: {
  kind: 'device' | 'cloud' | 'byom';
  mergedVaultTool: boolean;
  currentBench: boolean;
  playStep: boolean;
  teamVault: boolean;
}): AppVaultToolName[] {
  void o;
  throw new Error('vaultToolSlice is not built yet (Vault M5, stream F).');
}

/** Parse a tool call's arguments, or null when malformed. */
export function parseVaultToolArgs(
  name: string,
  argString: string | undefined,
): VaultToolInput | null {
  void name;
  void argString;
  throw new Error('parseVaultToolArgs is not built yet (Vault M5, stream F).');
}

/** Run one call. Hidden notes are absent; a local-only note on a leaving
 *  seat says it stays on this computer; `vaultPropose` answers "queued for
 *  the person to approve" and writes nothing. */
export function runVaultTool(
  call: VaultToolInput,
  ctx: VaultToolContext,
): Promise<VaultToolResult> {
  void call;
  void ctx;
  return Promise.reject(new Error('runVaultTool is not built yet (Vault M5, stream F).'));
}
