// The approval moment, as a bottom sheet: what the agent wants to do, the
// exact diff or command, and three honest buttons. Cloud spend gets its own
// amber identity so spending money never looks like writing a file.
import { useEffect, useRef } from 'react';
import type { ApprovalRequest } from 'os-code/protocol';
import { hapticApproval } from '../lib/haptics.js';
import { useSheetExit } from '../hooks/useSheetExit.js';
import { DiffBlock } from './ToolCard.js';

export function ApprovalSheet({
  request,
  onAnswer,
}: {
  request: ApprovalRequest;
  onAnswer: (approve: boolean, always?: boolean) => void;
}) {
  const isSpend = request.kind === 'cloud-spend';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => hapticApproval(), [request.id]);
  // Play the exit before the answer propagates, so the sheet never snap-closes.
  const pending = useRef<[boolean, boolean?]>([false]);
  const { closing, dismiss } = useSheetExit(() => onAnswer(...pending.current));
  const answer = (approve: boolean, always?: boolean) => {
    pending.current = [approve, always];
    dismiss();
  };
  return (
    <div className={`sheet-scrim${closing ? ' closing' : ''}`} onClick={() => answer(false)}>
      <div className={`sheet${closing ? ' closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        <span className={`approval-badge ${isSpend ? 'spend' : 'tool'}`}>
          {isSpend ? 'Cloud spend' : `Approve ${request.toolName}`}
        </span>
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
          </button>
          {!isSpend ? (
            <button className="btn ghost press-fb" onClick={() => answer(true, true)}>
              Approve for this session
            </button>
          ) : null}
          <button className="btn quiet press-fb" onClick={() => answer(false)}>
            No, skip it
          </button>
        </div>
      </div>
    </div>
  );
}
