// The verdict on a task's work, in words a person who is not a developer can
// read (v1 Phase 1). The page check says "It works" or "Not yet"; the
// project's own tests say "Checks pass" or "Checks failing". A failure that
// went back to the model reads "Not yet, fixing it", so the last pill of a
// task is its verdict. Green is for a pass and the warning ink for a miss;
// teal and amber stay reserved for local and cloud. The task-done card's pill
// says the same words (`verdictLabel`) and scrolls here by `anchor`.

/** The verdict in words: one place, so the transcript pill and the task-done
 *  card's pill never read differently. */
export function verdictLabel(passed: boolean, check: 'tests' | 'page', retrying = false): string {
  return passed
    ? check === 'page'
      ? 'It works'
      : 'Checks pass'
    : retrying
      ? 'Not yet, fixing it'
      : check === 'page'
        ? 'Not yet'
        : 'Checks failing';
}

export function VerifyPill({
  passed,
  check,
  summary,
  detail,
  retrying,
  anchor,
}: {
  passed: boolean;
  check: 'tests' | 'page';
  summary: string;
  detail?: string;
  retrying: boolean;
  /** The element id the task-done card's pill scrolls to. */
  anchor?: string;
}) {
  const label = verdictLabel(passed, check, retrying);
  // The summary's own opening repeats the label ("It works: ..."), so the
  // line under it keeps only what follows.
  const line = summary.replace(/^(It works|Not yet|Verified|Not verified):\s*/, '');
  return (
    <div className={`verify-pill ${passed ? 'pass' : 'miss'}`} role="status" id={anchor}>
      <span className="verify-pill-label">{label}</span>
      <span className="verify-pill-line">{line}</span>
      {!passed && !retrying && detail ? <pre className="verify-pill-detail">{detail}</pre> : null}
    </div>
  );
}
