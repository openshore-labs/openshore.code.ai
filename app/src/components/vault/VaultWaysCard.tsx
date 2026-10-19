// How you keep notes (2026-10-19, docs/design/vault-room-clarity-2026-10-19.md): the
// first card in the personal Vault, the same on every device. Open, it lists
// each way with its mark and a Here now; folded (a vault with notes), it is one
// line with Change. The ways and their words are lib/vaultWays.ts; the room
// acts on the row's action.
import type { CSSProperties } from 'react';
import {
  VAULT_WAY_MARKS,
  VAULT_WAYS_CHANGE,
  VAULT_WAYS_SUB,
  VAULT_WAYS_TITLE,
  type VaultWay,
  type VaultWayAction,
} from '../../lib/vaultWays.js';

const stagger = (i: number): CSSProperties => ({ '--i': Math.min(i, 8) }) as CSSProperties;

export function VaultWaysCard({
  ways,
  summary,
  folded,
  busy,
  onUnfold,
  onAct,
}: {
  ways: VaultWay[];
  /** The folded line: where the notes are kept now. */
  summary: string;
  folded: boolean;
  /** A move or a pick is running: every row waits. */
  busy: boolean;
  onUnfold: () => void;
  onAct: (action: VaultWayAction) => void;
}) {
  if (folded) {
    return (
      <div className="card vault-ways" style={{ marginBottom: 14 }}>
        <p className="hint vault-ways-summary">
          {summary}{' '}
          <button type="button" className="linklike press-fb" onClick={onUnfold}>
            {VAULT_WAYS_CHANGE}
          </button>
        </p>
      </div>
    );
  }
  return (
    <section
      className="card vault-ways"
      aria-labelledby="vault-ways-title"
      style={{ marginBottom: 14 }}
    >
      <h3 id="vault-ways-title" style={{ marginBottom: 0 }}>
        {VAULT_WAYS_TITLE}
      </h3>
      <p className="hint" style={{ marginTop: 0 }}>
        {VAULT_WAYS_SUB}
      </p>
      <div className="vault-ways-list">
        {ways.map((way, i) => {
          const acts = !way.here && way.action !== 'none';
          return (
            <div key={way.id} className="vault-provider-row stagger-in" style={stagger(i)}>
              <button
                type="button"
                className="btn ghost vault-provider press-fb"
                disabled={busy}
                aria-current={way.here ? 'true' : undefined}
                onClick={() => {
                  if (acts) onAct(way.action);
                }}
              >
                <span className="grow" style={{ textAlign: 'left' }}>
                  <span className="vault-way-title">
                    {way.title}
                    {way.mark ? (
                      <span className="pill muted">{VAULT_WAY_MARKS[way.mark]}</span>
                    ) : null}
                  </span>
                  <span className="sub" style={{ display: 'block', fontWeight: 400 }}>
                    {way.sub}
                  </span>
                </span>
                {way.here ? (
                  <span className="pill ink">{VAULT_WAY_MARKS.here}</span>
                ) : way.actionLabel && acts ? (
                  <span className="pill ink">{way.actionLabel}</span>
                ) : null}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
