// The composer, five controls in the rhythm of the Claude Code chat bar: an
// add button (attach photos or files), the model pill (opens the model sheet),
// the mode pill (opens the mode sheet), a mic for voice-to-text, and one round
// button that is send or stop. Attachments ride along to vision-capable
// models; the mic uses the platform's speech engine where it exists.
//
// The keyboard grammar is Claude Code's: Enter sends, Shift+Enter breaks a
// line (on a phone, Return breaks a line and the round button sends, the way
// the Claude app, ChatGPT, and Messages behave), Esc stops a run or clears the field, Up recalls earlier messages,
// Shift+Tab cycles the permission mode, "/" opens the command menu, "@" offers
// repo files, "#" saves a line to the project's instructions, and a message
// typed mid-run queues for the moment the agent is free. A long paste folds
// into a chip so the field stays readable.
import { isIntroPlaying } from '../lib/introWalk.js';
import { skipReveals } from '../lib/streamSmoothing.js';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
} from 'react';
import {
  sourceLabel,
  sourcePlace,
  sourceShortLabel,
  type ConversationSource,
} from '../state/types.js';
import { useApp } from '../state/store.js';
import type { HubRole } from '../drivers/types.js';
import { hapticTick } from '../lib/haptics.js';
import {
  DEFAULT_PERMISSION_MODE,
  nextPermissionMode,
  permissionModeLabel,
} from '../lib/permissionMode.js';
import {
  fileToAttachment,
  groupAttachments,
  imageToJpegAttachment,
  sendsAsIs,
  isTextFile,
  isVideoFile,
  type Attachment,
} from '../lib/attachments.js';
import { buildVideoAttachment } from '../lib/videoAttach.js';
import type { ComposerRestore } from '../lib/heldMessage.js';
import { PHONE_VIDEO_MAX_BYTES, pickVideoBackend } from '../lib/videoBackends.js';
import { isPhone } from '../lib/platform.js';
import { useDictation } from '../hooks/useDictation.js';
import { knownKeyboardHeight } from '../lib/keyboardHeight.js';
import { useExitPresence } from '../hooks/useExitPresence.js';
import { CloseGlyph } from './SheetGlyphs.js';
import { AttachTray, type AttachSource } from './AttachTray.js';
import { Icon } from './Icon.js';

// The iOS keyboard dictation microphone, the same outline Claude uses.
function MicIcon() {
  return (
    <Icon size={20}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="8.5" y1="22" x2="15.5" y2="22" />
    </Icon>
  );
}

// Voice mode: a soundwave, the sign for a spoken conversation (distinct from the
// mic, which dictates into the field). Opens the full-screen voice surface.
function VoiceWaveIcon() {
  return (
    <Icon size={20}>
      <line x1="4" y1="10" x2="4" y2="14" />
      <line x1="8" y1="7" x2="8" y2="17" />
      <line x1="12" y1="4" x2="12" y2="20" />
      <line x1="16" y1="7" x2="16" y2="17" />
      <line x1="20" y1="10" x2="20" y2="14" />
    </Icon>
  );
}

// A small determinate ring for a video being read into frames: the arc fills as
// frames land (done/total). Before a decoder knows the count (total 0) it shows
// a soft pulse instead of a false-empty ring. The arc travel rides a motion
// token, so reduced motion zeroes it with everything else.
function FrameRing({ done, total }: { done: number; total: number }) {
  if (total <= 0) return <span className="pulse-dot" aria-hidden="true" />;
  const r = 7;
  const circumference = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, done / total));
  return (
    <span className="frame-ring" aria-hidden="true">
      <svg viewBox="0 0 20 20" width={16} height={16}>
        <circle className="frame-ring-track" cx={10} cy={10} r={r} />
        <circle
          className="frame-ring-arc"
          cx={10}
          cy={10}
          r={r}
          style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - frac) }}
        />
      </svg>
    </span>
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
  { name: 'init', hint: 'Write an OSCODE.md for this repository', agentOnly: true },
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

// The + never names a vendor and never mutes: a local-first product does not
// send people to one cloud to attach a picture. Only an image (or a video,
// which becomes images) is refused when the brain cannot see, and the fix is
// the person's own Stack or any cloud model on their key that reads images.
export const IMAGE_UNSUPPORTED =
  'This model does not read images. Place one that does in your Stack, or connect a cloud model that reads images.';
export const VIDEO_UNSUPPORTED =
  'This model does not read images. To review a video, place one that does in your Stack, or connect a cloud model that reads images.';

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
interface MenuModel {
  label: string;
  items: Array<{ key: string; name: ReactNode; hint?: string; onPick: () => void }>;
  active: number;
  onHover: (i: number) => void;
  mono?: boolean;
}

/** The menu's exit: --dur-3 plus a hair. */
const MENU_EXIT_MS = 240;
/** Matches .composer-chip.closing (--dur-3). */
const CHIP_EXIT_MS = 220;

/** A touch device (the phone): Return breaks a line and the button sends. */
const isTouch = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

function ComposerMenu({
  label,
  items,
  active,
  onHover,
  mono,
  closing,
}: MenuModel & { closing: boolean }) {
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
    <div
      className={`composer-menu${closing ? ' closing' : ''}`}
      role="listbox"
      aria-label={label}
      ref={listRef}
    >
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
          // Keep focus in the field: a row tap must not blur it (dropping the
          // keyboard, or leaving the caret nowhere for a command's argument).
          onMouseDown={(e) => e.preventDefault()}
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
  restore,
  agent,
  history,
  onSend,
  onStop,
  onOpenModelSheet,
  onOpenModeSheet,
  onOpenVoice,
  onCommand,
  hubRole,
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
  /** A held message handed back to the field (a first send whose model
   *  chooser was dismissed). A new `seq` puts the text and attachments back and
   *  pulls focus, so nothing the person typed is lost. */
  restore?: ComposerRestore;
  /** An engine session is open: @ files, /compact, /init are live. */
  agent?: boolean;
  /** Earlier messages in this chat, oldest first, for Up-arrow recall. */
  history?: string[];
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  onOpenModelSheet: () => void;
  onOpenModeSheet: () => void;
  /** Open voice mode: a spoken conversation over this same chat. Always offered
   *  (it works offline); absent only where the screen has no voice surface. */
  onOpenVoice?: () => void;
  /** A slash command, with whatever followed it. */
  onCommand?: (command: SlashCommand, arg: string) => void;
  /** What the paired hub lets this device do (P0-1). A member device never
   *  gets a shell, so terminal mode is not offered; absent on an old hub. */
  hubRole?: HubRole;
}) {
  const { settings, showToast } = useApp();
  const runCommand = useApp((s) => s.runCommand);
  const listFiles = useApp((s) => s.listFiles);
  const addMemory = useApp((s) => s.addMemory);
  const setPermissionMode = useApp((s) => s.setPermissionMode);
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // Videos being turned into frames right now. Each shows a "Reading …" chip
  // until its frames land in attachments, so the person sees the work happen.
  const [videoJobs, setVideoJobs] = useState<
    Array<{ id: string; name: string; done: number; total: number }>
  >([]);
  const [pasted, setPasted] = useState<PastedChunk[]>([]);
  // Chips on their way out: a removed chip plays chip-out, then leaves the
  // state (house rule 3, everything that animates in animates out).
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
  const removeChip = (key: string, drop: () => void) => {
    setLeaving((prev) => new Set(prev).add(key));
    window.setTimeout(() => {
      drop();
      setLeaving((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, CHIP_EXIT_MS);
  };
  // Terminal mode: on a desktop-backed chat, the composer can send its text to
  // the connected machine as a command instead of a prompt (the "type ls from
  // the couch" path of the chat-to-terminal bridge).
  const canRunCommands = source?.kind === 'desktop' && hubRole !== 'member';
  const [termMode, setTermMode] = useState(false);
  const terminal = canRunCommands && termMode;
  // Terminal mode belongs to one chat's machine. A new chat or a new model
  // starts back on prompts, so a stray Enter never runs a shell command.
  const sourceKey = source ? JSON.stringify(source) : '';
  useEffect(() => setTermMode(false), [sourceKey]);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const anyFileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  // The command and file menus belong to a focused field: tapping away (the
  // keyboard drops) puts them away too.
  const [focused, setFocused] = useState(false);

  // The attach tray (phone only): + opens a tray under the composer, the
  // camera, the photo library, and any file. It is as tall as its tiles
  // (--tray-inset in theme.css), never a keyboard's worth of empty paper: with
  // the keyboard down the composer lifts just enough to show them, and with it
  // up the composer eases down onto the tray on the keyboard's own curve. The
  // root class is set right in the tap, before the field blurs, so the
  // composer rides one move, not two. The desktop + goes straight to the file
  // picker.
  const [tray, setTray] = useState(false);
  const trayPresence = useExitPresence(tray, 300);
  const closeTray = () => {
    document.documentElement.classList.remove('tray-open');
    setTray(false);
  };
  useEffect(() => () => document.documentElement.classList.remove('tray-open'), []);
  const wrapRef = useRef<HTMLDivElement>(null);
  // The tray is a transient surface: a tap anywhere outside the composer, a
  // scroll of the transcript, or Esc puts it away, the way a keyboard goes.
  useEffect(() => {
    if (!tray) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && e.target instanceof Node && wrapRef.current.contains(e.target)) return;
      closeTray();
    };
    const onScroll = (e: Event) => {
      if (e.target instanceof Element && e.target.classList.contains('thread')) closeTray();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeTray();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [tray]);
  const pickFrom = (source: AttachSource) => {
    closeTray();
    const input =
      source === 'camera'
        ? cameraRef.current
        : source === 'photos'
          ? fileRef.current
          : anyFileRef.current;
    input?.click();
  };

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
    if (!autoFocus) return;
    // A frame later, so the room has laid out before the keyboard rises.
    const id = requestAnimationFrame(() => areaRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [autoFocus]);
  useEffect(() => {
    if (focusSignal) areaRef.current?.focus();
  }, [focusSignal]);
  // What the last send was made of, so a message handed back (a paywall, a
  // dismissed chooser) returns as it was typed: the words in the field and the
  // folded pastes as chips, not one merged wall of text.
  const lastSent = useRef<{ body: string; text: string; pasted: PastedChunk[] } | null>(null);
  useEffect(() => {
    if (!restore) return;
    const sent = lastSent.current;
    if (sent && sent.body === restore.text && sent.pasted.length) {
      setValue(sent.text);
      setPasted(sent.pasted);
    } else {
      setValue(restore.text);
    }
    setAttachments(restore.attachments ?? []);
    areaRef.current?.focus();
    // Only a new seq restores; the payload rides along with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restore?.seq]);

  // Voice-to-text. On start we remember the text already typed and append the
  // live transcript after it, so dictation adds to the field instead of wiping
  // what is there.
  const baseRef = useRef('');
  const dictation = useDictation(
    (transcript) => {
      const joined = baseRef.current ? `${baseRef.current} ${transcript}` : transcript;
      setValue(joined);
    },
    (why) =>
      showToast(
        why === 'denied'
          ? 'Microphone access is off. Turn it on in Settings, OpenShore.'
          : 'Dictation stopped. Tap the mic to try again.',
      ),
  );
  const stopDictation = () => {
    dictation.stop();
    baseRef.current = '';
  };

  // The field fits its text, whoever put it there: typing, dictation, a
  // restored message, history recall, or a command. Capped at 40% of the room
  // left above the keyboard, so a long draft never pushes the send row under
  // it.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const root = document.documentElement;
    const kb = root.classList.contains('kb-open')
      ? parseFloat(getComputedStyle(root).getPropertyValue('--kb-inset')) || 0
      : 0;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, (window.innerHeight - kb) * 0.4)}px`;
  }, [value]);

  const resetField = () => {
    stopDictation();
    setValue('');
    setHistIdx(null);
    setMention(null);
  };

  // A command that takes an argument fills the field and keeps the caret in
  // it, so the argument lands where the person is typing.
  const fillCommand = (name: SlashCommand) => {
    const next = `/${name} `;
    setValue(next);
    requestAnimationFrame(() => {
      const el = areaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.length, next.length);
    });
  };

  const runSlash = (name: SlashCommand, arg: string) => {
    resetField();
    onCommand?.(name, arg.trim());
  };

  const insertFile = (path: string) => {
    if (!mention) return;
    const caret = areaRef.current?.selectionStart ?? value.length;
    const next = `${value.slice(0, mention.start)}@${path} ${value.slice(caret)}`;
    setValue(next);
    setMention(null);
    requestAnimationFrame(() => {
      const el = areaRef.current;
      if (!el) return;
      const pos = mention.start + path.length + 2;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  // Stop takes send's place in the same spot the moment a turn starts, so a
  // quick second tap on send would stop the run it just began. Stop ignores
  // taps for a beat after a send.
  const lastSendAt = useRef(0);
  const stopTap = () => {
    if (Date.now() - lastSendAt.current < 400) return;
    onStop();
  };

  const submit = () => {
    const text = value.trim();
    // Terminal mode: run the text as a command on the connected machine, not a
    // prompt. Output streams into the transcript as a command card.
    if (terminal) {
      if (!text) return;
      runCommand(text);
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
        showToast('That command needs a repository session on your computer.');
        return;
      }
    }
    // The # shortcut: a standing instruction for the project, not a message.
    const memory = /^#\s*([\s\S]+)$/.exec(text);
    if (memory && !pasted.length && !attachments.length) {
      resetField();
      void addMemory(memory[1]!);
      return;
    }
    // A video is still being read into frames: hold the send so the frames are
    // not left behind. The chips show what is pending.
    if (videoJobs.length) {
      showToast('Still reading the video. One moment.');
      return;
    }
    // Send-time guard (belt and suspenders to the + gate): never forward images
    // to a brain that cannot see them. The model can change between attach and
    // send, so re-check here.
    const outgoing = visionSupported ? attachments : attachments.filter((a) => !a.isImage);
    if (!visionSupported && outgoing.length < attachments.length) {
      showToast(IMAGE_UNSUPPORTED);
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
    lastSendAt.current = Date.now();
    lastSent.current = { body, text, pasted };
    onSend(body, outgoing);
    resetField();
    setAttachments([]);
    setPasted([]);
  };

  const addTap = () => {
    // The tray always opens: text files and pasted snippets work on any brain,
    // and an image is refused later, at drop and at send, never by muting the +.
    if (window.matchMedia('(pointer: coarse)').matches) {
      if (tray) {
        closeTray();
        return;
      }
      stopDictation();
      document.documentElement.classList.add('tray-open');
      areaRef.current?.blur();
      setTray(true);
      return;
    }
    // The desktop + opens one picker for everything the composer takes:
    // images, videos, and text or code files.
    anyFileRef.current?.click();
  };

  // A video never goes to a model as video. It is compressed if large and
  // sampled into frames natively (FFmpeg on the desktop, AVFoundation on the
  // phone, a canvas on the web), and those frames ride along as image
  // attachments. Screen recordings and screenshots flow through the same way,
  // with no approval step: attaching is not a tool call.
  // Jobs the person cancelled: their frames are dropped if they land later.
  const cancelledJobs = useRef(new Set<string>());
  const cancelVideo = (jobId: string) => {
    cancelledJobs.current.add(jobId);
    removeChip(jobId, () => setVideoJobs((prev) => prev.filter((x) => x.id !== jobId)));
  };
  const ingestVideo = async (file: File) => {
    if (isPhone() && file.size > PHONE_VIDEO_MAX_BYTES) {
      showToast(`${file.name || 'That video'} is over 300 MB. Trim it or send a shorter clip.`);
      return;
    }
    const jobId = `job-${chunkSeq++}`;
    setVideoJobs((prev) => [...prev, { id: jobId, name: file.name || 'video', done: 0, total: 0 }]);
    const onProgress = (done: number, total: number) =>
      setVideoJobs((prev) => prev.map((x) => (x.id === jobId ? { ...x, done, total } : x)));
    try {
      const built = await buildVideoAttachment(file, pickVideoBackend(), onProgress);
      if (!cancelledJobs.current.has(jobId)) setAttachments((prev) => [...prev, ...built.frames]);
    } catch {
      if (!cancelledJobs.current.has(jobId)) {
        showToast('Could not read that video. Try a shorter or standard-format clip.');
      }
    } finally {
      if (!cancelledJobs.current.delete(jobId)) {
        setVideoJobs((prev) => prev.filter((x) => x.id !== jobId));
      }
    }
  };

  const addFiles = async (list: File[]) => {
    if (!list.length) return;
    const videos = list.filter(isVideoFile);
    const rest = list.filter((f) => !isVideoFile(f));
    const images = rest.filter((f) => f.type.startsWith('image/'));
    const others = rest.filter((f) => !f.type.startsWith('image/'));
    if (videos.length) {
      if (!visionSupported) {
        showToast(VIDEO_UNSUPPORTED);
      } else {
        // Kick each video off; the chips show progress and settle on their own.
        for (const file of videos) void ingestVideo(file);
      }
    }
    if (images.length) {
      if (!visionSupported) {
        showToast(IMAGE_UNSUPPORTED);
      } else {
        // HEIC, TIFF, and the like, and oversized photos, are redrawn as a
        // JPEG the model can take; one the phone cannot decode either is
        // named, never dropped.
        const next: Attachment[] = [];
        for (const f of images) {
          try {
            next.push(await (sendsAsIs(f) ? fileToAttachment(f) : imageToJpegAttachment(f)));
          } catch {
            showToast(`Could not read ${f.name || 'that image'}.`);
          }
        }
        if (next.length) setAttachments((prev) => [...prev, ...next]);
      }
    }
    // A text or code file folds in as pasted text, named after the file. A
    // binary (a PDF, a zip, a document) is named and left out, never pasted
    // in as garbage.
    for (const f of others) {
      if (!(await isTextFile(f).catch(() => false))) {
        showToast(`${f.name || 'That file'} is not a text file. Attach images, videos, or text.`);
        continue;
      }
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
    // Clear every picker so choosing the same file again still fires change.
    for (const ref of [fileRef, cameraRef, anyFileRef]) if (ref.current) ref.current.value = '';
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

  // Only a drag that carries files lights the drop target; dragged text
  // falls through to the field as usual. A depth count keeps the highlight
  // steady while the pointer crosses the composer's own children.
  const dragDepth = useRef(0);
  const carriesFiles = (e: DragEvent<HTMLDivElement>) =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    dragDepth.current = 0;
    setDragOver(false);
    if (!carriesFiles(e)) return;
    e.preventDefault();
    void addFiles(Array.from(e.dataTransfer.files ?? []));
  };

  const micTap = () => {
    if (tray) closeTray();
    if (!dictation.supported) {
      showToast(
        isTouch()
          ? 'Dictation is not available on this device. Use the keyboard mic for now.'
          : 'Dictation is not available here. Type in the chat for now.',
      );
      return;
    }
    if (!dictation.listening) baseRef.current = value.trim();
    dictation.toggle();
  };

  const modelLabel = sourceShortLabel(source);
  const place = sourcePlace(source);
  const mode = settings.permissionMode ?? DEFAULT_PERMISSION_MODE;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    // A Japanese, Chinese, or Korean keyboard uses Enter to confirm a
    // conversion; that Enter belongs to the keyboard, never to send.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
      if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        const cmd = slashItems[slashIdx] ?? slashItems[0]!;
        if (cmd.arg) {
          fillCommand(cmd.name);
          return;
        }
        hapticTick();
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
      if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        hapticTick();
        insertFile(files[fileIdx] ?? files[0]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !isTouch()) {
      e.preventDefault();
      // The keyboard has no click for the global tap haptic to catch, so the
      // decisive Enter is marked here; the send button is covered by App.tsx.
      hapticTick();
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

  // The one menu that is open right now (commands or files), modeled once so
  // it can play an exit: the last model is held while it closes.
  const menu: MenuModel | null = !focused
    ? null
    : slashItems.length && !terminal
      ? {
          label: 'Commands',
          active: slashIdx,
          onHover: setSlashIdx,
          items: slashItems.map((c) => ({
            key: c.name,
            name: (
              <>
                /{c.name}
                {c.arg ? <span className="composer-menu-arg"> {c.arg}</span> : null}
              </>
            ),
            hint: c.hint,
            onPick: () => (c.arg ? fillCommand(c.name) : runSlash(c.name, '')),
          })),
        }
      : mention && files.length
        ? {
            label: 'Files',
            active: fileIdx,
            onHover: setFileIdx,
            mono: true,
            items: files.map((f) => ({ key: f, name: f, onPick: () => insertFile(f) })),
          }
        : null;
  const lastMenu = useRef<MenuModel | null>(null);
  if (menu) lastMenu.current = menu;
  const { mounted: menuMounted, closing: menuClosing } = useExitPresence(
    Boolean(menu),
    MENU_EXIT_MS,
  );
  const shownMenu = menu ?? lastMenu.current;

  // Stop shows only when a run is live and there is nothing to send or queue,
  // in terminal mode too (a phone has no Esc).
  const showSend = !busy || value.trim().length > 0 || (!terminal && pasted.length > 0);

  return (
    <div
      ref={wrapRef}
      className={`composer-wrap${dragOver ? ' drag-over' : ''}`}
      onDragEnter={(e) => {
        if (!carriesFiles(e)) return;
        dragDepth.current += 1;
        setDragOver(true);
      }}
      onDragOver={(e) => {
        if (carriesFiles(e)) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!carriesFiles(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      {menuMounted && shownMenu ? (
        <ComposerMenu
          label={shownMenu.label}
          active={shownMenu.active}
          onHover={shownMenu.onHover}
          mono={shownMenu.mono}
          items={shownMenu.items}
          closing={menuClosing}
        />
      ) : null}
      <div className="composer">
        {attachments.length || pasted.length || videoJobs.length ? (
          <div className="composer-chips">
            {groupAttachments(attachments).map((g) => {
              const first = g.items[0];
              const label = g.video ? `${g.label} · ${g.video.count} frames` : g.label;
              return (
                <span
                  key={g.groupId}
                  className={`composer-chip${leaving.has(g.groupId) ? ' closing' : ''}`}
                >
                  {first?.isImage ? (
                    <img src={first.dataUrl} alt="" className="composer-chip-thumb" />
                  ) : (
                    <span className="composer-chip-file" aria-hidden="true">
                      {'📄'}
                    </span>
                  )}
                  <span className="composer-chip-name">{label}</span>
                  <button
                    className="composer-chip-x press-fb"
                    aria-label={`Remove ${g.label}`}
                    onClick={() =>
                      removeChip(g.groupId, () =>
                        setAttachments((prev) =>
                          prev.filter((x) => !g.items.some((it) => it.id === x.id)),
                        ),
                      )
                    }
                  >
                    <CloseGlyph size={12} />
                  </button>
                </span>
              );
            })}
            {videoJobs.map((job) => (
              <span
                key={job.id}
                className={`composer-chip${leaving.has(job.id) ? ' closing' : ''}`}
                aria-live="polite"
              >
                <FrameRing done={job.done} total={job.total} />
                <span className="composer-chip-name">
                  {job.total > 0
                    ? `Reading ${job.name} · ${job.done}/${job.total}`
                    : `Reading ${job.name}…`}
                </span>
                <button
                  className="composer-chip-x press-fb"
                  aria-label={`Stop reading ${job.name}`}
                  onClick={() => cancelVideo(job.id)}
                >
                  <CloseGlyph size={12} />
                </button>
              </span>
            ))}
            {pasted.map((p, i) => (
              <span key={p.id} className={`composer-chip${leaving.has(p.id) ? ' closing' : ''}`}>
                <span className="composer-chip-file" aria-hidden="true">
                  {'📋'}
                </span>
                <span className="composer-chip-name">
                  Pasted text #{i + 1} · {p.lines} lines
                </span>
                <button
                  className="composer-chip-x press-fb"
                  aria-label={`Remove pasted text ${i + 1}`}
                  onClick={() =>
                    removeChip(p.id, () => setPasted((prev) => prev.filter((x) => x.id !== p.id)))
                  }
                >
                  <CloseGlyph size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <textarea
          ref={areaRef}
          rows={1}
          value={value}
          aria-label={terminal ? 'Command to run on your computer' : 'Message'}
          placeholder={
            terminal
              ? 'Run a command on your computer'
              : busy
                ? 'Type to queue the next message'
                : (placeholder ?? 'Chat with OpenShore')
          }
          enterKeyHint={isTouch() ? 'enter' : 'send'}
          onChange={(e) => {
            // The first keystroke during the first open's letter finishes it:
            // someone typing is ready, never held to the reveal.
            if (isIntroPlaying()) skipReveals();
            // Typing takes the field back from dictation, so the next spoken
            // partial never overwrites what was just typed.
            if (dictation.listening) stopDictation();
            setValue(e.target.value);
            setHistIdx(null);
            setMention(agent ? mentionAt(e.target.value, e.target.selectionStart) : null);
          }}
          onSelect={(e) => {
            const el = e.currentTarget;
            setMention(agent ? mentionAt(el.value, el.selectionStart) : null);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => {
            setFocused(true);
            if (tray) {
              // The keyboard is about to take the tray's slot. Hold the slot at
              // the keyboard's height now, so the composer rises once instead
              // of dipping to the floor and back up before the keyboard event.
              const root = document.documentElement;
              root.style.setProperty('--kb-inset', `${knownKeyboardHeight()}px`);
              root.classList.add('kb-open');
              closeTray();
            }
          }}
          onBlur={() => setFocused(false)}
        />

        <div className="composer-row">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange={(e) => void onFiles(e.target.files)}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => void onFiles(e.target.files)}
          />
          <input
            ref={anyFileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => void onFiles(e.target.files)}
          />
          <button
            className="composer-add press-fb"
            onClick={addTap}
            aria-label="Attach"
            aria-expanded={tray}
          >
            {'+'}
          </button>

          <button
            className="composer-pill press-fb"
            onClick={() => {
              if (tray) closeTray();
              onOpenModelSheet();
            }}
            aria-label={`Model: ${source ? sourceLabel(source) : 'Stack'}`}
          >
            {place ? <span className={`composer-pill-place ${place}`} aria-hidden="true" /> : null}
            <span className="composer-pill-text">{modelLabel}</span>
            <span className="composer-pill-chevron" aria-hidden="true" />
          </button>
          <button
            className={`composer-pill composer-pill-mode mode-${mode} press-fb`}
            onClick={() => {
              if (tray) closeTray();
              onOpenModeSheet();
            }}
            aria-label={`Mode: ${permissionModeLabel(mode)}. Shift and Tab cycles.`}
          >
            <span className="composer-pill-dot" aria-hidden="true" />
            <span className="composer-pill-text">{permissionModeLabel(mode)}</span>
          </button>

          {canRunCommands ? (
            <button
              className={`composer-pill composer-pill-term press-fb${terminal ? ' active' : ''}`}
              onClick={() => setTermMode((t) => !t)}
              aria-pressed={terminal}
              aria-label="Terminal mode: run the next message as a command"
            >
              <span className="composer-pill-glyph" aria-hidden="true">
                {'$'}
              </span>
              <span className="composer-pill-text">Terminal</span>
            </button>
          ) : null}

          <div className="composer-row-spacer" />

          {onOpenVoice && !terminal ? (
            <button
              className="composer-mic press-fb"
              onClick={() => {
                stopDictation();
                if (tray) closeTray();
                onOpenVoice();
              }}
              aria-label="Voice mode: have a spoken conversation"
              title="Voice mode"
            >
              <VoiceWaveIcon />
            </button>
          ) : null}

          <button
            className={`composer-mic press-fb${dictation.listening ? ' listening' : ''}`}
            onClick={micTap}
            aria-label={dictation.listening ? 'Stop dictation' : 'Dictate'}
          >
            <MicIcon />
          </button>

          {!showSend ? (
            <button className="send-btn stop press-fb" onClick={stopTap} aria-label="Stop">
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
      {trayPresence.mounted ? (
        <AttachTray closing={trayPresence.closing} onPick={pickFrom} />
      ) : null}
    </div>
  );
}
