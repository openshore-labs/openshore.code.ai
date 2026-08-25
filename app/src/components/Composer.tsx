// The composer: an auto-growing field, a model chip that opens the source
// picker, and one round button that is send or stop. The rhythm every good
// chat app taught people.
import { useRef, useState } from 'react';
import { sourceLabel, type ConversationSource } from '../state/types.js';

export function Composer({
  busy,
  source,
  placeholder,
  onSend,
  onStop,
  onPickSource,
}: {
  busy: boolean;
  source?: ConversationSource;
  placeholder?: string;
  onSend: (text: string) => void;
  onStop: () => void;
  onPickSource: () => void;
}) {
  const [value, setValue] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const text = value.trim();
    if (!text || busy) return;
    onSend(text);
    setValue('');
    if (areaRef.current) areaRef.current.style.height = 'auto';
  };

  const dotClass = !source
    ? 'off'
    : source.kind === 'cloud'
      ? 'cloud'
      : source.kind === 'mock'
        ? 'off'
        : 'local';

  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          ref={areaRef}
          rows={1}
          value={value}
          placeholder={placeholder ?? 'Message OpenShore'}
          onChange={(e) => {
            setValue(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, window.innerHeight * 0.4)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-row">
          <button className="model-chip" onClick={onPickSource} aria-label="Choose model">
            <span className={`dot ${dotClass}`} />
            <span className="label">{source ? sourceLabel(source) : 'Choose a model'}</span>
          </button>
          {busy ? (
            <button className="send-btn stop" onClick={onStop} aria-label="Stop">
              {'■'}
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={submit}
              disabled={!value.trim()}
              aria-label="Send"
            >
              {'↑'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
