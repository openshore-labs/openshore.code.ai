// The composer, five controls in the rhythm of the Claude Code chat bar: an
// add button (attach photos or files), the model pill (opens the model sheet),
// the effort pill (opens the same sheet, effort pinned at its top), a mic for
// voice-to-text, and one round button that is send or stop. Attachments ride
// along to vision-capable models; the mic uses the platform's speech engine
// where it exists.
import { useEffect, useRef, useState } from 'react';
import { sourceLabel, type ConversationSource } from '../state/types.js';
import { useApp } from '../state/store.js';
import { hapticTick } from '../lib/haptics.js';
import { DEFAULT_PERMISSION_MODE, permissionModeLabel } from '../lib/permissionMode.js';
import { fileToAttachment, type Attachment } from '../lib/attachments.js';
import { useDictation } from '../hooks/useDictation.js';

// The iOS keyboard dictation microphone, the same outline Claude uses.
function MicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="8.5" y1="22" x2="15.5" y2="22" />
    </svg>
  );
}

export function Composer({
  busy,
  source,
  visionSupported,
  placeholder,
  autoFocus,
  onSend,
  onStop,
  onOpenModelSheet,
  onOpenModeSheet,
}: {
  busy: boolean;
  source?: ConversationSource;
  /** Whether the current brain can read attached images. Gates the + button so
   *  an image is never stranded on a text-only model. */
  visionSupported: boolean;
  placeholder?: string;
  /** Focus the field (and, on device, raise the keyboard) when this turns true.
   *  Used to open the empty chat screen with the keyboard already up, the way
   *  the Claude app does. */
  autoFocus?: boolean;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  onOpenModelSheet: () => void;
  onOpenModeSheet: () => void;
}) {
  const { settings, showToast } = useApp();
  const runCommand = useApp((s) => s.runCommand);
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // Terminal mode: on a desktop-backed chat, the composer can send its text to
  // the connected machine as a command instead of a prompt (the "type ls from
  // the couch" path of the chat-to-terminal bridge).
  const canRunCommands = source?.kind === 'desktop';
  const [termMode, setTermMode] = useState(false);
  const terminal = canRunCommands && termMode;
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Open the empty chat screen with the field focused so the keyboard comes up
  // right away (Claude does the same). Fires when autoFocus flips to true, so a
  // fresh empty state re-raises it while a live transcript leaves it alone.
  useEffect(() => {
    if (autoFocus) areaRef.current?.focus();
  }, [autoFocus]);

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
    // Terminal mode: run the text as a command on the connected machine, not a
    // prompt. Output streams into the transcript as a command card.
    if (terminal) {
      if (!text) return;
      runCommand(text);
      hapticTick();
      setValue('');
      if (areaRef.current) areaRef.current.style.height = 'auto';
      return;
    }
    // Send-time guard (belt and suspenders to the + gate): never forward images
    // to a brain that cannot see them. The model can change between attach and
    // send, so re-check here.
    const outgoing = visionSupported ? attachments : attachments.filter((a) => !a.isImage);
    if (!visionSupported && outgoing.length < attachments.length) {
      showToast('This model reads text only. Switch to Claude to send images.');
    }
    if ((!text && outgoing.length === 0) || busy) return;
    onSend(text, outgoing);
    setValue('');
    setAttachments([]);
    if (areaRef.current) areaRef.current.style.height = 'auto';
  };

  const addTap = () => {
    if (!visionSupported) {
      showToast('This model reads text only. Switch to Claude to send images.');
      return;
    }
    fileRef.current?.click();
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
  const mode = settings.permissionMode ?? DEFAULT_PERMISSION_MODE;

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
          placeholder={
            terminal ? 'Run a command on your desktop' : (placeholder ?? 'Chat with OpenShore')
          }
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
            accept="image/*"
            multiple
            hidden
            onChange={(e) => void onFiles(e.target.files)}
          />
          <button
            className={`composer-add press-fb${visionSupported ? '' : ' muted'}`}
            onClick={addTap}
            aria-label="Add image"
          >
            {'+'}
          </button>

          <button className="composer-pill press-fb" onClick={onOpenModelSheet}>
            {modelLabel}
          </button>
          <button
            className="composer-pill composer-pill-mode press-fb"
            onClick={onOpenModeSheet}
            aria-label={`Mode: ${permissionModeLabel(mode)}`}
          >
            <span className="pill-code" aria-hidden="true">
              {'</>'}
            </span>
            {permissionModeLabel(mode)}
          </button>

          {canRunCommands ? (
            <button
              className={`composer-pill composer-pill-term press-fb${terminal ? ' active' : ''}`}
              onClick={() => setTermMode((t) => !t)}
              aria-pressed={terminal}
              aria-label="Terminal mode: run the next message as a command"
            >
              <span className="pill-code" aria-hidden="true">
                {'$'}
              </span>
              Terminal
            </button>
          ) : null}

          <div className="composer-row-spacer" />

          <button
            className={`composer-mic press-fb${dictation.listening ? ' listening' : ''}`}
            onClick={micTap}
            aria-label={dictation.listening ? 'Stop dictation' : 'Dictate'}
          >
            <MicIcon />
          </button>

          {busy && !terminal ? (
            <button className="send-btn stop press-fb" onClick={onStop} aria-label="Stop">
              {'■'}
            </button>
          ) : (
            <button
              className={`send-btn press-fb${terminal ? ' terminal' : ''}`}
              onClick={submit}
              disabled={terminal ? !value.trim() : !value.trim() && attachments.length === 0}
              aria-label={terminal ? 'Run command' : 'Send'}
            >
              {terminal ? '$' : '↑'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
