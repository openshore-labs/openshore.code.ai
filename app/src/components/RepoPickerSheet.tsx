// The repository picker, shared by a project and by a single chat. It draws its
// list from the Repositories section (home repo, gitOS repos, docked desktop
// working copies) through lib/availableRepos, so the same repositories you
// connected there are the ones you attach here. This is the one place "connect
// the two" happens: nothing about a repo is invented in this sheet.
import { useEffect, useState } from 'react';
import { useApp } from '../state/store.js';
import { bridge } from '../lib/electronBridge.js';
import { isDesktop } from '../lib/platform.js';
import { daemonWorkspaces } from '../drivers/remoteDriver.js';
import { availableRepos, type AvailableRepo } from '../lib/availableRepos.js';

export function RepoPickerSheet({
  title,
  subtitle,
  selected,
  onToggle,
  onClose,
  onUseProject,
  inheriting,
}: {
  title: string;
  subtitle?: string;
  /** Ids currently attached (checked). */
  selected: string[];
  /** Attach or detach one repo by id. */
  onToggle: (id: string) => void;
  onClose: () => void;
  /** Chat only: drop the per-chat override and inherit the project's repos. */
  onUseProject?: () => void;
  /** Chat only: whether it is currently inheriting the project. */
  inheriting?: boolean;
}) {
  const { settings, setView } = useApp();
  const [workspaces, setWorkspaces] = useState<Array<{ cwd: string; name: string }>>([]);

  useEffect(() => {
    void (async () => {
      try {
        if (isDesktop() && bridge()) setWorkspaces(await bridge()!.recentWorkspaces());
        else if (settings.daemon) setWorkspaces(await daemonWorkspaces(settings.daemon));
      } catch {
        setWorkspaces([]);
      }
    })();
  }, [settings.daemon]);

  const repos: AvailableRepo[] = availableRepos({
    gitosResources: settings.gitosResources,
    homeRepo: settings.repo?.homeRepo,
    workspaces,
  });

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {subtitle ? <p className="sheet-sub">{subtitle}</p> : null}

        {onUseProject ? (
          <button
            className={`repo-inherit-row${inheriting ? ' on' : ''}`}
            onClick={onUseProject}
          >
            <span className="repo-inherit-main">Use the project's repositories</span>
            <span className="repo-inherit-note">
              {inheriting ? 'On. This chat follows the project.' : 'Reset this chat to the project.'}
            </span>
          </button>
        ) : null}

        {repos.length ? (
          <div className="check-list repo-check-list">
            {repos.map((r) => {
              const on = selected.includes(r.id);
              return (
                <label key={r.id} className="multiselect-row repo-row">
                  <input type="checkbox" checked={on} onChange={() => onToggle(r.id)} />
                  <span className="repo-row-text">
                    <span className="repo-row-name">{r.name}</span>
                    <span className="repo-row-origin">{r.origin}</span>
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <p className="hint" style={{ marginTop: 6 }}>
            No repositories connected yet. Add one in Repositories, then it shows up here.
          </p>
        )}

        <div className="sheet-actions">
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
          <button
            className="btn quiet"
            onClick={() => {
              onClose();
              setView('repos');
            }}
          >
            Manage in Repositories
          </button>
        </div>
      </div>
    </div>
  );
}
