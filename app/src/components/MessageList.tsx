// The transcript: user bubbles, assistant prose that arrives a few words at a
// time, each group fading up from light to full ink the way Claude's does, the
// model's folded reasoning, tool cards, the plan card, the
// changed-files record, quiet status lines, and citations at the end. A
// working row fills the gap between a send and the first token, and a quiet
// "back to latest" chip offers the way back when the person has scrolled up.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useExitPresence } from '../hooks/useExitPresence.js';
import type { ThreadState } from '../state/types.js';
import { useSmoothedReveal } from '../hooks/useSmoothedReveal.js';
import {
  REVEAL_SKIP_EVENT,
  WORD_FADE_MS,
  prefersReducedMotion,
  skipReveals,
} from '../lib/streamSmoothing.js';
import { PACES, inkPlan, type PacedKind } from '../lib/introWalk.js';
import { restampForSkip, type InkStamp } from '../lib/inkSwell.js';
import { hapticCommit, hapticTick } from '../lib/haptics.js';
import { offersLocalFallback } from '../lib/usageFallback.js';
import { isFailedStop, isSetupFailure, pointsAtConnections } from '../lib/chatRescue.js';
import { Markdown } from './Markdown.js';
import { ToolCard } from './ToolCard.js';
import { CommandCard } from './CommandCard.js';
import { WorkingRow } from './WorkingRow.js';
import { ThinkingBlock } from './ThinkingBlock.js';
import { PlanCard } from './PlanCard.js';
import { TrustCard } from './TrustCard.js';
import { WindowCutCard } from './WindowCutCard.js';
import { ClarifyCard } from './ClarifyCard.js';
import { ChangedFilesCard } from './ChangedFilesCard.js';
import { VerifyPill } from './VerifyPill.js';
import { ContextPackCard } from './ContextPackCard.js';
import { RetrievalCard } from './RetrievalCard.js';
import { taskVerdict, verifyAnchor } from '../state/harnessOps.js';
import { Icon } from './Icon.js';
import { Keyboard } from '@capacitor/keyboard';
import { isPhone } from '../lib/platform.js';
import { REWIND_ACTION } from '../state/rewindOps.js';

/** The quiet line under a parked message while it waits to go. */
export const PARKED_WAITING = 'Waiting to send';

/** How far a downward drag on the transcript travels before the keyboard goes:
 *  past a tap's wobble, well short of a real scroll. */
const DISMISS_DRAG_PX = 16;

/** How long a still finger holds the person's own message before its rewind
 *  opens (the phone's way in, P2): the same hold a chat row takes. */
const HOLD_MS = 480;
/** Movement past this is a scroll starting, not a hold. */
const HOLD_SLOP = 8;

/**
 * The person's own message, when the chat can rewind to it (P2). On the
 * desktop a quiet round action sits beside the bubble and shows on hover or
 * keyboard focus; on the phone, where nothing hovers, a still hold on the
 * bubble opens the same choice with a tick. The bubble eases down while the
 * finger holds, so the touch is answered before the sheet rises.
 */
function RewindableMessage({ text, onRewind }: { text: string; onRewind: () => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const stopTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stopTimer, []);
  const letGo = () => {
    stopTimer();
    start.current = null;
    setHolding(false);
  };
  const onPointerDown = (e: ReactPointerEvent) => {
    // A mouse has the hover action; a hold is for a finger (or a pen).
    if (e.pointerType === 'mouse') return;
    stopTimer();
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      start.current = null;
      setHolding(false);
      hapticTick();
      onRewind();
    }, HOLD_MS);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const from = start.current;
    if (!from || from.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > HOLD_SLOP) letGo();
  };
  return (
    <div className="msg-user-turn">
      <button
        type="button"
        className="msg-rewind press-fb"
        aria-label={REWIND_ACTION}
        title={REWIND_ACTION}
        onClick={onRewind}
      >
        <Icon size={16}>
          <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" />
          <path d="M3.5 3.5v5h5" />
        </Icon>
      </button>
      <div
        className={`msg-user rewindable${holding ? ' holding' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={letGo}
        onPointerCancel={letGo}
        onPointerLeave={letGo}
      >
        {text}
      </div>
    </div>
  );
}

/** Jump to the foot with no animation. The thread's CSS smooth scroll would
 *  otherwise animate every follow, so streaming text trails below the fold. */
function followBottom(el: HTMLElement): void {
  el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
}

function AssistantBubble({
  text,
  streaming,
  model,
  showModel,
  onReveal,
  after,
  paced,
}: {
  text: string;
  streaming: boolean;
  model?: string;
  showModel: boolean;
  /** Called as revealed text grows, so a pinned thread follows the typing. */
  onReveal?: () => void;
  /** What follows the message (a guided step's buttons, a way back in). It
   *  arrives only once the words have finished arriving, never over them. */
  after?: ReactNode;
  /** A scripted guide message that writes itself (lib/introWalk.ts). */
  paced?: PacedKind;
}) {
  const { text: shown, settling } = useSmoothedReveal(text, streaming && !paced);
  const ink = useInkSwell(text, streaming, paced);
  // Fires once per bubble mount, i.e. right as its first token lands. A
  // scripted letter stays quiet: the first open should not buzz.
  useEffect(() => {
    if (streaming && !paced) hapticTick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    onReveal?.();
  }, [shown.length, onReveal]);
  // No caret: like Claude, the arrival itself is the signal. Words stay split
  // into fading spans while any text is on its way, and for one fade after the
  // last word lands (so the tail finishes its fade instead of popping to ink).
  // A settled reply renders plain. A scripted letter rolls in on the swell
  // instead, laid out whole from the first frame.
  const live = paced ? Boolean(ink) : streaming || settling;
  const { mounted: fading } = useExitPresence(live && !paced, WORD_FADE_MS);
  // A letter rolling in is read whole by VoiceOver, once, never letter by
  // letter: the full text sits in a hidden node and the swelling layer is
  // hidden.
  const writing = Boolean(ink);
  const bubble = (
    <div className="msg-assistant">
      {showModel && model ? <div className="msg-model">{model}</div> : null}
      {writing ? <div className="visually-hidden">{text}</div> : null}
      {paced ? (
        // A stable wrapper for letters only, so flipping aria-hidden never
        // remounts the characters mid-swell.
        <div aria-hidden={writing || undefined}>
          <Markdown text={text} ink={ink && paced ? { stamp: ink, kind: paced } : undefined} />
        </div>
      ) : (
        <Markdown text={shown} streaming={live} fade={fading} actions />
      )}
    </div>
  );
  // What follows waits until the words have fully arrived.
  return after && !live ? (
    <>
      {bubble}
      {after}
    </>
  ) : (
    bubble
  );
}

/** A scripted line's swell (lib/inkSwell.ts): the ink stamp while it rolls in,
 *  null once it has settled (or when it mounted settled, or under reduced
 *  motion). A tap or keystroke (skipReveals) finishes it: characters already
 *  swelling carry on, the rest arrive flat within a fifth of a second. */
function useInkSwell(text: string, streaming: boolean, paced?: PacedKind): InkStamp | null {
  const [stamp, setStamp] = useState<InkStamp | null>(() =>
    paced && streaming && !prefersReducedMotion()
      ? { delays: inkPlan(text, PACES[paced]).delays }
      : null,
  );
  const started = useRef(0);
  const rolling = stamp !== null;
  useEffect(() => {
    if (!rolling || !paced) return;
    started.current = performance.now();
    let timer = window.setTimeout(() => setStamp(null), inkPlan(text, PACES[paced]).totalMs);
    const skip = () => {
      const now = performance.now() - started.current;
      setStamp((cur) => (cur ? restampForSkip(cur.delays, now, SKIP_SPREAD_MS) : cur));
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setStamp(null), SKIP_SPREAD_MS + FLAT_MS);
      window.removeEventListener(REVEAL_SKIP_EVENT, skip);
    };
    window.addEventListener(REVEAL_SKIP_EVENT, skip);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(REVEAL_SKIP_EVENT, skip);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolling]);
  return stamp;
}

/** The skip's finish: the rest spread over this long, each arriving flat over
 *  `--dur-3` (FLAT_MS mirrors it), so the whole thing lands inside `--dur-6`. */
const SKIP_SPREAD_MS = 200;
const FLAT_MS = 220;

/** A stopped turn that a retry could plausibly fix: anything but the
 *  person's own stop or a declined step. */
const retryable = isFailedStop;

/** A switch's note with its handoff (Vault M5, CTO J12): "Save to Vault"
 *  under it writes the handoff as a note in Handoffs, once; saved, the row
 *  says where it went. */
function HandoffNote({
  text,
  savedPath,
  onSave,
}: {
  text: string;
  savedPath?: string;
  onSave: () => Promise<string | undefined>;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <div className="msg-note">
      {text}
      <div className="msg-note-actions">
        {savedPath ? (
          <span className="msg-note-saved" role="status">
            Saved to Vault as {savedPath}
          </span>
        ) : (
          <button
            type="button"
            className="linklike press-fb"
            disabled={saving}
            onClick={() => {
              hapticCommit();
              setSaving(true);
              void onSave().finally(() => setSaving(false));
            }}
          >
            {saving ? 'Saving to Vault' : 'Save to Vault'}
          </button>
        )}
      </div>
    </div>
  );
}

export function MessageList({
  thread,
  rescueLabel,
  onRescue,
  onPickModel,
  onOpenConnections,
  onSwitchToLocal,
  onRetry,
  onApprovePlan,
  onRevisePlan,
  onClarifyPick,
  onTrustFolder,
  onRestoreChanged,
  rewindIds,
  onRewind,
  onDismissTrust,
  onGiveMoreRoom,
  onOpenStack,
  onUnqueue,
  onOpenPackNote,
  onSaveHandoff,
  afterItem,
  parked,
  onRetryParked,
}: {
  thread: ThreadState;
  /** No dead ends: the brain a failed turn can continue on ("Harbor Lite"),
   *  and the tap that carries the chat there and sends the message again. */
  rescueLabel?: string;
  onRescue?: () => void;
  /** Open the model picker, the way on when nothing else here can answer. */
  onPickModel?: () => void;
  /** Open Cloud Connections, offered when the stop's fix lives there. */
  onOpenConnections?: () => void;
  /** Open the Local LLMs sheet, offered when a turn stopped for no account usage. */
  onSwitchToLocal?: () => void;
  /** Resend the last message after an error. */
  onRetry?: () => void;
  onApprovePlan?: () => void;
  onRevisePlan?: () => void;
  /** The trust card's two answers, by item id. */
  onTrustFolder?: (itemId: string) => void;
  /** Undo or redo a task's changes (every file, or one). */
  onRestoreChanged?: (itemId: string, direction: 'undo' | 'redo', path?: string) => void;
  /** The person's own messages this chat can rewind to right now (P2). */
  rewindIds?: readonly string[];
  /** "Rewind to here" on one of them: opens the choice (the hover action on
   *  the desktop, a long press on the phone). */
  onRewind?: (itemId: string) => void;
  onDismissTrust?: (itemId: string) => void;
  /** The truncation card's "Give it more room", by item id. */
  onGiveMoreRoom?: (itemId: string) => void;
  /** Open the Stack room (the truncation card, with no memory to spare). */
  onOpenStack?: () => void;
  /** Answer a clarifying question (the plan-first picker): sends the reply. */
  onClarifyPick?: (text: string) => void;
  /** Drop a queued message (tap on its bubble). */
  onUnqueue?: (index: number) => void;
  /** The message parked on the chat until its brain can take it (a hub
   *  still opening, the sign-in sheet): its text, and why it has not gone
   *  when something went wrong. It stays until it goes out. */
  parked?: { text: string; error?: string };
  /** Try the parked message again (offered beside its reason). */
  onRetryParked?: () => void;
  /** Open a note the vault context card names, when this device's vault
   *  holds it (the store's `vaultPackOpener`). Absent keeps titles plain. */
  onOpenPackNote?: (path: string) => void;
  /** "Save to Vault" under a switch's handoff note (J12): the person's own
   *  one-tap write, resolving to the note's path once saved. */
  onSaveHandoff?: (itemId: string) => Promise<string | undefined>;
  /** Extra content rendered right under one assistant message, keyed by its
   *  id: Harbor Lite's greeting carries the setup button this way. */
  afterItem?: (id: string) => ReactNode;
}) {
  const threadRef = useRef<HTMLDivElement>(null);
  const rewindable = new Set(rewindIds ?? []);
  const pinnedRef = useRef(true);
  const prevCount = useRef(0);
  const [unseen, setUnseen] = useState(0);
  // True once the reader has scrolled up a meaningful distance from the foot,
  // so the jump pill offers a way back down even on an already-finished reply
  // with nothing new below. Distinct from unseen (which counts messages that
  // landed while scrolled up): either one shows the pill.
  const [scrolledUp, setScrolledUp] = useState(false);
  const itemCount = thread.items.length;
  const lastItem = thread.items[itemCount - 1];
  const streamingLen =
    lastItem &&
    (lastItem.kind === 'assistant' || lastItem.kind === 'thinking') &&
    lastItem.streaming
      ? lastItem.text.length
      : 0;

  // Track whether the user is pinned to the bottom, so streaming tokens do not
  // yank them back when they have scrolled up to reread (the iMessage rule).
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const pinned = distanceFromBottom < 48;
      pinnedRef.current = pinned;
      if (pinned) setUnseen(0);
      // The chip earns its place once the latest is a real distance off: half a
      // screen, never less than 240px. Reading a long reply a paragraph at a
      // time is not being lost, so it stays out of the way until you are.
      setScrolledUp(distanceFromBottom > Math.max(240, el.clientHeight * 0.5));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Stay on the latest when the room around the thread changes: the keyboard
  // rising, the field growing a line, chips or the todo card arriving all
  // shrink the thread without a scroll event, which would slide the last reply
  // under the composer. A pinned reader stays pinned.
  useEffect(() => {
    const el = threadRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current) followBottom(el);
    });
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);

  // Pull the transcript down to read back, and the keyboard goes away, the way
  // the Claude app and Messages do (founder, 2026-09-25): scrolling up means
  // skimming, and a tap on the chat box calls the keyboard back. A clear
  // downward drag, once per gesture, only while the keyboard is up. Blur alone
  // is not reliable in the iOS web view, so the plugin is told to hide too.
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    let startY: number | undefined;
    const onStart = (e: TouchEvent) => {
      startY = e.touches[0]?.clientY;
    };
    const onMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      if (startY === undefined || y === undefined || y - startY < DISMISS_DRAG_PX) return;
      startY = undefined;
      const active = document.activeElement;
      const typing = active instanceof HTMLTextAreaElement && Boolean(active.closest('.composer'));
      if (!typing && !document.documentElement.classList.contains('kb-open')) return;
      if (typing) (active as HTMLTextAreaElement).blur();
      if (isPhone()) void Keyboard.hide().catch(() => {});
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
    };
  }, []);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    // A new user turn always scrolls to the bottom (and re-pins); otherwise
    // only follow streaming when already pinned. Scroll instantly so the
    // container's smooth scroll-behavior never chases the growing text.
    const grew = itemCount > prevCount.current;
    const newUserTurn = grew && lastItem?.kind === 'user';
    prevCount.current = itemCount;
    if (newUserTurn) pinnedRef.current = true;
    if (pinnedRef.current) {
      followBottom(el);
    } else if (grew) {
      setUnseen((n) => n + 1);
    }
  }, [itemCount, streamingLen, lastItem?.kind]);

  // The reveal keeps typing after the stream ends, so a pinned thread follows
  // the revealed text, not only the incoming deltas.
  const followReveal = useCallback(() => {
    const el = threadRef.current;
    if (el && pinnedRef.current) followBottom(el);
  }, []);

  const jumpToBottom = () => {
    const el = threadRef.current;
    if (!el) return;
    hapticTick();
    pinnedRef.current = true;
    setUnseen(0);
    setScrolledUp(false);
    el.scrollTo({ top: el.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  // The working row shows while busy and nothing is visibly streaming.
  const streamingNow =
    Boolean(lastItem) &&
    (lastItem!.kind === 'assistant' || lastItem!.kind === 'thinking') &&
    lastItem!.streaming;
  const showWorking = thread.busy && !streamingNow && thread.pendingApprovals.length === 0;
  // The row eases out rather than vanishing. When the reply is what ended it,
  // the exit plays over the arriving first line (`seam`), so the wave and the
  // word dissolve into the text on the same spot instead of leaving a hole.
  const { mounted: workingMounted, closing: workingClosing } = useExitPresence(showWorking, 300);
  const workingSeam = workingClosing && streamingNow;
  // The exit holds whatever the row was saying when the reply arrived. The
  // first token flips the note to "Writing" in the same reduce that ends the
  // row, and the exit class lands a render later, so the note is frozen here,
  // on the synchronous signal, not in the row.
  const heldNote = useRef(thread.stepNote);
  if (showWorking) heldNote.current = thread.stepNote;

  let lastModel: string | undefined;

  // The pill shows either because messages arrived while scrolled up (unseen)
  // or simply because the reader has scrolled up and may want back down. It
  // plays an exit; its count is held while it fades, and reads zero when it is
  // only a jump affordance (no unseen messages), which renders as a bare arrow.
  const pillVisible = unseen > 0 || scrolledUp;
  const { mounted: pillMounted, closing: pillClosing } = useExitPresence(pillVisible, 240);
  const heldUnseen = useRef(0);
  if (pillVisible) heldUnseen.current = unseen;

  return (
    // A tap anywhere in the transcript finishes any typing still under way
    // (lib/streamSmoothing.ts skipReveals): the reader sets the pace.
    <div className="thread" ref={threadRef} onClick={skipReveals}>
      <div className="thread-inner">
        {thread.items.map((item, index) => {
          switch (item.kind) {
            case 'user':
              return onRewind && rewindable.has(item.id) ? (
                <RewindableMessage
                  key={item.id}
                  text={item.text}
                  onRewind={() => onRewind(item.id)}
                />
              ) : (
                <div key={item.id} className="msg-user">
                  {item.text}
                </div>
              );
            case 'assistant': {
              const showModel = Boolean(item.model && item.model !== lastModel);
              if (item.model) lastModel = item.model;
              return (
                <AssistantBubble
                  key={item.id}
                  text={item.text}
                  streaming={item.streaming}
                  model={item.model}
                  showModel={showModel}
                  onReveal={followReveal}
                  after={afterItem?.(item.id)}
                  paced={item.paced}
                />
              );
            }
            case 'thinking':
              return (
                <ThinkingBlock
                  key={item.id}
                  text={item.text}
                  streaming={item.streaming}
                  startedAt={item.startedAt}
                  endedAt={item.endedAt}
                />
              );
            case 'plan':
              return (
                <PlanCard
                  key={item.id}
                  text={item.text}
                  status={item.status}
                  onApprove={() => onApprovePlan?.()}
                  onRevise={() => onRevisePlan?.()}
                />
              );
            case 'clarify':
              return (
                <ClarifyCard
                  key={item.id}
                  summary={item.summary}
                  questions={item.questions}
                  onPick={onClarifyPick}
                />
              );
            case 'trust':
              return (
                <TrustCard
                  key={item.id}
                  waiting={item.waiting}
                  state={item.state}
                  error={item.error}
                  onTrust={() => onTrustFolder?.(item.id)}
                  onDismiss={() => onDismissTrust?.(item.id)}
                />
              );
            case 'window-cut':
              return (
                <WindowCutCard
                  key={item.id}
                  item={item}
                  onGiveMoreRoom={() => onGiveMoreRoom?.(item.id)}
                  onOpenStack={onOpenStack}
                />
              );
            case 'verify':
              return (
                <VerifyPill
                  key={item.id}
                  anchor={verifyAnchor(item.id)}
                  passed={item.passed}
                  check={item.check}
                  summary={item.summary}
                  detail={item.detail}
                  retrying={item.retrying}
                />
              );
            case 'changed':
              return (
                <ChangedFilesCard
                  key={item.id}
                  files={item.files}
                  checkpointId={item.checkpointId}
                  undone={item.undone}
                  restoring={item.restoring}
                  error={item.error}
                  ranCommands={item.ranCommands}
                  verdict={taskVerdict(thread.items, index)}
                  onRestore={
                    onRestoreChanged
                      ? (direction, path) => onRestoreChanged(item.id, direction, path)
                      : undefined
                  }
                />
              );
            case 'context-pack':
              return <ContextPackCard key={item.id} item={item} onOpen={onOpenPackNote} />;
            case 'retrieval':
              return <RetrievalCard key={item.id} item={item} />;
            case 'tool':
              return <ToolCard key={item.id} item={item} />;
            case 'command':
              return <CommandCard key={item.id} item={item} />;
            case 'status':
              return (
                <div key={item.id} className="msg-status">
                  {item.text}
                </div>
              );
            case 'note':
              return item.handoff && onSaveHandoff ? (
                <HandoffNote
                  key={item.id}
                  text={item.text}
                  savedPath={item.handoff.savedPath}
                  onSave={() => onSaveHandoff(item.id)}
                />
              ) : (
                <div key={item.id} className="msg-note">
                  {item.text}
                </div>
              );
            case 'stopped': {
              // The person's own Stop: a quiet marker, nothing to rescue.
              if (item.byYou) {
                return (
                  <div key={item.id} className="msg-stopped msg-stopped-own" role="status">
                    {item.message}
                  </div>
                );
              }
              // Only the last stop offers to move the chat on; an older one
              // already has what came after it.
              const isLatest =
                !thread.busy && thread.items[thread.items.length - 1]?.id === item.id;
              return (
                <div key={item.id} className="msg-stopped">
                  {item.message}
                  <div className="msg-stopped-actions">
                    {/* Every failed turn leaves a way to keep talking: carry the
                        chat to a brain that can answer, or pick one. */}
                    {isFailedStop(item.message) && isLatest && onRescue && rescueLabel ? (
                      <button
                        type="button"
                        className="msg-stopped-action press-fb"
                        onClick={onRescue}
                      >
                        Continue with {rescueLabel}
                      </button>
                    ) : isFailedStop(item.message) &&
                      isLatest &&
                      onPickModel &&
                      !(onSwitchToLocal && offersLocalFallback(item.message)) ? (
                      <button
                        type="button"
                        className="msg-stopped-action press-fb"
                        onClick={onPickModel}
                      >
                        Choose another model
                      </button>
                    ) : null}
                    {onOpenConnections && pointsAtConnections(item.message) ? (
                      <button
                        type="button"
                        className="msg-stopped-action ghost press-fb"
                        onClick={onOpenConnections}
                      >
                        Open Cloud Connections
                      </button>
                    ) : null}
                    {!onRescue && onSwitchToLocal && offersLocalFallback(item.message) ? (
                      <button
                        type="button"
                        className="msg-stopped-action press-fb"
                        onClick={onSwitchToLocal}
                      >
                        Switch to a local model
                      </button>
                    ) : null}
                    {onRetry &&
                    retryable(item.message) &&
                    !isSetupFailure(item.message) &&
                    !thread.busy ? (
                      <button
                        type="button"
                        className="msg-stopped-action ghost press-fb"
                        onClick={() => {
                          onRetry();
                        }}
                      >
                        Try again
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            }
          }
        })}
        {parked ? (
          <div className="msg-parked">
            <div className="msg-user parked">
              {parked.text}
              <span className="msg-parked-tag" role="status">
                {parked.error ?? PARKED_WAITING}
              </span>
            </div>
            {parked.error && onRetryParked ? (
              <button
                type="button"
                className="msg-stopped-action ghost press-fb"
                onClick={onRetryParked}
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
        {thread.queued.map((text, i) => (
          <button
            key={`q${i}`}
            type="button"
            className="msg-user queued press-fb"
            aria-label="Queued message. Tap to remove it."
            onClick={() => {
              onUnqueue?.(i);
            }}
          >
            {text}
            <span className="msg-queued-tag">queued · tap to remove</span>
          </button>
        ))}
        {workingMounted ? (
          <div className={`working-slot${workingSeam ? ' seam' : ''}`}>
            <WorkingRow since={thread.busySince} note={heldNote.current} closing={workingClosing} />
          </div>
        ) : null}
        {!thread.busy && thread.citations.length > 0 ? (
          <div className="citations">
            <div className="citations-title">Sources</div>
            {thread.citations.slice(0, 8).map((c) => (
              <a key={c.url} href={c.url} target="_blank" rel="noreferrer">
                {c.title || c.url}
              </a>
            ))}
          </div>
        ) : null}
      </div>
      {pillMounted ? (
        // The thread is its own scroller, so an absolute child would ride the
        // content. A zero-height sticky dock holds the chip and the foot veil
        // to the visible bottom at any scroll position (Creative Studio,
        // docs/jump-to-latest-redesign.md).
        <div className={`jump-dock${pillClosing ? ' closing' : ''}`}>
          <div className="jump-veil" aria-hidden="true" />
          <div className="jump-rail">
            <button
              type="button"
              className={`jump-chip press-fb${heldUnseen.current > 0 ? ' has-new' : ''}`}
              onClick={jumpToBottom}
              aria-label={
                heldUnseen.current > 0
                  ? `${heldUnseen.current === 1 ? 'A new reply' : `${heldUnseen.current} new replies`} below. Jump to latest.`
                  : 'Jump to latest'
              }
            >
              {heldUnseen.current > 0 ? (
                <span className="jump-label">
                  {heldUnseen.current === 1 ? 'New reply' : `${heldUnseen.current} new`}
                </span>
              ) : null}
              <Icon size={18} className="jump-glyph">
                <path d="M6 9.5l6 6 6-6" />
              </Icon>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
