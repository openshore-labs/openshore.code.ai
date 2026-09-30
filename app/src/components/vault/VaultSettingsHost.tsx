// The Vault settings sheet, bound to the store (Vault M7 wave 2; CTO L7, L11,
// L13, L15, L16; CX Y1 to Y10, Y14). One host for every way in (note
// Options, the storage sheet's end, Settings' Wayfinding row), so the save
// flow, the conflict and the folder picks are one piece of code:
// - Each commit writes one field through the store (`vaultSaveSetting`, F's
//   compare-and-swap save); the status line says Saving, then Saved, and a
//   same-field conflict shows theirs with "Use {yours}".
// - "On this device" writes device settings only (`vaultDevicePatch`), with
//   the Wayfinding toasts.
// - A folder pick opens the list once the settings sheet has left, then the
//   settings sheet comes back (R5); a pick for "New notes go in" also sets
//   where new notes go.
// - A team vault reads its settings row (0025): an admin changes them and who
//   may delete, a member reads them with "Your admins set these." (CX Y14),
//   and a lapsed plan reads only, with the lead's line (Y15). A field the
//   storage does not carry out (`unappliedSettings`) has no row: the team
//   vault never offers Delete "For good", since its deletes stay in Trash.
import { useEffect, useMemo, useState } from 'react';
import {
  VAULT_SETTINGS_DEFAULTS,
  datePartsOf,
  formatVaultDate,
  type ResolvedVaultSettings,
  type VaultSettingsPatch,
} from 'os-code/protocol';
import { isOrgAdmin, useApp } from '../../state/store.js';
import { memoryOverride } from '../../lib/currents.js';
import { bridge } from '../../lib/electronBridge.js';
import { isDesktop, isPhone, platform } from '../../lib/platform.js';
import { hubReach } from '../../lib/gitos/hub.js';
import { providerFor } from '../../lib/gitos/index.js';
import { PROVIDER_ROSTER, type StorageProviderId } from '../../lib/gitos/providers.js';
import { sheetExitMs } from '../../lib/motion.js';
import {
  VAULT_SETTINGS_AWAY,
  VAULT_SETTINGS_FOOTER_FILE,
  VAULT_SETTINGS_FOOTER_LOCAL,
  copyProviderOf,
  vaultCapLine,
  VAULT_TEAM_DELETE_ROLES,
  VAULT_TEAM_LAPSED_LEAD,
  VAULT_TEAM_SETTINGS_TITLE,
  VAULT_TEAM_WHO_DELETES,
  VAULT_TEAM_WHO_DELETES_SUB,
  vaultCopy,
  vaultHandoffToast,
  vaultNotesInChatsToast,
  vaultSettingsTeamFooter,
} from '../../lib/vaultCopy.js';
import {
  vaultDevicePatch,
  vaultDeviceView,
  type VaultEngineRoomSource,
} from '../../lib/vaultDevice.js';
import { vaultSettingsSheetCopy } from '../../lib/vaultSettingsSheetCopy.js';
import { vaultTreeSortOffered } from '../../lib/vault.js';
import { vaultFolderChoices, vaultPickPatches } from '../../lib/vaultSettingsPick.js';
import { VAULT_PRIVACY_DEFAULTS } from '../../state/types.js';
import { Sheet } from '../Sheet.js';
import { SheetHead } from '../SheetHead.js';
import {
  VaultSettingsSheet,
  type VaultSettingsConflict,
  type VaultSettingsPickField,
  type VaultSettingsSheetCopy,
} from './VaultSettingsSheet.js';

const VAULT_RESOURCE_ID = 'vault.personal';

/** A value from the save as the conflict shows it. */
function asConflictValue(v: unknown): string | readonly string[] | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[];
  return null;
}

/** The list a pick offers, and what its first row means. */
function pickRows(
  field: VaultSettingsPickField,
  c: VaultSettingsSheetCopy,
  folders: readonly string[],
  notes: readonly string[],
): { head: Array<{ key: string; label: string; choice: 'default' | 'current' }>; items: string[] } {
  switch (field) {
    case 'newNotes.folder':
      return {
        head: [
          { key: 'root', label: c.topOfVault, choice: 'default' },
          { key: 'current', label: c.newNotesCurrent, choice: 'current' },
        ],
        items: [...folders],
      };
    case 'daily.template':
      return { head: [{ key: 'none', label: c.none, choice: 'default' }], items: [...notes] };
    case 'agent.folder':
      return {
        head: [{ key: 'any', label: c.agentAnywhere, choice: 'default' }],
        items: [...folders],
      };
    case 'exclude':
    case 'localOnly.paths':
      return { head: [], items: [...folders] };
    case 'templates.folder':
      return { head: [{ key: 'none', label: c.none, choice: 'default' }], items: [...folders] };
    default:
      return {
        head: [{ key: 'top', label: c.topOfVault, choice: 'default' }],
        items: [...folders],
      };
  }
}

/** The row label a pick's sheet is titled with. */
function pickTitle(field: VaultSettingsPickField, c: VaultSettingsSheetCopy): string {
  switch (field) {
    case 'newNotes.folder':
      return c.newNotesIn;
    case 'daily.folder':
      return c.dailyFolder;
    case 'daily.template':
      return c.template;
    case 'templates.folder':
      return c.templatesFolder;
    case 'attachments.folder':
      return c.attachmentsFolder;
    case 'agent.folder':
      return c.agentWrites;
    case 'exclude':
      return c.excluded;
    case 'localOnly.paths':
      return c.localOnly;
  }
}

export interface VaultSettingsHostProps {
  open: boolean;
  /** The host opens and closes itself around a folder pick. */
  setOpen: (open: boolean) => void;
  /** "Where it lives": the room opens its storage sheet. */
  onOpenStorage: () => void;
}

export function VaultSettingsHost({ open, setOpen, onOpenStorage }: VaultSettingsHostProps) {
  const {
    settings,
    vaultSettings,
    vaultScope,
    vaultFiles,
    vaultFolders,
    vaultCapsNow,
    vaultReadOnly,
    vaultLoadSettings,
    vaultEngineRoomSource,
    vaultSaveSetting,
    vaultSetTeamDeleteRole,
    vaultTeamPlan,
    saveSettings,
    showToast,
  } = useApp();
  const copy = useMemo(() => vaultSettingsSheetCopy(), []);
  const team = vaultScope === 'team';
  const s: ResolvedVaultSettings = vaultSettings || VAULT_SETTINGS_DEFAULTS;
  const providerId: StorageProviderId = team
    ? 'org'
    : ((settings.gitosResources ?? []).find((r) => r.id === VAULT_RESOURCE_ID)?.providerId ??
      'local');
  const copyProvider = copyProviderOf(providerId) ?? 'local';
  const unapplied = providerFor(providerId)?.unappliedSettings;
  const caps = vaultCapsNow();
  const storageCaps = vaultCapsNow({ storageOnly: true });

  const [save, setSave] = useState<'saving' | 'saved' | 'merged' | 'failed'>();
  const [conflict, setConflict] = useState<VaultSettingsConflict>();
  const [changed, setChanged] = useState(false);
  const [pick, setPick] = useState<VaultSettingsPickField>();
  const [picking, setPicking] = useState(false);
  const [machine, setMachine] = useState<{
    exclude: string[];
    localOnlyPaths: string[];
    localOnlyTags: string[];
  }>();

  // Each open reads the settings fresh and starts with a quiet status line.
  useEffect(() => {
    if (!open) return;
    setSave(undefined);
    setConflict(undefined);
    void vaultLoadSettings({ force: true });
  }, [open, team, vaultLoadSettings]);

  // The desktop shows the machine's own lists, read-only (CX Y3).
  useEffect(() => {
    if (!open || team || !isDesktop()) return;
    const b = bridge();
    if (!b?.vaultPrivacy) return;
    let live = true;
    const builtIn = new Set<string>([
      ...VAULT_PRIVACY_DEFAULTS.localOnly.paths,
      ...VAULT_PRIVACY_DEFAULTS.localOnly.tags,
      ...VAULT_PRIVACY_DEFAULTS.exclude,
    ]);
    void b
      .vaultPrivacy()
      .then((cfg) => {
        if (!live) return;
        const own = (list: readonly string[]) => list.filter((x) => !builtIn.has(x));
        setMachine({
          exclude: own(cfg.exclude),
          localOnlyPaths: own(cfg.localOnly.paths),
          localOnlyTags: own(cfg.localOnly.tags),
        });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, team]);

  // Where this device's engine sessions run and that computer's own Room for
  // notes (Vault M8): read at each open, so the row can say when those
  // sessions use a size other than the one selected here.
  const [engine, setEngine] = useState<VaultEngineRoomSource>();
  useEffect(() => {
    if (!open || team) return;
    let live = true;
    void vaultEngineRoomSource()
      .then((got) => {
        if (live) setEngine(got);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, team, vaultEngineRoomSource]);

  const commit = async (patches: readonly VaultSettingsPatch[]) => {
    if (!patches.length) return;
    setSave('saving');
    setConflict(undefined);
    let merged = false;
    for (const patch of patches) {
      const r = await vaultSaveSetting(patch);
      if (r.kind === 'saved') {
        merged ||= r.merged;
        setChanged(true);
        continue;
      }
      if (r.kind === 'same-field') {
        setSave(undefined);
        setConflict({ field: r.field, theirs: asConflictValue(r.theirs), yours: r.yours });
        return;
      }
      setSave(r.kind === 'failed' ? 'failed' : undefined);
      return;
    }
    setSave(merged ? 'merged' : 'saved');
  };

  const memoryOn = memoryOverride(settings) !== false;
  const stack = settings.stack;
  const cloudSeat = [stack?.reasoning, ...(stack?.active ?? []).map((a) => a.ref)].some(
    (r) => r?.kind === 'cloud',
  );
  const away = providerId === 'hub' && hubReach() === 'away';
  const teamAdmin = vaultTeamPlan?.isAdmin ?? isOrgAdmin(settings.account);
  const teamLapsed = team && vaultTeamPlan?.entitled === false;
  const lockLine = team
    ? teamLapsed
      ? VAULT_TEAM_LAPSED_LEAD
      : caps.settingsWrite || !teamAdmin
        ? undefined
        : vaultCapLine('org', 'settingsWrite')
    : caps.settingsWrite
      ? undefined
      : away
        ? VAULT_SETTINGS_AWAY
        : (vaultReadOnly() ?? vaultCapLine(copyProvider, 'settingsWrite'));
  const footer = team
    ? vaultSettingsTeamFooter({
        admin: teamAdmin,
        ...(settings.account?.org?.name ? { org: settings.account.org.name } : {}),
      })
    : providerId === 'local'
      ? VAULT_SETTINGS_FOOTER_LOCAL
      : VAULT_SETTINGS_FOOTER_FILE;
  const agent = Boolean(
    vaultCopy(platform(), copyProvider, {
      paired: Boolean(settings.daemon),
      ...(settings.daemon?.name ? { hubName: settings.daemon.name } : {}),
    }).agent,
  );
  const folders = useMemo(
    () =>
      vaultFolderChoices(
        vaultFiles.map((f) => f.path),
        vaultFolders ?? [],
      ),
    [vaultFiles, vaultFolders],
  );
  const notes = useMemo(() => vaultFiles.map((f) => f.path).sort(), [vaultFiles]);

  const closePick = (reopen: boolean) => {
    setPicking(false);
    setTimeout(() => {
      setPick(undefined);
      if (reopen) setOpen(true);
    }, sheetExitMs());
  };
  const choose = (
    choice: { kind: 'value'; value: string } | { kind: 'default' } | { kind: 'current' },
  ) => {
    if (pick) void commit(vaultPickPatches(pick, choice, s));
    closePick(true);
  };
  const rows = pick ? pickRows(pick, copy, folders, notes) : undefined;

  // Who may delete team notes (Y14): one guarded write of the settings row.
  const deleteRoles = (['admin', 'member'] as const).map((value) => ({
    value,
    label: VAULT_TEAM_DELETE_ROLES[value],
  }));
  const setDeleteRole = async (role: 'admin' | 'member') => {
    setSave('saving');
    setConflict(undefined);
    const r = await vaultSetTeamDeleteRole(role);
    if (r === 'ok') {
      setSave('saved');
      return;
    }
    setSave(r === 'failed' ? 'failed' : undefined);
    if (r === 'changed') {
      const now = useApp.getState().vaultTeamPlan?.deleteRole ?? 'member';
      showToast(copy.conflict(VAULT_TEAM_WHO_DELETES, VAULT_TEAM_DELETE_ROLES[now]));
    }
  };

  return (
    <>
      <VaultSettingsSheet
        open={open}
        onClose={() => setOpen(false)}
        copy={copy}
        settings={s}
        platform={isPhone() ? 'phone' : 'desktop'}
        team={team}
        {...(team
          ? {
              title: VAULT_TEAM_SETTINGS_TITLE,
              readOnly: !caps.settingsWrite,
              teamDelete: {
                label: VAULT_TEAM_WHO_DELETES,
                sub: VAULT_TEAM_WHO_DELETES_SUB,
                options: deleteRoles,
                value: vaultTeamPlan?.deleteRole ?? 'member',
                ...(caps.settingsWrite ? { onChange: (v) => void setDeleteRole(v) } : {}),
              },
            }
          : {})}
        {...(unapplied ? { unapplied } : {})}
        storageName={PROVIDER_ROSTER.find((r) => r.id === providerId)?.label ?? providerId}
        footer={footer}
        {...(lockLine ? { lockLine } : {})}
        {...(save ? { save } : {})}
        firstChange={
          !team &&
          caps.settingsWrite &&
          providerId !== 'local' &&
          s.fileState === 'absent' &&
          !changed
        }
        {...(conflict ? { conflict } : {})}
        caps={{
          trash: storageCaps.trash,
          ...(storageCaps.trash ? {} : { trashLine: vaultCapLine(copyProvider, 'trash') }),
          created: vaultTreeSortOffered(vaultFiles).includes('created'),
          agent,
        }}
        {...(team
          ? {}
          : {
              device: vaultDeviceView(settings, {
                memoryOn,
                cloudSeat,
                ...(engine ? { engine } : {}),
              }),
              ...(machine ? { machine } : {}),
            })}
        builtIns={VAULT_PRIVACY_DEFAULTS.localOnly}
        formatToday={(format) => {
          const r = formatVaultDate(datePartsOf(new Date()), format);
          return r.ok ? r.text : undefined;
        }}
        onChange={(patch) => void commit([patch])}
        onUseYours={() => {
          if (conflict) void commit([{ field: conflict.field, value: conflict.yours }]);
        }}
        onDevice={(change) => {
          void saveSettings(vaultDevicePatch(change));
          if (change.context !== undefined) showToast(vaultNotesInChatsToast(change.context));
          if (change.handoff !== undefined) showToast(vaultHandoffToast(change.handoff));
        }}
        onPickFolder={(field) => {
          setPick(field);
          setPicking(true);
        }}
        onOpenStorage={onOpenStorage}
      />
      <Sheet open={picking} onClose={() => closePick(true)}>
        {pick && rows ? (
          <>
            <SheetHead title={pickTitle(pick, copy)} onClose={() => closePick(true)} />
            <div className="vault-settings-pick" role="list">
              {rows.head.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  role="listitem"
                  className="vault-settings-pick-row press-fb"
                  onClick={() => choose({ kind: r.choice })}
                >
                  {r.label}
                </button>
              ))}
              {rows.items.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="listitem"
                  className="vault-settings-pick-row press-fb"
                  onClick={() => choose({ kind: 'value', value: item })}
                >
                  {pick === 'daily.template' ? item.replace(/\.md$/i, '') : item}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </Sheet>
    </>
  );
}
