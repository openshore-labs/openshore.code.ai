// The code map: a compact tree plus symbol outline the agent gets up front,
// so its first tool call is already aimed at the right file. Regex-based
// symbol extraction per language; tree-sitter can slot in behind the same
// interface later without changing callers.
import { readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { walkFiles } from '../core/tools/walk.js';

interface SymbolRule {
  extensions: string[];
  patterns: RegExp[];
}

const RULES: SymbolRule[] = [
  {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    patterns: [
      /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/,
      /^\s*export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/,
      /^\s*export\s+(?:const|let)\s+([A-Za-z0-9_$]+)/,
      /^\s*export\s+(?:interface|type|enum)\s+([A-Za-z0-9_$]+)/,
      /^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)/,
      /^\s*class\s+([A-Za-z0-9_$]+)/,
    ],
  },
  {
    extensions: ['.py'],
    patterns: [/^\s*def\s+([A-Za-z0-9_]+)/, /^\s*class\s+([A-Za-z0-9_]+)/],
  },
  {
    extensions: ['.go'],
    patterns: [/^func\s+(?:\([^)]*\)\s+)?([A-Za-z0-9_]+)/, /^type\s+([A-Za-z0-9_]+)/],
  },
  {
    extensions: ['.rs'],
    patterns: [/^\s*(?:pub\s+)?fn\s+([A-Za-z0-9_]+)/, /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z0-9_]+)/, /^\s*impl(?:<[^>]*>)?\s+([A-Za-z0-9_]+)/],
  },
  {
    extensions: ['.java', '.kt', '.swift', '.scala'],
    patterns: [/^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:class|interface|enum|object|struct)\s+([A-Za-z0-9_]+)/, /^\s*(?:public|private|protected)?\s*(?:static\s+)?[A-Za-z0-9_<>[\]]+\s+([A-Za-z0-9_]+)\s*\(/],
  },
  {
    extensions: ['.rb'],
    patterns: [/^\s*def\s+([A-Za-z0-9_?!.]+)/, /^\s*(?:class|module)\s+([A-Za-z0-9_:]+)/],
  },
];

function rulesFor(ext: string): SymbolRule | undefined {
  return RULES.find((r) => r.extensions.includes(ext));
}

export function extractSymbols(content: string, ext: string, cap = 24): string[] {
  const rule = rulesFor(ext);
  if (!rule) return [];
  const symbols: string[] = [];
  for (const line of content.split('\n')) {
    for (const pattern of rule.patterns) {
      const m = pattern.exec(line);
      if (m?.[1]) {
        symbols.push(m[1]);
        break;
      }
    }
    if (symbols.length >= cap) break;
  }
  return [...new Set(symbols)];
}

export interface CodeMapOptions {
  maxChars?: number;
  maxFiles?: number;
}

/** Build the code map: a compact file list with symbol outlines. */
export function buildCodeMap(root: string, opts: CodeMapOptions = {}): string {
  const maxChars = opts.maxChars ?? 6000;
  const maxFiles = opts.maxFiles ?? 400;
  const lines: string[] = [];
  let count = 0;
  for (const rel of walkFiles(root, maxFiles * 4)) {
    if (count >= maxFiles) break;
    const ext = extname(rel);
    let entry = rel;
    if (rulesFor(ext)) {
      try {
        const full = join(root, rel);
        if (statSync(full).size <= 300_000) {
          const symbols = extractSymbols(readFileSync(full, 'utf8'), ext);
          if (symbols.length) entry = `${rel}  [${symbols.join(', ')}]`;
        }
      } catch {}
    }
    lines.push(entry);
    count++;
    if (lines.join('\n').length > maxChars) {
      lines.push(`... (${count} files shown; use glob for the rest)`);
      break;
    }
  }
  return lines.join('\n');
}
