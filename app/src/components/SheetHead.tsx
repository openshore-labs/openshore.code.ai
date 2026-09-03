// A sheet's header in the house shape (RepoPicker's): the round close button,
// then the title, over a hairline. Every sheet carries one unless its body
// already ends in a Cancel or Done, so the scrim tap and Escape are never the
// only way out (founder, 2026-09-03: every page or sheet reached from a main
// page needs a way back to where it started).
import { CloseGlyph } from './SheetGlyphs.js';

export function SheetHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="mode-head">
      <button type="button" className="mode-close press-fb" aria-label="Close" onClick={onClose}>
        <CloseGlyph />
      </button>
      <h2>{title}</h2>
    </div>
  );
}
