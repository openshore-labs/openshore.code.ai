// The checklist a model list is picked from: a search over the list, then one
// row per model with its box. Cloud Connections' Choose models and the
// Stack's Connect a model both pick from it (2026-10-09), so a list reads the
// same wherever it is picked. The caller owns which models are ticked; the
// search is this list's own.
import { useState } from 'react';
import type { LiveModel } from '../lib/providers.js';

/** The most rows drawn at once; the search narrows a longer list. */
export const MODEL_CHECKLIST_MAX_ROWS = 200;

/** The shortest list that gets a search: a server with a handful of models
 *  (often one) is read at a glance. */
export const MODEL_CHECKLIST_SEARCH_FROM = 8;

export function ModelChecklist({
  models,
  picked,
  onToggle,
  searchId,
}: {
  models: LiveModel[];
  picked: ReadonlySet<string>;
  onToggle: (id: string, on: boolean) => void;
  /** The search field's id, unique on the screen. */
  searchId: string;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = models.filter(
    (m) => !q || m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q),
  );
  return (
    <>
      {models.length >= MODEL_CHECKLIST_SEARCH_FROM ? (
        <div className="field">
          <label htmlFor={searchId}>Search {models.length} models</label>
          <input
            id={searchId}
            value={query}
            placeholder="qwen, claude, coder..."
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      ) : null}
      <div className="live-model-list">
        {shown.slice(0, MODEL_CHECKLIST_MAX_ROWS).map((m) => (
          <label key={m.id} className="live-model-row">
            <input
              type="checkbox"
              checked={picked.has(m.id)}
              onChange={(e) => onToggle(m.id, e.target.checked)}
            />
            <span className="grow">
              <span className="live-model-name">{m.label}</span>
              <span className="sub">
                {m.id}
                {/* Only a list that says so: a plain list claims neither. */}
                {m.tools || m.toolsUnknown ? '' : ' · chat only, no tools'}
              </span>
            </span>
          </label>
        ))}
      </div>
    </>
  );
}
