// The Vault M7 components (stream G; CTO L9, L11, L12, L15, L16; CX Y1 to
// Y13, Y16, Y17), mounted in a small real DOM:
// - Vault settings: seven sections in Y1's order; Team hides sections 2 and
//   3; the phone drops Link paths and every "From your computer's config"
//   row; a field Obsidian sets is read-only "From Obsidian" and expands its
//   one line; a widening ask is one quiet line; changes hand up one patch at
//   a time ("Default" is null); the status line says Saving then Saved; a
//   same-field conflict offers "Use {yours}"; an unreadable file locks every
//   file row but leaves "On this device" working; Room for notes shows its
//   amber spend line only with a cloud seat; a pick waits for the exit;
// - the provenance chip: teal only for local, amber only for cloud, and the
//   word Local or Cloud always on it, reviewed too;
// - About this note: its rows, Mark as reviewed and not reviewed, and the
//   refusal and failure lines in place;
// - the starter sheet: everything shown before anything is written;
// and no line any of them renders claims a speed, a quality, a memory, or
// always (M7_BANNED), nor uses a retired glossary word.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VAULT_SETTINGS_FIELDS } from 'os-code/protocol';
import type {
  NoteProvenance,
  ResolvedVaultSettings,
  VaultSettingsField,
  VaultSettingsPatch,
} from 'os-code/protocol';
import { mountDom, type TestDom } from './support/dom.js';
import type {
  VaultSettingsSheetCopy,
  VaultSettingsSheetProps,
} from '../src/components/vault/VaultSettingsSheet.js';

const haptics = vi.hoisted(() => ({ commit: 0 }));
vi.mock('../src/lib/haptics.js', () => ({
  hapticTick: () => {},
  hapticApproval: () => {},
  hapticSuccess: () => {},
  hapticCommit: () => {
    haptics.commit += 1;
  },
}));

let dom: TestDom;
beforeEach(async () => {
  dom = await mountDom();
  haptics.commit = 0;
});
afterEach(async () => {
  await dom.unmount();
  vi.useRealTimers();
});

const M7_BANNED = [
  /\b(faster|slower|quicker|cheaper|saves? (?:time|money)|better|smarter|remembers?|learns?|always)\b/i,
  /picks? up where (?:you|it) left off/i,
  /\bRead only\b/,
  /\bRetry\b/,
  /\bSetup\b/,
  /\bAlways on\b/,
  /successfully/i,
];

function expectClean(text: string) {
  for (const re of M7_BANNED) expect(text, String(re)).not.toMatch(re);
}

async function tap(el: Element | null | undefined) {
  if (!el) throw new Error('nothing to tap');
  const { act } = await import('react');
  await act(async () => {
    el.dispatchEvent(new (globalThis as any).window.Event('click', { bubbles: true }));
  });
}

async function key(el: Element, k: string) {
  const { act } = await import('react');
  const ev = new (globalThis as any).window.Event('keydown', { bubbles: true });
  Object.assign(ev, { key: k });
  await act(async () => {
    el.dispatchEvent(ev);
  });
}

const $ = (sel: string) => dom.container.querySelector(sel);
const $$ = (sel: string) => [...dom.container.querySelectorAll(sel)];

// ---------------------------------------------------------------- fixtures

/** CX Y1 to Y10's lines, verbatim where the memo gives them. */
const COPY: VaultSettingsSheetCopy = {
  title: 'Vault settings',
  sections: {
    notes: 'Notes',
    models: 'Models and your notes',
    device: 'On this device',
    today: "Today's note",
    links: 'Links and files',
    editor: 'Editor',
    where: 'Where it lives',
  },
  saving: 'Saving',
  saved: 'Saved',
  savedMerged: 'Saved. Some other settings changed somewhere else and show here now.',
  saveFailed: 'Could not save that setting, so nothing changed. Try again in a moment.',
  firstChange:
    'The first change adds a small .oscode folder beside your notes to keep these settings.',
  unreadable:
    '.oscode/vault.json could not be read, so these show the defaults and cannot change here. Fix or delete that file to change them.',
  conflict: (field, theirs) =>
    `${field} changed somewhere else while this was open, so yours was not saved. It is ${theirs} now.`,
  useYours: (yours) => `Use ${yours}`,
  fromObsidian: 'From Obsidian',
  fromObsidianLine: 'Set in Obsidian. Change it there, and OpenShore follows.',
  obsidianKeepsOwn: 'Obsidian keeps its own setting for this.',
  obsidianExcluded: 'Excluded in Obsidian',
  obsidianExcludedSub: 'Left out of search and link suggestions here too.',
  fromMachine: "From your computer's config",
  builtIn: "Built in. Only your computer's config can change these.",
  setAside: (plain) =>
    `This vault's settings file also asks to ${plain}. A settings file can only narrow what models see, so that part is set aside.`,
  topOfVault: 'Top of the vault',
  newNotesCurrent: 'Beside the open note',
  none: 'None',
  attachmentsValue: (s) => (s ? s : 'Top of the vault'),
  newNotesIn: 'New notes go in',
  openIn: 'Open notes in',
  openRead: 'Reading',
  openEdit: 'Editing',
  sortBy: 'Sort notes by',
  sortName: 'Name',
  sortModified: 'Last edited',
  sortCreated: 'Created',
  deleteLabel: 'Delete',
  deleteTrash: 'To Trash',
  deleteForGood: 'For good',
  deleteForGoodSub: 'Deletes skip Trash and ask twice.',
  excluded: 'Notes models never see',
  excludedSub: 'Models never see these, in any chat.',
  localOnly: 'Notes that stay on this computer',
  localOnlySub: 'A local model may read these. Nothing here goes to a cloud model.',
  addFolder: 'Add a folder',
  addTag: 'Add a tag',
  tagPlaceholder: 'Tag',
  remove: (item) => `Remove ${item}`,
  agentWrites: 'Your agent writes in',
  agentWritesSub: 'Your agent writes only here, and still asks first.',
  agentAnywhere: 'Anywhere in this vault',
  notesInChats: 'Notes in chats',
  notesInChatsSub:
    "Each chat starts with this project's Current State and any notes you pinned. A card shows what went. Off applies to new chats.",
  handoff: 'Handoff',
  handoffSub:
    'When you switch models in a chat, the next one starts with a short summary of the work so far. Off applies to new chats.',
  projectOff: "This project's settings turn this off.",
  memoryOff: 'Memory is off, so chats carry no notes.',
  room: 'Room for notes',
  roomSub:
    "How much of each model's room your notes may take. It scales with the model, so a smaller model gets less.",
  roomSmall: 'Small',
  roomNormal: 'Normal',
  roomLarge: 'Large',
  roomSpend: 'On a cloud model, Large sends more text on your account.',
  roomNeedsContext: 'Turn on Notes in chats to choose this.',
  roomAboveLarge: "Your computer's config gives notes more room than Large.",
  roomEngine: (where, size) =>
    size
      ? `Sessions on ${where} computer use its own setting, ${size === 'small' ? 'Small' : size === 'normal' ? 'Normal' : 'Large'}.`
      : `Sessions on ${where} computer can use its own setting instead.`,
  deviceFooter:
    'These stay on this device and never travel with your notes, so a shared folder cannot change them.',
  dailyFolder: 'Folder',
  dateFormat: 'Date format',
  today: (f) => `Today: ${f}`,
  template: 'Template',
  templatesFolder: 'Templates folder',
  newLinks: 'New links use',
  wikilinks: 'Wikilinks',
  markdownLinks: 'Markdown links',
  linkPaths: 'Link paths',
  linkShortest: 'Shortest',
  linkRelative: 'Relative',
  linkAbsolute: 'From the top',
  attachmentsFolder: 'Attachments folder',
  font: 'Font',
  fontDefault: 'Default',
  fontSerif: 'Serif',
  fontMono: 'Mono',
  size: 'Text size',
  sizeSmaller: 'Smaller',
  sizeDefault: 'Default',
  sizeLarger: 'Larger',
  whereLives: 'Where it lives',
};

function resolved(over: Partial<ResolvedVaultSettings> = {}): ResolvedVaultSettings {
  const source = Object.fromEntries(VAULT_SETTINGS_FIELDS.map((f) => [f, 'default'])) as Record<
    VaultSettingsField,
    'default'
  >;
  return {
    newNotes: { location: 'root' },
    daily: { folder: '', format: 'YYYY-MM-DD' },
    templates: { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' },
    attachments: {},
    links: { style: 'wiki', format: 'shortest', updateOnRename: 'ask' },
    editor: { openMode: 'read', font: 'default', size: 'default' },
    tree: { sort: 'name' },
    delete: 'trash',
    agent: {},
    narrowing: {},
    ignore: { paths: [], regexSkipped: 0 },
    source,
    setAside: [],
    fileState: 'ok',
    obsidian: false,
    ...over,
  };
}

interface Calls {
  patches: VaultSettingsPatch[];
  device: unknown[];
  picks: string[];
  closed: number;
  storage: number;
  yours: number;
}

async function sheet(over: Partial<VaultSettingsSheetProps> = {}): Promise<Calls> {
  const { VaultSettingsSheet } = await import('../src/components/vault/VaultSettingsSheet.js');
  const calls: Calls = { patches: [], device: [], picks: [], closed: 0, storage: 0, yours: 0 };
  await dom.render(
    <VaultSettingsSheet
      open
      onClose={() => {
        calls.closed += 1;
      }}
      copy={COPY}
      settings={resolved()}
      platform="desktop"
      storageName="Your computer"
      footer="These settings are kept in .oscode/vault.json, so they travel with your notes."
      caps={{ trash: true, created: true, agent: true }}
      device={{
        context: { on: true },
        handoff: { on: true },
        packSize: 'normal',
        cloudSeat: false,
      }}
      machine={{ exclude: ['Clients/**'], localOnlyPaths: ['Health/**'], localOnlyTags: [] }}
      formatToday={(f) => (f === 'YYYY-MM-DD' ? '2026-09-27' : f === 'DD/MM' ? '27/09' : undefined)}
      onChange={(p) => calls.patches.push(p)}
      onUseYours={() => {
        calls.yours += 1;
      }}
      onDevice={(d) => calls.device.push(d)}
      onPickFolder={(f) => calls.picks.push(f)}
      onOpenStorage={() => {
        calls.storage += 1;
      }}
      {...over}
    />,
  );
  return calls;
}

const heads = () => $$('h3').map((h) => h.textContent);
const radioGroup = (name: string) => $(`[role="radiogroup"][aria-label="${name}"]`);
const radio = (group: string, label: string) =>
  [...(radioGroup(group)?.querySelectorAll('[role="radio"]') ?? [])].find(
    (r) => r.textContent === label,
  );
const rowWith = (label: string) =>
  $$('.vault-settings-row').find(
    (r) => r.querySelector('.vault-settings-label')?.textContent === label,
  );

// ---------------------------------------------------------------- settings

describe('Vault settings: the seven sections (CX Y1)', () => {
  it('shows them in order, as real headings, with the save status as a status line', async () => {
    await sheet();
    expect(heads()).toEqual([
      'Notes',
      'Models and your notes',
      'On this device',
      "Today's note",
      'Links and files',
      'Editor',
      'Where it lives',
    ]);
    expect($('[role="status"].vault-settings-status')).toBeTruthy();
    expect(dom.text()).toContain('A line of your notes looks like this.');
    expectClean(dom.text());
  });

  it('hides Models and On this device in a Team vault (D15)', async () => {
    await sheet({ team: true, device: undefined });
    expect(heads()).toEqual([
      'Notes',
      "Today's note",
      'Links and files',
      'Editor',
      'Where it lives',
    ]);
    expect(dom.text()).not.toContain('Notes models never see');
  });

  it('on the phone drops Link paths and the computer-config rows, and keeps the rest', async () => {
    await sheet({ platform: 'phone' });
    expect(radioGroup('Link paths')).toBeNull();
    expect(dom.text()).not.toContain("From your computer's config");
    expect(dom.text()).not.toContain('Clients');
    expect(radioGroup('New links use')).toBeTruthy();
    expect(dom.text()).toContain("Built in. Only your computer's config can change these.");
  });

  it('on the desktop shows Link paths and the machine rows, read-only', async () => {
    await sheet();
    expect(radioGroup('Link paths')).toBeTruthy();
    expect(dom.text()).toContain("From your computer's config");
    expect(dom.text()).toContain('Clients');
    // Built-in and machine entries have no remove; only the vault file's do.
    expect($('[aria-label="Remove Clients"]')).toBeNull();
    expect($('[aria-label="Remove Private"]')).toBeNull();
    expect(dom.text()).toContain('#private');
  });

  it('shows the agent row only where it is defined, never disabled', async () => {
    await sheet({ caps: { trash: true, created: true, agent: false } });
    expect(dom.text()).not.toContain('Your agent writes in');
    await sheet();
    expect(rowWith('Your agent writes in')?.textContent).toContain('Anywhere in this vault');
  });
});

describe('Vault settings: segments, saves, and the Delete choice (Y5, Y6, Y16)', () => {
  it('hands up one patch per change, and Default removes the key', async () => {
    const calls = await sheet();
    expect(radioGroup('Open notes in')?.getAttribute('role')).toBe('radiogroup');
    await tap(radio('Open notes in', 'Editing'));
    await tap(radio('Font', 'Serif'));
    await tap(radio('Text size', 'Default'));
    // Text size was already Default, so tapping it changes nothing.
    expect(calls.patches).toEqual([
      { field: 'editor.openMode', value: 'edit' },
      { field: 'editor.font', value: 'serif' },
    ]);
    const again = await sheet({
      settings: resolved({ editor: { openMode: 'read', font: 'serif', size: 'larger' } }),
    });
    await tap(radio('Font', 'Default'));
    await tap(radio('Text size', 'Default'));
    expect(again.patches).toEqual([
      { field: 'editor.font', value: null },
      { field: 'editor.size', value: null },
    ]);
    // The sample line wears the chosen face.
    const sample = $('.vault-settings-sample');
    expect(sample?.getAttribute('data-vault-font')).toBe('serif');
    expect(sample?.getAttribute('data-vault-size')).toBe('larger');
  });

  it('moves a segment with the arrow keys', async () => {
    const calls = await sheet();
    await key(radioGroup('Sort notes by')!, 'ArrowRight');
    expect(calls.patches).toEqual([{ field: 'tree.sort', value: 'modified' }]);
  });

  it('offers Created only where the listing has a creation time', async () => {
    await sheet({ caps: { trash: true, created: false, agent: true } });
    expect(radio('Sort notes by', 'Created')).toBeUndefined();
    expect(radio('Sort notes by', 'Last edited')).toBeTruthy();
  });

  it('says what For good means, and falls back to the storage line without Trash', async () => {
    await sheet({ settings: resolved({ delete: 'permanent' }) });
    expect(dom.text()).toContain('Deletes skip Trash and ask twice.');
    await sheet({
      caps: { trash: false, trashLine: 'This storage has no Trash.', created: true, agent: true },
    });
    expect(radioGroup('Delete')).toBeNull();
    const row = rowWith('Delete');
    expect(row?.getAttribute('aria-disabled')).toBe('true');
    expect(row?.textContent).toContain('This storage has no Trash.');
  });

  it('says Saving, then Saved, in the status line', async () => {
    await sheet({ save: 'saving' });
    expect($('[role="status"]')?.textContent).toBe('Saving');
    await sheet({ save: 'saved' });
    expect($('[role="status"]')?.textContent).toBe('Saved');
    await sheet({ save: 'merged' });
    expect($('[role="status"]')?.textContent).toBe(COPY.savedMerged);
    await sheet({ save: 'failed' });
    expect($('[role="status"]')?.textContent).toBe(COPY.saveFailed);
  });

  it('shows the first-change line only before anything saved', async () => {
    await sheet({ firstChange: true });
    expect(dom.text()).toContain(COPY.firstChange);
    await sheet({ firstChange: true, save: 'saved' });
    expect(dom.text()).not.toContain(COPY.firstChange);
  });

  it('on a same-field conflict shows theirs and one quiet Use {yours}', async () => {
    const calls = await sheet({
      settings: resolved({ editor: { openMode: 'edit', font: 'default', size: 'default' } }),
      conflict: { field: 'editor.openMode', theirs: 'edit', yours: 'read' },
    });
    expect(dom.text()).toContain(
      'Open notes in changed somewhere else while this was open, so yours was not saved. It is Editing now.',
    );
    await dom.click('Use Reading');
    expect(calls.yours).toBe(1);
    expect(calls.patches).toEqual([]);
  });
});

describe('Vault settings: From Obsidian and set-aside lines (Y2, Y3)', () => {
  it('shows an Obsidian field read-only, and a tap expands its one line', async () => {
    const source = { ...resolved().source, 'daily.folder': 'obsidian' as const };
    const calls = await sheet({
      settings: resolved({
        source,
        obsidian: true,
        daily: { folder: 'Daily', format: 'YYYY-MM-DD' },
      }),
    });
    const row = rowWith('Folder')!;
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(row.textContent).toContain('From Obsidian');
    expect(row.textContent).toContain('Daily');
    expect(row.querySelector('.disclosure-chevron')).toBeNull();
    expect(dom.text()).not.toContain(COPY.fromObsidianLine);
    await tap(row);
    expect($('.vault-settings-expand')?.textContent).toBe(
      'Set in Obsidian. Change it there, and OpenShore follows.',
    );
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(calls.patches).toEqual([]);
    expect(calls.picks).toEqual([]);
    expect(calls.closed).toBe(0);
  });

  it('says Obsidian keeps its own on a field it could set, and not on one it cannot', async () => {
    await sheet({ settings: resolved({ obsidian: true }) });
    expect(rowWith('New links use')?.textContent).toContain(COPY.obsidianKeepsOwn);
    expect(rowWith('Font')?.textContent).not.toContain(COPY.obsidianKeepsOwn);
    await sheet({ settings: resolved({ obsidian: false }) });
    expect(dom.text()).not.toContain(COPY.obsidianKeepsOwn);
  });

  it("lists Obsidian's excluded files without calling them private", async () => {
    await sheet({ settings: resolved({ ignore: { paths: ['Archive/'], regexSkipped: 0 } }) });
    const row = rowWith('Excluded in Obsidian')!;
    expect(row.textContent).toContain('Left out of search and link suggestions here too.');
    expect(row.textContent).toContain('Archive');
    expect(row.textContent).not.toMatch(/model/i);
    expect(row.querySelector('button')).toBeNull();
  });

  it('shows one quiet line per widening ask, and nothing for the rest', async () => {
    await sheet({
      settings: resolved({
        setAside: [
          { key: 'pack', reason: 'widens', plain: 'give notes more room in each chat' },
          { key: 'localOnly.paths[0]', reason: 'widens', plain: 'send "Private" to cloud models' },
          { key: 'colour', reason: 'unknown', plain: 'set colour' },
        ],
      }),
    });
    const lines = $$('.vault-settings-aside').map((p) => p.textContent);
    expect(lines).toEqual([
      COPY.setAside('give notes more room in each chat'),
      COPY.setAside('send "Private" to cloud models'),
    ]);
    expect(dom.text()).not.toContain('set colour');
  });
});

describe('Vault settings: read-only when the file cannot change (Y5)', () => {
  it('an unreadable file locks every file row, says why, and changes nothing', async () => {
    const calls = await sheet({ settings: resolved({ fileState: 'unreadable' }) });
    expect(dom.text()).toContain(COPY.unreadable);
    for (const name of ['Open notes in', 'Sort notes by', 'New links use', 'Font', 'Text size']) {
      expect(radioGroup(name), name).toBeNull();
      const row = rowWith(name)!;
      expect(row.getAttribute('aria-disabled')).toBe('true');
      const reason = row.getAttribute('aria-describedby')!;
      expect(dom.container.querySelector(`[id="${reason}"]`)?.textContent).toBe(COPY.unreadable);
    }
    expect(dom.buttons()).not.toContain('Add a folder');
    expect($('.vault-settings-chip-remove')).toBeNull();
    // This device's own settings still work.
    await tap($('[role="switch"][aria-label="Handoff"]'));
    expect(calls.device).toEqual([{ handoff: false }]);
    expect(calls.patches).toEqual([]);
  });

  it('a lock line from the storage reads the same way, and Where it lives still opens', async () => {
    vi.useFakeTimers();
    const calls = await sheet({
      lockLine: 'Your computer is off, so these settings cannot change right now.',
    });
    expect(radioGroup('Open notes in')).toBeNull();
    await tap(rowWith('Where it lives'));
    vi.runAllTimers();
    expect(calls.storage).toBe(1);
  });
});

describe('Vault settings: lists, picks, and this device (Y7 to Y10)', () => {
  it('removes a vault-file entry by its 44 px remove, and adds a tag', async () => {
    const calls = await sheet({
      settings: resolved({
        narrowing: { exclude: ['Drafts/**', 'Old/**'], localOnly: { paths: [], tags: ['secret'] } },
      }),
    });
    await tap($('[aria-label="Remove Drafts"]'));
    await tap($('[aria-label="Remove #secret"]'));
    await dom.click('Add a tag');
    await dom.type('Tag', '#home');
    await key($('input[placeholder="Tag"]')!, 'Enter');
    expect(calls.patches).toEqual([
      { field: 'exclude', value: ['Old/**'] },
      { field: 'localOnly.tags', value: [] },
      { field: 'localOnly.tags', value: ['secret', 'home'] },
    ]);
  });

  it('opens a folder list only after this sheet has left (R5)', async () => {
    vi.useFakeTimers();
    const calls = await sheet();
    await tap(rowWith('New notes go in'));
    expect(calls.closed).toBe(1);
    expect(calls.picks).toEqual([]);
    vi.runAllTimers();
    expect(calls.picks).toEqual(['newNotes.folder']);
    await dom.click('Add a folder');
    vi.runAllTimers();
    expect(calls.picks).toEqual(['newNotes.folder', 'exclude']);
  });

  it('commits a date format on Enter and shows today live', async () => {
    const calls = await sheet();
    expect(dom.text()).toContain('Today: 2026-09-27');
    await dom.type('YYYY-MM-DD', 'DD/MM');
    expect(dom.text()).toContain('Today: 27/09');
    await key($('input[placeholder="YYYY-MM-DD"]')!, 'Enter');
    // Enter blurs; linkedom has no focus, so commit through the blur itself.
    const { act } = await import('react');
    await act(async () => {
      $('input[placeholder="YYYY-MM-DD"]')!.dispatchEvent(
        new (globalThis as any).window.Event('focusout', { bubbles: true }),
      );
    });
    expect(calls.patches.at(-1)).toEqual({ field: 'daily.format', value: 'DD/MM' });
  });

  it('shows the amber spend line only with a cloud seat', async () => {
    await sheet();
    expect($('.vault-settings-spend')).toBeNull();
    await sheet({
      device: { context: { on: true }, handoff: { on: true }, packSize: 'large', cloudSeat: true },
    });
    expect($('.vault-settings-spend')?.textContent).toBe(COPY.roomSpend);
    expect(radio('Room for notes', 'Large')?.getAttribute('aria-checked')).toBe('true');
  });

  it('picks a room size, disables it with Notes in chats off, and selects none above Large', async () => {
    const calls = await sheet();
    await tap(radio('Room for notes', 'Small'));
    expect(calls.device).toEqual([{ packSize: 'small' }]);
    await sheet({
      device: {
        context: { on: false },
        handoff: { on: true },
        packSize: 'normal',
        cloudSeat: false,
      },
    });
    expect(radioGroup('Room for notes')?.getAttribute('aria-disabled')).toBe('true');
    expect(dom.text()).toContain(COPY.roomNeedsContext);
    await sheet({
      device: {
        context: { on: true },
        handoff: { on: true },
        packSize: 'above-large',
        cloudSeat: false,
      },
    });
    expect($$('[role="radiogroup"][aria-label="Room for notes"] [aria-checked="true"]')).toEqual(
      [],
    );
    expect(dom.text()).toContain(COPY.roomAboveLarge);
  });

  it("says when the computer's sessions use their own room, neutral, and only with Notes in chats on", async () => {
    await sheet();
    expect($('.vault-settings-engine')).toBeNull();
    await sheet({
      device: {
        context: { on: true },
        handoff: { on: true },
        packSize: 'large',
        cloudSeat: false,
        engine: { where: 'this', size: 'normal' },
      },
    });
    const line = $('.vault-settings-engine');
    expect(line?.textContent).toBe('Sessions on this computer use its own setting, Normal.');
    // The choice stays selected: app seats still use it.
    expect(radio('Room for notes', 'Large')?.getAttribute('aria-checked')).toBe('true');
    await sheet({
      device: {
        context: { on: true },
        handoff: { on: true },
        packSize: 'large',
        cloudSeat: false,
        engine: { where: 'your' },
      },
    });
    expect($('.vault-settings-engine')?.textContent).toBe(
      'Sessions on your computer can use its own setting instead.',
    );
    await sheet({
      device: {
        context: { on: false },
        handoff: { on: true },
        packSize: 'large',
        cloudSeat: false,
        engine: { where: 'this', size: 'normal' },
      },
    });
    expect($('.vault-settings-engine')).toBeNull();
  });

  it('holds a switch off when the project or Memory does, and says which', async () => {
    await sheet({
      device: {
        context: { on: true, lock: 'project' },
        handoff: { on: true, lock: 'memory' },
        packSize: 'normal',
        cloudSeat: false,
      },
    });
    const ctx = $('[role="switch"][aria-label="Notes in chats"]')!;
    const hand = $('[role="switch"][aria-label="Handoff"]')!;
    expect(ctx.getAttribute('aria-checked')).toBe('false');
    expect(ctx.getAttribute('aria-disabled')).toBe('true');
    expect(hand.getAttribute('aria-disabled')).toBe('true');
    expect(rowWith('Notes in chats')?.textContent).toContain(COPY.projectOff);
    expect(rowWith('Handoff')?.textContent).toContain(COPY.memoryOff);
    expect(dom.text()).toContain(COPY.deviceFooter);
  });

  it('gives every row, chip, segment and switch press feedback', async () => {
    await sheet({ settings: resolved({ narrowing: { exclude: ['Drafts/**'] } }) });
    const tappable = $$('button');
    expect(tappable.length).toBeGreaterThan(10);
    for (const b of tappable) expect(b.className, b.textContent ?? '').toMatch(/press-fb/);
  });
});

describe('vaultTypeAttrs (the --vault-font and --vault-size-step tokens)', () => {
  it('sets nothing for Default, so today’s look holds with no file', async () => {
    const { vaultTypeAttrs } = await import('../src/components/vault/VaultSettingsSheet.js');
    expect(vaultTypeAttrs({ font: 'default', size: 'default' })).toEqual({});
    expect(vaultTypeAttrs({ font: 'mono', size: 'smaller' })).toEqual({
      'data-vault-font': 'mono',
      'data-vault-size': 'smaller',
    });
  });

  it('declares the tokens in theme.css as a step, never pixels', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(process.cwd(), 'src', 'theme.css'), 'utf8');
    const fence = css.slice(
      css.indexOf('/* ---- M7 stream G begin'),
      css.indexOf('/* ---- M7 stream G end'),
    );
    expect(fence).toMatch(/--vault-font: var\(--font-display\)/);
    expect(fence).toMatch(/font-family: var\(--vault-font, var\(--font-mono\)\)/);
    const steps = [...fence.matchAll(/--vault-size-step:\s*([^;]+);/g)].map((m) => m[1]);
    expect(steps).toEqual(['-1', '1']);
    // Every size the step sets is a type-scale token or an em, never px.
    const sizes = [...fence.matchAll(/\[data-vault-size[^{]*\{\s*font-size:\s*([^;]+);/g)].map(
      (m) => m[1],
    );
    expect(sizes.length).toBeGreaterThanOrEqual(4);
    for (const s of sizes) expect(s).toMatch(/^(var\(--text-\d\)|\d*\.?\d+em)$/);
  });
});

// ---------------------------------------------------------------- the chip

async function chip(p: NoteProvenance | undefined) {
  const { VaultProvenanceChip } = await import('../src/components/vault/VaultProvenanceChip.js');
  let opened = 0;
  await dom.render(
    <VaultProvenanceChip
      provenance={p}
      onOpen={() => {
        opened += 1;
      }}
    />,
  );
  return () => opened;
}

describe('the provenance chip (CX Y11, Y16, R4)', () => {
  it('is teal and says Local for a seat on this computer, and opens details', async () => {
    const opened = await chip({ source: 'agent', model: 'qwen2.5-coder 7B', where: 'local' });
    const el = $('.vault-prov-chip')!;
    expect(el.textContent).toBe('Written by qwen2.5-coder 7B · Local');
    expect(el.className).toMatch(/vault-prov-local/);
    expect(el.className).not.toMatch(/vault-prov-cloud/);
    expect(el.className).toMatch(/press-fb/);
    expect(el.getAttribute('aria-label')).toBe(
      'Written by qwen2.5-coder 7B, on this computer. Open details.',
    );
    await tap(el);
    expect(opened()).toBe(1);
  });

  it('is amber and says Cloud for a cloud seat, and Edited for an edit', async () => {
    await chip({ source: 'agent-edit', model: 'Claude Sonnet', where: 'cloud' });
    const el = $('.vault-prov-chip')!;
    expect(el.textContent).toBe('Edited by Claude Sonnet · Cloud');
    expect(el.className).toMatch(/vault-prov-cloud/);
    expect(el.className).not.toMatch(/vault-prov-local/);
    expect(el.getAttribute('aria-label')).toBe(
      'Edited by Claude Sonnet, on a cloud model. Open details.',
    );
  });

  it('once reviewed keeps its tint as an outline and still says where', async () => {
    await chip({ model: 'Claude Sonnet', where: 'cloud', reviewed: '2026-09-27' });
    const el = $('.vault-prov-chip')!;
    expect(el.className).toMatch(/vault-prov-reviewed/);
    expect(el.textContent).toBe('Claude Sonnet · Cloud · Reviewed');
    expect(el.textContent).toMatch(/Local|Cloud/);
  });

  it('shows nothing when the note does not say who wrote it or where', async () => {
    await chip(undefined);
    expect($('.vault-prov-chip')).toBeNull();
    await chip({ model: 'x' });
    expect($('.vault-prov-chip')).toBeNull();
    await chip({ where: 'local' });
    expect($('.vault-prov-chip')).toBeNull();
    // The label never says "agent" (the note may travel).
    await chip({ source: 'agent', model: 'm', where: 'local' });
    expect(dom.text()).not.toMatch(/agent/i);
  });
});

// ---------------------------------------------------------------- About

async function about(
  p: NoteProvenance,
  result: 'ok' | 'changed' | 'failed' = 'ok',
  canMark = true,
) {
  const { VaultAboutNote } = await import('../src/components/vault/VaultAboutNote.js');
  const marks: boolean[] = [];
  let closed = 0;
  await dom.render(
    <VaultAboutNote
      open
      title="Plan"
      provenance={p}
      canMark={canMark}
      formatDate={(iso) => (iso ? iso.slice(0, 10) : undefined)}
      onClose={() => {
        closed += 1;
      }}
      onMark={async (r) => {
        marks.push(r);
        return result;
      }}
    />,
  );
  return { marks, closed: () => closed };
}

describe('About this note (CX Y12)', () => {
  it('reads each row, tints only the Ran row, and is honest about trust', async () => {
    await about({
      source: 'crew',
      model: 'Claude Sonnet',
      where: 'cloud',
      provider: 'Anthropic',
      size: 'large',
      created: '2026-09-20T10:00:00Z',
    });
    const text = dom.text();
    expect($('h2')?.textContent).toBe('About this note');
    for (const s of [
      'Written byClaude Sonnet',
      'RanOn a cloud model, Anthropic',
      'Model sizeLarge',
      'HowBy a Crew routine',
      'Created2026-09-20',
      'ReviewedNot yet',
    ])
      expect(text).toContain(s);
    expect($('.vault-about-ran-cloud')).toBeTruthy();
    expect($('.vault-about-ran-local')).toBeNull();
    expect(text).toContain(
      "This comes from the note's own properties, which anyone who can edit the note can change.",
    );
    expect(text).toContain('Reviewed means you read it. It changes nothing a model sees.');
    expectClean(text);
  });

  it('marks it reviewed and asks to close when the write lands', async () => {
    const { marks, closed } = await about({ source: 'agent', model: 'm', where: 'local' });
    expect($('.vault-about-ran-local')?.textContent).toBe('On this computer');
    await dom.click('Mark as reviewed');
    await dom.settle();
    expect(marks).toEqual([true]);
    expect(closed()).toBe(1);
  });

  it('offers Mark as not reviewed once reviewed', async () => {
    const { marks } = await about({ model: 'm', where: 'local', reviewed: '2026-09-21T00:00:00Z' });
    expect(dom.text()).toContain('Reviewed2026-09-21');
    expect(dom.buttons()).not.toContain('Mark as reviewed');
    await dom.click('Mark as not reviewed');
    await dom.settle();
    expect(marks).toEqual([false]);
  });

  it('says so in place when the note moved on, or the write failed', async () => {
    const changed = await about({ model: 'm', where: 'local' }, 'changed');
    await dom.click('Mark as reviewed');
    await dom.settle();
    expect(changed.closed()).toBe(0);
    expect($('.vault-about-line')?.textContent).toBe(
      '"Plan" changed somewhere else, so it was not marked. The newer version is open now.',
    );
    await dom.unmount();
    dom = await mountDom();
    await about({ model: 'm', where: 'local' }, 'failed');
    await dom.click('Mark as reviewed');
    await dom.settle();
    expect($('.vault-about-line')?.textContent).toBe(
      'Could not mark "Plan", so nothing changed. Try again in a moment.',
    );
  });

  it('has no mark button where the note cannot be written', async () => {
    await about({ model: 'm', where: 'local' }, 'ok', false);
    expect(dom.buttons()).toEqual(['']); // the round close only
  });
});

// ---------------------------------------------------------------- starter

async function starter(result: { added: number; total: number }, writesSettings = true) {
  const { VaultStarterSheet } = await import('../src/components/vault/VaultStarterSheet.js');
  let adds = 0;
  let closed = 0;
  await dom.render(
    <VaultStarterSheet
      open
      writesSettings={writesSettings}
      onClose={() => {
        closed += 1;
      }}
      onAdd={async () => {
        adds += 1;
        return result;
      }}
    />,
  );
  return { adds: () => adds, closed: () => closed };
}

describe('the starter layout sheet (CX Y13)', () => {
  it('shows everything it would add before writing anything', async () => {
    const s = await starter({ added: 4, total: 4 });
    const text = dom.text();
    expect($('h2')?.textContent).toBe('A simple layout');
    expect(text).toContain(
      'These are added to your empty vault. Change or delete any of them later.',
    );
    expect($$('.vault-starter-name').map((n) => n.textContent)).toEqual([
      'Welcome to your Vault',
      'Inbox',
      'Templates/Daily',
      'Vault conventions',
    ]);
    expect(text).toContain("New notes go in Inbox, and today's note uses Templates/Daily.");
    expect(s.adds()).toBe(0);
    expectClean(text);
  });

  it('leaves the settings line out where the settings file cannot be written', async () => {
    await starter({ added: 4, total: 4 }, false);
    expect(dom.text()).not.toContain('New notes go in Inbox');
  });

  it('adds on the one primary, marks the change once, and asks to close', async () => {
    const s = await starter({ added: 4, total: 4 });
    await dom.click('Add these');
    await dom.settle();
    expect(s.adds()).toBe(1);
    expect(haptics.commit).toBe(1);
    expect(s.closed()).toBe(1);
  });

  it('says how many landed when some did not, and stays to try again', async () => {
    const s = await starter({ added: 2, total: 4 });
    await dom.click('Add these');
    await dom.settle();
    expect(s.closed()).toBe(0);
    expect(haptics.commit).toBe(0);
    expect($('.vault-starter-partial')?.textContent).toBe(
      'Added 2 of 4. Try again to add the rest.',
    );
    expect(dom.buttons()).toContain('Add these');
  });
});
