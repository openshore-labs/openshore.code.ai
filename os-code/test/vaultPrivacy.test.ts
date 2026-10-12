// Vault privacy, the one judge (Vault M4, tech review I3 to I5): exclude and
// local-only globs matched on any case, frontmatter `oscode` marks, `#private`
// and the tags under it, and the order the decisions take.
import { describe, expect, it } from 'vitest';
import {
  LOCAL_ONLY_STUB,
  carriesLocalOnly,
  compileVaultGlob,
  compileVaultPrivacy,
  matchesVaultGlob,
  oscodeMarks,
  visibleToSeat,
  withholdLocalOnly,
} from '../src/harness/vault/privacy.js';
import type { VaultPrivacyConfig } from '../src/harness/vault/types.js';
import type { ChatMessage } from '../src/providers/types.js';

/** The D5 defaults, as the config schema fills them. */
const DEFAULTS: VaultPrivacyConfig = {
  exclude: [],
  localOnly: { paths: ['Private/**', 'Journal/**'], tags: ['private'] },
};

describe('compileVaultGlob', () => {
  const m = (glob: string, path: string) => matchesVaultGlob(glob, path);

  it('covers a folder however it is written, on any disk case', () => {
    for (const glob of ['Private', 'Private/', 'Private/**', '/Private/', './private/**']) {
      expect(m(glob, 'Private/a.md')).toBe(true);
      expect(m(glob, 'private/deep/b.md')).toBe(true);
      expect(m(glob, 'PRIVATE/c.md')).toBe(true);
      expect(m(glob, 'Privateer/a.md')).toBe(false);
      expect(m(glob, 'Work/Private.md')).toBe(false);
    }
  });

  it('keeps `*` and `?` inside a segment and lets `**` cross them', () => {
    expect(m('*.draft.md', 'x.draft.md')).toBe(true);
    expect(m('*.draft.md', 'a/x.draft.md')).toBe(false);
    expect(m('**/*.draft.md', 'a/b/x.draft.md')).toBe(true);
    expect(m('**/*.draft.md', 'x.draft.md')).toBe(true);
    expect(m('Work/**/secret.md', 'Work/secret.md')).toBe(true);
    expect(m('Work/**/secret.md', 'Work/a/b/secret.md')).toBe(true);
    expect(m('Day-??.md', 'Day-01.md')).toBe(true);
    expect(m('Day-??.md', 'Day-1.md')).toBe(false);
    expect(m('Day-?.md', 'Day-/.md')).toBe(false);
  });

  it('treats regex characters literally and a trailing slash as folder only', () => {
    expect(m('a+b (1).md', 'a+b (1).md')).toBe(true);
    expect(m('a+b (1).md', 'aab (1).md')).toBe(false);
    expect(m('Notes.md/', 'Notes.md')).toBe(false);
    expect(m('Notes.md/', 'Notes.md/inner.md')).toBe(true);
  });

  it('matches a case-folded NFC spelling and refuses an empty pattern', () => {
    expect(m('Café/', 'CAFÉ/x.md')).toBe(true);
    expect(compileVaultGlob('')).toBeNull();
    expect(compileVaultGlob('  /  ')).toBeNull();
  });
});

describe('compileVaultPrivacy', () => {
  const judge = compileVaultPrivacy({ ...DEFAULTS, exclude: ['Archive/', '**/*.secret.md'] });

  it('keeps the default folders and #private on this computer', () => {
    expect(judge.visibility({ path: 'Private/plan.md' })).toBe('local-only');
    expect(judge.visibility({ path: 'journal/2026-09-01.md' })).toBe('local-only');
    expect(judge.visibility({ path: 'Work/a.md', tags: ['private'] })).toBe('local-only');
    expect(judge.visibility({ path: 'Work/a.md', tags: ['#Private/Diary'] })).toBe('local-only');
    expect(judge.visibility({ path: 'Work/a.md', tags: ['privateer', 'work/private'] })).toBe(
      'open',
    );
    expect(judge.visibility({ path: 'Work/a.md' })).toBe('open');
  });

  it('hides an excluded glob or mark, before any local-only rule', () => {
    expect(judge.visibility({ path: 'Archive/old.md' })).toBe('hidden');
    expect(judge.visibility({ path: 'a/b/keys.secret.md' })).toBe('hidden');
    expect(judge.visibility({ path: 'Private/x.md', oscode: ['exclude'] })).toBe('hidden');
    expect(judge.visibility({ path: 'Work/x.md', oscode: ['exclude'] })).toBe('hidden');
  });

  it('keeps a local-only mark local, and a pin never lifts either rule', () => {
    expect(judge.visibility({ path: 'Work/x.md', oscode: ['local-only'] })).toBe('local-only');
    expect(judge.visibility({ path: 'Private/x.md', oscode: ['pin'] })).toBe('local-only');
    expect(judge.visibility({ path: 'Archive/x.md', oscode: ['pin'] })).toBe('hidden');
    expect(judge.visibility({ path: 'Work/x.md', oscode: ['pin'] })).toBe('open');
  });

  it('a person list replaces the defaults, and a narrowing only adds', () => {
    const own = compileVaultPrivacy(
      { exclude: [], localOnly: { paths: ['Health/'], tags: ['medical'] } },
      { exclude: ['Drafts/'], localOnly: { tags: ['family'] } },
    );
    expect(own.visibility({ path: 'Private/x.md' })).toBe('open');
    expect(own.visibility({ path: 'Health/x.md' })).toBe('local-only');
    expect(own.visibility({ path: 'x.md', tags: ['medical/eyes'] })).toBe('local-only');
    expect(own.visibility({ path: 'x.md', tags: ['family'] })).toBe('local-only');
    expect(own.visibility({ path: 'Drafts/x.md' })).toBe('hidden');
  });

  it('reads the marks the index stores from frontmatter', () => {
    const marks = oscodeMarks({ props: [{ key: 'OSCode', value: 'Local-Only, pin' }] });
    expect(judge.visibility({ path: 'Work/x.md', oscode: marks })).toBe('local-only');
  });
});

describe('seat and history', () => {
  it('a local-only note reaches only a seat that stays on this network', () => {
    expect(visibleToSeat('open', true)).toBe(true);
    expect(visibleToSeat('local-only', false)).toBe(true);
    expect(visibleToSeat('local-only', true)).toBe(false);
    expect(visibleToSeat('hidden', false)).toBe(false);
  });

  it('withholdLocalOnly swaps the text and leaves the history alone', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'read my journal' },
      { role: 'tool', content: 'Dear diary', localOnly: true } as ChatMessage,
    ];
    const sent = withholdLocalOnly(history);
    expect(sent[1]!.content).toBe(LOCAL_ONLY_STUB);
    expect(history[1]!.content).toBe('Dear diary');
    expect(sent[0]).toBe(history[0]);
  });

  it('a marked reply keeps its calls for their results, never their arguments (D5)', () => {
    const history: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'Saving it.',
        localOnly: true,
        toolCalls: [
          {
            id: 'w1',
            name: 'writeFile',
            argsText: '{"path":"a.md","content":"Dear diary"}',
            args: { path: 'a.md', content: 'Dear diary' },
          },
        ],
      },
      { role: 'tool', content: 'Wrote a.md.', toolCallId: 'w1', name: 'writeFile' },
    ];
    const sent = withholdLocalOnly(history);
    expect(JSON.stringify(sent)).not.toContain('Dear diary');
    expect(sent[0]!.toolCalls).toEqual([{ id: 'w1', name: 'writeFile', argsText: '{}', args: {} }]);
    expect(history[0]!.toolCalls![0]!.args).toEqual({ path: 'a.md', content: 'Dear diary' });
  });

  it('carriesLocalOnly: marked text does, the stub in its place does not', () => {
    const marked: ChatMessage = { role: 'tool', content: 'Dear diary', localOnly: true };
    expect(carriesLocalOnly(marked)).toBe(true);
    expect(carriesLocalOnly(withholdLocalOnly([marked])[0]!)).toBe(false);
    expect(carriesLocalOnly({ role: 'user', content: 'hello' })).toBe(false);
  });
});
