// A pick whose license sets conditions is got only after the person accepts
// those terms themselves (founder, 2026-10-13): in the CLI the question is
// typed and its default is no.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CatalogSchema } from '../src/market/schema.js';
import { needsTermsAccepted, termsLines, termsQuestion } from '../src/market/terms.js';

const seed = CatalogSchema.parse(
  JSON.parse(readFileSync(join(__dirname, '..', 'catalog.sample.json'), 'utf8')),
);
const model = (id: string) => seed.models.find((m) => m.id === id)!;

describe('the terms a pick asks the person to accept', () => {
  it('are asked for every pick whose license sets conditions or is gated', () => {
    for (const m of seed.models) {
      if (m.license.conditions || m.license.commercial === 'gated') {
        expect(needsTermsAccepted(m), m.id).toBe(true);
      }
    }
    expect(needsTermsAccepted(model('medgemma-27b'))).toBe(true);
    expect(needsTermsAccepted(model('sam3.1'))).toBe(true);
    expect(needsTermsAccepted(model('stable-audio-3-medium'))).toBe(true);
  });

  it('are not asked for an open license', () => {
    expect(needsTermsAccepted(model('gemma4-12b'))).toBe(false);
  });

  it('say the conditions, and that the person accepts the license themselves', () => {
    const m = model('sam3.1');
    expect(termsQuestion(m)).toBe(`Accept the ${m.license.name} for ${m.name}?`);
    const lines = termsLines(m);
    expect(lines[0]).toBe(m.license.conditions);
    expect(lines.at(-1)).toMatch(/Getting it means you accept that license yourself\.$/);
  });

  it('default to no in the CLI', () => {
    for (const file of ['market.ts', 'init.ts']) {
      const src = readFileSync(join(__dirname, '..', 'src', 'commands', file), 'utf8');
      expect(src, file).toMatch(/if \(needsTermsAccepted\(model\)\) \{/);
      expect(src, file).toMatch(/confirm\(termsQuestion\(model\), false\)/);
    }
  });
});
