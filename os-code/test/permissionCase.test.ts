// A deny rule fences a folder whatever case the model spells it in, because a
// Mac or Windows disk opens `Secrets/k` and `secrets/k` as one file (security
// review 2026-09-29, open item 7). An allow keeps its exact spelling, so the
// fold only ever makes a decision stricter.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERMISSIONS,
  PermissionEngine,
  ruleMatchesPath,
  type PermissionConfig,
} from '../src/core/permissions/index.js';

function engine(rules: PermissionConfig['rules']): PermissionEngine {
  return new PermissionEngine({ ...DEFAULT_PERMISSIONS, rules });
}

const write = (path: string) => ({ toolName: 'writeFile', risk: 'write' as const, path });

describe('a deny rule ignores case', () => {
  const e = engine([{ tool: '*', decision: 'deny', pathGlob: 'secrets/**' }]);

  it('fences every spelling of the folder', () => {
    for (const path of ['secrets/k', 'Secrets/k', 'SECRETS/k', 'sEcReTs/deep/k']) {
      expect(e.decide(write(path)).decision, path).toBe('deny');
    }
  });

  it('a capitalised rule fences the lowercase folder too', () => {
    const upper = engine([{ tool: '*', decision: 'deny', pathGlob: 'Private/**' }]);
    expect(upper.decide(write('private/note.md')).decision).toBe('deny');
  });

  it('a basename rule ignores case as well', () => {
    const env = engine([{ tool: '*', decision: 'deny', pathGlob: '*.env' }]);
    expect(env.decide(write('config/PROD.ENV')).decision).toBe('deny');
  });

  it('leaves an unrelated folder alone', () => {
    expect(e.decide(write('src/secrets.ts')).decision).not.toBe('deny');
  });
});

describe('an ask rule ignores case', () => {
  it('asks for every spelling', () => {
    const e = engine([{ tool: '*', decision: 'ask', pathGlob: 'infra/**' }]);
    expect(e.decide(write('Infra/main.tf')).decision).toBe('ask');
  });
});

describe('an allow rule keeps its spelling', () => {
  it('allows only the spelling it names', () => {
    expect(ruleMatchesPath('src/a.ts', 'src/**', 'allow')).toBe(true);
    expect(ruleMatchesPath('SRC/a.ts', 'src/**', 'allow')).toBe(false);
  });

  it('a deny listed after an allow still wins on a folded spelling', () => {
    const e = engine([
      { tool: '*', decision: 'allow', pathGlob: 'src/**' },
      { tool: '*', decision: 'deny', pathGlob: 'src/keys/**' },
    ]);
    expect(e.decide(write('Src/keys/k')).decision).toBe('deny');
  });
});
