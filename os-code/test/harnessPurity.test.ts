// HARNESS PURITY GUARD (tenet 5: "the pure core stays free of Node built-ins
// by test so the phone can run it"). The phone's WebView and the app bundle
// import `os-code/protocol`, and the harness core under `src/harness/**` is the
// code the phone host will run, so neither may reach Node at runtime.
//
// The walk starts at every file under src/harness/** plus src/protocol.ts and
// follows relative imports transitively, so a Node import that arrives through
// `../core/...` fails here just like a direct one. It fails on:
//   - `node:*` or any name in `module.builtinModules`;
//   - a bare package outside the allow-list {zod, js-yaml};
//   - `require(`, `__dirname`, `__filename`, `Buffer`, or `process.env`.
// Type-only imports and exports are erased at build, so they are neither
// followed nor checked. The file is parsed with the TypeScript compiler, so a
// word in a comment or a string never trips the guard.
//
// The negative self-tests at the bottom prove the guard can fail: a fixture
// that imports node:fs, and one that reaches a built-in only transitively.
import { describe, expect, it } from 'vitest';
import { builtinModules } from 'node:module';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const SRC = join(PKG, 'src');

/** Bare packages the pure core may import. Both are browser-safe and carry
 *  no Node imports (tech review, Vault M3 3.0 and H2). */
const ALLOWED_PACKAGES = new Set(['zod', 'js-yaml']);
const BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));
const BANNED_GLOBALS = new Set(['__dirname', '__filename', 'Buffer']);

interface Violation {
  file: string;
  what: string;
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkTs(full));
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Map a relative specifier (written with .js, as NodeNext wants) to the
 *  source file it names. */
function resolveRelative(from: string, spec: string): string | undefined {
  const base = resolve(dirname(from), spec);
  const stem = base.replace(/\.(m|c)?js$/, '');
  const candidates = [
    `${stem}.ts`,
    `${stem}.tsx`,
    base,
    join(base, 'index.ts'),
    join(stem, 'index.ts'),
  ];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile());
}

function packageName(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false; // a bare side-effect import runs
  if (clause.isTypeOnly) return true;
  if (clause.name) return false;
  const bindings = clause.namedBindings;
  if (!bindings) return false;
  if (ts.isNamespaceImport(bindings)) return false;
  return bindings.elements.length > 0 && bindings.elements.every((e) => e.isTypeOnly);
}

function isTypeOnlyExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  if (!clause || ts.isNamespaceExport(clause)) return false;
  return clause.elements.length > 0 && clause.elements.every((e) => e.isTypeOnly);
}

/** Scan one file: its banned constructs, and the runtime specifiers it pulls. */
function scanFile(file: string): { violations: string[]; specs: string[] } {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  const specs: string[] = [];
  const at = (node: ts.Node): string =>
    `line ${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!isTypeOnlyImport(node)) specs.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (!isTypeOnlyExport(node)) specs.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const arg = node.arguments[0];
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        if (arg && ts.isStringLiteralLike(arg)) specs.push(arg.text);
        else violations.push(`dynamic import() with a computed specifier (${at(node)})`);
      } else if (ts.isIdentifier(callee) && callee.text === 'require') {
        violations.push(`require( (${at(node)})`);
      }
    } else if (ts.isPropertyAccessExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'process' &&
        node.name.text === 'env'
      ) {
        violations.push(`process.env (${at(node)})`);
      }
    } else if (ts.isElementAccessExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'process' &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === 'env'
      ) {
        violations.push(`process.env (${at(node)})`);
      }
    } else if (ts.isIdentifier(node) && BANNED_GLOBALS.has(node.text)) {
      const parent = node.parent;
      const isMemberName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isPropertySignature(parent) && parent.name === node) ||
        (ts.isPropertyDeclaration(parent) && parent.name === node) ||
        (ts.isMethodDeclaration(parent) && parent.name === node);
      if (!isMemberName) violations.push(`${node.text} (${at(node)})`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { violations, specs };
}

/** Walk the runtime import graph from `roots` and report every violation. */
export function scanGraph(roots: string[], base: string = PKG): Violation[] {
  const seen = new Set<string>();
  const queue = [...roots];
  const found: Violation[] = [];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const rel = relative(base, file);
    const { violations, specs } = scanFile(file);
    for (const what of violations) found.push({ file: rel, what });
    for (const spec of specs) {
      if (spec.startsWith('.')) {
        const target = resolveRelative(file, spec);
        if (target) queue.push(target);
        else found.push({ file: rel, what: `unresolved relative import '${spec}'` });
        continue;
      }
      if (spec.startsWith('node:')) {
        found.push({ file: rel, what: `Node built-in '${spec}'` });
        continue;
      }
      const name = packageName(spec);
      if (BUILTINS.has(spec) || BUILTINS.has(name)) {
        found.push({ file: rel, what: `Node built-in '${spec}'` });
      } else if (!ALLOWED_PACKAGES.has(name)) {
        found.push({ file: rel, what: `package '${spec}' is not on the allow-list` });
      }
    }
  }
  return found;
}

function format(violations: Violation[]): string {
  return violations.map((v) => `${v.file}: ${v.what}`).join('\n');
}

describe('harness purity: the pure core and os-code/protocol never reach Node', () => {
  const roots = [...walkTs(join(SRC, 'harness')), join(SRC, 'protocol.ts')];

  it('starts from every harness file plus protocol.ts', () => {
    expect(roots.length).toBeGreaterThan(1);
    expect(roots).toContain(join(SRC, 'harness', 'verify.ts'));
  });

  it('finds no Node built-in, unlisted package, or Node global in the graph', () => {
    const violations = scanGraph(roots);
    expect(format(violations)).toBe('');
  });
});

describe('harness purity guard self-test (it must be able to fail)', () => {
  const FIX = join(HERE, 'fixtures', 'purity');

  it('fails on a fixture that imports node:fs', () => {
    const violations = scanGraph([join(FIX, 'impure.ts')]);
    expect(violations.map((v) => v.what)).toContain("Node built-in 'node:fs'");
  });

  it('follows relative imports to a built-in and Node globals one hop away', () => {
    const whats = scanGraph([join(FIX, 'chainRoot.ts')]).map((v) => v.what);
    expect(whats).toContain("Node built-in 'os'");
    expect(whats.some((w) => w.startsWith('process.env'))).toBe(true);
    expect(whats.some((w) => w.startsWith('Buffer'))).toBe(true);
  });

  it('passes allow-listed packages and type-only Node imports', () => {
    expect(format(scanGraph([join(FIX, 'clean.ts')]))).toBe('');
  });
});
