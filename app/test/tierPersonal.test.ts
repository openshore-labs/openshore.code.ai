// A Personal (v1) build, loaded as one (docs/release-tiers.md). The suite runs
// at tier 4, so these reload the modules with VITE_RELEASE_TIER unset and
// check what a shipped build actually carries: the guide knows only v1 rooms,
// the privacy list names only what can happen, and every later-tier door the
// store and the screens used to open is shut behind the one gate.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function asPersonal<T>(path: string): Promise<T> {
  vi.stubEnv('VITE_RELEASE_TIER', '');
  vi.resetModules();
  return (await import(path)) as T;
}

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

describe('a Personal build, loaded as one', () => {
  it('is tier 1', async () => {
    const focus = await asPersonal<typeof import('../src/lib/focus.js')>('../src/lib/focus.js');
    expect(focus.RELEASE_TIER).toBe(1);
  });

  it("the guide's cards name only v1 rooms", async () => {
    const { GUIDE_CARDS } = await asPersonal<typeof import('../src/lib/guideCards.js')>(
      '../src/lib/guideCards.js',
    );
    const ids = GUIDE_CARDS.map((c) => c.id);
    for (const later of ['stack-health', 'launch', 'agentic-currents', 'harness-currents']) {
      expect(ids, later).not.toContain(later);
    }
    for (const v1 of [
      'my-crew',
      'routines',
      'terminal',
      'vault',
      'pair-phone',
      'repositories',
      'library',
    ]) {
      expect(ids, v1).toContain(v1);
    }
    const text = GUIDE_CARDS.map((c) => c.text).join('\n');
    expect(text).not.toMatch(/Stack Health|Launch with Codemagic|Admin \(|its currents/);
    // The Local Library is a v1 room since 2026-10-11, and live, never Coming soon.
    expect(text).toMatch(/Local Library/);
    expect(text).not.toMatch(/Coming soon/i);
    // The old claim was false: chats live on the device.
    expect(text).not.toMatch(/syncs your chats/);
    // The account carries no chats; they sync device to device through the
    // person's own computer (Sync on all devices, 2026-10-16).
    expect(GUIDE_CARDS.find((c) => c.id === 'account')!.text).toMatch(
      /account never carries chats/,
    );
  });

  it("the guide's grounding facts name only v1 rooms", async () => {
    const { APP_KNOWLEDGE } = await asPersonal<typeof import('../src/lib/guideKnowledge.js')>(
      '../src/lib/guideKnowledge.js',
    );
    expect(APP_KNOWLEDGE).not.toMatch(/Launch with Codemagic|Currents on the project/);
    expect(APP_KNOWLEDGE).toMatch(/The Local Library \(in the Menu\)/);
    expect(APP_KNOWLEDGE).not.toMatch(/Coming soon/i);
    expect(APP_KNOWLEDGE).toMatch(/Crew command/);
  });

  it('carries no current, no later guide, and no later room name', async () => {
    const { AGENTIC_CURRENTS } =
      await asPersonal<typeof import('../src/lib/currents.js')>('../src/lib/currents.js');
    expect(AGENTIC_CURRENTS).toEqual([]);
    const { HARNESS_CURRENTS } = await asPersonal<typeof import('../src/lib/harnessCurrents.js')>(
      '../src/lib/harnessCurrents.js',
    );
    expect(HARNESS_CURRENTS).toEqual([]);
    const { SETUP_GUIDES, guideStepsCompact } = await asPersonal<
      typeof import('../src/lib/setupGuides.js')
    >('../src/lib/setupGuides.js');
    for (const later of [
      'connect-codemagic',
      'connect-hermes',
      'cli-pairing',
      'connect-a2a',
      'connect-jev',
    ] as const) {
      expect(SETUP_GUIDES[later], later).toBeUndefined();
      expect(guideStepsCompact(later), later).toBe('');
    }
    for (const v1 of ['get-harbor', 'pair-computer', 'set-up-crew'] as const) {
      expect(SETUP_GUIDES[v1], v1).toBeDefined();
    }
    const { ROOM_LABELS } =
      await asPersonal<typeof import('../src/lib/navRooms.js')>('../src/lib/navRooms.js');
    expect([ROOM_LABELS.stackhealth, ROOM_LABELS.launch]).toEqual(['', '']);
    // The Local Library is a v1 room since 2026-10-11.
    expect(ROOM_LABELS.library).toBe('Local Library');
    expect(ROOM_LABELS.vault).toBe('Vault');
  });

  it('the privacy list names only what can happen', async () => {
    const { egressByRecipient } = await asPersonal<typeof import('../src/lib/egressManifest.js')>(
      '../src/lib/egressManifest.js',
    );
    const ids = egressByRecipient().flatMap((g) => g.entries.map((e) => e.id));
    for (const later of ['team', 'decisions', 'codemagic', 'agents'])
      expect(ids).not.toContain(later);
  });

  it("the profile's not-copied line is the whole claim, and a team's line names what it keeps", async () => {
    const { notCopiedLine } =
      await asPersonal<typeof import('../src/lib/profile.js')>('../src/lib/profile.js');
    expect(notCopiedLine()).toBe(
      'OpenShore does not copy your chats, projects, keys, or vault to your account.',
    );
    expect(notCopiedLine(true)).toMatch(/^OpenShore does not copy your own chats/);
    expect(notCopiedLine(true)).toMatch(/addresses it invites are kept on our server/);
    // One name per thing: what the team keeps is its project settings, the
    // words the team entry in What leaves this device uses.
    expect(notCopiedLine(true)).toContain("A team's name, project settings, vault notes");
  });
});

describe('every later-tier door the store and the screens opened is shut', () => {
  const store = read('src', 'state', 'store.ts');

  it('no current, Codemagic token, or probe reaches a session or runs at launch', () => {
    expect(store).toContain("if (settings.codemagicAccess && featureOn('launch'))");
    expect(store).toMatch(
      /const currentsOn = featureOn\('currents'\);\s*const currents = currentsOn/,
    );
    expect(store).toMatch(
      /featureOn\('currents'\) \? \(project\?\.harnessCurrent \?\? null\) : null/,
    );
    expect(store).toMatch(/codemagicAccess:\s*featureOn\('launch'\) &&/);
    const refresh = store.slice(store.indexOf('    async refreshCurrents() {'));
    expect(refresh.slice(0, 200)).toContain("if (!featureOn('currents')) return;");
  });

  it('the Harbor download stays in place instead of opening the Local Library', () => {
    for (const name of ['beginHarborMiniWithIntro() {', 'beginHarborWithIntro() {']) {
      const start = store.indexOf(`    ${name}`);
      expect(start, name).toBeGreaterThan(0);
      const body = store.slice(start, store.indexOf('\n    },\n', start));
      expect(body, name).not.toContain("view: 'library'");
      expect(body, name).not.toContain('libraryIntro: true');
    }
  });

  it('sign-in claims no seat and syncs no organization; a new account is Personal', () => {
    const signedIn = store.slice(store.indexOf("supabaseRpc('claim_membership'") - 400);
    expect(signedIn.slice(0, 500)).toContain("if (featureOn('teams')) {");
    expect(store).toContain("if (featureOn('teams')) set({ accountChoice: true });");
    expect(store).toContain("else await get().saveSettings({ account: { type: 'personal' } });");
    expect(store).toContain("if (input.type === 'personal' || !featureOn('teams')) {");
    const teamVault = store.slice(store.indexOf('    teamVaultAvailable() {'));
    expect(teamVault.slice(0, 200)).toContain("if (!featureOn('teams')) return false;");
  });

  it('the screens hide the Business choice, joining an org, Launch, Stack Health, Admin, and sharing', () => {
    const app = read('src', 'App.tsx');
    expect(app).toContain("const choosingAccount = Boolean(accountChoice) && featureOn('teams');");
    // The teams sheets are not even loaded without the tier (test/tierBundle).
    expect(app).toMatch(/const OrgJoinSheet =\s*BUILT_V4 && featureOn\('teams'\)/);
    expect(app).toMatch(/const AccountSetup =\s*BUILT_V4 && featureOn\('teams'\)/);
    const settings = read('src', 'screens', 'SettingsScreen.tsx');
    expect(settings).toContain('const shHub = SHIPS_STACKHEALTH ? settings.daemon : undefined;');
    expect(settings).toContain('SHIPS_STACKHEALTH && shHub ?');
    expect(settings).toContain('SHIPS_LAUNCH && codemagicConnected ?');
    expect(settings).toMatch(/SHIPS_ADMIN &&\s*signedIn && account\?\.type === 'commercial'/);
    const project = read('src', 'screens', 'ProjectDetailScreen.tsx');
    expect(project).toContain("const isCommercial = teams && account?.type === 'commercial';");
    expect(project).toContain('teams && project.shared ?');
  });
});

describe('a Current placed by an earlier build', () => {
  it('sits out of a Personal turn without losing its saved placement', async () => {
    const { stackForTier } = await import('../src/state/store.js');
    const current = { kind: 'byom', id: 'current-hermes', label: 'Hermes' } as never;
    const local = { kind: 'byom', id: 'my-box', label: 'My box' } as never;
    const stack = {
      reasoning: current,
      active: [
        { ref: current, placement: { category: 'coding' } },
        { ref: local, placement: { category: 'writing' } },
      ],
      saved: { 'byom:current-hermes': { category: 'coding' } },
    } as never;
    const personal = stackForTier(stack, 1) as {
      reasoning: { kind: string };
      active: Array<{ ref: { id: string } }>;
      saved: Record<string, unknown>;
    };
    expect(personal.reasoning.kind).not.toBe('byom');
    expect(personal.active.map((m) => m.ref.id)).toEqual(['my-box']);
    expect(personal.saved['byom:current-hermes']).toBeDefined();
    expect(stackForTier(stack, 2)).toBe(stack);
  });
});
