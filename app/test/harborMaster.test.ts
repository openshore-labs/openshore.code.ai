// DeepBlue, the third and most capable member of the Harbor family, the
// one that runs on your computer: a stable slot over catalog weights, sized to
// the machine, out of the box (Settings > Harbor and the First Seat card), never
// behind the Marketplace. Pinned here so a catalog rename, a copy drift, or a
// claim past the honesty bar fails the build, not a person's first run.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HARBOR_MASTER_ATTRIBUTION,
  HARBOR_MASTER_BYLINE,
  HARBOR_MASTER_DEFAULT_SIZE,
  HARBOR_MASTER_MODEL_ID,
  HARBOR_MASTER_MODEL_NAME,
  HARBOR_MASTER_SIZES,
  harborMasterInstalled,
  harborMasterSizeLine,
  isHarborMasterRef,
  resolveHarborMaster,
} from '../src/lib/harborMaster.js';
import { STARTER_CANDIDATES, STARTER_MODEL } from '../src/lib/starterModel.js';
import { STACK_BUNDLES } from '../src/lib/bundles.js';
import { classLineFor, type HardwareRead } from '../src/lib/firstSeat.js';
import { SETUP_GUIDES, guideStepsCompact } from '../src/lib/setupGuides.js';
import { buildHarborMiniSystemPrompt } from '../src/lib/harborMini.js';
import { APP_KNOWLEDGE } from '../src/lib/guideKnowledge.js';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

// The em dash and its encoded spellings, assembled from pieces so the
// repo-wide guard, which scans test files too, never reads the glyph here.
const EM_DASH = String.fromCharCode(0x2014);
const NO_EM_DASH = new RegExp([EM_DASH, '&' + 'mdash;', '&#x' + '2014;', '&#' + '8212;'].join('|'));

const cpu = (ramGB: number): HardwareRead => ({ ramGB, gpu: false });
const gpu = (ramGB: number, vram: number): HardwareRead => ({ ramGB, gpu: true, gpuVramGB: vram });

interface CatalogModel {
  id: string;
  name: string;
  sizeGB?: number;
  source: { kind: string; ref: string };
}
const catalog = JSON.parse(read('../os-code/catalog.sample.json')) as { models: CatalogModel[] };
const byId = new Map(catalog.models.map((m) => [m.id, m]));

describe('DeepBlue is a stable slot over catalog weights', () => {
  it('keeps the id and the display name apart, the Harbor pattern', () => {
    expect(HARBOR_MASTER_MODEL_ID).toBe('harbor-master');
    expect(HARBOR_MASTER_MODEL_NAME).toBe('DeepBlue');
  });

  it('every size exists in the bundled catalog with the same ref, name, and size, pulled via Ollama', () => {
    for (const s of HARBOR_MASTER_SIZES) {
      const m = byId.get(s.catalogId);
      expect(m, `catalog has ${s.catalogId}`).toBeDefined();
      expect(m!.source.kind).toBe('ollama');
      expect(m!.source.ref).toBe(s.ollamaRef);
      expect(m!.name).toBe(s.weightsName);
      expect(m!.sizeGB).toBe(s.sizeGB);
    }
  });

  it('lists sizes largest first, the 3B floor last, and defaults to the 7B', () => {
    const gbs = HARBOR_MASTER_SIZES.map((s) => s.sizeGB);
    expect([...gbs].sort((a, b) => b - a)).toEqual(gbs);
    expect(HARBOR_MASTER_SIZES[HARBOR_MASTER_SIZES.length - 1]!.ollamaRef).toBe('qwen2.5-coder:3b');
    expect(HARBOR_MASTER_DEFAULT_SIZE.ollamaRef).toBe('qwen2.5-coder:7b');
  });

  it('is the desktop starter and the Starter bundle, one list in one place', () => {
    expect(STARTER_CANDIDATES.map((c) => c.catalogId)).toEqual(
      HARBOR_MASTER_SIZES.map((s) => s.catalogId),
    );
    expect(STARTER_MODEL.catalogId).toBe(HARBOR_MASTER_DEFAULT_SIZE.catalogId);
    const starter = STACK_BUNDLES.find((b) => b.id === 'starter')!;
    expect(starter.orchestratorCandidates).toEqual(HARBOR_MASTER_SIZES.map((s) => s.catalogId));
    expect(starter.orchestrator).toBe(HARBOR_MASTER_DEFAULT_SIZE.catalogId);
  });
});

describe('DeepBlue is sized to the computer with the engine budget', () => {
  it('the 3B on the reference box, the 7B on a 16 GB laptop or an 8 GB GPU, the 14B on a hub with room', () => {
    expect(resolveHarborMaster(cpu(8)).size.ollamaRef).toBe('qwen2.5-coder:3b');
    expect(resolveHarborMaster(cpu(8)).fit).toBe('fits');
    expect(resolveHarborMaster(cpu(16)).size.ollamaRef).toBe('qwen2.5-coder:7b');
    expect(resolveHarborMaster(gpu(16, 8)).size.ollamaRef).toBe('qwen2.5-coder:7b');
    expect(resolveHarborMaster(gpu(64, 24))).toMatchObject({
      size: { ollamaRef: 'qwen2.5-coder:14b' },
      fit: 'fits',
    });
    // 32 GB of CPU memory is honestly tight for the 14B by the engine's rule
    // (half of RAM is the budget), and the card says so rather than hiding it.
    expect(resolveHarborMaster(cpu(32))).toMatchObject({
      size: { ollamaRef: 'qwen2.5-coder:14b' },
      fit: 'tight',
    });
  });

  it('never offers the biggest size on a guess', () => {
    const r = resolveHarborMaster(undefined);
    expect(r.size).toBe(HARBOR_MASTER_DEFAULT_SIZE);
    expect(r.fit).toBe('unknown');
  });

  it('reads presence from the engine list, largest present size first', () => {
    expect(harborMasterInstalled(undefined)).toBeUndefined();
    expect(harborMasterInstalled([])).toBeUndefined();
    expect(harborMasterInstalled(['llama3.1:8b'])).toBeUndefined();
    expect(harborMasterInstalled(['qwen2.5-coder:3b', 'qwen2.5-coder:7b'])?.ollamaRef).toBe(
      'qwen2.5-coder:7b',
    );
    expect(isHarborMasterRef('qwen2.5-coder:7b')).toBe(true);
    expect(isHarborMasterRef('qwen2.5-coder')).toBe(false);
  });

  it('names what is really behind the slot on the size line, with a class line the engine wrote', () => {
    expect(harborMasterSizeLine(HARBOR_MASTER_DEFAULT_SIZE)).toBe(
      'On Qwen 2.5 Coder 7B. 4.7 GB download.',
    );
    for (const s of HARBOR_MASTER_SIZES) {
      expect(classLineFor(s.ollamaRef)).toMatch(/^Runs short plans|^Plans and runs|^Full planning/);
    }
  });
});

describe('the copy keeps the honesty bar', () => {
  const copy = [HARBOR_MASTER_BYLINE, HARBOR_MASTER_ATTRIBUTION];

  it('the byline is a short, em-dash-free row line that names a coding agent on your computer', () => {
    expect(HARBOR_MASTER_BYLINE).not.toMatch(NO_EM_DASH);
    expect(HARBOR_MASTER_BYLINE.length).toBeLessThanOrEqual(140);
    expect(HARBOR_MASTER_BYLINE.toLowerCase()).toContain('coding agent');
    expect(HARBOR_MASTER_BYLINE.toLowerCase()).toContain('your computer');
  });

  it('never claims a frontier model, a codename, training, or always on', () => {
    for (const text of copy) {
      for (const banned of [
        'Opus',
        'Claude',
        'Sonnet',
        'Keel',
        'always on',
        'Always on',
        'trains itself',
        'tuned',
      ]) {
        expect(text, banned).not.toContain(banned);
      }
    }
  });

  it('the attribution names the real weights and their license', () => {
    expect(HARBOR_MASTER_ATTRIBUTION).toContain('Qwen 2.5 Coder');
    expect(HARBOR_MASTER_ATTRIBUTION).toContain('Apache License 2.0');
  });
});

describe('DeepBlue is out of the box on the desktop', () => {
  const settings = read('src/screens/SettingsScreen.tsx');
  const seat = read('src/components/FirstSeat.tsx');
  const stack = read('src/screens/StackScreen.tsx');
  const store = read('src/state/store.ts');

  it('has a Settings > Harbor row on the desktop, read from the engine, with Install only', () => {
    expect(settings).toContain('label="DeepBlue"');
    expect(settings).toContain('sub={HARBOR_MASTER_BYLINE}');
    expect(settings).toContain('harborMasterInstalled(desktopStatus?.ollama.models)');
    expect(settings).toContain('onInstall={() => void installHarborMaster()}');
    // Ollama owns the weights: no app-side uninstall or cancel on this row.
    const row = settings.slice(settings.indexOf('label="DeepBlue"'));
    const rowEnd = row.indexOf('/>', row.indexOf('<HarborInstallButton'));
    expect(row.slice(0, rowEnd)).not.toContain('onUninstall');
    expect(row.slice(0, rowEnd)).not.toContain('onCancel');
    // The desktop row sits outside the phone-only gate.
    const phoneGate = settings.indexOf('{!isDesktop() ? (', settings.indexOf('title="Harbor"'));
    expect(settings.indexOf('label="DeepBlue"')).toBeGreaterThan(phoneGate);
    expect(settings.indexOf('label="DeepBlue"')).toBeGreaterThan(
      settings.indexOf(') : null}', phoneGate),
    );
  });

  it('carries the attribution into "Local models, honestly"', () => {
    expect(settings).toContain('{HARBOR_MASTER_ATTRIBUTION}');
  });

  it('the First Seat card names it and installs it in place on the desktop', () => {
    expect(seat).toContain('HARBOR_MASTER_MODEL_NAME');
    expect(seat).toContain('ensureHarborMaster()');
    expect(seat).toContain('harborMasterSizeLine(');
  });

  it('the Stack screen one-tap starter is the same store action', () => {
    expect(stack).toContain('ensureHarborMaster()');
    expect(stack).not.toContain('STARTER_MODEL');
  });

  it('the store pulls by catalog id, seats by Ollama ref, and refreshes the gate', () => {
    const action = store.slice(store.indexOf('async ensureHarborMaster()'));
    const body = action.slice(0, action.indexOf('beginHarborMiniWithIntro()'));
    expect(body).toContain('resolveHarborMaster(hw)');
    expect(body).toContain('b.installModel(size.catalogId)');
    expect(body).toContain('b.setOrchestrator(size.ollamaRef)');
    expect(body).toContain('refreshDesktopStatus()');
    // Ollama down is a failure line, never a silent no-op.
    expect(body).toContain('status.ollama.detail');
  });
});

describe('the guides know the third Harbor', () => {
  it('has a get-harbor-master walkthrough accurate to the Settings row', () => {
    const g = SETUP_GUIDES['get-harbor-master'];
    expect(g).toBeTruthy();
    const joined = g.steps.map((s) => (typeof s === 'string' ? s : s.text)).join(' ');
    expect(joined).toContain('Settings');
    expect(joined).toContain('Install');
    expect(joined).toContain('Ollama');
    expect(joined).not.toMatch(NO_EM_DASH);
  });

  it('Harbor Light recites it and the shared facts name the family', () => {
    expect(buildHarborMiniSystemPrompt()).toContain(guideStepsCompact('get-harbor-master'));
    expect(APP_KNOWLEDGE).toContain('DeepBlue');
    expect(APP_KNOWLEDGE).toContain('never through the Marketplace');
  });
});

describe('the docs carry the third entry', () => {
  it('MODEL-LICENSES.md and docs/HARBOR.md name DeepBlue', () => {
    expect(read('MODEL-LICENSES.md')).toContain('DeepBlue');
    expect(read('../docs/HARBOR.md')).toContain('DeepBlue');
  });
});
