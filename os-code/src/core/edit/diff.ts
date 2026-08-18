// A small, dependency-free unified-diff generator for approval prompts and
// transcripts. Line-based LCS with prefix/suffix trimming; big enough for
// real files, honest when a file is too large to diff nicely.

export interface DiffStats {
  additions: number;
  deletions: number;
}

export function unifiedDiff(
  before: string,
  after: string,
  label: string,
  context = 3,
): { text: string; stats: DiffStats } {
  const a = before.split('\n');
  const b = after.split('\n');

  // Trim common prefix and suffix so the LCS works on the changed middle.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  // Guard against quadratic blowup on generated or minified files.
  const TOO_BIG = 4000;
  let ops: Array<{ tag: 'eq' | 'del' | 'add'; line: string }>;
  if (midA.length * midB.length > TOO_BIG * TOO_BIG) {
    ops = [...midA.map((line) => ({ tag: 'del' as const, line })), ...midB.map((line) => ({ tag: 'add' as const, line }))];
  } else {
    ops = lcsOps(midA, midB);
  }

  const full: Array<{ tag: 'eq' | 'del' | 'add'; line: string }> = [
    ...a.slice(0, start).map((line) => ({ tag: 'eq' as const, line })),
    ...ops,
    ...a.slice(endA).map((line) => ({ tag: 'eq' as const, line })),
  ];

  const stats: DiffStats = {
    additions: full.filter((o) => o.tag === 'add').length,
    deletions: full.filter((o) => o.tag === 'del').length,
  };

  if (stats.additions === 0 && stats.deletions === 0) {
    return { text: '', stats };
  }

  // Build hunks with context.
  const lines: string[] = [`--- a/${label}`, `+++ b/${label}`];
  let i = 0;
  let oldLine = 1;
  let newLine = 1;
  while (i < full.length) {
    if (full[i]!.tag === 'eq') {
      oldLine++;
      newLine++;
      i++;
      continue;
    }
    // Found a change; open a hunk with leading context.
    const hunkStart = Math.max(0, i - context);
    let leadEq = 0;
    for (let j = hunkStart; j < i; j++) if (full[j]!.tag === 'eq') leadEq++;
    let oldStart = oldLine - leadEq;
    let newStart = newLine - leadEq;
    const body: string[] = [];
    for (let j = hunkStart; j < i; j++) body.push(` ${full[j]!.line}`);

    let eqRun = 0;
    let oldCount = leadEq;
    let newCount = leadEq;
    while (i < full.length && eqRun <= context * 2) {
      const op = full[i]!;
      if (op.tag === 'eq') {
        eqRun++;
        body.push(` ${op.line}`);
        oldCount++;
        newCount++;
        oldLine++;
        newLine++;
      } else {
        // Trim any over-collected trailing context back into the stream.
        eqRun = 0;
        if (op.tag === 'del') {
          body.push(`-${op.line}`);
          oldCount++;
          oldLine++;
        } else {
          body.push(`+${op.line}`);
          newCount++;
          newLine++;
        }
      }
      i++;
    }
    // Drop surplus trailing equal lines beyond `context`.
    let surplus = eqRun - context;
    while (surplus > 0 && body.length && body[body.length - 1]!.startsWith(' ')) {
      body.pop();
      surplus--;
      oldCount--;
      newCount--;
      i--; // hand the equal line back for the next hunk scan
      oldLine--;
      newLine--;
    }
    if (oldStart < 1) oldStart = 1;
    if (newStart < 1) newStart = 1;
    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    lines.push(...body);
  }

  return { text: lines.join('\n'), stats };
}

function lcsOps(a: string[], b: string[]): Array<{ tag: 'eq' | 'del' | 'add'; line: string }> {
  const n = a.length;
  const m = b.length;
  // DP table of LCS lengths.
  const dp: Uint32Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: Array<{ tag: 'eq' | 'del' | 'add'; line: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ tag: 'eq', line: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ tag: 'del', line: a[i]! });
      i++;
    } else {
      ops.push({ tag: 'add', line: b[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ tag: 'del', line: a[i++]! });
  while (j < m) ops.push({ tag: 'add', line: b[j++]! });
  return ops;
}
