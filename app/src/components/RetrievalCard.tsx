// Retrieval before turn one (tech review 6): the places in the code the harness gave
// a local seat before it started, "Started from 2 places in your code", each
// by file and first line. Built on the Vault context card's teal frame, since
// it only runs for a seat that stays on this network, and it arrives the way
// every transcript card does. Every line is from lib/harnessCopy.ts, and none
// claims the lift helps (tenet 2).
import type { ThreadItem } from '../state/types.js';
import { RETRIEVAL_SEAT, retrievalHeadline, retrievalPlace } from '../lib/harnessCopy.js';

export function RetrievalCard({ item }: { item: Extract<ThreadItem, { kind: 'retrieval' }> }) {
  if (!item.sources.length) return null;
  return (
    <div className="context-pack-card local retrieval-card" role="status">
      <div className="context-pack-head">
        <span className="context-pack-title">{retrievalHeadline(item.sources.length)}</span>
        <span className="context-pack-seat">{RETRIEVAL_SEAT}</span>
      </div>
      <ul className="context-pack-list">
        {item.sources.map((s) => (
          <li key={`${s.path}:${s.line}`} className="context-pack-note" title={s.path}>
            {retrievalPlace(s.path, s.line)}
          </li>
        ))}
      </ul>
    </div>
  );
}
