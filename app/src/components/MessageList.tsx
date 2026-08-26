// The transcript: user bubbles, assistant prose with a live caret while
// streaming, tool cards, quiet status lines, and citations at the end.
import { useEffect, useRef } from 'react';
import type { ThreadState } from '../state/types.js';
import { useSmoothedReveal } from '../hooks/useSmoothedReveal.js';
import { hapticTick } from '../lib/haptics.js';
import { offersLocalFallback } from '../lib/usageFallback.js';
import { Markdown } from './Markdown.js';
import { ToolCard } from './ToolCard.js';
import { CommandCard } from './CommandCard.js';

function AssistantBubble({ text, streaming }: { text: string; streaming: boolean }) {
  const shown = useSmoothedReveal(text, streaming);
  // Fires once per bubble mount, i.e. right as its first token lands.
  useEffect(() => {
    if (streaming) hapticTick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="msg-assistant">
      <Markdown text={shown} />
      {streaming ? <span className="cursor-caret" /> : null}
    </div>
  );
}

export function MessageList({
  thread,
  onSwitchToLocal,
}: {
  thread: ThreadState;
  /** Open the Local LLMs sheet, offered when a turn stopped for no account usage. */
  onSwitchToLocal?: () => void;
}) {
  const threadRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const prevCount = useRef(0);
  const itemCount = thread.items.length;
  const lastItem = thread.items[itemCount - 1];
  const streamingLen =
    lastItem && lastItem.kind === 'assistant' && lastItem.streaming ? lastItem.text.length : 0;

  // Track whether the user is pinned to the bottom, so streaming tokens do not
  // yank them back when they have scrolled up to reread (the iMessage rule).
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const onScroll = () => {
      pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
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
    const newUserTurn = itemCount > prevCount.current && lastItem?.kind === 'user';
    prevCount.current = itemCount;
    if (newUserTurn) pinnedRef.current = true;
    if (pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [itemCount, streamingLen, lastItem?.kind]);

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
            case 'assistant':
              return <AssistantBubble key={item.id} text={item.text} streaming={item.streaming} />;
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
                  {onSwitchToLocal && offersLocalFallback(item.message) ? (
                    <button
                      type="button"
                      className="msg-stopped-action press-fb"
                      onClick={onSwitchToLocal}
                    >
                      Switch to a local model
                    </button>
                  ) : null}
                </div>
              );
          }
        })}
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
    </div>
  );
}
