// Vault: an Obsidian-compatible markdown knowledge base, the first consumer
// of the gitOS storage seam. Plain .md files in folders, [[wikilinks]], an
// edit/read toggle, and Linked mentions, all rendered in OS Code's own paper
// and ink rather than anyone else's dark theme. Design: the studio's "Paper
// Study" direction.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  agenticView,
  useApp,
  vaultHeldFor,
  type VaultHeldDraft,
  type VaultTargetRef,
} from '../state/store.js';
import type { VaultUndo } from '../state/vaultOps.js';
import { BackBar } from '../components/BackBar.js';
import { ErrorBoundary } from '../components/ErrorBoundary.js';
import { VaultMarkdown } from '../components/VaultMarkdown.js';
import {
  isConflictCopy,
  noteFolder,
  noteTitle,
  nonNoteExtension,
  normalizeNotePath,
  treeAt,
  vaultPendingCount,
  wikilinkContext,
} from '../lib/vault.js';
import {
  PROVIDER_ROSTER,
  probeReady,
  isGdriveConfigured,
  isGdriveConnected,
  onDeviceFolderChanged,
  watchDeviceFolder,
  type GitosResource,
  type StorageProviderId,
} from '../lib/gitos/index.js';
import {
  exportTeamVaultToFiles,
  exportVaultToFiles,
  vaultExportLine,
  vaultTeamExportable,
  vaultWayOut,
} from '../lib/vaultExport.js';
import { VAULT_AUTOSAVE_MS, vaultAutosave } from '../lib/vaultAutosave.js';
import {
  DRIVE_RECONNECT_FAILED_LINE,
  DRIVE_WEB_URL,
  VAULT_FOLDER_MISSING_LINE,
  VAULT_LARGE_NOTES,
  VAULT_NOT_FOUND_PILL,
  VAULT_OBSIDIAN_HOWTO,
  VAULT_OPEN_CHATS_LINE,
  VAULT_OPEN_OBSIDIAN,
  VAULT_OPENING_LINE,
  VAULT_PRIVACY_BUTTON,
  VAULT_SAME_FOLDER_LINE,
  VAULT_UPDATED_SUFFIX,
  VAULT_TEAM_SIGN_IN_LINE,
  VAULT_CONFLICT_BADGE,
  vaultEditedByLine,
  vaultLeaseAlsoOpen,
  vaultLeaseEnforced,
  VAULT_CONFLICT_BADGE_LABEL,
  VAULT_DELETED,
  copyProviderOf,
  vaultCloudLine,
  vaultConflictCard,
  vaultCopy,
  vaultDriveCard,
  vaultDriveMoveRefusal,
  vaultEarlierFolderHeld,
  vaultFolderFacts,
  vaultFolderOffer,
  vaultFolderQuestion,
  vaultHeldHint,
  vaultHeldKeep,
  vaultHeldLine,
  vaultLead,
  vaultMissingFolderCard,
  vaultBringLine,
  vaultMoveLine,
  vaultMovingLine,
  vaultOffersProvider,
  vaultOnboard,
  vaultPickRefusal,
  vaultPickResultCopy,
  vaultPickerRow,
  vaultRevealLabel,
  vaultSaveChip,
  vaultSheetLine,
  vaultWarningLine,
  vaultWelcomeNote,
  vaultRestoreFailed,
  vaultRestoredToast,
  vaultTrashEmptied,
  vaultTrashFailed,
  vaultUndoFailed,
  vaultUndoText,
  VAULT_TRASH_EMPTY_FAILED,
  VAULT_TRASH_LIST_FAILED,
  type VaultDriveLink,
  type VaultOnboard,
  type VaultSaveStatus,
  HUB_AWAY_LINE,
  HUB_OFFER_COPY,
  hubMoveOffer,
} from '../lib/vaultCopy.js';
import { copyText } from '../lib/clipboard.js';
import { openPrivacySettings, openVaultInObsidian, revealVaultFolder } from '../lib/vaultFolder.js';
import { folderNotesSince } from '../lib/vaultOffer.js';
import {
  closeVaultIndex,
  currentVaultIndex,
  useVaultIndexStatus,
  vaultIndexLine,
} from '../lib/vaultIndexHost.js';
import type { VaultDirInfo, VaultPickResult, VaultRefineChoice } from '../lib/electronBridge.js';
import type { StoredFile } from '../lib/gitos/providers.js';
import { Sheet } from '../components/Sheet.js';
import { VaultResolveSheet } from '../components/VaultResolveSheet.js';
import { hapticApproval, hapticCommit } from '../lib/haptics.js';
import { SheetHead } from '../components/SheetHead.js';
import { activeContribution, slotNone } from '../lib/currents.js';
import { hermesNoteRead, hermesNotesList } from '../lib/currentsProbe.js';
import { isDesktop, openExternal, platform } from '../lib/platform.js';
import { useExitPresence } from '../hooks/useExitPresence.js';
import { durationMs, sheetExitMs } from '../lib/motion.js';
import type { HermesNote, HermesNoteMeta } from 'os-code/protocol';
import { Icon } from '../components/Icon.js';
import { VaultAgentRecent } from '../components/VaultAgentRecent.js';
import { VaultBacklinks } from '../components/vault/VaultBacklinks.js';
import { VaultLinkSuggest } from '../components/vault/VaultLinkSuggest.js';
import { VaultNoteOptions } from '../components/vault/VaultNoteOptions.js';
import { VaultTrashRow, VaultTrashView } from '../components/vault/VaultTrashView.js';
import { VaultUndoToast, type VaultUndoToastItem } from '../components/vault/VaultUndoToast.js';
import { hubReach, subscribeHubReach } from '../lib/gitos/hub.js';
import { PROJECT_VAULT_PINS_MAX } from '../state/types.js';

const VAULT_RESOURCE_ID = 'vault.personal';

/** A move's forked pairs as the move-mode resolve sheet steps through them:
 *  which one is on screen, both of its texts as read, and how the last
 *  choice went. */
interface ForkSteps {
  pairs: Array<{ from: string; to: string }>;
  i: number;
  shown?: { there: StoredFile; moved: StoredFile };
  busy: boolean;
  failed?: boolean;
  partial?: boolean;
  again?: boolean;
}

/** How long the editor must be quiet before the resolve sheet rises over it
 *  (Creative Studio 1c): never mid-keystroke, so the text the person is
 *  typing into never jumps. A behavior timer, not motion: twice the autosave
 *  debounce. */
const VAULT_RESOLVE_IDLE_MS = 2 * VAULT_AUTOSAVE_MS;

/** Whether this device can still reach the Google account a Drive vault
 *  needs: connected, signed out of it, or a build that cannot connect. */
async function probeDriveLink(): Promise<VaultDriveLink> {
  if (await isGdriveConnected().catch(() => false)) return 'connected';
  return isGdriveConfigured() ? 'disconnected' : 'unconfigured';
}

export function VaultScreen() {
  const {
    vaultFiles,
    vaultNote,
    vaultScope,
    setVaultScope,
    teamVaultAvailable,
    vaultRefresh,
    vaultOpen,
    vaultCreate,
    vaultCloseNote,
    vaultSave,
    vaultReadAll,
    vaultReadBody,
    vaultMoveTo,
    vaultError,
    vaultHeld,
    vaultPending,
    vaultSaving,
    vaultTeamExpired,
    vaultTargetRef,
    vaultReadOnly,
    vaultDiscardHeld,
    vaultReleaseLease,
    vaultLeaseTouch,
    vaultTakeOverLease,
    vaultLeaseHeldByOther,
    vaultLeaseOther,
    connectGdriveAccount,
    disconnectGdriveAccount,
    authSession,
    settings,
    hubRole,
    showToast,
    openProjectMemory,
    repoSyncConflicts,
    vaultConflict,
    vaultRecheck,
    vaultStartPoll,
    vaultStopPoll,
    vaultResolve,
    vaultDeferConflict,
    vaultLeaveConflict,
    vaultNoteDraft,
    vaultReturnFolder,
    vaultTakeReturnFolder,
    vaultFolder,
    vaultMoving,
    vaultListed,
    vaultLoadFolder,
    vaultChooseFolder,
    vaultRefineFolder,
    vaultFolderOfferShown,
    vaultDeclineFolderMove,
    vaultReadForkPair,
    vaultSettleFork,
    vaultDesktopChatOpen,
    vaultBringPrevious,
    askAboutVaultNote,
    pinVaultNoteToProject,
    canEditProjectPins,
    vaultHubOfferShown,
    vaultAcceptHubMove,
    vaultDeclineHubMove,
    vaultAgentRecent,
    vaultBindAutosave,
    vaultCapsNow,
    vaultDeleteNote,
    vaultUndoDelete,
    vaultTrash,
    vaultLoadTrash,
    vaultRestoreTrash,
    vaultEmptyTrash,
  } = useApp();

  const team = vaultScope === 'team';
  // Which platform this is, whether a computer is paired, and whether this is
  // a member's device on someone else's computer: the copy map
  // (lib/vaultCopy.ts) says only what holds for the pair, an unpaired phone
  // has no agent to point at, and a member's sessions have no vault (0.13).
  const on = platform();
  const hubMember = hubRole === 'member';
  const copyOpts = {
    hubMember,
    hubName: settings.daemon?.name,
    paired: Boolean(settings.daemon),
  };
  // The held text this account may see: every personal entry, and team text
  // only under the account that typed it (R-19). Raw vaultHeld also holds
  // other accounts' team text, so nothing here renders it.
  const uid = authSession?.user.id;
  const heldVisible = useMemo(() => vaultHeldFor(vaultHeld, uid), [vaultHeld, uid]);

  // The Agentic Current's notes (a Hermes home's memory and skills), listed
  // once the current is on and read one at a time into a sheet. Undefined
  // while reading or unreachable; an answered listing may be empty.
  const current = activeContribution(agenticView(settings));
  const currentVault = current && !slotNone(current.vault) ? current.vault : undefined;
  // 'silent': a computer is paired but did not answer (its own state, with Try
  // again), kept apart from an answered, empty listing.
  const [currentNotes, setCurrentNotes] = useState<
    { home: string; notes: HermesNoteMeta[] } | 'silent' | undefined
  >();
  const [notesAsk, setNotesAsk] = useState(0);
  const [currentNote, setCurrentNote] = useState<HermesNote | undefined>();
  useEffect(() => {
    if (!currentVault) {
      setCurrentNotes(undefined);
      return;
    }
    let live = true;
    setCurrentNotes(undefined);
    const reachable = Boolean(settings.daemon) || isDesktop();
    void hermesNotesList(settings.daemon).then((r) => {
      if (!live) return;
      setCurrentNotes(r ?? (reachable ? 'silent' : undefined));
    });
    return () => {
      live = false;
    };
    // Re-read when the current changes or the hub does (or on Try again).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, settings.daemon?.baseUrl, notesAsk]);
  const openCurrentNote = async (path: string) => {
    const note = await hermesNoteRead(settings.daemon, path);
    if (note) setCurrentNote(note);
    else showToast('That note could not be read right now.');
  };
  // Another device holds the enforced lease (a storage without
  // compare-and-swap): the room writes nothing and says why, with Take over
  // editing (2.5). On a storage with compare-and-swap the lease is only the
  // quiet "Also open on your iPad" line.
  const readOnly = Boolean(vaultLeaseHeldByOther);
  const leaseCopy = vaultLeaseEnforced(vaultLeaseOther?.label);
  const alsoOpen =
    vaultLeaseOther?.mode === 'advisory' ? vaultLeaseAlsoOpen(vaultLeaseOther.label) : undefined;
  const takeOver = () => {
    hapticCommit();
    void vaultTakeOverLease();
  };
  const renderLeaseLine = () =>
    readOnly ? (
      <div className="vault-lease-line" role="status">
        <p className="hint" style={{ margin: 0, color: 'var(--warn)' }}>
          {leaseCopy.line}
        </p>
        <button type="button" className="btn ghost press-fb" onClick={takeOver}>
          {leaseCopy.takeOver}
        </button>
      </div>
    ) : null;
  // A personal vault on Google Drive is read-only in v1 (0.18): the reason
  // shows as a card with a one-tap way off, and the controls that edit,
  // create, and delete are left out, not dimmed.
  const driveReadOnly = team ? undefined : vaultReadOnly();
  // The desktop vault's folder is not there (renamed, moved, or on a drive
  // that is not connected): the room says so and writes nothing, and never
  // falls back quietly to another folder (CX 1.4).
  const personalOnFolder =
    !team &&
    (settings.gitosResources as GitosResource[] | undefined)?.find(
      (r) => r.id === VAULT_RESOURCE_ID,
    )?.providerId === 'files';
  const folderGone = personalOnFolder && vaultFolder?.exists === false;
  // A move is running: the room holds still, so nothing typed can miss the
  // copy (CX 1.3).
  // The team sign-in expired with a team note open: the note stays, read-only,
  // until the person signs back in or leaves it (2.6).
  const teamExpired = team && Boolean(vaultTeamExpired);
  // The personal vault is on the paired computer and it did not answer (CTO
  // J9): the list is the last one seen, an open note still saves (its change
  // waits here), and the tree holds still, so New note and Delete leave.
  const reach = useSyncExternalStore(subscribeHubReach, hubReach, hubReach);
  const personalOnHub =
    !team &&
    (settings.gitosResources as GitosResource[] | undefined)?.find(
      (r) => r.id === VAULT_RESOURCE_ID,
    )?.providerId === 'hub';
  const hubAway = personalOnHub && reach === 'away';
  const locked =
    readOnly || Boolean(driveReadOnly) || Boolean(vaultMoving) || folderGone || teamExpired;
  // What this storage may do now (CTO K1): every M6 action's visibility
  // follows this one answer.
  const caps = vaultCapsNow();
  const teamAvailable = teamVaultAvailable();
  // The project a note's "Pin to project context" pins to: the active one.
  const pinProjectId = settings.activeProjectId ?? settings.projects?.[0]?.id;
  const pinProjectName = settings.projects?.find((p) => p.id === pinProjectId)?.name;
  // The one-time "keep one vault on your computer" card after pairing (J9).
  const [hubMoving, setHubMoving] = useState(false);
  const [hubFailed, setHubFailed] = useState(false);
  const hubOfferShown = !team && vaultHubOfferShown();

  const [folder, setFolder] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [storageOpen, setStorageOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [backlinks, setBacklinks] = useState<Array<{ path: string; excerpt: string }>>([]);
  // Why Linked mentions may be incomplete, or undefined when every note read.
  const [mentionsError, setMentionsError] = useState<string | undefined>();
  const [ready, setReady] = useState<Partial<Record<StorageProviderId, boolean>>>({});
  // A Google account connected before Drive was held back, so it can still be
  // disconnected from here.
  const [driveConnected, setDriveConnected] = useState(false);
  // Whether a read-only Drive vault's account is still reachable here, so its
  // card offers a move that can work (0.18). Undefined while unknown.
  const [driveLink, setDriveLink] = useState<VaultDriveLink | undefined>();
  const [moving, setMoving] = useState(false);
  // Bring from the previous folder: running, and the pick it went through for.
  const [bringing, setBringing] = useState(false);
  const [brought, setBrought] = useState<string | undefined>();
  // The desktop folder picker (1.4): the dialog is up, the last pick's result
  // (the storage sheet shows it), whether its one question was answered, and
  // the line a refusal or a same-folder pick leaves under the picker row.
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState<Extract<VaultPickResult, { ok: true }> | undefined>();
  const [pickAnswered, setPickAnswered] = useState(false);
  const [pickLine, setPickLine] = useState<
    { text: string; warn: boolean; privacy?: boolean } | undefined
  >();
  // A refused move from the move card, said inside the card (CX 1.3).
  const [offerFailed, setOfferFailed] = useState<string | undefined>();
  // A move's forked pairs, one at a time in the move-mode resolve sheet (1d).
  const [forks, setForks] = useState<ForkSteps | undefined>();
  const [forksOpen, setForksOpen] = useState(false);
  // The Undo toast after a delete (CX X9): one at a time, each with the vault
  // it was deleted from, so an Undo never lands in another one.
  const [undoItem, setUndoItem] = useState<VaultUndoToastItem | undefined>();
  const undoFor = useRef(new Map<string, { undo: VaultUndo; at?: VaultTargetRef }>());
  // The Trash view, a page inside the room (CX X10).
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashError, setTrashError] = useState<string | undefined>();
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  // Compare-and-swap (1.1): when the person last typed, whether the resolve
  // sheet is up, what a choice is doing, and whether the meta line carries
  // the quiet "Updated from elsewhere" after a calm reload.
  const lastInputAt = useRef(0);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveBusy, setResolveBusy] = useState(false);
  const [resolveFailed, setResolveFailed] = useState(false);
  const [updatedShown, setUpdatedShown] = useState(false);
  const lastReload = useRef<number | undefined>(undefined);
  // Live [[wikilink]] autocomplete. When the caret sits inside an unclosed
  // "[[ ...", linkQuery is what has been typed since the brackets and linkStart
  // is the index of the "[[", so a pick replaces exactly that span.
  const [linkQuery, setLinkQuery] = useState<string | null>(null);
  const [linkStart, setLinkStart] = useState(0);

  // Recompute the autocomplete context from the editor value and caret.
  const refreshLinkContext = useCallback((value: string, caret: number) => {
    const ctx = wikilinkContext(value, caret);
    if (!ctx) return setLinkQuery(null);
    setLinkStart(ctx.start);
    setLinkQuery(ctx.query);
  }, []);

  const currentProviderId: StorageProviderId =
    (settings.gitosResources as GitosResource[] | undefined)?.find(
      (r) => r.id === VAULT_RESOURCE_ID,
    )?.providerId ?? 'local';
  // The copy lines for a storage on this platform, from the one map.
  const copyOf = (id: StorageProviderId) => {
    const key = copyProviderOf(id);
    return key ? vaultCopy(on, key, copyOpts) : undefined;
  };
  const personalKey = copyProviderOf(currentProviderId) ?? 'local';
  const personalCopy = vaultCopy(on, personalKey, copyOpts);
  const labelOf = (id: StorageProviderId) => PROVIDER_ROSTER.find((r) => r.id === id)?.label ?? id;

  // Probe live readiness when the storage sheet opens, so iCloud shows as
  // usable only on a device that can actually reach it.
  useEffect(() => {
    if (!storageOpen) return;
    if (isDesktop()) void vaultLoadFolder();
    let live = true;
    void Promise.all(PROVIDER_ROSTER.map((p) => probeReady(p.id))).then((flags) => {
      if (!live) return;
      const map: Partial<Record<StorageProviderId, boolean>> = {};
      PROVIDER_ROSTER.forEach((p, i) => (map[p.id] = flags[i]));
      setReady(map);
    });
    void isGdriveConnected()
      .then((connected) => {
        if (live) setDriveConnected(connected);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [storageOpen, vaultLoadFolder]);

  useEffect(() => {
    void vaultRefresh();
    // Leaving the Vault keeps the personal index warm, so a chat's pack finds
    // it (Vault M5, CTO J1); the store closes it on a storage move, a
    // sign-out, or a pairing change. The team vault is never in context, so
    // its index closes here, its last write saved first.
    return () => {
      if (currentVaultIndex()?.target.providerId === 'org') void closeVaultIndex();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The index's progress line, only once a build has run 1.5 s (M3 3.2).
  const indexStatus = useVaultIndexStatus();
  const indexLine = vaultIndexLine(indexStatus);

  // The desktop folder is shared with the agent, routines, and Obsidian, so
  // while this room is open main watches it (CTO F3) and every change it saw,
  // and every return to the window, re-checks the open note. The watcher is a
  // hint; compare-and-swap on the write is the protection.
  const onFolder = !team && currentProviderId === 'files';
  useEffect(() => {
    if (!onFolder) return;
    const off = onDeviceFolderChanged((change) => {
      if (change.rootGone) void vaultLoadFolder();
      void vaultRecheck({ reason: 'watch', paths: change.paths, tree: change.tree });
    });
    return () => {
      off();
      watchDeviceFolder(false);
    };
  }, [onFolder, vaultRecheck, vaultLoadFolder]);
  // The team vault's live refresh (2.7): while a team note is open and the
  // page is visible, the store checks its head every 30 s. Hidden, there is
  // no timer; visible again (or back online), it checks at once.
  useEffect(() => {
    if (!team || !vaultNote?.path) {
      vaultStopPoll();
      return;
    }
    vaultStartPoll();
    const onVisible = () => {
      if (document.visibilityState === 'hidden') vaultStopPoll();
      else vaultStartPoll({ now: true });
    };
    const onOnline = () => vaultStartPoll({ now: true });
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      vaultStopPoll();
    };
  }, [team, vaultNote?.path, vaultStartPoll, vaultStopPoll]);
  // Every return to the window re-checks the open note, on every storage
  // that can see a change under the editor (compare-and-swap; the store
  // decides), and re-lists the tree (Vault M2 2.2).
  useEffect(() => {
    const onFocus = () => void vaultRecheck({ reason: 'focus' });
    const onVisible = () => {
      if (document.visibilityState === 'visible') onFocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [vaultRecheck]);
  useEffect(() => {
    if (onFolder) watchDeviceFolder(true, vaultNote?.path);
  }, [onFolder, vaultNote?.path]);

  // A note the store closed on its own (moved or deleted somewhere else)
  // lands the list in its folder.
  useEffect(() => {
    if (vaultReturnFolder === undefined) return;
    const next = vaultTakeReturnFolder();
    if (next !== undefined) setFolder(next);
  }, [vaultReturnFolder, vaultTakeReturnFolder]);

  // A read-only Drive vault moves off through its Google account, which a
  // sign-out or an expired grant takes away. Ask once it shows, so the card
  // offers the move only while it can work, and a reconnect when it cannot.
  useEffect(() => {
    if (!driveReadOnly) return;
    let live = true;
    void probeDriveLink().then((link) => {
      if (live) setDriveLink(link);
    });
    return () => {
      live = false;
    };
  }, [driveReadOnly]);

  // The lease is held only while the person types (2.5): the editor takes it
  // on a keystroke (vaultLeaseTouch), and leaving the note, the vault, or the
  // room lets it go. Nothing holds it at mount or on a timer, so a note that
  // is only open never syncs a lease file.
  useEffect(() => () => void vaultReleaseLease(), [vaultNote?.path, vaultScope, vaultReleaseLease]);

  const paths = useMemo(() => vaultFiles.map((f) => f.path), [vaultFiles]);

  // Load the draft whenever a note opens. The last note's mentions clear
  // first, so they never show under this one.
  useEffect(() => {
    if (!vaultNote) return;
    setDraft(vaultNote.text);
    setEditing(vaultNote.fresh === true);
    setUpdatedShown(false);
    lastReload.current = vaultNote.reloaded;
    setBacklinks([]);
    setMentionsError(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultNote?.path]);
  // Linked mentions come from the index (M3 3.2): it names the notes that
  // link here, and only those are read (through the body cache) for their
  // excerpts, so opening a note never reads the whole vault. They ask again
  // when a build settles, and a vault with notes it could not read says so
  // rather than looking complete (data-m2).
  const mentionsFor = vaultNote?.path;
  useEffect(() => {
    const index = currentVaultIndex();
    if (!mentionsFor || !index || indexStatus.state === 'building') return;
    let live = true;
    index.linkedMentions(mentionsFor, vaultReadBody).then(
      ({ mentions, failed, more }) => {
        if (!live) return;
        setBacklinks(mentions);
        const missed = failed.filter((p) => p !== mentionsFor).length;
        setMentionsError(
          missed
            ? `${missed} ${missed === 1 ? 'note' : 'notes'} could not be read, so this list may be missing some.`
            : more > 0
              ? `${more} more ${more === 1 ? 'note links' : 'notes link'} here than this list shows.`
              : undefined,
        );
      },
      () => {
        if (live) setMentionsError('Linked mentions could not be read right now.');
      },
    );
    return () => {
      live = false;
    };
  }, [mentionsFor, indexStatus.state, vaultReadBody]);

  // Obsidian saves as you type; so do we, debounced so the sealed store is
  // not hammered per keystroke (lib/vaultAutosave.ts). The pending draft can
  // be flushed (not just cancelled) whenever the screen leaves: unmount, app
  // background, note switch, or scope change. Dropping the timer without
  // flushing is what lost the last keystrokes before the debounce elapsed.
  // The vault the text was typed into is fixed when the save is scheduled,
  // so a scope flip or a sign-out inside the debounce can never send one
  // vault's text to the other (0.7).
  const autosave = useMemo(
    () =>
      vaultAutosave<VaultTargetRef>({
        target: () => vaultTargetRef(),
        save: (path, text, at) => void vaultSave(path, text, at),
      }),
    [vaultSave, vaultTargetRef],
  );
  const scheduleSave = autosave.schedule;
  // An M6 operation flushes this first, and its timer with it (a stale save
  // must never recreate a trashed note).
  useEffect(() => {
    vaultBindAutosave(autosave);
    return () => vaultBindAutosave(undefined);
  }, [autosave, vaultBindAutosave]);

  // The store replaced the open note's text in place (a calm reload of a
  // clean note, or a resolve choice that shows the other version): the editor
  // takes it, keeping the caret (clamped) and the scroll. Editing mode is
  // left alone (CS 1f). A pending save of the old text is dropped: the draft
  // was clean, or the person chose, so nothing is lost.
  useEffect(() => {
    if (!vaultNote || vaultNote.reloaded === undefined) return;
    if (vaultNote.reloaded === lastReload.current) return;
    lastReload.current = vaultNote.reloaded;
    autosave.cancel();
    const el = editorRef.current;
    const caret = el ? { start: el.selectionStart, end: el.selectionEnd, top: el.scrollTop } : null;
    const text = vaultNote.text;
    setDraft(text);
    setUpdatedShown(vaultNote.reloadedFrom === 'elsewhere');
    if (el && caret) {
      requestAnimationFrame(() => {
        el.setSelectionRange?.(
          Math.min(caret.start, text.length),
          Math.min(caret.end, text.length),
        );
        el.scrollTop = caret.top;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultNote?.reloaded]);

  // The resolve sheet rises when the store found a conflict on this note, but
  // never mid-keystroke: while the editor has focus and had input in the last
  // VAULT_RESOLVE_IDLE_MS it waits, then rises. Sheets never stack: the
  // Options sheet leaves first. A deferred conflict ('not now') stays a card.
  const conflictHere =
    vaultConflict && vaultNote && vaultConflict.path === vaultNote.path ? vaultConflict : undefined;
  const conflictWaiting = Boolean(conflictHere && !conflictHere.deferred);
  useEffect(() => {
    if (!conflictWaiting) {
      setResolveOpen(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tryOpen = () => {
      const el = editorRef.current;
      const quiet = Date.now() - lastInputAt.current;
      if (el && document.activeElement === el && quiet < VAULT_RESOLVE_IDLE_MS) {
        timer = setTimeout(tryOpen, VAULT_RESOLVE_IDLE_MS - quiet);
        return;
      }
      const rise = () => {
        setResolveFailed(false);
        setResolveOpen(true);
        hapticApproval();
      };
      if (menuOpen) {
        setMenuOpen(false);
        setConfirmDelete(false);
        timer = setTimeout(rise, sheetExitMs());
        return;
      }
      rise();
    };
    tryOpen();
    return () => {
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflictWaiting, conflictHere?.path, conflictHere?.foundAt]);
  // Leaving the room is not leaving the note: an open choice waits as the
  // card, never the sheet, when the person comes back (CX 1.1).
  const conflictRef = useRef(vaultConflict);
  conflictRef.current = vaultConflict;
  useEffect(
    () => () => {
      if (conflictRef.current && !conflictRef.current.deferred) vaultDeferConflict(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // Close the sheet without choosing: the card stands in for it, the editor
  // stays editable, and focus goes back to the text at its caret.
  const deferResolve = useCallback(() => {
    setResolveOpen(false);
    vaultDeferConflict(true);
    requestAnimationFrame(() => editorRef.current?.focus({ preventScroll: true }));
  }, [vaultDeferConflict]);

  // Write the pending draft now, to the vault it was typed into.
  const flushSave = autosave.flush;
  // Switch vaults only once the pending draft is on its way to its own.
  const switchScope = useCallback(
    (scope: 'personal' | 'team') => {
      flushSave();
      void setVaultScope(scope);
    },
    [flushSave, setVaultScope],
  );
  // If the team vault stops being available while it is open (sign-out), drop
  // back to the personal vault so the screen never shows an empty dead end.
  // A team note kept open after an expiry stays until the person leaves it
  // (the store then goes back to the personal vault itself).
  useEffect(() => {
    if (team && !teamAvailable && !vaultTeamExpired) switchScope('personal');
  }, [team, teamAvailable, vaultTeamExpired, switchScope]);
  // Flush on background (iOS may suspend or jetsam the app) and on unmount.
  // The return to the foreground is the focus re-check above, which also
  // re-lists, so edits synced from another device (or the desktop agent)
  // show up without a manual reopen.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushSave();
    };
    document.addEventListener('visibilitychange', onVisibility);
    let remove: (() => void) | undefined;
    void import('@capacitor/app')
      .then(({ App }) =>
        App.addListener('appStateChange', ({ isActive }) => {
          if (!isActive) flushSave();
        }),
      )
      .then((handle) => {
        remove = () => void handle.remove();
      })
      .catch(() => {
        // Not on a Capacitor host; visibilitychange covers the web/desktop case.
      });
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      remove?.();
      flushSave();
    };
  }, [flushSave]);

  const openNote = (path: string) => {
    // Persist any in-flight edit to the current note before switching away.
    // A choice still open on it is settled by the store (keep both).
    flushSave();
    void vaultOpen(path);
  };

  // One choice in the resolve sheet. The sheet stays up, every row waiting,
  // until the store says it landed; a failure keeps it open and says so.
  const chooseResolve = async (choice: 'both' | 'mine' | 'theirs' | 'discard') => {
    if (!conflictHere || resolveBusy) return;
    hapticCommit();
    // The text this choice acts on is the draft on screen now; a pending
    // save of it would only reach the stash.
    autosave.cancel();
    setResolveBusy(true);
    setResolveFailed(false);
    const result = await vaultResolve(choice, draft).catch(() => ({ ok: false, failed: true }));
    setResolveBusy(false);
    if (result.failed) setResolveFailed(true);
    if (result.ok && choice !== 'discard') {
      requestAnimationFrame(() => editorRef.current?.focus({ preventScroll: true }));
    }
  };

  const createNote = () => {
    // The typed name must make a note on its own, so a name the rule empties
    // ("...") never falls back to the folder's own name.
    const own = normalizeNotePath(newName);
    const path = own && normalizeNotePath(folder ? `${folder}/${newName}` : newName);
    if (!path) {
      // "report.pdf" names a file type, so it can never become a note; say so
      // rather than asking for a name the person already gave.
      const typed = newName.trim();
      const ext = nonNoteExtension(typed);
      showToast(
        ext
          ? `"${typed}" ends in ${ext}, a file type, not a note. Try the name without ${ext}.`
          : 'Give the note a name.',
      );
      return;
    }
    // A name that starts with a dot (".NET migration") loses the dot, since
    // Obsidian and the vault hide dot names and it would never list. v1 has
    // no rename, so the person sees the name before it is made: the field
    // takes the cleaned name, nothing is created, and a second Create goes
    // through.
    if (startsWithDot(newName)) {
      const shown = /\.md$/i.test(newName.trim()) ? own : own.replace(/\.md$/i, '');
      setNewName(shown);
      showToast(
        `Note names cannot start with a dot, since Obsidian and your vault hide them. Tap Create to use "${shown}", or change it.`,
      );
      return;
    }
    setNewOpen(false);
    setNewName('');
    void vaultCreate(path);
  };

  // A tapped link: a note opens, a dashed one is created. An attachment
  // ([[diagram.png]]) is not a note and does not open here yet, so it says so
  // rather than doing nothing.
  const followLink = (p: string, isNew: boolean) => {
    if (nonNoteExtension(p)) {
      const name = p.slice(p.lastIndexOf('/') + 1);
      showToast(`"${name}" is an attachment. Attachments do not open in the Vault yet.`);
      return;
    }
    if (isNew) {
      flushSave();
      // Leaving the note: a choice still open on it keeps both.
      void vaultLeaveConflict();
      void vaultCreate(p);
    } else openNote(p);
  };

  // ---- delete, Undo and Trash (6.3; CTO K6, R2; CX X8 to X10) -------------
  const offerUndo = (
    undo: VaultUndo,
    at: VaultTargetRef | undefined,
    title: string,
    o: { trashed: boolean; folder: boolean; notes: number },
  ) => {
    const id = `${Date.now()}:${undo.path}`;
    undoFor.current.set(id, { undo, ...(at ? { at } : {}) });
    setUndoItem({ id, text: vaultUndoText(o), title, trashed: o.trashed });
  };
  const runUndo = (item: VaultUndoToastItem) => {
    const entry = undoFor.current.get(item.id);
    if (!entry) return;
    void vaultUndoDelete(entry.undo, entry.at).then((r) => {
      if (!r) return;
      if (r.ok) {
        showToast(
          vaultRestoredToast({
            title: item.title,
            folder: noteFolder(r.path),
            renamed: r.renamed,
          }),
        );
        return;
      }
      showToast(
        entry.undo.kind === 'bytes' ? vaultUndoFailed(item.title) : vaultRestoreFailed(item.title),
      );
    });
  };
  const undoDone = useCallback((item: VaultUndoToastItem) => {
    undoFor.current.delete(item.id);
    setUndoItem((now) => (now?.id === item.id ? undefined : now));
  }, []);
  const undoToast = <VaultUndoToast item={undoItem} onUndo={runUndo} onDone={undoDone} />;

  // One note: one tap where Trash is real, else the Options sheet's second
  // tap (R2). The toast shows only once the delete landed (ui-12).
  const deleteNote = (path: string) => {
    const at = vaultTargetRef();
    const title = noteTitle(path);
    setMenuOpen(false);
    setConfirmDelete(false);
    void vaultDeleteNote(path, at).then((r) => {
      if (!r) return;
      if (!r.ok) {
        showToast(vaultTrashFailed(title));
        return;
      }
      if (!r.undo) {
        hapticCommit();
        showToast(VAULT_DELETED);
        return;
      }
      offerUndo(r.undo, at, title, { trashed: r.trashed, folder: false, notes: 1 });
    });
  };

  const openTrash = () => {
    flushSave();
    setTrashError(undefined);
    setTrashOpen(true);
    void vaultLoadTrash().then((entries) => {
      if (!entries) setTrashError(VAULT_TRASH_LIST_FAILED);
    });
  };
  const trashKind: 'folder' | 'local' | 'team' = team
    ? 'team'
    : currentProviderId === 'files' || currentProviderId === 'hub'
      ? 'folder'
      : 'local';

  // Move the personal vault, and say plainly what happened: where it is now,
  // any note that landed beside one already there, and on a refusal whether
  // any copy was left behind. The pending draft goes first, to the vault it
  // was typed into.
  const moveVault = async (id: StorageProviderId, from: 'sheet' | 'card' = 'sheet') => {
    flushSave();
    setMoving(true);
    setOfferFailed(undefined);
    const result = await vaultMoveTo(id).catch(() => undefined);
    // A Drive vault that could not be read may have lost its Google account
    // (a sign-out, an expired grant): then retrying cannot help, and the
    // line says what will.
    if (currentProviderId === 'gdrive' && result?.reason === 'unreadable') {
      const link = await probeDriveLink();
      setDriveLink(link);
      const refusal = vaultDriveMoveRefusal(link);
      if (refusal) {
        setMoving(false);
        setStorageOpen(false);
        showToast(refusal);
        return;
      }
    }
    setMoving(false);
    // The move card keeps a refused move's line inside itself, since a toast
    // would fade, and its button becomes Try again (CX 1.3).
    if (from === 'card' && !result?.ok) {
      setOfferFailed(vaultMoveLine(result, labelOf(id)));
      return;
    }
    setStorageOpen(false);
    closePick();
    const forked = result?.ok ? result.forked : [];
    const line = (withForks: boolean) =>
      vaultMoveLine(
        result && !withForks ? { ...result, forked: [] } : result,
        labelOf(id),
        result?.ok ? copyOf(id)?.obsidian : undefined,
      );
    if (!forked.length) {
      showToast(line(true));
      return;
    }
    // Forked pairs open the move-mode sheet once the storage sheet has left,
    // so sheets never stack. The toast leaves the forked sentence to the
    // sheet only when the sheet actually opened (Creative Studio 1d, M1-2).
    setTimeout(
      () => void openForks(forked).then((opened) => showToast(line(!opened))),
      from === 'sheet' ? sheetExitMs() : 0,
    );
  };

  // Bring the previous folder's notes into this one (the CTO's ruling): the
  // result reads like a move's, and forked pairs open the same move-mode
  // sheet, both files in the current folder.
  const bringNotes = async (prevDisplay: string) => {
    if (bringing) return;
    flushSave();
    hapticCommit();
    setBringing(true);
    const result = await vaultBringPrevious().catch(() => undefined);
    setBringing(false);
    // A Bring that went through is offered no more this session.
    if (result?.ok) setBrought(pick?.info.dir);
    const forked = result && result.reason !== 'same' ? result.forked : [];
    if (!forked.length) {
      showToast(vaultBringLine(result, prevDisplay));
      return;
    }
    setStorageOpen(false);
    setTimeout(
      () =>
        void openForks(forked).then((opened) =>
          showToast(vaultBringLine(opened ? { ...result!, forked: [] } : result, prevDisplay)),
        ),
      sheetExitMs(),
    );
  };

  // ---- a move's forked pairs (Creative Studio 1d) -------------------------
  // One sheet steps through them. Keep both simply advances (both files are
  // there); the other two rows take two taps. After the last pair it closes.
  const loadFork = async (steps: ForkSteps, i: number): Promise<ForkSteps | undefined> => {
    for (let at = i; at < steps.pairs.length; at++) {
      const shown = await vaultReadForkPair(steps.pairs[at]!);
      // A pair whose files are not both there any more has nothing to choose.
      if (shown) return { ...steps, i: at, shown, failed: false, partial: false, again: false };
    }
    return undefined;
  };
  // True only when the sheet opened: a pair that cannot be read (both files
  // not there any more) leaves the toast to name the forks.
  const openForks = async (pairs: Array<{ from: string; to: string }>): Promise<boolean> => {
    const first = await loadFork({ pairs, i: 0, busy: false }, 0);
    if (!first) return false;
    setForks(first);
    setForksOpen(true);
    hapticApproval();
    return true;
  };
  const closeForks = () => {
    setForksOpen(false);
    setTimeout(() => setForks(undefined), sheetExitMs());
  };
  const nextFork = async (steps: ForkSteps) => {
    const next = await loadFork(steps, steps.i + 1);
    if (next) setForks(next);
    else closeForks();
  };
  const chooseFork = async (choice: 'both' | 'mine' | 'theirs' | 'discard') => {
    if (!forks?.shown || forks.busy) return;
    hapticCommit();
    if (choice === 'both' || choice === 'discard') {
      await nextFork(forks);
      return;
    }
    const pair = forks.pairs[forks.i]!;
    setForks({ ...forks, busy: true, failed: false });
    const r = await vaultSettleFork(pair, choice, forks.shown).catch(() => ({ ok: false }));
    if (r.ok && !('partial' in r && r.partial)) {
      await nextFork({ ...forks, busy: false });
      return;
    }
    if ('changed' in r && r.changed) {
      // Something wrote to one of them meanwhile: show them as they are now.
      const fresh = await loadFork({ ...forks, busy: false }, forks.i);
      if (fresh && fresh.i === forks.i) setForks({ ...fresh, again: true });
      else if (fresh) setForks(fresh);
      else closeForks();
      return;
    }
    setForks({ ...forks, busy: false, failed: !r.ok, partial: r.ok });
  };

  // ---- the folder picker (1.4) --------------------------------------------
  // Every action is a no-argument IPC in main; the renderer never sends a
  // path. A pick repoints at once; the sheet then shows what it found.
  const closePick = () => {
    setPick(undefined);
    setPickAnswered(false);
    setPickLine(undefined);
  };
  const showPick = (result: VaultPickResult | undefined, from: 'sheet' | 'card') => {
    if (!result || 'cancelled' in result) return;
    if (result.ok) {
      setPick(result);
      setPickAnswered(false);
      setPickLine(undefined);
      // From the card, the storage sheet opens on the pick's result (CX 1.3).
      if (from === 'card') setStorageOpen(true);
      return;
    }
    if ('same' in result) {
      setPickLine({ text: VAULT_SAME_FOLDER_LINE, warn: false });
      if (from === 'card') setStorageOpen(true);
      return;
    }
    const os = vaultFolder?.os ?? '';
    const text = vaultPickRefusal(result.refused, os);
    if (from === 'card') {
      showToast(text);
      return;
    }
    setPickLine({ text, warn: true, privacy: result.refused === 'denied' && os === 'darwin' });
  };
  const runPick = async (from: 'sheet' | 'card') => {
    if (picking) return;
    setPickLine(undefined);
    setPicking(true);
    const result = await vaultChooseFolder().catch(() => undefined);
    setPicking(false);
    showPick(result, from);
  };
  const refinePick = async (choice: VaultRefineChoice | { to: 'stay' }) => {
    hapticCommit();
    if (choice.to === 'stay') {
      setPickAnswered(true);
      return;
    }
    const back = choice.to === 'previous' ? pickCopy?.back : undefined;
    const result = await vaultRefineFolder(choice).catch(() => undefined);
    if (result?.ok) {
      setPick(result);
      setPickAnswered(true);
      setPickLine(undefined);
      if (back) showToast(back.toast);
      if (choice.to === 'previous') closePick();
      return;
    }
    showPick(result, 'sheet');
  };
  const pickCopy = pick
    ? vaultPickResultCopy({
        display: pick.info.display,
        ...(pick.previous ? { previous: pick.previous } : {}),
        ...(currentProviderId === 'local' ? { fromLocal: { notes: vaultFiles.length } } : {}),
        large: pick.survey.capped || pick.survey.notes > VAULT_LARGE_NOTES,
      })
    : undefined;

  // Where a read-only Drive vault goes in one tap: plain files on the
  // computer, or this device on the phone.
  const driveExit: StorageProviderId = isDesktop() ? 'files' : 'local';
  // Reconnect the Google account a Drive vault needs, then move it off. Drive
  // stays held back: this only restores the read the move needs.
  const reconnectDriveAndMove = async (fromNote: boolean) => {
    setMoving(true);
    const connected = await connectGdriveAccount().catch(() => ({ ok: false }));
    setMoving(false);
    if (!connected.ok) {
      showToast(DRIVE_RECONNECT_FAILED_LINE);
      return;
    }
    setDriveLink('connected');
    if (fromNote) vaultCloseNote();
    await moveVault(driveExit);
  };

  // A one-tap starter, the way a fresh Obsidian vault opens on a welcome note
  // rather than a blank void: seed a real, readable note that teaches the core
  // moves (markdown, where it lives, a live wikilink), in the map's words.
  const addStarterNote = async () => {
    await vaultCreate('Welcome to your Vault', vaultWelcomeNote());
    showToast('Welcome note added.');
  };

  // Export on the iPhone: every note it could read, written against the
  // manifest, and "N of M" when some could not be read (0.11).
  const exportNotes = async () => {
    setStorageOpen(false);
    try {
      const notes = await vaultReadAll();
      if (!notes.length && !notes.failed.length) {
        showToast('Nothing to export yet. Write a note first.');
        return;
      }
      const result = await exportVaultToFiles(notes, notes.failed);
      showToast(result ? vaultExportLine(result) : 'Export works in OpenShore on the iPhone.');
    } catch {
      showToast('Could not export your vault. Check device storage and try again.');
    }
  };

  // Export the team vault to its own folder (2.8): Files on the iPhone, a
  // folder beside the vault on the computer that Obsidian opens. Never the
  // personal export.
  const [exportingTeam, setExportingTeam] = useState(false);
  const teamOrg = settings.account?.org;
  const exportTeam = async () => {
    if (exportingTeam || !teamOrg?.serverId) return;
    setExportingTeam(true);
    try {
      const notes = await vaultReadAll();
      if (!notes.length && !notes.failed.length) {
        showToast('Nothing to export yet. Write a note first.');
        return;
      }
      const result = await exportTeamVaultToFiles(notes, notes.failed, {
        id: teamOrg.serverId,
        name: teamOrg.name,
      });
      showToast(
        result
          ? vaultExportLine(result, { where: result.where, folder: result.folder })
          : 'The team vault exports in OpenShore on the iPhone and on your computer.',
      );
    } catch {
      showToast('Could not export the team vault. Check storage on this device and try again.');
    } finally {
      setExportingTeam(false);
    }
  };

  // Held text for the open note, shown on it as well as in the room. The
  // target is compared by storage, resource, and path, never by account:
  // heldVisible already holds only this account's team text.
  const here = vaultNote ? vaultTargetRef() : undefined;
  const heldHere =
    here && vaultNote
      ? heldVisible.filter(
          (h) =>
            h.providerId === here.providerId &&
            h.resourceId === here.resourceId &&
            h.path === vaultNote.path,
        )
      : [];

  // The standing error, beside the toast that announced it, so it is still
  // there after the toast fades (0.4). The held line says where the list is
  // when it is not on screen, and tells the truth about text this device
  // keeps only until the app closes.
  const errorLine = (where: 'tree' | 'note'): string | undefined => {
    if (vaultError === 'save') {
      return 'Your vault storage did not take the last change. Any unsaved text is kept on this device and saves when the storage answers.';
    }
    if (vaultError === 'held') {
      const shownHere = where === 'tree' || heldVisible.every((h) => heldHere.includes(h));
      return vaultHeldLine(heldVisible, shownHere);
    }
    if (vaultError === 'load' && where === 'tree' && vaultFiles.length > 0) {
      return 'Your vault storage did not answer, so these are the notes last loaded.';
    }
    return undefined;
  };
  const renderError = (where: 'tree' | 'note') => {
    const line = errorLine(where);
    if (!line) return null;
    return (
      <p className="hint" role="status" style={{ marginTop: 8, color: 'var(--warn)' }}>
        {line}
        {vaultError !== 'held' ? (
          <>
            {' '}
            <button className="linklike" onClick={() => void vaultRefresh()}>
              Try again
            </button>
          </>
        ) : null}
      </p>
    );
  };

  // The read-only Drive card: the store's reason, and the one-tap way off,
  // which reconnects the Google account first when this device has lost it.
  // A build that cannot connect to Google at all gets a button that opens
  // Google Drive instead, where the notes still are.
  const driveCard = vaultDriveCard(driveLink, labelOf(driveExit));
  const onDriveAction = (fromNote: boolean) => {
    const action = driveCard.action;
    if (!action) return;
    if (action.kind === 'open') {
      openExternal(DRIVE_WEB_URL);
      return;
    }
    if (action.kind === 'reconnect') {
      void reconnectDriveAndMove(fromNote);
      return;
    }
    if (fromNote) vaultCloseNote();
    void moveVault(driveExit);
  };
  const renderDriveCard = (fromNote: boolean) => (
    <DriveCard
      // With no move possible, the store's "Move this vault to keep editing"
      // would sit above a card with no move, so only the card's line shows.
      reason={driveLink === 'unconfigured' ? undefined : driveReadOnly}
      shown={Boolean(driveReadOnly)}
      line={driveCard.line}
      action={driveCard.action?.label}
      busy={moving}
      fromNote={fromNote}
      onAction={() => onDriveAction(fromNote)}
    />
  );
  // Signed out of Google, or a build that cannot reach it: the list fails
  // for want of the account, so the Drive card alone says why. The offline
  // card's Try again could never work here, and the ramp is not this state.
  const driveExplains =
    Boolean(driveReadOnly) && (driveLink === 'disconnected' || driveLink === 'unconfigured');

  const entries = treeAt(folder, vaultFiles);
  const crumbs = folder ? folder.split('/') : [];

  // ---- note view ----------------------------------------------------------
  if (vaultNote) {
    const title = noteTitle(vaultNote.path);
    const parent = noteFolder(vaultNote.path);
    const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;
    // Who last saved this team note (2.7): nobody for the person's own save.
    const editedLine = team
      ? vaultEditedByLine(vaultNote.editedBy, vaultNote.updatedAt, uid)
      : undefined;

    const insertWikilink = (targetName: string) => {
      const el = editorRef.current;
      const caret = el?.selectionStart ?? draft.length;
      const before = draft.slice(0, linkStart);
      const after = draft.slice(caret);
      const inserted = `[[${targetName}]]`;
      const next = before + inserted + after;
      setDraft(next);
      vaultNoteDraft(vaultNote.path, next);
      void vaultLeaseTouch();
      lastInputAt.current = Date.now();
      setUpdatedShown(false);
      scheduleSave(vaultNote.path, next);
      setLinkQuery(null);
      const pos = before.length + inserted.length;
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(pos, pos);
      });
    };

    // The way back to the tree, in the top bar (the iOS grammar) and as the
    // "All notes" crumb beneath it; both save first.
    const backToNotes = () => {
      flushSave();
      setFolder(parent);
      vaultCloseNote();
    };
    // Where the text on screen stands (2.2): kept on this device while any
    // note of this vault waits to be saved, Saving while typed text waits for
    // the debounce or a save is on its way, else Saved. Left out while the
    // note takes no writes, and while a choice is open (its card says it).
    const pendingHere = vaultPendingCount(vaultPending ?? [], here, {
      conflictPath: conflictHere?.path,
      uid,
    });
    const saveStatus: VaultSaveStatus =
      pendingHere > 0 || vaultError === 'save'
        ? 'offline'
        : vaultSaving || autosave.isPending()
          ? 'saving'
          : 'saved';
    return (
      <div className="screen">
        <BackBar title={title} back={{ to: 'Vault', onBack: backToNotes }} />
        <div className="screen-inner vault-note">
          <div className="vault-note-bar">
            <button className="linklike" onClick={backToNotes}>
              All notes
            </button>
            <div style={{ flex: 1 }} />
            {!locked && !conflictHere ? (
              <SaveChip
                status={saveStatus}
                pending={pendingHere}
                onRetry={() => void vaultRefresh()}
              />
            ) : null}
            {/* A read-only note leaves out the controls that write, instead of
                dimming them: the card (or the lease line) says why. */}
            {!locked ? (
              <button
                className="icon-btn"
                aria-label={editing ? 'Read' : 'Edit'}
                aria-pressed={editing}
                onClick={() => setEditing((e) => !e)}
              >
                {editing ? (
                  <Icon size={19}>
                    <path d="M3 5a2 2 0 0 1 2-2h4a3 3 0 0 1 3 3v14a2.5 2.5 0 0 0-2.5-2.5H3V5Z" />
                    <path d="M21 5a2 2 0 0 0-2-2h-4a3 3 0 0 0-3 3v14a2.5 2.5 0 0 1 2.5-2.5H21V5Z" />
                  </Icon>
                ) : (
                  <Icon size={19}>
                    <path d="M17 3.5 20.5 7 8.5 19l-4.5 1 1-4.5L17 3.5Z" />
                  </Icon>
                )}
              </button>
            ) : null}
            {/* Its sheet holds nothing but Delete, which a Drive vault refuses,
                and it is left out while a choice about this note is open. */}
            {!driveReadOnly && !conflictHere && !readOnly && !teamExpired ? (
              <button className="icon-btn" aria-label="Options" onClick={() => setMenuOpen(true)}>
                {'⋯'}
              </button>
            ) : null}
          </div>

          <h1 className="vault-title">{title}</h1>
          <p className="hint" style={{ marginTop: 2 }}>
            {(parent || 'Vault') + ' · ' + words + (words === 1 ? ' word' : ' words')}
            {updatedShown ? <span className="vault-updated">{VAULT_UPDATED_SUFFIX}</span> : null}
            {editedLine ? (
              <span key={vaultNote.version ?? vaultNote.updatedAt} className="vault-updated">
                {editedLine}
              </span>
            ) : null}
          </p>

          {renderLeaseLine()}
          {alsoOpen && !readOnly ? (
            <p className="hint vault-also-open" role="status" style={{ marginTop: 2 }}>
              {alsoOpen}
            </p>
          ) : null}
          {vaultMoving ? (
            <p className="hint" role="status" style={{ marginTop: 8 }}>
              {vaultMovingLine(vaultFolder?.display ?? labelOf('files'))}
            </p>
          ) : null}
          {teamExpired ? (
            <p className="hint" role="status" style={{ marginTop: 8, color: 'var(--warn)' }}>
              {VAULT_TEAM_SIGN_IN_LINE}
            </p>
          ) : null}
          {renderDriveCard(true)}
          {renderError('note')}
          <ConflictCard
            shown={Boolean(conflictHere?.deferred)}
            mode={conflictHere?.kind === 'missing' ? 'missing' : 'edit'}
            onChoose={() => vaultDeferConflict(false)}
          />
          <NotSaved held={heldHere} discard={(id) => void vaultDiscardHeld(id)} />

          {editing && !locked ? (
            <div className="vault-editor-wrap">
              <textarea
                ref={editorRef}
                className="vault-editor"
                autoFocus
                value={draft}
                placeholder="Write. Plain markdown, and [[wikilinks]] to connect notes."
                onChange={(e) => {
                  setDraft(e.target.value);
                  vaultNoteDraft(vaultNote.path, e.target.value);
                  void vaultLeaseTouch();
                  lastInputAt.current = Date.now();
                  setUpdatedShown(false);
                  scheduleSave(vaultNote.path, e.target.value);
                  refreshLinkContext(
                    e.target.value,
                    e.target.selectionStart ?? e.target.value.length,
                  );
                }}
                onKeyUp={(e) =>
                  refreshLinkContext(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)
                }
                onSelect={(e) =>
                  refreshLinkContext(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)
                }
                onBlur={() => setLinkQuery(null)}
              />
              <VaultLinkSuggest
                paths={paths}
                sourcePath={vaultNote.path}
                query={linkQuery}
                onPick={insertWikilink}
              />
            </div>
          ) : (
            // A calm reload settles the page in (opacity only); re-keyed so
            // each reload plays it once.
            <div
              key={vaultNote.reloaded ?? 0}
              className={
                vaultNote.reloaded && vaultNote.reloadedFrom === 'elsewhere'
                  ? 'vault-reloaded'
                  : undefined
              }
            >
              <VaultMarkdown
                text={draft}
                paths={paths}
                sourcePath={vaultNote.path}
                onOpenNote={followLink}
              />
            </div>
          )}

          {!editing ? (
            <VaultBacklinks mentions={backlinks} error={mentionsError} onOpen={openNote} />
          ) : null}
        </div>

        <VaultResolveSheet
          open={resolveOpen && Boolean(conflictHere)}
          mode={conflictHere?.kind === 'missing' ? 'missing' : 'edit'}
          title={title}
          mine={draft}
          theirs={conflictHere?.theirs}
          loadedAt={vaultNote.loadedAt}
          again={conflictHere?.again}
          busy={resolveBusy}
          failed={resolveFailed}
          onChoose={(choice) => void chooseResolve(choice)}
          onClose={deferResolve}
        />

        <VaultNoteOptions
          open={menuOpen}
          title={title}
          trashReal={caps.trash}
          confirmDelete={confirmDelete}
          canAsk={!team}
          canPin={Boolean(!team && pinProjectId && canEditProjectPins(pinProjectId))}
          deleteDisabled={Boolean(driveReadOnly) || hubAway}
          onClose={() => {
            setMenuOpen(false);
            setConfirmDelete(false);
          }}
          onAsk={() => {
            const path = vaultNote.path;
            setMenuOpen(false);
            setConfirmDelete(false);
            void askAboutVaultNote(path);
          }}
          onPin={() => {
            if (!pinProjectId) return;
            const path = vaultNote.path;
            setMenuOpen(false);
            setConfirmDelete(false);
            void pinVaultNoteToProject(path, pinProjectId).then((r) =>
              showToast(pinToast(r, pinProjectName)),
            );
          }}
          onArmDelete={() => setConfirmDelete(true)}
          // The store flushes the pending save and cancels its timer first,
          // so a stale save can never recreate the note; only a delete that
          // landed says so (orgvault-m1).
          onDelete={() => deleteNote(vaultNote.path)}
        />
        {undoToast}
      </div>
    );
  }

  // ---- Trash (6.3, CX X10): a page inside the room -------------------------
  if (trashOpen) {
    return (
      <>
        <VaultTrashView
          kind={trashKind}
          entries={vaultTrash}
          error={trashError}
          onBack={() => setTrashOpen(false)}
          onRestore={async (entry) => {
            const title =
              entry.kind === 'folder'
                ? (entry.path.split('/').pop() ?? entry.path)
                : noteTitle(entry.path);
            const r = await vaultRestoreTrash(entry.id);
            showToast(
              r.ok
                ? vaultRestoredToast({
                    title,
                    folder: noteFolder(r.path),
                    renamed: r.renamed,
                    sayFolder: true,
                  })
                : vaultRestoreFailed(title),
            );
          }}
          onEmpty={async () => {
            const r = await vaultEmptyTrash();
            if (!r.ok) {
              showToast(VAULT_TRASH_EMPTY_FAILED);
              return;
            }
            hapticCommit();
            showToast(vaultTrashEmptied(r.removed, r.asked));
          }}
        />
        {undoToast}
      </>
    );
  }

  // ---- tree view ----------------------------------------------------------
  // The one-time desktop move card (1.3): at the root only, after Not saved
  // and before Coding projects. While it shows, the lead leaves out its own
  // pointer to This folder, since the card says it better.
  const offerShown = !team && vaultFolderOfferShown();
  const offer = vaultFolderOffer(vaultFiles.length, vaultFolder?.count, {
    display: vaultFolder?.display,
    newSince: folderNotesSince(settings.vaultMoveOffer, vaultFolder?.count),
  });
  const missingCard = vaultMissingFolderCard(vaultFolder?.display ?? labelOf('files'));
  const pickerRow = vaultPickerRow(on);
  const closeStorage = () => {
    setStorageOpen(false);
    closePick();
  };
  return (
    <div className="screen">
      <BackBar title="Vault" />
      <div className="screen-inner">
        <div className="stack-head">
          <h1>Vault</h1>
          {/* A read-only Drive vault leaves New note out; its card says why.
              So does a moving vault, and a folder that is not there. */}
          {!driveReadOnly && !vaultMoving && !folderGone && !readOnly && !hubAway ? (
            <button
              type="button"
              className="icon-btn press-fb"
              aria-label="New note"
              title="New note"
              onClick={() => setNewOpen(true)}
            >
              <Icon size={20}>
                <path d="M12 5v14M5 12h14" />
              </Icon>
            </button>
          ) : null}
        </div>
        {teamAvailable ? (
          <div
            className="segmented"
            role="tablist"
            aria-label="Which vault"
            style={{ marginBottom: 10 }}
          >
            <button
              role="tab"
              aria-selected={!team}
              className={`seg${!team ? ' active' : ''}`}
              onClick={() => switchScope('personal')}
            >
              Personal
            </button>
            <button
              role="tab"
              aria-selected={team}
              className={`seg${team ? ' active' : ''}`}
              onClick={() => switchScope('team')}
            >
              Team
            </button>
          </div>
        ) : null}
        <p className="lead">
          {team ? vaultCopy(on, 'org').storage : vaultLead(personalCopy, { offerShown })}
          {team && vaultTeamExportable(on) && vaultFiles.length > 0 ? (
            <>
              {' '}
              <button
                type="button"
                className="linklike press-fb"
                disabled={exportingTeam}
                onClick={() => void exportTeam()}
              >
                {exportingTeam ? 'Exporting…' : 'Export as plain files'}
              </button>
            </>
          ) : null}
          {!team ? (
            <>
              {' '}
              <button className="linklike" onClick={() => setStorageOpen(true)}>
                Where it lives
              </button>
            </>
          ) : null}
        </p>

        {renderError('tree')}
        {renderLeaseLine()}
        {/* At every folder level, like Not saved, so wherever a control is
            left out the reason is on screen. */}
        {renderDriveCard(false)}
        {/* Every vault's held text this account may see, near the top of the
            list at every folder level, so nothing typed is ever out of sight
            (0.4). */}
        <NotSaved
          held={heldVisible}
          labelled
          folderNow={vaultFolder?.dir}
          discard={(id) => void vaultDiscardHeld(id)}
        />
        <VaultMoveCard
          shown={offerShown && !folder}
          offer={offer}
          display={vaultFolder?.display}
          busy={moving || Boolean(vaultMoving)}
          failed={offerFailed}
          onMove={() => void moveVault('files', 'card')}
          onDecline={() => void vaultDeclineFolderMove()}
          onOtherFolder={() => void runPick('card')}
        />
        {hubAway ? (
          <p className="hint" role="status" style={{ margin: '0 0 10px', color: 'var(--warn)' }}>
            {HUB_AWAY_LINE}
          </p>
        ) : null}
        <HubMoveCard
          shown={hubOfferShown && !folder}
          count={vaultFiles.length}
          busy={hubMoving || Boolean(vaultMoving)}
          failed={hubFailed}
          onMove={() => {
            hapticCommit();
            setHubMoving(true);
            setHubFailed(false);
            void vaultAcceptHubMove()
              .then((r) => {
                setHubFailed(!r.ok);
                if (r.ok) showToast('Your notes are on your computer now.');
              })
              .finally(() => setHubMoving(false));
          }}
          onDecline={() => void vaultDeclineHubMove()}
        />
        <VaultMissingCard
          shown={Boolean(folderGone)}
          title={missingCard.title}
          line={missingCard.line}
          retry={missingCard.retry}
          choose={missingCard.choose}
          onRetry={() => {
            void vaultLoadFolder().then(() => vaultRefresh());
          }}
          onChoose={() => void runPick('card')}
        />

        {!team && !folder ? (
          <VaultAgentRecent
            load={vaultAgentRecent}
            onOpen={(path) => void vaultOpen(path)}
            refreshKey={vaultFiles.length}
          />
        ) : null}

        {!team && !folder && (settings.projects?.length ?? 0) > 0 ? (
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-row">
              <h3 style={{ marginBottom: 0 }}>Coding projects</h3>
            </div>
            <p className="hint" style={{ marginTop: 0 }}>
              What it has learned: the notes the agent keeps in each project's repository. Read-only
              here.
            </p>
            {repoSyncConflicts && repoSyncConflicts.length > 0 ? (
              <p className="hint" style={{ marginTop: 0, color: 'var(--warn)' }}>
                {repoSyncConflicts.length === 1
                  ? '1 repository needs a manual merge before it can sync. Your work is safe on this device.'
                  : `${repoSyncConflicts.length} repositories need a manual merge before they can sync. Your work is safe on this device.`}
              </p>
            ) : null}
            <div className="vault-tree">
              {settings.projects!.map((p) => (
                <button
                  key={p.id}
                  className="conv-item vault-row press-fb press-fb--row"
                  onClick={() => openProjectMemory(p.id)}
                >
                  <span className="vault-row-chevron" aria-hidden="true" />
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* The Agentic Current's folder: what it remembers and the skills it
            wrote, read from its home on the paired computer. Rendered only
            through the contribution; with none on, the Vault is as it was. */}
        {!team && !folder && current && !slotNone(current.vault) ? (
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-row">
              <h3 style={{ marginBottom: 0 }}>{current.vault.title}</h3>
            </div>
            <p className="hint" style={{ marginTop: 0 }}>
              {current.vault.sub} Read-only here.
            </p>
            {currentNotes === undefined ? (
              <p className="hint" style={{ marginTop: 0 }}>
                {settings.daemon || isDesktop()
                  ? 'Reading its home folder.'
                  : 'Pair the computer that runs it to read its memory here.'}
              </p>
            ) : currentNotes === 'silent' ? (
              <>
                <p className="hint" style={{ marginTop: 0 }}>
                  Your computer did not answer, so its home folder could not be read.
                </p>
                <button className="btn ghost press-fb" onClick={() => setNotesAsk((n) => n + 1)}>
                  Try again
                </button>
              </>
            ) : currentNotes.notes.length === 0 ? (
              <p className="hint" style={{ marginTop: 0 }}>
                Nothing to read yet. Its home folder ({currentNotes.home}) has no memory or skills
                on the paired computer.
              </p>
            ) : (
              <div className="vault-tree">
                {currentNotes.notes.map((n) => (
                  <button
                    key={n.path}
                    className="conv-item vault-row press-fb press-fb--row"
                    onClick={() => void openCurrentNote(n.path)}
                  >
                    <span className="vault-row-chevron" aria-hidden="true" />
                    {n.title}
                    <span className="sub vault-topsheet">
                      {n.path.startsWith('skills/') ? 'skill' : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {crumbs.length ? (
          <p className="hint vault-crumbs">
            <button className="linklike" onClick={() => setFolder('')}>
              Vault
            </button>
            {crumbs.map((c, i) => (
              <span key={i}>
                {' / '}
                <button
                  className="linklike"
                  onClick={() => setFolder(crumbs.slice(0, i + 1).join('/'))}
                >
                  {c}
                </button>
              </span>
            ))}
          </p>
        ) : null}

        {vaultFiles.length === 0 && (driveExplains || folderGone) ? null : vaultFiles.length ===
            0 && !vaultListed ? (
          // A vault still listing, never the empty ramp over notes that are
          // on their way (CX 1.4).
          <p className="hint" role="status">
            {VAULT_OPENING_LINE}
          </p>
        ) : vaultFiles.length === 0 && vaultError === 'load' ? (
          <div className="card empty-notice">
            <h3>Your vault storage is offline.</h3>
            <p className="sub">
              Your notes are safe where they live. This device could not reach the storage to load
              them. Check your connection and try again.
            </p>
            <button className="btn primary" onClick={() => void vaultRefresh()}>
              Try again
            </button>
          </div>
        ) : vaultFiles.length === 0 && team ? (
          <div className="card empty-notice">
            <h3>Your team vault is empty.</h3>
            <p className="sub">The first note you write is shared with your organization.</p>
            <button className="btn primary" onClick={() => setNewOpen(true)}>
              New note
            </button>
          </div>
        ) : vaultFiles.length === 0 ? (
          // New user, personal vault: an onboarding ramp, not a blank void. It
          // teaches what the vault is, where it lives, and where the agent
          // fits (in the map's words, true for this platform and storage),
          // then gives two ways in (write your own, or seed a welcome note the
          // way a fresh Obsidian vault opens on one).
          <VaultRamp
            onboard={vaultOnboard(on, personalKey, copyOpts)}
            readOnly={Boolean(driveReadOnly)}
            onWrite={() => setNewOpen(true)}
            onWelcome={() => void addStarterNote()}
          />
        ) : (
          <div className="vault-tree">
            {indexLine ? (
              <p className="hint" role="status" style={{ margin: '0 0 8px' }}>
                {indexLine}
              </p>
            ) : null}
            {entries.map((e) =>
              e.kind === 'folder' ? (
                <button
                  key={e.path}
                  className="conv-item vault-row press-fb press-fb--row"
                  onClick={() => setFolder(e.path)}
                >
                  <span className="vault-row-chevron" aria-hidden="true" />
                  {e.name}
                </button>
              ) : (
                <button
                  key={e.path}
                  className="conv-item vault-row press-fb press-fb--row"
                  onClick={() => openNote(e.path)}
                >
                  {e.name}
                  {isConflictCopy(e.path) ? (
                    <span className="pill vault-conflict-badge">
                      {VAULT_CONFLICT_BADGE}
                      <span className="visually-hidden">. {VAULT_CONFLICT_BADGE_LABEL}</span>
                    </span>
                  ) : null}
                </button>
              ),
            )}
            {/* Trash is the last row at the root, only while it holds
                something (CX X10). */}
            {!folder && caps.trash ? (
              <VaultTrashRow count={vaultTrash?.length ?? 0} onOpen={openTrash} />
            ) : null}
          </div>
        )}
      </div>

      {/* A move's forked pairs (Creative Studio 1d). Closing keeps both. */}
      <VaultResolveSheet
        open={forksOpen && Boolean(forks?.shown)}
        mode="move"
        title={forks ? noteTitle(forks.pairs[forks.i]!.from) : ''}
        mine={forks?.shown?.moved.text ?? ''}
        theirs={forks?.shown?.there}
        again={forks?.again}
        busy={Boolean(forks?.busy)}
        failed={Boolean(forks?.failed)}
        move={
          forks
            ? {
                i: forks.i + 1,
                n: forks.pairs.length,
                copyTitle: noteTitle(forks.pairs[forks.i]!.to),
                partial: forks.partial,
              }
            : undefined
        }
        onChoose={(choice) => void chooseFork(choice)}
        onClose={closeForks}
      />
      {undoToast}

      <Sheet open={Boolean(newOpen)} onClose={() => setNewOpen(false)}>
        {newOpen ? (
          <>
            <h2>New note</h2>
            <p className="sheet-sub">
              {folder ? `In ${folder}. ` : ''}A slash makes folders: ideas/first note.
            </p>
            <div className="field">
              <input
                autoFocus
                placeholder="Note name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createNote()}
              />
            </div>
            <div className="sheet-actions">
              <button className="btn primary" onClick={createNote}>
                Create
              </button>
              <button className="btn quiet" onClick={() => setNewOpen(false)}>
                Cancel
              </button>
            </div>
          </>
        ) : null}
      </Sheet>

      {/* One of the current's notes, read only, in the vault's own paper. */}
      <Sheet open={Boolean(currentNote)} onClose={() => setCurrentNote(undefined)}>
        {currentNote ? (
          <>
            <SheetHead title={currentNote.title} onClose={() => setCurrentNote(undefined)} />
            <p className="hint" style={{ marginTop: 0 }}>
              {currentNote.path} · Read-only. Edit it where it lives.
            </p>
            <VaultMarkdown text={currentNote.text} paths={[]} onOpenNote={() => {}} />
          </>
        ) : null}
      </Sheet>

      <Sheet open={Boolean(storageOpen)} onClose={closeStorage}>
        {storageOpen ? (
          <>
            <SheetHead title="Where your vault lives" onClose={closeStorage} />
            <p className="sheet-sub">
              You choose the storage that holds your notes. A move copies every note across first,
              and leaves the old copy where it was.
            </p>
            <div className="sheet-actions">
              {PROVIDER_ROSTER.filter((p) => !p.arriving && vaultOffersProvider(on, p.id)).map(
                (p) => {
                  const isCurrent = p.id === currentProviderId;
                  const isReady = ready[p.id] ?? p.ready;
                  const move = async () => {
                    if (isCurrent) return;
                    // Not usable here, so the pill names the state and this
                    // toast gives the step. (Google Drive is held back:
                    // Arriving. iCloud is off on this iPhone: Turned off.)
                    if (!isReady) {
                      showToast(
                        p.pending ??
                          `${p.label} vaults are coming. Your vault can move there later.`,
                      );
                      return;
                    }
                    await moveVault(p.id);
                  };
                  const disconnect = async () => {
                    setMoving(true);
                    await disconnectGdriveAccount();
                    setMoving(false);
                    setDriveConnected(false);
                    showToast('Disconnected Google Drive.');
                  };
                  const line = copyOf(p.id);
                  // On the desktop, This folder shows where it is (1.4).
                  const folderRow = p.id === 'files' && on === 'electron' ? vaultFolder : undefined;
                  const notFound = folderRow?.exists === false;
                  return (
                    <div key={p.id} className="vault-provider-row">
                      <button
                        className="btn ghost vault-provider press-fb"
                        disabled={moving}
                        onClick={() => void move()}
                      >
                        <span className="grow" style={{ textAlign: 'left' }}>
                          {p.label}
                          {line ? (
                            <span className="sub" style={{ display: 'block', fontWeight: 400 }}>
                              {vaultSheetLine(line)}
                            </span>
                          ) : null}
                        </span>
                        {notFound ? (
                          <span className="nav-lock-pill">{VAULT_NOT_FOUND_PILL}</span>
                        ) : isCurrent ? (
                          <span className="pill local">Here now</span>
                        ) : isReady ? (
                          <span className="pill local">Move here</span>
                        ) : (
                          <span className="nav-lock-pill">{p.offPill ?? 'Arriving'}</span>
                        )}
                      </button>
                      {folderRow ? <FolderBlock info={folderRow} /> : null}
                      {p.id === 'gdrive' && driveConnected && !isCurrent ? (
                        <button
                          className="btn ghost vault-provider-disconnect"
                          disabled={moving}
                          onClick={() => void disconnect()}
                        >
                          Disconnect Google Drive
                        </button>
                      ) : null}
                    </div>
                  );
                },
              )}
              {PROVIDER_ROSTER.some((p) => p.arriving) ? (
                <p className="hint" style={{ margin: '4px 2px 0' }}>
                  More storage arriving:{' '}
                  {PROVIDER_ROSTER.filter((p) => p.arriving)
                    .map((p) => p.label)
                    .join(', ')}
                  .
                </p>
              ) : null}
              {/* The desktop folder picker (1.4): a pick only repoints, and
                  the sheet then shows what it found. Desktop only. */}
              {pickerRow ? (
                <div className="vault-provider-row">
                  <button
                    type="button"
                    className="btn ghost vault-provider press-fb"
                    disabled={moving || picking}
                    onClick={() => void runPick('sheet')}
                  >
                    <span className="grow" style={{ textAlign: 'left' }}>
                      {pickerRow.label}
                      <span className="sub" style={{ display: 'block', fontWeight: 400 }}>
                        {pickerRow.sub}
                      </span>
                    </span>
                    {picking ? <span className="pill muted">{pickerRow.busy}</span> : null}
                  </button>
                  {pickLine ? (
                    <p
                      key={pickLine.text}
                      className={`hint vault-folder-line${pickLine.warn ? ' warn' : ''}`}
                      role="status"
                    >
                      {pickLine.text}
                    </p>
                  ) : null}
                  {pickLine?.privacy ? (
                    <button
                      type="button"
                      className="btn ghost press-fb vault-folder-action"
                      onClick={() => void openPrivacySettings()}
                    >
                      {VAULT_PRIVACY_BUTTON}
                    </button>
                  ) : null}
                  {pick && pickCopy ? (
                    <PickResult
                      key={pick.info.dir}
                      pick={pick}
                      copy={pickCopy}
                      answered={pickAnswered}
                      chatsOpen={vaultDesktopChatOpen()}
                      busy={moving || bringing}
                      bringing={bringing}
                      brought={brought === pick.info.dir}
                      onChoose={(choice) => void refinePick(choice)}
                      onMove={() => void moveVault('files')}
                      onBring={() => void bringNotes(pick.previous?.display ?? '')}
                    />
                  ) : null}
                </div>
              ) : null}
              {/* The way out (0.11): a real export on the iPhone. On the
                  desktop, This folder is always offered above, with its path
                  and an open-folder button, so it is the one way out. */}
              {vaultWayOut(on, currentProviderId) === 'export' ? (
                <button className="btn ghost press-fb" onClick={() => void exportNotes()}>
                  Export as plain files
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </Sheet>
    </div>
  );
}

// The save chip (2.2): Saved, Saving, or kept on this device with how many
// notes wait and a Try again. Re-keyed on the status, so each change settles in
// on fade-rise rather than cutting. Only the offline state is announced: a
// Saving and Saved on every pause would talk over the person typing.
function SaveChip({
  status,
  pending,
  onRetry,
}: {
  status: VaultSaveStatus;
  pending: number;
  onRetry: () => void;
}) {
  const chip = vaultSaveChip(status, pending);
  return (
    <span
      key={status}
      className={`vault-save-chip ${status}`}
      {...(status === 'offline' ? { role: 'status' } : {})}
    >
      {chip.label}
      {chip.count ? <span className="vault-save-count">{chip.count}</span> : null}
      {chip.retry ? (
        <button type="button" className="linklike press-fb" onClick={onRetry}>
          {chip.retry}
        </button>
      ) : null}
    </span>
  );
}

// The "Not saved" list (0.4): text a vault did not take and nothing will
// retry. In the room it lists every vault's this account may see, each
// labelled with its vault; on a note, only that note's. It promises "until
// you discard it" only for text that keeps that long: an entry this device
// holds no sealed copy of lasts until the app closes, and team text leaves
// at sign-out, and each says so. Discard takes two taps, since it may be the
// last copy.
function NotSaved({
  held,
  labelled = false,
  folderNow,
  discard,
}: {
  held: VaultHeldDraft[];
  labelled?: boolean;
  /** The desktop vault folder now, so text from an earlier one names it. */
  folderNow?: string;
  discard: (id: string) => void;
}) {
  const showToast = useApp((s) => s.showToast);
  const [confirm, setConfirm] = useState<string | undefined>();
  if (!held.length) return null;
  return (
    <div className="card" style={{ margin: '12px 0 14px' }}>
      <div className="card-row">
        <h3 style={{ marginBottom: 0 }}>Not saved</h3>
        <span className="pill muted">{held.length}</span>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        {vaultHeldHint(held)}
      </p>
      {held.map((h) => {
        const keep = vaultHeldKeep(h);
        return (
          <div key={h.id} className="vault-held-item">
            <span className="vault-held-title">{noteTitle(h.path)}</span>
            <span className="hint">
              {[labelled ? heldPlace(h, folderNow) : undefined, heldWhen(h.at)]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <p className="sub" style={{ margin: '4px 0 0' }}>
              {h.reason}
            </p>
            {keep ? (
              <p className="hint" style={{ margin: '4px 0 0', color: 'var(--warn)' }}>
                {keep}
              </p>
            ) : null}
            <div className="vault-held-actions">
              <button
                className="btn ghost press-fb"
                onClick={async () => {
                  const ok = await copyText(h.text);
                  showToast(
                    ok
                      ? 'Copied. Paste it back into the note, or anywhere safe.'
                      : 'Could not copy on this device. Try again.',
                  );
                }}
              >
                Copy
              </button>
              <button
                className={`btn press-fb ${confirm === h.id ? 'danger' : 'quiet'}`}
                onClick={() => {
                  if (confirm !== h.id) {
                    setConfirm(h.id);
                    return;
                  }
                  setConfirm(undefined);
                  discard(h.id);
                }}
              >
                {confirm === h.id ? 'Really discard? Tap to confirm.' : 'Discard'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Which vault held text belongs to, in the room's words. */
function heldPlace(h: VaultHeldDraft, folderNow?: string): string {
  if (h.providerId === 'org') return 'Team vault';
  // Text typed in a folder the vault no longer uses names that folder.
  if (h.providerId === 'files' && h.folder && h.folder !== folderNow) {
    return vaultEarlierFolderHeld(h.folderDisplay ?? h.folder).place;
  }
  const label = PROVIDER_ROSTER.find((r) => r.id === h.providerId)?.label ?? h.providerId;
  return `Personal vault, ${label}`;
}

/** When it was set aside, on this device's clock. */
function heldWhen(at: string): string {
  const when = new Date(at);
  return Number.isNaN(when.getTime())
    ? ''
    : when.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

// The empty personal vault's ramp, from the copy map: a cover with two ways
// in, and the points that are true for this platform and storage.
function VaultRamp({
  onboard,
  readOnly,
  onWrite,
  onWelcome,
}: {
  onboard: VaultOnboard;
  /** A read-only vault: the ways in that write are left out, not dimmed. */
  readOnly: boolean;
  onWrite: () => void;
  onWelcome: () => void;
}) {
  const glyphs = { doc: DocGlyph, agent: AgentGlyph, link: LinkGlyph };
  return (
    <section className="vault-onboard">
      <div className="vault-onboard-cover">
        <div className="vault-onboard-wash" aria-hidden="true" />
        <div className="vault-onboard-body">
          <span className="vault-kicker">Your vault</span>
          <h2 className="vault-onboard-title">{onboard.title}</h2>
          <p className="vault-onboard-lead">{onboard.lead}</p>
          {!readOnly ? (
            <div className="vault-onboard-actions">
              <button className="btn primary" onClick={onWrite}>
                Write your first note
              </button>
              <button className="btn ghost" onClick={onWelcome}>
                Add a welcome note
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="vault-how">
        {onboard.points.map((point) => {
          const Glyph = glyphs[point.glyph];
          return (
            <div key={point.glyph} className="vault-how-item">
              <span className="vault-how-glyph">
                <Glyph />
              </span>
              <div>
                <h3>{point.title}</h3>
                <p className="sub">{point.sub}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Whether any segment of a typed note name starts with a dot, which the
 *  typed-name rule strips (Obsidian and the vault hide dot names). */
function startsWithDot(typed: string): boolean {
  return typed
    .replace(/\\/g, '/')
    .split('/')
    .some((segment) => segment.trim().startsWith('.'));
}

/** The toast after "Pin to project context". */
function pinToast(
  r: 'pinned' | 'already' | 'full' | 'refused',
  project: string | undefined,
): string {
  const name = project ?? 'this project';
  switch (r) {
    case 'pinned':
      return `Pinned to ${name}. Its chats start with this note.`;
    case 'already':
      return `Already pinned to ${name}.`;
    case 'full':
      return `${name} has ${PROJECT_VAULT_PINS_MAX} pinned notes. Unpin one in the project first.`;
    case 'refused':
      return 'Only an editor of this project can pin notes to it.';
  }
}

// The one-time card after pairing (Vault M5, CTO J9): the notes are on this
// device, and one tap moves them to the computer with the existing move
// (nothing there is replaced). It folds out like the desktop move card.
function HubMoveCard({
  shown,
  count,
  busy,
  failed,
  onMove,
  onDecline,
}: {
  shown: boolean;
  /** How many notes would move, for the card's line. */
  count: number;
  busy: boolean;
  failed: boolean;
  onMove: () => void;
  onDecline: () => void;
}) {
  const presence = useExitPresence(shown, driveCardExitMs());
  if (!presence.mounted) return null;
  const off = busy || presence.closing;
  return (
    <div
      className={`card vault-move-card${presence.closing ? ' closing' : ''}`}
      style={{ margin: '0 0 14px' }}
    >
      <h3 style={{ marginBottom: 4 }}>{HUB_OFFER_COPY.title}</h3>
      <p className="sub" style={{ marginTop: 0 }}>
        {hubMoveOffer(count)}
      </p>
      {failed ? (
        <p className="hint" style={{ margin: '6px 0 0', color: 'var(--warn)' }}>
          Nothing moved. Your computer did not take every note, so your Vault stays here.
        </p>
      ) : null}
      <div className="vault-move-actions">
        <button type="button" className="btn primary press-fb" disabled={off} onClick={onMove}>
          {busy ? 'Moving your notes' : HUB_OFFER_COPY.move}
        </button>
        {!busy ? (
          <button type="button" className="btn quiet press-fb" disabled={off} onClick={onDecline}>
            {HUB_OFFER_COPY.later}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** How long the Drive card takes to fold out: its exit (--dur-4) plus a
 *  hair, so the tail is never clipped by the unmount. */
function driveCardExitMs(): number {
  return durationMs('--dur-4', 280) + 20;
}

// The read-only Drive card (0.18). It rides useExitPresence, the UpdateBanner
// pattern: when a move off Drive lands it folds out (opacity and transform
// only) with the last text it showed, rather than unmounting, so the controls
// coming back read as the card leaving, never a cut.
function DriveCard({
  shown,
  reason,
  line,
  action,
  busy,
  fromNote,
  onAction,
}: {
  shown: boolean;
  reason?: string;
  line?: string;
  action?: string;
  busy: boolean;
  fromNote: boolean;
  onAction: () => void;
}) {
  const presence = useExitPresence(shown, driveCardExitMs());
  const last = useRef({ reason, line, action });
  if (shown) last.current = { reason, line, action };
  if (!presence.mounted) return null;
  const text = last.current;
  return (
    <div
      className={`card vault-drive-card${presence.closing ? ' closing' : ''}`}
      role="status"
      style={{ margin: fromNote ? '12px 0 0' : '0 0 14px' }}
    >
      <h3 style={{ marginBottom: 4 }}>This vault is read-only</h3>
      {text.reason ? (
        <p className="sub" style={{ marginTop: 0 }}>
          {text.reason}
        </p>
      ) : null}
      {text.line ? (
        <p className="sub" style={{ marginTop: 0 }}>
          {text.line}
        </p>
      ) : null}
      {text.action ? (
        <button
          type="button"
          className="btn primary press-fb"
          disabled={busy || presence.closing}
          onClick={onAction}
        >
          {text.action}
        </button>
      ) : null}
    </div>
  );
}

// The standing card while a choice about this note waits (the resolve sheet
// was closed: 'not now'). It rides useExitPresence like the Drive card, so it
// folds out with its last words when the choice is made, never a cut.
function ConflictCard({
  shown,
  mode,
  onChoose,
}: {
  shown: boolean;
  mode: 'edit' | 'missing';
  onChoose: () => void;
}) {
  const presence = useExitPresence(shown, driveCardExitMs());
  const last = useRef(mode);
  if (shown) last.current = mode;
  if (!presence.mounted) return null;
  const card = vaultConflictCard(last.current);
  return (
    <div
      className={`card vault-conflict-card${presence.closing ? ' closing' : ''}`}
      role="status"
      style={{ margin: '12px 0 0' }}
    >
      <h3 style={{ marginBottom: 4 }}>{card.title}</h3>
      <p className="sub" style={{ marginTop: 0 }}>
        {card.sub}
      </p>
      <button
        type="button"
        className="btn primary press-fb"
        disabled={presence.closing}
        onClick={onChoose}
      >
        {card.action}
      </button>
    </div>
  );
}

// The one-time desktop move card (Vault M1 1.3, D7; Creative Studio 2). It
// rides useExitPresence like the Drive card: on a successful move it folds
// out with the words it last showed, never a cut. Both buttons are
// decisions, so there is no X. A refused move keeps the card, says why inside
// it, and its button becomes Try again.
function VaultMoveCard({
  shown,
  offer,
  display,
  busy,
  failed,
  onMove,
  onDecline,
  onOtherFolder,
}: {
  shown: boolean;
  offer: ReturnType<typeof vaultFolderOffer>;
  display?: string;
  busy: boolean;
  failed?: string;
  onMove: () => void;
  onDecline: () => void;
  onOtherFolder: () => void;
}) {
  const presence = useExitPresence(shown, driveCardExitMs());
  const last = useRef({ offer, display, failed });
  if (shown) last.current = { offer, display, failed };
  if (!presence.mounted) return null;
  const t = last.current;
  const off = busy || presence.closing;
  return (
    <div
      className={`card vault-move-card${presence.closing ? ' closing' : ''}`}
      style={{ margin: '0 0 14px' }}
    >
      {t.offer.lead ? (
        <p className="hint" style={{ marginTop: 0 }}>
          {t.offer.lead}
        </p>
      ) : null}
      <h3 style={{ marginBottom: 4 }}>{t.offer.title}</h3>
      <p className="sub" style={{ marginTop: 0 }}>
        {t.offer.body}
      </p>
      {t.display ? (
        <p className="hint" style={{ margin: '6px 0 0' }}>
          <code className="vault-path" key={t.display} title={t.display}>
            {t.display}
          </code>{' '}
          {!busy ? (
            <button type="button" className="linklike press-fb" onClick={onOtherFolder}>
              {t.offer.link}
            </button>
          ) : null}
        </p>
      ) : null}
      <p className="hint" style={{ margin: '6px 0 0' }}>
        {t.offer.hint}
      </p>
      <div className="vault-move-actions">
        <button type="button" className="btn primary press-fb" disabled={off} onClick={onMove}>
          {busy ? t.offer.busy : t.failed ? t.offer.retry : t.offer.primary}
        </button>
        {!busy ? (
          <button type="button" className="btn quiet press-fb" disabled={off} onClick={onDecline}>
            {t.offer.decline}
          </button>
        ) : null}
      </div>
      {t.failed && !busy ? (
        <p className="hint" role="status" style={{ margin: '8px 0 0', color: 'var(--warn)' }}>
          {t.failed}
        </p>
      ) : null}
    </div>
  );
}

// The vault folder is not there (CX 1.4): the room says so, hides every
// control that writes, and never falls back quietly to another folder.
function VaultMissingCard({
  shown,
  title,
  line,
  retry,
  choose,
  onRetry,
  onChoose,
}: {
  shown: boolean;
  title: string;
  line: string;
  retry: string;
  choose: string;
  onRetry: () => void;
  onChoose: () => void;
}) {
  const presence = useExitPresence(shown, driveCardExitMs());
  const last = useRef({ title, line });
  if (shown) last.current = { title, line };
  if (!presence.mounted) return null;
  return (
    <div
      className={`card vault-missing-card${presence.closing ? ' closing' : ''}`}
      role="status"
      style={{ margin: '0 0 14px' }}
    >
      <h3 style={{ marginBottom: 4 }}>{last.current.title}</h3>
      <p className="sub" style={{ marginTop: 0 }}>
        {last.current.line}
      </p>
      <div className="vault-move-actions">
        <button
          type="button"
          className="btn primary press-fb"
          disabled={presence.closing}
          onClick={onRetry}
        >
          {retry}
        </button>
        <button
          type="button"
          className="btn ghost press-fb"
          disabled={presence.closing}
          onClick={onChoose}
        >
          {choose}
        </button>
      </div>
    </div>
  );
}

// The desktop folder under This folder's row (Creative Studio 3a): where it
// is, any line about it, and the actions that fit this computer. Open in
// Obsidian shows only for a folder Obsidian already knows.
function FolderBlock({ info }: { info: VaultDirInfo }) {
  const showToast = useApp((s) => s.showToast);
  return (
    <div className="vault-folder-block">
      <code className="vault-path" key={info.dir} title={info.dir}>
        {info.display}
      </code>
      {info.warning ? (
        <p className="hint vault-folder-line warn" role="status">
          {vaultWarningLine(info.warning)}
        </p>
      ) : null}
      {!info.exists ? (
        <p className="hint vault-folder-line warn" role="status">
          {VAULT_FOLDER_MISSING_LINE}
        </p>
      ) : (
        <>
          <div className="vault-folder-actions">
            <button
              type="button"
              className="btn ghost press-fb vault-folder-action"
              onClick={() =>
                void revealVaultFolder().then((ok) => {
                  if (!ok) showToast('That folder could not be opened right now.');
                })
              }
            >
              {vaultRevealLabel(info.os)}
            </button>
            {info.obsidian === 'vault' ? (
              <button
                type="button"
                className="btn ghost press-fb vault-folder-action"
                onClick={() => void openVaultInObsidian()}
              >
                {VAULT_OPEN_OBSIDIAN}
              </button>
            ) : null}
          </div>
          {info.obsidian === 'installed' ? (
            <p className="hint vault-folder-line">{VAULT_OBSIDIAN_HOWTO}</p>
          ) : null}
        </>
      )}
    </div>
  );
}

// What a pick found, under the picker row (CX 1.4): where the vault is now,
// the facts, at most one question, the lines that apply, and the ways to act
// on the change. It arrives on fade-rise; an answer settles the facts in.
function PickResult({
  pick,
  copy,
  answered,
  chatsOpen,
  busy,
  bringing,
  brought,
  onChoose,
  onMove,
  onBring,
}: {
  pick: Extract<VaultPickResult, { ok: true }>;
  copy: ReturnType<typeof vaultPickResultCopy>;
  answered: boolean;
  chatsOpen: boolean;
  busy: boolean;
  bringing: boolean;
  /** A Bring from this pick went through: the offer goes. */
  brought: boolean;
  onChoose: (choice: VaultRefineChoice | { to: 'stay' }) => void;
  onMove: () => void;
  onBring: () => void;
}) {
  const picked = pick.info.display.split(/[\\/]/).filter(Boolean).pop() ?? pick.info.display;
  const question = answered ? undefined : vaultFolderQuestion(picked, pick.survey);
  const cloud = vaultCloudLine(pick.survey.cloud);
  return (
    <div className="vault-folder-block vault-pick-result" role="status">
      <p className="vault-folder-line" style={{ fontWeight: 600 }}>
        {copy.heading}
      </p>
      <p className="hint vault-folder-line" key={`facts:${answered}`}>
        {vaultFolderFacts(pick.survey)}
      </p>
      {question ? (
        <div className="vault-pick-question">
          <p className="hint vault-folder-line">{question.line}</p>
          <div className="sheet-actions" style={{ marginTop: 6 }}>
            {question.choices.map((c) => (
              <button
                key={c.label}
                type="button"
                className={`btn ${c.tone} vault-provider press-fb`}
                onClick={() => onChoose(c.choice)}
              >
                <span className="grow" style={{ textAlign: 'left' }}>
                  {c.label}
                  {c.sub ? (
                    <span className="sub" style={{ display: 'block', fontWeight: 400 }}>
                      {c.sub}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
          {question.hint ? <p className="hint vault-folder-line">{question.hint}</p> : null}
        </div>
      ) : null}
      {cloud ? <p className="hint vault-folder-line">{cloud}</p> : null}
      {copy.large ? <p className="hint vault-folder-line">{copy.large}</p> : null}
      {chatsOpen ? <p className="hint vault-folder-line">{VAULT_OPEN_CHATS_LINE}</p> : null}
      {copy.move ? (
        <button
          type="button"
          className="btn primary vault-provider press-fb"
          disabled={busy}
          onClick={onMove}
        >
          <span className="grow" style={{ textAlign: 'left' }}>
            {copy.move.label}
            <span className="sub" style={{ display: 'block', fontWeight: 400 }}>
              {copy.move.sub}
            </span>
          </span>
        </button>
      ) : null}
      {copy.bring && !brought ? (
        <button
          type="button"
          className={`btn ${copy.move ? 'ghost' : 'primary'} vault-provider press-fb`}
          disabled={busy}
          aria-busy={bringing || undefined}
          onClick={onBring}
        >
          <span className="grow" style={{ textAlign: 'left' }}>
            {bringing ? copy.bring.busy : copy.bring.label}
            <span className="sub" style={{ display: 'block', fontWeight: 400 }}>
              {copy.bring.sub}
            </span>
          </span>
        </button>
      ) : null}
      {copy.back ? (
        <p className="hint vault-folder-line">
          <button
            type="button"
            className="linklike press-fb"
            onClick={() => onChoose({ to: 'previous' })}
          >
            {copy.back.label}
          </button>
        </p>
      ) : null}
    </div>
  );
}

/** The Vault room as App.tsx mounts it: the screen inside its error boundary
 *  (0.10), so a fault shows VaultFault, never a blank app. On a note, the way
 *  back closes the note and shows the list again (opening another note
 *  clears the fault too). In the notes list there is no note to close and the
 *  same render would fault again, so the way out leaves the room (the next
 *  visit mounts it fresh), with a try again for a fault that has passed.
 *  `children` stands in for the screen in a test. */
export function VaultRoom({ children }: { children?: ReactNode }) {
  const notePath = useApp((s) => s.vaultNote?.path);
  const closeNote = useApp((s) => s.vaultCloseNote);
  const setView = useApp((s) => s.setView);
  return (
    <ErrorBoundary
      resetKey={notePath}
      fallback={(reset) => (
        <VaultFault
          inNote={notePath !== undefined}
          onBack={() => {
            closeNote();
            reset();
          }}
          onLeave={() => setView('chat')}
          onRetry={reset}
        />
      )}
    >
      {children ?? <VaultScreen />}
    </ErrorBoundary>
  );
}

/** The Vault room's fallback when something in it fails to render (0.10):
 *  a way out that works, never a blank app. */
export function VaultFault({
  inNote,
  onBack,
  onLeave,
  onRetry,
}: {
  /** A note was open when it failed, so there is a list to go back to. */
  inNote: boolean;
  onBack: () => void;
  onLeave: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="screen">
      <BackBar title="Vault" />
      <div className="screen-inner">
        <div className="card empty-notice" role="alert">
          <h3>This could not be shown.</h3>
          <p className="sub">
            Something in the Vault failed to display. Your notes are safe where they live.
          </p>
          {inNote ? (
            <button className="btn primary press-fb" onClick={onBack}>
              Back to your notes
            </button>
          ) : (
            <div className="sheet-actions">
              <button className="btn primary press-fb" onClick={onLeave}>
                Back to Chat
              </button>
              <button className="btn quiet press-fb" onClick={onRetry}>
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Small line glyphs for the onboarding "how it works" points. Stroke-only, on
// currentColor, so they sit in the brand water like the rest of the room.
function DocGlyph() {
  return (
    <Icon size={18}>
      <path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" />
      <path d="M14 2v4h4M8 13h8M8 17h6" />
    </Icon>
  );
}

function AgentGlyph() {
  return (
    <Icon size={18}>
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 4v4M9 14h.01M15 14h.01" />
    </Icon>
  );
}

function LinkGlyph() {
  return (
    <Icon size={18}>
      <path d="M9 12a3 3 0 0 1 3-3h4a3 3 0 0 1 0 6h-2" />
      <path d="M15 12a3 3 0 0 1-3 3H8a3 3 0 0 1 0-6h2" />
    </Icon>
  );
}
