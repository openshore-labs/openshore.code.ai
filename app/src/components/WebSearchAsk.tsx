// Web search asks once (What leaves this device). When a model wants to
// search and the person has not answered yet, this sheet says what would
// leave (the search words, to the search service) and nothing else, then
// remembers a yes on this device. "Not now" lets the model answer from what
// it knows, and the question comes back after the next launch.
//
// Once a chat on a model that stays on this network has read a private note
// (CX and CMO, 2026-10-08, H), every search that model writes asks here, every
// time, on a card with the exact words and why: the approval sheet's always-ask
// words, Approve once and No, skip it, and nothing remembered, so no Settings
// hint either.
import { Sheet } from './Sheet.js';
import { SheetHead } from './SheetHead.js';
import { useApp } from '../state/store.js';
import { hapticCommit } from '../lib/haptics.js';

export function WebSearchAsk() {
  const ask = useApp((s) => s.webSearchAsk);
  const answer = useApp((s) => s.answerWebSearch);
  const once = ask?.private;
  // Each answer names the card it was given on: the sheet keeps its last
  // card drawn while it slides away, and a tap there answers nothing.
  return (
    <Sheet open={Boolean(ask)} onClose={() => answer(false, ask)}>
      {ask && once ? (
        <>
          <SheetHead title={once.summary} onClose={() => answer(false, ask)} />
          <p className="sheet-sub">{once.detail}</p>
          <div className="sheet-actions">
            <button
              type="button"
              className="btn primary press-fb"
              onClick={() => {
                hapticCommit();
                answer(true, ask);
              }}
            >
              Approve once
            </button>
            <button type="button" className="btn ghost press-fb" onClick={() => answer(false, ask)}>
              No, skip it
            </button>
          </div>
        </>
      ) : ask ? (
        <>
          <SheetHead title="Search the web?" onClose={() => answer(false, ask)} />
          <p className="sheet-sub">
            To answer, the model wants to search for &ldquo;{ask.query}&rdquo;. Those words go to
            the search service, DuckDuckGo unless you set your own in Settings. Nothing else from
            your chat goes with them.
          </p>
          <div className="sheet-actions">
            <button
              type="button"
              className="btn primary press-fb"
              onClick={() => {
                hapticCommit();
                answer(true, ask);
              }}
            >
              Allow web search
            </button>
            <button type="button" className="btn ghost press-fb" onClick={() => answer(false, ask)}>
              Not now
            </button>
          </div>
          <p className="hint">You can change this any time in Settings, Web search.</p>
        </>
      ) : null}
    </Sheet>
  );
}
