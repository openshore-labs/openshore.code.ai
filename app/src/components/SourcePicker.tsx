// The source picker: where a new chat's brain comes from. Desktop stack
// (with a repo), a model on this device, Claude on your own key, or the demo.
// Choices the user has not set up yet stay visible with a warm pointer to the
// screen that sets them up, never a dead end.
import { useEffect, useState } from 'react';
import type { ConversationSource } from '../state/types.js';
import { useApp } from '../state/store.js';
import { bridge } from '../lib/electronBridge.js';
import { isDesktop, isPhone } from '../lib/platform.js';
import { daemonWorkspaces } from '../drivers/remoteDriver.js';
import { CLAUDE_MODELS } from '../drivers/cloudClaudeDriver.js';
import { HARBOR_MODEL_ID } from '../lib/harbor.js';
import { HARBOR_MINI_MODEL_ID } from '../lib/harborMini.js';

export function SourcePicker({
  onPick,
  onClose,
}: {
  onPick: (source: ConversationSource) => void;
  onClose: () => void;
}) {
  const { settings, cloudKeyPresent, setView, showToast, startGuide } = useApp();
  const [workspaces, setWorkspaces] = useState<Array<{ cwd: string; name: string }>>([]);
  const [stage, setStage] = useState<'sources' | 'repo' | 'claude-model' | 'device-model'>(
    'sources',
  );

  const desktopAvailable = isDesktop() || Boolean(settings.daemon);
  const deviceModels = Object.entries(settings.deviceModels);

  useEffect(() => {
    if (stage !== 'repo') return;
    void (async () => {
      try {
        if (isDesktop() && bridge()) setWorkspaces(await bridge()!.recentWorkspaces());
        else if (settings.daemon) setWorkspaces(await daemonWorkspaces(settings.daemon));
      } catch {
        setWorkspaces([]);
      }
    })();
  }, [stage, settings.daemon]);

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {stage === 'sources' ? (
          <>
            <h2>Who answers this chat?</h2>
            <p className="sheet-sub">
              Local first. Cloud is deliberate, always on your own account.
            </p>
            <div className="sheet-actions">
              <button className="btn primary" onClick={() => onPick({ kind: 'stack' })}>
                Your stack (Reasoning LLM routes)
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  void startGuide(HARBOR_MODEL_ID);
                  onClose();
                }}
              >
                Harbor, the built-in guide (no setup)
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  void startGuide(HARBOR_MINI_MODEL_ID);
                  onClose();
                }}
              >
                Harbor Mini, the smaller built-in guide
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  if (!desktopAvailable) {
                    setView('pair');
                    showToast('Connect your desktop first. Two minutes, one time.');
                    return;
                  }
                  setStage('repo');
                }}
              >
                Your desktop stack {isPhone() ? '(over Tailscale)' : ''}
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  if (!deviceModels.length) {
                    setView('marketplace');
                    showToast('Download a pocket model first. About a gigabyte.');
                    return;
                  }
                  setStage('device-model');
                }}
              >
                A model on this device
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  if (!cloudKeyPresent && !isDesktop()) {
                    setView('connections');
                    showToast('Add your Claude API key first.');
                    return;
                  }
                  setStage('claude-model');
                }}
              >
                Claude (your account)
              </button>
              <button className="btn quiet" onClick={() => onPick({ kind: 'mock' })}>
                Watch a scripted tour
              </button>
            </div>
          </>
        ) : null}

        {stage === 'repo' ? (
          <>
            <h2>Which repository?</h2>
            <p className="sheet-sub">The agent reads, edits, tests, and commits inside it.</p>
            <div className="sheet-actions">
              {workspaces.map((ws) => (
                <button
                  key={ws.cwd}
                  className="btn ghost"
                  onClick={() => onPick({ kind: 'desktop', cwd: ws.cwd, repoName: ws.name })}
                >
                  {ws.name}
                </button>
              ))}
              <button
                className="btn ghost"
                onClick={() => {
                  setView('repos');
                  onClose();
                }}
              >
                Clone or pick another repo
              </button>
              <button className="btn quiet" onClick={() => onPick({ kind: 'desktop' })}>
                No repo, just chat with the stack
              </button>
            </div>
          </>
        ) : null}

        {stage === 'device-model' ? (
          <>
            <h2>Which pocket model?</h2>
            <p className="sheet-sub">Runs fully on this device. Nothing leaves it.</p>
            <div className="sheet-actions">
              {deviceModels.map(([id, name]) => (
                <button
                  key={id}
                  className="btn ghost"
                  onClick={() => onPick({ kind: 'device', modelId: id, modelName: name })}
                >
                  {name}
                </button>
              ))}
              <button
                className="btn quiet"
                onClick={() => {
                  setView('marketplace');
                  onClose();
                }}
              >
                Get another from the marketplace
              </button>
            </div>
          </>
        ) : null}

        {stage === 'claude-model' ? (
          <>
            <h2>Which Claude?</h2>
            <p className="sheet-sub">
              {isDesktop()
                ? 'Runs through your desktop engine on your own key, with tools.'
                : 'Chat directly on your own key. Repo tools need the desktop connection.'}
            </p>
            <div className="sheet-actions">
              {CLAUDE_MODELS.map((m) => (
                <button
                  key={m.id}
                  className="btn ghost"
                  onClick={() => onPick({ kind: 'cloud', provider: 'anthropic', model: m.id })}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
