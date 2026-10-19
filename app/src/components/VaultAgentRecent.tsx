// "Recently from your agent" (Vault M5, tech review J15): the newest notes tagged
// `crew` (what routines left) and the notes the agent's approved writes named
// on this device, so what the agent wrote is one tap away. Hidden notes never
// show. Rendered at the Vault's root, personal vault only; nothing at all
// when there is nothing to show. The rows step in on the shared stagger
// (.stagger-in with an index), capped at eight steps.
import { useEffect, useState, type CSSProperties } from 'react';
import type { VaultPickerNote } from '../lib/vaultExcerpt.js';
import { relativeTime } from '../lib/relativeTime.js';

export const AGENT_RECENT_TITLE = 'Recently from your agent';

export function VaultAgentRecent({
  load,
  onOpen,
  refreshKey,
}: {
  /** The store's `vaultAgentRecent`. */
  load: () => Promise<VaultPickerNote[]>;
  onOpen: (path: string) => void;
  /** Re-read when this changes (the vault's listing). */
  refreshKey?: string | number;
}) {
  const [notes, setNotes] = useState<VaultPickerNote[]>([]);
  useEffect(() => {
    let live = true;
    void load()
      .then((n) => {
        if (live) setNotes(n);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [load, refreshKey]);
  if (!notes.length) return null;
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-row">
        <h3 style={{ marginBottom: 0 }}>{AGENT_RECENT_TITLE}</h3>
      </div>
      <div className="vault-tree">
        {notes.map((n, i) => (
          <button
            key={n.path}
            type="button"
            className="conv-item vault-row stagger-in press-fb press-fb--row"
            style={{ '--i': Math.min(i, 8) } as CSSProperties}
            onClick={() => onOpen(n.path)}
          >
            <span className="vault-row-chevron" aria-hidden="true" />
            {n.title}
            <span className="sub vault-topsheet">{when(n.updatedAt)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function when(iso: string): string {
  return Number.isNaN(Date.parse(iso)) ? '' : relativeTime(iso);
}
