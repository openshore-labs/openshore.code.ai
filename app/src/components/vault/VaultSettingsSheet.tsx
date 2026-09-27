// Vault settings (Vault M7 7.1; CTO L1 to L4, L7, L11, L13, L15, L16; CX Y1
// to Y10, Y16): one sheet, seven sections, in CX Y1's order, so what people
// change most and what models see come first and where the vault lives comes
// last:
//
//   1. Notes             4. Today's note
//   2. Models and your notes (personal only)
//   3. On this device (personal only)
//                        5. Links and files
//                        6. Editor
//                        7. Where it lives
//
// The rules the sheet carries, so the room does not have to:
// - No Save button. Each change is handed up on commit (`onChange`, one field
//   at a time, `null` for "Default"); the sub under the title is a
//   `role="status"` line that says Saving, then Saved, crossfading on the
//   house tokens (Y5). A compare-and-swap refusal on the SAME field shows
//   theirs with one quiet "Use {yours}".
// - A field Obsidian sets is read-only, "From Obsidian", no chevron; a tap
//   expands one line saying where to change it (Y2), a fade, never a height
//   tween. In a vault with `.obsidian/`, a field Obsidian could set but left
//   unset adds "Obsidian keeps its own setting for this."
// - The phone drops Link paths and every "From your computer's config" row
//   (it cannot change them: no dead rows). Everything else is on both.
// - A sheet that cannot write (the storage cannot, the computer is away, the
//   file is unreadable) shows every file row read-only, `aria-disabled`, with
//   the reason as `aria-describedby`. "On this device" still works: those are
//   this device's own settings, never the vault file's.
// - A widening ask the vault file made is one quiet line at the top of
//   section 2, never a warning color (Y3).
// - Color: only the one cloud-spend line under Room for notes wears amber
//   (Y8, R4). Everything else is neutral.
// - A pick that opens another sheet (a folder list, the template picker, the
//   storage sheet) waits for this sheet's exit before it runs (R5).
//
// Presentational: every string comes in through `copy` (stream F's M7 lines
// in lib/vaultCopy.ts, mapped by the integrator), every value through props,
// every change out through callbacks. The editor sample line is this
// stream's own (`VAULT_EDITOR_SAMPLE`).
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type {
  ResolvedVaultSettings,
  VaultEditorFont,
  VaultEditorSize,
  VaultPackSize,
  VaultSettingsField,
  VaultSettingsPatch,
} from 'os-code/protocol';
import { Sheet } from '../Sheet.js';
import { SheetHead } from '../SheetHead.js';
import { Switch } from '../Switch.js';
import { sheetExitMs } from '../../lib/motion.js';
import { VAULT_EDITOR_SAMPLE } from '../../lib/vaultCopy.js';
import { VAULT_PRIVACY_DEFAULTS } from '../../state/types.js';

/** Every line the sheet shows but the editor sample, from stream F's M7
 *  section of lib/vaultCopy.ts (CX Y1 to Y10). */
export interface VaultSettingsSheetCopy {
  title: string;
  sections: {
    notes: string;
    models: string;
    device: string;
    today: string;
    links: string;
    editor: string;
    where: string;
  };
  // The status line and its conflicts (Y5)
  saving: string;
  saved: string;
  /** "Saved. Some other settings changed somewhere else and show here now." */
  savedMerged: string;
  saveFailed: string;
  /** The first change in a folder vault with no file yet. */
  firstChange: string;
  /** Bad JSON: every row read-only, defaults shown. */
  unreadable: string;
  /** `{Field} changed somewhere else while this was open, so yours was not
   *  saved. It is {value} now.` */
  conflict: (field: string, theirs: string) => string;
  /** `Use {yours}` */
  useYours: (yours: string) => string;
  // Where a row's value comes from (Y2, Y3)
  fromObsidian: string;
  fromObsidianLine: string;
  obsidianKeepsOwn: string;
  obsidianExcluded: string;
  obsidianExcludedSub: string;
  fromMachine: string;
  builtIn: string;
  /** `This vault's settings file also asks to {plain}. ...` */
  setAside: (plain: string) => string;
  // Values with no name of their own
  topOfVault: string;
  newNotesCurrent: string;
  none: string;
  /** Obsidian's attachment form (`/`, `./`, `./sub`, a folder) in words. */
  attachmentsValue: (setting: string | undefined) => string;
  // 1. Notes
  newNotesIn: string;
  openIn: string;
  openRead: string;
  openEdit: string;
  sortBy: string;
  sortName: string;
  sortModified: string;
  sortCreated: string;
  deleteLabel: string;
  deleteTrash: string;
  deleteForGood: string;
  deleteForGoodSub: string;
  // 2. Models and your notes
  excluded: string;
  excludedSub: string;
  localOnly: string;
  localOnlySub: string;
  addFolder: string;
  addTag: string;
  tagPlaceholder: string;
  /** `Remove {folder}` */
  remove: (item: string) => string;
  agentWrites: string;
  agentWritesSub: string;
  agentAnywhere: string;
  // 3. On this device
  notesInChats: string;
  /** Built from PACK_BY_CLASS (Y7). */
  notesInChatsSub: string;
  handoff: string;
  handoffSub: string;
  projectOff: string;
  memoryOff: string;
  room: string;
  roomSub: string;
  roomSmall: string;
  roomNormal: string;
  roomLarge: string;
  roomSpend: string;
  roomNeedsContext: string;
  roomAboveLarge: string;
  /** The line under Room for notes when the computer's sessions use their
   *  own size (Vault M8). */
  roomEngine: (where: 'this' | 'your', size?: VaultPackSize) => string;
  deviceFooter: string;
  // 4. Today's note
  dailyFolder: string;
  dateFormat: string;
  /** `Today: {formatted}` */
  today: (formatted: string) => string;
  template: string;
  templatesFolder: string;
  // 5. Links and files
  newLinks: string;
  wikilinks: string;
  markdownLinks: string;
  linkPaths: string;
  linkShortest: string;
  linkRelative: string;
  linkAbsolute: string;
  attachmentsFolder: string;
  // 6. Editor
  font: string;
  fontDefault: string;
  fontSerif: string;
  fontMono: string;
  size: string;
  sizeSmaller: string;
  sizeDefault: string;
  sizeLarger: string;
  // 7. Where it lives
  whereLives: string;
}

/** The fields a folder list (or, for `daily.template`, a note list) picks. */
export type VaultSettingsPickField =
  | 'newNotes.folder'
  | 'daily.folder'
  | 'daily.template'
  | 'templates.folder'
  | 'attachments.folder'
  | 'agent.folder'
  | 'exclude'
  | 'localOnly.paths';

/** A switch on this device (Y7): on or off, and what holds it off. */
export interface VaultDeviceSwitch {
  on: boolean;
  /** `project`: the active project's config turns it off. `memory`: Memory
   *  is off, so chats carry no notes. Either way the switch shows off and
   *  cannot change here. */
  lock?: 'project' | 'memory';
}

/** "On this device" (Y7, Y8): device-local, never the vault file's. */
export interface VaultSettingsDevice {
  context: VaultDeviceSwitch;
  handoff: VaultDeviceSwitch;
  /** `above-large`: machine config gives more room than Large (desktop). */
  packSize: VaultPackSize | 'above-large';
  /** A cloud seat is connected: the one amber spend line shows. */
  cloudSeat: boolean;
  /** The computer's sessions use a size other than the one shown (Vault
   *  M8, `vaultEngineRoom`): `size` is theirs, absent when the computer did
   *  not say. Absent, nothing to say. */
  engine?: { where: 'this' | 'your'; size?: VaultPackSize };
}

export interface VaultSettingsConflict {
  field: VaultSettingsField;
  theirs: string | readonly string[] | null;
  yours: string | readonly string[] | null;
}

export interface VaultSettingsSheetProps {
  open: boolean;
  onClose: () => void;
  copy: VaultSettingsSheetCopy;
  settings: ResolvedVaultSettings;
  platform: 'phone' | 'desktop';
  /** A team vault: sections 2 and 3 are hidden (D15, team never in context). */
  team?: boolean;
  /** The storage's name, the value on "Where it lives". */
  storageName: string;
  /** The one footer line for this storage (Y1, Y14). */
  footer: string;
  /** Why the vault file cannot change here (the storage's own line, the
   *  computer away, a member's "Your admins set these."). Set, every file row
   *  is read-only. An unreadable file reads `copy.unreadable` on its own. */
  lockLine?: string;
  /** The last save, for the status line (Y5). */
  save?: 'saving' | 'saved' | 'merged' | 'failed';
  /** No file yet in a folder vault: the first change adds `.oscode/`. */
  firstChange?: boolean;
  /** The same field changed somewhere else; nothing was written. */
  conflict?: VaultSettingsConflict;
  caps: {
    /** Trash is real here (`vaultCaps().trash`), so the Delete choice shows. */
    trash: boolean;
    /** `vaultCapLine(provider, 'trash')`, shown read-only when it does not. */
    trashLine?: string;
    /** The listing carries a creation time, so "Created" is a sort. */
    created: boolean;
    /** `vaultCopy(platform, provider).agent` is defined: "Your agent writes
     *  in" shows. Never disabled, only absent. */
    agent: boolean;
  };
  /** Personal vaults only. */
  device?: VaultSettingsDevice;
  /** The machine's own lists (desktop only; the phone never shows them). */
  machine?: {
    exclude: readonly string[];
    localOnlyPaths: readonly string[];
    localOnlyTags: readonly string[];
  };
  /** The built-in local-only defaults (D5), shown without a remove. */
  builtIns?: { paths: readonly string[]; tags: readonly string[] };
  /** Today's date in a format, for the live line under Date format;
   *  undefined when the format has a token the formatter does not know. */
  formatToday: (format: string) => string | undefined;
  onChange: (patch: VaultSettingsPatch) => void;
  /** Write yours over theirs after a same-field conflict. */
  onUseYours: () => void;
  onDevice: (change: { context?: boolean; handoff?: boolean; packSize?: VaultPackSize }) => void;
  /** Open the folder list (or the note list) for a field, after the exit. */
  onPickFolder: (field: VaultSettingsPickField) => void;
  /** Open the storage sheet, after the exit. */
  onOpenStorage: () => void;
}

/** The attributes that set `--vault-font` and `--vault-size-step` on the
 *  note's reading and editing surfaces (theme.css, M7 stream G). Default font
 *  and size set nothing, so today's look holds with no file. */
export function vaultTypeAttrs(editor: { font: VaultEditorFont; size: VaultEditorSize }): {
  'data-vault-font'?: VaultEditorFont;
  'data-vault-size'?: VaultEditorSize;
} {
  return {
    ...(editor.font !== 'default' ? { 'data-vault-font': editor.font } : {}),
    ...(editor.size !== 'default' ? { 'data-vault-size': editor.size } : {}),
  };
}

// Fields Obsidian can set (CTO L2's seed column): in a vault with
// `.obsidian/` and the field unset there, the row says Obsidian keeps its own.
const OBSIDIAN_SEEDED: ReadonlySet<VaultSettingsField> = new Set<VaultSettingsField>([
  'newNotes.location',
  'newNotes.folder',
  'editor.openMode',
  'delete',
  'daily.folder',
  'daily.format',
  'daily.template',
  'templates.folder',
  'templates.dateFormat',
  'templates.timeFormat',
  'links.style',
  'links.format',
  'links.updateOnRename',
  'attachments.folder',
]);

/** A glob as a person reads it: `Private/**` is the folder `Private`. */
export function globLabel(glob: string): string {
  return glob.replace(/\/\*\*?$/, '').replace(/\/$/, '') || glob;
}

type Option<T extends string> = { value: T; label: string };

function options(c: VaultSettingsSheetCopy) {
  return {
    'editor.openMode': [
      { value: 'read', label: c.openRead },
      { value: 'edit', label: c.openEdit },
    ],
    'tree.sort': [
      { value: 'name', label: c.sortName },
      { value: 'modified', label: c.sortModified },
      { value: 'created', label: c.sortCreated },
    ],
    delete: [
      { value: 'trash', label: c.deleteTrash },
      { value: 'permanent', label: c.deleteForGood },
    ],
    'links.style': [
      { value: 'wiki', label: c.wikilinks },
      { value: 'markdown', label: c.markdownLinks },
    ],
    'links.format': [
      { value: 'shortest', label: c.linkShortest },
      { value: 'relative', label: c.linkRelative },
      { value: 'absolute', label: c.linkAbsolute },
    ],
    'editor.font': [
      { value: 'default', label: c.fontDefault },
      { value: 'serif', label: c.fontSerif },
      { value: 'mono', label: c.fontMono },
    ],
    'editor.size': [
      { value: 'smaller', label: c.sizeSmaller },
      { value: 'default', label: c.sizeDefault },
      { value: 'larger', label: c.sizeLarger },
    ],
  } satisfies Partial<Record<VaultSettingsField, Option<string>[]>>;
}

/** A field's row label, for the conflict line. */
export function fieldLabel(field: VaultSettingsField, c: VaultSettingsSheetCopy): string {
  const labels: Record<VaultSettingsField, string> = {
    'newNotes.location': c.newNotesIn,
    'newNotes.folder': c.newNotesIn,
    'editor.openMode': c.openIn,
    'tree.sort': c.sortBy,
    delete: c.deleteLabel,
    exclude: c.excluded,
    'localOnly.paths': c.localOnly,
    'localOnly.tags': c.localOnly,
    'agent.folder': c.agentWrites,
    'daily.folder': c.dailyFolder,
    'daily.format': c.dateFormat,
    'daily.template': c.template,
    'templates.folder': c.templatesFolder,
    'templates.dateFormat': c.dateFormat,
    'templates.timeFormat': c.dateFormat,
    'links.style': c.newLinks,
    'links.format': c.linkPaths,
    'links.updateOnRename': c.newLinks,
    'attachments.folder': c.attachmentsFolder,
    'editor.font': c.font,
    'editor.size': c.size,
  };
  return labels[field];
}

/** A committed value in words, for the conflict line and "Use {yours}". */
export function valueLabel(
  field: VaultSettingsField,
  value: string | readonly string[] | null,
  c: VaultSettingsSheetCopy,
): string {
  if (Array.isArray(value)) {
    const list = value as readonly string[];
    if (!list.length) return c.none;
    return list.map((v) => (field === 'localOnly.tags' ? `#${v}` : globLabel(v))).join(', ');
  }
  const opts = (options(c) as Partial<Record<VaultSettingsField, Option<string>[]>>)[field];
  if (opts) return opts.find((o) => o.value === value)?.label ?? opts[0]!.label;
  if (field === 'newNotes.location') {
    if (value === 'current') return c.newNotesCurrent;
    return c.topOfVault;
  }
  if (field === 'attachments.folder')
    return c.attachmentsValue((value as string | null) ?? undefined);
  if (field === 'agent.folder') return (value as string | null) ?? c.agentAnywhere;
  if (field === 'daily.template') return (value as string | null) ?? c.none;
  if (field.endsWith('.folder')) return (value as string | null) ?? c.topOfVault;
  return (value as string | null) ?? c.none;
}

/** The segmented control (Y16): a radiogroup named by its row, each segment a
 *  radio that answers the finger. Arrow keys move the choice. */
function Segmented<T extends string>({
  label,
  opts,
  value,
  disabled,
  describedBy,
  onPick,
}: {
  label: string;
  opts: readonly Option<T>[];
  /** Undefined selects nothing (machine config above Large). */
  value: T | undefined;
  disabled?: boolean;
  describedBy?: string;
  onPick: (value: T) => void;
}) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const at = Math.max(
      0,
      opts.findIndex((o) => o.value === value),
    );
    const next = opts[(at + step + opts.length) % opts.length]!;
    onPick(next.value);
  };
  return (
    <div
      className="segmented vault-settings-seg"
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-describedby={describedBy}
      onKeyDown={onKey}
    >
      {opts.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (value === undefined && o === opts[0]) ? 0 : -1}
            disabled={disabled}
            className={`seg press-fb${on ? ' active' : ''}`}
            onClick={() => {
              if (!on) onPick(o.value);
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function RowText({ label, sub, subId }: { label: string; sub?: ReactNode; subId?: string }) {
  return (
    <span className="vault-settings-row-text">
      <span className="vault-settings-label">{label}</span>
      {sub ? (
        <span id={subId} className="vault-settings-sub">
          {sub}
        </span>
      ) : null}
    </span>
  );
}

function Chevron() {
  return <span className="disclosure-chevron" aria-hidden="true" />;
}

export function VaultSettingsSheet(props: VaultSettingsSheetProps) {
  const {
    open,
    onClose,
    copy: c,
    settings: s,
    platform,
    team = false,
    storageName,
    footer,
    save,
    firstChange,
    conflict,
    caps,
    device,
    machine,
    builtIns = VAULT_PRIVACY_DEFAULTS.localOnly,
    formatToday,
    onChange,
    onUseYours,
    onDevice,
    onPickFolder,
    onOpenStorage,
  } = props;
  const uid = useId();
  const ids = {
    lock: `${uid}-lock`,
    status: `${uid}-status`,
  };
  const desktop = platform === 'desktop';
  const lockLine = s.fileState === 'unreadable' ? c.unreadable : props.lockLine;
  const locked = Boolean(lockLine);
  const opts = options(c);

  // Y2: which "From Obsidian" rows are showing their one line.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [formatDraft, setFormatDraft] = useState(s.daily.format);
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setExpanded(new Set());
    setTagDraft(null);
  }, [open]);
  useEffect(() => {
    setFormatDraft(s.daily.format);
  }, [s.daily.format]);

  // R5: a pick that opens another sheet runs once this one has left.
  const pending = useRef<(() => void) | null>(null);
  const afterExit = (fn: () => void) => {
    pending.current = fn;
    onClose();
    setTimeout(() => {
      const run = pending.current;
      pending.current = null;
      run?.();
    }, sheetExitMs());
  };

  const fromObsidian = (...fields: VaultSettingsField[]) =>
    fields.some((f) => s.source[f] === 'obsidian');
  /** A row's sub, with Obsidian's own-setting note where it applies. */
  const subFor = (fields: VaultSettingsField[], sub?: string): string | undefined => {
    const keepsOwn = s.obsidian && fields.some((f) => OBSIDIAN_SEEDED.has(f));
    if (!keepsOwn) return sub;
    return sub ? `${sub} ${c.obsidianKeepsOwn}` : c.obsidianKeepsOwn;
  };

  /** One settings row for a file field: read-only "From Obsidian", read-only
   *  locked, or its live editor. */
  const fieldRow = (
    key: string,
    fields: VaultSettingsField[],
    label: string,
    value: string,
    editor: () => ReactNode,
  ): ReactNode => {
    if (fromObsidian(...fields)) {
      const isOpen = expanded.has(key);
      const subId = `${uid}-${key}-obs`;
      return (
        <div className="vault-settings-item" key={key}>
          <button
            type="button"
            className="vault-settings-row vault-settings-locked press-fb press-fb--row"
            aria-disabled="true"
            aria-expanded={isOpen}
            aria-describedby={subId}
            onClick={() =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
          >
            <RowText label={label} sub={c.fromObsidian} subId={subId} />
            <span className="vault-settings-value">{value}</span>
          </button>
          {isOpen ? <p className="vault-settings-expand">{c.fromObsidianLine}</p> : null}
        </div>
      );
    }
    if (locked) {
      return (
        <div
          className="vault-settings-item vault-settings-row vault-settings-locked"
          key={key}
          aria-disabled="true"
          aria-describedby={ids.lock}
        >
          <RowText label={label} />
          <span className="vault-settings-value">{value}</span>
        </div>
      );
    }
    return (
      <div className="vault-settings-item" key={key}>
        {editor()}
      </div>
    );
  };

  const chevronRow = (
    label: string,
    value: string,
    sub: string | undefined,
    onOpen: () => void,
  ) => (
    <button type="button" className="vault-settings-row press-fb press-fb--row" onClick={onOpen}>
      <RowText label={label} sub={sub} />
      <span className="vault-settings-value">{value}</span>
      <Chevron />
    </button>
  );

  const segRow = <T extends string>(
    key: string,
    fields: VaultSettingsField[],
    label: string,
    list: readonly Option<T>[],
    value: T,
    pick: (v: T) => void,
    extraSub?: string,
  ) => {
    const sub = subFor(fields, extraSub);
    const subId = `${uid}-${key}-sub`;
    return (
      <div className="vault-settings-row vault-settings-row-stack">
        <RowText label={label} sub={sub} subId={subId} />
        <Segmented
          label={label}
          opts={list}
          value={value}
          describedBy={sub ? subId : undefined}
          onPick={pick}
        />
      </div>
    );
  };

  const set = (field: VaultSettingsField, value: VaultSettingsPatch['value']) =>
    onChange({ field, value });

  // ---------------------------------------------------------------- values
  const newNotesValue =
    s.newNotes.location === 'current'
      ? c.newNotesCurrent
      : s.newNotes.location === 'folder' && s.newNotes.folder
        ? s.newNotes.folder
        : c.topOfVault;
  const optLabel = (field: keyof ReturnType<typeof options>, v: string) =>
    (opts[field] as Option<string>[]).find((o) => o.value === v)?.label ?? v;

  // ---------------------------------------------------------------- status
  const statusText =
    save === 'saving'
      ? c.saving
      : save === 'saved'
        ? c.saved
        : save === 'merged'
          ? c.savedMerged
          : save === 'failed'
            ? c.saveFailed
            : '';

  // --------------------------------------------------------- 2. the lists
  const fileExclude = s.narrowing.exclude ?? [];
  const filePaths = s.narrowing.localOnly?.paths ?? [];
  const fileTags = s.narrowing.localOnly?.tags ?? [];

  const commitTag = () => {
    const tag = (tagDraft ?? '').trim().replace(/^#+/, '');
    setTagDraft(null);
    if (!tag || fileTags.includes(tag)) return;
    set('localOnly.tags', [...fileTags, tag]);
  };

  const chips = (
    items: readonly string[],
    display: (item: string) => string,
    remove?: (item: string) => void,
  ) =>
    items.map((item) => (
      <li key={item} className="vault-settings-chip">
        <span className="vault-settings-chip-name">{display(item)}</span>
        {remove && !locked ? (
          <button
            type="button"
            className="vault-settings-chip-remove press-fb"
            aria-label={c.remove(display(item))}
            onClick={() => remove(item)}
          >
            <span aria-hidden="true" className="vault-settings-chip-x" />
          </button>
        ) : null}
      </li>
    ));

  const fixedGroup = (items: ReactNode[], caption: string) =>
    items.length ? (
      <div className="vault-settings-fixed">
        <ul className="vault-settings-chips">{items}</ul>
        <p className="vault-settings-caption">{caption}</p>
      </div>
    ) : null;

  const listRow = (key: string, label: string, sub: string, body: ReactNode, adds: ReactNode) => (
    <div className="vault-settings-item vault-settings-row vault-settings-row-stack" key={key}>
      <RowText label={label} sub={sub} />
      {body}
      {!locked ? <div className="vault-settings-adds">{adds}</div> : null}
    </div>
  );

  const deviceSub = (sw: VaultDeviceSwitch, sub: string) =>
    sw.lock === 'memory' ? c.memoryOff : sw.lock === 'project' ? c.projectOff : sub;

  const section = (key: string, title: string, body: ReactNode, foot?: ReactNode) => {
    const headId = `${uid}-${key}-head`;
    return (
      <section className="vault-settings-section" aria-labelledby={headId} key={key}>
        <h3 id={headId} className="vault-settings-head">
          {title}
        </h3>
        <div className="vault-settings-card">{body}</div>
        {foot}
      </section>
    );
  };

  const setAsides = s.setAside.filter((a) => a.reason === 'widens');
  const packSelected = device && device.packSize !== 'above-large' ? device.packSize : undefined;
  const roomSubText = !device
    ? c.roomSub
    : !device.context.on
      ? c.roomNeedsContext
      : device.packSize === 'above-large'
        ? c.roomAboveLarge
        : c.roomSub;
  const liveToday = formatToday(formatDraft.trim() || s.daily.format);

  return (
    <Sheet open={open} onClose={onClose} className="vault-settings">
      {open ? (
        <>
          <SheetHead title={c.title} onClose={onClose} />
          <p id={ids.status} className="vault-settings-status" role="status">
            {statusText ? (
              <span key={save} className="vault-settings-status-text">
                {statusText}
              </span>
            ) : null}
          </p>
          {firstChange && !locked && !save ? (
            <p className="hint vault-settings-note">{c.firstChange}</p>
          ) : null}
          {conflict ? (
            <div className="vault-settings-conflict">
              <p>
                {c.conflict(
                  fieldLabel(conflict.field, c),
                  valueLabel(conflict.field, conflict.theirs, c),
                )}
              </p>
              <button type="button" className="btn quiet press-fb" onClick={onUseYours}>
                {c.useYours(valueLabel(conflict.field, conflict.yours, c))}
              </button>
            </div>
          ) : null}
          {lockLine ? (
            <p id={ids.lock} className="hint vault-settings-note">
              {lockLine}
            </p>
          ) : null}

          {/* 1. Notes */}
          {section(
            'notes',
            c.sections.notes,
            <>
              {fieldRow(
                'newNotes',
                ['newNotes.location', 'newNotes.folder'],
                c.newNotesIn,
                newNotesValue,
                () =>
                  chevronRow(
                    c.newNotesIn,
                    newNotesValue,
                    subFor(['newNotes.location', 'newNotes.folder']),
                    () => afterExit(() => onPickFolder('newNotes.folder')),
                  ),
              )}
              {fieldRow(
                'openMode',
                ['editor.openMode'],
                c.openIn,
                optLabel('editor.openMode', s.editor.openMode),
                () =>
                  segRow(
                    'openMode',
                    ['editor.openMode'],
                    c.openIn,
                    opts['editor.openMode'],
                    s.editor.openMode,
                    (v) => set('editor.openMode', v),
                  ),
              )}
              {fieldRow('sort', ['tree.sort'], c.sortBy, optLabel('tree.sort', s.tree.sort), () =>
                segRow(
                  'sort',
                  ['tree.sort'],
                  c.sortBy,
                  opts['tree.sort'].filter((o) => caps.created || o.value !== 'created'),
                  s.tree.sort,
                  (v) => set('tree.sort', v),
                ),
              )}
              {caps.trash ? (
                fieldRow('delete', ['delete'], c.deleteLabel, optLabel('delete', s.delete), () =>
                  segRow(
                    'delete',
                    ['delete'],
                    c.deleteLabel,
                    opts.delete,
                    s.delete,
                    (v) => set('delete', v),
                    s.delete === 'permanent' ? c.deleteForGoodSub : undefined,
                  ),
                )
              ) : caps.trashLine ? (
                <div
                  className="vault-settings-item vault-settings-row vault-settings-locked"
                  aria-disabled="true"
                  aria-describedby={`${uid}-trash-line`}
                >
                  <RowText label={c.deleteLabel} sub={caps.trashLine} subId={`${uid}-trash-line`} />
                </div>
              ) : null}
              {s.ignore.paths.length ? (
                <div className="vault-settings-item vault-settings-row vault-settings-row-stack">
                  <RowText label={c.obsidianExcluded} sub={c.obsidianExcludedSub} />
                  <ul className="vault-settings-chips">{chips(s.ignore.paths, globLabel)}</ul>
                </div>
              ) : null}
            </>,
          )}

          {/* 2. Models and your notes (personal only) */}
          {team
            ? null
            : section(
                'models',
                c.sections.models,
                <>
                  {setAsides.length ? (
                    <div className="vault-settings-asides">
                      {setAsides.map((a) => (
                        <p key={a.key} className="vault-settings-aside">
                          {c.setAside(a.plain)}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {listRow(
                    'exclude',
                    c.excluded,
                    c.excludedSub,
                    <>
                      {desktop && machine
                        ? fixedGroup(chips(machine.exclude, globLabel), c.fromMachine)
                        : null}
                      {fileExclude.length ? (
                        <ul className="vault-settings-chips">
                          {chips(fileExclude, globLabel, (item) =>
                            set(
                              'exclude',
                              fileExclude.filter((x) => x !== item),
                            ),
                          )}
                        </ul>
                      ) : null}
                    </>,
                    <button
                      type="button"
                      className="vault-settings-add press-fb"
                      onClick={() => afterExit(() => onPickFolder('exclude'))}
                    >
                      {c.addFolder}
                    </button>,
                  )}
                  {listRow(
                    'localOnly',
                    c.localOnly,
                    c.localOnlySub,
                    <>
                      {fixedGroup(
                        [
                          ...chips(builtIns.paths, globLabel),
                          ...chips(builtIns.tags, (t) => `#${t}`),
                        ],
                        c.builtIn,
                      )}
                      {desktop && machine
                        ? fixedGroup(
                            [
                              ...chips(machine.localOnlyPaths, globLabel),
                              ...chips(machine.localOnlyTags, (t) => `#${t}`),
                            ],
                            c.fromMachine,
                          )
                        : null}
                      {filePaths.length || fileTags.length ? (
                        <ul className="vault-settings-chips">
                          {chips(filePaths, globLabel, (item) =>
                            set(
                              'localOnly.paths',
                              filePaths.filter((x) => x !== item),
                            ),
                          )}
                          {chips(
                            fileTags,
                            (t) => `#${t}`,
                            (item) =>
                              set(
                                'localOnly.tags',
                                fileTags.filter((x) => x !== item),
                              ),
                          )}
                        </ul>
                      ) : null}
                    </>,
                    <>
                      <button
                        type="button"
                        className="vault-settings-add press-fb"
                        onClick={() => afterExit(() => onPickFolder('localOnly.paths'))}
                      >
                        {c.addFolder}
                      </button>
                      {tagDraft === null ? (
                        <button
                          type="button"
                          className="vault-settings-add press-fb"
                          onClick={() => setTagDraft('')}
                        >
                          {c.addTag}
                        </button>
                      ) : (
                        <input
                          className="vault-settings-input"
                          // A tag is typed, so the field takes focus as it
                          // appears (the person just asked for it).
                          autoFocus
                          aria-label={c.addTag}
                          placeholder={c.tagPlaceholder}
                          value={tagDraft}
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          onChange={(e) => setTagDraft(e.target.value)}
                          onBlur={commitTag}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitTag();
                            } else if (e.key === 'Escape') {
                              e.stopPropagation();
                              setTagDraft(null);
                            }
                          }}
                        />
                      )}
                    </>,
                  )}
                  {caps.agent
                    ? fieldRow(
                        'agent',
                        ['agent.folder'],
                        c.agentWrites,
                        s.agent.folder ?? c.agentAnywhere,
                        () =>
                          chevronRow(
                            c.agentWrites,
                            s.agent.folder ?? c.agentAnywhere,
                            c.agentWritesSub,
                            () => afterExit(() => onPickFolder('agent.folder')),
                          ),
                      )
                    : null}
                </>,
              )}

          {/* 3. On this device (personal only; device-local, never locked by
              the vault file) */}
          {team || !device
            ? null
            : section(
                'device',
                c.sections.device,
                <>
                  <div className="vault-settings-item vault-settings-row">
                    <RowText
                      label={c.notesInChats}
                      sub={deviceSub(device.context, c.notesInChatsSub)}
                    />
                    <Switch
                      label={c.notesInChats}
                      checked={device.context.on && !device.context.lock}
                      disabled={Boolean(device.context.lock)}
                      onChange={(next) => onDevice({ context: next })}
                    />
                  </div>
                  <div className="vault-settings-item vault-settings-row vault-settings-row-stack">
                    <RowText label={c.room} sub={roomSubText} subId={`${uid}-room-sub`} />
                    <Segmented
                      label={c.room}
                      opts={[
                        { value: 'small' as const, label: c.roomSmall },
                        { value: 'normal' as const, label: c.roomNormal },
                        { value: 'large' as const, label: c.roomLarge },
                      ]}
                      value={packSelected}
                      disabled={!device.context.on || Boolean(device.context.lock)}
                      describedBy={`${uid}-room-sub`}
                      onPick={(v) => onDevice({ packSize: v })}
                    />
                    {device.engine && device.context.on && !device.context.lock ? (
                      <p className="hint vault-settings-engine" role="note">
                        {c.roomEngine(device.engine.where, device.engine.size)}
                      </p>
                    ) : null}
                    {device.cloudSeat ? (
                      <p className="vault-settings-spend">
                        <span className="vault-settings-spend-dot" aria-hidden="true" />
                        {c.roomSpend}
                      </p>
                    ) : null}
                  </div>
                  <div className="vault-settings-item vault-settings-row">
                    <RowText label={c.handoff} sub={deviceSub(device.handoff, c.handoffSub)} />
                    <Switch
                      label={c.handoff}
                      checked={device.handoff.on && !device.handoff.lock}
                      disabled={Boolean(device.handoff.lock)}
                      onChange={(next) => onDevice({ handoff: next })}
                    />
                  </div>
                </>,
                <p className="vault-settings-foot">{c.deviceFooter}</p>,
              )}

          {/* 4. Today's note */}
          {section(
            'today',
            c.sections.today,
            <>
              {fieldRow(
                'dailyFolder',
                ['daily.folder'],
                c.dailyFolder,
                s.daily.folder || c.topOfVault,
                () =>
                  chevronRow(
                    c.dailyFolder,
                    s.daily.folder || c.topOfVault,
                    subFor(['daily.folder']),
                    () => afterExit(() => onPickFolder('daily.folder')),
                  ),
              )}
              {fieldRow('dateFormat', ['daily.format'], c.dateFormat, s.daily.format, () => (
                <label className="vault-settings-row vault-settings-row-stack">
                  <RowText
                    label={c.dateFormat}
                    sub={subFor(['daily.format'], liveToday ? c.today(liveToday) : undefined)}
                  />
                  <input
                    className="vault-settings-input"
                    value={formatDraft}
                    placeholder={s.daily.format}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) => setFormatDraft(e.target.value)}
                    onBlur={() => {
                      const next = formatDraft.trim();
                      if (next === s.daily.format) return;
                      set('daily.format', next || null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                  />
                </label>
              ))}
              {fieldRow(
                'template',
                ['daily.template'],
                c.template,
                s.daily.template ?? c.none,
                () =>
                  chevronRow(
                    c.template,
                    s.daily.template ?? c.none,
                    subFor(['daily.template']),
                    () => afterExit(() => onPickFolder('daily.template')),
                  ),
              )}
              {fieldRow(
                'templatesFolder',
                ['templates.folder'],
                c.templatesFolder,
                s.templates.folder ?? c.none,
                () =>
                  chevronRow(
                    c.templatesFolder,
                    s.templates.folder ?? c.none,
                    subFor(['templates.folder']),
                    () => afterExit(() => onPickFolder('templates.folder')),
                  ),
              )}
            </>,
          )}

          {/* 5. Links and files */}
          {section(
            'links',
            c.sections.links,
            <>
              {fieldRow(
                'linkStyle',
                ['links.style'],
                c.newLinks,
                optLabel('links.style', s.links.style),
                () =>
                  segRow(
                    'linkStyle',
                    ['links.style'],
                    c.newLinks,
                    opts['links.style'],
                    s.links.style,
                    (v) => set('links.style', v),
                  ),
              )}
              {desktop
                ? fieldRow(
                    'linkFormat',
                    ['links.format'],
                    c.linkPaths,
                    optLabel('links.format', s.links.format),
                    () =>
                      segRow(
                        'linkFormat',
                        ['links.format'],
                        c.linkPaths,
                        opts['links.format'],
                        s.links.format,
                        (v) => set('links.format', v),
                      ),
                  )
                : null}
              {fieldRow(
                'attachments',
                ['attachments.folder'],
                c.attachmentsFolder,
                c.attachmentsValue(s.attachments.folder),
                () =>
                  chevronRow(
                    c.attachmentsFolder,
                    c.attachmentsValue(s.attachments.folder),
                    subFor(['attachments.folder']),
                    () => afterExit(() => onPickFolder('attachments.folder')),
                  ),
              )}
            </>,
          )}

          {/* 6. Editor: a step on the platform base, never pixels */}
          {section(
            'editor',
            c.sections.editor,
            <>
              {fieldRow(
                'font',
                ['editor.font'],
                c.font,
                optLabel('editor.font', s.editor.font),
                () =>
                  segRow('font', ['editor.font'], c.font, opts['editor.font'], s.editor.font, (v) =>
                    set('editor.font', v === 'default' ? null : v),
                  ),
              )}
              {fieldRow(
                'size',
                ['editor.size'],
                c.size,
                optLabel('editor.size', s.editor.size),
                () =>
                  segRow('size', ['editor.size'], c.size, opts['editor.size'], s.editor.size, (v) =>
                    set('editor.size', v === 'default' ? null : v),
                  ),
              )}
              <p className="vault-settings-sample" {...vaultTypeAttrs(s.editor)}>
                {VAULT_EDITOR_SAMPLE}
              </p>
            </>,
          )}

          {/* 7. Where it lives */}
          {section(
            'where',
            c.sections.where,
            chevronRow(c.whereLives, storageName, undefined, () => afterExit(onOpenStorage)),
          )}

          <p className="vault-settings-foot">{footer}</p>
        </>
      ) : null}
    </Sheet>
  );
}
