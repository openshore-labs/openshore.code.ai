// The transcript: user bubbles, assistant prose with a live caret while
// streaming, the model's folded reasoning, tool cards, the plan card, the
// changed-files record, quiet status lines, and citations at the end. A
// working row fills the gap between a send and the first token, and a "new
// messages" pill offers the way back when the person has scrolled up.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useExitPresence } from '../hooks/useExitPresence.js';
import type { ThreadState } from '../state/types.js';
import { useSmoothedReveal } from '../hooks/useSmoothedReveal.js';
import { hapticTick } from '../lib/haptics.js';
import { offersLocalFallback } from '../lib/usageFallback.js';
import { Markdown } from './Markdown.js';
import { ToolCard } from './ToolCard.js';
import { CommandCard } from './CommandCard.js';
import { WorkingRow } from './WorkingRow.js';
import { ThinkingBlock } from './ThinkingBlock.js';
import { PlanCard } from './PlanCard.js';
import { ChangedFilesCard } from './ChangedFilesCard.js';

function AssistantBubble({
  text,
  streaming,
  model,
  showModel,
  onReveal,
}: {
  text: string;
  streaming: boolean;
  model?: string;
  showModel: boolean;
  /** Called as revealed text grows, so a pinned thread follows the typing. */
  onReveal?: () => void;
}) {
  const { text: shown, settling } = useSmoothedReveal(text, streaming);
  // Fires once per bubble mount, i.e. right as its first token lands.
  useEffect(() => {
    if (streaming) hapticTick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    onReveal?.();
  }, [shown.length, onReveal]);
  // The caret stays while any text is still on its way (the stream may have
  // ended with the tail still typing) and fades once the last character lands.
  const live = streaming || settling;
  const { mounted: caretMounted, closing: caretClosing } = useExitPresence(live, 300);
  return (
    <div className="msg-assistant">
      {showModel && model ? <div className="msg-model">{model}</div> : null}
      <Markdown text={shown} streaming={live} />
      {caretMounted ? <span className={`cursor-caret${caretClosing ? ' closing' : ''}`} /> : null}
    </div>
  );
}

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
  onUnqueue,
}: {
  thread: ThreadState;
  /** Open the Local LLMs sheet, offered when a turn stopped for no account usage. */
  onSwitchToLocal?: () => void;
  /** Resend the last message after an error. */
  onRetry?: () => void;
  onApprovePlan?: () => void;
  onRevisePlan?: () => void;
  /** Drop a queued message (tap on its bubble). */
  onUnqueue?: (index: number) => void;
}) {
  const threadRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const prevCount = useRef(0);
  const [unseen, setUnseen] = useState(0);
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
      const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      pinnedRef.current = pinned;
      if (pinned) setUnseen(0);
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
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
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

  // The pill plays an exit; its last count is held while it fades.
  const { mounted: pillMounted, closing: pillClosing } = useExitPresence(unseen > 0, 240);
  const lastUnseen = useRef(0);
  if (unseen > 0) lastUnseen.current = unseen;

  return (
    <div className="thread" ref={threadRef}>
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
                          hapticTick();
                          onRetry();
                        }}
                      >
                        Retry
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
              hapticTick();
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
        <button
          type="button"
          className={`scroll-pill press-fb${pillClosing ? ' closing' : ''}`}
          onClick={jumpToBottom}
        >
          {lastUnseen.current === 1 ? 'New message' : `${lastUnseen.current} new`} {'↓'}
        </button>
      ) : null}
    </div>
  );
}
