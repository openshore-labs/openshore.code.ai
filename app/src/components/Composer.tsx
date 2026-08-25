// The composer, five controls in the rhythm of the Claude Code chat bar: an
// add button (attach photos or files), the model pill (opens the model sheet),
// the effort pill (opens the same sheet, effort pinned at its top), a mic for
// voice-to-text, and one round button that is send or stop. Attachments ride
// along to vision-capable models; the mic uses the platform's speech engine
// where it exists.
import { useRef, useState } from 'react';
import { sourceLabel, type ConversationSource } from '../state/types.js';
import { useApp } from '../state/store.js';
import { DEFAULT_EFFORT, effortLabel } from '../lib/effort.js';
import { fileToAttachment, type Attachment } from '../lib/attachments.js';
import { useDictation } from '../hooks/useDictation.js';

export function Composer({
  busy,
  source,
  placeholder,
  onSend,
  onStop,
  onOpenModelSheet,
}: {
  busy: boolean;
  source?: ConversationSource;
  placeholder?: string;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  onOpenModelSheet: () => void;
}) {
  const { settings, showToast } = useApp();
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Voice-to-text. On start we remember the text already typed and append the
  // live transcript after it, so dictation adds to the field instead of wiping
  // what is there.
  const baseRef = useRef('');
  const dictation = useDictation((transcript) => {
    const joined = baseRef.current ? `${baseRef.current} ${transcript}` : transcript;
    setValue(joined);
  });

  const submit = () => {
    const text = value.trim();
    if ((!text && attachments.length === 0) || busy) return;
    onSend(text, attachments);
    setValue('');
    setAttachments([]);
    if (areaRef.current) areaRef.current.style.height = 'auto';
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    try {
      const next = await Promise.all(Array.from(files).map(fileToAttachment));
      setAttachments((prev) => [...prev, ...next]);
    } catch {
      showToast('Could not read that file.');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const micTap = () => {
    if (!dictation.supported) {
      showToast('Voice input needs the native app update. Type for now.');
      return;
    }
    if (!dictation.listening) baseRef.current = value.trim();
    dictation.toggle();
  };

  const modelLabel = source ? sourceLabel(source) : 'My Stack';
  const effort = settings.effort ?? DEFAULT_EFFORT;

  return (
    <div className="composer-wrap">
      <div className="composer">
        {attachments.length ? (
          <div className="composer-chips">
            {attachments.map((a) => (
              <span key={a.id} className="composer-chip">
                {a.isImage ? (
                  <img src={a.dataUrl} alt="" className="composer-chip-thumb" />
                ) : (
                  <span className="composer-chip-file" aria-hidden="true">
                    {'📄'}
                  </span>
                )}
                <span className="composer-chip-name">{a.name}</span>
                <button
                  className="composer-chip-x press-fb"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                >
                  {'×'}
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <textarea
          ref={areaRef}
          rows={1}
          value={value}
          placeholder={placeholder ?? 'Chat with OpenShore'}
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
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf,.txt,.md,.json,.csv"
            multiple
            hidden
            onChange={(e) => void onFiles(e.target.files)}
          />
          <button
            className="composer-add press-fb"
            onClick={() => fileRef.current?.click()}
            aria-label="Add photo or file"
          >
            {'+'}
          </button>

          <button className="composer-pill press-fb" onClick={onOpenModelSheet}>
            {modelLabel}
          </button>
          <button
            className="composer-pill composer-pill-effort press-fb"
            onClick={onOpenModelSheet}
            aria-label={`Effort: ${effortLabel(effort)}`}
          >
            {effortLabel(effort)}
          </button>

          <div className="composer-row-spacer" />

          <button
            className={`composer-mic press-fb${dictation.listening ? ' listening' : ''}`}
            onClick={micTap}
            aria-label={dictation.listening ? 'Stop dictation' : 'Dictate'}
          >
            {'🎤'}
          </button>

          {busy ? (
            <button className="send-btn stop press-fb" onClick={onStop} aria-label="Stop">
              {'■'}
            </button>
          ) : (
            <button
              className="send-btn press-fb"
              onClick={submit}
              disabled={!value.trim() && attachments.length === 0}
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
