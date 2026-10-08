// The approval moment, as a bottom sheet: what the agent wants to do, the
// exact diff or command, and honest buttons. Cloud spend gets its own amber
// identity so spending money never looks like writing a file. When several
// questions stack up the sheet counts them ("1 of 3") and offers to answer
// them all; on an engine session a path-bearing tool can be allowed for the
// whole project, the Claude Code "don't ask again". An always-ask tool (a
// vault write) asks every time whatever was allowed before, so it gets no
// standing allow at all, only once or skip. The keyboard answers too: y
// approves, a allows for the session, n declines.
//
// While the chat can see the project's secrets, every card says so (CX 7). A
// commit card lists the files it would stage with a tick each, and the ones
// that may hold a secret start unticked (CommitFileList); the answer carries
// the ticked list, so the commit records exactly those.
import { useEffect, useRef, useState } from 'react';
import type { ApprovalRequest, PermissionMode } from 'os-code/protocol';
import { hapticApproval } from '../lib/haptics.js';
import { useSheetExit } from '../hooks/useSheetExit.js';
import { permissionModeLabel } from '../lib/permissionMode.js';
import { DiffBlock } from './ToolCard.js';
import { toolActionLabel } from '../lib/toolVerbs.js';
import { LOCKDOWN_LINE } from '../lib/securityCopy.js';
import { CommitFileList, defaultTicked } from './CommitFileList.js';

/** The request as the sheet reads it. `alwaysAsk` is the engine's additive
 *  field (plan 1.6), named here as well so the sheet compiles against an
 *  engine build that predates it; absent reads as a plain request. */
type SheetRequest = ApprovalRequest & { alwaysAsk?: boolean };

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
  request: SheetRequest;
  /** This question's place in the pending stack, 0-based. */
  index: number;
  total: number;
  /** An engine session: the project-wide allow is available. */
  agent: boolean;
  mode: PermissionMode;
  /** `files` is the ticked list on a commit card, absent on any other. */
  onAnswer: (approve: boolean, always?: boolean, inProject?: boolean, files?: string[]) => void;
  onAnswerAll: (approve: boolean) => void;
  onOpenMode: () => void;
}) {
  const isSpend = request.kind === 'cloud-spend';
  // An always-ask tool prompts before every run, so an allow for the session
  // or the project would never take effect. Only once or skip are honest.
  const standingAllow = !isSpend && request.alwaysAsk !== true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => hapticApproval(), [request.id]);
  // Play the exit before the answer propagates, so the sheet never snap-closes.
  const pending = useRef<() => void>(() => {});
  const { closing, dismiss } = useSheetExit(() => pending.current());
  // With more questions behind this one the sheet stays up and the content
  // swaps (keyed on the request), instead of bouncing closed and open.
  const more = index + 1 < total;
  // The commit card's ticks, kept per request so the next card in a stack
  // starts from its own defaults (no effect, no flash of the last card's).
  const commit = request.commit;
  const [pick, setPick] = useState<{ id: string; files: Set<string> } | undefined>();
  const ticked =
    commit && pick?.id === request.id ? pick.files : commit ? defaultTicked(commit) : undefined;
  const tickedRef = useRef(ticked);
  tickedRef.current = ticked;
  const toggle = (path: string) => {
    const next = new Set(ticked);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setPick({ id: request.id, files: next });
  };
  const answer = (approve: boolean, always?: boolean, inProject?: boolean) => {
    // Read through the ref: the keyboard handler below outlives a render.
    const files = approve && tickedRef.current ? [...tickedRef.current] : undefined;
    if (more) {
      onAnswer(approve, always, inProject, files);
      return;
    }
    pending.current = () => onAnswer(approve, always, inProject, files);
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
      else if ((e.key === 'a' || e.key === 'A') && standingAllow) answer(true, true);
      else if (e.key === 'n' || e.key === 'N' || e.key === 'Escape') answer(false);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id, standingAllow]);

  // A tool that names a file or a command can be allowed for the project. The
  // engine scopes the rule (the path's directory, the command's first word).
  const projectAllowable =
    agent &&
    standingAllow &&
    /^(editFile|writeFile|runShell|readFile|gitCommit)$/.test(request.toolName);

  return (
    <div className={`sheet-scrim${closing ? ' closing' : ''}`} onClick={() => answer(false)}>
      <div
        className={`sheet approval-sheet${closing ? ' closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Approval required"
        onClick={(e) => e.stopPropagation()}
      >
        <div key={request.id} className="approval-body">
          <div className="approval-head">
            <span className={`approval-badge ${isSpend ? 'spend' : 'tool'}`}>
              {isSpend ? 'Cloud spend' : toolActionLabel(request.toolName)}
            </span>
            {total > 1 ? (
              <span className="approval-count">
                {index + 1} of {total}
              </span>
            ) : null}
          </div>
          <h2>{request.summary}</h2>
          {request.lockdown ? <p className="approval-lockdown">{LOCKDOWN_LINE}</p> : null}
          {/* Why this card asks when it otherwise would not (a project note
              change after the chat read a private note, CX and CMO
              2026-10-08, A), above the detail or diff. An older engine sends
              none. */}
          {request.why ? <p className="sheet-sub">{request.why}</p> : null}
          {commit && ticked ? (
            <>
              <p className="sheet-sub">Message: {commit.message}</p>
              <CommitFileList commit={commit} ticked={ticked} onToggle={toggle} />
            </>
          ) : request.detail ? (
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
            {/* Ordered by how often each is the right answer: once, then the
              standing project rule, then the session-only allow. */}
            {projectAllowable ? (
              <button className="btn ghost press-fb" onClick={() => answer(true, true, true)}>
                Always allow this in the project
              </button>
            ) : null}
            {standingAllow ? (
              <button className="btn ghost press-fb" onClick={() => answer(true, true)}>
                Approve for this session
                <kbd className="approval-key">a</kbd>
              </button>
            ) : null}
            {total > 1 ? (
              <button className="btn ghost press-fb" onClick={() => answerAll(true)}>
                Approve all {total}
              </button>
            ) : null}
            <button className="btn quiet approval-skip press-fb" onClick={() => answer(false)}>
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
    </div>
  );
}
