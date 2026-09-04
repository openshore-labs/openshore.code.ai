// The two Harbor guides as they appear in Settings: Harbor Mini bundled with
// the app (Built in, not removable) and Harbor as a real install/uninstall
// download. Plus the disclosure boundary both guides carry: open about every
// front-end feature, silent on backend build internals. Kept in tests so a copy
// or scope change cannot quietly regress the promise.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HARBOR_BYLINE,
  buildHarborSystemPrompt,
} from '../src/lib/harbor.js';
import {
  HARBOR_MINI_BUNDLED,
  HARBOR_MINI_BYLINE,
  HARBOR_MINI_MODEL_ID,
  buildHarborMiniSystemPrompt,
} from '../src/lib/harborMini.js';
import { APP_KNOWLEDGE } from '../src/lib/guideKnowledge.js';

const NO_EM_DASH = /—|&mdash;|&#x2014;|&#8212;/;

function oneSentence(s: string): boolean {
  // A single trailing sentence: exactly one period, and it is the last char.
  return s.trim().endsWith('.') && (s.match(/\./g) ?? []).length === 1;
}

describe('Harbor Mini is bundled (native with the app)', () => {
  it('declares itself bundled', () => {
    expect(HARBOR_MINI_BUNDLED).toBe(true);
  });

  it('the native ModelStore treats harbor-mini as a bundled model', () => {
    const swift = readFileSync(
      join(
        process.cwd(),
        'plugins/oscode-llama/ios/Sources/OscodeLlamaPlugin/ModelStore.swift',
      ),
      'utf8',
    );
    // The id is in the bundled set, and the store resolves, lists, and refuses
    // to download or delete a bundled model.
    expect(swift).toContain('bundledModelIds');
    expect(swift).toContain(`"${HARBOR_MINI_MODEL_ID}"`);
    expect(swift).toContain('func bundledURL(for id: String)');
  });
});

describe('the Harbor rows in Settings', () => {
  const screen = readFileSync(join(process.cwd(), 'src/screens/SettingsScreen.tsx'), 'utf8');

  it('renders both guide rows under the Harbor group', () => {
    expect(screen).toContain('label="Harbor Mini"');
    expect(screen).toContain('label="Harbor"');
  });

  it('gives Harbor Mini the built-in status and Harbor the install toggle', () => {
    expect(screen).toContain('bundled={HARBOR_MINI_BUNDLED}');
    expect(screen).toContain('onInstall={() => void installHarbor()}');
    expect(screen).toContain('onUninstall={() => void uninstallHarbor()}');
  });
});

describe('the guide bylines', () => {
  it('are each a single em-dash-free sentence', () => {
    for (const byline of [HARBOR_BYLINE, HARBOR_MINI_BYLINE]) {
      expect(byline).not.toMatch(NO_EM_DASH);
      expect(oneSentence(byline)).toBe(true);
    }
  });

  it('name what each guide is for', () => {
    expect(HARBOR_MINI_BYLINE.toLowerCase()).toContain('guide');
    expect(HARBOR_MINI_BYLINE.toLowerCase()).toContain('limit');
    expect(HARBOR_BYLINE.toLowerCase()).toContain('coding agent');
  });
});

describe('the front-end open, backend private disclosure boundary', () => {
  it('is stated once in the shared knowledge', () => {
    expect(APP_KNOWLEDGE.toLowerCase()).toContain('front-end');
    expect(APP_KNOWLEDGE.toLowerCase()).toContain('backend build internals');
  });

  it('rides into both guide personas', () => {
    for (const prompt of [buildHarborSystemPrompt(), buildHarborMiniSystemPrompt()]) {
      const lower = prompt.toLowerCase();
      expect(lower).toContain('never reveal backend build internals');
      expect(lower).toContain('grounded in its own repository');
    }
  });

  it('has Harbor Mini own its limits and point to a bigger model', () => {
    const mini = buildHarborMiniSystemPrompt().toLowerCase();
    expect(mini).toContain('know your limits');
    expect(mini).toContain('bigger model');
  });
});
