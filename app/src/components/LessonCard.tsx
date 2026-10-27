// A lesson the project's harness proposes after a task with a setback
// (state/lessonOps.ts): the one line, where it came from, and Keep, which is
// the only thing that makes it standing context for the project's chats.
// Built on the plan card's frame, like the app action card.
import { useApp } from '../state/store.js';
import type { ThreadItem } from '../state/types.js';
import { hapticApproval } from '../lib/haptics.js';

export function LessonCard({ item }: { item: Extract<ThreadItem, { kind: 'lesson' }> }) {
  const activeId = useApp((s) => s.activeId);
  const keepLesson = useApp((s) => s.keepLesson);
  const dismissLesson = useApp((s) => s.dismissLesson);
  // Let go: the card steps aside to one quiet line, so the chat keeps its
  // record without the offer.
  if (item.status === 'dismissed') {
    return <div className="msg-status">Lesson not kept.</div>;
  }
  const kept = item.status === 'kept';
  return (
    <div className={`plan-card app-action-card ${kept ? 'approved' : 'proposed'}`}>
      <div className="plan-head">
        <span className="plan-badge">Lesson</span>
        <span className="plan-sub">
          {kept
            ? 'Kept. Project Wayfinder lists it, and chats here follow it.'
            : `From ${item.source}. Nothing is kept until you tap Keep.`}
        </span>
      </div>
      <div className="plan-body app-action-value">{item.text}</div>
      {kept || !activeId ? null : (
        <div className="plan-actions">
          <button
            type="button"
            className="btn primary press-fb"
            onClick={() => {
              hapticApproval();
              void keepLesson(activeId, item.id);
            }}
          >
            Keep
          </button>
          <button
            type="button"
            className="btn ghost press-fb"
            onClick={() => dismissLesson(activeId, item.id)}
          >
            Not this one
          </button>
        </div>
      )}
    </div>
  );
}
