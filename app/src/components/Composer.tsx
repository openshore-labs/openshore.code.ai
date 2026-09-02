// The composer, five controls in the rhythm of the Claude Code chat bar: an
// add button (attach photos or files), the model pill (opens the model sheet),
// the mode pill (opens the mode sheet), a mic for voice-to-text, and one round
// button that is send or stop. Attachments ride along to vision-capable
// models; the mic uses the platform's speech engine where it exists.
//
// The keyboard grammar is Claude Code's: Enter sends, Shift+Enter breaks a
// line, Esc stops a run or clears the field, Up recalls earlier messages,
// Shift+Tab cycles the permission mode, "/" opens the command menu, "@" offers
// repo files, "#" saves a line to the project's instructions, and a message
// typed mid-run queues for the moment the agent is free. A long paste folds
// into a chip so the field stays readable.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
} from 'react';
import { sourceLabel, type ConversationSource } from '../state/types.js';
import { useApp } from '../state/store.js';
import { hapticTick } from '../lib/haptics.js';
import {
  DEFAULT_PERMISSION_MODE,
  nextPermissionMode,
  permissionModeLabel,
} from '../lib/permissionMode.js';
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

export type SlashCommand =
  'help' | 'clear' | 'compact' | 'model' | 'cost' | 'mode' | 'init' | 'rename';

export const SLASH_COMMANDS: Array<{
  name: SlashCommand;
  hint: string;
  /** Takes text after the command name. */
  arg?: string;
  /** Only meaningful on an engine session (a desktop repo). */
  agentOnly?: boolean;
}> = [
  { name: 'help', hint: 'What the composer can do' },
  { name: 'clear', hint: 'Start a fresh chat' },
  { name: 'compact', hint: 'Fold the history to save context', arg: 'focus', agentOnly: true },
  { name: 'model', hint: 'Switch the model' },
  { name: 'cost', hint: 'Spend and tokens so far' },
  { name: 'mode', hint: 'Change the permission mode' },
  { name: 'init', hint: 'Write an OSCODE.md for this repo', agentOnly: true },
  { name: 'rename', hint: 'Name this chat', arg: 'name' },
];

/** A paste long enough to fold into a chip rather than fill the field. */
const PASTE_FOLD_CHARS = 1500;
const PASTE_FOLD_LINES = 25;

interface PastedChunk {
  id: string;
  text: string;
  lines: number;
}

let chunkSeq = 0;

/** The @ token under the caret, if the person is typing one. */
function mentionAt(value: string, caret: number): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const m = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!m) return null;
  return { start: before.length - m[2]!.length - 1, query: m[2]! };
}

/** One list for the command menu and the file popover: a highlight that
 *  slides between rows on transform (never a repaint of each row), rows that
 *  snap into view as the keyboard moves the selection. */
function ComposerMenu({
  label,
  items,
  active,
  onHover,
  mono,
}: {
  label: string;
  items: Array<{ key: string; name: ReactNode; hint?: string; onPick: () => void }>;
  active: number;
  onHover: (i: number) => void;
  mono?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [glide, setGlide] = useState<{ y: number; h: number } | null>(null);
  // Measure the active row and glide the highlight to it. Height is set
  // directly (rows can wrap); only the travel is animated.
  useLayoutEffect(() => {
    const list = listRef.current;
    const row = list?.querySelectorAll<HTMLElement>('.composer-menu-row')[active];
    if (!list || !row) return;
    setGlide({ y: row.offsetTop, h: row.offsetHeight });
    row.scrollIntoView({ block: 'nearest' });
  }, [active, items.length]);
  return (
    <div className="composer-menu" role="listbox" aria-label={label} ref={listRef}>
      {glide ? (
        <span
          className="composer-menu-glide"
          aria-hidden="true"
          style={{ transform: `translateY(${glide.y}px)`, height: glide.h }}
        />
      ) : null}
      {items.map((it, i) => (
        <button
          key={it.key}
          type="button"
          role="option"
          aria-selected={i === active}
          className={`composer-menu-row press-fb press-fb--row${i === active ? ' active' : ''}`}
          onMouseEnter={() => onHover(i)}
          onClick={it.onPick}
        >
          <span className={`composer-menu-name${mono ? ' mono' : ''}`}>{it.name}</span>
          {it.hint ? <span className="composer-menu-hint">{it.hint}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Composer({
  busy,
  source,
  visionSupported,
  placeholder,
  autoFocus,
  focusSignal,
  agent,
  history,
  onSend,
  onStop,
  onOpenModelSheet,
  onOpenModeSheet,
  onCommand,
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
  /** Bump to pull focus into the field (a "Change something" on a plan). */
  focusSignal?: number;
  /** An engine session is open: @ files, /compact, /init are live. */
  agent?: boolean;
  /** Earlier messages in this chat, oldest first, for Up-arrow recall. */
  history?: string[];
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  onOpenModelSheet: () => void;
  onOpenModeSheet: () => void;
  /** A slash command, with whatever followed it. */
  onCommand?: (command: SlashCommand, arg: string) => void;
}) {
  const { settings, showToast } = useApp();
  const runCommand = useApp((s) => s.runCommand);
  const listFiles = useApp((s) => s.listFiles);
  const addMemory = useApp((s) => s.addMemory);
  const setPermissionMode = useApp((s) => s.setPermissionMode);
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pasted, setPasted] = useState<PastedChunk[]>([]);
  // Terminal mode: on a desktop-backed chat, the composer can send its text to
  // the connected machine as a command instead of a prompt (the "type ls from
  // the couch" path of the chat-to-terminal bridge).
  const canRunCommands = source?.kind === 'desktop';
  const [termMode, setTermMode] = useState(false);
  const terminal = canRunCommands && termMode;
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // The command menu: open while the field is exactly "/" plus a word.
  const slashMatch = /^\/(\w*)$/.exec(value);
  const slashItems = slashMatch
    ? SLASH_COMMANDS.filter(
        (c) => c.name.startsWith(slashMatch[1]!.toLowerCase()) && (agent || !c.agentOnly),
      )
    : [];
  const [slashIdx, setSlashIdx] = useState(0);
  const slashWord = slashMatch?.[1];
  useEffect(() => setSlashIdx(0), [slashWord]);

  // The @ file popover: the token under the caret, ranked by the engine.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [fileIdx, setFileIdx] = useState(0);
  const mentionQuery = mention?.query;
  const mentionStart = mention?.start;
  useEffect(() => {
    if (mentionQuery === undefined || !agent) {
      setFiles([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      void listFiles(mentionQuery).then((rows) => {
        if (!live) return;
        setFiles(rows.slice(0, 8));
        setFileIdx(0);
      });
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [mentionQuery, mentionStart, agent, listFiles]);

  // Up-arrow recall through this chat's earlier messages.
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const draftRef = useRef('');

  // Open the empty chat screen with the field focused so the keyboard comes up
  // right away (Claude does the same). Fires when autoFocus flips to true, so a
  // fresh empty state re-raises it while a live transcript leaves it alone.
  useEffect(() => {
    if (autoFocus) areaRef.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    if (focusSignal) areaRef.current?.focus();
  }, [focusSignal]);

  // Voice-to-text. On start we remember the text already typed and append the
  // live transcript after it, so dictation adds to the field instead of wiping
  // what is there.
  const baseRef = useRef('');
  const dictation = useDictation((transcript) => {
    const joined = baseRef.current ? `${baseRef.current} ${transcript}` : transcript;
    setValue(joined);
  });

  const resetField = () => {
    setValue('');
    setHistIdx(null);
    setMention(null);
    if (areaRef.current) areaRef.current.style.height = 'auto';
  };

  const runSlash = (name: SlashCommand, arg: string) => {
    hapticTick();
    resetField();
    onCommand?.(name, arg.trim());
  };

  const insertFile = (path: string) => {
    if (!mention) return;
    const caret = areaRef.current?.selectionStart ?? value.length;
    const next = `${value.slice(0, mention.start)}@${path} ${value.slice(caret)}`;
    setValue(next);
    setMention(null);
    hapticTick();
    requestAnimationFrame(() => {
      const el = areaRef.current;
      if (!el) return;
      const pos = mention.start + path.length + 2;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const submit = () => {
    const text = value.trim();
    // Terminal mode: run the text as a command on the connected machine, not a
    // prompt. Output streams into the transcript as a command card.
    if (terminal) {
      if (!text) return;
      runCommand(text);
      hapticTick();
      resetField();
      return;
    }
    // A slash command, with or without an argument.
    const slash = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(text);
    if (slash && !pasted.length && !attachments.length) {
      const cmd = SLASH_COMMANDS.find((c) => c.name === slash[1]!.toLowerCase());
      if (cmd && (agent || !cmd.agentOnly)) {
        runSlash(cmd.name, slash[2] ?? '');
        return;
      }
      if (cmd) {
        showToast('That command needs a desktop repo session.');
        return;
      }
    }
    // The # shortcut: a standing instruction for the project, not a message.
    const memory = /^#\s*([\s\S]+)$/.exec(text);
    if (memory && !pasted.length && !attachments.length) {
      hapticTick();
      resetField();
      void addMemory(memory[1]!);
      return;
    }
    // Send-time guard (belt and suspenders to the + gate): never forward images
    // to a brain that cannot see them. The model can change between attach and
    // send, so re-check here.
    const outgoing = visionSupported ? attachments : attachments.filter((a) => !a.isImage);
    if (!visionSupported && outgoing.length < attachments.length) {
      showToast('This model reads text only. Switch to Claude to send images.');
    }
    const body = pasted.length
      ? [text, ...pasted.map((p) => p.text)].filter(Boolean).join('\n\n')
      : text;
    if (!body && outgoing.length === 0) return;
    // Mid-run with an image: the turn needs to be live. Text alone queues.
    if (busy && outgoing.length) {
      showToast('Images send once the current task finishes.');
      return;
    }
    onSend(body, outgoing);
    if (busy) hapticTick();
    resetField();
    setAttachments([]);
    setPasted([]);
  };

  const addTap = () => {
    if (!visionSupported) {
      showToast('This model reads text only. Switch to Claude to send images.');
      return;
    }
    fileRef.current?.click();
  };

  const addFiles = async (list: File[]) => {
    if (!list.length) return;
    const images = list.filter((f) => f.type.startsWith('image/'));
    const texts = list.filter((f) => !f.type.startsWith('image/'));
    if (images.length) {
      if (!visionSupported) {
        showToast('This model reads text only. Switch to Claude to send images.');
      } else {
        try {
          const next = await Promise.all(images.map(fileToAttachment));
          setAttachments((prev) => [...prev, ...next]);
        } catch {
          showToast('Could not read that file.');
        }
      }
    }
    // A dropped text file folds in as pasted text, named after the file.
    for (const f of texts) {
      if (f.size > 512_000) {
        showToast(`${f.name} is too large to paste. Mention it by path instead.`);
        continue;
      }
      try {
        const text = await f.text();
        const lines = text.split('\n').length;
        setPasted((prev) => [
          ...prev,
          { id: `p${chunkSeq++}`, text: `${f.name}:\n\`\`\`\n${text}\n\`\`\``, lines },
        ]);
      } catch {
        showToast('Could not read that file.');
      }
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    await addFiles(Array.from(files));
    if (fileRef.current) fileRef.current.value = '';
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items ?? []);
    const fileItems = items.filter((i) => i.kind === 'file');
    if (fileItems.length) {
      e.preventDefault();
      const list = fileItems.map((i) => i.getAsFile()).filter((f): f is File => Boolean(f));
      void addFiles(list);
      return;
    }
    const text = e.clipboardData.getData('text/plain');
    const lines = text.split('\n').length;
    if (text.length > PASTE_FOLD_CHARS || lines > PASTE_FOLD_LINES) {
      e.preventDefault();
      hapticTick();
      setPasted((prev) => [...prev, { id: `p${chunkSeq++}`, text, lines }]);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    void addFiles(Array.from(e.dataTransfer.files ?? []));
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    // Command menu navigation.
    if (slashItems.length && !terminal) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIdx((i) => (i + 1) % slashItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIdx((i) => (i - 1 + slashItems.length) % slashItems.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        const cmd = slashItems[slashIdx] ?? slashItems[0]!;
        if (cmd.arg) {
          setValue(`/${cmd.name} `);
          return;
        }
        runSlash(cmd.name, '');
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        resetField();
        return;
      }
    }
    // File mention navigation.
    if (mention && files.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFileIdx((i) => (i + 1) % files.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFileIdx((i) => (i - 1 + files.length) % files.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        insertFile(files[fileIdx] ?? files[0]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Escape') {
      if (busy && !value) {
        e.preventDefault();
        hapticTick();
        onStop();
        return;
      }
      if (value) {
        e.preventDefault();
        resetField();
      }
      return;
    }
    if (e.key === 'Tab' && e.shiftKey && !terminal) {
      e.preventDefault();
      const next = nextPermissionMode(mode);
      hapticTick();
      void setPermissionMode(next);
      showToast(`Mode: ${permissionModeLabel(next)}`);
      return;
    }
    // History recall: Up from the top line, Down back toward the draft.
    const hist = history ?? [];
    if (hist.length && e.key === 'ArrowUp' && el.selectionStart === 0 && !value.includes('\n')) {
      e.preventDefault();
      const idx = histIdx === null ? hist.length - 1 : Math.max(0, histIdx - 1);
      if (histIdx === null) draftRef.current = value;
      setHistIdx(idx);
      setValue(hist[idx]!);
      return;
    }
    if (histIdx !== null && e.key === 'ArrowDown' && el.selectionStart === value.length) {
      e.preventDefault();
      const idx = histIdx + 1;
      if (idx >= hist.length) {
        setHistIdx(null);
        setValue(draftRef.current);
      } else {
        setHistIdx(idx);
        setValue(hist[idx]!);
      }
    }
  };

  const showSend = terminal || !busy || value.trim().length > 0;

  return (
    <div
      className={`composer-wrap${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {slashItems.length && !terminal ? (
        <ComposerMenu
          label="Commands"
          active={slashIdx}
          onHover={setSlashIdx}
          items={slashItems.map((c) => ({
            key: c.name,
            name: (
              <>
                /{c.name}
                {c.arg ? <span className="composer-menu-arg"> {c.arg}</span> : null}
              </>
            ),
            hint: c.hint,
            onPick: () => (c.arg ? setValue(`/${c.name} `) : runSlash(c.name, '')),
          }))}
        />
      ) : null}
      {mention && files.length ? (
        <ComposerMenu
          label="Files"
          active={fileIdx}
          onHover={setFileIdx}
          mono
          items={files.map((f) => ({ key: f, name: f, onPick: () => insertFile(f) }))}
        />
      ) : null}
      <div className="composer">
        {attachments.length || pasted.length ? (
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
            {pasted.map((p, i) => (
              <span key={p.id} className="composer-chip">
                <span className="composer-chip-file" aria-hidden="true">
                  {'📋'}
                </span>
                <span className="composer-chip-name">
                  Pasted text #{i + 1} · {p.lines} lines
                </span>
                <button
                  className="composer-chip-x press-fb"
                  aria-label={`Remove pasted text ${i + 1}`}
                  onClick={() => setPasted((prev) => prev.filter((x) => x.id !== p.id))}
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
            terminal
              ? 'Run a command on your desktop'
              : busy
                ? 'Type to queue the next message'
                : (placeholder ?? 'Chat with OpenShore')
          }
          onChange={(e) => {
            setValue(e.target.value);
            setHistIdx(null);
            setMention(agent ? mentionAt(e.target.value, e.target.selectionStart) : null);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, window.innerHeight * 0.4)}px`;
          }}
          onSelect={(e) => {
            const el = e.currentTarget;
            setMention(agent ? mentionAt(el.value, el.selectionStart) : null);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
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
            className={`composer-pill composer-pill-mode mode-${mode} press-fb`}
            onClick={onOpenModeSheet}
            aria-label={`Mode: ${permissionModeLabel(mode)}. Shift and Tab cycles.`}
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

          {!showSend ? (
            <button className="send-btn stop press-fb" onClick={onStop} aria-label="Stop">
              {'■'}
            </button>
          ) : (
            <button
              className={`send-btn press-fb${terminal ? ' terminal' : ''}${busy && !terminal ? ' queue' : ''}`}
              onClick={submit}
              disabled={
                terminal
                  ? !value.trim()
                  : !value.trim() && attachments.length === 0 && pasted.length === 0
              }
              aria-label={terminal ? 'Run command' : busy ? 'Queue message' : 'Send'}
            >
              {terminal ? '$' : '↑'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
