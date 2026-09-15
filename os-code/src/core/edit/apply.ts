// Applying edit blocks. The failure hierarchy is deliberate:
//   1. exact match, unique          -> apply
//   2. whitespace-tolerant, unique  -> apply (indentation preserved from file)
//   3. context-anchored fuzzy       -> apply only when the anchors are unique
//   anything ambiguous              -> REJECT with a precise reason
// A tolerant matcher that lands a hunk in the wrong place is silent
// corruption, so ambiguity is always an error, never a guess.
import type { EditBlock } from './searchReplace.js';

export type MatchStrategy =
  'exact' | 'trimmed' | 'normalized' | 'anchored' | 'fragment' | 'flattened';

export interface AppliedBlock {
  index: number;
  strategy: MatchStrategy;
  /** Line numbers in the ORIGINAL content, 1-based inclusive. */
  startLine: number;
  endLine: number;
}

export interface ApplyFailure {
  index: number;
  reason: string;
}

export interface ApplyResult {
  ok: boolean;
  content: string;
  applied: AppliedBlock[];
  failures: ApplyFailure[];
}

export function applyEditBlocks(original: string, blocks: EditBlock[]): ApplyResult {
  let content = original;
  const applied: AppliedBlock[] = [];
  const failures: ApplyFailure[] = [];

  blocks.forEach((block, index) => {
    const found = locate(content, block.search);
    if ('reason' in found) {
      failures.push({ index, reason: found.reason });
      return;
    }
    const lines = content.split('\n');
    const before = lines.slice(0, found.start);
    const after = lines.slice(found.end + 1);
    const replacement =
      found.strategy === 'fragment'
        ? [
            lines[found.start]!.slice(0, found.fragmentStart) +
              block.replace +
              lines[found.start]!.slice(found.fragmentEnd),
          ]
        : block.replace === ''
          ? []
          : block.replace.split('\n');
    content = [...before, ...replacement, ...after].join('\n');
    applied.push({
      index,
      strategy: found.strategy,
      startLine: found.start + 1,
      endLine: found.end + 1,
    });
  });

  return { ok: failures.length === 0 && applied.length > 0, content, applied, failures };
}

type Located =
  | { start: number; end: number; strategy: Exclude<MatchStrategy, 'fragment'> }
  | { start: number; end: number; strategy: 'fragment'; fragmentStart: number; fragmentEnd: number }
  | { reason: string };

function locate(content: string, search: string): Located {
  if (search.trim() === '') {
    return { reason: 'The SEARCH side is empty. Copy the exact lines to change from the file.' };
  }
  const contentLines = content.split('\n');
  const searchLines = search.split('\n');
  // Drop pure-blank leading/trailing lines the model tends to add.
  while (searchLines.length && searchLines[0]!.trim() === '') searchLines.shift();
  while (searchLines.length && searchLines[searchLines.length - 1]!.trim() === '')
    searchLines.pop();
  if (!searchLines.length) {
    return { reason: 'The SEARCH side contained only blank lines.' };
  }
  // Lines copied straight out of a readFile result carry its "12| " line
  // number prefix. When every line has one, the model copied the numbered
  // view; the prefix is not part of the file, so it is dropped before any
  // matching. A single numbered line among plain ones is left alone.
  const numbered = /^\s*\d+\|\s?/;
  if (searchLines.every((l) => numbered.test(l))) {
    for (let i = 0; i < searchLines.length; i++) {
      searchLines[i] = searchLines[i]!.replace(numbered, '');
    }
  }

  // Strategy 1: exact line-run match.
  const exact = findRuns(contentLines, searchLines, (a, b) => a === b);
  if (exact.length === 1) {
    return { start: exact[0]!, end: exact[0]! + searchLines.length - 1, strategy: 'exact' };
  }
  if (exact.length > 1) {
    return {
      reason: `The SEARCH text appears ${exact.length} times (lines ${exact.map((i) => i + 1).join(', ')}). Add 2 or 3 surrounding lines so the location is unique.`,
    };
  }

  // Strategy 2: whitespace-tolerant match (compare trimmed lines).
  const trimmed = findRuns(contentLines, searchLines, (a, b) => a.trim() === b.trim());
  if (trimmed.length === 1) {
    return { start: trimmed[0]!, end: trimmed[0]! + searchLines.length - 1, strategy: 'trimmed' };
  }
  if (trimmed.length > 1) {
    return {
      reason: `The SEARCH text matches ${trimmed.length} places once indentation is ignored. Add surrounding lines to pin down which one.`,
    };
  }

  // Strategy 3: spelling-tolerant match. A small model transcribing a line
  // into a JSON string most often gets the quote style wrong (a backtick or a
  // double quote for a single quote) or the spacing, and nothing else. Compare
  // lines with whitespace runs collapsed and all three quote characters made
  // one, and still require the run to be unique, so the location is certain
  // even though the spelling was not.
  const normalized = findRuns(contentLines, searchLines, (a, b) => norm(a) === norm(b));
  if (normalized.length === 1) {
    return {
      start: normalized[0]!,
      end: normalized[0]! + searchLines.length - 1,
      strategy: 'normalized',
    };
  }
  if (normalized.length > 1) {
    return {
      reason: `The SEARCH text matches ${normalized.length} places once quote style and spacing are ignored. Add surrounding lines to pin down which one.`,
    };
  }

  // Strategy 4: anchor on the surrounding context, never on the changed text
  // alone. First and last lines of the SEARCH act as anchors (compared
  // spelling-tolerantly); the middle may drift. When exactly ONE place in the
  // file carries both anchors at the right distance, the location is pinned by
  // two independent lines and the edit applies however badly the middle was
  // transcribed: the REPLACE side overwrites that region regardless, the diff
  // shows exactly what changed, and verify runs after. When several places
  // carry both anchors, the middle has to earn it (high similarity, unique),
  // and otherwise it is ambiguity, which is always an error, never a guess.
  if (searchLines.length >= 3) {
    const firstAnchor = norm(searchLines[0]!);
    const lastAnchor = norm(searchLines[searchLines.length - 1]!);
    const candidates: Array<{ start: number; end: number; score: number }> = [];
    for (let i = 0; i < contentLines.length; i++) {
      if (norm(contentLines[i]!) !== firstAnchor) continue;
      const expectedEnd = i + searchLines.length - 1;
      for (
        let end = Math.max(i + 1, expectedEnd - 2);
        end <= expectedEnd + 2 && end < contentLines.length;
        end++
      ) {
        if (norm(contentLines[end]!) !== lastAnchor) continue;
        const score = middleSimilarity(contentLines.slice(i + 1, end), searchLines.slice(1, -1));
        candidates.push({ start: i, end, score });
      }
    }
    if (candidates.length === 1) {
      return { start: candidates[0]!.start, end: candidates[0]!.end, strategy: 'anchored' };
    }
    if (candidates.length > 1) {
      const strong = candidates.filter((c) => c.score >= 0.8);
      if (strong.length === 1) {
        return { start: strong[0]!.start, end: strong[0]!.end, strategy: 'anchored' };
      }
      return {
        reason: `The context anchors match ${candidates.length} places. Include more unique surrounding lines.`,
      };
    }
  }

  // Strategy 5: a single-line fragment rather than a whole line. A model
  // sometimes copies only the part it means to change ("function oldName("
  // instead of the full "export function oldName(name) {"), which none of
  // the whole-line strategies above can match. When that exact text occurs
  // in exactly one place in the whole file, once, the location is just as
  // certain as a whole-line match, so splice only that fragment and leave
  // the rest of the line untouched rather than demanding a full line. A
  // minimum length keeps a stray "{" or ")" from matching by accident.
  if (searchLines.length === 1) {
    const needle = searchLines[0]!.trim();
    if (needle.length >= 6) {
      const hits: Array<{ line: number; col: number }> = [];
      let ambiguous = false;
      for (let i = 0; i < contentLines.length; i++) {
        const line = contentLines[i]!;
        const first = line.indexOf(needle);
        if (first === -1) continue;
        if (line.indexOf(needle, first + 1) !== -1) {
          ambiguous = true;
          break;
        }
        hits.push({ line: i, col: first });
      }
      if (!ambiguous && hits.length === 1) {
        return {
          start: hits[0]!.line,
          end: hits[0]!.line,
          strategy: 'fragment',
          fragmentStart: hits[0]!.col,
          fragmentEnd: hits[0]!.col + needle.length,
        };
      }
      if (ambiguous || hits.length > 1) {
        return {
          reason: `"${needle}" appears more than once in the file. Include more of the line, or the whole line, so the location is unique.`,
        };
      }
    }
  }

  // Strategy 6: the model squished a multi-line block onto one line (or a
  // different number of lines than the file has), so no line-by-line strategy
  // above can ever line up, however tolerant it is of spelling. Flatten both
  // sides the same way, normalized line by line then joined by a single
  // space standing in for the line break, and look for the SEARCH as a unique
  // substring of the whole file's flattened form. A match found this way
  // still pins an exact line range (the substring's start and end map back to
  // real line numbers), so it is spliced as a normal whole-line swap, not a
  // fragment. The minimum length is higher than a same-line fragment's
  // because the haystack is now the whole file, not one line.
  const flatNeedle = searchLines.map(norm).join(' ');
  if (flatNeedle.length >= 20) {
    const { flat, lineStarts } = flattenLines(contentLines);
    const hits: number[] = [];
    for (let at = flat.indexOf(flatNeedle); at !== -1; at = flat.indexOf(flatNeedle, at + 1)) {
      hits.push(at);
    }
    if (hits.length === 1) {
      return {
        start: lineAt(lineStarts, hits[0]!),
        end: lineAt(lineStarts, hits[0]! + flatNeedle.length - 1),
        strategy: 'flattened',
      };
    }
    if (hits.length > 1) {
      return {
        reason: `The SEARCH text (once line breaks and spacing are ignored) matches ${hits.length} places. Add more unique surrounding lines.`,
      };
    }
  }

  // Nothing matched: name the closest line so the model can self-correct.
  const hint = closestLineHint(contentLines, searchLines[0]!);
  return {
    reason: `The SEARCH text was not found in the file.${hint} Re-read the file and copy the lines exactly.`,
  };
}

/** Spelling-tolerant form of a line: trimmed, whitespace runs collapsed, and
 *  the three quote characters made one. Location decisions still require a
 *  unique match, so this forgives how a line was spelled, never where it is. */
function norm(line: string): string {
  return line.trim().replace(/\s+/g, ' ').replace(/[`'"]/g, '"');
}

/** The whole file as one normalized string, each line trimmed and
 *  whitespace-collapsed then joined by a single space in place of the real
 *  line break, plus where each original line begins in that string, so a
 *  match found in the flattened form can be mapped back to real line numbers. */
function flattenLines(lines: string[]): { flat: string; lineStarts: number[] } {
  let flat = '';
  const lineStarts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    lineStarts.push(flat.length);
    flat += norm(lines[i]!);
    if (i < lines.length - 1) flat += ' ';
  }
  return { flat, lineStarts };
}

/** The original line index containing flattened-string offset `pos`. */
function lineAt(lineStarts: number[], pos: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid]! <= pos) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function findRuns(
  content: string[],
  search: string[],
  eq: (a: string, b: string) => boolean,
): number[] {
  const hits: number[] = [];
  outer: for (let i = 0; i + search.length <= content.length; i++) {
    for (let j = 0; j < search.length; j++) {
      if (!eq(content[i + j]!, search[j]!)) continue outer;
    }
    hits.push(i);
  }
  return hits;
}

function middleSimilarity(contentMid: string[], searchMid: string[]): number {
  if (searchMid.length === 0 && contentMid.length === 0) return 1;
  if (searchMid.length === 0 || contentMid.length === 0) {
    return Math.max(searchMid.length, contentMid.length) <= 1 ? 0.85 : 0;
  }
  const a = contentMid.map((l) => l.trim());
  const b = searchMid.map((l) => l.trim());
  let total = 0;
  const used = new Set<number>();
  for (const line of b) {
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < a.length; i++) {
      if (used.has(i)) continue;
      const score = lineSimilarity(a[i]!, line);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx !== -1 && bestScore >= 0.75) {
      used.add(bestIdx);
      total += bestScore;
    }
  }
  return total / Math.max(a.length, b.length);
}

/** Cheap per-line similarity: 1 - editDistance / maxLen, on trimmed lines. */
function lineSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  if (maxLen > 400) return a === b ? 1 : 0; // do not DP on generated monsters
  const dp = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) dp[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return 1 - dp[b.length]! / maxLen;
}

function closestLineHint(contentLines: string[], firstSearchLine: string): string {
  const needle = firstSearchLine.trim();
  if (!needle) return '';
  const idx = contentLines.findIndex((l) =>
    l.trim().includes(needle.slice(0, Math.min(24, needle.length))),
  );
  return idx === -1
    ? ''
    : ` The closest similar line is line ${idx + 1}: "${contentLines[idx]!.trim().slice(0, 80)}".`;
}
