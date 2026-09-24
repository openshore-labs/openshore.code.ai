import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { forgetCurrentCopy } from '../src/lib/confirmCopy.js';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// One confirm grammar across the app (brand sweep 2026-09-24): the confirm
// card, an h3 and a p, then Keep first and a danger button second. Loss never
// wears the teal primary.
describe('destructive confirms', () => {
  it('the forget copy names the current from the roster label', () => {
    expect(forgetCurrentCopy('Hermes Agent')).toEqual({
      title: 'Forget Hermes Agent on this device?',
      body: 'It turns off in every project that uses it, and its API key is removed.',
    });
  });

  it('both current connect sheets confirm before forgetting', () => {
    for (const f of [
      '../src/components/CurrentConnectSheet.tsx',
      '../src/components/HarnessCurrentConnectSheet.tsx',
    ]) {
      const src = read(f);
      // The sheet hands the forget up with the roster label; it never
      // disconnects on the first tap.
      expect(src, f).toMatch(/onForget\(id, info\.label\)/);
      expect(src, f).not.toMatch(/disconnect(Harness)?Current\(/);
      expect(src, f).toMatch(/<SheetHead/);
    }
    const parent = read('../src/components/ProjectCurrents.tsx');
    expect(parent).toMatch(/<ForgetCurrentConfirm/);
    const confirm = read('../src/components/ForgetCurrentConfirm.tsx');
    expect(confirm).toMatch(/variant="confirm"/);
    expect(confirm.indexOf('Keep')).toBeLessThan(confirm.indexOf('btn danger'));
  });

  it.each([
    '../src/screens/CrewScreen.tsx',
    '../src/screens/CrewCommandScreen.tsx',
    '../src/screens/ProjectDetailScreen.tsx',
  ])('%s uses the confirm card with Keep, then btn danger', (f) => {
    const src = read(f);
    const at = src.lastIndexOf('variant="confirm"');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf('</Sheet>', at));
    expect(block).toMatch(/<h3>/);
    expect(block).toMatch(/className="confirm-row"/);
    expect(block).not.toMatch(/btn primary/);
    expect(block).not.toMatch(/sheet-actions/);
    expect(block.indexOf('btn ghost')).toBeLessThan(block.indexOf('btn danger'));
  });

  it('the armed vault delete ends on btn danger', () => {
    expect(read('../src/screens/VaultScreen.tsx')).toMatch(
      /className=\{`btn press-fb \$\{confirmDelete \? 'danger' : 'quiet'\}`\}/,
    );
  });

  it('every Sheet is announced as a modal dialog', () => {
    const sheet = read('../src/components/Sheet.tsx');
    expect(sheet).toMatch(/role="dialog"/);
    expect(sheet).toMatch(/aria-modal="true"/);
  });
});
