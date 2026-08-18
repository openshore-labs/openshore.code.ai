// Connections: your cloud accounts, on your own keys. Keys stay on the
// machine that uses them (the engine's credential store on desktop, secure
// app storage on the phone) and are only ever spent with your approval.
import { useEffect, useState } from 'react';
import { useApp } from '../state/store.js';
import { bridge } from '../lib/electronBridge.js';
import { isDesktop } from '../lib/platform.js';
import { BackBar } from '../components/BackBar.js';

interface ConnRow {
  id: 'anthropic' | 'openai' | 'github';
  name: string;
  blurb: string;
  placeholder: string;
  phoneSupported: boolean;
}

const ROWS: ConnRow[] = [
  {
    id: 'anthropic',
    name: 'Claude',
    blurb: 'Anthropic API key from console.anthropic.com. Powers cloud chat and escalation.',
    placeholder: 'sk-ant-...',
    phoneSupported: true,
  },
  {
    id: 'openai',
    name: 'ChatGPT',
    blurb: 'OpenAI API key from platform.openai.com. Used through your desktop stack.',
    placeholder: 'sk-...',
    phoneSupported: false,
  },
  {
    id: 'github',
    name: 'GitHub',
    blurb: 'A personal access token (repo scope) so the agent can push and open PRs.',
    placeholder: 'ghp_... or github_pat_...',
    phoneSupported: false,
  },
];

export function ConnectionsScreen() {
  const { cloudKeyPresent, setCloudKey, clearCloudKey, showToast } = useApp();
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | undefined>();
  const [value, setValue] = useState('');

  const refresh = async () => {
    if (isDesktop() && bridge()) {
      const status = await bridge()!.status();
      setConnected(status.connections as unknown as Record<string, boolean>);
    } else {
      setConnected({ anthropic: cloudKeyPresent, openai: false, github: false });
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudKeyPresent]);

  const save = async (row: ConnRow) => {
    const key = value.trim();
    setEditing(undefined);
    setValue('');
    if (!key) return;
    if (isDesktop() && bridge()) {
      const result =
        row.id === 'anthropic'
          ? await bridge()!.setAnthropicKey(key)
          : row.id === 'openai'
            ? await bridge()!.setOpenAIKey(key)
            : await bridge()!.setGithubToken(key);
      showToast(result.detail);
    } else if (row.id === 'anthropic') {
      await setCloudKey(key);
      showToast('Claude is connected on this device.');
    }
    await refresh();
  };

  return (
    <div className="screen">
      <BackBar title="Connections" />
      <div className="screen-inner">
        <h1>Connections</h1>
        <p className="lead">
          Your accounts, your keys. They stay on your hardware, and nothing cloud runs without
          your say.
        </p>

        {ROWS.map((row) => {
          const isOn = Boolean(connected[row.id]);
          const usable = isDesktop() || row.phoneSupported;
          return (
            <div className="card" key={row.id}>
              <div className="card-row">
                <div className="grow">
                  <h3>{row.name}</h3>
                  <div className="sub">{row.blurb}</div>
                </div>
                {isOn ? <span className="pill local">connected</span> : null}
                {usable ? (
                  isOn ? (
                    <button
                      className="btn ghost"
                      style={{ padding: '8px 14px' }}
                      onClick={async () => {
                        if (isDesktop() && bridge()) await bridge()!.disconnect(row.id);
                        else if (row.id === 'anthropic') await clearCloudKey();
                        showToast(`${row.name} disconnected.`);
                        await refresh();
                      }}
                    >
                      Remove
                    </button>
                  ) : (
                    <button
                      className="btn ghost"
                      style={{ padding: '8px 14px' }}
                      onClick={() => {
                        setEditing(row.id);
                        setValue('');
                      }}
                    >
                      Connect
                    </button>
                  )
                ) : (
                  <span className="pill muted">via desktop</span>
                )}
              </div>
              {editing === row.id ? (
                <div style={{ marginTop: 12 }}>
                  <div className="field">
                    <input
                      autoFocus
                      type="password"
                      placeholder={row.placeholder}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void save(row)}
                    />
                  </div>
                  <button className="btn primary" style={{ width: '100%' }} onClick={() => void save(row)}>
                    Save
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}

        <p className="hint">
          Subscription sign-in (using your Claude or ChatGPT plan instead of a key) is coming
          where the providers officially support it for third-party apps. Keys are the dependable
          path today.
        </p>
      </div>
    </div>
  );
}
