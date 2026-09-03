// A settings block collapsed to its title: tap to read the full explanation
// in a sheet, drag it down (or tap the scrim, or the close button) to put it
// away. Keeps the settings page scannable without cutting any of the honest
// copy. The bottom-sheet mechanics (rise, drag-to-dismiss, exit, scrim dim)
// all live in the shared Sheet now, so this is just the trigger and the body.
import { useState, type ReactNode } from 'react';
import { Sheet } from './Sheet.js';
import { SheetHead } from './SheetHead.js';

export function InfoSheet({
  title,
  children,
  renderTrigger,
}: {
  title: string;
  children: ReactNode;
  /** Replace the default disclosure card with your own opener (a settings
   *  row, say). Receives the open function. */
  renderTrigger?: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      {renderTrigger ? (
        renderTrigger(() => setOpen(true))
      ) : (
        <button
          type="button"
          className="card card-disclosure press-fb press-fb--row"
          onClick={() => setOpen(true)}
        >
          <h3>{title}</h3>
          <span className="disclosure-chevron" aria-hidden="true" />
        </button>
      )}
      <Sheet open={open} onClose={close}>
        <SheetHead title={title} onClose={close} />
        <div className="sub">{children}</div>
      </Sheet>
    </>
  );
}
