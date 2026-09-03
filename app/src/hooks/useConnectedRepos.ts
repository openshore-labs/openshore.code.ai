// The repositories connected to this account, gathered for the repo picker:
// the paired computer's workspaces (or this computer's, in the desktop app)
// and the connected GitHub account's repositories on its stored token. Loads
// when asked (`enabled`), serves the device cache first, refreshes behind it.
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../state/store.js';
import { bridge } from '../lib/electronBridge.js';
import { isDesktop, secretGet } from '../lib/platform.js';
import { daemonWorkspaces } from '../drivers/remoteDriver.js';
import { repoSecretKey } from '../lib/repos.js';
import {
  listGitHubRepos,
  readRepoCache,
  writeRepoCache,
  type RepoOption,
} from '../lib/chatRepos.js';

export interface ConnectedRepos {
  workspaces: RepoOption[];
  github: RepoOption[];
  /** A computer is paired (or this is the desktop app). */
  hasComputer: boolean;
  /** A GitHub token is stored. */
  hasGithub: boolean;
  loading: boolean;
  error?: string;
  refresh: () => void;
}

export function useConnectedRepos(enabled: boolean): ConnectedRepos {
  const daemon = useApp((s) => s.settings.daemon);
  const hasGithub = useApp((s) => Boolean(s.connectedRepoPlatforms.github));
  const hasComputer = Boolean(daemon) || (isDesktop() && Boolean(bridge()));
  const [workspaces, setWorkspaces] = useState<RepoOption[]>([]);
  const [github, setGithub] = useState<RepoOption[]>(() => readRepoCache() ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setLoading(true);
    setError(undefined);
    void (async () => {
      try {
        if (isDesktop() && bridge()) {
          const rows = await bridge()!.recentWorkspaces();
          if (live) setWorkspaces(rows.map(asWorkspace));
        } else if (daemon) {
          const rows = await daemonWorkspaces(daemon);
          if (live) setWorkspaces(rows.map(asWorkspace));
        }
      } catch {
        if (live) setWorkspaces([]);
      }
      try {
        if (hasGithub) {
          const token = await secretGet(repoSecretKey('github'));
          if (token) {
            const rows = await listGitHubRepos(token);
            writeRepoCache(rows);
            if (live) setGithub(rows);
          }
        }
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : String(err));
      }
      if (live) setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [enabled, daemon, hasGithub, tick]);

  return { workspaces, github, hasComputer, hasGithub, loading, error, refresh };
}

function asWorkspace(ws: { cwd: string; name: string }): RepoOption {
  return { id: ws.cwd, kind: 'workspace', name: ws.name, detail: ws.cwd };
}
