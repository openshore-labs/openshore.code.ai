// The plan-first flow's clarifying-question picker. When the reasoning LLM needs
// the framing settled before it draws the play, it asks here. Each question can
// carry suggested options as tappable chips; tapping one sends it as the reply,
// and typing a free answer in the composer works too. The reply is folded back
// into the framing (see stackDriver.ts, pendingClarify).
export function ClarifyCard({
  summary,
  questions,
  onPick,
}: {
  summary: string;
  questions: Array<{ id: string; question: string; options?: string[] }>;
  onPick?: (text: string) => void;
}) {
  return (
    <div className="clarify-card">
      {summary ? <div className="clarify-summary">{summary}</div> : null}
      <div className="clarify-lead">A couple of things to get the framing right:</div>
      {questions.map((q) => (
        <div key={q.id} className="clarify-q">
          <div className="clarify-question">{q.question}</div>
          {q.options?.length ? (
            <div className="clarify-options">
              {q.options.map((o) => (
                <button
                  key={o}
                  type="button"
                  className="clarify-option press-fb press-fb--tile"
                  onClick={() => onPick?.(o)}
                >
                  {o}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
      <div className="clarify-hint">Tap an option, or type your answer.</div>
    </div>
  );
}
