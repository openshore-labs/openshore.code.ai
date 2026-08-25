// The phone-side Stack manager. The Reasoning LLM is the anchor (required,
// immovable, replaceable). Models you download or connect land on the Bench;
// you place them into the active stack by choosing a category, and optionally a
// trigger and a persona (both required for a Custom category). Active models
// can move back to the Bench keeping their metadata, and everything is editable
// from the ellipses.
import { useState } from 'react';
import { stackAdmin, useApp } from '../state/store.js';
import { BackBar } from './BackBar.js';
import { PROFILES, autoProfile, effectiveProfile } from '../lib/profiles.js';
import { PROVIDERS } from '../lib/providers.js';
import { byomRef, normalizeBaseUrl } from '../lib/byom.js';
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

/** The host of a BYOM base URL, for a compact bench sub-line. Falls back to
 *  the raw string if it does not parse. */
function byomHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export function StackManager() {
  const {
    settings,
    connectivity,
    connectedProviders,
    setReasoning,
    placeSpecialist,
    benchSpecialist,
    connectByom,
    disconnectByom,
    setView,
    showToast,
  } = useApp();

  const admin = stackAdmin(settings.account);
  const profile = effectiveProfile(autoProfile(connectivity), settings.profileOverride);
  const stack = settings.stack ?? emptyStack();
  const reasoning = stack.reasoning ?? harborRef();

  const deviceRefs: StackModelRef[] = [
    ...(settings.harborReady ? [harborRef()] : []),
    ...Object.entries(settings.deviceModels).map(([modelId, modelName]): StackModelRef => ({
      kind: 'device',
      modelId,
      modelName,
    })),
  ];
  const byomRefs: StackModelRef[] = (settings.byomModels ?? []).map(byomRef);
  const cloudRefs: StackModelRef[] = PROVIDERS.filter((p) => connectedProviders[p.id]).flatMap(
    (p) =>
      p.models.map((m): StackModelRef => ({
        kind: 'cloud',
        provider: p.id,
        model: m.id,
        label: m.label,
      })),
  );
  const available: StackModelRef[] = [...deviceRefs, ...byomRefs, ...cloudRefs];
  const activeKeys = new Set(stack.active.map((m) => refKey(m.ref)));
  const reasoningKey = refKey(reasoning);
  const placed = (r: StackModelRef) => refKey(r) === reasoningKey || activeKeys.has(refKey(r));
  // The local bench holds on-device and bring-your-own-model refs, both placed
  // the same way; connected cloud providers get their own grouped section.
  const bench = [...deviceRefs, ...byomRefs].filter((r) => !placed(r));
  const cloudBench = PROVIDERS.filter((p) => connectedProviders[p.id])
    .map((p) => ({
      provider: p,
      models: p.models.filter(
        (m) => !placed({ kind: 'cloud', provider: p.id, model: m.id, label: m.label }),
      ),
    }))
    .filter((g) => g.models.length > 0);

  // Placement sheet: configuring a bench model into the stack, or editing one.
  const [config, setConfig] = useState<{ ref: StackModelRef; placement: Placement } | undefined>();
  const [pickReasoning, setPickReasoning] = useState(false);
  const [menuKey, setMenuKey] = useState<string | undefined>();
  const [cloudPick, setCloudPick] = useState<Record<string, string>>({});

  // Bring-your-own-model connect form, and the id of the benched BYOM whose
  // options sheet is open.
  const [byomOpen, setByomOpen] = useState(false);
  const [byomForm, setByomForm] = useState({ label: '', baseUrl: '', model: '', apiKey: '' });
  const [byomMenuId, setByomMenuId] = useState<string | undefined>();
  const byomFormValid =
    byomForm.label.trim() !== '' &&
    byomForm.model.trim() !== '' &&
    /^https?:\/\/.+/i.test(byomForm.baseUrl.trim());

  const saveByom = async () => {
    if (!byomFormValid) {
      showToast('A name, an https endpoint, and a model id are needed.');
      return;
    }
    const conn = await connectByom({
      label: byomForm.label,
      baseUrl: normalizeBaseUrl(byomForm.baseUrl),
      model: byomForm.model,
      apiKey: byomForm.apiKey,
    });
    setByomOpen(false);
    setByomForm({ label: '', baseUrl: '', model: '', apiKey: '' });
    showToast(`${conn.label} is on your bench. Place it to put it to work.`);
  };

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
        <div className="stack-head">
          <h1>{admin ? 'Your stack' : 'The stack'}</h1>
          {admin ? (
            <button
              className="stack-add-btn"
              aria-label="Bring your own model"
              title="Bring your own model"
              onClick={() => setByomOpen(true)}
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          ) : null}
        </div>
        <p className="lead">
          {admin
            ? 'Your Reasoning LLM plans every task and routes it to the specialist whose category fits. When nothing is placed for a task, the Reasoning LLM does it itself.'
            : 'Your admin sets the shared stack for the company. It plans every task and routes it to the specialist whose category fits. You can talk with your admin about changing it.'}
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
            {admin ? (
              <button
                className="btn ghost"
                style={{ padding: '8px 14px' }}
                onClick={() => setPickReasoning(true)}
              >
                Change
              </button>
            ) : (
              <span className="lock-hint" aria-label="Admin owned">
                <span className="lock-glyph" aria-hidden="true" />
              </span>
            )}
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
                {admin ? (
                  <button
                    className="icon-btn"
                    aria-label="Options"
                    onClick={() => setMenuKey(refKey(m.ref))}
                  >
                    {'⋯'}
                  </button>
                ) : (
                  <span className="lock-hint" aria-label="Admin owned">
                    <span className="lock-glyph" aria-hidden="true" />
                  </span>
                )}
              </div>
            </div>
          ))
        )}

        {!admin ? (
          <p className="hint" style={{ marginTop: 12 }}>
            The bench and stack controls are managed by your admin. Everything else in OpenShore, your
            chats, projects, and crew, is yours to set up as you like.
          </p>
        ) : (
          <>
            <h3 style={{ margin: '18px 0 10px' }}>Bench</h3>
            {bench.length === 0 && cloudBench.length === 0 ? (
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
                      <h3>
                        {refName(ref)}
                        {ref.kind === 'byom' ? <span className="sub"> (your model)</span> : null}
                      </h3>
                      <div className="sub">
                        {ref.kind === 'byom'
                          ? `On the bench. ${ref.model} at ${byomHost(ref.baseUrl)}.`
                          : 'On the bench. Place it to put it to work.'}
                      </div>
                    </div>
                    <button
                      className="btn ghost"
                      style={{ padding: '8px 14px' }}
                      onClick={() => openPlacement(ref, stack.saved[refKey(ref)])}
                    >
                      Add to stack
                    </button>
                    {ref.kind === 'byom' ? (
                      <button
                        className="icon-btn"
                        aria-label="Options"
                        onClick={() => setByomMenuId(ref.id)}
                      >
                        {'⋯'}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            )}

            {/* Connected cloud providers: pick a model, then place it. */}
            {cloudBench.map(({ provider, models }) => {
              const picked = cloudPick[provider.id] ?? models[0]!.id;
              const ref: StackModelRef = {
                kind: 'cloud',
                provider: provider.id,
                model: picked,
                label: models.find((m) => m.id === picked)?.label ?? picked,
              };
              return (
                <div className="card" key={`cloud-${provider.id}`}>
                  <div className="card-row">
                    <div className="grow">
                      <h3>
                        {provider.name} <span className="sub">(cloud)</span>
                      </h3>
                      <div className="field" style={{ margin: '8px 0 0' }}>
                        <select
                          value={picked}
                          onChange={(e) =>
                            setCloudPick({ ...cloudPick, [provider.id]: e.target.value })
                          }
                          style={{
                            width: '100%',
                            background: 'var(--bg-raised)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: 10,
                            padding: '10px 12px',
                            fontSize: 15,
                            color: 'var(--ink)',
                          }}
                        >
                          {models.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </div>
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
              );
            })}
          </>
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

      {/* Bring-your-own-model connect sheet. */}
      {byomOpen ? (
        <div className="sheet-scrim" onClick={() => setByomOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>Bring your own model</h2>
            <p className="sheet-sub">
              Point OpenShore at any OpenAI-compatible endpoint you control: a self-hosted server, a
              fine-tune behind your own gateway, or another provider. It lands on your bench, ready
              to place.
            </p>

            <div className="field">
              <label>Name</label>
              <input
                autoFocus
                placeholder="e.g. Our house model"
                value={byomForm.label}
                onChange={(e) => setByomForm({ ...byomForm, label: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Endpoint URL</label>
              <input
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="https://your-host/v1"
                value={byomForm.baseUrl}
                onChange={(e) => setByomForm({ ...byomForm, baseUrl: e.target.value })}
              />
              <div className="hint" style={{ marginTop: 4 }}>
                The base URL, ending in /v1. OpenShore calls /chat/completions on it.
              </div>
            </div>
            <div className="field">
              <label>Model id</label>
              <input
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="e.g. llama-3.1-70b-instruct"
                value={byomForm.model}
                onChange={(e) => setByomForm({ ...byomForm, model: e.target.value })}
              />
            </div>
            <div className="field">
              <label>API key (optional)</label>
              <input
                type="password"
                placeholder="Leave blank for a keyless local server"
                value={byomForm.apiKey}
                onChange={(e) => setByomForm({ ...byomForm, apiKey: e.target.value })}
              />
              <div className="hint" style={{ marginTop: 4 }}>
                Stored in this device's secure store, scoped to this connection, never synced.
              </div>
            </div>

            <div className="sheet-actions">
              <button
                className="btn primary"
                disabled={!byomFormValid}
                onClick={() => void saveByom()}
              >
                Add to bench
              </button>
              <button className="btn quiet" onClick={() => setByomOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Options for a benched BYOM model. */}
      {byomMenuId ? (
        <div className="sheet-scrim" onClick={() => setByomMenuId(undefined)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>Options</h2>
            <div className="sheet-actions">
              <button
                className="btn ghost"
                onClick={() => {
                  const conn = (settings.byomModels ?? []).find((c) => c.id === byomMenuId);
                  setByomMenuId(undefined);
                  if (conn) openPlacement(byomRef(conn), stack.saved[`byom:${conn.id}`]);
                }}
              >
                Add to stack
              </button>
              <button
                className="btn quiet"
                onClick={async () => {
                  const id = byomMenuId!;
                  setByomMenuId(undefined);
                  await disconnectByom(id);
                  showToast('Disconnected. Its key was removed from this device.');
                }}
              >
                Disconnect
              </button>
              <button className="btn quiet" onClick={() => setByomMenuId(undefined)}>
                Cancel
              </button>
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
                      ? {
                          background: 'var(--local-soft)',
                          color: 'var(--local)',
                          borderColor: 'var(--local)',
                        }
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
