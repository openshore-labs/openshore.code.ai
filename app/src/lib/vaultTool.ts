// The vault tools on app seats that call tools (Vault M5, CTO J10), on the
// codemagicTool.ts pattern: Anthropic and OpenAI specs plus one runner. The
// descriptions are the engine's own (`VAULT_TOOL_TEXT` from os-code/protocol),
// so both hosts teach search, then one section, then links.
//
// Privacy is the one judge (`VaultPrivacy.visibility`, CTO J3): a hidden note
// is absent from every answer, a local-only note's text reaches only a seat
// whose requests stay on this network, and such an answer carries `localOnly`
// so the driver marks the send's replies and a later leaving turn gets
// `LOCAL_ONLY_STUB` (I5). A write is never made here: `vaultPropose` queues a
// proposal and the driver shows every queued write on one card at the end of
// the send (D4).
//
// Vault M7 (CTO L2, L8): a model never writes under `.oscode/` (the vault's
// settings are the person's), refused at propose on the typed path and again
// at approve on the path the write would really land on
// (`vaultApproveRefusal`); and where the vault's settings name an agent
// folder, a proposal outside it is refused and the tool's description names
// the folder.
import {
  VAULT_TOOL_TEXT,
  deriveProfile,
  foldPath,
  isAgentWritablePath,
  isNotePath,
  normalizeNotePath,
  oscodeMarks,
  readFrontmatter,
  scanNote,
} from 'os-code/protocol';
import type { ModelClass, OscodeMark, VaultPrivacy, VaultVisibility } from 'os-code/protocol';
import type { PackSeat } from '../drivers/types.js';
import { VAULT_SETTINGS_AGENT_DENY } from './vaultCopy.js';

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
  /** The note's text at `baseVersion` (append only, and only when the note
   *  was not hidden), so the exact bytes an approval writes are known before
   *  the card (Vault M7, CTO L9). */
  baseText?: string;
  /** The exact text an approved append writes, provenance lines included,
   *  computed before the card; the write lands it only while the note is
   *  still `baseVersion` (compare and swap), else nothing. */
  final?: string;
  /** The card's line naming the property change this write also makes. */
  records?: string;
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
  /** Optional: resolve a bare note name or an alias to a path the way a
   *  [[wikilink]] would (the index's resolver). Absent, only exact paths
   *  read and a miss offers search suggestions. */
  resolve?: (name: string) => Promise<string | undefined>;
  /** The vault's `agent.folder` (Vault M7, CTO L2): a proposal outside it is
   *  refused. Absent: anywhere in the vault. */
  agentFolder?: string;
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

/** A tool's description; `vaultPropose` names the agent folder when the
 *  vault's settings set one (CTO L2). */
export function vaultToolDescription(name: AppVaultToolName, agentFolder?: string): string {
  const base = VAULT_TOOL_TEXT[name];
  const folder = agentFolder ? cleanFolder(agentFolder) : undefined;
  if (name !== 'vaultPropose' || !folder) return base;
  return `${base} This vault's settings let you write only inside the folder "${folder}/", so propose paths there.`;
}

/** A tool as offered to an Anthropic model. */
export function vaultAnthropicTool(
  name: AppVaultToolName,
  agentFolder?: string,
): {
  name: AppVaultToolName;
  description: string;
  input_schema: { type: 'object' } & Record<string, unknown>;
} {
  return {
    name,
    description: vaultToolDescription(name, agentFolder),
    input_schema: SCHEMAS[name] as { type: 'object' } & Record<string, unknown>,
  };
}

/** The same tool in OpenAI / BYOM function-calling shape. */
export function vaultOpenAiTool(
  name: AppVaultToolName,
  agentFolder?: string,
): {
  type: 'function';
  function: { name: AppVaultToolName; description: string; parameters: Record<string, unknown> };
} {
  return {
    type: 'function',
    function: {
      name,
      description: vaultToolDescription(name, agentFolder),
      parameters: SCHEMAS[name],
    },
  };
}

/** Whether a tool name is one of the app's vault tools. */
export function isAppVaultToolName(name: string): name is AppVaultToolName {
  return (APP_VAULT_TOOL_NAMES as readonly string[]).includes(name);
}

// A representative size per class, so a class alone yields its policy through
// the engine's own `deriveProfile` (one table, never a copy of it).
const CLASS_PARAMS_B: Record<Exclude<ModelClass, 'large'>, number> = {
  tiny: 1,
  small: 4,
  mid: 16,
};

/** The vault half of a class's policy: how much one read returns and whether
 *  the two read tools fold into `vaultLookup`. The engine's table, read
 *  through `deriveProfile`. */
export function vaultPolicyFor(modelClass: ModelClass): {
  readCapChars: number;
  mergedVaultTool: boolean;
} {
  const p =
    modelClass === 'large'
      ? deriveProfile({ model: 'cloud', kind: 'cloud' })
      : deriveProfile({ model: modelClass, kind: 'local', paramsB: CLASS_PARAMS_B[modelClass] });
  return { readCapChars: p.vaultReadCapChars, mergedVaultTool: p.mergedVaultTool };
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
  if (o.kind === 'device' || o.currentBench || o.playStep || o.teamVault) return [];
  return o.mergedVaultTool
    ? ['vaultLookup', 'vaultPropose']
    : ['vaultSearch', 'vaultRead', 'vaultPropose'];
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Parse a tool call's arguments, or null when malformed. */
export function parseVaultToolArgs(
  name: string,
  argString: string | undefined,
): VaultToolInput | null {
  let raw: unknown;
  try {
    raw = argString && argString.trim() ? JSON.parse(argString) : {};
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return vaultToolInputFrom(name, raw as Record<string, unknown>);
}

/** The same check over an already-parsed input (Anthropic's tool_use input). */
export function vaultToolInputFrom(
  name: string,
  o: Record<string, unknown> | null | undefined,
): VaultToolInput | null {
  if (!o || typeof o !== 'object') return null;
  const section = str(o.section)?.trim() || undefined;
  switch (name) {
    case 'vaultSearch': {
      const query = str(o.query)?.trim();
      return query ? { name, input: { query } } : null;
    }
    case 'vaultRead': {
      const path = str(o.path)?.trim();
      return path ? { name, input: { path, ...(section ? { section } : {}) } } : null;
    }
    case 'vaultLookup': {
      const query = str(o.query)?.trim() || undefined;
      const path = str(o.path)?.trim() || undefined;
      if (Boolean(query) === Boolean(path)) return null;
      return {
        name,
        input: query ? { query } : { path, ...(section ? { section } : {}) },
      };
    }
    case 'vaultPropose': {
      const path = str(o.path)?.trim();
      const text = str(o.text);
      const mode = o.mode;
      if (!path || text === undefined || !text.trim()) return null;
      if (mode !== 'create' && mode !== 'append') return null;
      return { name, input: { path, text, mode } };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Privacy

type Showing = 'absent' | 'withheld' | 'shown' | 'shown-local';

/** A note's tags and marks from its own text, the way the index builds them. */
function knownFromText(text: string): { tags: string[]; oscode: OscodeMark[] } {
  const fm = readFrontmatter(text);
  const scan = scanNote(text);
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const t of [...fm.tags, ...scan.tags.map((x) => x.tag)]) {
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    tags.push(t);
  }
  return { tags, oscode: oscodeMarks(fm) };
}

function visibilityOf(ctx: VaultToolContext, path: string, text?: string): VaultVisibility {
  const known = text !== undefined ? knownFromText(text) : undefined;
  return ctx.privacy.visibility({
    path,
    ...(known ? { tags: known.tags, oscode: known.oscode } : {}),
  });
}

function showing(ctx: VaultToolContext, vis: VaultVisibility): Showing {
  if (vis === 'hidden') return 'absent';
  if (vis === 'local-only') return ctx.seat.leavesNetwork ? 'withheld' : 'shown-local';
  return 'shown';
}

/** What a local-only note says to a seat that leaves this network. */
function stayHere(path: string): string {
  return `${path} is a note that stays on this computer. This model's requests leave this network, so its text is not sent here. A local model can read it.`;
}

function flag(content: string, local: boolean): VaultToolResult {
  return local ? { content, localOnly: true } : { content };
}

// ---------------------------------------------------------------------------
// Paths

/** A folder setting in its plain spelling: `/` separated, no empty, `.` or
 *  surrounding slash segments. */
function cleanFolder(folder: string): string {
  return folder
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.')
    .join('/');
}

/** Whether a typed or resolved path names the settings folder (any case,
 *  any segment), so the refusal can say why in the person's words. */
function namesSettingsFolder(path: string): boolean {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .some((seg) => seg.trim().normalize('NFC').toLowerCase() === '.oscode');
}

/** Why a model may not write at this path, or undefined when it may (CTO
 *  L2, L8): anything under `.oscode/` (or any dot folder, or a rooted or
 *  empty path) is refused with the tool card's reason, and a path outside
 *  the vault's agent folder is refused by name. */
export function vaultAgentWriteRefusal(path: string, agentFolder?: string): string | undefined {
  if (namesSettingsFolder(path)) return VAULT_SETTINGS_AGENT_DENY;
  if (!isAgentWritablePath(path)) {
    return 'Note paths cannot start with a slash or name a dot folder. Propose a plain path inside the vault.';
  }
  const folder = agentFolder ? cleanFolder(agentFolder) : '';
  if (folder) {
    const want = `${foldPath(folder)}/`;
    const got = foldPath(cleanFolder(path));
    if (!got.startsWith(want)) {
      return `This vault's settings let a model write only inside "${folder}/", so ${path} was not proposed. Propose a path inside that folder.`;
    }
  }
  return undefined;
}

/** The approve step's check (CTO L8), run again right before each approved
 *  write: on the proposal's path and, when the storage can say where the
 *  write would really land (a symlink, a case fold), on that path too. A
 *  refusal writes nothing for that proposal. */
export function vaultApproveRefusal(
  proposal: Pick<VaultProposal, 'path'>,
  opts: { realPath?: string; agentFolder?: string } = {},
): string | undefined {
  return (
    vaultAgentWriteRefusal(proposal.path, opts.agentFolder) ??
    (opts.realPath !== undefined
      ? vaultAgentWriteRefusal(opts.realPath, opts.agentFolder)
      : undefined)
  );
}

/** A typed note name in its plain spelling: trimmed, separators collapsed,
 *  .md appended when absent. Throws a plain error for a dot-led segment. */
function plainNotePath(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/');
  if (!cleaned) throw new Error('Give the note a name.');
  const rel = /\.md$/i.test(cleaned) ? cleaned : `${cleaned}.md`;
  if (!isNotePath(rel)) {
    const use = normalizeNotePath(rel);
    throw new Error(
      `Note names cannot start with a dot; the vault and Obsidian hide them.${use ? ` Use "${use}".` : ''}`,
    );
  }
  return rel;
}

/** Split "Note#Heading" into the note and the part. */
function splitSubpath(raw: string): { target: string; sub?: string } {
  const hash = raw.indexOf('#');
  if (hash <= 0) return { target: raw };
  const sub = raw.slice(hash + 1).trim();
  return { target: raw.slice(0, hash), ...(sub ? { sub } : {}) };
}

function stripMd(s: string): string {
  return s.replace(/\.md$/i, '');
}

function capText(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return `${text.slice(0, cap)}\n[cut at ${cap} characters of ${text.length}]`;
}

// ---------------------------------------------------------------------------
// Search

/** Search results one call returns at most. */
export const APP_VAULT_SEARCH_K = 8;
/** Proposals one send may queue at most. */
export const VAULT_PROPOSALS_MAX = 10;
/** The largest proposed text, in characters. */
export const VAULT_PROPOSAL_MAX_CHARS = 200_000;

/** The search hits this seat may see, each judged by its own text. */
async function visibleHits(
  ctx: VaultToolContext,
  query: string,
  k: number,
): Promise<{ rows: Array<{ path: string; heading?: string; snippet: string }>; local: boolean }> {
  const hits = await ctx.search(query);
  const rows: Array<{ path: string; heading?: string; snippet: string }> = [];
  let local = false;
  for (const hit of hits) {
    if (rows.length >= k) break;
    if (showing(ctx, visibilityOf(ctx, hit.path)) === 'absent') continue;
    // The note's own text has the last word (a tag or a mark the path cannot
    // show); a note that cannot be read is left out rather than guessed at.
    const got = await ctx.read(hit.path).catch(() => undefined);
    if (!got) continue;
    const s = showing(ctx, visibilityOf(ctx, hit.path, got.text));
    if (s === 'absent' || s === 'withheld') continue;
    if (s === 'shown-local') local = true;
    rows.push(hit);
  }
  return { rows, local };
}

async function runSearch(ctx: VaultToolContext, query: string): Promise<VaultToolResult> {
  const { rows, local } = await visibleHits(ctx, query, APP_VAULT_SEARCH_K);
  if (!rows.length) {
    return { content: `No notes match "${query}". Try other words.` };
  }
  const lines = rows.map((r, i) => {
    const head = `${i + 1}. ${r.path}${r.heading ? ` > ${r.heading}` : ''}`;
    return r.snippet ? `${head}\n   ${r.snippet}` : head;
  });
  const head = `${rows.length} note${rows.length === 1 ? '' : 's'} match "${query}", best first:`;
  const tail =
    'Read one by its path (add section to read only the part that matters), and follow its links from the header.';
  return flag([head, ...lines, tail].join('\n'), local);
}

// ---------------------------------------------------------------------------
// Read

function outlineOf(headings: ReturnType<typeof scanNote>['headings'], maxChars: number): string {
  const lines: string[] = [];
  let used = 0;
  for (const h of headings) {
    const line = `${'  '.repeat(Math.max(0, h.level - 1))}${'#'.repeat(h.level)} ${h.text}`;
    if (used + line.length + 1 > maxChars) {
      lines.push(`... and ${headings.length - lines.length} more headings`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

function fold(s: string): string {
  return s.normalize('NFC').toLowerCase().trim();
}

/** One part of a note: `^id` for a block, else a heading down to the next
 *  one at its level or above. */
function sectionOf(
  text: string,
  scan: ReturnType<typeof scanNote>,
  section: string,
): { label: string; body: string } | undefined {
  const lines = text.split('\n');
  const want = section.trim();
  if (want.startsWith('^')) {
    const id = want.slice(1).toLowerCase();
    const block = scan.blockIds.find((b) => b.id.toLowerCase() === id);
    if (!block) return undefined;
    let from = block.line;
    while (from > 0 && lines[from - 1]!.trim() !== '' && !/^#{1,6}\s/.test(lines[from]!)) from--;
    return { label: `^${block.id}`, body: lines.slice(from, block.line + 1).join('\n') };
  }
  const folded = fold(want.replace(/^#+\s*/, ''));
  if (!folded) return undefined;
  const heading =
    scan.headings.find((h) => fold(h.text) === folded) ??
    scan.headings.find((h) => fold(h.text).includes(folded));
  if (!heading) return undefined;
  const next = scan.headings.find((h) => h.line > heading.line && h.level <= heading.level);
  const end = next ? next.line : lines.length;
  return { label: heading.text, body: lines.slice(heading.line, end).join('\n').trimEnd() };
}

/** The header a read opens with: the path, its size, its properties, its
 *  tags, and the links it makes (as written; read a target by its name). */
function headerOf(path: string, text: string, scan: ReturnType<typeof scanNote>): string {
  const fm = readFrontmatter(text);
  const bytes = new TextEncoder().encode(text).length;
  const lines = [`Note: ${path} (about ${Math.ceil(bytes / 4)} tokens, ${bytes} bytes)`];
  if (fm.keys.length) lines.push(`Properties: ${fm.keys.join(', ')}`);
  const { tags } = knownFromText(text);
  if (tags.length) lines.push(`Tags: ${tags.map((t) => `#${t}`).join(', ')}`);
  const named: string[] = [];
  for (const l of [...scan.links, ...fm.links]) {
    if (l.attachment || !l.target || named.includes(l.target)) continue;
    named.push(l.target);
    if (named.length >= 30) break;
  }
  if (named.length) lines.push(`Links: ${named.map((t) => `[[${t}]]`).join('; ')}`);
  return lines.join('\n');
}

async function runRead(
  ctx: VaultToolContext,
  rawPath: string,
  section?: string,
): Promise<VaultToolResult> {
  let target = rawPath;
  let part = section?.trim() || undefined;
  const split = splitSubpath(rawPath);
  if (split.sub !== undefined) {
    target = split.target;
    part ??= split.sub;
  }
  let rel: string;
  try {
    rel = plainNotePath(target);
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
  const absent = (p: string): VaultToolResult => ({ content: `No vault note at ${p} yet.` });
  let got =
    visibilityOf(ctx, rel) === 'hidden' ? undefined : await ctx.read(rel).catch(() => undefined);
  if (!got && ctx.resolve) {
    const hit = await ctx.resolve(stripMd(target.trim())).catch(() => undefined);
    if (hit && hit !== rel && visibilityOf(ctx, hit) !== 'hidden') {
      rel = hit;
      got = await ctx.read(hit).catch(() => undefined);
    }
  }
  if (!got) {
    const { rows } = await visibleHits(ctx, stripMd(target), 3).catch(() => ({ rows: [] }));
    const tail = rows.length
      ? ` Closest by search: ${rows.map((r) => `"${r.path}"`).join(', ')}.`
      : '';
    return { content: `No vault note at ${rel} yet.${tail}` };
  }
  const show = showing(ctx, visibilityOf(ctx, rel, got.text));
  if (show === 'absent') return absent(rel);
  if (show === 'withheld') return { content: stayHere(rel) };
  const local = show === 'shown-local';
  const text = got.text;
  const scan = scanNote(text);
  const header = headerOf(rel, text, scan);
  const cap = ctx.readCapChars > 0 ? ctx.readCapChars : 24_000;
  if (part !== undefined) {
    const found = sectionOf(text, scan, part);
    if (!found) {
      const outline = outlineOf(scan.headings, cap);
      return flag(
        `${header}\nNo section "${part}" in ${rel}.${outline ? ` Its outline:\n${outline}` : ' It has no headings.'}`,
        local,
      );
    }
    return flag(`${header}\nSection: ${found.label}\n---\n${capText(found.body, cap)}`, local);
  }
  if (text.length > cap && scan.headings.length > 0) {
    return flag(
      `${header}\nThis note is ${text.length} characters, more than this model reads at once (${cap}). Its outline:\n${outlineOf(scan.headings, cap)}\nRead one part with section set to a heading's text (or "^id" for a block).`,
      local,
    );
  }
  return flag(`${header}\n---\n${capText(text, cap)}`, local);
}

// ---------------------------------------------------------------------------
// Propose

async function runPropose(
  ctx: VaultToolContext,
  input: VaultProposeInput,
): Promise<VaultToolResult> {
  // The settings folder first, in the person's words, before the note-name
  // rule below would call it a dot name.
  if (namesSettingsFolder(input.path)) {
    return { content: VAULT_SETTINGS_AGENT_DENY, isError: true };
  }
  let rel: string;
  try {
    rel = plainNotePath(input.path);
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
  const refused = vaultAgentWriteRefusal(rel, ctx.agentFolder);
  if (refused) return { content: refused, isError: true };
  if (input.text.length > VAULT_PROPOSAL_MAX_CHARS) {
    return {
      content: `That text is ${input.text.length} characters, more than one proposal takes (${VAULT_PROPOSAL_MAX_CHARS}). Propose a shorter note.`,
      isError: true,
    };
  }
  // A hidden note is never looked at: its presence or absence is not the
  // model's to learn. The approve step's guard settles it either way.
  const hidden = visibilityOf(ctx, rel) === 'hidden';
  let baseVersion: string | undefined;
  let baseText: string | undefined;
  if (!hidden) {
    const cur = await ctx.read(rel).catch(() => undefined);
    const curHidden = cur !== undefined && visibilityOf(ctx, rel, cur.text) === 'hidden';
    if (input.mode === 'create' && cur && !curHidden) {
      return {
        content: `A note already exists at ${rel}. Propose mode "append" to add to it, or pick another path.`,
        isError: true,
      };
    }
    if (input.mode === 'append') {
      if (!cur) {
        return {
          content: `No vault note at ${rel} to append to. Propose mode "create" to start it.`,
          isError: true,
        };
      }
      baseVersion = cur.version;
      baseText = cur.text;
    }
  }
  ctx.propose({
    path: rel,
    text: input.text,
    mode: input.mode,
    ...(baseVersion ? { baseVersion } : {}),
    ...(baseText !== undefined ? { baseText } : {}),
  });
  const what = input.mode === 'create' ? `create ${rel}` : `append to ${rel}`;
  return {
    content: `Queued for the person to approve: ${what}. Nothing is written yet. Every proposed write is shown on one card at the end of your reply, and they approve or decline them together.`,
  };
}

/** Run one call. Hidden notes are absent; a local-only note on a leaving
 *  seat says it stays on this computer; `vaultPropose` answers "queued for
 *  the person to approve" and writes nothing. Never rejects: a failure is an
 *  error result the model can read. */
export async function runVaultTool(
  call: VaultToolInput,
  ctx: VaultToolContext,
): Promise<VaultToolResult> {
  try {
    switch (call.name) {
      case 'vaultSearch':
        return await runSearch(ctx, call.input.query);
      case 'vaultRead':
        return await runRead(ctx, call.input.path, call.input.section);
      case 'vaultLookup':
        if (call.input.query) return await runSearch(ctx, call.input.query);
        if (call.input.path) return await runRead(ctx, call.input.path, call.input.section);
        return { content: 'Give exactly one of query or path.', isError: true };
      case 'vaultPropose':
        return await runPropose(ctx, call.input);
    }
  } catch (err) {
    return {
      content: `The vault could not answer that (${err instanceof Error ? err.message : String(err)}).`,
      isError: true,
    };
  }
}

/** The line a malformed call gets back, so the model can retry. */
export function vaultArgsHelp(name: string): string {
  switch (name) {
    case 'vaultSearch':
      return 'Those arguments could not be read. Call vaultSearch with JSON like {"query":"auth decision"}.';
    case 'vaultRead':
      return 'Those arguments could not be read. Call vaultRead with JSON like {"path":"Decisions/Auth.md"}.';
    case 'vaultLookup':
      return 'Those arguments could not be read. Call vaultLookup with exactly one of {"query":"..."} or {"path":"..."}.';
    case 'vaultPropose':
      return 'Those arguments could not be read. Call vaultPropose with JSON like {"path":"Notes/Idea.md","text":"...","mode":"create"}.';
    default:
      return `Unknown tool ${name}.`;
  }
}
