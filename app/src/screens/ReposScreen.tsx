// Repositories: connect GitHub and other platforms on your own token, set the
// home repo the whole system works through, and see anything buffered while you
// were off-home. Below that, the desktop clone/open flow: point OpenShore at a
// repo and it reads, edits, tests, and commits there, showing every change.
// The room is the Settings ledger (D14, founder 2026-10-07): a Connect a
// platform group whose rows open a connect sheet (or, once connected, ask
// before they disconnect), then the On your computer rows.
import { Fragment, useEffect, useRef, useState } from 'react';
import { isOrgAdmin, useApp } from '../state/store.js';
import { bridge } from '../lib/electronBridge.js';
import { openInAppBrowser } from '../lib/platform.js';
import { daemonWorkspaces } from '../drivers/remoteDriver.js';
import { homeRepoReady, REPO_CONNECTORS, type HomeRepo, type RepoPlatform } from '../lib/repos.js';
import {
  githubAppSlug,
  isRepoOAuthConfigured,
  repoOAuthCallbackUrl,
  repoToken,
} from '../lib/gitos/repoOAuth.js';
import { githubStatus, type GithubStatus } from '../lib/chatRepos.js';
import { cloneOnComputer, computerFor } from '../lib/repoClone.js';
import { bufferHealth, unsyncedCount } from '../lib/repoSync.js';
import { BackBar } from '../components/BackBar.js';
import { Sheet } from '../components/Sheet.js';
import { SheetHead } from '../components/SheetHead.js';
import { SettingsGroup, SettingsRow } from '../components/SettingsRow.js';
import { plainError } from '../lib/plainError.js';
import { thisDeviceNoun } from '../lib/deviceNoun.js';

// The phone-to-home commit-offload pipeline (home repo + buffered deploys) is
// built and tested end to end on the desktop engine. The homePath picker now
// lands in HomeRepoEditor below, so the home repo can actually be pointed at an
// on-desktop clone and Sync is gated on that path. Still hidden by default
// until an app flow produces buffered commit-intents (the offload producer,
// CTO ruling FD-1), or the section would only ever show its empty state. Flip
// this to reveal it, a one-line change; the store actions and the desktop apply
// engine stay intact.
const REPO_OUTBOX_ENABLED = false;

export function ReposScreen() {
  const {
    settings,
    connectedRepoPlatforms,
    connectRepoPlatform,
    connectRepoOAuth,
    disconnectRepoPlatform,
    setHomeRepo,
    syncOutbox,
    exportBuffer,
    newConversation,
    showToast,
    sourceReady,
    setView,
  } = useApp();

  // Open a coding session for a folder, but only if this computer's engine has
  // a model to run it with; otherwise send the person to set one up rather than
  // opening a chat that cannot answer. Returns whether a session was opened.
  const openRepo = async (cwd: string, repoName: string): Promise<boolean> => {
    if (!sourceReady({ kind: 'desktop' })) {
      showToast('Pick a model for this computer first, then open the repository.');
      setView('stack');
      return false;
    }
    // Undefined when no chat opened (the sign-in sheet stood in the way).
    return Boolean(await newConversation({ kind: 'desktop', cwd, repoName }));
  };
  const [workspaces, setWorkspaces] = useState<Array<{ cwd: string; name: string }>>([]);
  const [url, setUrl] = useState('');
  const [cloning, setCloning] = useState(false);
  // The clone sheet is open.
  const [cloneOpen, setCloneOpen] = useState(false);
  // The platform whose connect sheet is open, and whether a one-tap platform's
  // sheet shows its access token form instead.
  const [connecting, setConnecting] = useState<RepoPlatform | undefined>();
  const [tokenMode, setTokenMode] = useState(false);
  const [tokenValue, setTokenValue] = useState('');
  const [editingHome, setEditingHome] = useState(false);
  // The platform being disconnected, while its confirm is open.
  const [removing, setRemoving] = useState<{ id: RepoPlatform; name: string } | undefined>();
  const titleRef = useRef<HTMLHeadingElement>(null);

  const where = computerFor(settings);
  const connected = where !== undefined;
  const admin = isOrgAdmin(settings.account);
  const homeRepo = settings.repo?.homeRepo;
  const outbox = settings.repo?.outbox ?? [];
  const unsynced = unsyncedCount(outbox);

  const refresh = async () => {
    try {
      if (where === 'local') setWorkspaces(await bridge()!.recentWorkspaces());
      else if (where === 'paired' && settings.daemon)
        setWorkspaces(await daemonWorkspaces(settings.daemon));
    } catch {
      setWorkspaces([]);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.daemon, where]);

  // With GitHub connected, say which account it is signed in as, how many
  // repositories that sign-in sees (and how many are private), and the one fix
  // when some are missing: a page on GitHub, or reconnecting here.
  const githubOn = Boolean(connectedRepoPlatforms.github);
  const [github, setGithub] = useState<GithubStatus | undefined>();
  const [hintTick, setHintTick] = useState(0);
  useEffect(() => {
    if (!githubOn) {
      setGithub(undefined);
      return;
    }
    let live = true;
    void (async () => {
      const token = await repoToken('github');
      const status = token
        ? await githubStatus(token, { slug: githubAppSlug() }).catch(() => undefined)
        : undefined;
      if (live) setGithub(status);
    })();
    return () => {
      live = false;
    };
  }, [githubOn, hintTick]);
  const githubHint = github?.hint;
  // The sign-in line, then what it sees, in words: "none private", never "0".
  const githubLine = (status: GithubStatus): string => {
    const n = status.repos.length;
    const priv = status.repos.filter((r) => r.private).length;
    const sees =
      n === 0
        ? 'It sees no repositories.'
        : `It sees ${n} ${n === 1 ? 'repository' : 'repositories'}, ${priv || 'none'} private.`;
    return status.line ? `${status.line} ${sees}` : sees;
  };

  // Remove GitHub and connect it again: the one-tap sign-in asks GitHub for
  // private access now, so an older sign-in that only saw public repositories
  // is fixed by this. Without one-tap, the token field opens instead. Its
  // sheet opens either way, so a refused sign-in still has a place to show
  // the Callback URL it is missing.
  const reconnectGithub = async () => {
    await disconnectRepoPlatform('github');
    setGithub(undefined);
    openConnect('github');
    if (isRepoOAuthConfigured('github')) await runOAuth('github', 'GitHub');
    setHintTick((n) => n + 1);
  };

  const openConnect = (id: RepoPlatform) => {
    setConnecting(id);
    setTokenMode(false);
    setTokenValue('');
    setOauthFailed(undefined);
  };
  const closeConnect = () => {
    setConnecting(undefined);
    setTokenValue('');
  };

  const clone = async () => {
    const cleaned = url.trim();
    // Enter in the field is a second door to Clone, so it waits as Clone does.
    if (!cleaned || cloning) return;
    setCloning(true);
    try {
      // The connected platform's token rides along for a private repository
      // on its own host (lib/repoClone.ts), so the clone sheet's hint is true.
      const result = await cloneOnComputer(cleaned, settings);
      setCloneOpen(false);
      showToast(`${result.name} is ready.`);
      setUrl('');
      await refresh();
      await openRepo(result.cwd, result.name);
    } catch (err) {
      showToast(plainError(err));
    } finally {
      setCloning(false);
    }
  };

  const saveConnection = async (id: RepoPlatform, name: string) => {
    const key = tokenValue.trim();
    if (!key) return;
    closeConnect();
    await connectRepoPlatform(id, key);
    showToast(`${name} connected. OpenShore can open your repositories there.`);
  };

  // One-tap OAuth: open the provider's consent screen, and on return the tokens
  // are already stored. A failure comes back as a message, never a throw.
  const [oauthBusy, setOauthBusy] = useState<string | undefined>();
  // The provider whose last one-tap connect failed, so its setup hint shows. The
  // usual failure is the provider app rejecting the redirect address, which the
  // hint turns into the exact Callback URL to register.
  const [oauthFailed, setOauthFailed] = useState<string | undefined>();
  const runOAuth = async (id: RepoPlatform, name: string) => {
    setOauthBusy(id);
    setOauthFailed(undefined);
    try {
      const res = await connectRepoOAuth(id);
      if (res.ok) {
        // Connected from its sheet: the sheet's work is done.
        setConnecting((open) => (open === id ? undefined : open));
        showToast(`${name} connected.`);
      } else {
        showToast(res.error);
        setOauthFailed(id);
      }
    } finally {
      setOauthBusy(undefined);
    }
  };

  // The connect sheet's platform, whether it signs in with one tap, and the
  // Callback URL its OAuth app needs when that sign-in was refused.
  const platform = REPO_CONNECTORS.find((c) => c.id === connecting);
  const platformOAuth = platform ? isRepoOAuthConfigured(platform.id) : false;
  const callback = platform && oauthFailed === platform.id ? repoOAuthCallbackUrl() : undefined;

  return (
    <div className="screen">
      <BackBar title="Repositories" titleHiddenUntil={titleRef} />
      <div className="screen-inner settings">
        <h1 ref={titleRef}>Repositories</h1>
        <p className="lead">
          Connect GitHub, GitLab, or Bitbucket. OpenShore reads, edits, and tests your code, shows
          you every change, and asks before it runs a command unless you have allowed it.
        </p>

        {!connected ? (
          <div className="card" style={{ marginBottom: 'var(--section-gap)' }}>
            <h3>Your repositories live on your computer</h3>
            <div className="sub">
              Connect this device to your computer, where the code lives, to clone and open
              repositories from here.
            </div>
            <button
              type="button"
              className="btn primary block press-fb"
              style={{ marginTop: 12 }}
              onClick={() => setView('pair')}
            >
              Connect your computer
            </button>
            <button
              type="button"
              className="linklike door press-fb"
              onClick={() => void useApp.getState().startGuideChat('pair-computer')}
            >
              Walk me through it
            </button>
          </div>
        ) : null}

        {/* One row per platform. Once connected, the row says what connecting
            gave you; before, how you connect: "Access token" is the form's
            own word, since Bitbucket's is an Atlassian API token, not a
            personal access token. A tap opens the connect sheet, or, once
            connected, asks before it disconnects. */}
        <SettingsGroup title="Connect a platform" index={0}>
          {REPO_CONNECTORS.map((c) => {
            const on = Boolean(connectedRepoPlatforms[c.id]);
            const oauth = isRepoOAuthConfigured(c.id);
            const busy = oauthBusy === c.id;
            const hint = c.id === 'github' && on ? githubHint : undefined;
            return (
              <Fragment key={c.id}>
                <SettingsRow
                  label={c.name}
                  sub={
                    on
                      ? c.id === 'github' && github
                        ? githubLine(github)
                        : 'Its repositories are ready to add to a chat.'
                      : busy
                        ? 'Connecting...'
                        : oauth
                          ? 'Authorize with one tap'
                          : 'Paste an access token'
                  }
                  value={on ? <span className="pill ok">Connected</span> : undefined}
                  disabled={busy}
                  onClick={() => (on ? setRemoving({ id: c.id, name: c.name }) : openConnect(c.id))}
                />
                {/* With GitHub connected, the one fix when some repositories
                    are missing: a page on GitHub, or reconnecting here. */}
                {hint ? (
                  <SettingsRow
                    label={hint.action}
                    sub={hint.text}
                    onClick={() =>
                      hint.url && !hint.reconnect
                        ? openInAppBrowser(hint.url, () => setHintTick((n) => n + 1))
                        : void reconnectGithub()
                    }
                  />
                ) : null}
              </Fragment>
            );
          })}
        </SettingsGroup>

        {/* Home repo. Hidden until the offload producer + homePath picker land. */}
        {REPO_OUTBOX_ENABLED ? (
          <>
            <h2 className="section-head">Home repository</h2>
            <div className="card">
              <div className="card-row">
                <div className="grow">
                  <h3>{homeRepo ? homeRepo.label : 'Not set up yet'}</h3>
                  <div className="sub">
                    {homeRepo
                      ? `${homeRepo.kind === 'home' ? 'On your computer' : homeRepo.kind} · ${homeRepo.defaultBranch}`
                      : 'The one place the whole system works through, like your home LLM. Off-home deploys buffer, then land here when you dock.'}
                  </div>
                </div>
                {admin ? (
                  <button className="btn ghost sm" onClick={() => setEditingHome((v) => !v)}>
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
                    showToast('Home repository set.');
                  }}
                  onCancel={() => setEditingHome(false)}
                />
              ) : null}
              {!admin && settings.account?.type === 'commercial' ? (
                <p className="hint" style={{ marginTop: 8 }}>
                  Your admin owns where the home repository lives.
                </p>
              ) : null}
            </div>

            {/* Buffered deploys (the outbox). */}
            {homeRepo ? (
              <>
                <h2 className="section-head">Waiting to sync home</h2>
                <div className="card">
                  {outbox.length === 0 ? (
                    <div className="sub">
                      Nothing buffered. When you deploy away from home, changes wait here, sealed on
                      this device, and sync to the home repository the moment you dock. Your device
                      only clears a change after the home repository confirms it, so nothing is lost
                      in between.
                    </div>
                  ) : (
                    <>
                      <div className="sub" style={{ marginBottom: 8 }}>
                        {unsynced} waiting to reach the home repository. They sync on dock and clear
                        only once the home repository confirms them.
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
                            <div className="repo-outbox-message">{item.message}</div>
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
                          Set the home repository path first. Tap Change above and pick the clone on
                          your computer this repository lands in, then Sync appears here.
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
                              showToast('Synced what the home repository could confirm.');
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

        {/* The desktop clone and open flow, on the computer the code lives on. */}
        {connected ? (
          <SettingsGroup title="On your computer" index={1}>
            <SettingsRow
              label="Clone from a URL"
              sub="Clone a repository onto your computer and open a chat in it."
              onClick={() => setCloneOpen(true)}
            />
            {/* A folder on this desktop, only when sessions run here (a
                desktop pointed at a remote hub runs them there, where this
                path is not). */}
            {where === 'local' ? (
              <SettingsRow
                label="Open a local folder"
                sub="Any repository already on this computer."
                onClick={async () => {
                  const cwd = await bridge()!.pickFolder();
                  if (!cwd) return;
                  const name = cwd.split('/').pop() ?? cwd;
                  await openRepo(cwd, name);
                }}
              />
            ) : null}
          </SettingsGroup>
        ) : null}

        {connected && workspaces.length ? (
          <SettingsGroup title="Recent" index={2}>
            {workspaces.map((ws) => (
              <SettingsRow
                key={ws.cwd}
                label={ws.name}
                sub={ws.cwd}
                subTruncate
                onClick={() => void openRepo(ws.cwd, ws.name)}
              />
            ))}
          </SettingsGroup>
        ) : null}
      </div>

      {/* A platform's connect sheet. A one-tap platform leads with its
          sign-in and still offers the token path, for a fine-grained token or
          a self-hosted host its OAuth app does not cover. The token, its
          link and Save rise above the keyboard together (lib/revealField.ts).
          Like every form sheet, its one way out is the round close. */}
      <Sheet open={Boolean(platform)} onClose={closeConnect}>
        {platform ? (
          <>
            <SheetHead title={`Connect ${platform.name}`} onClose={closeConnect} />
            {platformOAuth && !tokenMode ? (
              <>
                {oauthFailed === platform.id && callback ? (
                  <div className="repos-callback">
                    <p className="hint">
                      If {platform.name} said the redirect address is not associated with this
                      application, its OAuth app is missing this exact Callback URL:
                    </p>
                    <p className="repos-callback-url">{callback}</p>
                    <button
                      type="button"
                      className="linklike press-fb"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(callback);
                          showToast('Callback URL copied.');
                        } catch {
                          showToast('Copy is unavailable here.');
                        }
                      }}
                    >
                      Copy Callback URL
                    </button>
                  </div>
                ) : null}
                <div className="sheet-actions">
                  {/* The GitHub App path (and its GitLab and Bitbucket
                      siblings): the secret exchange runs on the server, so
                      the person only taps. */}
                  <button
                    type="button"
                    className="btn primary press-fb"
                    disabled={oauthBusy === platform.id}
                    onClick={() => void runOAuth(platform.id, platform.name)}
                  >
                    {oauthBusy === platform.id ? 'Connecting...' : `Connect ${platform.name}`}
                  </button>
                  <button
                    type="button"
                    className="btn quiet press-fb"
                    onClick={() => {
                      setTokenMode(true);
                      setTokenValue('');
                    }}
                  >
                    Use an access token instead
                  </button>
                </div>
              </>
            ) : (
              <div data-reveal-with="">
                <div className="field">
                  {/* Same errand as a cloud key: an in-app browser sheet on
                      the phone, so creating the token and pasting it never
                      leaves OpenShore; the system browser on the desktop and
                      web. */}
                  <div className="field-label-row">
                    <label htmlFor="repos-access-token">{platform.name} access token</label>
                    <button
                      type="button"
                      className="linklike press-fb"
                      onClick={() => openInAppBrowser(platform.tokenUrl)}
                    >
                      Get a token ↗
                    </button>
                  </div>
                  <input
                    id="repos-access-token"
                    autoFocus
                    type="password"
                    placeholder={platform.keyHint}
                    enterKeyHint="go"
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={tokenValue}
                    onChange={(e) => setTokenValue(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === 'Enter' && void saveConnection(platform.id, platform.name)
                    }
                  />
                  <p className="hint" style={{ marginTop: 4 }}>
                    It stays on this device, never in a log.
                  </p>
                </div>
                <div className="sheet-actions">
                  <button
                    type="button"
                    className="btn primary press-fb"
                    data-reveal-primary=""
                    disabled={!tokenValue.trim()}
                    onClick={() => void saveConnection(platform.id, platform.name)}
                  >
                    Save access token
                  </button>
                </div>
              </div>
            )}
          </>
        ) : null}
      </Sheet>

      {/* Clone from a URL: the address and Clone rise above the keyboard
          together. The connected platform's token rides along for a private
          repository on its own host (lib/repoClone.ts), so the hint is true. */}
      <Sheet open={cloneOpen} onClose={() => setCloneOpen(false)}>
        {cloneOpen ? (
          <>
            <SheetHead title="Clone from a URL" onClose={() => setCloneOpen(false)} />
            <div data-reveal-with="">
              <div className="field">
                <label htmlFor="repos-clone-url">Repository address</label>
                <input
                  id="repos-clone-url"
                  autoFocus
                  type="url"
                  inputMode="url"
                  placeholder="https://github.com/owner/repo"
                  enterKeyHint="go"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void clone()}
                />
                <p className="hint" style={{ marginTop: 4 }}>
                  Private repositories open with a platform you connected, or with Git already set
                  up on your computer.
                </p>
              </div>
              <div className="sheet-actions">
                <button
                  type="button"
                  className="btn primary press-fb"
                  data-reveal-primary=""
                  disabled={cloning || !url.trim()}
                  onClick={() => void clone()}
                >
                  {cloning ? 'Cloning...' : 'Clone and open a chat'}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </Sheet>

      <Sheet open={Boolean(removing)} onClose={() => setRemoving(undefined)} variant="confirm">
        <h3>Disconnect {removing?.name}?</h3>
        <p>Its access token is removed from this device. You can connect it again any time.</p>
        <div className="confirm-row">
          <button
            type="button"
            className="btn ghost press-fb"
            onClick={() => setRemoving(undefined)}
          >
            Keep
          </button>
          <button
            type="button"
            className="btn danger press-fb"
            onClick={async () => {
              const target = removing;
              setRemoving(undefined);
              if (!target) return;
              await disconnectRepoPlatform(target.id);
              showToast(`${target.name} disconnected.`);
            }}
          >
            Disconnect
          </button>
        </div>
      </Sheet>
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
      label: label.trim() || 'Home repository',
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
        <label htmlFor="home-repo-name">Name</label>
        <input
          id="home-repo-name"
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
          <option value="home">On my computer (over Tailscale)</option>
          {platformKinds.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {kind !== 'home' ? (
        <div className="field">
          <label htmlFor="home-repo-remote-url">Remote URL</label>
          <input
            id="home-repo-remote-url"
            placeholder="https://github.com/owner/repo"
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
          />
        </div>
      ) : (
        <p className="hint">
          Your computer holds the repository. {thisDeviceNoun({ start: true })} reaches it over your
          private Tailscale network, so nothing depends on a third party.
        </p>
      )}
      <div className="field">
        <label>On your computer</label>
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
            No cloned workspaces found. Clone this repository on your computer first, below, then
            set it as the home repository here.
          </p>
        )}
        <p className="hint" style={{ marginTop: 8 }}>
          Waiting changes land in this clone on your computer, then push. Sync stays hidden until a
          path is set here.
        </p>
      </div>
      <div className="field">
        <label htmlFor="home-repo-default-branch">Default branch</label>
        <input
          id="home-repo-default-branch"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
        />
      </div>
      <div className="sheet-actions">
        <button className="btn primary" onClick={save}>
          Save home repository
        </button>
        <button className="btn quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
