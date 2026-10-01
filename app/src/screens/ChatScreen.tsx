// The chat screen. Empty state mirrors the Claude app's opening: just the mark
// and a time-of-day greeting, with the model, effort, and everything else
// living in the composer. A live conversation swaps in the transcript and a
// header that names the chat.
import { SwellText } from '../components/SwellText.js';
import { LANDING_PACE, takeLandingSwell } from '../lib/introWalk.js';
import { durationMs } from '../lib/motion.js';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { INIT_PROMPT } from 'os-code/protocol';
import { useApp, driverFor } from '../state/store.js';
import type { HubRole } from '../drivers/types.js';
import { sourceSupportsVision, type ConversationSource } from '../state/types.js';
import { MessageList } from '../components/MessageList.js';
import {
  Composer,
  SLASH_COMMANDS,
  type ComposerVault,
  type SlashCommand,
} from '../components/Composer.js';
import type { PickerNote } from '../components/VaultNotePicker.js';
import { memoryOverride } from '../lib/currents.js';
import { HELD_MESSAGE_KEPT, restoreFromHeld, type ComposerRestore } from '../lib/heldMessage.js';
import { ApprovalSheet } from '../components/ApprovalSheet.js';
import { ModelSheet } from '../components/ModelSheet.js';
import { ModeSheet } from '../components/ModeSheet.js';
import { ProfileStatus } from '../components/ProfileStatus.js';
import { BrandMark } from '../components/BrandMark.js';
import { MenuIcon } from '../components/MenuIcon.js';
import { ROOM_NAMES } from '../components/BackBar.js';
import { RepoPicker } from '../components/RepoPicker.js';
import { TodoCard } from '../components/TodoCard.js';
import { MiniFirstMoves } from '../components/MiniFirstMoves.js';
import { GuideSetupLink } from '../components/GuideSetupLink.js';
import { SetupStepActions } from '../components/SetupStepActions.js';
import { EditChoiceActions } from '../components/EditChoiceActions.js';
import { NextChoiceActions } from '../components/NextChoiceActions.js';
import { SetupMenuActions } from '../components/SetupMenuActions.js';
import { StartChoiceActions } from '../components/StartChoiceActions.js';
import { ASK_ANYTHING, setupHelpIntent, walkActive } from '../lib/guidedSetup.js';
import { FirstSeat } from '../components/FirstSeat.js';
import { VoiceMode } from '../components/VoiceMode.js';
import type { VoiceBreak } from '../lib/voice/voiceBreaks.js';
import { Sheet } from '../components/Sheet.js';
import { HARBOR_MINI_MODEL_ID, HARBOR_MINI_EMPTY_HINT } from '../lib/harborMini.js';
import { buildRotation, type Greeting } from '../lib/greeting.js';
import { SAMPLE_ROW_LABEL, SAMPLE_ROW_SUB } from '../lib/sampleProject.js';
import { hapticTick } from '../lib/haptics.js';
import { isDesktop, isPhone } from '../lib/platform.js';
import { copyText } from '../lib/clipboard.js';
import { RewindSheet } from '../components/RewindSheet.js';
import { rewindOffersFiles, rewindableIds } from '../state/rewindOps.js';
import { DEFAULT_PERMISSION_MODE } from '../lib/permissionMode.js';
import { useOnline } from '../hooks/useOnline.js';
import { useExitPresence } from '../hooks/useExitPresence.js';
import type { Attachment } from '../lib/attachments.js';

/** The transcript's shape while a reopened desktop chat replays its journal:
 *  soft bars in the rhythm of the last known transcript (user turn, answer,
 *  tool), sized from the item count saved at the last persist, so the shape
 *  matches what is about to land and the screen never flashes the
 *  empty-state greeting on the way to a full history. */
function ResumeSkeleton({ count }: { count?: number }) {
  // Every four items is roughly one exchange; between one and four of them.
  const groups = Math.max(1, Math.min(4, Math.ceil((count ?? 4) / 4)));
  return (
    <div className="thread" aria-busy="true" aria-label="Loading the conversation">
      <div className="thread-inner">
        {Array.from({ length: groups }, (_, g) => (
          <div
            key={g}
            className="skel-group"
            style={{ animationDelay: `calc(${g} * var(--dur-2))` }}
          >
            <div className="skel skel-user" style={{ width: `${34 + ((g * 17) % 30)}%` }} />
            <div className="skel skel-line" />
            <div className="skel skel-line short" />
            {g % 2 === 0 ? <div className="skel skel-tool" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// True once the boot splash has lifted off the screen. The composer waits for
// this before it focuses, so the keyboard pulls up gracefully as the greeting is
// revealed, never underneath the splash. Starts true when there is no splash
// (the desktop shell, or any later return to the empty state within a session),
// so nothing ever waits needlessly.
function useBooted(): boolean {
  const [booted, setBooted] = useState(() => !document.getElementById('boot-splash'));
  useEffect(() => {
    if (booted) return;
    const gone = () => {
      if (document.getElementById('boot-splash')) return false;
      setBooted(true);
      return true;
    };
    if (gone()) return;
    const obs = new MutationObserver(() => gone());
    obs.observe(document.body, { childList: true });
    return () => obs.disconnect();
  }, [booted]);
  return booted;
}

// .greeting is position: fixed (see theme.css), so its top offset is measured
// from the actual viewport, not from anywhere in the document, and needs to
// clear the header itself. The header's rendered height is not a constant we
// can hardcode: it varies with env(safe-area-inset-top), which differs by
// notch/Dynamic-Island depth across devices and can even change at runtime
// (a Live Activity or phone-call status bar can grow it). Measuring it is a
// plain, unconditional "how tall is this element right now" question, nothing
// to do with detecting keyboard state, so unlike useKeyboardInset's history
// there is no failure-prone trigger involved.
function useHeaderHeight(headerRef: RefObject<HTMLElement>): void {
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const apply = () => {
      document.documentElement.style.setProperty('--header-height', `${el.offsetHeight}px`);
    };
    apply();
    const obs = new ResizeObserver(apply);
    obs.observe(el);
    return () => obs.disconnect();
  }, [headerRef]);
}

/** The short name on the stopped card's "Continue with" button. */
function rescueLabel(source?: ConversationSource): string | undefined {
  if (!source) return undefined;
  if (source.kind === 'device') return source.modelName;
  if (source.kind === 'stack') return 'the Stack';
  return undefined;
}

export function ChatScreen({ compact }: { compact: boolean }) {
  const {
    activeId,
    conversations,
    send,
    abort,
    answerApproval,
    answerAllApprovals,
    newConversation,
    switchModel,
    setDrawer,
    setView,
    goBack,
    viewTrail,
    viewProjectId,
    sourceReady,
    showToast,
    retryLast,
    rescueSourceFor,
    continueElsewhere,
    approvePlan,
    trustProjectFolder,
    dismissProjectTrust,
    giveMoreRoom,
    restoreChangedFiles,
    rewindTo,
    trySampleProject,
    revisePlan,
    startNewChat,
    compactActive,
    renameConversation,
    activeIsAgent,
    resumingId,
    settings,
    resumeGuidedSetup,
    unqueue,
    addNote,
    setConversationRepos,
    holdFirstMessage,
    holdUntilReady,
    takeHeldFirstMessage,
    settleHeldMessage,
    composerDefaultSource,
    sendWaitsOnFirstSeat,
    retryPending,
  } = useApp();
  // The repositories a new chat will start with, picked in the header before
  // the first message (the Claude Code way): the active project's, until the
  // person changes them here. A live chat keeps its own list on the
  // conversation instead.
  const activeProjectId = settings.activeProjectId ?? settings.projects?.[0]?.id;
  const activeProject = settings.projects?.find((p) => p.id === activeProjectId);
  const [pendingRepoIds, setPendingRepoIds] = useState<string[]>(
    () => activeProject?.repoIds ?? [],
  );
  useEffect(() => {
    setPendingRepoIds(activeProject?.repoIds ?? []);
    // Only a project change reseeds; edits in the picker stand otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Which sub-sheet the model sheet opens on: 'root' from the composer pill,
  // 'local' from the out-of-usage "Switch to a local model" tap.
  const [sheetStage, setSheetStage] = useState<'root' | 'local'>('root');
  const [modeSheetOpen, setModeSheetOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  // Bumped to pull focus into the composer (a plan's "Change something").
  const [focusSignal, setFocusSignal] = useState(0);
  // Voice mode: a spoken conversation over this same chat. It closes itself when
  // the model needs an on-screen decision (an approval, a spend), and reopens
  // once that decision is answered. resumeVoice remembers that we owe a reopen.
  const [voiceOpen, setVoiceOpen] = useState(false);
  const resumeVoice = useRef(false);
  const online = useOnline();
  const { mounted: offlineMounted, closing: offlineClosing } = useExitPresence(!online);
  // The brain a new chat will use, chosen from the composer. Until the person
  // picks one it follows the store's default (state/firstRunOps.ts): on the
  // desktop app the engine on this machine, so a first message just works,
  // and signed out (the coding agent is behind a free sign-in) the free chat
  // with the engine's own model; the phone defaults to the stack, which is
  // what "My Stack" selects. It is read every render, so a sign-in, a model
  // set up, or a Stack built moves it along.
  const [pickedSource, setPickedSource] = useState<ConversationSource | undefined>(undefined);
  const selectedSource = pickedSource ?? composerDefaultSource();
  // A first message typed before any brain can answer (no model downloaded, no
  // computer paired, no cloud key) is held in the store (settings'
  // heldFirstMessage), never here, so a jump from the chooser to a setup room
  // cannot lose it: the model sheet opens as a chooser and a pick sends it,
  // and on the desktop with nothing set up it waits on the First Seat and
  // goes out once DeepBlue is ready. This is what keeps a first send from
  // dead-ending on a fake reply, a raw load error, or a room change.
  // True while the chooser was opened for a held message, so its dismiss
  // hands the words back.
  const chooserHolds = useRef(false);
  // The held message handed back to the composer when the chooser closes.
  const [restore, setRestore] = useState<ComposerRestore | undefined>(undefined);
  const booted = useBooted();
  const headerRef = useRef<HTMLElement>(null);
  useHeaderHeight(headerRef);

  const conv = activeId ? conversations[activeId] : undefined;
  const thread = conv?.thread;
  // Guided setup (lib/guidedSetup.ts): where the walk stands, and the guide's
  // latest message, which carries the current step's buttons.
  const guided = settings.guidedSetup;
  const lastItemId = thread?.items[thread.items.length - 1]?.id;
  const lastAssistantId = thread
    ? [...thread.items].reverse().find((i) => i.kind === 'assistant')?.id
    : undefined;
  // The room this chat was opened from, when it is a sub-page (the Chats list,
  // or a project's detail room). Names the way-back button in the header; a
  // project uses its own name, so the button reads "‹ Uki Audio", not "‹ Project".
  const backView = viewTrail[viewTrail.length - 1];
  const backTo = !backView
    ? undefined
    : backView === 'project'
      ? (settings.projects?.find((p) => p.id === viewProjectId)?.name ?? ROOM_NAMES.project)
      : ROOM_NAMES[backView];
  // "Rewind to here" (P2): the person's messages this chat can go back to
  // now, and the one whose choice is open. Esc Esc in an empty desktop
  // composer opens it for the last one; the phone has the long press.
  const rewindIds =
    conv && thread
      ? rewindableIds(thread, conv.source, { guided: guided?.conversationId === conv.id })
      : [];
  const [rewindId, setRewindId] = useState<string | undefined>(undefined);
  const rewindItem = rewindId ? thread?.items.find((i) => i.id === rewindId) : undefined;
  const rewindText = rewindItem?.kind === 'user' ? rewindItem.text : undefined;
  const lastRewindId = rewindIds[rewindIds.length - 1];
  useEffect(() => setRewindId(undefined), [activeId]);
  const approval = thread?.pendingApprovals[0];
  const agent = Boolean(conv && conv.source.kind === 'desktop' && activeIsAgent());
  const mode = settings.permissionMode ?? DEFAULT_PERMISSION_MODE;
  const resuming = Boolean(conv && resumingId === conv.id && thread && thread.items.length === 0);
  const history = thread
    ? thread.items.filter((i) => i.kind === 'user').map((i) => (i.kind === 'user' ? i.text : ''))
    : [];

  // A held first message comes back here (state/firstRunOps.ts): into the
  // composer when this screen returns from a setup room, or, waiting on the
  // First Seat, sent the moment the engine can answer. Read again whenever
  // what can answer changes; the chooser keeps a message it holds itself.
  const heldNow = settings.heldFirstMessage;
  const desktopStatus = useApp((s) => s.desktopStatus);
  const cloudKey = useApp((s) => s.cloudKeyPresent);
  const stackReadyNow = sourceReady({ kind: 'stack' });
  const signedInNow = useApp((s) => Boolean(s.authSession));
  useEffect(() => {
    const back = settleHeldMessage({ chooserOpen: sheetOpen });
    if (back) {
      setRestore((r) => restoreFromHeld(back, r));
      showToast(HELD_MESSAGE_KEPT);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldNow, desktopStatus, cloudKey, stackReadyNow, signedInNow, activeId, sheetOpen]);

  // Reopen voice once an on-screen decision it stepped aside for is answered: the
  // approval sheet is gone and no chooser is up. Keyed on those states clearing,
  // so answering the approval brings the conversation right back to voice.
  useEffect(() => {
    if (resumeVoice.current && !approval && !sheetOpen && !modeSheetOpen && !renameOpen) {
      resumeVoice.current = false;
      setVoiceOpen(true);
    }
  }, [approval, sheetOpen, modeSheetOpen, renameOpen]);

  const openRename = () => {
    if (!conv) return;
    setRenameDraft(conv.title === 'New chat' ? '' : conv.title);
    setRenameOpen(true);
  };

  const onCommand = (command: SlashCommand, arg: string) => {
    switch (command) {
      case 'help': {
        const cmds = SLASH_COMMANDS.filter((c) => agent || !c.agentOnly)
          .map((c) => `/${c.name}${c.arg ? ` <${c.arg}>` : ''}: ${c.hint.toLowerCase()}`)
          .join('\n');
        const text = `${cmds}\n@ mentions a repository file. # saves a line to the project's instructions. Esc stops a run or clears the field. Up recalls an earlier message. Shift+Tab cycles the permission mode. A message typed while the agent works is queued.`;
        if (conv) addNote(text);
        else showToast('Open a chat, then /help lists what the composer can do.');
        return;
      }
      case 'clear':
        startNewChat();
        return;
      case 'compact':
        void compactActive(arg || undefined);
        return;
      case 'model':
        setSheetStage('root');
        setSheetOpen(true);
        return;
      case 'cost': {
        if (!thread) {
          showToast('Nothing spent yet.');
          return;
        }
        const turn = thread.lastTurn
          ? ` Last turn: ${thread.lastTurn.promptTokens.toLocaleString()} in, ${thread.lastTurn.completionTokens.toLocaleString()} out.`
          : '';
        showToast(
          `$${thread.dollars.toFixed(2)} this chat. Context ${thread.contextPercent}% full.${turn}`,
        );
        return;
      }
      case 'mode':
        setModeSheetOpen(true);
        return;
      case 'init':
        if (!conv) {
          showToast('Open a repository on your computer first.');
          return;
        }
        send(INIT_PROMPT);
        return;
      case 'rename':
        if (!conv) {
          showToast('Open a chat to name it.');
          return;
        }
        if (arg) void renameConversation(conv.id, arg);
        else openRename();
        return;
    }
  };

  // The splash greeting. A fresh time-and-day-aware landing line lands first;
  // tapping the line rotates on through the world languages, in an order freshly
  // shuffled each time we arrive at the empty state.
  const isEmpty = !(conv && thread && (thread.items.length > 0 || conv.pendingFirstMessage));
  const [rotation, setRotation] = useState(() => buildRotation());
  const [rotIdx, setRotIdx] = useState(0);
  // Crossfade layers: the last is the current word rising in; any earlier ones
  // are lifting out and drop themselves on animationend. Each carries a unique
  // id from this monotonic counter so a wrap back to the landing still remounts.
  const [layers, setLayers] = useState<{ id: number; g: Greeting }[]>(() => [
    { id: 0, g: rotation[0] },
  ]);
  const seq = useRef(0);
  // The session's first landing line rolls in on the swell (SwellText); every
  // later one, and every language tap, keeps the crossfade.
  const [landingSwellId, setLandingSwellId] = useState(() => (takeLandingSwell() ? 0 : -1));
  // Slack Water (components/SlackWater.tsx) lands the person here from the
  // setup walk: the greeting waits unseen under the paper while it holds
  // still, then lands on the swell as the paper clears (Creative Studio).
  const [heldUnderWater, setHeldUnderWater] = useState(false);
  // One-time discovery nudge, played on the first empty-state paint of the
  // session and never again.
  const [hint, setHint] = useState(true);
  const wasEmpty = useRef(true);

  // A second Easter egg on the same line: holding it down reveals the
  // language's English name in a small bubble, so the tap-through rotation
  // stays guessable without a label sitting there year-round. longPressFired
  // tracks whether the hold actually fired, so the pointerup's click doesn't
  // also rotate to the next language.
  const [langBubbleVisible, setLangBubbleVisible] = useState(false);
  const longPressFired = useRef(false);
  const longPressTimer = useRef<number | null>(null);
  const bubbleHideTimer = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
      if (bubbleHideTimer.current !== null) window.clearTimeout(bubbleHideTimer.current);
    };
  }, []);
  const startLangPress = () => {
    longPressFired.current = false;
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      hapticTick();
      setLangBubbleVisible(true);
      if (bubbleHideTimer.current !== null) window.clearTimeout(bubbleHideTimer.current);
      bubbleHideTimer.current = window.setTimeout(() => setLangBubbleVisible(false), 1400);
    }, 450);
  };
  const endLangPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  useEffect(() => {
    // Reshuffle and re-pick a fresh landing line only when we return to the
    // empty state from a conversation, so the first paint keeps its initial
    // rotation (no flash) and every fresh chat gets a new greeting and order.
    if (isEmpty && !wasEmpty.current) {
      const rot = buildRotation();
      setRotation(rot);
      setRotIdx(0);
      seq.current += 1;
      setLayers([{ id: seq.current, g: rot[0] }]);
      // Arrived on Slack Water: hold for the paper's still beat, then land
      // the line on the swell as the clear begins.
      if (useApp.getState().slackWater?.phase === 'clearing') {
        setHeldUnderWater(true);
        const t = window.setTimeout(
          () => {
            seq.current += 1;
            setLayers([{ id: seq.current, g: rot[0] }]);
            setLandingSwellId(seq.current);
            setHeldUnderWater(false);
          },
          durationMs('--dur-3', 220),
        );
        wasEmpty.current = isEmpty;
        return () => {
          window.clearTimeout(t);
          setHeldUnderWater(false);
        };
      }
    }
    wasEmpty.current = isEmpty;
  }, [isEmpty]);
  const greeting = rotation[rotIdx];

  // What the paired hub lets this device do (P0-1). The remote driver reads
  // it from /health at attach; a member device is never offered a shell.
  const [hubRole, setHubRole] = useState<HubRole | undefined>();
  const convId = conv?.id;
  const convSource = conv?.source;
  useEffect(() => {
    const driver = convId ? driverFor(convId) : undefined;
    const remote = driver as
      { hubRole?: HubRole; hubRoleReady?: Promise<HubRole | undefined> } | undefined;
    if (!remote?.hubRoleReady) {
      setHubRole(undefined);
      return;
    }
    let live = true;
    setHubRole(remote.hubRole);
    void remote.hubRoleReady.then((role) => {
      if (live) setHubRole(role);
    });
    return () => {
      live = false;
    };
  }, [convId, convSource]);

  const rotate = () => {
    const next = (rotIdx + 1) % rotation.length;
    seq.current += 1;
    setRotIdx(next);
    setLayers((ls) => [...ls, { id: seq.current, g: rotation[next] }]);
  };

  // The composer pill shows the live chat's brain when one is open, otherwise
  // the pending selection for the next new chat.
  const composerSource = conv ? conv.source : selectedSource;

  // The vault behind `[[` (Vault M5, CTO J15): the notes the privacy rules
  // let a model see, a body reader, the seat the next send goes to, and a
  // note "Ask about this note" is taking in. With Memory off there is no vault
  // in a chat, so the composer gets none and `[[` is plain text.
  const vaultOn = memoryOverride(settings) !== false;
  const vaultPickerNotes = useApp((s) => s.vaultPickerNotes);
  const composerVaultRead = useApp((s) => s.composerVaultRead);
  const composerSeat = useApp((s) => s.composerSeat);
  const composerInsert = useApp((s) => s.composerInsert);
  const takeComposerInsert = useApp((s) => s.takeComposerInsert);
  const [vaultNotes, setVaultNotes] = useState<PickerNote[] | undefined>(undefined);
  useEffect(() => {
    if (!vaultOn) {
      setVaultNotes(undefined);
      return;
    }
    let live = true;
    void vaultPickerNotes()
      .then((notes) => {
        if (!live) return;
        setVaultNotes(
          notes.map((n) => ({
            path: n.path,
            title: n.title,
            updatedAt: n.updatedAt,
            visibility: n.localOnly ? 'local-only' : 'open',
          })),
        );
      })
      .catch(() => {
        if (live) setVaultNotes([]);
      });
    return () => {
      live = false;
    };
    // A new chat, a new ask, or the switch turning on reads the list again.
  }, [vaultOn, activeId, composerInsert?.id, vaultPickerNotes]);
  const [vaultTake, setVaultTake] = useState<{ seq: number; path: string } | undefined>();
  useEffect(() => {
    if (!composerInsert || !vaultNotes) return;
    if (composerInsert.conversationId && composerInsert.conversationId !== activeId) return;
    const path = composerInsert.path;
    setVaultTake((t) => ({ seq: (t?.seq ?? 0) + 1, path }));
    takeComposerInsert(composerInsert.id);
  }, [composerInsert, vaultNotes, activeId, takeComposerInsert]);
  const composerVault: ComposerVault | undefined =
    vaultOn && vaultNotes
      ? {
          notes: vaultNotes,
          read: composerVaultRead,
          seat: composerSeat(conv?.id, composerSource),
          ...(vaultTake ? { take: vaultTake } : {}),
        }
      : undefined;
  // The pack card's note titles open the note when this device's vault holds
  // it (J9); a handoff note offers "Save to Vault" (J12).
  const vaultPackOpener = useApp((s) => s.vaultPackOpener);
  const saveHandoffToVault = useApp((s) => s.saveHandoffToVault);
  const openPackNote = conv ? vaultPackOpener(conv.id) : undefined;

  // A "My Stack" chat can read images when a capable model is placed in it, or
  // a connected cloud provider reads them; this lights the attach button there,
  // the same way it lights for a vision-capable cloud model.
  const stackVision = useApp((s) => s.stackVisionReady());

  const startWith = async (
    source: ConversationSource,
    text?: string,
    attachments?: Attachment[],
  ) => {
    const hasMessage = Boolean(text || (attachments && attachments.length));
    // The first message rides in on the new chat itself, so its bubble is on
    // screen at once, not after the model has loaded.
    const id = await newConversation(source, {
      repoIds: pendingRepoIds,
      ...(hasMessage ? { firstMessage: { text: text ?? '', attachments } } : {}),
    });
    // No new chat opened (the sign-in sheet or a paywall stood in the way):
    // the composer already cleared, so hand the message back rather than lose
    // it.
    if (hasMessage && !id) {
      setRestore((r) => restoreFromHeld({ text: text ?? '', attachments }, r));
    }
  };

  // Voice mode rides on an open chat (it subscribes to that chat's driver). From
  // the empty state, start a chat first on the chosen brain, so the first thing
  // said has somewhere to go; if the brain is not ready, send the person to the
  // chooser rather than opening a voice surface that cannot answer.
  const openVoice = async () => {
    if (!conv) {
      if (!sourceReady(selectedSource)) {
        setSheetStage('root');
        setSheetOpen(true);
        showToast('Pick where your answers come from, then start voice.');
        return;
      }
      await startWith(selectedSource);
    }
    setVoiceOpen(true);
  };

  // The model needs an on-screen decision (an approval, a spend): close voice and
  // remember to reopen it once the decision is answered. A plan revision and a
  // stopped-turn recovery deliberately hand you to the screen without a reopen,
  // since you are choosing to work there.
  const onVoiceBreakToScreen = (brk: VoiceBreak) => {
    setVoiceOpen(false);
    resumeVoice.current = brk.kind === 'approval-tool' || brk.kind === 'approval-spend';
  };

  return (
    <div className="shell-main">
      <header className="topbar" ref={headerRef}>
        {/* A chat opened from the Chats list is a sub-page of it, so the left
            slot is a way back to Chats (the iOS grammar), the same as the other
            rooms. A root chat (from the panel, or a fresh one) keeps the drawer
            menu. On the desktop the sidebar is beside the chat, so a root's slot
            stays empty. */}
        {backTo ? (
          <button
            className="icon-btn back-btn press-fb"
            onClick={() => {
              goBack();
            }}
            aria-label={`Back to ${backTo}`}
            title={`Back to ${backTo}`}
          >
            <span className="back-chevron" aria-hidden="true" />
            {!compact ? <span className="back-label">{backTo}</span> : null}
          </button>
        ) : compact ? (
          <button
            className="icon-btn menu-btn press-fb"
            onClick={() => {
              setDrawer(true);
            }}
            aria-label="Menu"
          >
            <MenuIcon />
          </button>
        ) : null}
        {conv ? (
          <div className="topbar-title">
            <button
              type="button"
              className="topbar-name press-fb"
              onClick={openRename}
              title="Rename this chat"
            >
              {conv.title}
            </button>
            <div className="topbar-sub">
              {/* The repo picker sits where the model name used to be (the
                  model still lives in the composer pill). A live session's
                  branch and dirty dot ride on the summary. */}
              <RepoPicker
                selected={conv.repoIds ?? []}
                onChange={(ids) => void setConversationRepos(conv.id, ids)}
                branch={thread?.repo?.branch}
                dirty={thread?.repo?.dirty}
                onOpenRepos={() => setView('repos')}
                workingIn={
                  conv.source.kind === 'desktop' && conv.source.sessionId
                    ? conv.source.cwd
                    : undefined
                }
                onNewChat={(ids) => void newConversation({ kind: 'desktop' }, { repoIds: ids })}
              />
              {thread && thread.dollars > 0 ? (
                <>
                  {' · '}
                  {/* Cloud spend so far: marked as spend, so it wears amber. */}
                  <span className="chat-spend spend" title="Cloud spend in this chat">
                    ${thread.dollars.toFixed(2)}
                  </span>
                </>
              ) : null}
              {thread && thread.contextPercent > 0 ? (
                <span
                  className={`ctx-bar${thread.contextPercent >= 75 ? ' warm' : ''}${thread.contextPercent >= 90 ? ' hot' : ''}`}
                  title={`Context ${thread.contextPercent}% full`}
                  aria-label={`Context ${thread.contextPercent} percent full`}
                >
                  <i style={{ transform: `scaleX(${Math.min(1, thread.contextPercent / 100)})` }} />
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="topbar-spacer topbar-spacer-repos">
            <RepoPicker
              selected={pendingRepoIds}
              onChange={setPendingRepoIds}
              onOpenRepos={() => setView('repos')}
            />
          </div>
        )}
        {/* Terminal entry, desktop-backed chats only: a real PTY on the desktop,
            reached over the daemon from the phone and over IPC in the desktop
            app. Non-desktop chats have no terminal, so it stays hidden. */}
        {conv && conv.source.kind === 'desktop' ? (
          <button
            className="icon-btn press-fb"
            onClick={() => setView('terminal')}
            aria-label="Open terminal"
            title="Terminal"
          >
            {'>_'}
          </button>
        ) : null}
        <ProfileStatus />
      </header>

      {offlineMounted ? (
        <div className={`offline-banner${offlineClosing ? ' closing' : ''}`} role="status">
          Offline. Local models still answer; your computer and the cloud wait for a connection.
        </div>
      ) : null}

      <div className="chat-body">
        {conv && thread && (thread.items.length > 0 || conv.pendingFirstMessage) ? (
          <MessageList
            thread={thread}
            // The message parked on this chat until its brain can take it (a
            // hub still opening, the sign-in sheet): a bubble that says it is
            // waiting, with the reason and a Retry when something went wrong.
            parked={
              conv.pendingFirstMessage
                ? { text: conv.pendingFirstMessage, error: conv.pendingFirstError }
                : undefined
            }
            onRetryParked={() => retryPending(conv.id)}
            rescueLabel={rescueLabel(rescueSourceFor(conv.id))}
            onRescue={() => void continueElsewhere()}
            onPickModel={() => {
              setSheetStage('root');
              setSheetOpen(true);
            }}
            onOpenConnections={() => setView('connections')}
            onSwitchToLocal={() => {
              setSheetStage('local');
              setSheetOpen(true);
            }}
            onRetry={retryLast}
            onUnqueue={unqueue}
            onApprovePlan={approvePlan}
            onRevisePlan={() => {
              revisePlan();
              setFocusSignal((n) => n + 1);
            }}
            onClarifyPick={(text) => send(text)}
            onTrustFolder={(itemId) => void trustProjectFolder(itemId)}
            onRestoreChanged={(itemId, direction, path) =>
              void restoreChangedFiles(itemId, direction, path)
            }
            rewindIds={rewindIds}
            onRewind={setRewindId}
            onDismissTrust={dismissProjectTrust}
            onGiveMoreRoom={(itemId) => void giveMoreRoom(itemId)}
            onOpenStack={() => setView('stack')}
            onOpenPackNote={openPackNote}
            onSaveHandoff={(itemId) => saveHandoffToVault(conv.id, itemId)}
            afterItem={(itemId) => {
              if (!conv) return null;
              // The guided setup's chat: the current step's buttons follow the
              // guide's latest message, and the wrap-up offers questions to ask.
              // Whichever model answers here: a person who switched to Harbor or
              // the Stack mid-walk is still in setup, and the model is told the
              // buttons are there.
              if (guided && guided.conversationId === conv.id) {
                // The "help me get set up" list keeps its buttons under its
                // own message while it is up, wherever the talk goes after it.
                if (guided.menu === 'asking' && !guided.paused) {
                  return itemId === guided.menuItemId ? <SetupMenuActions /> : null;
                }
                // Paused ("I'd rather just chat", or Start chatting at the fork):
                // no step buttons following the talk, just a quiet way back in,
                // up under the hello. Right after Start chatting, a few openers
                // sit under the guide's "Let's chat" so the first question is
                // one tap.
                if (guided.paused && walkActive(guided)) {
                  if (itemId === `${conv.id}-hello`) {
                    return (
                      <button
                        type="button"
                        className="btn quiet press-fb setup-resume"
                        onClick={resumeGuidedSetup}
                      >
                        Pick up setup
                      </button>
                    );
                  }
                  return guided.nextChoice === 'chat' &&
                    !thread?.busy &&
                    lastItemId === itemId &&
                    itemId.includes('-setup-') ? (
                    <MiniFirstMoves moves={ASK_ANYTHING} onPick={(text) => send(text)} />
                  ) : null;
                }
                // Never under the hello: in the letter's reading pause the hello
                // is briefly the latest message, and buttons there would flash
                // up, then jump down to the setup message once it starts.
                if (thread?.busy || itemId !== lastAssistantId) return null;
                if (itemId === `${conv.id}-hello`) return null;
                if (guided.startChoice === 'asking') return <StartChoiceActions />;
                if (guided.editChoice === 'asking') return <EditChoiceActions />;
                if (guided.nextChoice === 'asking') return <NextChoiceActions />;
                if (guided.current && !guided.finished) {
                  return <SetupStepActions step={guided.current} />;
                }
                return lastItemId === itemId && itemId.includes('-setup-') ? (
                  <MiniFirstMoves moves={ASK_ANYTHING} onPick={(text) => send(text)} />
                ) : null;
              }
              // Any other Harbor Lite chat: the door to the setup page.
              if (conv.source.kind !== 'device' || conv.source.modelId !== HARBOR_MINI_MODEL_ID) {
                return null;
              }
              return itemId === `${conv.id}-hello` ? (
                <GuideSetupLink onOpen={() => setView('onboarding')} />
              ) : null;
            }}
          />
        ) : resuming ? (
          <ResumeSkeleton count={conv?.lastItemCount} />
        ) : (
          // The First Seat owns the empty room until a brain on this device can
          // answer; the moment one is ready it hands back to the greeting, which
          // is its fallback. It reads readiness from the store, so it never
          // guesses. See components/FirstSeat.tsx ("The Seat Fills").
          <FirstSeat
            fallback={
              <div className={`greeting${heldUnderWater ? ' held' : ''}`}>
                <BrandMark size={40} />
                {/* A heading that stays a heading for assistive tech, with a real
                    button inside for the tap and the keyboard (Enter and Space
                    click a button natively, so no key handler is needed). */}
                <h1 className="greeting-heading">
                  <button
                    type="button"
                    className="greeting-line press-fb"
                    dir="auto"
                    lang={greeting.code}
                    aria-label={greeting.english}
                    onClick={() => {
                      if (longPressFired.current) {
                        longPressFired.current = false;
                        return;
                      }
                      rotate();
                    }}
                    onPointerDown={startLangPress}
                    onPointerUp={endLangPress}
                    onPointerLeave={endLangPress}
                    onPointerCancel={endLangPress}
                  >
                    <span
                      className={`greeting-swap-stack${hint ? ' greeting-hint' : ''}`}
                      onAnimationEnd={(e) => {
                        if (e.animationName === 'greet-hint') setHint(false);
                      }}
                    >
                      {layers.map((layer, i) => {
                        const current = i === layers.length - 1;
                        return (
                          <span
                            key={layer.id}
                            className={
                              current
                                ? `greeting-swap${layer.id === landingSwellId ? ' greeting-swap-swell' : ''}`
                                : 'greeting-swap greeting-swap-out'
                            }
                            onAnimationEnd={
                              current
                                ? undefined
                                : (e) => {
                                    if (e.animationName === 'greet-swap-out')
                                      setLayers((ls) => ls.filter((l) => l.id !== layer.id));
                                  }
                            }
                          >
                            {layer.id === landingSwellId ? (
                              <SwellText text={layer.g.native} pace={LANDING_PACE} />
                            ) : (
                              layer.g.native
                            )}
                          </span>
                        );
                      })}
                    </span>
                    <span
                      className={`greeting-lang-bubble${langBubbleVisible ? ' greeting-lang-bubble-visible' : ''}`}
                      aria-hidden={!langBubbleVisible}
                    >
                      {greeting.lang}
                    </span>
                  </button>
                </h1>
              </div>
            }
            // "Edit" on the saved line (CX cleanup 8): the words go back into
            // the composer through the same restore a dismissed chooser uses,
            // with no toast; the download keeps going, and Send saves again.
            onEditHeld={() => {
              const held = takeHeldFirstMessage();
              if (held) setRestore((r) => restoreFromHeld(held, r));
            }}
          />
        )}

        {/* First Moves: on a fresh Harbor Lite chat (just the seeded greeting, not
            yet busy), offer tappable openers so a new person is never staring at
            a blank box. They vanish the moment a first message is sent. */}
        {conv &&
        thread &&
        !thread.busy &&
        conv.source.kind === 'device' &&
        conv.source.modelId === HARBOR_MINI_MODEL_ID &&
        thread.items.length === 1 &&
        thread.items[0].kind === 'assistant' ? (
          <MiniFirstMoves onPick={(text) => send(text)} />
        ) : null}

        {/* The first try (v1 Phase 1): on a fresh desktop chat with a model
            ready and no folder picked, one row opens the sample page and asks
            for its fix, so a first-time person sees the whole loop. */}
        {isDesktop() &&
        isEmpty &&
        !resuming &&
        sourceReady({ kind: 'desktop' }) &&
        !(conv?.source.kind === 'desktop' && conv.source.cwd) ? (
          <div className="first-moves" role="group" aria-label="Try OpenShore">
            <button
              type="button"
              className="first-move press-fb"
              title={SAMPLE_ROW_SUB}
              onClick={() => void trySampleProject()}
            >
              {SAMPLE_ROW_LABEL}
            </button>
          </div>
        ) : null}

        {thread && thread.todos.length > 0 && thread.items.length > 0 ? (
          <TodoCard todos={thread.todos} />
        ) : null}

        <Composer
          busy={Boolean(thread?.busy)}
          source={composerSource}
          visionSupported={
            sourceSupportsVision(composerSource) || (composerSource.kind === 'stack' && stackVision)
          }
          placeholder={
            conv?.source.kind === 'device' && conv.source.modelId === HARBOR_MINI_MODEL_ID
              ? HARBOR_MINI_EMPTY_HINT
              : undefined
          }
          autoFocus={isEmpty && booted}
          focusSignal={focusSignal}
          restore={restore}
          agent={agent}
          history={history}
          hubRole={hubRole}
          onCommand={onCommand}
          repoCommands={
            thread?.repo
              ? { commands: thread.repo.commands, notLoaded: thread.repo.commandsNotLoaded }
              : undefined
          }
          onRewind={!isPhone() && lastRewindId ? () => setRewindId(lastRewindId) : undefined}
          onOpenModelSheet={() => {
            setSheetStage('root');
            setSheetOpen(true);
          }}
          onOpenModeSheet={() => setModeSheetOpen(true)}
          onOpenVoice={() => void openVoice()}
          onSend={(text, attachments) => {
            if (!conv) {
              // "Help me get set up" needs no model: the setup list answers it
              // in a new chat, even before any brain on this device can (the
              // same "stack" home the guides open on when none can).
              if (!attachments?.length && setupHelpIntent(text)) {
                void startWith(
                  sourceReady(selectedSource) ? selectedSource : { kind: 'stack' },
                  text,
                );
                return;
              }
              // Never start a chat on a brain that cannot answer yet. Hold the
              // message and open the model sheet as a chooser (download a model,
              // connect your computer, or add a cloud key); the pick sends it.
              if (!sourceReady(selectedSource)) {
                // On the desktop with nothing set up, the First Seat is the
                // one way on: the message waits there, says so, and goes out
                // once DeepBlue is ready (CX ruling 2).
                if (sendWaitsOnFirstSeat()) {
                  void holdUntilReady(text, attachments);
                  return;
                }
                void holdFirstMessage(text, attachments);
                chooserHolds.current = true;
                setSheetStage('root');
                setSheetOpen(true);
                showToast('Pick where your first answer comes from, then this sends.');
                return;
              }
              void startWith(selectedSource, text, attachments);
              return;
            }
            send(text, attachments);
          }}
          onStop={abort}
          vault={composerVault}
        />
      </div>

      {approval && thread ? (
        <ApprovalSheet
          request={approval}
          index={0}
          total={thread.pendingApprovals.length}
          agent={agent}
          mode={mode}
          onAnswer={(approve, always, inProject, files) =>
            answerApproval(approval.id, approve, always, { inProject, files })
          }
          onAnswerAll={answerAllApprovals}
          onOpenMode={() => setModeSheetOpen(true)}
        />
      ) : null}

      <Sheet open={renameOpen} onClose={() => setRenameOpen(false)} variant="confirm">
        <h3>Name this chat</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (conv && renameDraft.trim()) {
              void renameConversation(conv.id, renameDraft);
            }
            setRenameOpen(false);
          }}
        >
          <div className="field">
            <input
              autoFocus
              aria-label="Chat name"
              value={renameDraft}
              maxLength={80}
              placeholder="A short name"
              onChange={(e) => setRenameDraft(e.target.value)}
            />
          </div>
          <div className="confirm-row">
            <button type="button" className="btn ghost" onClick={() => setRenameOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={!renameDraft.trim()}>
              Save
            </button>
          </div>
        </form>
      </Sheet>

      {sheetOpen ? (
        <ModelSheet
          initialStage={sheetStage}
          onPick={(source) => {
            setPickedSource(source);
            setSheetOpen(false);
            chooserHolds.current = false;
            // With a chat open, switch its model in place and carry the thread
            // (Claude-style). With none open, this just sets the brain the next
            // send will use.
            if (conv) {
              void switchModel(source);
              return;
            }
            // A held first message: send it now that a working brain is chosen.
            // If the pick still cannot answer (rare), never dead-end into a
            // broken chat.
            const held = takeHeldFirstMessage();
            if (!held) return;
            if (sourceReady(source)) {
              void startWith(source, held.text, held.attachments);
            } else {
              // The sheet is closing: hand the message back to the field, the
              // way a dismiss does, so it is never stranded and never sent
              // stale by a later pick.
              setRestore((r) => restoreFromHeld(held, r));
              showToast('That one is not ready yet. Your message is back in the box.');
            }
          }}
          onClose={() => {
            setSheetOpen(false);
            if (!chooserHolds.current) return;
            chooserHolds.current = false;
            // A jump to a setup room keeps the message held in the store, and
            // it comes back into the composer when this screen does. A dismiss
            // hands it back to the field now, so a later pick never sends
            // stale text and nothing typed is lost.
            if (useApp.getState().view !== 'chat') return;
            const held = takeHeldFirstMessage();
            if (!held) return;
            setRestore((r) => restoreFromHeld(held, r));
            showToast(HELD_MESSAGE_KEPT);
          }}
        />
      ) : null}

      {modeSheetOpen ? <ModeSheet onClose={() => setModeSheetOpen(false)} /> : null}

      <RewindSheet
        open={Boolean(rewindText)}
        files={Boolean(
          conv && thread && rewindId && rewindOffersFiles(thread, rewindId, conv.source),
        )}
        onClose={() => setRewindId(undefined)}
        onChoose={async (files) => {
          if (!rewindId) return undefined;
          const result = await rewindTo(rewindId, { files });
          if ('error' in result) return result.error;
          // The rewound message goes back into the composer, to change or send.
          setRewindId(undefined);
          setRestore((r) => restoreFromHeld({ text: result.text }, r));
          return undefined;
        }}
        onCopy={
          isPhone() && rewindText
            ? () => {
                const text = rewindText;
                setRewindId(undefined);
                void copyText(text).then((ok) =>
                  showToast(ok ? 'Copied your message.' : 'Could not copy that. Try again.'),
                );
              }
            : undefined
        }
      />

      <VoiceMode
        open={voiceOpen}
        onClose={() => {
          setVoiceOpen(false);
          resumeVoice.current = false;
        }}
        conversationId={activeId}
        send={(text) => send(text)}
        approvePlan={approvePlan}
        revisePlan={() => {
          revisePlan();
          setFocusSignal((n) => n + 1);
        }}
        onBreakToScreen={onVoiceBreakToScreen}
      />
    </div>
  );
}
