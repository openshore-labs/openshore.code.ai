// The approval moment, as a bottom sheet: what the agent wants to do, the
// exact diff or command, and three honest buttons. Cloud spend gets its own
// amber identity so spending money never looks like writing a file.
import { useEffect } from 'react';
import type { ApprovalRequest } from 'os-code/protocol';
import { hapticApproval } from '../lib/haptics.js';
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
  return (
    <div className="sheet-scrim" onClick={() => onAnswer(false)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
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
          <button className={`btn ${isSpend ? 'cloud' : 'primary'}`} onClick={() => onAnswer(true)}>
            {isSpend ? 'Approve this spend' : 'Approve once'}
          </button>
          {!isSpend ? (
            <button className="btn ghost" onClick={() => onAnswer(true, true)}>
              Approve for this session
            </button>
          ) : null}
          <button className="btn quiet" onClick={() => onAnswer(false)}>
            No, skip it
          </button>
        </div>
      </div>
    </div>
  );
}
