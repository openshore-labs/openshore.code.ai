// Launch: the one-stop shop for getting a built app onto the App Store or
// Google Play through Codemagic, guided from inside the app. The model walks
// you through the accounts to set up and the configuration. When you hit Build,
// the app triggers Codemagic, follows the result over its API, and (on a
// failure) reads the redacted log so the model can tell you the fix and to
// build again. No copy-paste of build output.
import { useState } from 'react';
import { useApp } from '../state/store.js';
import { BackBar } from '../components/BackBar.js';
import type { BuildRun, LaunchTarget } from '../state/types.js';

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  preparing: 'Preparing',
  building: 'Building',
  finished: 'Succeeded',
  failed: 'Failed',
  canceled: 'Canceled',
  timeout: 'Timed out',
  unknown: 'Unknown',
};

function statusPill(status: string): string {
  if (status === 'finished') return 'pill local';
  if (status === 'failed' || status === 'timeout') return 'pill tight';
  return 'pill muted';
}

export function LaunchScreen() {
  const {
    settings,
    codemagicConnected,
    connectCodemagic,
    disconnectCodemagic,
    saveLaunchTarget,
    startBuild,
    diagnoseBuild,
    newConversation,
    showToast,
  } = useApp();

  const launch = settings.launch;
  const target = launch?.target;
  const runs = launch?.runs ?? [];
  const busy = runs[0] ? ['queued', 'preparing', 'building'].includes(runs[0].status) : false;

  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [draft, setDraft] = useState<Omit<LaunchTarget, 'id'>>({
    platform: target?.platform ?? 'ios',
    appId: target?.appId ?? '',
    workflowId: target?.workflowId ?? '',
    branch: target?.branch ?? 'main',
    label: target?.label ?? '',
  });
  const [editingTarget, setEditingTarget] = useState(!target);

  const guideMe = async () => {
    await newConversation({ kind: 'stack' });
    const prompt = [
      'Walk me through launching my app to the app stores using Codemagic, step by step.',
      'Cover, in order and concretely:',
      '1) the external accounts I need (Apple Developer, App Store Connect, Google Play Console, Codemagic) and how to create each,',
      '2) how to connect my repository to Codemagic and set up a workflow,',
      '3) code signing (certificates, provisioning, or Codemagic automatic signing) for iOS and a keystore for Android,',
      '4) the environment variables and groups the build needs,',
      '5) how to trigger the first build and what a successful release looks like.',
      'Ask me what I have set up already before assuming. Keep each step short.',
    ].join('\n');
    setTimeout(() => useApp.getState().send(prompt), 350);
  };

  const saveTarget = async () => {
    if (!draft.appId.trim() || !draft.workflowId.trim()) {
      showToast('Codemagic app id and workflow id are required.');
      return;
    }
    await saveLaunchTarget({ ...draft, id: target?.id });
    setEditingTarget(false);
    showToast('Launch target saved.');
  };

  return (
    <div className="screen">
      <BackBar title="Launch" />
      <div className="screen-inner">
        <h1>Launch</h1>
        <p className="lead">
          Get your built app to the App Store or Google Play, guided from here. The model walks you
          through the accounts and setup. When you build, OS Code follows Codemagic and reads the
          result, so a failure comes back as a fix, not a wall of logs.
        </p>

        <div className="card">
          <div className="card-row">
            <div className="grow">
              <h3>Not sure where to start?</h3>
              <div className="sub">
                Have the model walk you through every account and setting, in order.
              </div>
            </div>
            <button className="btn ghost" style={{ padding: '8px 14px' }} onClick={() => void guideMe()}>
              Guide me
            </button>
          </div>
        </div>

        {/* Connect Codemagic. */}
        <div className="card">
          <div className="card-row">
            <div className="grow">
              <h3>Codemagic</h3>
              <div className="sub">
                {codemagicConnected
                  ? 'Connected. Your token stays in this device Keychain.'
                  : 'Add your Codemagic API token to trigger and follow builds.'}
              </div>
            </div>
            {codemagicConnected ? <span className="pill local">connected</span> : null}
            {codemagicConnected ? (
              <button
                className="btn ghost"
                style={{ padding: '8px 14px' }}
                onClick={async () => {
                  await disconnectCodemagic();
                  showToast('Codemagic disconnected.');
                }}
              >
                Remove
              </button>
            ) : (
              <button
                className="btn ghost"
                style={{ padding: '8px 14px' }}
                onClick={() => setShowToken((v) => !v)}
              >
                Connect
              </button>
            )}
          </div>
          {!codemagicConnected && showToken ? (
            <div style={{ marginTop: 12 }}>
              <div className="field">
                <input
                  autoFocus
                  type="password"
                  placeholder="Codemagic API token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
              <button
                className="btn primary"
                style={{ width: '100%' }}
                disabled={!token.trim()}
                onClick={async () => {
                  await connectCodemagic(token);
                  setToken('');
                  setShowToken(false);
                  showToast('Codemagic connected.');
                }}
              >
                Save token
              </button>
              <p className="hint" style={{ marginTop: 8 }}>
                A Codemagic token can trigger and read builds across your account. It stays on this
                device and is never put in a log or sent anywhere but Codemagic.
              </p>
            </div>
          ) : null}
        </div>

        {/* Launch target. */}
        <div className="card">
          <div className="card-row">
            <div className="grow">
              <h3>Launch target</h3>
              <div className="sub">
                {target && !editingTarget
                  ? `${target.platform === 'ios' ? 'iOS' : 'Android'} · ${target.workflowId} · ${target.branch}`
                  : 'Which Codemagic app and workflow to build.'}
              </div>
            </div>
            {target && !editingTarget ? (
              <button
                className="btn ghost"
                style={{ padding: '8px 14px' }}
                onClick={() => setEditingTarget(true)}
              >
                Edit
              </button>
            ) : null}
          </div>

          {editingTarget ? (
            <div style={{ marginTop: 12 }}>
              <div className="field">
                <label>Platform</label>
                <select
                  className="select"
                  value={draft.platform}
                  onChange={(e) =>
                    setDraft({ ...draft, platform: e.target.value as 'ios' | 'android' })
                  }
                >
                  <option value="ios">iOS (App Store)</option>
                  <option value="android">Android (Google Play)</option>
                </select>
              </div>
              <div className="field">
                <label>Codemagic app id</label>
                <input
                  placeholder="from the Codemagic app URL"
                  value={draft.appId}
                  onChange={(e) => setDraft({ ...draft, appId: e.target.value })}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>
              <div className="field">
                <label>Workflow id</label>
                <input
                  placeholder="e.g. ios-release, android-release"
                  value={draft.workflowId}
                  onChange={(e) => setDraft({ ...draft, workflowId: e.target.value })}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>
              <div className="field">
                <label>Branch</label>
                <input
                  placeholder="main"
                  value={draft.branch}
                  onChange={(e) => setDraft({ ...draft, branch: e.target.value })}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>
              <button className="btn primary" style={{ width: '100%' }} onClick={() => void saveTarget()}>
                Save target
              </button>
            </div>
          ) : null}
        </div>

        {/* Build. */}
        <button
          className="btn primary"
          style={{ width: '100%', marginTop: 4 }}
          disabled={!codemagicConnected || !target || busy}
          onClick={() => void startBuild()}
        >
          {busy ? (
            <>
              <span className="pulse-dot" aria-hidden="true" />
              Building
            </>
          ) : (
            'Build in Codemagic'
          )}
        </button>
        {!codemagicConnected || !target ? (
          <p className="hint" style={{ marginTop: 8 }}>
            Connect Codemagic and set a launch target to build.
          </p>
        ) : null}

        {/* Runs. */}
        {runs.length ? <h3 style={{ margin: '18px 0 10px' }}>Builds</h3> : null}
        {runs.map((run) => (
          <RunCard key={run.id} run={run} onDiagnose={() => void diagnoseBuild(run.id)} onRebuild={() => void startBuild()} busy={busy} />
        ))}
      </div>
    </div>
  );
}

function RunCard({
  run,
  onDiagnose,
  onRebuild,
  busy,
}: {
  run: BuildRun;
  onDiagnose: () => void;
  onRebuild: () => void;
  busy: boolean;
}) {
  const failed = run.status === 'failed' || run.status === 'timeout';
  const inProgress = ['queued', 'preparing', 'building'].includes(run.status);
  return (
    <div className="card">
      <div className="card-row">
        <div className="grow">
          <h3>{STATUS_LABEL[run.status] ?? run.status}</h3>
          <div className="sub">
            {new Date(run.startedAt).toLocaleString()}
            {run.buildId ? ` · ${run.buildId.slice(0, 8)}` : ''}
          </div>
        </div>
        <span className={statusPill(run.status)}>{STATUS_LABEL[run.status] ?? run.status}</span>
      </div>
      {inProgress ? <div className="build-shimmer" aria-hidden="true" /> : null}
      {run.error ? <p className="hint" style={{ marginTop: 6 }}>{run.error}</p> : null}
      {failed && run.excerpt ? (
        <>
          <pre className="log-excerpt">{run.excerpt}</pre>
          <div className="suggestion-row" style={{ justifyContent: 'flex-start', marginTop: 4 }}>
            <button className="suggestion" onClick={onDiagnose}>
              Have the model read it
            </button>
            <button className="suggestion" onClick={onRebuild} disabled={busy}>
              Build again
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
