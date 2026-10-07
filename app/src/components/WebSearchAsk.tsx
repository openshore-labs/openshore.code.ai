// Web search asks once (What leaves this device). When a model wants to
// search and the person has not answered yet, this sheet says what would
// leave (the search words, to the search service) and nothing else, then
// remembers a yes on this device. "Not now" lets the model answer from what
// it knows, and the question comes back after the next launch.
import { Sheet } from './Sheet.js';
import { SheetHead } from './SheetHead.js';
import { useApp } from '../state/store.js';
import { hapticCommit } from '../lib/haptics.js';

export function WebSearchAsk() {
  const ask = useApp((s) => s.webSearchAsk);
  const answer = useApp((s) => s.answerWebSearch);
  return (
    <Sheet open={Boolean(ask)} onClose={() => answer(false)}>
      {ask ? (
        <>
          <SheetHead title="Search the web?" onClose={() => answer(false)} />
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
                answer(true);
              }}
            >
              Allow web search
            </button>
            <button type="button" className="btn ghost press-fb" onClick={() => answer(false)}>
              Not now
            </button>
          </div>
          <p className="hint">You can change this any time in Settings, Web search.</p>
        </>
      ) : null}
    </Sheet>
  );
}
