// The check that needs no test suite (v1 Phase 1, "zero-setup verify"): after
// a task that changed a page, a script, or a data file, look at the folder the
// way a browser would and report what would break, without running anything
// the project wrote. A first-time person's folder has no tests; this is their
// test suite.
//
// What it checks, all by reading files:
//   - every script, stylesheet, and image a page loads is in the folder;
//   - every script parses (compiled, never run; module scripts are skipped);
//   - every element a script looks up by id (getElementById, querySelector
//     with #id) exists on a page that loads the script, or is made by a
//     script;
//   - every JSON file the task changed parses.
//
// Why these: they are the ways a beginner's page silently does nothing (the
// button that never answers because its script looks for the wrong id, the
// page that loads a file that is not there). A problem goes back to the model
// the way a failing test does, so it fixes the real cause.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { Script } from 'node:vm';
import { dirname, extname, join, normalize, relative } from 'node:path';
import type { VerifyResult } from '../../harness/verify.js';

const PAGE_EXT = new Set(['.html', '.htm']);
const SCRIPT_EXT = new Set(['.js', '.mjs', '.cjs']);
const MAX_PAGES = 200;
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
  '.cache',
]);

interface Page {
  rel: string;
  html: string;
  ids: Set<string>;
  scripts: Array<{ rel?: string; code: string; module: boolean }>;
}

function isRemote(ref: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref) || ref.trim() === '';
}

function stripQuery(ref: string): string {
  return ref.split(/[?#]/)[0]!;
}

function listPages(cwd: string): string[] {
  const pages: string[] = [];
  const stack = [''];
  while (stack.length && pages.length < MAX_PAGES) {
    const rel = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(join(cwd, rel));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const child = rel ? `${rel}/${entry}` : entry;
      let st;
      try {
        st = statSync(join(cwd, child));
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(entry)) stack.push(child);
      } else if (PAGE_EXT.has(extname(entry).toLowerCase())) {
        pages.push(child);
      }
    }
  }
  return pages;
}

function readPage(cwd: string, rel: string): Page | undefined {
  let html: string;
  try {
    html = readFileSync(join(cwd, rel), 'utf8');
  } catch {
    return undefined;
  }
  const ids = new Set<string>();
  for (const m of html.matchAll(/\sid\s*=\s*(["'])([^"']+)\1/gi)) ids.add(m[2]!);
  const scripts: Page['scripts'] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? '';
    const module = /type\s*=\s*["']module["']/i.test(attrs);
    const src = /\ssrc\s*=\s*(["'])([^"']+)\1/i.exec(attrs)?.[2];
    if (src) {
      if (isRemote(src)) continue;
      const target = normalize(join(dirname(rel), stripQuery(src)))
        .split('\\')
        .join('/');
      let code = '';
      try {
        code = readFileSync(join(cwd, target), 'utf8');
      } catch {
        // Missing: reported by the reference check.
      }
      scripts.push({ rel: target, code, module });
    } else if (m[2]?.trim()) {
      scripts.push({ code: m[2], module });
    }
  }
  return { rel, html, ids, scripts };
}

/** Local files a page loads (scripts, stylesheets, images) that are not in
 *  the folder. */
function missingRefs(cwd: string, page: Page): string[] {
  const problems: string[] = [];
  const refs: Array<{ kind: string; ref: string }> = [];
  for (const m of page.html.matchAll(/<script\b[^>]*\ssrc\s*=\s*(["'])([^"']+)\1/gi)) {
    refs.push({ kind: 'script', ref: m[2]! });
  }
  for (const m of page.html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel\s*=\s*["'][^"']*stylesheet/i.test(m[0])) continue;
    const href = /\shref\s*=\s*(["'])([^"']+)\1/i.exec(m[0])?.[2];
    if (href) refs.push({ kind: 'stylesheet', ref: href });
  }
  for (const m of page.html.matchAll(/<img\b[^>]*\ssrc\s*=\s*(["'])([^"']+)\1/gi)) {
    refs.push({ kind: 'image', ref: m[2]! });
  }
  for (const { kind, ref } of refs) {
    if (isRemote(ref) || ref.startsWith('/')) continue;
    const target = normalize(join(dirname(page.rel), stripQuery(ref)));
    if (!existsSync(join(cwd, target))) {
      problems.push(`${page.rel} loads the ${kind} ${ref}, which is not in the folder.`);
    }
  }
  return problems;
}

/** A classic script that does not parse. Compiled, never run. */
function syntaxProblem(code: string, where: string, module: boolean): string | undefined {
  if (module || /^\s*(import|export)\s/m.test(code)) return undefined;
  try {
    new Script(code, { filename: where });
    return undefined;
  } catch (err) {
    return `${where} has a syntax error: ${(err as Error).message}.`;
  }
}

/** Ids a script looks up by literal. */
function idsLookedUp(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/getElementById\(\s*(["'`])([\w-]+)\1\s*\)/g)) out.add(m[2]!);
  for (const m of code.matchAll(/querySelector(?:All)?\(\s*(["'`])#([\w-]+)\1\s*\)/g))
    out.add(m[2]!);
  return [...out];
}

/** Ids a script makes itself, so a lookup of one is not a miss. */
function idsMade(code: string): Set<string> {
  const out = new Set<string>();
  for (const m of code.matchAll(/\.id\s*=\s*(["'`])([\w-]+)\1/g)) out.add(m[2]!);
  for (const m of code.matchAll(/setAttribute\(\s*["'`]id["'`]\s*,\s*(["'`])([\w-]+)\1/g))
    out.add(m[2]!);
  for (const m of code.matchAll(/\bid\s*=\s*\\?["']([\w-]+)\\?["']/g)) out.add(m[1]!);
  return out;
}

function namesList(ids: Set<string>): string {
  const list = [...ids].slice(0, 6).join(', ');
  return list ? ` (it has: ${list})` : ' (it has no ids)';
}

/**
 * Check the pages and scripts a task touched. `changed` is the task's changed
 * files, relative to `cwd`. Returns ran: false when nothing it knows how to
 * check changed (a Python file, a markdown note), so the loop reports nothing.
 */
export function pageCheck(cwd: string, changed: string[]): VerifyResult {
  const touched = changed.map((p) => p.split('\\').join('/'));
  const touchesWeb = touched.some((p) => {
    const ext = extname(p).toLowerCase();
    return PAGE_EXT.has(ext) || SCRIPT_EXT.has(ext) || ext === '.css';
  });
  const jsons = touched.filter((p) => extname(p).toLowerCase() === '.json');
  if (!touchesWeb && !jsons.length) {
    return { ran: false, passed: false, summary: 'Nothing here that a page check covers.' };
  }
  const problems: string[] = [];

  for (const rel of jsons) {
    try {
      JSON.parse(readFileSync(join(cwd, rel), 'utf8'));
    } catch (err) {
      if (existsSync(join(cwd, rel))) {
        problems.push(`${rel} is not valid JSON: ${(err as Error).message}.`);
      }
    }
  }

  if (touchesWeb) {
    const pages = listPages(cwd)
      .map((rel) => readPage(cwd, rel))
      .filter((p): p is Page => Boolean(p));
    const checkedScripts = new Set<string>();
    // Which pages load each script file, so a shared script's lookup is only a
    // miss when no page that loads it has the id.
    const loaders = new Map<string, Page[]>();
    for (const page of pages) {
      problems.push(...missingRefs(cwd, page));
      for (const s of page.scripts) {
        if (s.rel) loaders.set(s.rel, [...(loaders.get(s.rel) ?? []), page]);
      }
    }
    for (const page of pages) {
      page.scripts.forEach((s, i) => {
        const where = s.rel ?? `the script inside ${page.rel} (${i + 1})`;
        if (s.rel) {
          if (checkedScripts.has(s.rel) || !s.code) return;
          checkedScripts.add(s.rel);
        }
        const syntax = syntaxProblem(s.code, where, s.module);
        if (syntax) {
          problems.push(syntax);
          return;
        }
        const pagesForScript = s.rel ? (loaders.get(s.rel) ?? [page]) : [page];
        const made = new Set<string>();
        for (const p of pagesForScript)
          for (const other of p.scripts) for (const id of idsMade(other.code)) made.add(id);
        for (const id of idsLookedUp(s.code)) {
          if (made.has(id) || pagesForScript.some((p) => p.ids.has(id))) continue;
          const home = pagesForScript[0]!;
          problems.push(
            `${where} looks for an element with id "${id}", but ${home.rel} has none${namesList(home.ids)}. That part of the page will do nothing.`,
          );
        }
      });
    }
    // A script the task changed that no page loads still has to parse.
    for (const rel of touched) {
      if (!SCRIPT_EXT.has(extname(rel).toLowerCase()) || checkedScripts.has(rel)) continue;
      let code: string;
      try {
        code = readFileSync(join(cwd, rel), 'utf8');
      } catch {
        continue;
      }
      const syntax = syntaxProblem(code, relative(cwd, join(cwd, rel)), extname(rel) === '.mjs');
      if (syntax) problems.push(syntax);
    }
  }

  if (!problems.length) {
    return {
      ran: true,
      passed: true,
      summary:
        'It works: every file the page loads is there, and its scripts find what they look for.',
    };
  }
  return {
    ran: true,
    passed: false,
    summary: `Not yet: ${problems.length === 1 ? 'one thing' : `${problems.length} things`} would break in the browser.`,
    detail: problems.slice(0, 12).join('\n'),
  };
}
