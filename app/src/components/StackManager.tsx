// The phone-side Stack manager. The Reasoning LLM is the anchor (required,
// immovable, replaceable). Models you download or connect land on the Bench;
// you place them into the active stack by choosing a category, and optionally a
// trigger and a persona (both required for a Custom category). Active models
// can move back to the Bench keeping their metadata, and everything is editable
// from the ellipses.
import { useState } from 'react';
import { useApp } from '../state/store.js';
import { BackBar } from './BackBar.js';
import { PROFILES, autoProfile, effectiveProfile } from '../lib/profiles.js';
import {
  STACK_CATEGORIES,
  categoryLabel,
  emptyStack,
  harborRef,
  placementValid,
  refKey,
  refName,
  type Placement,
  type StackModelRef,
} from '../lib/stack.js';

export function StackManager() {
  const { settings, connectivity, setReasoning, placeSpecialist, benchSpecialist, setView, showToast } =
    useApp();

  const profile = effectiveProfile(autoProfile(connectivity), settings.profileOverride);
  const stack = settings.stack ?? emptyStack();
  const reasoning = stack.reasoning ?? harborRef();

  const available: StackModelRef[] = [
    ...(settings.harborReady ? [harborRef()] : []),
    ...Object.entries(settings.deviceModels).map(
      ([modelId, modelName]): StackModelRef => ({ kind: 'device', modelId, modelName }),
    ),
  ];
  const activeKeys = new Set(stack.active.map((m) => refKey(m.ref)));
  const reasoningKey = refKey(reasoning);
  const bench = available.filter((r) => refKey(r) !== reasoningKey && !activeKeys.has(refKey(r)));

  // Placement sheet: configuring a bench model into the stack, or editing one.
  const [config, setConfig] = useState<{ ref: StackModelRef; placement: Placement } | undefined>();
  const [pickReasoning, setPickReasoning] = useState(false);
  const [menuKey, setMenuKey] = useState<string | undefined>();

  const openPlacement = (ref: StackModelRef, existing?: Placement) =>
    setConfig({ ref, placement: existing ?? { category: 'coding' } });

  const confirmPlacement = async () => {
    if (!config) return;
    if (!placementValid(config.placement)) {
      showToast('A custom category needs a trigger and a persona.');
      return;
    }
    await placeSpecialist(config.ref, config.placement);
    setConfig(undefined);
  };

  return (
    <div className="screen">
      <BackBar title="Your stack" />
      <div className="screen-inner">
        <h1>Your stack</h1>
        <p className="lead">
          Your Reasoning LLM plans every task and routes it to the specialist whose category fits.
          When nothing is placed for a task, the Reasoning LLM does it itself.
        </p>

        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="profile-dot" style={{ background: PROFILES[profile].dot }} />
          <div className="sub" style={{ margin: 0 }}>
            <strong style={{ color: 'var(--ink)' }}>{PROFILES[profile].label}.</strong>{' '}
            {PROFILES[profile].blurb}
          </div>
        </div>

        {/* Reasoning LLM anchor. Required and immovable, but replaceable. */}
        <div className="card">
          <div className="card-row">
            <div className="grow">
              <h3>
                Reasoning LLM <span className="sub">(runs the show)</span>
              </h3>
              <div className="sub">{refName(reasoning)}</div>
            </div>
            <span className="pill local">anchor</span>
            <button
              className="btn ghost"
              style={{ padding: '8px 14px' }}
              onClick={() => setPickReasoning(true)}
            >
              Change
            </button>
          </div>
        </div>

        <h3 style={{ margin: '18px 0 10px' }}>Active stack</h3>
        {stack.active.length === 0 ? (
          <p className="hint" style={{ marginBottom: 12 }}>
            No specialists yet. The Reasoning LLM handles everything until you place one.
          </p>
        ) : (
          stack.active.map((m) => (
            <div className="card" key={refKey(m.ref)}>
              <div className="card-row">
                <div className="grow">
                  <h3>{refName(m.ref)}</h3>
                  <div className="sub">
                    {categoryLabel(m.placement.category)}
                    {m.placement.whenCalled ? ` · ${m.placement.whenCalled}` : ''}
                  </div>
                </div>
                <button
                  className="icon-btn"
                  aria-label="Options"
                  onClick={() => setMenuKey(refKey(m.ref))}
                >
                  {'⋯'}
                </button>
              </div>
            </div>
          ))
        )}

        <h3 style={{ margin: '18px 0 10px' }}>Bench</h3>
        {bench.length === 0 ? (
          <p className="hint">
            Models you download from the{' '}
            <button
              className="hint"
              style={{ display: 'inline', padding: 0, textDecoration: 'underline' }}
              onClick={() => setView('marketplace')}
            >
              Marketplace
            </button>{' '}
            or connect land here, ready to place.
          </p>
        ) : (
          bench.map((ref) => (
            <div className="card" key={refKey(ref)}>
              <div className="card-row">
                <div className="grow">
                  <h3>{refName(ref)}</h3>
                  <div className="sub">On the bench. Place it to put it to work.</div>
                </div>
                <button
                  className="btn ghost"
                  style={{ padding: '8px 14px' }}
                  onClick={() => openPlacement(ref, stack.saved[refKey(ref)])}
                >
                  Add to stack
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Ellipses menu for an active specialist. */}
      {menuKey ? (
        <div className="sheet-scrim" onClick={() => setMenuKey(undefined)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>Options</h2>
            <div className="sheet-actions">
              <button
                className="btn ghost"
                onClick={() => {
                  const m = stack.active.find((x) => refKey(x.ref) === menuKey);
                  setMenuKey(undefined);
                  if (m) openPlacement(m.ref, m.placement);
                }}
              >
                Edit category, trigger, persona
              </button>
              <button
                className="btn ghost"
                onClick={async () => {
                  const key = menuKey;
                  setMenuKey(undefined);
                  await benchSpecialist(key);
                  showToast('Moved to the bench. Its settings are kept.');
                }}
              >
                Move to the bench
              </button>
              <button className="btn quiet" onClick={() => setMenuKey(undefined)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Reasoning LLM picker. */}
      {pickReasoning ? (
        <div className="sheet-scrim" onClick={() => setPickReasoning(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>Who runs the show?</h2>
            <p className="sheet-sub">
              The Reasoning LLM plans and routes. It can be any model you have.
            </p>
            <div className="sheet-actions">
              {available
                .filter((r) => refKey(r) !== reasoningKey)
                .map((r) => (
                  <button
                    key={refKey(r)}
                    className="btn ghost"
                    onClick={async () => {
                      setPickReasoning(false);
                      await setReasoning(r);
                      showToast(`${refName(r)} is your Reasoning LLM.`);
                    }}
                  >
                    {refName(r)}
                  </button>
                ))}
              {available.length <= 1 ? (
                <p className="hint">
                  Download a model from the Marketplace or connect a cloud model to choose another.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Placement config sheet. */}
      {config ? (
        <div className="sheet-scrim" onClick={() => setConfig(undefined)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>Place {refName(config.ref)}</h2>
            <p className="sheet-sub">Pick the category the Reasoning LLM calls it for.</p>

            <div className="suggestion-row" style={{ justifyContent: 'flex-start' }}>
              {STACK_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  className="suggestion"
                  style={
                    config.placement.category === c.id
                      ? { background: 'var(--local-soft)', color: 'var(--local)', borderColor: 'var(--local)' }
                      : undefined
                  }
                  onClick={() =>
                    setConfig({ ...config, placement: { ...config.placement, category: c.id } })
                  }
                >
                  {c.plain}
                </button>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 8 }}>
              {STACK_CATEGORIES.find((c) => c.id === config.placement.category)?.hint}
            </div>

            <div className="field" style={{ marginTop: 16 }}>
              <label>
                When it is called{config.placement.category === 'custom' ? '' : ' (optional)'}
              </label>
              <input
                placeholder="e.g. anything touching SQL or migrations"
                value={config.placement.whenCalled ?? ''}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    placement: { ...config.placement, whenCalled: e.target.value },
                  })
                }
              />
            </div>

            <div className="field">
              <label>Persona{config.placement.category === 'custom' ? '' : ' (optional)'}</label>
              <input
                placeholder="e.g. terse, cites the docs, prefers standard library"
                value={config.placement.persona ?? ''}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    placement: { ...config.placement, persona: e.target.value },
                  })
                }
              />
            </div>

            <div className="sheet-actions">
              <button
                className="btn primary"
                disabled={!placementValid(config.placement)}
                onClick={() => void confirmPlacement()}
              >
                Add to active stack
              </button>
              <button className="btn quiet" onClick={() => setConfig(undefined)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
