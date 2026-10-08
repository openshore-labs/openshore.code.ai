// The phone-side Stack manager. The Reasoning model is the anchor (required,
// immovable, replaceable). Models you download or connect land on the Bench;
// you place them into the active stack by choosing a category, and optionally a
// trigger and a persona (both required for a Custom category). Active models
// can move back to the Bench keeping their metadata, and everything is editable
// from the ellipses.
import { useRef, useState } from 'react';
import { agenticView, stackAdmin, useApp } from '../state/store.js';
import { BackBar } from './BackBar.js';
import {
  PROFILES,
  PROFILE_ORDER,
  autoProfile,
  effectiveProfile,
  locationAllowed,
  profileBlurb,
  type ProfileId,
} from '../lib/profiles.js';
import {
  PROVIDERS,
  cloudImageReaders,
  providerBenchModels,
  type BenchModel,
} from '../lib/providers.js';
import { isHarborMini } from '../lib/harborMini.js';
import { isDesktop } from '../lib/platform.js';
import { isPinned } from '../lib/pins.js';
import { byomPlainHttpToCloud, byomRef, normalizeBaseUrl } from '../lib/byom.js';
import { hubTailnetSuffix } from '../lib/vaultSeat.js';
import {
  activeContribution,
  currentBenchRefs,
  isCurrentBenchId,
  slotNone,
} from '../lib/currents.js';
import { imageStepRunner } from '../lib/play.js';
import {
  STACK_CATEGORIES,
  STACK_LEAD,
  categoryLabel,
  harborRef,
  pickVisionRef,
  placementValid,
  refKey,
  refName,
  refStaysLocal,
  stackForProfile,
  visionCapable,
  visionSlots,
  type Placement,
  type StackModelRef,
} from '../lib/stack.js';
import { EFFORTS, effortLabel, DEFAULT_EFFORT, type Effort } from '../lib/effort.js';
import { Sheet } from './Sheet.js';
import { SheetHead, SheetTitle } from './SheetHead.js';
import { MoreGlyph } from './SheetGlyphs.js';
import { SettingsGroup, SettingsRow } from './SettingsRow.js';
import { StatusSheet } from './ProfileStatus.js';
import { computerOfflineNote, computerOfflineOf } from '../state/offlineOps.js';
import type { DaemonStackInfo } from 'os-code/protocol';

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
 *  off-device, including a BYOM pointed at a hosted API or an Ollama cloud
 *  tag). The same language the rest of the app uses, and the same judge the
 *  Image reading slots split by (`refStaysLocal`). */
function kindMeta(
  ref: StackModelRef,
  ownTailnetSuffix: string | null,
): { cls: 'local' | 'cloud'; label: string } {
  if (!refStaysLocal(ref, ownTailnetSuffix)) return { cls: 'cloud', label: 'Cloud' };
  return ref.kind === 'byom'
    ? { cls: 'local', label: 'Your server' }
    : { cls: 'local', label: 'On device' };
}

/** The teal/amber chip for a model's location. */
function KindChip({ refModel }: { refModel: StackModelRef }) {
  // This device's own tailnet is the paired hub's (CTO J2), so another
  // tailnet's server reads cloud, exactly as the vault pack judges it.
  const hubUrl = useApp((s) => s.settings.daemon?.baseUrl);
  const { cls, label } = kindMeta(refModel, hubTailnetSuffix(hubUrl));
  return <span className={`kind-chip ${cls}`}>{label}</span>;
}

export function StackManager({
  computer,
}: {
  /** The paired computer's stack as its daemon last answered (GET /stack),
   *  for what its own models do while it works offline. */
  computer?: DaemonStackInfo;
} = {}) {
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
  const titleRef = useRef<HTMLHeadingElement>(null);
  // The status the device is in right now. Its stack is the one used
  // automatically; the app switches between the three as the status changes.
  const profile = effectiveProfile(autoProfile(connectivity), settings.profileOverride);
  // Which status's stack is being viewed and edited here. Opens on the current
  // status; a picker below lets you tune the other two without being in them.
  const [editProfile, setEditProfile] = useState<ProfileId>(profile);
  // Before a computer is connected, Docked says what it needs.
  const paired = isDesktop() || Boolean(settings.daemon);
  const blurb = profileBlurb(editProfile, paired);
  // The statuses that can happen on this device (D1: shown once they can
  // mean something). Docked joins the day a computer is paired; until then
  // the switch holds Offshore and Offline, the two this device can be in.
  const statusTabs = PROFILE_ORDER.filter((id) => paired || id !== 'docked');
  // The step down while the reach pill waits for a computer (D1): the same
  // Status sheet the pill opens, from here. It offers Offline while online,
  // and the way back once Offline is chosen; a connection that simply dropped
  // is already Offline, with the lone pill in the bar.
  const [statusOpen, setStatusOpen] = useState(false);
  const stepDown =
    !settings.daemon && (settings.profileOverride === 'offline' || profile !== 'offline');
  // Desktop Offline: docked to a computer that works offline, the note says
  // its cloud models wait for its connection and whether its own models
  // answer meanwhile (known once it has answered /stack while offline).
  const computerOffline =
    profile === 'docked' && editProfile === 'docked' ? connectivity.homeOffline : undefined;
  const computerSeat = computerOfflineOf(computer) ? Boolean(computer?.offlineSeat) : undefined;
  const stack = stackForProfile(settings.stacks, editProfile);
  const reasoning = stack.reasoning ?? harborRef();
  // Where a model answers, judged by address with this device's own tailnet
  // (the paired hub's), the judgement the chip draws: the Image reading
  // slots split by it, so a model at a public address is never Local.
  const ownTailnetSuffix = hubTailnetSuffix(settings.daemon?.baseUrl);
  const staysLocal = (r: StackModelRef) => refStaysLocal(r, ownTailnetSuffix);
  // The two Vision slots (a local model and a cloud model), split out of the
  // active list so the manager shows a dedicated Image reading card.
  const slots = visionSlots(stack, staysLocal);
  // The Specialists rows: every placement but the two Image reading slots. A
  // second vision placement judged to the same side as its slot (one placed
  // before the slots split by address) is listed here too, so no placed model
  // is out of sight or out of reach of Move to the bench.
  const nonVisionActive = stack.active.filter(
    (m) => m.placement.category !== 'vision' || (m !== slots.local && m !== slots.cloud),
  );

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
  // Every model but the anchor, for the Who runs the show picker.
  const others = available.filter((r) => refKey(r) !== reasoningKey);
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
  const byomMenuConn = (settings.byomModels ?? []).find((c) => c.id === byomMenuId);
  // The connection being disconnected, while its confirm is open.
  const [byomForget, setByomForget] = useState<{ id: string; label: string } | undefined>();
  const menuMember = stack.active.find((x) => refKey(x.ref) === menuKey);
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
      showToast('For a custom category, fill in When it is called and Persona.');
      return;
    }
    await placeSpecialist(config.ref, config.placement, editProfile);
    setConfig(undefined);
  };

  // ---- Vision slots -------------------------------------------------------
  // Two positions in one category: a local model (on-device or your own server)
  // and a cloud model. Each carries its own effort. Until a person assigns a
  // slot that can read here (the Local one first), an image asks first and
  // then goes to the model named below.
  // A model you connect sits under Local only when it answers on your own
  // network; one at a public address, or an Ollama cloud tag, is a cloud model.
  const localVisionRefs = [...deviceRefs, ...byomRefs.filter(staysLocal)];
  const cloudVisionRefs = [...cloudRefs, ...byomRefs.filter((r) => !staysLocal(r))];
  // What reads an image in this status while nothing in its slot does: the
  // chat path's own choice (stackDriver's routeVision), an anchor or
  // specialist that can see, then the first connected cloud reader. The rows
  // name it, so they say the model the approval card will ask about (D13,
  // founder 2026-10-07: the least costly Claude model, named, until the
  // person chooses one). A device model cannot read images on this build.
  const cloudOn = locationAllowed(editProfile, 'cloud');
  const reach = (r: StackModelRef) =>
    r.kind !== 'device' &&
    cloudOn &&
    (r.kind !== 'cloud' || Boolean(connectedProviders[r.provider]));
  const connectedReader = cloudImageReaders().find((r) => connectedProviders[r.provider]);
  const imageReader: StackModelRef | undefined =
    pickVisionRef(
      { ...stack, active: stack.active.filter((m) => m !== slots.local) },
      reach,
      staysLocal,
    )?.ref ?? (cloudOn && connectedReader ? { kind: 'cloud', ...connectedReader } : undefined);
  // The reader the chat path really picks, over the whole stack: the Local
  // slot first when it can read here. Then it reads images itself, no other
  // model stands in for it, and no line names one (sp-claims2). Otherwise it
  // is the stand-in above.
  const chatPick = pickVisionRef(stack, reach, staysLocal);
  const localReads = Boolean(
    slots.local && chatPick && refKey(chatPick.ref) === refKey(slots.local.ref),
  );
  const standIn = localReads ? undefined : imageReader;
  // The stand-in asks before a picture unless it was placed for Image reading
  // (routeVision's `dedicated`), and takes a plan's image step only when the
  // plan's own rule gives it the step (play.ts stepRunner, with the reader the
  // driver hands a play): a model on this device in the Local slot hands the
  // step to the Reasoning model instead.
  const standInAsks = !chatPick || chatPick.placement?.category !== 'vision';
  const standInTakesPlanStep =
    standIn !== undefined &&
    refKey(imageStepRunner({ ...stack, imageReader: standIn, reachable: reach, staysLocal })) ===
      refKey(standIn);
  const standInAsk = !standInAsks
    ? ''
    : standInTakesPlanStep
      ? " It asks before a picture, not before a plan's image step."
      : ' It asks before a picture.';
  const [visionEdit, setVisionEdit] = useState<
    { slot: 'local' | 'cloud'; pickKey: string; effort: Effort } | undefined
  >();
  const eligibleVisionRefs = (slot: 'local' | 'cloud') =>
    slot === 'local' ? localVisionRefs : cloudVisionRefs;
  const openVisionEdit = (slot: 'local' | 'cloud') => {
    const member = slot === 'local' ? slots.local : slots.cloud;
    // The cloud preselect is the model reading images today (a connected one,
    // so Save never lands on an unconnected default), so Save alone keeps it.
    const reading = imageReader && cloudVisionRefs.find((r) => refKey(r) === refKey(imageReader));
    const initial =
      member?.ref ??
      (slot === 'cloud' ? (reading ?? cloudVisionRefs.find(visionCapable)) : localVisionRefs[0]);
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

  // A Vision slot's line: the assigned model and its effort, or who reads
  // images until one is chosen, or the empty state.
  const slotLine = (slot: 'local' | 'cloud'): string => {
    const member = slot === 'local' ? slots.local : slots.cloud;
    if (member) {
      return `${refName(member.ref)} · ${effortLabel(member.placement.effort ?? DEFAULT_EFFORT)} effort`;
    }
    if (slot === 'cloud') {
      // The same shape as the Local row beside it: the slot is empty, then
      // who reads images (CS-09): the Local model when it reads them itself,
      // else the stand-in, for now.
      if (localReads && slots.local) {
        return `None yet · ${refName(slots.local.ref)} reads images.`;
      }
      if (standIn) {
        return `None yet · ${refName(standIn)} reads images for now.${standInAsk}`;
      }
      return cloudOn
        ? 'None yet · Connect a cloud model in Cloud Connections to read images.'
        : 'None yet · No cloud model is used while Offline.';
    }
    // The title already says yet, so the line does not say it again.
    return standIn
      ? `None yet · ${refName(standIn)} reads images for now.`
      : 'None yet · Nothing reads images.';
  };

  return (
    <div className="screen">
      <BackBar title="Stack" titleHiddenUntil={titleRef} />
      <div className="screen-inner settings stack-manager">
        <h1 ref={titleRef}>Stack</h1>
        <p className="lead">
          {admin
            ? STACK_LEAD
            : 'Your admin sets the shared stack for the company. You can talk with your admin about changing it.'}
        </p>

        {/* Which status's stack is on screen. Each status runs its own stack,
            used automatically when the device is in it; the one you are in now
            is marked. */}
        <div className="stack-status">
          <div className="segmented" role="tablist" aria-label="Which status's stack">
            {statusTabs.map((id) => {
              const active = id === editProfile;
              return (
                <button
                  key={id}
                  role="tab"
                  aria-selected={active}
                  className={`seg press-fb${active ? ' active' : ''}`}
                  onClick={() => setEditProfile(id)}
                >
                  <span className={`profile-select-dot profile-dot ${id}`} aria-hidden="true" />
                  {PROFILES[id].label}
                  {id === profile ? <span className="stack-now">now</span> : null}
                </button>
              );
            })}
          </div>
          <p className="stack-status-note">
            {computerOffline
              ? computerOfflineNote(computerOffline, computerSeat)
              : editProfile === profile
                ? blurb
                : `Used when you are ${PROFILES[editProfile].label.toLowerCase()}. ${blurb}`}
          </p>
          {/* Before a computer is connected the pill is out of the bar while
              online, so the step down lives here (D1, as recommended: "stepping
              down stays possible from the Stack"). */}
          {stepDown ? (
            <button
              type="button"
              className="linklike press-fb stack-status-change"
              onClick={() => setStatusOpen(true)}
            >
              {settings.profileOverride === 'offline' ? 'Follow the connection' : 'Choose Offline'}
            </button>
          ) : null}
        </div>
        {!settings.daemon ? (
          <StatusSheet open={statusOpen} onClose={() => setStatusOpen(false)} />
        ) : null}

        {/* The group keeps "Runs the show" (D2), and its one row names the
            slot once, so "Reasoning model" below and in the other rooms has
            a place it was introduced (CS-08). */}
        <SettingsGroup title="Runs the show" index={0}>
          <SettingsRow
            label={refName(reasoning)}
            sub={`Reasoning model · ${
              !admin
                ? 'Set by your admin.'
                : reasoning.kind === 'device'
                  ? isHarborMini(reasoning.modelId)
                    ? 'The built-in guide. Place a bigger model here for real work.'
                    : 'Answers each task, or hands it to a specialist.'
                  : 'Plans every task and routes it.'
            }`}
            value={<KindChip refModel={reasoning} />}
            onClick={admin ? () => setPickReasoning(true) : undefined}
          />
        </SettingsGroup>

        {/* Image reading (Vision): two slots, a local model and a cloud model,
            each with its own effort. Until the cloud slot is chosen, the rows
            name the model that reads images now, asking first (D13). A
            picture (a screenshot, a photo, a video's frames) routes here. */}
        <SettingsGroup
          title="Image reading"
          intro="Screenshots, photos, and video frames. The local model goes first; the cloud model reads what it cannot."
          index={1}
        >
          {(['local', 'cloud'] as const).map((slot) => (
            <SettingsRow
              key={slot}
              label={slot === 'local' ? 'Local' : 'Cloud'}
              sub={slotLine(slot)}
              onClick={admin ? () => openVisionEdit(slot) : undefined}
            />
          ))}
        </SettingsGroup>

        {/* Specialists: the models the Reasoning model routes work to, each
            under its category. */}
        <SettingsGroup title="Specialists" index={2}>
          {nonVisionActive.length === 0 ? (
            <SettingsRow
              label="None placed yet"
              sub={
                admin
                  ? 'The Reasoning model handles every task until you place one from the bench.'
                  : 'The Reasoning model handles every task.'
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
                        : undefined
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
                        className="btn ghost sm press-fb"
                        onClick={() => openPlacement(ref, stack.saved[refKey(ref)])}
                      >
                        Place
                      </button>
                      {ref.kind === 'byom' && !viaCurrent ? (
                        <button
                          type="button"
                          className="icon-btn press-fb"
                          aria-label={`Options for ${refName(ref)}`}
                          onClick={() => setByomMenuId(ref.id)}
                        >
                          <MoreGlyph size={20} />
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
                        className="btn ghost sm press-fb"
                        onClick={() => openPlacement(ref, stack.saved[refKey(ref)])}
                      >
                        Place
                      </button>
                    </span>
                  }
                />
              );
            })}

            {bench.length === 0 && cloudBench.length === 0 ? (
              <SettingsRow
                label="Nothing waiting"
                sub="Get Harbor in Settings, or connect a cloud provider or your own server. New models wait here until you place them."
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
            <SheetTitle>{menuMember ? refName(menuMember.ref) : 'Specialist'}</SheetTitle>
            <div className="sheet-actions">
              <button
                className="btn ghost"
                onClick={() => {
                  const m = stack.active.find((x) => refKey(x.ref) === menuKey);
                  setMenuKey(undefined);
                  if (m) openPlacement(m.ref, m.placement);
                }}
              >
                Edit placement
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

      {/* Reasoning model picker. */}
      <Sheet open={Boolean(pickReasoning)} onClose={() => setPickReasoning(false)}>
        {pickReasoning ? (
          <>
            <SheetHead title="Who runs the show?" onClose={() => setPickReasoning(false)} />
            <p className="sheet-sub">
              The Reasoning model plans and routes. It can be any model you have.
            </p>
            <div className="sheet-actions">
              {[reasoning, ...others].map((r) => {
                const current = refKey(r) === reasoningKey;
                return (
                  <button
                    key={refKey(r)}
                    type="button"
                    className={`btn ghost profile-option press-fb${current ? ' selected' : ''}`}
                    aria-current={current ? 'true' : undefined}
                    onClick={async () => {
                      setPickReasoning(false);
                      if (current) return;
                      await setReasoning(r, editProfile);
                      showToast(`${refName(r)} is your Reasoning model.`);
                    }}
                  >
                    <span className="profile-option-text">
                      <span className="profile-option-title">
                        {refName(r)}
                        <KindChip refModel={r} />
                      </span>
                      {current ? <span className="profile-option-blurb">Current</span> : null}
                    </span>
                  </button>
                );
              })}
              {others.length === 0 ? (
                <p className="hint">
                  Get Harbor in Settings, or connect a cloud provider, to choose another.
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </Sheet>

      {/* What connecting your own model means, off the "How connecting works"
          row on the bench, named by that row. It rises like every sheet. */}
      <Sheet open={byomInfoOpen} onClose={() => setByomInfoOpen(false)}>
        <SheetTitle>How connecting works</SheetTitle>
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
            model starts routing the right tasks to it.
          </li>
          <li>
            Your address and API key stay yours. The API key is stored only on this device and sent
            only to that address, scoped to that one connection, and never synced.
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
            <SheetTitle>Connect your own model</SheetTitle>
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
                Kept on this device, scoped to this connection, never synced.
              </div>
            </div>

            <div className="sheet-actions">
              <button
                className="btn primary"
                disabled={!byomFormValid}
                onClick={() => void saveByom()}
              >
                Connect
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
            <SheetTitle>{byomMenuConn?.label ?? 'Your model'}</SheetTitle>
            <div className="sheet-actions">
              <button
                className="btn ghost"
                onClick={() => {
                  const conn = (settings.byomModels ?? []).find((c) => c.id === byomMenuId);
                  setByomMenuId(undefined);
                  if (conn) openPlacement(byomRef(conn), stack.saved[`byom:${conn.id}`]);
                }}
              >
                Place
              </button>
              <button
                className="btn quiet"
                onClick={() => {
                  const conn = byomMenuConn;
                  setByomMenuId(undefined);
                  if (conn) setByomForget({ id: conn.id, label: conn.label });
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

      <Sheet open={Boolean(byomForget)} onClose={() => setByomForget(undefined)} variant="confirm">
        <h3>Disconnect {byomForget?.label}?</h3>
        <p>
          It leaves your bench and every stack, and any API key it had is removed from this device.
        </p>
        <div className="confirm-row">
          <button
            type="button"
            className="btn ghost press-fb"
            onClick={() => setByomForget(undefined)}
          >
            Keep
          </button>
          <button
            type="button"
            className="btn danger press-fb"
            onClick={async () => {
              const target = byomForget;
              setByomForget(undefined);
              if (!target) return;
              await disconnectByom(target.id);
              showToast(`${target.label} disconnected.`);
            }}
          >
            Disconnect
          </button>
        </div>
      </Sheet>

      {/* Placement config sheet. */}
      <Sheet open={Boolean(config)} onClose={() => setConfig(undefined)}>
        {config ? (
          <>
            <SheetTitle>Place {refName(config.ref)}</SheetTitle>
            <p className="sheet-sub">Pick the category the Reasoning model calls it for.</p>

            <div className="suggestion-row" style={{ justifyContent: 'flex-start' }}>
              {STACK_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="suggestion"
                  aria-pressed={config.placement.category === c.id}
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
                    type="button"
                    className="suggestion"
                    aria-pressed={config.placement.effort === e}
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
                How hard it thinks. Left unset, it uses the effort you pick in the chat.
              </div>
            </div>

            <div className="sheet-actions">
              <button
                className="btn primary"
                disabled={!placementValid(config.placement)}
                onClick={() => void confirmPlacement()}
              >
                Place
              </button>
              <button className="btn quiet" onClick={() => setConfig(undefined)}>
                Cancel
              </button>
            </div>
          </>
        ) : null}
      </Sheet>

      {/* Vision slot editor: pick the model for the Local or Cloud image
          reading position, and its effort. */}
      <Sheet open={Boolean(visionEdit)} onClose={() => setVisionEdit(undefined)}>
        {visionEdit ? (
          <>
            <SheetTitle>
              {visionEdit.slot === 'local' ? 'Local image reading' : 'Cloud image reading'}
            </SheetTitle>
            <p className="sheet-sub">
              {/* Each names the model reading images today, and only while
                  that is the stand-in: a chosen cloud model never asks, and
                  a Local model that reads them leaves no stand-in. */}
              {visionEdit.slot === 'local'
                ? `A model on this device or your own server. A model on this device cannot read images yet${standIn ? `, so ${refName(standIn)} reads them until one can.` : '.'}`
                : standIn && !slots.cloud
                  ? `A cloud model that reads images. Until you choose one, ${refName(standIn)} reads them.${standInAsk}`
                  : 'A cloud model that reads images.'}
            </p>

            {eligibleVisionRefs(visionEdit.slot).length === 0 ? (
              <p className="hint">
                {visionEdit.slot === 'local'
                  ? 'Nothing here yet. Use Connect a model under Bench to add your own server.'
                  : 'No cloud provider connected yet. Connect one under Cloud Connections.'}
              </p>
            ) : (
              <div className="sheet-actions">
                {eligibleVisionRefs(visionEdit.slot).map((r) => (
                  <button
                    key={refKey(r)}
                    type="button"
                    className={`btn ghost profile-option${refKey(r) === visionEdit.pickKey ? ' selected' : ''}`}
                    aria-pressed={refKey(r) === visionEdit.pickKey}
                    onClick={() => setVisionEdit({ ...visionEdit, pickKey: refKey(r) })}
                  >
                    <span className="profile-option-title">
                      {refName(r)}
                      <KindChip refModel={r} />
                    </span>
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
                    type="button"
                    className="suggestion"
                    aria-pressed={visionEdit.effort === e}
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
