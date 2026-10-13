// Hosted (cloud) models. A maintainer asked for the new Kimi and "that level
// of selection": the frontier models, browsable. Since 2026-10-13 (founder)
// they live in Cloud Connections and only there; the Local Library lists what
// runs on your own machines. This pins that the list derives from the
// providers (so the sheet and the provider rows never drift), that the
// current Kimi lineup is present and no retired id is, that search and
// capability filters find them, that the newest lens puts the latest release
// first, and that no cloud model is offered in the Local Library.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  contextLabel,
  filterHosted,
  hostedIsNew,
  hostedModels,
  newestHosted,
  sortHostedNewest,
} from '../src/lib/hosted.js';
import { PROVIDERS, RETIRED_PROVIDER_MODEL_IDS } from '../src/lib/providers.js';

const hosted = hostedModels();

describe('hosted models derive from the providers', () => {
  it('lists every provider model once, with a stable id and a stack ref', () => {
    const expected = PROVIDERS.reduce((n, p) => n + p.models.length, 0);
    expect(hosted.length).toBe(expected);
    expect(new Set(hosted.map((m) => m.id)).size).toBe(expected);
    for (const m of hosted) {
      expect(m.id).toBe(`hosted:${m.providerId}:${m.modelId}`);
      expect(m.ref).toEqual({
        kind: 'cloud',
        provider: m.providerId,
        model: m.modelId,
        label: m.name,
      });
    }
  });

  it('every provider model carries store copy: a tagline and categories', () => {
    for (const m of hosted) {
      expect(m.tagline, `${m.id} tagline`).not.toBe('');
      expect(m.categories.length, `${m.id} categories`).toBeGreaterThan(0);
    }
  });
});

describe('the Kimi lineup', () => {
  it('carries the current Moonshot models under their live API ids', () => {
    const ids = hosted.filter((m) => m.providerId === 'moonshot').map((m) => m.modelId);
    expect(ids).toContain('kimi-k3');
    expect(ids).toContain('kimi-k2.7-code');
    expect(ids).toContain('kimi-k2.6');
    const names = hosted.map((m) => m.name);
    expect(names).toContain('Kimi K3');
    expect(names).toContain('Kimi K2.6');
  });

  it('lists no retired provider id (a retired id is a dead button in the stack)', () => {
    const live = new Set(hosted.map((m) => m.modelId));
    for (const id of RETIRED_PROVIDER_MODEL_IDS) {
      expect(live.has(id), `${id} is retired`).toBe(false);
    }
  });

  it('points the Kimi models at their Ollama cloud tags for the desktop path', () => {
    const k3 = hosted.find((m) => m.modelId === 'kimi-k3');
    expect(k3?.ollamaCloudRef).toBe('kimi-k3:cloud');
    expect(k3?.openWeights).toBe(true);
    expect(k3?.contextTokens).toBe(1_048_576);
  });
});

describe('search and filters', () => {
  it('"kimi" finds only the Moonshot models, and finds all of them', () => {
    const hits = filterHosted(hosted, 'kimi');
    const moonshot = hosted.filter((m) => m.providerId === 'moonshot');
    expect(hits.length).toBe(moonshot.length);
    expect(hits.every((m) => m.providerId === 'moonshot')).toBe(true);
  });

  it('matches by substring on name, provider, or api id, never by scattered letters', () => {
    expect(filterHosted(hosted, 'K3').map((m) => m.modelId)).toEqual(['kimi-k3']);
    expect(filterHosted(hosted, 'moonshot').every((m) => m.providerId === 'moonshot')).toBe(true);
    // "kimi" letters appear in order across "Haiku ... quick ... trivial", which
    // the catalog's subsequence match would accept; the hosted shelf must not.
    expect(filterHosted(hosted, 'kimi').some((m) => m.modelId === 'claude-haiku-4-5')).toBe(false);
  });

  it('a capability narrows to models that carry it', () => {
    const coding = filterHosted(hosted, '', 'coding');
    expect(coding.some((m) => m.modelId === 'kimi-k2.7-code')).toBe(true);
    expect(coding.every((m) => m.categories.includes('coding'))).toBe(true);
  });
});

describe('the newest lens', () => {
  it('puts the latest dated release first and undated models after every dated one', () => {
    const sorted = sortHostedNewest(hosted);
    expect(sorted[0]?.modelId).toBe('kimi-k3');
    const firstUndated = sorted.findIndex((m) => !m.released);
    const lastDated = sorted.map((m) => Boolean(m.released)).lastIndexOf(true);
    expect(firstUndated === -1 || firstUndated > lastDated).toBe(true);
    expect(newestHosted(hosted)?.modelId).toBe('kimi-k3');
  });

  it('reads as new for 90 days after release, never without a date', () => {
    const k3 = hosted.find((m) => m.modelId === 'kimi-k3')!;
    expect(hostedIsNew(k3, Date.parse('2026-09-03'))).toBe(true);
    expect(hostedIsNew(k3, Date.parse('2027-01-01'))).toBe(false);
    const undated = hosted.find((m) => !m.released);
    if (undated) expect(hostedIsNew(undated)).toBe(false);
  });
});

describe('contextLabel', () => {
  it('rounds to a plain size', () => {
    expect(contextLabel(1_048_576)).toBe('1M');
    expect(contextLabel(262_144)).toBe('256K');
    expect(contextLabel(131_072)).toBe('128K');
  });
});

describe('cloud models live in Cloud Connections only (founder, 2026-10-13)', () => {
  const src = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');

  it('the Local Library offers no cloud model: no frontier shelf, page or search rows', () => {
    for (const file of [
      src('screens', 'LocalLibraryScreen.tsx'),
      src('components', 'LibraryViews.tsx'),
    ]) {
      expect(file).not.toMatch(/lib\/hosted\.js|hostedModels|HOSTED_SHELF|installOllamaRef/);
    }
  });

  it("the library's Install by name turns a cloud tag away to Cloud Connections", () => {
    expect(src('components', 'LibraryViews.tsx')).toMatch(/<InstallByName localOnly \/>/);
    const door = src('components', 'InstallByName.tsx');
    expect(door).toMatch(
      /if \(localOnly && isOllamaCloudTag\(ref\)\) \{\s*showToast\(CLOUD_TAG_IN_LIBRARY\);\s*return;/,
    );
  });

  it('Cloud Connections lists every frontier model, newest first, each opening its provider', () => {
    const room = src('screens', 'ConnectionsScreen.tsx');
    expect(room).toMatch(/sortHostedNewest\(hostedModels\(\)\)/);
    expect(room).toMatch(/onClick=\{\(\) => pickFrontier\(m\.providerId\)\}/);
  });
});
