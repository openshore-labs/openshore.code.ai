// The transcript: user bubbles, assistant prose that arrives a few words at a
// time, each group fading up from light to full ink the way Claude's does, the
// model's folded reasoning, tool cards, the plan card, the
// changed-files record, quiet status lines, and citations at the end. A
// working row fills the gap between a send and the first token, and a quiet
// "back to latest" chip offers the way back when the person has scrolled up.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
import { hapticTick } from '../lib/haptics.js';
import { offersLocalFallback } from '../lib/usageFallback.js';
import { Markdown } from './Markdown.js';
import { ToolCard } from './ToolCard.js';
import { CommandCard } from './CommandCard.js';
import { WorkingRow } from './WorkingRow.js';
import { ThinkingBlock } from './ThinkingBlock.js';
import { PlanCard } from './PlanCard.js';
import { ClarifyCard } from './ClarifyCard.js';
import { ChangedFilesCard } from './ChangedFilesCard.js';
import { Icon } from './Icon.js';

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
        <Markdown text={shown} streaming={live} fade={fading} />
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
function retryable(message: string): boolean {
  return !/stopped at your request|declined|was declined/i.test(message);
}

export function MessageList({
  thread,
  onSwitchToLocal,
  onRetry,
  onApprovePlan,
  onRevisePlan,
  onClarifyPick,
  onUnqueue,
  afterItem,
}: {
  thread: ThreadState;
  /** Open the Local LLMs sheet, offered when a turn stopped for no account usage. */
  onSwitchToLocal?: () => void;
  /** Resend the last message after an error. */
  onRetry?: () => void;
  onApprovePlan?: () => void;
  onRevisePlan?: () => void;
  /** Answer a clarifying question (the plan-first picker): sends the reply. */
  onClarifyPick?: (text: string) => void;
  /** Drop a queued message (tap on its bubble). */
  onUnqueue?: (index: number) => void;
  /** Extra content rendered right under one assistant message, keyed by its
   *  id: Harbor Lite's greeting carries the setup button this way. */
  afterItem?: (id: string) => ReactNode;
}) {
  const threadRef = useRef<HTMLDivElement>(null);
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
      el.scrollTop = el.scrollHeight;
    } else if (grew) {
      setUnseen((n) => n + 1);
    }
  }, [itemCount, streamingLen, lastItem?.kind]);

  // The reveal keeps typing after the stream ends, so a pinned thread follows
  // the revealed text, not only the incoming deltas.
  const followReveal = useCallback(() => {
    const el = threadRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
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
        {thread.items.map((item) => {
          switch (item.kind) {
            case 'user':
              return (
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
            case 'changed':
              return <ChangedFilesCard key={item.id} files={item.files} />;
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
              return (
                <div key={item.id} className="msg-note">
                  {item.text}
                </div>
              );
            case 'stopped':
              return (
                <div key={item.id} className="msg-stopped">
                  {item.message}
                  <div className="msg-stopped-actions">
                    {onSwitchToLocal && offersLocalFallback(item.message) ? (
                      <button
                        type="button"
                        className="msg-stopped-action press-fb"
                        onClick={onSwitchToLocal}
                      >
                        Switch to a local model
                      </button>
                    ) : null}
                    {onRetry && retryable(item.message) && !thread.busy ? (
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
        })}
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
