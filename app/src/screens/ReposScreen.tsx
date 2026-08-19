// Repositories: connect GitHub and other platforms on your own token, set the
// home repo the whole system works through, and see anything buffered while you
// were off-home. Below that, the desktop clone/open flow: point OS Code at a
// repo and it reads, edits, tests, and commits there with your approval.
import { useEffect, useState } from 'react';
import { isOrgAdmin, useApp } from '../state/store.js';
import { bridge } from '../lib/electronBridge.js';
import { isDesktop } from '../lib/platform.js';
import { daemonCloneRepo, daemonWorkspaces } from '../drivers/remoteDriver.js';
import { REPO_CONNECTORS, type HomeRepo, type RepoPlatform } from '../lib/repos.js';
import { bufferHealth, unsyncedCount } from '../lib/repoSync.js';
import { BackBar } from '../components/BackBar.js';

export function ReposScreen() {
  const {
    settings,
    connectedRepoPlatforms,
    connectRepoPlatform,
    disconnectRepoPlatform,
    setHomeRepo,
    syncOutbox,
    exportBuffer,
    newConversation,
    showToast,
  } = useApp();
  const [workspaces, setWorkspaces] = useState<Array<{ cwd: string; name: string }>>([]);
  const [url, setUrl] = useState('');
  const [cloning, setCloning] = useState(false);
  const [connecting, setConnecting] = useState<string | undefined>();
  const [tokenValue, setTokenValue] = useState('');
  const [editingHome, setEditingHome] = useState(false);

  const connected = isDesktop() || Boolean(settings.daemon);
  const admin = isOrgAdmin(settings.account);
  const homeRepo = settings.repo?.homeRepo;
  const outbox = settings.repo?.outbox ?? [];
  const unsynced = unsyncedCount(outbox);

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

  const clone = async () => {
    const cleaned = url.trim();
    if (!cleaned) return;
    setCloning(true);
    try {
      let result: { cwd: string; name: string };
      if (isDesktop() && bridge()) {
        const r = await bridge()!.cloneRepo(cleaned);
        if ('error' in r) throw new Error(r.error);
        result = r;
      } else if (settings.daemon) {
        result = await daemonCloneRepo(settings.daemon, cleaned);
      } else {
        throw new Error('Connect your desktop first; repos live there.');
      }
      showToast(`${result.name} is ready.`);
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
          Connect GitHub or another platform on your own token, or keep a home repo of your own so
          you do not depend on anyone else. OS Code reads, edits, tests, and commits with your
          approval on every change.
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
                {on ? <span className="pill local">connected</span> : null}
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

        {/* Home repo. */}
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
                  clears a change after the home repo confirms it, so nothing is lost in between.
                </div>
              ) : (
                <>
                  <div className="sub" style={{ marginBottom: 8 }}>
                    {unsynced} waiting to reach the home repo. They sync on dock and clear only once
                    the home repo confirms them.
                  </div>
                  {(() => {
                    const health = bufferHealth(outbox, Date.now());
                    if (!health.pendingCount) return null;
                    const days = health.oldestMs ? Math.floor(health.oldestMs / 86_400_000) : 0;
                    return (
                      <p
                        className="hint"
                        style={{ marginBottom: 8, color: health.stale || health.overCap ? 'var(--danger)' : undefined }}
                      >
                        {(health.totalBytes / 1024).toFixed(0)} KB of work is buffered only on this
                        device{days >= 1 ? `, the oldest ${days} day${days > 1 ? 's' : ''} old` : ''}. Dock
                        to sync it safely. If you might lose this device first, export a backup.
                      </p>
                    );
                  })()}
                  {outbox.map((item) => (
                    <div className="card-row" key={item.id} style={{ marginTop: 6 }}>
                      <span className={`state-dot ${item.state}`} aria-hidden="true" />
                      <div className="grow">
                        <div style={{ fontSize: 14 }}>{item.message}</div>
                        <div className="sub">
                          {item.branch} · {item.files.length} file{item.files.length > 1 ? 's' : ''}
                        </div>
                      </div>
                      <span className="sub" style={{ textTransform: 'capitalize' }}>{item.state}</span>
                    </div>
                  ))}
                  <div className="suggestion-row" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
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
              <button
                className="btn primary"
                style={{ width: '100%' }}
                disabled={cloning}
                onClick={() => void clone()}
              >
                {cloning ? 'Cloning...' : 'Clone and open a chat'}
              </button>
              <p className="hint" style={{ marginTop: 8 }}>
                Private repos use the platform you connected above, or an SSH key on the desktop.
              </p>
            </div>

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

function HomeRepoEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial?: HomeRepo;
  onSave: (home: HomeRepo) => void;
  onCancel: () => void;
}) {
  const { connectedRepoPlatforms } = useApp();
  const [label, setLabel] = useState(initial?.label ?? '');
  const [kind, setKind] = useState<HomeRepo['kind']>(initial?.kind ?? 'home');
  const [remoteUrl, setRemoteUrl] = useState(initial?.remoteUrl ?? '');
  const [branch, setBranch] = useState(initial?.defaultBranch ?? 'main');

  const platformKinds = REPO_CONNECTORS.filter((c) => connectedRepoPlatforms[c.id]);

  const save = () => {
    const home: HomeRepo = {
      id: initial?.id ?? `home${Date.now().toString(36)}`,
      label: label.trim() || 'Home repo',
      kind,
      defaultBranch: branch.trim() || 'main',
      remoteUrl: kind === 'home' ? undefined : remoteUrl.trim() || undefined,
      connectorId: kind === 'home' ? undefined : (kind as RepoPlatform),
    };
    onSave(home);
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div className="field">
        <label>Name</label>
        <input placeholder="e.g. OpenShore mono" value={label} onChange={(e) => setLabel(e.target.value)} />
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
        <label>Default branch</label>
        <input value={branch} onChange={(e) => setBranch(e.target.value)} autoCapitalize="none" autoCorrect="off" />
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
