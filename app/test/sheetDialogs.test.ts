// B1 (first-run review defect 1, chat review D1 and A11y): the model sheet
// reads the live stack, the same signal the send path checks, so "My Stack"
// is pickable on a device set up after the per-profile stacks landed; a row
// that is only "Checking..." is not a button that does nothing; and every
// sheet is a dialog to assistive tech (role, aria-modal) with focus moved in
// and handed back. The trap at the app root does the focus work for every
// `.sheet`; voice mode is its own surface, so it carries its own.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');

describe('the model sheet reads the live stack (B1)', () => {
  const sheet = src('components/ModelSheet.tsx');

  it('asks sourceReady, never the retired settings.stack field', () => {
    expect(sheet).toMatch(/sourceReady\(\{ kind: 'stack' \}\)/);
    expect(sheet).not.toMatch(/Boolean\(settings\.stack\)/);
  });

  it('a Checking row is not a button', () => {
    const checking = sheet.split('\n').filter((l) => /Checking your/.test(l));
    expect(checking.length).toBeGreaterThan(0);
    for (const line of checking) expect(line).not.toMatch(/<Row\b/);
    expect(sheet).not.toMatch(/onClick=\{\(\) => \{\}\}/);
  });

  it('offers Claude only with a key, on the desktop too', () => {
    expect(sheet).not.toMatch(/cloudKeyPresent \|\| isDesktop\(\)/);
  });

  it('carries no vendor jargon in its empty states', () => {
    expect(sheet).not.toMatch(/add your API/);
    expect(sheet).not.toMatch(/local LLMs,/);
  });
});

describe('sheets are dialogs (B1)', () => {
  const files = [
    'components/ModelSheet.tsx',
    'components/ApprovalSheet.tsx',
    'components/ModeSheet.tsx',
    'components/VoiceMode.tsx',
  ];
  for (const file of files) {
    it(`${file} has role="dialog" and aria-modal`, () => {
      const text = src(file);
      expect(text).toMatch(/role="dialog"/);
      expect(text).toMatch(/aria-modal="true"/);
      expect(text).toMatch(/aria-label(ledby)?=/);
    });
  }

  it('voice mode moves focus in and hands it back itself (it is not a .sheet)', () => {
    const voice = src('components/VoiceMode.tsx');
    expect(voice).toMatch(/\.focus\(\)/);
    expect(voice).toMatch(/opener/);
  });
});
