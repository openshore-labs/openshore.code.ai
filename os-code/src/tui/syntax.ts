// A tiny, language-agnostic line tokenizer for the diff-approval moment. The
// approval prompt is the emotional center of the product: the reviewer reads a
// diff and decides. Warm strings and dim comments help the eye find the shape
// of the change without a heavy syntax engine. Deliberately approximate: it
// covers the common cases (strings, line comments, identifiers) across the
// languages OS Code edits, and anything it is unsure about stays plain.

export type TokenKind = 'plain' | 'string' | 'comment' | 'keyword';

export interface Token {
  text: string;
  kind: TokenKind;
}

// A cross-language keyword set. Not exhaustive and does not need to be; these
// are the words whose faint tint helps a diff read as code.
const KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'fn',
  'func',
  'def',
  'lambda',
  'return',
  'yield',
  'await',
  'async',
  'if',
  'else',
  'elif',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'match',
  'break',
  'continue',
  'class',
  'struct',
  'enum',
  'trait',
  'impl',
  'interface',
  'type',
  'extends',
  'implements',
  'new',
  'import',
  'export',
  'from',
  'use',
  'mod',
  'package',
  'require',
  'public',
  'private',
  'protected',
  'static',
  'final',
  'abstract',
  'pub',
  'try',
  'catch',
  'finally',
  'throw',
  'raise',
  'with',
  'defer',
  'true',
  'false',
  'null',
  'none',
  'nil',
  'undefined',
  'void',
  'this',
  'self',
  'super',
  'in',
  'of',
  'as',
  'is',
  'not',
  'and',
  'or',
  'typeof',
  'instanceof',
]);

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

/** Tokenize one line of code. Consecutive plain characters are merged. */
export function tokenizeCodeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let plain = '';
  const flush = () => {
    if (plain) {
      tokens.push({ text: plain, kind: 'plain' });
      plain = '';
    }
  };

  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    const next = line[i + 1];

    // Line comments: // or # (only when # is not the first non-space, keep it
    // simple and treat any # outside a string as a comment start).
    if ((ch === '/' && next === '/') || ch === '#') {
      flush();
      tokens.push({ text: line.slice(i), kind: 'comment' });
      break;
    }

    // Strings: ', ", or backtick, to a matching unescaped quote or end of line.
    if (ch === '"' || ch === "'" || ch === '`') {
      flush();
      let j = i + 1;
      let escaped = false;
      while (j < line.length) {
        const c = line[j]!;
        if (escaped) {
          escaped = false;
        } else if (c === '\\') {
          escaped = true;
        } else if (c === ch) {
          j += 1;
          break;
        }
        j += 1;
      }
      tokens.push({ text: line.slice(i, j), kind: 'string' });
      i = j;
      continue;
    }

    // Identifiers and keywords.
    if (IDENT_START.test(ch)) {
      flush();
      let j = i + 1;
      while (j < line.length && IDENT_PART.test(line[j]!)) j += 1;
      const word = line.slice(i, j);
      tokens.push({ text: word, kind: KEYWORDS.has(word) ? 'keyword' : 'plain' });
      i = j;
      continue;
    }

    plain += ch;
    i += 1;
  }
  flush();
  return tokens;
}
