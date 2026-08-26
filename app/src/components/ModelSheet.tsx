// The model sheet, in the Claude app's "Select model" shape. The root shows the
// default (My Stack), any models the user has pinned, the effort control, and two
// category buttons that open dedicated sheets, the way Claude's "more models"
// expands: Cloud Providers and Local LLMs. Each category has an honest empty
// state that routes to setup. When no stack exists yet, My Stack is greyed with a
// link to build one. Models in the category sheets swipe left to pin; a pinned
// model rides under My Stack for one-tap use and swipes there to unpin.
import { useState } from 'react';
import type { ConversationSource } from '../state/types.js';
import { useApp } from '../state/store.js';
import { useSheetExit } from '../hooks/useSheetExit.js';
import { isDesktop } from '../lib/platform.js';
import { CLAUDE_MODELS, claudeModelLabel } from '../lib/claudeModels.js';
import { PROVIDERS } from '../lib/providers.js';
import { EFFORTS, effortLabel, DEFAULT_EFFORT } from '../lib/effort.js';
import { isPinned, pinKey, togglePin } from '../lib/pins.js';
import { SwipeRow } from './SwipeRow.js';

function RowContent({
  main,
  sub,
  value,
  chevron,
}: {
  main: string;
  sub?: string;
  value?: string;
  chevron?: boolean;
}) {
  return (
    <>
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
    </>
  );
}

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
      <RowContent main={main} sub={sub} value={value} chevron={chevron} />
    </button>
  );
}

/** A short, human name for a pinned source, shown under My Stack. */
function pinLabel(s: ConversationSource): string {
  if (s.kind === 'cloud') return claudeModelLabel(s.model);
  if (s.kind === 'device') return s.modelName;
  return 'Model';
}

function pinSub(s: ConversationSource): string {
  if (s.kind === 'cloud') return 'Claude, in the cloud';
  if (s.kind === 'device') return 'Runs fully on this device';
  return '';
}

export function ModelSheet({
  onPick,
  onClose,
  initialStage = 'root',
}: {
  onPick: (source: ConversationSource) => void;
  onClose: () => void;
  /** Which sub-sheet to open on. Defaults to root; the out-of-usage tap opens 'local'. */
  initialStage?: 'root' | 'effort' | 'cloud' | 'local';
}) {
  const { settings, connectedProviders, cloudKeyPresent, saveSettings, setView, showToast } =
    useApp();
  const [stage, setStage] = useState<'root' | 'effort' | 'cloud' | 'local'>(initialStage);
  const { closing, dismiss } = useSheetExit(onClose);
  const effort = settings.effort ?? DEFAULT_EFFORT;

  const hasStack = Boolean(settings.stack);
  const claudeReady = cloudKeyPresent || isDesktop();
  const otherProviders = PROVIDERS.filter((p) => p.id !== 'anthropic' && connectedProviders[p.id]);
  const cloudEmpty = !claudeReady && otherProviders.length === 0;
  const deviceModels = Object.entries(settings.deviceModels);
  const pins = settings.pinnedModels ?? [];

  const setPin = (source: ConversationSource) => {
    void saveSettings({ pinnedModels: togglePin(pins, source) });
  };

  const goto = (view: Parameters<typeof setView>[0]) => {
    setView(view);
    onClose();
  };

  const Header = ({ title }: { title: string }) => (
    <div className="mode-head">
      <button
        className="mode-close press-fb"
        aria-label={stage === 'root' ? 'Close' : 'Back'}
        onClick={() => (stage === 'root' ? dismiss() : setStage('root'))}
      >
        {stage === 'root' ? '×' : '‹'}
      </button>
      <h2>{title}</h2>
    </div>
  );

  return (
    <div className={`sheet-scrim${closing ? ' closing' : ''}`} onClick={dismiss}>
      <div
        className={`sheet model-sheet${closing ? ' closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
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
              {settings.daemon ? (
                <Row
                  main="Your desktop"
                  sub="Chat with your desktop's local models. Free."
                  onClick={() => onPick({ kind: 'desktop-chat' })}
                />
              ) : null}
              {pins.map((src) => (
                <SwipeRow
                  key={pinKey(src)}
                  pinned
                  onTap={() => onPick(src)}
                  onToggle={() => setPin(src)}
                >
                  <div className="ms-row">
                    <RowContent main={pinLabel(src)} sub={pinSub(src)} />
                  </div>
                </SwipeRow>
              ))}
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
                      {CLAUDE_MODELS.map((m) => {
                        const src: ConversationSource = {
                          kind: 'cloud',
                          provider: 'anthropic',
                          model: m.id,
                        };
                        return (
                          <SwipeRow
                            key={m.id}
                            pinned={isPinned(pins, src)}
                            onTap={() => onPick(src)}
                            onToggle={() => setPin(src)}
                          >
                            <div className="ms-row">
                              <RowContent main={m.label} sub={m.blurb} />
                            </div>
                          </SwipeRow>
                        );
                      })}
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
                {deviceModels.map(([id, name]) => {
                  const src: ConversationSource = {
                    kind: 'device',
                    modelId: id,
                    modelName: name,
                  };
                  return (
                    <SwipeRow
                      key={id}
                      pinned={isPinned(pins, src)}
                      onTap={() => onPick(src)}
                      onToggle={() => setPin(src)}
                    >
                      <div className="ms-row">
                        <RowContent main={name} sub="Runs fully on this device" />
                      </div>
                    </SwipeRow>
                  );
                })}
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
