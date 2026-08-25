// The model sheet, in the Claude app's "Select model" shape. The root shows the
// default (My Stack), the effort control, and two category buttons that open
// dedicated sheets, the way Claude's "more models" expands: Cloud Providers and
// Local LLMs. Each category has an honest empty state that routes to setup. When
// no stack exists yet, My Stack is greyed with a link to build one.
import { useState } from 'react';
import type { ConversationSource } from '../state/types.js';
import { useApp } from '../state/store.js';
import { isDesktop } from '../lib/platform.js';
import { CLAUDE_MODELS } from '../lib/claudeModels.js';
import { PROVIDERS } from '../lib/providers.js';
import { EFFORTS, effortLabel, DEFAULT_EFFORT } from '../lib/effort.js';

function Row({
  main,
  sub,
  value,
  chevron,
  highlight,
  onClick,
}: {
  main: string;
  sub?: string;
  value?: string;
  chevron?: boolean;
  highlight?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`ms-row press-fb${highlight ? ' ms-row-default' : ''}`} onClick={onClick}>
      <span className="ms-row-text">
        <span className="ms-row-main">{main}</span>
        {sub ? <span className="ms-row-sub">{sub}</span> : null}
      </span>
      {value ? <span className="ms-row-value">{value}</span> : null}
      {chevron ? (
        <span className="ms-row-chev" aria-hidden="true">
          {'›'}
        </span>
      ) : null}
    </button>
  );
}

export function ModelSheet({
  onPick,
  onClose,
}: {
  onPick: (source: ConversationSource) => void;
  onClose: () => void;
}) {
  const { settings, connectedProviders, cloudKeyPresent, saveSettings, setView, showToast } =
    useApp();
  const [stage, setStage] = useState<'root' | 'effort' | 'cloud' | 'local'>('root');
  const effort = settings.effort ?? DEFAULT_EFFORT;

  const hasStack = Boolean(settings.stack);
  const claudeReady = cloudKeyPresent || isDesktop();
  const otherProviders = PROVIDERS.filter((p) => p.id !== 'anthropic' && connectedProviders[p.id]);
  const cloudEmpty = !claudeReady && otherProviders.length === 0;
  const deviceModels = Object.entries(settings.deviceModels);

  const goto = (view: Parameters<typeof setView>[0]) => {
    setView(view);
    onClose();
  };

  const Header = ({ title }: { title: string }) => (
    <div className="mode-head">
      <button
        className="mode-close press-fb"
        aria-label={stage === 'root' ? 'Close' : 'Back'}
        onClick={() => (stage === 'root' ? onClose() : setStage('root'))}
      >
        {stage === 'root' ? '×' : '‹'}
      </button>
      <h2>{title}</h2>
    </div>
  );

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet model-sheet" onClick={(e) => e.stopPropagation()}>
        {stage === 'root' ? (
          <>
            <Header title="Select model" />
            <div className="ms-group">
              {hasStack ? (
                <Row
                  main="My Stack"
                  sub="Your Reasoning LLM routes each task"
                  highlight
                  onClick={() => onPick({ kind: 'stack' })}
                />
              ) : (
                <div className="ms-row ms-row-disabled">
                  <span className="ms-row-text">
                    <span className="ms-row-main">My Stack</span>
                    <button className="ms-sublink press-fb" onClick={() => goto('stack')}>
                      Create your stack to get started
                    </button>
                  </span>
                </div>
              )}
            </div>

            <div className="ms-group">
              <Row
                main="Effort"
                value={effortLabel(effort)}
                chevron
                onClick={() => setStage('effort')}
              />
            </div>

            <div className="ms-group">
              <Row main="Cloud Providers" chevron onClick={() => setStage('cloud')} />
              <Row main="Local LLMs" chevron onClick={() => setStage('local')} />
            </div>
          </>
        ) : null}

        {stage === 'effort' ? (
          <>
            <Header title="Effort" />
            <div className="ms-group">
              {EFFORTS.map((e) => (
                <Row
                  key={e}
                  main={effortLabel(e)}
                  value={e === effort ? '✓' : undefined}
                  onClick={() => {
                    void saveSettings({ effort: e });
                    setStage('root');
                  }}
                />
              ))}
            </div>
          </>
        ) : null}

        {stage === 'cloud' ? (
          <>
            <Header title="Cloud Providers" />
            {cloudEmpty ? (
              <button className="ms-empty press-fb" onClick={() => goto('connections')}>
                No connected providers, add your API to get started.
              </button>
            ) : (
              <>
                {claudeReady ? (
                  <>
                    <div className="ms-heading">Claude</div>
                    <div className="ms-group">
                      {CLAUDE_MODELS.map((m) => (
                        <Row
                          key={m.id}
                          main={m.label}
                          sub={m.blurb}
                          onClick={() =>
                            onPick({ kind: 'cloud', provider: 'anthropic', model: m.id })
                          }
                        />
                      ))}
                    </div>
                  </>
                ) : null}
                {otherProviders.length ? (
                  <>
                    <div className="ms-heading">In your stack</div>
                    <div className="ms-group">
                      {otherProviders.map((p) => (
                        <Row
                          key={p.id}
                          main={p.name}
                          sub="Runs inside your stack"
                          onClick={() => {
                            goto('stack');
                            showToast(`${p.name} models run inside your stack.`);
                          }}
                        />
                      ))}
                    </div>
                  </>
                ) : null}
              </>
            )}
          </>
        ) : null}

        {stage === 'local' ? (
          <>
            <Header title="Local LLMs" />
            {deviceModels.length ? (
              <div className="ms-group">
                {deviceModels.map(([id, name]) => (
                  <Row
                    key={id}
                    main={name}
                    sub="Runs fully on this device"
                    onClick={() => onPick({ kind: 'device', modelId: id, modelName: name })}
                  />
                ))}
              </div>
            ) : (
              <button className="ms-empty press-fb" onClick={() => goto('marketplace')}>
                No connected local LLMs, download a model from the Marketplace to get started.
              </button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
