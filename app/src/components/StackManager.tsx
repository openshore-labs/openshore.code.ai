// The phone-side Stack manager. The Reasoning LLM is the anchor (required,
// immovable, replaceable). Models you download or connect land on the Bench;
// you place them into the active stack by choosing a category, and optionally a
// trigger and a persona (both required for a Custom category). Active models
// can move back to the Bench keeping their metadata, and everything is editable
// from the ellipses.
import { useEffect, useState } from 'react';
import { agenticView, stackAdmin, useApp } from '../state/store.js';
import { BackBar } from './BackBar.js';
import {
  PROFILES,
  PROFILE_ORDER,
  autoProfile,
  effectiveProfile,
  type ProfileId,
} from '../lib/profiles.js';
import { PROVIDERS, type ProviderInfo } from '../lib/providers.js';
import { CLAUDE_MODELS } from '../lib/claudeModels.js';
import { isPinned } from '../lib/pins.js';
import { byomPlainHttpToCloud, byomReach, byomRef, normalizeBaseUrl } from '../lib/byom.js';
import { hubTailnetSuffix } from '../lib/vaultSeat.js';
import { daemonStack } from '../drivers/remoteDriver.js';
import { dockedNoun, dockedNounLower } from '../lib/docking.js';
import {
  activeContribution,
  currentBenchRefs,
  isCurrentBenchId,
  slotNone,
} from '../lib/currents.js';
import {
  STACK_CATEGORIES,
  categoryLabel,
  defaultVisionCloudRef,
  harborRef,
  placementValid,
  refKey,
  refName,
  stackForProfile,
  visionSlots,
  type Placement,
  type StackModelRef,
} from '../lib/stack.js';
import { EFFORTS, effortLabel, DEFAULT_EFFORT, type Effort } from '../lib/effort.js';
import { Sheet } from './Sheet.js';
import { SheetHead } from './SheetHead.js';
import { SettingsGroup, SettingsRow } from './SettingsRow.js';

/** A cloud provider's selectable models for the bench. Claude comes from the
 *  full client lineup (claudeModels.ts, the same list and tiers the chat sheet
 *  uses), so the bench offers every Claude model and its favorites, not the
 *  short marketplace set; other providers keep their own model list. */
type BenchModel = { id: string; label: string; tier?: 'primary' | 'more' };
function providerBenchModels(p: ProviderInfo): BenchModel[] {
  return p.id === 'anthropic'
    ? CLAUDE_MODELS.map((m) => ({ id: m.id, label: m.label, tier: m.tier }))
    : p.models.map((m) => ({ id: m.id, label: m.label }));
}

/** The host of a BYOM base URL, for a compact bench sub-line. Falls back to
 *  the raw string if it does not parse. */
function byomHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** One consistent read on where a model runs, so the whole stack is legible at
 *  a glance: teal for local and private (on device, or your own server on this
 *  machine, the home network, or a tailnet), amber for cloud (spend and
 *  off-device, including a BYOM pointed at a hosted API). The same language
 *  the rest of the app uses. */
function kindMeta(
  ref: StackModelRef,
  ownTailnetSuffix: string | null,
): { cls: 'local' | 'cloud'; label: string } {
  if (ref.kind === 'cloud') return { cls: 'cloud', label: 'cloud' };
  if (ref.kind === 'byom') {
    return byomReach(ref.baseUrl, ownTailnetSuffix) === 'local'
      ? { cls: 'local', label: 'your server' }
      : { cls: 'cloud', label: 'cloud' };
  }
  return { cls: 'local', label: 'on device' };
}

/** The teal/amber chip for a model's location. */
function KindChip({ refModel }: { refModel: StackModelRef }) {
  // This device's own tailnet is the paired hub's (CTO J2), so another
  // tailnet's server reads cloud, exactly as the vault pack judges it.
  const hubUrl = useApp((s) => s.settings.daemon?.baseUrl);
  const { cls, label } = kindMeta(refModel, hubTailnetSuffix(hubUrl));
  return <span className={`kind-chip ${cls}`}>{label}</span>;
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
    showToast,
  } = useApp();

  const admin = stackAdmin(settings.account);
  // The status the device is in right now. Its stack is the one used
  // automatically; the app switches between the three as the status changes.
  const profile = effectiveProfile(autoProfile(connectivity), settings.profileOverride);
  // Which status's stack is being viewed and edited here. Opens on the current
  // status; a picker below lets you tune the other two without being in them.
  const [editProfile, setEditProfile] = useState<ProfileId>(profile);
  const stack = stackForProfile(settings.stacks, editProfile);
  const reasoning = stack.reasoning ?? harborRef();
  // The two Vision slots (a local model and a cloud model), split out of the
  // active list so the manager shows a dedicated Image reading card.
  const slots = visionSlots(stack);
  const nonVisionActive = stack.active.filter((m) => m.placement.category !== 'vision');

  const deviceRefs: StackModelRef[] = [
    ...(settings.harborReady ? [harborRef()] : []),
    ...Object.entries(settings.deviceModels).map(([modelId, modelName]): StackModelRef => ({
      kind: 'device',
      modelId,
      modelName,
    })),
  ];
  // The bench holds the person's own endpoints plus the model an Agentic
  // Current contributes while it is on (none when none is on). Both are
  // BYOM-shaped, so they place and run through the same path.
  const agentic = agenticView(settings);
  const current = activeContribution(agentic);
  const byomRefs: StackModelRef[] = [
    ...(settings.byomModels ?? []).map(byomRef),
    ...currentBenchRefs(agentic),
  ];
  const cloudRefs: StackModelRef[] = PROVIDERS.filter((p) => connectedProviders[p.id]).flatMap(
    (p) =>
      providerBenchModels(p).map((m): StackModelRef => ({
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
  const pins = settings.pinnedModels ?? [];
  const cloudBench = PROVIDERS.filter((p) => connectedProviders[p.id])
    .map((p) => ({
      provider: p,
      models: providerBenchModels(p).filter(
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
  const [byomInfoOpen, setByomInfoOpen] = useState(false);
  const [byomForm, setByomForm] = useState({ label: '', baseUrl: '', model: '', apiKey: '' });
  const [byomMenuId, setByomMenuId] = useState<string | undefined>();
  const byomFormValid =
    byomForm.label.trim() !== '' &&
    byomForm.model.trim() !== '' &&
    /^https?:\/\/.+/i.test(byomForm.baseUrl.trim());

  const saveByom = async () => {
    if (!byomFormValid) {
      showToast('A name, an https address, and a model id are needed.');
      return;
    }
    const hub = hubTailnetSuffix(useApp.getState().settings.daemon?.baseUrl);
    if (byomPlainHttpToCloud(byomForm.baseUrl, hub)) {
      showToast(
        'Use an https address for a server outside your own network, so your key is not sent in plain text.',
      );
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
    await placeSpecialist(config.ref, config.placement, editProfile);
    setConfig(undefined);
  };

  // ---- Vision slots -------------------------------------------------------
  // Two positions in one category: a local model (on-device or your own server)
  // and a cloud model. Each carries its own effort. The cloud slot defaults to
  // the most capable cloud model until a person assigns one.
  const localVisionRefs = [...deviceRefs, ...byomRefs];
  const [visionEdit, setVisionEdit] = useState<
    { slot: 'local' | 'cloud'; pickKey: string; effort: Effort } | undefined
  >();
  const eligibleVisionRefs = (slot: 'local' | 'cloud') =>
    slot === 'local' ? localVisionRefs : cloudRefs;
  const openVisionEdit = (slot: 'local' | 'cloud') => {
    const member = slot === 'local' ? slots.local : slots.cloud;
    const initial =
      member?.ref ?? (slot === 'cloud' ? defaultVisionCloudRef() : localVisionRefs[0]);
    setVisionEdit({
      slot,
      pickKey: initial ? refKey(initial) : '',
      effort: member?.placement.effort ?? DEFAULT_EFFORT,
    });
  };
  const saveVisionSlot = async () => {
    if (!visionEdit) return;
    const ref = eligibleVisionRefs(visionEdit.slot).find((r) => refKey(r) === visionEdit.pickKey);
    if (!ref) {
      showToast('Pick a model for this slot first.');
      return;
    }
    const existing = visionEdit.slot === 'local' ? slots.local : slots.cloud;
    // Replacing the slot: move the old model to the bench (its settings are
    // kept) so the slot holds exactly one model of its kind.
    if (existing && refKey(existing.ref) !== refKey(ref)) {
      await benchSpecialist(refKey(existing.ref), editProfile);
    }
    await placeSpecialist(ref, { category: 'vision', effort: visionEdit.effort }, editProfile);
    setVisionEdit(undefined);
  };
  const clearVisionSlot = async () => {
    if (!visionEdit) return;
    const existing = visionEdit.slot === 'local' ? slots.local : slots.cloud;
    if (existing) await benchSpecialist(refKey(existing.ref), editProfile);
    setVisionEdit(undefined);
  };

  // A Vision slot's display line: the assigned model and its effort, or the
  // default/empty state.
  const slotLine = (slot: 'local' | 'cloud'): { title: string; sub: string } => {
    const member = slot === 'local' ? slots.local : slots.cloud;
    if (member) {
      return {
        title: refName(member.ref),
        sub: `${effortLabel(member.placement.effort ?? DEFAULT_EFFORT)} effort`,
      };
    }
    if (slot === 'cloud') {
      return {
        title: `${refName(defaultVisionCloudRef())} (default)`,
        sub: 'Most capable cloud model. Asks before each image until you choose one.',
      };
    }
    return { title: 'None', sub: 'Falls back to the cloud slot for now.' };
  };

  return (
    <div className="screen">
      <BackBar title="Stack" />
      <div className="screen-inner settings stack-manager">
        <h1>Stack</h1>
        <p className="lead">
          {admin
            ? 'One model runs the show and hands each task to the specialist that fits. Anything without a specialist, it does itself.'
            : 'Your admin sets the shared stack for the company. You can talk with your admin about changing it.'}
        </p>

        <DockedStackCard />

        {/* Which status's stack is on screen. Each status runs its own stack,
            used automatically when the device is in it; the one you are in now
            is marked. */}
        <div className="stack-status">
          <div className="segmented" role="tablist" aria-label="Which status's stack">
            {PROFILE_ORDER.map((id) => {
              const active = id === editProfile;
              return (
                <button
                  key={id}
                  role="tab"
                  aria-selected={active}
                  className={`seg press-fb${active ? ' active' : ''}`}
                  onClick={() => setEditProfile(id)}
                >
                  <span
                    className="profile-select-dot"
                    style={{ background: PROFILES[id].dot }}
                    aria-hidden="true"
                  />
                  {PROFILES[id].label}
                  {id === profile ? <span className="stack-now">now</span> : null}
                </button>
              );
            })}
          </div>
          <p className="stack-status-note">
            {editProfile === profile ? 'You are here now. ' : 'Used when you are '}
            {editProfile === profile
              ? PROFILES[editProfile].blurb
              : `${PROFILES[editProfile].label.toLowerCase()}. ${PROFILES[editProfile].blurb}`}
          </p>
        </div>

        <SettingsGroup title="Runs the show" index={0}>
          <SettingsRow
            label={refName(reasoning)}
            sub={admin ? 'Plans every task and routes it.' : 'Set by your admin.'}
            value={<KindChip refModel={reasoning} />}
            onClick={admin ? () => setPickReasoning(true) : undefined}
          />
        </SettingsGroup>

        {/* Image reading (Vision): two slots, a local model and a cloud model,
            each with its own effort. The cloud slot defaults to the most
            capable cloud model until changed. A picture (a screenshot, a
            photo, a video's frames) routes here. */}
        <SettingsGroup
          title="Image reading"
          intro="Screenshots, photos, and video frames. The local model goes first; the cloud model reads what it cannot."
          index={1}
        >
          {(['local', 'cloud'] as const).map((slot) => {
            const line = slotLine(slot);
            return (
              <SettingsRow
                key={slot}
                label={slot === 'local' ? 'On device' : 'Cloud'}
                sub={`${line.title} · ${line.sub}`}
                onClick={admin ? () => openVisionEdit(slot) : undefined}
              />
            );
          })}
        </SettingsGroup>

        {/* Specialists: the models the Reasoning LLM routes work to, each
            under its category. */}
        <SettingsGroup title="Specialists" index={2}>
          {nonVisionActive.length === 0 ? (
            <SettingsRow
              label="None placed yet"
              sub={
                admin
                  ? 'The Reasoning LLM handles every task until you add one from the bench.'
                  : 'The Reasoning LLM handles every task.'
              }
            />
          ) : (
            nonVisionActive.map((m) => (
              <SettingsRow
                key={refKey(m.ref)}
                label={categoryLabel(m.placement.category)}
                sub={[
                  refName(m.ref),
                  m.placement.whenCalled,
                  m.placement.effort ? `${effortLabel(m.placement.effort)} effort` : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                value={<KindChip refModel={m.ref} />}
                onClick={admin ? () => setMenuKey(refKey(m.ref)) : undefined}
              />
            ))
          )}
        </SettingsGroup>

        {!admin ? (
          <p className="hint" style={{ marginTop: 16 }}>
            The bench and stack controls are managed by your admin. Everything else in OpenShore,
            your chats, projects, and crew, is yours to set up as you like.
          </p>
        ) : (
          <SettingsGroup
            title="Bench"
            intro="Models ready to place. Teal runs local and private; amber is a cloud model."
            index={3}
          >
            {bench.map((ref) => {
              const viaCurrent = ref.kind === 'byom' && isCurrentBenchId(ref.id);
              return (
                <SettingsRow
                  key={refKey(ref)}
                  label={refName(ref)}
                  sub={
                    viaCurrent
                      ? `Runs on its own computer at ${byomHost(ref.baseUrl)}; your approvals do not reach it.`
                      : ref.kind === 'byom'
                        ? `${ref.model} at ${byomHost(ref.baseUrl)}`
                        : 'Ready to place.'
                  }
                  trailing={
                    <span className="settings-row-actions">
                      {viaCurrent ? (
                        <span className="pill local">
                          {current && !slotNone(current.bench) ? current.bench.pill : 'via current'}
                        </span>
                      ) : (
                        <KindChip refModel={ref} />
                      )}
                      <button
                        type="button"
                        className="btn ghost press-fb stack-place"
                        onClick={() => openPlacement(ref, stack.saved[refKey(ref)])}
                      >
                        Add
                      </button>
                      {ref.kind === 'byom' && !viaCurrent ? (
                        <button
                          type="button"
                          className="icon-btn press-fb"
                          aria-label={`Options for ${refName(ref)}`}
                          onClick={() => setByomMenuId(ref.id)}
                        >
                          {'⋯'}
                        </button>
                      ) : null}
                    </span>
                  }
                />
              );
            })}

            {/* Connected cloud providers: pick a model, then place it.
                Favorites you pinned in chat surface first, then the rest (for
                Claude, split into the current lineup and older models). */}
            {cloudBench.map(({ provider, models }) => {
              const isFav = (m: BenchModel) =>
                isPinned(pins, { kind: 'cloud', provider: provider.id, model: m.id });
              const favs = models.filter(isFav);
              const restPrimary = models.filter(
                (m) => !isFav(m) && !(provider.id === 'anthropic' && m.tier === 'more'),
              );
              const restMore = models.filter(
                (m) => !isFav(m) && provider.id === 'anthropic' && m.tier === 'more',
              );
              const picked = cloudPick[provider.id] ?? favs[0]?.id ?? models[0]!.id;
              const ref: StackModelRef = {
                kind: 'cloud',
                provider: provider.id,
                model: picked,
                label: models.find((m) => m.id === picked)?.label ?? picked,
              };
              return (
                <SettingsRow
                  key={`cloud-${provider.id}`}
                  label={provider.name}
                  sub={
                    <select
                      className="stack-select"
                      aria-label={`${provider.name} model`}
                      value={picked}
                      onChange={(e) =>
                        setCloudPick({ ...cloudPick, [provider.id]: e.target.value })
                      }
                    >
                      {favs.length ? (
                        <optgroup label="Favorites">
                          {favs.map((m) => (
                            <option key={m.id} value={m.id}>
                              {`★ ${m.label}`}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      {restPrimary.length ? (
                        <optgroup label={provider.id === 'anthropic' ? 'Current' : 'Models'}>
                          {restPrimary.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      {restMore.length ? (
                        <optgroup label="More models">
                          {restMore.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </select>
                  }
                  trailing={
                    <span className="settings-row-actions">
                      <KindChip refModel={ref} />
                      <button
                        type="button"
                        className="btn ghost press-fb stack-place"
                        onClick={() => openPlacement(ref, stack.saved[refKey(ref)])}
                      >
                        Add
                      </button>
                    </span>
                  }
                />
              );
            })}

            {bench.length === 0 && cloudBench.length === 0 ? (
              <SettingsRow
                label="Nothing waiting"
                sub="Models you get (Harbor, in Settings) or connect (Cloud Connections, or below) land here."
              />
            ) : null}
            <SettingsRow
              label="Connect a model"
              sub="Your own server, or any OpenAI-compatible endpoint."
              onClick={() => setByomOpen(true)}
            />
            <SettingsRow label="How connecting works" onClick={() => setByomInfoOpen(true)} />
          </SettingsGroup>
        )}
      </div>

      {/* Ellipses menu for an active specialist. */}
      <Sheet open={Boolean(menuKey)} onClose={() => setMenuKey(undefined)}>
        {menuKey ? (
          <>
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
                  await benchSpecialist(key, editProfile);
                  showToast('Moved to the bench. Its settings are kept.');
                }}
              >
                Move to the bench
              </button>
              <button className="btn quiet" onClick={() => setMenuKey(undefined)}>
                Cancel
              </button>
            </div>
          </>
        ) : null}
      </Sheet>

      {/* Reasoning LLM picker. */}
      <Sheet open={Boolean(pickReasoning)} onClose={() => setPickReasoning(false)}>
        {pickReasoning ? (
          <>
            <SheetHead title="Who runs the show?" onClose={() => setPickReasoning(false)} />
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
                      await setReasoning(r, editProfile);
                      showToast(`${refName(r)} is your Reasoning LLM.`);
                    }}
                  >
                    {refName(r)}
                  </button>
                ))}
              {available.length <= 1 ? (
                <p className="hint">
                  Get Harbor from Settings, Harbor, or connect a cloud model to choose another.
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </Sheet>

      {/* What connecting your own model means: lowers from the top, off the
          "How connecting works" row on the bench. */}
      <Sheet open={byomInfoOpen} onClose={() => setByomInfoOpen(false)} variant="top">
        <h2>Connect your own model</h2>
        <p className="sheet-sub">
          Use a model you run: on this computer, your own server, or another service with your key.
        </p>
        <ul className="paywall-benefits">
          <li>
            Any OpenAI-compatible endpoint works: a model on your own server, a fine-tune behind
            your gateway, or another provider's API.
          </li>
          <li>
            It lands on your bench like any other model. Place it into a category and the Reasoning
            LLM starts routing the right tasks to it.
          </li>
          <li>
            Your address and API key stay yours. The API key is held in this device's secure store,
            scoped to that one connection, and never synced.
          </li>
          <li>
            Nothing you send it passes through us. The call goes straight from your device to the
            endpoint you named.
          </li>
        </ul>
        <div className="sheet-actions">
          <button
            className="btn primary"
            onClick={() => {
              setByomInfoOpen(false);
              setByomOpen(true);
            }}
          >
            Connect a model
          </button>
          <button className="btn quiet" onClick={() => setByomInfoOpen(false)}>
            Got it
          </button>
        </div>
      </Sheet>

      {/* Bring-your-own-model connect sheet. */}
      <Sheet open={Boolean(byomOpen)} onClose={() => setByomOpen(false)}>
        {byomOpen ? (
          <>
            <h2>Connect your own model</h2>
            <p className="sheet-sub">
              Point OpenShore at any OpenAI-compatible endpoint you control: a self-hosted server, a
              fine-tune behind your own gateway, or another provider. It lands on your bench, ready
              to place.
            </p>

            <div className="field">
              <label htmlFor="byom-name">Name</label>
              <input
                id="byom-name"
                autoFocus
                placeholder="e.g. Our house model"
                value={byomForm.label}
                onChange={(e) => setByomForm({ ...byomForm, label: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="byom-address">Address</label>
              <input
                id="byom-address"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="https://your-host/v1"
                value={byomForm.baseUrl}
                onChange={(e) => setByomForm({ ...byomForm, baseUrl: e.target.value })}
              />
              <div className="hint" style={{ marginTop: 4 }}>
                The server's address. It usually ends in /v1.
              </div>
            </div>
            <div className="field">
              <label htmlFor="byom-model-id">Model name</label>
              <input
                id="byom-model-id"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="e.g. llama-3.1-70b-instruct"
                value={byomForm.model}
                onChange={(e) => setByomForm({ ...byomForm, model: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="byom-api-key">API key (optional)</label>
              <input
                id="byom-api-key"
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
          </>
        ) : null}
      </Sheet>

      {/* Options for a benched BYOM model. */}
      <Sheet open={Boolean(byomMenuId)} onClose={() => setByomMenuId(undefined)}>
        {byomMenuId ? (
          <>
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
                  showToast('Disconnected. Its API key was removed from this device.');
                }}
              >
                Disconnect
              </button>
              <button className="btn quiet" onClick={() => setByomMenuId(undefined)}>
                Cancel
              </button>
            </div>
          </>
        ) : null}
      </Sheet>

      {/* Placement config sheet. */}
      <Sheet open={Boolean(config)} onClose={() => setConfig(undefined)}>
        {config ? (
          <>
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
              <label htmlFor="byom-when-called">
                When it is called{config.placement.category === 'custom' ? '' : ' (optional)'}
              </label>
              <input
                id="byom-when-called"
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
              <label htmlFor="byom-persona">
                Persona{config.placement.category === 'custom' ? '' : ' (optional)'}
              </label>
              <input
                id="byom-persona"
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

            <div className="field">
              <label>Effort (optional)</label>
              <div className="suggestion-row" style={{ justifyContent: 'flex-start' }}>
                {EFFORTS.map((e) => (
                  <button
                    key={e}
                    className="suggestion"
                    style={
                      config.placement.effort === e
                        ? {
                            background: 'var(--local-soft)',
                            color: 'var(--local)',
                            borderColor: 'var(--local)',
                          }
                        : undefined
                    }
                    onClick={() =>
                      setConfig({
                        ...config,
                        placement: {
                          ...config.placement,
                          effort: config.placement.effort === e ? undefined : e,
                        },
                      })
                    }
                  >
                    {effortLabel(e)}
                  </button>
                ))}
              </div>
              <div className="hint" style={{ marginTop: 4 }}>
                How hard it thinks. Left unset, it uses the composer's effort.
              </div>
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
          </>
        ) : null}
      </Sheet>

      {/* Vision slot editor: pick the model for the On-device or Cloud image
          reading position, and its effort. */}
      <Sheet open={Boolean(visionEdit)} onClose={() => setVisionEdit(undefined)}>
        {visionEdit ? (
          <>
            <h2>
              {visionEdit.slot === 'local' ? 'On-device image reading' : 'Cloud image reading'}
            </h2>
            <p className="sheet-sub">
              {visionEdit.slot === 'local'
                ? 'A model on your device or your own server. On-device image reading falls back to the cloud slot until a model that reads images runs on device.'
                : 'A cloud model that reads images. Defaults to the most capable one until you choose another.'}
            </p>

            {eligibleVisionRefs(visionEdit.slot).length === 0 ? (
              <p className="hint">
                {visionEdit.slot === 'local'
                  ? 'No on-device or bring-your-own models yet. Get Harbor from Settings, Harbor, or connect your own.'
                  : 'No cloud provider connected yet. Connect one under Cloud Connections.'}
              </p>
            ) : (
              <div className="sheet-actions">
                {eligibleVisionRefs(visionEdit.slot).map((r) => (
                  <button
                    key={refKey(r)}
                    className={`btn ghost profile-option${refKey(r) === visionEdit.pickKey ? ' selected' : ''}`}
                    onClick={() => setVisionEdit({ ...visionEdit, pickKey: refKey(r) })}
                  >
                    {refName(r)}
                  </button>
                ))}
              </div>
            )}

            <div className="field" style={{ marginTop: 16 }}>
              <label>Effort</label>
              <div className="suggestion-row" style={{ justifyContent: 'flex-start' }}>
                {EFFORTS.map((e) => (
                  <button
                    key={e}
                    className="suggestion"
                    style={
                      visionEdit.effort === e
                        ? {
                            background: 'var(--local-soft)',
                            color: 'var(--local)',
                            borderColor: 'var(--local)',
                          }
                        : undefined
                    }
                    onClick={() => setVisionEdit({ ...visionEdit, effort: e })}
                  >
                    {effortLabel(e)}
                  </button>
                ))}
              </div>
            </div>

            <div className="sheet-actions">
              <button
                className="btn primary"
                disabled={!visionEdit.pickKey}
                onClick={() => void saveVisionSlot()}
              >
                Save
              </button>
              {(visionEdit.slot === 'local' ? slots.local : slots.cloud) ? (
                <button className="btn ghost" onClick={() => void clearVisionSlot()}>
                  Clear this slot
                </button>
              ) : null}
              <button className="btn quiet" onClick={() => setVisionEdit(undefined)}>
                Cancel
              </button>
            </div>
          </>
        ) : null}
      </Sheet>
    </div>
  );
}

/** The docked machine's own stack, where the phone's Stack can see it
 *  (connect-anywhere, 2026-10-07): what your computer or server runs, set on
 *  that machine and picked from the model menu in any chat. Shown only when
 *  this device is docked. */
function DockedStackCard() {
  const daemon = useApp((s) => s.settings.daemon);
  const setView = useApp((s) => s.setView);
  const [model, setModel] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!daemon) return;
    let live = true;
    daemonStack(daemon)
      .then((s) => live && setModel(s.orchestrator?.model ?? null))
      .catch(() => live && setModel(undefined));
    return () => {
      live = false;
    };
  }, [daemon]);
  if (!daemon) return null;
  return (
    <div className="card">
      <div className="card-row" style={{ alignItems: 'center' }}>
        <div className="grow">
          <h3 style={{ margin: 0 }}>{dockedNoun(daemon)}</h3>
          <div className="sub">
            {model
              ? `Runs ${model}. Pick it in the model menu in any chat; its stack is set on ${dockedNounLower(daemon)}.`
              : model === null
                ? `No model set up on ${dockedNounLower(daemon)} yet.`
                : `Docked. Its models show here once it answers.`}
          </div>
        </div>
        <button className="btn ghost press-fb" onClick={() => setView('pair')}>
          Computer
        </button>
      </div>
    </div>
  );
}
