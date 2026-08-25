// The model sheet, opened from the composer. Mirrors the Claude app's model
// picker, adapted to a stack: reasoning effort is pinned at the very top so it
// never gets lost below the model list, then "My Stack" (the default), then the
// cloud providers you have connected by API key (each opens a sheet of that
// provider's models, the way Claude's "more models" expands), then the models
// on this device, largest first. Small gaps between the groups keep it
// browsable.
import { useState } from 'react';
import type { ConversationSource } from '../state/types.js';
import { useApp } from '../state/store.js';
import { isDesktop } from '../lib/platform.js';
import { CLAUDE_MODELS } from '../drivers/cloudClaudeDriver.js';
import { PROVIDERS } from '../lib/providers.js';
import { EFFORTS, effortLabel, DEFAULT_EFFORT } from '../lib/effort.js';

function Row({
  main,
  sub,
  chevron,
  highlight,
  onClick,
}: {
  main: string;
  sub?: string;
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
  const [stage, setStage] = useState<'root' | 'claude'>('root');
  const effort = settings.effort ?? DEFAULT_EFFORT;

  // Claude can start a chat directly (its own driver): with an API key, or
  // through the desktop engine. Other providers run inside the stack, so they
  // are offered as a pointer to the stack rather than a direct chat here.
  const claudeReady = cloudKeyPresent || isDesktop();
  const otherProviders = PROVIDERS.filter((p) => p.id !== 'anthropic' && connectedProviders[p.id]);

  // Pocket models downloaded to this device, largest first is how the
  // marketplace lists them, so insertion order trends that way.
  const deviceModels = Object.entries(settings.deviceModels);

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet model-sheet" onClick={(e) => e.stopPropagation()}>
        {stage === 'root' ? (
          <>
            {/* Effort, at the very top, on purpose. */}
            <div className="ms-effort" role="group" aria-label="Reasoning effort">
              <span className="ms-effort-label">Effort</span>
              <div className="ms-seg">
                <span
                  className="ms-seg-slider"
                  style={{ transform: `translateX(${EFFORTS.indexOf(effort) * 100}%)` }}
                  aria-hidden="true"
                />
                {EFFORTS.map((e) => (
                  <button
                    key={e}
                    className={`ms-seg-btn press-fb${e === effort ? ' active' : ''}`}
                    aria-pressed={e === effort}
                    onClick={() => void saveSettings({ effort: e })}
                  >
                    {effortLabel(e)}
                  </button>
                ))}
              </div>
            </div>

            {/* My Stack, the default. */}
            <div className="ms-group">
              <Row
                main="My Stack"
                sub="Your Reasoning LLM routes each task"
                highlight
                onClick={() => onPick({ kind: 'stack' })}
              />
            </div>

            {/* Connected cloud providers. Claude opens its own model sheet. */}
            {claudeReady || otherProviders.length ? (
              <div className="ms-group">
                <div className="ms-heading">Cloud providers</div>
                {claudeReady ? (
                  <Row main="Claude" chevron onClick={() => setStage('claude')} />
                ) : null}
                {otherProviders.map((p) => (
                  <Row
                    key={p.id}
                    main={p.name}
                    sub="Runs in your stack"
                    onClick={() => {
                      setView('stack');
                      onClose();
                      showToast(
                        `${p.name} models run inside your stack. Place them in Your stack.`,
                      );
                    }}
                  />
                ))}
              </div>
            ) : null}

            {/* Models on this device, largest first. */}
            {deviceModels.length ? (
              <div className="ms-group">
                <div className="ms-heading">On this device</div>
                {deviceModels.map(([id, name]) => (
                  <Row
                    key={id}
                    main={name}
                    sub="Runs fully on this device"
                    onClick={() => onPick({ kind: 'device', modelId: id, modelName: name })}
                  />
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {stage === 'claude' ? (
          <>
            <button className="ms-back press-fb" onClick={() => setStage('root')}>
              {'‹ Back'}
            </button>
            <div className="ms-heading">Claude models</div>
            <div className="ms-group">
              {CLAUDE_MODELS.map((m) => (
                <Row
                  key={m.id}
                  main={m.label}
                  onClick={() => onPick({ kind: 'cloud', provider: 'anthropic', model: m.id })}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
