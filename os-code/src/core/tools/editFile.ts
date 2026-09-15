// The editFile tool: structured search/replace through the edit engine, with
// post-apply verification and a diff for approval. This is the top failure
// mode for local models, so every rejection message teaches the model how to
// fix its next attempt, and the tool accepts the shapes small models actually
// produce instead of insisting on one.
//
// Three ways to say the same change, most forgiving first:
//   1. `search` + `replace` as two plain string fields (one change). A flat
//      pair is the shape a small model gets right; the deep eval's 3B seat
//      never once produced the block mini-language inside a JSON string.
//      Aliases other tools taught models are accepted too (old_string /
//      new_string, old / new, find / replace, from / to).
//   2. `edits` as SEARCH/REPLACE text blocks (several changes at once).
//   3. `edits` as a JSON array of {search, replace} pairs, or that array
//      stringified, which is what a model does when it "JSON-ifies" the blocks.
// All three normalize to the same EditBlock list and go through the same
// exact / whitespace-tolerant / anchored matcher, so nothing gets looser about
// WHERE an edit lands, only about how the model is allowed to ask for it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import type { ToolDef } from './index.js';
import { EDIT_FORMAT_DOC, parseEditBlocks, type EditBlock } from '../edit/searchReplace.js';
import { applyEditBlocks } from '../edit/apply.js';
import { structuralCheck, verifyWritten } from '../edit/verify.js';
import { unifiedDiff } from '../edit/diff.js';
import { parseJsonLoose } from './parser.js';

const pairSchema = z.looseObject({});

const schema = z
  .object({
    path: z.string().describe('File to edit, relative to the workspace root'),
    search: z
      .string()
      .optional()
      .describe(
        'The exact lines to replace, copied verbatim from the file (include 2 or 3 unchanged lines around them). Use together with replace, for one change.',
      ),
    replace: z
      .string()
      .optional()
      .describe('The lines that take the place of search. Use together with search.'),
    edits: z
      .union([z.string(), z.array(pairSchema)])
      .optional()
      .describe(
        'For several changes at once: SEARCH/REPLACE blocks as plain text, or an array of {search, replace} objects. Not needed when search and replace are given.',
      ),
  })
  .loose();

type Args = z.infer<typeof schema>;

const SIMPLE_FORM_DOC =
  'Simplest: give search (the exact lines to replace, copied from the file) and replace (their replacement) for one change.';

const SEARCH_KEYS = ['search', 'old_string', 'old_str', 'old', 'find', 'from', 'before'];
const REPLACE_KEYS = ['replace', 'new_string', 'new_str', 'new', 'to', 'after'];

function firstStringKey(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

/** One {search, replace}-ish object to a block, under any of the accepted key
 *  spellings. Undefined when the object carries no recognizable pair. */
function pairToBlock(obj: Record<string, unknown>): EditBlock | undefined {
  const search = firstStringKey(obj, SEARCH_KEYS);
  const replace = firstStringKey(obj, REPLACE_KEYS);
  if (search === undefined || replace === undefined) return undefined;
  return { search, replace };
}

function blocksFromPairs(value: unknown): EditBlock[] {
  const items = Array.isArray(value) ? value : [value];
  const blocks: EditBlock[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const block = pairToBlock(item as Record<string, unknown>);
    if (block) blocks.push(block);
  }
  return blocks;
}

interface Normalized {
  blocks: EditBlock[];
  problems: string[];
}

/** Turn whatever shape the model sent into edit blocks. */
function normalize(args: Args): Normalized {
  const raw = args as Record<string, unknown>;
  // 1. Flat pair fields, canonical or aliased.
  const pair = pairToBlock(raw);
  if (pair) return { blocks: [pair], problems: [] };

  const edits = raw.edits;
  // 2. Text blocks.
  if (typeof edits === 'string') {
    const parsed = parseEditBlocks(edits);
    if (parsed.blocks.length) return parsed;
    // 3a. The blocks JSON-ified into a string.
    const asJson = parseJsonLoose(edits);
    const fromJson = blocksFromPairs(asJson);
    if (fromJson.length) return { blocks: fromJson, problems: [] };
    return { blocks: [], problems: parsed.problems };
  }
  // 3b. A real array of pairs.
  if (Array.isArray(edits)) return { blocks: blocksFromPairs(edits), problems: [] };
  return { blocks: [], problems: [] };
}

type Plan =
  | { error: string }
  | { error?: undefined; result: import('../edit/apply.js').ApplyResult; warnings: string[] };

// The harness does the mechanical work of retrieval for a small model (tenet
// 3), rather than counting on it to remember to call readFile again after a
// failed SEARCH match. The deep eval showed exactly this gap on a 3B seat: it
// resent an identical, non-matching SEARCH block four times in a row (tripping
// the loop guardrail) instead of re-reading. Echoing the file's own current
// content into the failure gives the very next turn ground truth to copy from,
// with no extra round trip. Bounded so a large file does not blow up a lean
// prompt; past the cap the closest-line hint in the failure reason is what is
// left to go on, same as before this.
const MAX_ECHOED_FILE_CHARS = 4000;

function currentContentsBlock(path: string, content: string): string {
  if (content.length > MAX_ECHOED_FILE_CHARS) {
    return `${path} is too large to show here (${content.length} characters). Call readFile on it before trying again.`;
  }
  return `Current contents of ${path} (copy the exact lines from here):\n\`\`\`\n${content}\n\`\`\``;
}

// Bounds echoing the model's OWN malformed request back to it: the deep
// eval's 3B run hit "No valid edit blocks found" with zero specific parse
// problems, meaning no marker appeared at all, and the old message only
// restated the correct format without showing the model what IT sent, so a
// retry had nothing new to correct against. Same principle as the file echo
// above, applied to the model's own input.
const MAX_ECHOED_EDITS_CHARS = 1500;

function truncateEcho(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}...(truncated)` : s;
}

function whatWasSent(args: Args): string {
  const raw = args as Record<string, unknown>;
  const { path: _path, ...rest } = raw;
  void _path;
  const text =
    typeof rest.edits === 'string' && Object.keys(rest).length === 1
      ? rest.edits
      : JSON.stringify(rest);
  return truncateEcho(text, MAX_ECHOED_EDITS_CHARS);
}

// A block can normalize successfully (a recognizable search/replace pair)
// while still carrying no SEARCH text at all, for instance when a model
// tries to APPEND new code and leaves search blank instead of anchoring on
// an existing line. Routing that through the matcher produced "Your SEARCH
// was:" followed by nothing, useless to a retry. Catching it here shows the
// model what it DID send (its replace text) plus the file to anchor on,
// before ever reaching the generic empty-string message in the matcher.
function emptySearchError(args: Args, before: string, blocks: EditBlock[]): string | undefined {
  const index = blocks.findIndex((b) => b.search.trim() === '');
  if (index === -1) return undefined;
  const block = blocks[index]!;
  const newCode = block.replace.trim();
  // The model almost always meant "add this at the end" (the deep eval's
  // add-a-function task). The harness does the mechanical part: it names the
  // file's last line as the anchor and hands back the exact call to send, built
  // from the model's own replacement text, so the retry is a copy, not a
  // composition. The model still makes the call; nothing is applied here.
  const anchor = before
    .split('\n')
    .filter((l) => l.trim())
    .pop();
  const suggestion =
    anchor !== undefined && newCode
      ? `To add that code at the end of ${args.path}, send editFile again with exactly these two fields:\nsearch: ${JSON.stringify(anchor)}\nreplace: ${JSON.stringify(truncateEcho(`${anchor}\n\n${newCode}`, 1500))}\n(search is the file's last line, copied as is; replace is that same line followed by the new code.) Or use writeFile with the complete new contents of ${args.path}, keeping everything that is already there.`
      : `${SIMPLE_FORM_DOC} To add new code, use an existing line (such as the last line of the file) as search and include both that line and the new code in replace.`;
  return (
    `Block ${index + 1} has no SEARCH text, so there is nothing to locate in the file. ` +
    `search must be one or more exact lines copied from the file, not left blank.\n\n${suggestion}` +
    `\n\n${currentContentsBlock(args.path, before)}`
  );
}

function plan(args: Args, before: string): Plan {
  const { blocks, problems } = normalize(args);
  if (blocks.length === 0) {
    const cause = problems.length
      ? `Problems: ${problems.join(' ')}`
      : 'No change was recognizable in the arguments.';
    return {
      error: `No valid edit found. ${cause}\n\nYou sent:\n${whatWasSent(args)}\n\n${SIMPLE_FORM_DOC}\nFor several changes, ${EDIT_FORMAT_DOC}`,
    };
  }
  const emptySearch = emptySearchError(args, before, blocks);
  if (emptySearch !== undefined) return { error: emptySearch };
  const result = applyEditBlocks(before, blocks);
  if (!result.ok) {
    // Each failure shows the model its own SEARCH beside the real file, so the
    // exact character that differed is visible to it, and to the eval report.
    const reasons = result.failures
      .map(
        (f) =>
          `Block ${f.index + 1}: ${f.reason}\nYour SEARCH was:\n${truncateEcho(blocks[f.index]!.search, 600)}`,
      )
      .join('\n');
    return {
      error: `The edit did not apply.\n${reasons}\n\n${currentContentsBlock(args.path, before)}`,
    };
  }
  return { result, warnings: problems };
}

export const editFileTool: ToolDef<typeof schema> = {
  name: 'editFile',
  description: `Edit part of a file. ${SIMPLE_FORM_DOC} For several changes at once, give edits as SEARCH/REPLACE blocks: ${EDIT_FORMAT_DOC}`,
  schema,
  risk: 'write',
  pathOf: (args) => args.path,
  async preview(args, ctx) {
    const abs = ctx.jail.resolve(args.path);
    if (!existsSync(abs)) return { summary: `Edit ${args.path}`, detail: 'File does not exist.' };
    const before = readFileSync(abs, 'utf8');
    const planned = plan(args, before);
    if (planned.error !== undefined) return { summary: `Edit ${args.path}`, detail: planned.error };
    const { text, stats } = unifiedDiff(before, planned.result.content, args.path);
    return { summary: `Edit ${args.path} (+${stats.additions} -${stats.deletions})`, detail: text };
  },
  async execute(args, ctx) {
    const abs = ctx.jail.resolve(args.path);
    if (!existsSync(abs)) {
      return {
        ok: false,
        content: `No file at ${args.path}. To create a new file use writeFile.`,
      };
    }
    const before = readFileSync(abs, 'utf8');
    const planned = plan(args, before);
    if (planned.error !== undefined) return { ok: false, content: planned.error };

    const after = planned.result.content;
    const structural = structuralCheck(abs, after);
    if (!structural.ok) {
      return {
        ok: false,
        content: `The edit was NOT applied because verification failed: ${structural.detail}`,
      };
    }
    writeFileSync(abs, after);
    const verify = verifyWritten(abs, after);
    if (!verify.ok) return { ok: false, content: verify.detail };

    const { text, stats } = unifiedDiff(before, after, args.path);
    const strategies = planned.result.applied.map((a) => a.strategy);
    const fuzzyNote = strategies.includes('anchored')
      ? ' One block matched by context anchors rather than exactly; the diff shows precisely what changed.'
      : '';
    return {
      ok: true,
      content: `Applied ${planned.result.applied.length} edit${planned.result.applied.length === 1 ? '' : 's'} to ${args.path} (+${stats.additions} -${stats.deletions}).${fuzzyNote}`,
      diffText: text,
    };
  },
};
