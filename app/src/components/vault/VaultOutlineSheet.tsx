// A note's outline (Vault M6, 6.8; tech review K15, UX review X16): its headings in a Sheet,
// indented by level, H4 and below aligned with H3. Offered from Options only
// when the note has two or more headings (Hick: no new bar icon). A pick
// waits for the sheet's exit, then the screen scrolls to that heading the
// way a `[[Note#Heading]]` link does (K10, X12), so the sheet never snaps
// away under a jump.
//
// The headings come from `scanNote(draft).headings` on the text on screen,
// so the outline matches what the person sees, edits included. Prop-driven:
// the screen owns `open` and the scroll.
import { useEffect, useRef } from 'react';
import { Sheet } from '../Sheet.js';
import { SheetHead } from '../SheetHead.js';
import { sheetExitMs } from '../../lib/motion.js';
import { VAULT_OUTLINE_TITLE, vaultOutlineRowAria } from '../../lib/vaultCopy.js';

export interface OutlineHeading {
  level: number;
  text: string;
  /** Zero-based line number. */
  line: number;
}

/** The outline is offered only when there is something to jump between. */
export function outlineOffered(headings: readonly OutlineHeading[]): boolean {
  return headings.length >= 2;
}

/** The indent step for a level: H1 flush, H2 one step, H3 and deeper two. */
export function outlineDepth(level: number): number {
  return Math.max(0, Math.min(level, 3) - 1);
}

export interface VaultOutlineSheetProps {
  open: boolean;
  headings: readonly OutlineHeading[];
  onClose: () => void;
  /** Called once the sheet has left, with the heading and its index. */
  onPick: (heading: OutlineHeading, index: number) => void;
}

export function VaultOutlineSheet({ open, headings, onClose, onPick }: VaultOutlineSheetProps) {
  // A pick is held until the exit has played (the UI-4 pattern for Sheet).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const choose = (h: OutlineHeading, i: number) => {
    onClose();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      onPick(h, i);
    }, sheetExitMs());
  };
  const shown = open && outlineOffered(headings);
  return (
    <Sheet open={shown} onClose={onClose}>
      {shown ? (
        <>
          <SheetHead title={VAULT_OUTLINE_TITLE} onClose={onClose} />
          <ol className="vault-outline" role="list">
            {headings.map((h, i) => (
              <li
                key={`${h.line}:${i}`}
                className="vault-outline-item"
                style={{ ['--i' as string]: Math.min(i, 12) }}
              >
                <button
                  type="button"
                  className={`vault-outline-row vault-outline-depth-${outlineDepth(h.level)} press-fb press-fb--row`}
                  aria-label={vaultOutlineRowAria(h.level, h.text)}
                  onClick={() => choose(h, i)}
                >
                  {h.text}
                </button>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </Sheet>
  );
}
