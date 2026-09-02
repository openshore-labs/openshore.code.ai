// The approval moment, as a bottom sheet: what the agent wants to do, the
// exact diff or command, and honest buttons. Cloud spend gets its own amber
// identity so spending money never looks like writing a file. When several
// questions stack up the sheet counts them ("1 of 3") and offers to answer
// them all; on an engine session a path-bearing tool can be allowed for the
// whole project, the Claude Code "don't ask again". The keyboard answers too:
// y approves, a allows for the session, n declines.
import { useEffect, useRef } from 'react';
import type { ApprovalRequest, PermissionMode } from 'os-code/protocol';
import { hapticApproval } from '../lib/haptics.js';
import { useSheetExit } from '../hooks/useSheetExit.js';
import { permissionModeLabel } from '../lib/permissionMode.js';
import { DiffBlock } from './ToolCard.js';

export function ApprovalSheet({
  request,
  index,
  total,
  agent,
  mode,
  onAnswer,
  onAnswerAll,
  onOpenMode,
}: {
  request: ApprovalRequest;
  /** This question's place in the pending stack, 0-based. */
  index: number;
  total: number;
  /** An engine session: the project-wide allow is available. */
  agent: boolean;
  mode: PermissionMode;
  onAnswer: (approve: boolean, always?: boolean, inProject?: boolean) => void;
  onAnswerAll: (approve: boolean) => void;
  onOpenMode: () => void;
}) {
  const isSpend = request.kind === 'cloud-spend';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => hapticApproval(), [request.id]);
  // Play the exit before the answer propagates, so the sheet never snap-closes.
  const pending = useRef<() => void>(() => {});
  const { closing, dismiss } = useSheetExit(() => pending.current());
  const answer = (approve: boolean, always?: boolean, inProject?: boolean) => {
    pending.current = () => onAnswer(approve, always, inProject);
    dismiss();
  };
  const answerAll = (approve: boolean) => {
    pending.current = () => onAnswerAll(approve);
    dismiss();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'y' || e.key === 'Y') answer(true);
      else if ((e.key === 'a' || e.key === 'A') && !isSpend) answer(true, true);
      else if (e.key === 'n' || e.key === 'N' || e.key === 'Escape') answer(false);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id, isSpend]);

  // A tool that names a file or a command can be allowed for the project. The
  // engine scopes the rule (the path's directory, the command's first word).
  const projectAllowable =
    agent &&
    !isSpend &&
    /^(editFile|writeFile|runShell|readFile|gitCommit)$/.test(request.toolName);

  return (
    <div className={`sheet-scrim${closing ? ' closing' : ''}`} onClick={() => answer(false)}>
      <div
        className={`sheet approval-sheet${closing ? ' closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="approval-head">
          <span className={`approval-badge ${isSpend ? 'spend' : 'tool'}`}>
            {isSpend ? 'Cloud spend' : `Approve ${request.toolName}`}
          </span>
          {total > 1 ? (
            <span className="approval-count">
              {index + 1} of {total}
            </span>
          ) : null}
        </div>
        <h2>{request.summary}</h2>
        {request.detail ? (
          request.detail.includes('\n') ? (
            <DiffBlock text={request.detail} />
          ) : (
            <p className="sheet-sub">{request.detail}</p>
          )
        ) : null}
        <div className="sheet-actions">
          <button
            className={`btn press-fb ${isSpend ? 'cloud' : 'primary'}`}
            onClick={() => answer(true)}
          >
            {isSpend ? 'Approve this spend' : 'Approve once'}
            <kbd className="approval-key">y</kbd>
          </button>
          {!isSpend ? (
            <button className="btn ghost press-fb" onClick={() => answer(true, true)}>
              Approve for this session
              <kbd className="approval-key">a</kbd>
            </button>
          ) : null}
          {projectAllowable ? (
            <button className="btn ghost press-fb" onClick={() => answer(true, true, true)}>
              Always allow this in the project
            </button>
          ) : null}
          {total > 1 ? (
            <button className="btn ghost press-fb" onClick={() => answerAll(true)}>
              Approve all {total}
            </button>
          ) : null}
          <button className="btn quiet press-fb" onClick={() => answer(false)}>
            No, skip it
            <kbd className="approval-key">n</kbd>
          </button>
        </div>
        {agent ? (
          <button type="button" className="approval-mode press-fb" onClick={onOpenMode}>
            Mode: {permissionModeLabel(mode)}. Change
          </button>
        ) : null}
      </div>
    </div>
  );
}
