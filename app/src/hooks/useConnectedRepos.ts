// The repositories connected to this account, gathered for the repo picker:
// the paired computer's workspaces (or this computer's, in the desktop app)
// and every connected platform's repositories (GitHub, GitLab, Bitbucket) on
// its stored token. Loads when asked (`enabled`), serves the device cache
// first, refreshes behind it, and refreshes again when the person comes back
// to the app (they may have just changed what GitHub lets OpenShore see).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store.js';
import { bridge } from '../lib/electronBridge.js';
import { daemonWorkspaces } from '../drivers/remoteDriver.js';
import { REPO_CONNECTORS, type RepoPlatform } from '../lib/repos.js';
import { githubAppSlug, repoToken } from '../lib/gitos/repoOAuth.js';
import { computerFor } from '../lib/repoClone.js';
import { plainError } from '../lib/plainError.js';
import {
  githubAccess,
  githubAccessHint,
  listRemoteRepos,
  readRepoCache,
  remoteIdFromUrl,
  writeRepoCache,
  type RepoAccessHint,
  type RepoOption,
} from '../lib/chatRepos.js';

export interface ConnectedRepos {
  workspaces: RepoOption[];
  /** Every connected platform's repositories, GitHub first. */
  remote: RepoOption[];
  /** A computer is reachable: this desktop's engine, or a paired computer. */
  hasComputer: boolean;
  /** At least one platform (GitHub, GitLab, Bitbucket) is connected. */
  hasPlatform: boolean;
  loading: boolean;
  /** A platform that could not be listed, as a sentence that names the fix. */
  error?: string;
  /** Why a GitHub repository might be missing, and where on GitHub to fix it. */
  access?: RepoAccessHint;
  refresh: () => void;
}

const PLATFORM_ORDER: readonly RepoPlatform[] = REPO_CONNECTORS.map((c) => c.id);

export function useConnectedRepos(enabled: boolean): ConnectedRepos {
  const daemon = useApp((s) => s.settings.daemon);
  const preferRemoteHub = useApp((s) => s.settings.preferRemoteHub);
  const platforms = useApp((s) => s.connectedRepoPlatforms);
  const connected = PLATFORM_ORDER.filter((p) => platforms[p]);
  const connectedKey = connected.join(',');
  const where = computerFor({ daemon, preferRemoteHub });
  const [workspaces, setWorkspaces] = useState<RepoOption[]>([]);
  const [remote, setRemote] = useState<RepoOption[]>(() => readRepoCache() ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [access, setAccess] = useState<RepoAccessHint | undefined>();
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setLoading(true);
    setError(undefined);
    const list = connectedKey ? (connectedKey.split(',') as RepoPlatform[]) : [];
    void (async () => {
      try {
        const rows =
          where === 'local'
            ? await bridge()!.recentWorkspaces()
            : where === 'paired' && daemon
              ? await daemonWorkspaces(daemon)
              : [];
        if (live) setWorkspaces(rows.map(asWorkspace));
      } catch {
        if (live) setWorkspaces([]);
      }
      const results = await Promise.allSettled(
        list.map(async (platform) => {
          const token = await repoToken(platform);
          if (!token) return { platform, rows: [] as RepoOption[], token };
          return { platform, rows: await listRemoteRepos(platform, token), token };
        }),
      );
      if (!live) return;
      const failed = new Set<RepoPlatform>();
      const fresh = new Map<RepoPlatform, RepoOption[]>();
      let firstError: string | undefined;
      let githubToken: string | undefined;
      results.forEach((r, i) => {
        const platform = list[i]!;
        if (r.status === 'fulfilled') {
          fresh.set(platform, r.value.rows);
          if (platform === 'github') githubToken = r.value.token;
        } else {
          failed.add(platform);
          firstError ??= plainError(r.reason);
        }
      });
      setRemote((prev) => {
        // A platform that failed keeps the rows it had; one that is no longer
        // connected loses them.
        const next = list.flatMap(
          (p) => fresh.get(p) ?? (failed.has(p) ? prev.filter((r) => r.kind === p) : []),
        );
        writeRepoCache(next);
        return next;
      });
      setError(firstError);
      setLoading(false);
      // Why a GitHub list can look short: asked only after the list itself
      // came back, so an expired sign-in shows its own line, not this one.
      const probe = githubToken
        ? await githubAccess(githubToken).catch(() => undefined)
        : undefined;
      if (live) setAccess(githubToken ? githubAccessHint(probe, githubAppSlug()) : undefined);
    })();
    return () => {
      live = false;
    };
  }, [enabled, daemon, where, connectedKey, tick]);

  // Back from GitHub (or any other app) with the picker open: read again, at
  // most once every few seconds.
  const lastFocus = useRef(0);
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const onBack = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastFocus.current < 5000) return;
      lastFocus.current = now;
      refresh();
    };
    window.addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    return () => {
      window.removeEventListener('focus', onBack);
      document.removeEventListener('visibilitychange', onBack);
    };
  }, [enabled, refresh]);

  return {
    workspaces,
    remote: remote.filter((r) => r.kind !== 'workspace' && platforms[r.kind]),
    hasComputer: where !== undefined,
    hasPlatform: connected.length > 0,
    loading,
    error,
    access,
    refresh,
  };
}

function asWorkspace(ws: { cwd: string; name: string; remote?: string }): RepoOption {
  const remoteId = remoteIdFromUrl(ws.remote);
  return {
    id: ws.cwd,
    kind: 'workspace',
    name: ws.name,
    detail: ws.cwd,
    ...(remoteId ? { remoteId } : {}),
  };
}
