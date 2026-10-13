// A sheet's header in the house shape (RepoPicker's): the round close button,
// then the title, over a hairline. Every sheet carries one unless its body
// already ends in a Cancel or Done, so the scrim tap and Escape are never the
// only way out (2026-09-03: every page or sheet reached from a main
// page needs a way back to where it started).
// Inside a <Sheet> the title names the dialog: the h2 takes the sheet's title
// id, so a screen reader announces the sheet by it.
import { useContext, useId, useLayoutEffect, type ReactNode } from 'react';
import { CloseGlyph } from './SheetGlyphs.js';
import { SheetTitleContext } from './Sheet.js';

export function SheetHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="mode-head">
      <button type="button" className="mode-close press-fb" aria-label="Close" onClick={onClose}>
        <CloseGlyph />
      </button>
      <SheetTitle>{title}</SheetTitle>
    </div>
  );
}

/** A sheet's title on its own, for a sheet whose way out is its own last
 *  button (the sign-in sheet's Not now, the scanner's Cancel) rather than the round
 *  close. Inside a <Sheet> it names the dialog. */
export function SheetTitle({ children }: { children: ReactNode }) {
  const sheet = useContext(SheetTitleContext);
  const own = useId();
  useLayoutEffect(() => sheet?.claim(), [sheet]);
  return <h2 id={sheet?.id ?? own}>{children}</h2>;
}
