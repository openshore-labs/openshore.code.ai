// Repositories: the starting point of real work. Clone from GitHub by URL,
// pick a local folder (desktop), and jump straight into a chat rooted there.
import { useEffect, useState } from 'react';
import { useApp } from '../state/store.js';
import { bridge } from '../lib/electronBridge.js';
import { isDesktop } from '../lib/platform.js';
import { daemonCloneRepo, daemonWorkspaces } from '../drivers/remoteDriver.js';
import { BackBar } from '../components/BackBar.js';

export function ReposScreen() {
  const { settings, newConversation, showToast } = useApp();
  const [workspaces, setWorkspaces] = useState<Array<{ cwd: string; name: string }>>([]);
  const [url, setUrl] = useState('');
  const [cloning, setCloning] = useState(false);

  const connected = isDesktop() || Boolean(settings.daemon);

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

  return (
    <div className="screen">
      <BackBar title="Repositories" />
      <div className="screen-inner">
        <h1>Repositories</h1>
        <p className="lead">
          Point OS Code at a repo and it reads, edits, tests, and commits there, with your
          approval on every change.
        </p>

        {connected ? (
          <>
            <div className="card">
              <h3>Clone from GitHub</h3>
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
              <button className="btn primary" style={{ width: '100%' }} disabled={cloning} onClick={() => void clone()}>
                {cloning ? 'Cloning...' : 'Clone and open a chat'}
              </button>
              <p className="hint" style={{ marginTop: 8 }}>
                Private repos need GitHub connected (Connections) or an SSH key on the desktop.
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
            <h3>Repos live on your desktop</h3>
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
