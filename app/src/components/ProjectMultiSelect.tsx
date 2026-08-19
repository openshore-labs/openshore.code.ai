// A multi-select checkbox dropdown of projects, with search. "All" is the
// first option and the default: an empty selection means every project, now
// and any added later. Picking specific projects narrows to just those.
import { useMemo, useState } from 'react';
import type { Project } from '../state/types.js';

export function ProjectMultiSelect({
  projects,
  selected,
  onChange,
}: {
  projects: Project[];
  /** Selected project ids. Empty array means "All projects". */
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const sorted = useMemo(
    () => [...projects].sort((a, b) => a.name.localeCompare(b.name)),
    [projects],
  );
  const filtered = useMemo(
    () => sorted.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase())),
    [sorted, query],
  );

  const allSelected = selected.length === 0;
  const selectedNames = sorted.filter((p) => selected.includes(p.id)).map((p) => p.name);
  const summary = allSelected
    ? 'All projects'
    : selectedNames.length <= 2
      ? selectedNames.join(', ')
      : `${selectedNames.length} projects`;

  const toggle = (id: string) => {
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    onChange(next);
  };

  return (
    <div className="multiselect">
      <button
        type="button"
        className="multiselect-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="multiselect-summary">{summary}</span>
        <span className="multiselect-caret">{open ? '▴' : '▾'}</span>
      </button>
      {open ? (
        <div className="multiselect-panel">
          <input
            className="multiselect-search"
            placeholder="Search projects"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <label className="multiselect-row">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => onChange([])}
            />
            <span>All projects</span>
          </label>
          <div className="multiselect-list">
            {filtered.length === 0 ? (
              <p className="hint" style={{ padding: '6px 10px', margin: 0 }}>
                {projects.length === 0 ? 'No projects yet.' : 'No match.'}
              </p>
            ) : (
              filtered.map((p) => (
                <label key={p.id} className="multiselect-row">
                  <input
                    type="checkbox"
                    checked={selected.includes(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                  <span>{p.name}</span>
                </label>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
