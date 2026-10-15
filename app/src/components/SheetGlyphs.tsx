import { Icon } from './Icon.js';
// The small stroked glyphs sheets, rows and the chat share: close, back,
// chevron, check, plus, send, stop, terminal, file, paste, note, lock, more,
// compose, info and the way out to a page outside the app.
// Typed characters never stand in for them. A text "×" or "‹" carries the
// font's side bearings and baseline with it, so it lands low and to the left
// of the circle it sits in (screenshot, 2026-09-03). A path in a
// square viewBox is centered by geometry, whatever font is loaded. Each draws
// through the Icon frame on its 24-unit grid and takes the frame's stroke.
export function CloseGlyph({ size = 18 }: { size?: number }) {
  return (
    <Icon size={size} className="sheet-glyph">
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  );
}

export function BackGlyph() {
  return (
    <Icon size={18} className="sheet-glyph">
      {/* Optically nudged one unit left so the chevron's mass reads centered. */}
      <path d="M15 5L8 12l7 7" />
    </Icon>
  );
}

const CHEVRON = {
  down: 'M6 9.5l6 6 6-6',
  right: 'M9.5 6l6 6-6 6',
  up: 'M6 14.5l6-6 6 6',
} as const;

/** A disclosure or a row's way in. Rooms turn it with their own classes. */
export function ChevronGlyph({
  dir = 'right',
  size = 14,
}: {
  dir?: keyof typeof CHEVRON;
  size?: number;
}) {
  return (
    <Icon size={size} className="chevron-glyph">
      <path d={CHEVRON[dir]} />
    </Icon>
  );
}

/** The chosen row's mark. */
export function CheckGlyph({ size = 18 }: { size?: number }) {
  return (
    <Icon size={size} className="check-glyph">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Icon>
  );
}

export function PlusGlyph({ size = 20 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

/** Send. */
export function ArrowUpGlyph({ size = 18 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Icon>
  );
}

/** Stop a reply: a solid rounded square. */
export function StopGlyph({ size = 14 }: { size?: number }) {
  return (
    <Icon size={size} variant="fill">
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </Icon>
  );
}

/** A terminal window and its prompt (the Terminal room's mark). */
export function TerminalGlyph({ size = 18 }: { size?: number }) {
  return (
    <Icon size={size}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 10l3 2.5L7 15" />
      <path d="M12.5 15H16" />
    </Icon>
  );
}

/** A file with its corner turned. */
export function FileGlyph({ size = 14 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4" />
    </Icon>
  );
}

/** Pasted text: a clipboard. */
export function PasteGlyph({ size = 14 }: { size?: number }) {
  return (
    <Icon size={size}>
      <rect x="6" y="5" width="12" height="16" rx="2" />
      <path d="M9 3.5h6v3H9z" />
    </Icon>
  );
}

/** A note: the Vault's cut gem. */
export function NoteGlyph({ size = 14 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M12 3 19 9l-7 12L5 9l7-6Z" />
      <path d="M5 9h14" />
      <path d="M12 3 9.6 9l2.4 12" />
      <path d="M12 3l2.4 6L12 21" />
    </Icon>
  );
}

/** Private: a padlock. */
export function LockGlyph({ size = 12 }: { size?: number }) {
  return (
    <Icon size={size}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Icon>
  );
}

/** More actions: three dots in a row. */
export function MoreGlyph({ size = 22 }: { size?: number }) {
  return (
    <Icon size={size}>
      <circle cx="5.5" cy="12" r="0.9" />
      <circle cx="12" cy="12" r="0.9" />
      <circle cx="18.5" cy="12" r="0.9" />
    </Icon>
  );
}

/** New chat: a pen over a page, the compose mark the Claude and iOS apps
 *  use, so beside a chat's own name it never reads as rename. One drawing
 *  for the Chats room's bar and an open chat's bar (D7). */
export function ComposeGlyph({ size = 22 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z" />
    </Icon>
  );
}

/** A link that leaves the app (Get a key, Get a token): a drawn arrow up and
 *  out, so a font fallback can never swap a typed one for another shape. */
export function ExternalGlyph({ size = 12 }: { size?: number }) {
  return (
    <Icon size={size} className="external-glyph">
      <path d="M7 17L17 7M9 7h8v8" />
    </Icon>
  );
}

/** A room's "what is this": a ring with a drawn i, opening a short note. */
export function InfoGlyph({ size = 20 }: { size?: number }) {
  return (
    <Icon size={size} className="sheet-glyph">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </Icon>
  );
}
