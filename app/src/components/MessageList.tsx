// The transcript: user bubbles, assistant prose with a live caret while
// streaming, tool cards, quiet status lines, and citations at the end.
import { useEffect, useRef } from 'react';
import type { ThreadState } from '../state/types.js';
import { useSmoothedReveal } from '../hooks/useSmoothedReveal.js';
import { hapticTick } from '../lib/haptics.js';
import { Markdown } from './Markdown.js';
import { ToolCard } from './ToolCard.js';

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

export function MessageList({ thread }: { thread: ThreadState }) {
  const endRef = useRef<HTMLDivElement>(null);
  const itemCount = thread.items.length;
  const lastItem = thread.items[itemCount - 1];
  const streamingLen =
    lastItem && lastItem.kind === 'assistant' && lastItem.streaming ? lastItem.text.length : 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [itemCount, streamingLen]);

  return (
    <div className="thread">
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
        <div ref={endRef} />
      </div>
    </div>
  );
}
