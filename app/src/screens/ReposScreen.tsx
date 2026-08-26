// Repositories: connect GitHub and other platforms on your own token, set the
// home repo the whole system works through, and see anything buffered while you
// were off-home. Below that, the desktop clone/open flow: point OpenShore at a
// repo and it reads, edits, tests, and commits there with your approval.
import { useEffect, useState } from 'react';
import { isOrgAdmin, useApp } from '../state/store.js';
import { bridge } from '../lib/electronBridge.js';
import { isDesktop } from '../lib/platform.js';
import { daemonCloneRepo, daemonWorkspaces } from '../drivers/remoteDriver.js';
import {
  homeRepoReady,
  REPO_CONNECTORS,
  type BackupInterval,
  type HomeRepo,
  type RepoPlatform,
  type RepoRecord,
} from '../lib/repos.js';
import { describeLocation, locationParent, type StorageLocation } from '../lib/gitos/location.js';
import { bufferHealth, unsyncedCount } from '../lib/repoSync.js';
import { BackBar } from '../components/BackBar.js';

// The phone-to-home commit-offload pipeline (home repo + buffered deploys). Now
// revealed: the storage-location picker registers each repo home into the
// outbox allowlist as it clones (the guardrail the CTO required before this
// could go live), and the homePath picker in HomeRepoEditor gives Sync a real
// target. The store actions and the desktop apply engine were already built and
// tested; this exposes them.
const REPO_OUTBOX_ENABLED = true;

export function ReposScreen() {
  const {
    settings,
    connectedRepoPlatforms,
    connectRepoPlatform,
    disconnectRepoPlatform,
    setHomeRepo,
    syncOutbox,
    exportBuffer,
    registerClonedRepo,
    runDueBackups,
    newConversation,
    showToast,
  } = useApp();
  const [workspaces, setWorkspaces] = useState<Array<{ cwd: string; name: string }>>([]);
  const [url, setUrl] = useState('');
  const [cloning, setCloning] = useState(false);
  const [connecting, setConnecting] = useState<string | undefined>();
  const [tokenValue, setTokenValue] = useState('');
  const [editingHome, setEditingHome] = useState(false);
  // Where a newly cloned repo's bytes live: this device by default, or a folder
  // the user picks (a local disk, a NAS, a Tailscale mount). Cloud drives are a
  // backup target, not a live repo home, so they are not offered here.
  const [locationKind, setLocationKind] = useState<'device' | 'folder'>('device');
  const [folderPath, setFolderPath] = useState('');

  const connected = isDesktop() || Boolean(settings.daemon);
  const admin = isOrgAdmin(settings.account);
  const homeRepo = settings.repo?.homeRepo;
  const outbox = settings.repo?.outbox ?? [];
  const repos = settings.repo?.repos ?? [];
  const unsynced = unsyncedCount(outbox);

  // Opportunistic scheduler: any repo whose scheduled backup is due gets a
  // mirror run when this screen opens. There is no reliable background cron on
  // the phone, so backups ride the moments the box is reachable.
  useEffect(() => {
    if (connected) void runDueBackups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const refresh = async () => {
    try {
      if (isDesktop() && bridge()) setWorkspaces(await bridge()!.recentWorkspaces());
      else if (settings.daemon) setWorkspaces(await daemonWorkspaces(settings.daemon));
    } catch {
      setWorkspaces([]);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.daemon]);

  const location: StorageLocation =
    locationKind === 'folder' ? { kind: 'folder', path: folderPath.trim() } : { kind: 'device' };
  const locationReady = locationKind === 'device' || folderPath.trim().length > 0;

  const pickFolderFor = async (set: (p: string) => void) => {
    const b = bridge();
    if (!b) return;
    const chosen = await b.pickFolder();
    if (chosen) set(chosen);
  };

  const clone = async () => {
    const cleaned = url.trim();
    if (!cleaned || !locationReady) return;
    const parent = locationParent(location);
    setCloning(true);
    try {
      let result: { cwd: string; name: string; defaultBranch: string };
      if (isDesktop() && bridge()) {
        const r = await bridge()!.cloneRepo(cleaned, parent);
        if ('error' in r) throw new Error(r.error);
        result = r;
      } else if (settings.daemon) {
        result = await daemonCloneRepo(settings.daemon, cleaned, parent);
      } else {
        throw new Error('Connect your desktop first; repos live there.');
      }
      // Track the repo and where it lives, so it reconnects and can be backed up.
      await registerClonedRepo({
        name: result.name,
        cwd: result.cwd,
        location,
        remoteUrl: cleaned,
        defaultBranch: result.defaultBranch,
      });
      showToast(`${result.name} is ready on ${describeLocation(location)}.`);
      setUrl('');
      await refresh();
      await newConversation({ kind: 'desktop', cwd: result.cwd, repoName: result.name });
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setCloning(false);
    }
  };

  const saveConnection = async (id: RepoPlatform, name: string) => {
    const key = tokenValue.trim();
    setConnecting(undefined);
    setTokenValue('');
    if (!key) return;
    await connectRepoPlatform(id, key);
    showToast(`${name} connected. Its repos are reachable on your token.`);
  };

  return (
    <div className="screen">
      <BackBar title="Repositories" />
      <div className="screen-inner">
        <h1>Repositories</h1>
        <p className="lead">
          Connect GitHub or another platform on your own token. OpenShore reads, edits, tests, and
          commits with your approval on every change.
        </p>

        {/* Connect a platform. */}
        <h3 style={{ margin: '4px 0 10px' }}>Connect a platform</h3>
        {REPO_CONNECTORS.map((c) => {
          const on = Boolean(connectedRepoPlatforms[c.id]);
          return (
            <div className="card" key={c.id}>
              <div className="card-row">
                <div className="grow">
                  <h3>{c.name}</h3>
                  <div className="sub">Token looks like {c.keyHint}</div>
                </div>
                {on ? <span className="pill ok">connected</span> : null}
                {on ? (
                  <button
                    className="btn ghost"
                    style={{ padding: '8px 14px' }}
                    onClick={async () => {
                      await disconnectRepoPlatform(c.id);
                      showToast(`${c.name} disconnected.`);
                    }}
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    className="btn ghost"
                    style={{ padding: '8px 14px' }}
                    onClick={() => {
                      setConnecting(c.id);
                      setTokenValue('');
                    }}
                  >
                    Connect
                  </button>
                )}
              </div>
              {connecting === c.id ? (
                <div style={{ marginTop: 12 }}>
                  <div className="field">
                    <input
                      autoFocus
                      type="password"
                      placeholder={c.keyHint}
                      value={tokenValue}
                      onChange={(e) => setTokenValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void saveConnection(c.id, c.name)}
                      autoCapitalize="none"
                      autoCorrect="off"
                    />
                  </div>
                  <button
                    className="btn primary"
                    style={{ width: '100%' }}
                    onClick={() => void saveConnection(c.id, c.name)}
                  >
                    Save token
                  </button>
                  <p className="hint" style={{ marginTop: 8 }}>
                    Create one at {c.tokenUrl}. It stays in this device Keychain, never in a log.
                  </p>
                </div>
              ) : null}
            </div>
          );
        })}

        {/* Home repo. Hidden until the offload producer + homePath picker land. */}
        {REPO_OUTBOX_ENABLED ? (
          <>
            <h3 style={{ margin: '18px 0 10px' }}>Home repo</h3>
            <div className="card">
              <div className="card-row">
                <div className="grow">
                  <h3>{homeRepo ? homeRepo.label : 'Not set up yet'}</h3>
                  <div className="sub">
                    {homeRepo
                      ? `${homeRepo.kind === 'home' ? 'On your home system' : homeRepo.kind} · ${homeRepo.defaultBranch}`
                      : 'The one place the whole system works through, like your home LLM. Off-home deploys buffer, then land here when you dock.'}
                  </div>
                </div>
                {admin ? (
                  <button
                    className="btn ghost"
                    style={{ padding: '8px 14px' }}
                    onClick={() => setEditingHome((v) => !v)}
                  >
                    {homeRepo ? 'Change' : 'Set up'}
                  </button>
                ) : null}
              </div>
              {editingHome && admin ? (
                <HomeRepoEditor
                  initial={homeRepo}
                  workspaces={workspaces}
                  onSave={async (h) => {
                    await setHomeRepo(h);
                    setEditingHome(false);
                    showToast('Home repo set.');
                  }}
                  onCancel={() => setEditingHome(false)}
                />
              ) : null}
              {!admin && settings.account?.type === 'commercial' ? (
                <p className="hint" style={{ marginTop: 8 }}>
                  Your admin owns where the home repo lives.
                </p>
              ) : null}
            </div>

            {/* Buffered deploys (the outbox). */}
            {homeRepo ? (
              <>
                <h3 style={{ margin: '18px 0 10px' }}>Buffered while off-home</h3>
                <div className="card">
                  {outbox.length === 0 ? (
                    <div className="sub">
                      Nothing buffered. When you deploy away from home, changes wait here, sealed on
                      this device, and sync to the home repo the moment you dock. Your device only
                      clears a change after the home repo confirms it, so nothing is lost in
                      between.
                    </div>
                  ) : (
                    <>
                      <div className="sub" style={{ marginBottom: 8 }}>
                        {unsynced} waiting to reach the home repo. They sync on dock and clear only
                        once the home repo confirms them.
                      </div>
                      {(() => {
                        const health = bufferHealth(outbox, Date.now());
                        if (!health.pendingCount) return null;
                        const days = health.oldestMs ? Math.floor(health.oldestMs / 86_400_000) : 0;
                        return (
                          <p
                            className="hint"
                            style={{
                              marginBottom: 8,
                              color: health.stale || health.overCap ? 'var(--danger)' : undefined,
                            }}
                          >
                            {(health.totalBytes / 1024).toFixed(0)} KB of work is buffered only on
                            this device
                            {days >= 1 ? `, the oldest ${days} day${days > 1 ? 's' : ''} old` : ''}.
                            Dock to sync it safely. If you might lose this device first, export a
                            backup.
                          </p>
                        );
                      })()}
                      {outbox.map((item) => (
                        <div className="card-row" key={item.id} style={{ marginTop: 6 }}>
                          <span className={`state-dot ${item.state}`} aria-hidden="true" />
                          <div className="grow">
                            <div style={{ fontSize: 14 }}>{item.message}</div>
                            <div className="sub">
                              {item.branch} · {item.files.length} file
                              {item.files.length > 1 ? 's' : ''}
                            </div>
                          </div>
                          <span className="sub" style={{ textTransform: 'capitalize' }}>
                            {item.state}
                          </span>
                        </div>
                      ))}
                      {!homeRepoReady(homeRepo) ? (
                        <p className="hint" style={{ marginTop: 8 }}>
                          Set the home repo path first. Tap Change above and pick the desktop clone
                          this repo lands in, then Sync appears here.
                        </p>
                      ) : null}
                      <div
                        className="suggestion-row"
                        style={{ justifyContent: 'flex-start', marginTop: 10 }}
                      >
                        {homeRepoReady(homeRepo) ? (
                          <button
                            className="suggestion"
                            disabled={!settings.daemon}
                            onClick={async () => {
                              await syncOutbox();
                              showToast('Synced what the home repo could confirm.');
                            }}
                          >
                            Sync now
                          </button>
                        ) : null}
                        <button
                          className="suggestion"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(exportBuffer());
                              showToast('Backup copied. Paste it somewhere safe.');
                            } catch {
                              showToast('Copy is unavailable here.');
                            }
                          }}
                        >
                          Export a backup
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            ) : null}
          </>
        ) : null}

        <div className="divider" />

        {/* Desktop clone / open flow. */}
        {connected ? (
          <>
            <div className="card">
              <h3>Clone from a URL</h3>
              <div className="field" style={{ marginTop: 10 }}>
                <input
                  placeholder="https://github.com/owner/repo"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void clone()}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>

              {/* Where the repo's bytes live: your choice, at clone time. */}
              <div className="field">
                <label>Keep it on</label>
                <div className="segmented" role="group" aria-label="Storage location">
                  <button
                    className={`seg${locationKind === 'device' ? ' active' : ''}`}
                    aria-pressed={locationKind === 'device'}
                    onClick={() => setLocationKind('device')}
                  >
                    This device
                  </button>
                  <button
                    className={`seg${locationKind === 'folder' ? ' active' : ''}`}
                    aria-pressed={locationKind === 'folder'}
                    onClick={() => setLocationKind('folder')}
                  >
                    A folder I choose
                  </button>
                </div>
              </div>
              {locationKind === 'folder' ? (
                <div className="field">
                  {isDesktop() ? (
                    <div className="card-row">
                      <div className="grow">
                        <div className="sub">{folderPath || 'No folder chosen yet.'}</div>
                      </div>
                      <button
                        className="btn ghost"
                        style={{ padding: '8px 14px' }}
                        onClick={() => void pickFolderFor(setFolderPath)}
                      >
                        Choose
                      </button>
                    </div>
                  ) : (
                    <input
                      placeholder="/home/you/repos or a NAS path"
                      value={folderPath}
                      onChange={(e) => setFolderPath(e.target.value)}
                      autoCapitalize="none"
                      autoCorrect="off"
                    />
                  )}
                  <p className="hint" style={{ marginTop: 8 }}>
                    Any folder on the desktop, including a NAS or Tailscale mount. The repo lives
                    there, not on anyone else's servers.
                  </p>
                </div>
              ) : null}

              <button
                className="btn primary press-fb"
                style={{ width: '100%' }}
                disabled={cloning || !locationReady}
                onClick={() => void clone()}
              >
                {cloning ? 'Cloning...' : 'Clone and open a chat'}
              </button>
              <p className="hint" style={{ marginTop: 8 }}>
                Private repos use the platform you connected above, or an SSH key on the desktop.
              </p>
            </div>

            {/* Repos you have cloned, where they live, and their backups. */}
            {repos.length ? (
              <>
                <h3 style={{ margin: '18px 0 10px' }}>Your repositories</h3>
                {repos.map((repo) => (
                  <RepoCard
                    key={repo.id}
                    repo={repo}
                    onOpen={() =>
                      void newConversation({ kind: 'desktop', cwd: repo.cwd, repoName: repo.name })
                    }
                    onPickFolder={pickFolderFor}
                  />
                ))}
              </>
            ) : null}

            {isDesktop() ? (
              <div className="card">
                <div className="card-row">
                  <div className="grow">
                    <h3>Open a local folder</h3>
                    <div className="sub">Any repo already on this machine.</div>
                  </div>
                  <button
                    className="btn ghost"
                    style={{ padding: '8px 14px' }}
                    onClick={async () => {
                      const cwd = await bridge()!.pickFolder();
                      if (!cwd) return;
                      const name = cwd.split('/').pop() ?? cwd;
                      await newConversation({ kind: 'desktop', cwd, repoName: name });
                    }}
                  >
                    Browse
                  </button>
                </div>
              </div>
            ) : null}

            {workspaces.length ? (
              <>
                <div className="divider" />
                <h3 style={{ marginBottom: 10 }}>Recent</h3>
                {workspaces.map((ws) => (
                  <div className="card" key={ws.cwd}>
                    <div className="card-row">
                      <div className="grow">
                        <h3>{ws.name}</h3>
                        <div className="sub">{ws.cwd}</div>
                      </div>
                      <button
                        className="btn ghost"
                        style={{ padding: '8px 14px' }}
                        onClick={() =>
                          void newConversation({ kind: 'desktop', cwd: ws.cwd, repoName: ws.name })
                        }
                      >
                        Chat
                      </button>
                    </div>
                  </div>
                ))}
              </>
            ) : null}
          </>
        ) : (
          <div className="card">
            <h3>Repos also live on your desktop</h3>
            <div className="sub">
              Connect this phone to your desktop over Tailscale (Menu, then Desktop + phone) and
              every repo there is one tap away.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// One cloned repo: where it lives, open it, and its backups. Backups are the
// headline gitOS differentiator, and near-free here because the repo already
// sits on storage the user owns; this just points a second copy at another
// folder they own and runs it on a schedule.
function RepoCard({
  repo,
  onOpen,
  onPickFolder,
}: {
  repo: RepoRecord;
  onOpen: () => void;
  onPickFolder: (set: (p: string) => void) => Promise<void>;
}) {
  const { setRepoBackup, backupRepoNow, showToast } = useApp();
  const [editing, setEditing] = useState(false);
  const [enabled, setEnabled] = useState(repo.backup?.enabled ?? true);
  const [interval, setInterval] = useState<BackupInterval>(repo.backup?.interval ?? 'daily');
  const [destParent, setDestParent] = useState(repo.backup?.destParent ?? '');
  const [busy, setBusy] = useState(false);

  const backup = repo.backup;
  const lastRun = backup?.lastBackupAt ? new Date(backup.lastBackupAt).toLocaleString() : 'not yet';

  const save = async () => {
    if (enabled && !destParent.trim()) {
      showToast('Choose a backup folder first.');
      return;
    }
    await setRepoBackup(repo.id, {
      enabled,
      interval,
      destParent: destParent.trim(),
      lastBackupAt: backup?.lastBackupAt,
      lastError: backup?.lastError,
    });
    setEditing(false);
    showToast('Backup settings saved.');
  };

  return (
    <div className="card">
      <div className="card-row">
        <div className="grow">
          <h3>{repo.name}</h3>
          <div className="sub">
            {describeLocation(repo.location)} · {repo.defaultBranch}
          </div>
        </div>
        <button className="btn ghost press-fb" style={{ padding: '8px 14px' }} onClick={onOpen}>
          Open
        </button>
      </div>

      {!editing ? (
        <div style={{ marginTop: 10 }}>
          {backup?.enabled ? (
            <>
              <div className="sub">
                Backing up {interval} to {backup.destParent}. Last backup {lastRun}.
              </div>
              {backup.lastError ? (
                <p className="hint" style={{ marginTop: 6, color: 'var(--danger)' }}>
                  Last backup failed. {backup.lastError}
                </p>
              ) : null}
              <div
                className="suggestion-row"
                style={{ justifyContent: 'flex-start', marginTop: 10 }}
              >
                <button
                  className="suggestion"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await backupRepoNow(repo.id);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? 'Backing up...' : 'Back up now'}
                </button>
                <button className="suggestion" onClick={() => setEditing(true)}>
                  Edit backups
                </button>
              </div>
            </>
          ) : (
            <button
              className="btn ghost press-fb"
              style={{ padding: '8px 14px' }}
              onClick={() => setEditing(true)}
            >
              Set up backups
            </button>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <label className="card-row" style={{ cursor: 'pointer' }}>
            <div className="grow">
              <div style={{ fontSize: 14 }}>Scheduled backups</div>
              <div className="sub">A second copy on another folder you own.</div>
            </div>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
          </label>
          <div className="field">
            <label>How often</label>
            <select
              className="select"
              value={interval}
              onChange={(e) => setInterval(e.target.value as BackupInterval)}
            >
              <option value="manual">Manual only</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
          <div className="field">
            <label>Back up to</label>
            {isDesktop() ? (
              <div className="card-row">
                <div className="grow">
                  <div className="sub">{destParent || 'No folder chosen yet.'}</div>
                </div>
                <button
                  className="btn ghost"
                  style={{ padding: '8px 14px' }}
                  onClick={() => void onPickFolder(setDestParent)}
                >
                  Choose
                </button>
              </div>
            ) : (
              <input
                placeholder="/mnt/nas/backups or another folder"
                value={destParent}
                onChange={(e) => setDestParent(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
              />
            )}
            <p className="hint" style={{ marginTop: 8 }}>
              A local disk or a NAS. Cloud drives are coming; a live repo needs a real disk.
            </p>
          </div>
          <div className="sheet-actions">
            <button className="btn primary press-fb" onClick={() => void save()}>
              Save
            </button>
            <button className="btn quiet" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function HomeRepoEditor({
  initial,
  workspaces,
  onSave,
  onCancel,
}: {
  initial?: HomeRepo;
  workspaces: Array<{ cwd: string; name: string }>;
  onSave: (home: HomeRepo) => void;
  onCancel: () => void;
}) {
  const { connectedRepoPlatforms } = useApp();
  const [label, setLabel] = useState(initial?.label ?? '');
  const [kind, setKind] = useState<HomeRepo['kind']>(initial?.kind ?? 'home');
  const [remoteUrl, setRemoteUrl] = useState(initial?.remoteUrl ?? '');
  const [branch, setBranch] = useState(initial?.defaultBranch ?? 'main');
  // The on-desktop clone the home engine applies buffered commits into. v1
  // requires picking a workspace already cloned on the desktop; cloning a
  // platform remote on first sync is a follow-up (see review TS-P1-5).
  const [homePath, setHomePath] = useState(initial?.homePath ?? '');

  const platformKinds = REPO_CONNECTORS.filter((c) => connectedRepoPlatforms[c.id]);

  const pickWorkspace = (cwd: string) => {
    setHomePath(cwd);
    // Offer the workspace name as the label when the user has not typed one.
    if (!label.trim()) {
      const ws = workspaces.find((w) => w.cwd === cwd);
      if (ws) setLabel(ws.name);
    }
  };

  const save = () => {
    const home: HomeRepo = {
      id: initial?.id ?? `home${Date.now().toString(36)}`,
      label: label.trim() || 'Home repo',
      kind,
      defaultBranch: branch.trim() || 'main',
      remoteUrl: kind === 'home' ? undefined : remoteUrl.trim() || undefined,
      connectorId: kind === 'home' ? undefined : (kind as RepoPlatform),
      homePath: homePath.trim() || undefined,
    };
    onSave(home);
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div className="field">
        <label>Name</label>
        <input
          placeholder="e.g. OpenShore mono"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Where it lives</label>
        <select
          className="select"
          value={kind}
          onChange={(e) => setKind(e.target.value as HomeRepo['kind'])}
        >
          <option value="home">On my home system (over Tailscale)</option>
          {platformKinds.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {kind !== 'home' ? (
        <div className="field">
          <label>Remote URL</label>
          <input
            placeholder="https://github.com/owner/repo"
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
          />
        </div>
      ) : (
        <p className="hint">
          Your home system holds the repo. This phone reaches it over your private Tailscale
          network, so nothing depends on a third party.
        </p>
      )}
      <div className="field">
        <label>On the desktop</label>
        {workspaces.length ? (
          <select
            className="select"
            value={homePath}
            onChange={(e) => pickWorkspace(e.target.value)}
          >
            <option value="">Pick a cloned workspace</option>
            {workspaces.map((ws) => (
              <option key={ws.cwd} value={ws.cwd}>
                {ws.name} · {ws.cwd}
              </option>
            ))}
          </select>
        ) : (
          <p className="hint">
            No cloned workspaces found. Clone this repo on the desktop first, below, then set it as
            the home repo here.
          </p>
        )}
        <p className="hint" style={{ marginTop: 8 }}>
          Buffered deploys land in this clone on the home engine, then push. Sync stays hidden until
          a path is set here.
        </p>
      </div>
      <div className="field">
        <label>Default branch</label>
        <input
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
        />
      </div>
      <div className="sheet-actions">
        <button className="btn primary" onClick={save}>
          Save home repo
        </button>
        <button className="btn quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
