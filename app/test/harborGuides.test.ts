// The two Harbor guides as they appear in Settings: Harbor Lite bundled with
// the app (Built in, not removable) and Harbor as a real install/uninstall
// download. Plus the disclosure boundary both guides carry: open about every
// front-end feature, silent on backend build internals. Kept in tests so a copy
// or scope change cannot quietly regress the promise.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  HARBOR_MINI_ROW_SUB,
  buildHarborMiniSystemPrompt,
} from '../src/lib/harborMini.js';
import { APP_KNOWLEDGE } from '../src/lib/guideKnowledge.js';
import { GUIDE_CARDS } from '../src/lib/guideCards.js';
import { setupAdvice } from '../src/lib/guideHarness.js';
import { SETUP_GUIDES, guideStepsCompact } from '../src/lib/setupGuides.js';

// The em dash and its encoded spellings, assembled from pieces so the
// repo-wide em-dash guard, which scans test files too, never reads the glyph
// or a spelling out of this file.
const EM_DASH = String.fromCharCode(0x2014);
const NO_EM_DASH = new RegExp([EM_DASH, '&' + 'mdash;', '&#x' + '2014;', '&#' + '8212;'].join('|'));

describe('Harbor Lite is bundled (native with the app)', () => {
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
    expect(screen).toContain('label="Harbor Lite"');
    expect(screen).toContain('label="Harbor"');
  });

  it('gives Harbor Lite the built-in status and Harbor the install toggle', () => {
    expect(screen).toContain('bundled={HARBOR_MINI_BUNDLED}');
    expect(screen).toContain('onInstall={() => void installHarbor()}');
    expect(screen).toContain("onUninstall={() => setSheet('uninstallHarbor')}");
  });

  it('asks before Uninstall removes Harbor, Keep first then a danger button', () => {
    // A stray tap while scrolling Settings must not remove the model.
    expect(screen).not.toContain('onUninstall={() => void uninstallHarbor()}');
    const at = screen.indexOf("sheet === 'uninstallHarbor'");
    expect(at).toBeGreaterThan(-1);
    const block = screen.slice(at, screen.indexOf('</Sheet>', at));
    expect(block).toContain('variant="confirm"');
    expect(block).toMatch(/<h3>Uninstall Harbor\?<\/h3>/);
    expect(block.indexOf('btn ghost')).toBeLessThan(block.indexOf('btn danger'));
    expect(block).not.toMatch(/btn primary/);
    expect(block).toContain('void uninstallHarbor()');
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

  it('keeps Harbor a short capability line that calls it a coding model, not an agent', () => {
    expect(HARBOR_BYLINE.trim().endsWith('.')).toBe(true);
    expect((HARBOR_BYLINE.match(/\./g) ?? []).length).toBeLessThanOrEqual(2);
    expect(HARBOR_BYLINE.toLowerCase()).toContain('coding model');
    expect(HARBOR_BYLINE.toLowerCase()).not.toContain('agent');
  });

  it('gives Harbor Lite its standing-light promise, without "always on" (brand sweep)', () => {
    const b = HARBOR_MINI_BYLINE.toLowerCase();
    expect(b).toContain('built in');
    expect(b).toContain('offline');
    expect(b).toContain('first launch');
    expect(b).not.toContain('always on');
  });

  it("says Built in once on Settings' Harbor Lite row, where Built in is the value", () => {
    expect(HARBOR_MINI_ROW_SUB.toLowerCase()).not.toContain('built in');
    expect(HARBOR_MINI_BYLINE).toBe(`Built in. ${HARBOR_MINI_ROW_SUB}`);
    const screen = readFileSync(join(process.cwd(), 'src/screens/SettingsScreen.tsx'), 'utf8');
    expect(screen).toContain('sub={HARBOR_MINI_ROW_SUB}');
    expect(screen).not.toContain('HARBOR_MINI_BYLINE');
  });
});

describe('the front-end open, backend private disclosure boundary', () => {
  it('is stated once in the shared knowledge', () => {
    expect(APP_KNOWLEDGE.toLowerCase()).toContain('front-end');
    expect(APP_KNOWLEDGE.toLowerCase()).toContain('backend build internals');
  });

  it('rides into both guide personas', () => {
    const harbor = buildHarborSystemPrompt().toLowerCase();
    expect(harbor).toContain('never reveal backend build internals');
    expect(harbor).toContain('grounded in its own repository');
    expect(buildHarborMiniSystemPrompt().toLowerCase()).toContain(
      'never reveal how openshore is built under the hood',
    );
  });

  it('has Harbor Lite own its limits and point to a bigger model', () => {
    const mini = buildHarborMiniSystemPrompt().toLowerCase();
    expect(mini).toContain('you are small, and you say so honestly');
    expect(mini).toContain('harbor (a coding model on the phone)');
    expect(mini).toContain('deepblue (a coding agent on their computer)');
  });
});

describe('Harbor Lite is optimized for guiding, not building', () => {
  it('scopes it to guidance plus honest handoff, not real work', () => {
    const lower = buildHarborMiniSystemPrompt().toLowerCase();
    expect(lower).toContain('you do not write real code');
    expect(lower).toContain('never invent a feature');
  });

  it('recites each activation walkthrough verbatim when asked about it', () => {
    // A tiny model reciting scripts, not reasoning them out. The scripts are the
    // single source in setupGuides.ts, so they cannot drift from the real UI;
    // the guide harness hands over the one a question asks about.
    const asks: Array<[Parameters<typeof guideStepsCompact>[0], string]> = [
      ['get-harbor', 'How do I get Harbor?'],
      ['get-harbor-master', 'How do I install DeepBlue?'],
      ['connect-cloud-key', 'How do I connect my Claude key?'],
      ['pair-computer', 'How do I pair my computer?'],
      ['open-a-repo', 'How do I add a repository?'],
      ['connect-codemagic', 'How do I set up Codemagic?'],
    ];
    for (const [id, ask] of asks) {
      const steps = guideStepsCompact(id);
      expect(steps).toMatch(/^1\. /);
      expect(buildHarborMiniSystemPrompt(ask)).toContain(steps);
    }
  });

  it('routes a coding ask to the upgrades a maintainer named', () => {
    const lower = buildHarborMiniSystemPrompt('Write me a Python script').toLowerCase();
    expect(lower).toContain('suggest harbor on the phone or deepblue on their computer');
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

describe('the rename to Harbor Lite keeps a stable slot', () => {
  it('shows "Harbor Lite" but keeps the id and bundle on harbor-mini', () => {
    expect(HARBOR_MINI_MODEL_NAME).toBe('Harbor Lite');
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

describe('the remaining design review microcopy is wired', () => {
  it('gives a Harbor Lite chat its "always here" resting prompt', () => {
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

describe('the delightful first-run (design review: The Standing Light)', () => {
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

  it('wires the First Moves into a fresh Harbor Lite chat', () => {
    const chat = readFileSync(join(process.cwd(), 'src/screens/ChatScreen.tsx'), 'utf8');
    expect(chat).toContain('MiniFirstMoves');
    expect(chat).toContain('HARBOR_MINI_MODEL_ID');
  });

  // Maintainer, 2026-09-23: a new person opens straight into Harbor Lite's chat,
  // not a setup wall and not a Personal-or-Business question. The setup page
  // is the optional tier, reached from a button under the greeting.
  it('opens a new person into the built-in guide chat, with setup one tap away', () => {
    const store = readFileSync(join(process.cwd(), 'src/state/store.ts'), 'utf8');
    expect(store).toContain("view: 'chat',");
    expect(store).not.toMatch(/\? 'chat' : 'onboarding'/);
    // First open starts the guided walk in Harbor Lite's chat, without
    // waiting on the model (guidedSetup.test.ts proves the timing).
    expect(store).toContain('void get().beginGuidedSetup()');
    const chat = readFileSync(join(process.cwd(), 'src/screens/ChatScreen.tsx'), 'utf8');
    expect(chat).toContain('<GuideSetupLink');
    expect(chat).toContain("setView('onboarding')");
    expect(HARBOR_MINI_GREETING).toContain('Set up OpenShore');
    const paths = readFileSync(join(process.cwd(), 'src/components/StartingPaths.tsx'), 'utf8');
    expect(paths).not.toContain('Say hello');
    // One lead, on the page itself: the old "go further" label is gone. The
    // Harbor card is one tap with one line (D9, 2026-10-07, which
    // replaces the byline's two sentences there): what it is, on the device
    // in hand, and its size.
    expect(paths).not.toContain('paths-further-head');
    expect(paths).toContain('`A coding model on ${thisDeviceNoun()}, ${HARBOR_APPROX_LABEL}`');
    expect(paths).not.toContain('Real reasoning');
    const page = readFileSync(join(process.cwd(), 'src/screens/OnboardingScreen.tsx'), 'utf8');
    // Its last two words hold together on a narrow window (Slide Over).
    expect(page).toContain("SETUP_LEAD_TAIL = 'Everything below is\\u00a0optional.'");
    expect(page).toContain('<BackBar');
  });

  it('asks Personal or Business only when an account is created', () => {
    const onboarding = readFileSync(
      join(process.cwd(), 'src/screens/OnboardingScreen.tsx'),
      'utf8',
    );
    expect(onboarding).not.toContain('AccountSetup');
    const store = readFileSync(join(process.cwd(), 'src/state/store.ts'), 'utf8');
    const signUp = store.slice(store.indexOf('async signUpAccount('));
    expect(signUp.slice(0, 800)).toContain('accountChoice: true');
    const setup = readFileSync(join(process.cwd(), 'src/components/AccountSetup.tsx'), 'utf8');
    expect(setup).toContain('<h3>Business</h3>');
  });
});

// UX and copy review, 2026-10-08 (D, E, K): a plan never carries a picture, so the
// maintainer's 2026-10-07 exception is gone from every guide; a cloud model runs
// only when the person picks or places it; and with both Image reading slots
// set, the Cloud model takes a picture the Local one failed on only after a
// card. The guides say it in the words What leaves this device backs.
describe('the guides say when a cloud model runs, with no exception', () => {
  const card = (id: string) => GUIDE_CARDS.find((c) => c.id === id)!.text;
  const EXCEPTION =
    /one exception|except that|image step goes to (?:a connected|one|Claude|that model)/i;

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('reading images: the Local model first, a card before the Cloud one, a plan on the text', () => {
    expect(card('image-reading')).toMatch(
      /^A picture in a Stack chat goes to the model set under Image reading, without asking\. With both set, the Local model reads first, and the Cloud model takes a picture the Local one failed on only after you approve\. With none set, another model that can read it \(your Reasoning model, or a cloud model you connected\) gets it after you approve\. A plan never carries a picture, so with none set its image step goes to your Reasoning model, which works from the text\. When nothing can read images, the chat says so and offers two ways: Source a local model/,
    );
  });

  it('the Bench, Cloud Connections and Privacy cards', () => {
    expect(card('bench')).toBe(
      'Models you download or connect wait on the Bench until you place them. Teal is local and private, amber is cloud. Tap Add to stack, choose a category, and optionally a trigger, a persona, and effort.',
    );
    expect(card('cloud-connections')).toContain(
      'API keys are stored only on your device and sent only to their provider, except a key you turn on for your server, which is kept there too. A cloud model runs, and spends, only when you pick it or place it. How:',
    );
    expect(card('privacy')).toMatch(
      /What leaves this device: a cloud model you chose, a web search you allowed, update checks, the model list, and your account while signed in\.$/,
    );
    for (const c of GUIDE_CARDS) expect(c.text, c.id).not.toMatch(EXCEPTION);
  });

  it("Harbor Lite's setup advice and knowledge", async () => {
    expect(setupAdvice({ ramGB: 16 })).toContain(
      'Add a cloud API key under Cloud Connections only if you want the strongest model for hard tasks; it spends on your key only when you pick it or place it.',
    );
    expect(APP_KNOWLEDGE).toContain(
      'under Cloud Connections; it spends on your key only when you pick it or place it.',
    );
    expect(APP_KNOWLEDGE).not.toMatch(EXCEPTION);
    // A Personal build carries the Marketplace (v1 since 2026-10-11) and
    // still names the plain way to connect a cloud model.
    vi.stubEnv('VITE_RELEASE_TIER', '');
    vi.resetModules();
    const personal = (await import('../src/lib/guideKnowledge.js')).APP_KNOWLEDGE;
    expect(personal).toContain(
      "Connect one by adding that provider's API key under Cloud Connections; it then runs on your own key, and only once you pick it or place it in your Stack.",
    );
    expect(personal).not.toMatch(EXCEPTION);
  });
});
