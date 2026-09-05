// The two Harbor guides as they appear in Settings: Harbor Light bundled with
// the app (Built in, not removable) and Harbor as a real install/uninstall
// download. Plus the disclosure boundary both guides carry: open about every
// front-end feature, silent on backend build internals. Kept in tests so a copy
// or scope change cannot quietly regress the promise.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HARBOR_BYLINE, buildHarborSystemPrompt } from '../src/lib/harbor.js';
import {
  HARBOR_MINI_APPROX_LABEL,
  HARBOR_MINI_BUNDLED,
  HARBOR_MINI_BYLINE,
  HARBOR_MINI_EMPTY_HINT,
  HARBOR_MINI_FIRST_MOVES,
  HARBOR_MINI_GREETING,
  HARBOR_MINI_HANDOFF_LINE,
  HARBOR_MINI_MODEL_ID,
  HARBOR_MINI_MODEL_NAME,
  HARBOR_MINI_MODEL_URL,
  buildHarborMiniSystemPrompt,
} from '../src/lib/harborMini.js';
import { APP_KNOWLEDGE } from '../src/lib/guideKnowledge.js';
import { SETUP_GUIDES, guideStepsCompact } from '../src/lib/setupGuides.js';

// The em dash and its encoded spellings, assembled from pieces so the
// repo-wide em-dash guard, which scans test files too, never reads the glyph
// or a spelling out of this file.
const EM_DASH = String.fromCharCode(0x2014);
const NO_EM_DASH = new RegExp([EM_DASH, '&' + 'mdash;', '&#x' + '2014;', '&#' + '8212;'].join('|'));

function oneSentence(s: string): boolean {
  // A single trailing sentence: exactly one period, and it is the last char.
  return s.trim().endsWith('.') && (s.match(/\./g) ?? []).length === 1;
}

describe('Harbor Light is bundled (native with the app)', () => {
  it('declares itself bundled', () => {
    expect(HARBOR_MINI_BUNDLED).toBe(true);
  });

  it('stays small enough to bundle under the app download budget', () => {
    // The whole App Store download is capped at 170 MB with Mini bundled, so a
    // bundled guide must be measured in MB, not GB. A swap to a GB-scale model
    // (the old Qwen2.5-0.5B was 380 MB) trips this before it ships.
    expect(HARBOR_MINI_APPROX_LABEL).toMatch(/\bMB\b/);
    expect(HARBOR_MINI_APPROX_LABEL).not.toMatch(/\bGB\b/);
    const mb = Number(HARBOR_MINI_APPROX_LABEL.match(/(\d+)\s*MB/)?.[1]);
    expect(mb).toBeGreaterThan(0);
    expect(mb).toBeLessThanOrEqual(150);
    // The bundled weights are a real Hugging Face source, matching the URL the
    // build fetches them from.
    expect(HARBOR_MINI_MODEL_URL).toMatch(/^https:\/\/huggingface\.co\//);
    expect(HARBOR_MINI_MODEL_URL).toMatch(/\.gguf$/);
  });

  it('the native ModelStore treats harbor-mini as a bundled model', () => {
    const swift = readFileSync(
      join(process.cwd(), 'plugins/oscode-llama/ios/Sources/OscodeLlamaPlugin/ModelStore.swift'),
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
    expect(screen).toContain('label="Harbor Light"');
    expect(screen).toContain('label="Harbor"');
  });

  it('gives Harbor Light the built-in status and Harbor the install toggle', () => {
    expect(screen).toContain('bundled={HARBOR_MINI_BUNDLED}');
    expect(screen).toContain('onInstall={() => void installHarbor()}');
    expect(screen).toContain('onUninstall={() => void uninstallHarbor()}');
  });
});

describe('the guide bylines', () => {
  it('are em-dash free and short enough for a row', () => {
    for (const byline of [HARBOR_BYLINE, HARBOR_MINI_BYLINE]) {
      expect(byline).not.toMatch(NO_EM_DASH);
      expect(byline.length).toBeGreaterThan(0);
      expect(byline.length).toBeLessThanOrEqual(140);
    }
  });

  it('keeps Harbor a one-sentence capability line', () => {
    expect(oneSentence(HARBOR_BYLINE)).toBe(true);
    expect(HARBOR_BYLINE.toLowerCase()).toContain('coding agent');
  });

  it('gives Harbor Light its "always on" promise (Creative Studio)', () => {
    const b = HARBOR_MINI_BYLINE.toLowerCase();
    expect(b).toContain('built in');
    expect(b).toContain('offline');
    expect(b).toContain('always on');
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

  it('has Harbor Light own its limits and point to a bigger model', () => {
    const mini = buildHarborMiniSystemPrompt().toLowerCase();
    expect(mini).toContain('know your limits');
    expect(mini).toContain('bigger model');
  });
});

describe('Harbor Light is optimized for guiding, not building', () => {
  const prompt = buildHarborMiniSystemPrompt();

  it('scopes it to navigation plus honest handoff, not real work', () => {
    const lower = prompt.toLowerCase();
    expect(lower).toContain('you are a guide, not a builder');
    expect(lower).toContain('do not write real code');
  });

  it('recites the three activation walkthroughs verbatim from the setup guides', () => {
    // A tiny model reciting scripts, not reasoning them out. The scripts are the
    // single source in setupGuides.ts, so they cannot drift from the real UI.
    expect(prompt).toContain('ACTIVATION STEPS');
    for (const id of ['get-harbor', 'connect-cloud-key', 'pick-a-model'] as const) {
      const steps = guideStepsCompact(id);
      expect(steps).toMatch(/^1\. /);
      expect(prompt).toContain(steps);
    }
  });

  it('routes the three upgrades the founder named', () => {
    const lower = prompt.toLowerCase();
    expect(lower).toContain('get harbor');
    expect(lower).toContain('cloud key');
    expect(lower).toContain('marketplace');
  });
});

describe('a get-harbor walkthrough exists and is accurate to the Settings row', () => {
  it('walks the Harbor install from the Settings Harbor row', () => {
    const g = SETUP_GUIDES['get-harbor'];
    expect(g).toBeTruthy();
    const joined = g.steps.map((s) => (typeof s === 'string' ? s : s.text)).join(' ');
    expect(joined).toContain('Settings');
    expect(joined).toContain('Install');
  });
});

describe('the rename to Harbor Light keeps a stable slot', () => {
  it('shows "Harbor Light" but keeps the id and bundle on harbor-mini', () => {
    expect(HARBOR_MINI_MODEL_NAME).toBe('Harbor Light');
    // The wire id is the stable slot: persisted settings, stack refs, and the
    // bundled harbor-mini.gguf ride it, so it never changes on a rename.
    expect(HARBOR_MINI_MODEL_ID).toBe('harbor-mini');
  });

  it('leaves no "Harbor Mini" in the shipping app copy', () => {
    for (const rel of [
      'src/lib/harborMini.ts',
      'src/lib/harbor.ts',
      'src/lib/guideKnowledge.ts',
      'src/components/StartingPaths.tsx',
      'src/screens/SettingsScreen.tsx',
    ]) {
      expect(readFileSync(join(process.cwd(), rel), 'utf8')).not.toContain('Harbor Mini');
    }
  });
});

describe('the remaining Creative Studio microcopy is wired', () => {
  it('gives a Harbor Light chat its "always here" resting prompt', () => {
    expect(HARBOR_MINI_EMPTY_HINT).not.toMatch(NO_EM_DASH);
    const chat = readFileSync(join(process.cwd(), 'src/screens/ChatScreen.tsx'), 'utf8');
    expect(chat).toContain('HARBOR_MINI_EMPTY_HINT');
    expect(chat).toContain('placeholder=');
  });

  it('speaks the handoff line when a bigger model starts coming down', () => {
    expect(HARBOR_MINI_HANDOFF_LINE).not.toMatch(NO_EM_DASH);
    const settings = readFileSync(join(process.cwd(), 'src/screens/SettingsScreen.tsx'), 'utf8');
    expect(settings).toContain('HARBOR_MINI_HANDOFF_LINE');
  });
});

describe('the delightful first-run (Creative Studio: The Standing Light)', () => {
  it('greets warmly, is honest, offline, and ends by inviting a first move', () => {
    expect(HARBOR_MINI_GREETING).not.toMatch(NO_EM_DASH);
    expect(HARBOR_MINI_GREETING.toLowerCase()).toContain('built into the app');
    expect(HARBOR_MINI_GREETING.trim().endsWith('?')).toBe(true);
  });

  it('offers three or four short, em-dash-free First Moves', () => {
    expect(HARBOR_MINI_FIRST_MOVES.length).toBeGreaterThanOrEqual(3);
    expect(HARBOR_MINI_FIRST_MOVES.length).toBeLessThanOrEqual(4);
    for (const move of HARBOR_MINI_FIRST_MOVES) {
      expect(move.trim()).toBe(move);
      expect(move.length).toBeGreaterThan(0);
      expect(move.length).toBeLessThanOrEqual(30);
      expect(move).not.toMatch(NO_EM_DASH);
    }
  });

  it('wires the First Moves into a fresh Harbor Light chat', () => {
    const chat = readFileSync(join(process.cwd(), 'src/screens/ChatScreen.tsx'), 'utf8');
    expect(chat).toContain('MiniFirstMoves');
    expect(chat).toContain('HARBOR_MINI_MODEL_ID');
  });

  it('makes the built-in guide the onboarding hero, others a "go further" tier', () => {
    const paths = readFileSync(join(process.cwd(), 'src/components/StartingPaths.tsx'), 'utf8');
    expect(paths).toContain('Harbor Light is already here');
    expect(paths).toContain('Say hello');
    expect(paths).toContain("When you're ready to go further");
  });
});
