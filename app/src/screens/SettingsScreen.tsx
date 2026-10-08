// Settings: the honest page, written as a ledger. Short groups under
// serif heads, one row per thing, the current value on the right, and
// everything deeper in a sheet. What this app keeps, where it lives, and a
// few careful switches. No telemetry to toggle because there is none. Built
// with the Creative Studio (2026-09-02, "The Ledger" direction).
import { SHIPS_ADMIN, SHIPS_LAUNCH, SHIPS_STACKHEALTH, SHIPS_TEAMS } from '../lib/focus.js';
import { accountCopy } from '../lib/accountGate.js';
import { Fragment, useEffect, useRef, useState } from 'react';
import { PAY_GATES_ENABLED, isOrgAdmin, useApp, type HarborDownload } from '../state/store.js';
import { useAuth } from '../hooks/useAuth.js';
import { platform, isDesktop, isPhone, openExternal } from '../lib/platform.js';
import { PRIVACY_URL, TERMS_URL } from '../lib/legalLinks.js';
import { WEB_FETCH_LABEL, WEB_FETCH_MODES, webFetchLine } from '../lib/webFetchMode.js';
import { iapAvailable } from '../lib/iap.js';
import { noticeEnabled, noticePermission } from '../lib/notices.js';
import type { NoticePermission } from '../lib/llamaPlugin.js';
import { bridge } from '../lib/electronBridge.js';
import { HARBOR_BYLINE } from '../lib/harbor.js';
import {
  HARBOR_MINI_BUNDLED,
  HARBOR_MINI_HANDOFF_LINE,
  HARBOR_MINI_ROW_SUB,
} from '../lib/harborMini.js';
import {
  HARBOR_MASTER_ATTRIBUTION,
  HARBOR_MASTER_BYLINE,
  HARBOR_MASTER_MODEL_NAME,
  harborMasterInstalled,
} from '../lib/harborMaster.js';
import {
  canControlTerminal,
  terminalControlOn,
  terminalTargetId,
  terminalTargetLabel,
} from '../lib/terminalControl.js';
import { canControlCodemagic, codemagicAccessOn } from '../lib/codemagicControl.js';
import {
  getStackHealthVisibility,
  setStackHealthVisibility,
  type StackHealthVisibility,
} from '../lib/stackHealth.js';
import { tierById, shownPrice } from '../lib/plans.js';
import { REPO_CONNECTORS } from '../lib/repos.js';
import { clearInsights, insightsAsText, insightsCount } from '../lib/insights.js';
import { hapticCommit } from '../lib/haptics.js';
import { BrandMark } from '../components/BrandMark.js';
import { DEFAULT_PERMISSION_MODE, permissionModeLabel } from '../lib/permissionMode.js';
import { BackBar } from '../components/BackBar.js';
import { SignInCard } from '../components/SignInCard.js';
import { DeleteAccount } from '../components/DeleteAccount.js';
import { InfoSheet } from '../components/InfoSheet.js';
import { WhatLeavesSheet } from '../components/WhatLeavesSheet.js';
import { ROUTINES_SEARCH_LINE } from '../lib/egressManifest.js';
import { Sheet } from '../components/Sheet.js';
import { Switch } from '../components/Switch.js';
import { SettingsGroup, SettingsRow } from '../components/SettingsRow.js';
import { WritingVoiceField } from '../components/WritingVoiceField.js';
import { WAYFINDING, WAYFINDING_READY, memoryOverride, wayfindingOn } from '../lib/currents.js';
import { PROVIDER_ROSTER } from '../lib/gitos/providers.js';
import { vaultDevicePatch, vaultDeviceView } from '../lib/vaultDevice.js';
import {
  VAULT_HANDOFF_SUB,
  VAULT_MEMORY_SUB,
  VAULT_SETTINGS_ROWS,
  VAULT_SETTINGS_TITLE,
  VAULT_SWITCH_MEMORY_OFF,
  vaultHandoffToast,
  vaultNotesInChatsSub,
  vaultNotesInChatsToast,
} from '../lib/vaultCopy.js';
import { VaultSettingsHost } from '../components/vault/VaultSettingsHost.js';
import { SheetHead } from '../components/SheetHead.js';
import { VoicePicker } from '../components/VoicePicker.js';
import { listVoices } from '../lib/voice/tts.js';
import { curateVoices, resolveVoice } from '../lib/voice/voiceCatalog.js';
import { webSearchOn, type SearchBackend } from '../lib/webSearch.js';
import { APP_ICONS, appIconNote } from '../lib/appIcon.js';
import { FOLLOWS_GROUP_ID, useSettingsJump } from '../lib/profile.js';
import { PACK_BY_CLASS, TRUST_STATEMENT_LINES, type StackHealthSealFact } from 'os-code/protocol';

const SEARCH_BACKEND_LABEL: Record<SearchBackend, string> = {
  duckduckgo: 'DuckDuckGo',
  brave: 'Brave Search',
  tavily: 'Tavily',
  // Perplexity is not a user-chosen override backend (the Research toggle
  // drives it), but it is a valid backend, so it carries a label too.
  perplexity: 'Perplexity',
};

// A fact carries a "How" disclosure when there's a concrete step that would
// improve it. Matched by key + a stable substring rather than the whole
// label, so a copy tweak upstream can't silently break the link.
function howToFor(fact: StackHealthSealFact): string | undefined {
  if (fact.key === 'encryptedAtRest' && fact.label.includes('would hold the key more safely')) {
    return 'On Linux, install a keychain provider and the key moves there automatically next launch. On Pop!_OS or Ubuntu: sudo apt install gnome-keyring libsecret-tools. No restart of anything but the app is needed.';
  }
  return undefined;
}

/** The live seal facts, measured by the engine (never asserted). Desktop
 *  only; the phone's own data is sealed by the app. */
function useSeal(): StackHealthSealFact[] | undefined {
  const [facts, setFacts] = useState<StackHealthSealFact[] | undefined>();
  useEffect(() => {
    const b = bridge();
    if (!b) return;
    let live = true;
    b.stackHealth('day')
      .then((h) => live && setFacts(h.seal))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return facts;
}

function LiveSeal({ facts }: { facts: StackHealthSealFact[] }) {
  const [openHow, setOpenHow] = useState<string | undefined>();
  return (
    <>
      <ul className="sh-seal-facts" style={{ marginTop: 12 }}>
        {facts.map((f, i) => {
          const how = howToFor(f);
          return (
            <li
              className="sh-seal-fact-row"
              style={{ animationDelay: `calc(${i} * var(--dur-1) / 2)` }}
              key={f.key}
            >
              <div className={`sh-seal-fact sh-${f.state}`}>
                <span className="sh-seal-dot" aria-hidden="true" />
                {f.label}
                {how ? (
                  <button
                    type="button"
                    className="linklike"
                    style={{ marginLeft: 6 }}
                    onClick={() => setOpenHow(openHow === f.key ? undefined : f.key)}
                  >
                    How
                  </button>
                ) : null}
              </div>
              {how && openHow === f.key ? (
                <p className="hint" style={{ marginTop: 4, marginLeft: 15 }}>
                  {how}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="hint" style={{ marginTop: 8 }}>
        Measured on this device just now, not promised.
      </p>
    </>
  );
}

function keyStoreLabel(): string {
  switch (platform()) {
    case 'ios':
      return 'iOS Keychain';
    case 'electron':
      return 'system keychain';
    default:
      return 'browser store';
  }
}

/** The footer's name for this build, capitalised as a label. */
function platformLabel(): string {
  switch (platform()) {
    case 'ios':
      return 'iPhone';
    case 'electron':
      return 'Desktop';
    default:
      return 'Web';
  }
}

/** The one control on the right of a Harbor row. A single button whose label
 *  and action follow the model's state: Install when it is absent, its live
 *  percent (tap to cancel) while it downloads, Retry after a failure, Uninstall
 *  once it is on the device. A bundled model (Harbor Lite) ships with the app
 *  and cannot be removed, so it shows a plain "Built in" status instead. A
 *  model Ollama holds (DeepBlue) has no cancel and no uninstall here, so
 *  its progress is a plain status and, once present, it reads "Installed". */
function HarborInstallButton({
  bundled,
  ready,
  download,
  onInstall,
  onUninstall,
  onCancel,
}: {
  bundled?: boolean;
  ready?: boolean;
  download?: HarborDownload;
  /** Required for the real (non-bundled) toggle; omitted for a bundled model. */
  onInstall?: () => void;
  /** Omitted when the weights belong to Ollama: the row then reads Installed. */
  onUninstall?: () => void;
  /** Omitted when the pull cannot be cancelled: progress is then a status. */
  onCancel?: () => void;
}) {
  if (bundled) {
    return <span className="harbor-action is-builtin">Built in</span>;
  }
  if (download && !download.failed) {
    const label = download.indeterminate
      ? onCancel
        ? 'Downloading'
        : download.label
      : `${Math.round(download.percent)}%`;
    if (!onCancel) {
      return (
        <span className="harbor-action is-progress" role="status">
          {label}
        </span>
      );
    }
    return (
      <button
        type="button"
        className="harbor-action is-progress press-fb"
        onClick={onCancel}
        aria-label="Cancel download"
      >
        {label}
      </button>
    );
  }
  if (download?.failed) {
    return (
      <button type="button" className="harbor-action is-retry press-fb" onClick={onInstall}>
        Try again
      </button>
    );
  }
  if (ready) {
    if (!onUninstall) {
      return <span className="harbor-action is-builtin">Installed</span>;
    }
    return (
      <button type="button" className="harbor-action is-remove press-fb" onClick={onUninstall}>
        Uninstall
      </button>
    );
  }
  return (
    <button type="button" className="harbor-action is-install press-fb" onClick={onInstall}>
      Install
    </button>
  );
}

type SheetName = 'account' | 'log' | 'search' | 'clear';

export function SettingsScreen() {
  const {
    clearConversations,
    settings,
    showToast,
    saveSettings,
    setView,
    searchKeyConfigured,
    setSearchBackend,
    clearSearchBackend,
    ensureHarbor,
    removeHarbor,
    cancelHarbor,
    harborDownload,
    ensureHarborMaster,
    harborMasterDownload,
    desktopStatus,
    setTerminalControl,
    setPermissionMode,
    setCodemagicAccess,
    codemagicConnected,
    serverRole,
    setWayfinding,
    setPerplexityResearch,
    connectedProviders,
    vaultScope,
    setVaultScope,
    vaultRequestSheet,
  } = useApp();
  // Opened from the profile's "Preferences that follow you": land on the
  // group they start in, once the room has painted.
  useEffect(() => {
    const target = useSettingsJump.getState().take();
    if (!target) return;
    requestAnimationFrame(() =>
      document.getElementById(target)?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
    );
  }, []);
  const restorePurchases = useApp((s) => s.restorePurchases);
  const recheckPersonal = useApp((s) => s.recheckPersonal);
  const manageSubscription = useApp((s) => s.manageSubscription);
  const setWebSearchAllowed = useApp((s) => s.setWebSearchAllowed);
  const setWebFetchMode = useApp((s) => s.setWebFetchMode);
  const personalUnlockedNow = useApp((s) => s.personalUnlockedNow);
  const userEntitlement = useApp((s) => s.userEntitlement);
  const deleteAccount = useApp((s) => s.deleteAccount);
  // The free ways out while their rooms are shut (CTO, 2026-09-30):
  // exporting the iPhone's sealed vault and removing a git host's sign-in.
  const exportPersonalVault = useApp((s) => s.exportPersonalVault);
  const vaultRoomShut = useApp((s) => s.personalDoor('vault') !== 'open');
  const reposRoomShut = useApp((s) => s.personalDoor('repos') !== 'open');
  const connectedRepoPlatforms = useApp((s) => s.connectedRepoPlatforms);
  const disconnectRepoPlatform = useApp((s) => s.disconnectRepoPlatform);
  // Vault settings over Settings (Vault M7, CX Y4): the personal vault's.
  const [vaultSettingsOpen, setVaultSettingsOpen] = useState(false);
  const memoryOn = memoryOverride(settings) !== false;
  const vaultDevice = vaultDeviceView(settings, { memoryOn, cloudSeat: false });
  const vaultProviderId =
    (settings.gitosResources ?? []).find((r) => r.id === 'vault.personal')?.providerId ?? 'local';
  const vaultStorageName =
    PROVIDER_ROSTER.find((r) => r.id === vaultProviderId)?.label ?? vaultProviderId;
  const editMode = settings.permissionMode ?? DEFAULT_PERMISSION_MODE;
  const { configured, signedIn, email } = useAuth();
  const insightsOn = Boolean(settings.insightsOptIn);
  const humanizeOn = settings.humanizeWriting !== false;
  const chainOfThoughtOn = settings.chainOfThought === true;
  // Notices are an iPhone surface; read the standing permission once so a "no"
  // in iOS Settings is said plainly instead of toggles that do nothing.
  const [noticeStatus, setNoticeStatus] = useState<NoticePermission | undefined>();
  useEffect(() => {
    if (isPhone()) void noticePermission().then(setNoticeStatus);
  }, []);
  const account = settings.account;
  const org = account?.org;
  const [sheet, setSheet] = useState<SheetName | undefined>();
  const titleRef = useRef<HTMLHeadingElement>(null);
  // The account sheet's title follows the card's mode (Sign in or Create
  // account), so the sheet carries one title, never two.
  const [signInMode, setSignInMode] = useState<'signin' | 'signup'>('signin');
  const [searchChoice, setSearchChoice] = useState<'brave' | 'tavily'>('brave');
  const [searchKeyValue, setSearchKeyValue] = useState('');
  const activeSearchBackend: SearchBackend =
    searchKeyConfigured && settings.searchBackend ? settings.searchBackend : 'duckduckgo';
  const facts = useSeal();
  const sealed = facts ? facts.every((f) => f.state === 'good') : false;
  const close = () => setSheet(undefined);

  // Voice mode's settings: the chosen voice (resolved to a name for the row), the
  // speaking speed, and whether replies are spoken aloud.
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [voiceName, setVoiceName] = useState('');
  const speakReplies = settings.voiceReplies !== false;
  const voiceRate = settings.voiceRate ?? 0.5;
  useEffect(() => {
    let live = true;
    void listVoices().then((voices) => {
      if (live) setVoiceName(resolveVoice(curateVoices(voices), settings.voiceId)?.display ?? '');
    });
    return () => {
      live = false;
    };
  }, [settings.voiceId]);

  const installHarbor = async () => {
    // Harbor Lite's voice on the handoff: the guide stays beside you while the
    // bigger model comes down. Only when a download actually starts (not when
    // Harbor is already here and ensureHarbor is an instant no-op).
    if (!settings.harborReady) showToast(HARBOR_MINI_HANDOFF_LINE);
    const ok = await ensureHarbor();
    if (ok) showToast('Harbor is installed and ready on this device.');
  };
  const uninstallHarbor = async () => {
    await removeHarbor();
    showToast('Harbor removed. You can reinstall it any time.');
  };
  // DeepBlue lives in the engine's Ollama, so presence is read from the
  // engine's own list, never remembered by the app.
  const harborMasterPresent = Boolean(harborMasterInstalled(desktopStatus?.ollama.models));
  const installHarborMaster = async () => {
    const ok = await ensureHarborMaster();
    if (ok) {
      showToast(`${HARBOR_MASTER_MODEL_NAME} is installed and is your Reasoning model.`);
    } else {
      const why = useApp.getState().harborMasterDownload;
      if (why?.failed) showToast(why.label);
    }
  };

  const saveSearch = async () => {
    const key = searchKeyValue.trim();
    close();
    setSearchKeyValue('');
    if (!key) return;
    await setSearchBackend(searchChoice, key);
    showToast(`${SEARCH_BACKEND_LABEL[searchChoice]} connected for web search.`);
  };

  const copyLog = async () => {
    const text = insightsAsText();
    try {
      await navigator.clipboard.writeText(text);
      showToast('Activity log copied. Paste it wherever you are asking for help.');
    } catch {
      showToast('Copy is unavailable here. The log stays on this device.');
    }
  };

  const accountLabel = signedIn
    ? account?.type === 'commercial'
      ? (org?.name ?? 'Company account')
      : 'Your account'
    : 'Sign in';
  const accountValue = signedIn
    ? account?.type === 'commercial' && org
      ? tierById(org.tierId).name
      : PAY_GATES_ENABLED
        ? personalUnlockedNow()
          ? 'Plus'
          : 'Free'
        : undefined
    : undefined;
  // Personal's standing on this device, in plain words: free for everyone
  // while the pay gates are off (the beta), else active (until when) or not.
  const personalUntil = userEntitlement?.validUntil
    ? new Date(userEntitlement.validUntil).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : undefined;
  // The Plus row shows only while the pay gates are on, so there is no
  // gates-off wording here (and never "beta", App Review 2.2).
  const personalValue = personalUnlockedNow() ? 'Active' : 'Not yet';
  const personalSub = personalUnlockedNow()
    ? personalUntil
      ? `All of OpenShore is open. Renews or ends ${personalUntil}.`
      : 'All of OpenShore is open.'
    : 'Chats, Projects, the Stack and Cloud Connections are free. Plus opens the rest.';
  // The Personal rows (2026-09-30): an Apple device restores through the App
  // Store and manages its subscription with Apple; the desktop re-reads the
  // account ("I already paid") and manages it in the Stripe portal.
  const appleDevice = iapAvailable();
  const showManage = PAY_GATES_ENABLED && configured && signedIn && Boolean(userEntitlement);

  const termDesktopLocal = isDesktop() && Boolean(bridge()) && !settings.preferRemoteHub;
  const termTargetId = terminalTargetId({
    desktopLocal: termDesktopLocal,
    daemon: settings.daemon,
  });
  const termLabel = terminalTargetLabel({
    desktopLocal: termDesktopLocal,
    daemon: settings.daemon,
  });
  const canControlTerm = canControlTerminal(
    settings.account,
    isOrgAdmin(settings.account) || serverRole === 'admin',
  );
  const termControlOn = terminalControlOn(settings.terminalControl, termTargetId);

  const canControlCm = canControlCodemagic(
    settings.account,
    isOrgAdmin(settings.account) || serverRole === 'admin',
  );
  const codemagicAccessIsOn = codemagicAccessOn(settings.codemagicAccess);

  // Stack Health visibility lives on the hub (admin-owned, server-enforced), so
  // it only appears when a hub is paired. Read the current value from the hub;
  // an admin can change it, everyone else sees it read-only.
  // Stack Health is v2 (docs/release-tiers.md): a Personal build neither
  // shows the row nor asks the hub for it, and does not carry its words
  // (the SHIPS_ gates below fold away in that build's bundle).
  const shHub = SHIPS_STACKHEALTH ? settings.daemon : undefined;
  const [shVisibility, setShVisibility] = useState<StackHealthVisibility | undefined>();
  useEffect(() => {
    if (!shHub) {
      setShVisibility(undefined);
      return;
    }
    let live = true;
    void getStackHealthVisibility(shHub).then((v) => {
      if (live) setShVisibility(v);
    });
    return () => {
      live = false;
    };
  }, [shHub]);
  const canControlSh = canControlTerminal(
    settings.account,
    isOrgAdmin(settings.account) || serverRole === 'admin',
  );

  let group = 0;

  return (
    <div className="screen">
      <BackBar title="Settings" titleHiddenUntil={titleRef} />
      <div className="screen-inner settings">
        <h1 ref={titleRef}>Settings</h1>
        <p className="lead">What this app keeps, and where.</p>

        {/* A build with no account backend has nowhere for these rows to go. */}
        <SettingsGroup title="Account" index={configured ? group++ : group} hidden={!configured}>
          <SettingsRow
            label={accountLabel}
            subTruncate={signedIn}
            sub={
              signedIn
                ? email
                : `Chatting needs no account. ${accountCopy(PAY_GATES_ENABLED).pitch}`
            }
            value={accountValue}
            onClick={
              configured
                ? () => {
                    setSignInMode('signin');
                    setSheet('account');
                  }
                : undefined
            }
          />
          {PAY_GATES_ENABLED ? (
            <SettingsRow label="OpenShore Plus" sub={personalSub} value={personalValue} />
          ) : null}
          {PAY_GATES_ENABLED && configured && appleDevice ? (
            <SettingsRow
              label="Restore purchases"
              sub={
                signedIn
                  ? 'Bought Plus already? Unlock it on this device.'
                  : 'Sign in first, then restore.'
              }
              onClick={() => void restorePurchases()}
            />
          ) : null}
          {PAY_GATES_ENABLED && configured && !appleDevice ? (
            <SettingsRow
              label="I already paid"
              sub={
                signedIn
                  ? 'Bought Plus already? Check your account again.'
                  : 'Sign in with the email you paid with.'
              }
              onClick={() => void recheckPersonal()}
            />
          ) : null}
          {showManage ? (
            <SettingsRow
              label="Manage subscription"
              sub={
                appleDevice
                  ? 'Renewal and cancellation, with Apple.'
                  : 'Renewal, card, and cancellation.'
              }
              onClick={() => void manageSubscription()}
            />
          ) : null}
        </SettingsGroup>

        {/* Privacy comes straight after Account (founder, D16, 2026-10-07), so
            the first screen keeps the lead's promise: what leaves this device,
            how the rest is kept, and the three limits. First of all on a build
            with no account backend, where Account is left out. */}
        <SettingsGroup title="Privacy" index={group++}>
          <WhatLeavesSheet />
          <InfoSheet
            title="How your data is kept"
            renderTrigger={(open) => (
              <SettingsRow
                label="How your data is kept"
                sub="What stays here, how it is sealed, and what local models can and cannot do"
                value={facts && sealed ? 'Sealed' : undefined}
                onClick={open}
              />
            )}
          >
            <h3 className="settings-sheet-head">Privacy, plainly</h3>
            <p>
              What you send a local model stays on this device, and so does its answer, unless a
              cloud model in the same chat reads it later, on its own turn or as a step in a plan;
              if it searches the web, only the search words go out. Cloud models run on your own
              keys or accounts (an Ollama cloud model on your Ollama account), and only when you
              pick one or place it in your Stack. A few things do leave this device, and every one
              is listed under What leaves this device, above: the words of a web search, a web page
              the agent opens, update checks, the model list, a notification token if you allow
              notifications, and, while you are signed in, your account, a few preferences, and a
              record of any request the guardrail blocks. That record carries a category, a time,
              and a one-way hash, never your prompt and never the name of anyone it was about. No
              telemetry, no analytics, no advertising.
            </p>
            <h3 className="settings-sheet-head">Encrypted on this device</h3>
            <p>
              Your chats, projects, crew, settings, and session journals are sealed at rest with
              AES-256. The key that unlocks them stays on this device, held in its secure store, the{' '}
              {keyStoreLabel()}, whenever one is available, and it never leaves this device. API
              keys are held the same way. When you send a turn to a cloud provider, that one
              provider sees that one request on your own account. We do not, and there is nothing in
              between.
            </p>
            {facts ? <LiveSeal facts={facts} /> : null}
            <h3 className="settings-sheet-head">Local models, honestly</h3>
            <p>
              Harbor and Harbor Lite, and any model you run on this device, are AI. They can be
              confidently wrong. Harbor Lite (SmolLM2-135M-Instruct) is a guide, not a coder. Harbor
              (Qwen3 4B Instruct) writes and explains code, but it does not edit files or run
              commands. For real work, use DeepBlue on your computer or connect a bigger model. What
              you type to a local model stays on this device. Harbor Lite and Harbor are used under
              the Apache License 2.0. {HARBOR_MASTER_ATTRIBUTION}
            </p>
            <p>
              OpenShore does not editorialize what a model says. Three narrow limits are enforced on
              every path, local included, and they are the only ones: see Ethical boundaries below.
              The screening itself runs on this device and sends nothing anywhere, so a local chat
              stays local even though it is screened.
            </p>
          </InfoSheet>
          <SettingsRow
            label="Privacy Policy"
            sub="What we keep, why, for how long, and your rights"
            onClick={() => openExternal(PRIVACY_URL)}
          />
          <SettingsRow
            label="Terms of Use"
            sub="The terms, in plain words"
            onClick={() => openExternal(TERMS_URL)}
          />
        </SettingsGroup>

        {/* The trust statement. One source (os-code/protocol), shown here and on
            the marketing site, so the two can never say different things. */}
        <SettingsGroup index={group++}>
          <InfoSheet
            title="Ethical boundaries"
            renderTrigger={(open) => (
              <SettingsRow
                label="Ethical boundaries"
                sub="Three narrow limits, on every model, local included"
                value="Enforced"
                onClick={open}
              />
            )}
          >
            <h3 className="settings-sheet-head">What this app will not do</h3>
            {TRUST_STATEMENT_LINES.map((line) => (
              <p key={line}>{line}</p>
            ))}
            <h3 className="settings-sheet-head">What is blocked</h3>
            <p>
              Child sexual abuse material, and sexual or nude imagery of a real, identifiable
              person, are refused outright. So is concrete help building or deploying biological,
              chemical, nuclear, or high-yield explosive weapons. There is no consent option for any
              of those.
            </p>
            <p>
              Synthesized media only, meaning an image, a video, or a voice. Recreating the face or
              voice of a real, identifiable person is held back until you state you are authorized
              for that specific person, and what comes out carries provenance metadata saying it was
              AI-generated.
            </p>
            <h3 className="settings-sheet-head">What is not blocked</h3>
            <p>
              Legal adult content, dark and violent fiction, horror, edgy humor, satire and
              political parody, security research and red teaming, and unpopular opinions. The layer
              adds no refusal and no lecture to any of it. Over-blocking your legitimate work is
              treated as a defect, not a safe default.
            </p>
            <p>
              Words are free. The gate is on synthesized media, not on what you write: satire in
              text never touches it, and "it's satire" does not clear a photorealistic video of a
              real person's face.
            </p>
            <h3 className="settings-sheet-head">What is recorded</h3>
            <p>
              A block records a category, a timestamp, and a one-way hash of the request. Your
              prompt is never stored and never sent, and we keep no IP address with it. When you are
              signed in, block records reach your account so enforcement holds across a reinstall.
              Signed out, they stay on this device.
            </p>
          </InfoSheet>
        </SettingsGroup>

        <SettingsGroup id={FOLLOWS_GROUP_ID} title="This device" index={group++}>
          {platform() === 'ios' && vaultProviderId === 'local' && vaultRoomShut ? (
            <SettingsRow
              label="Export your notes"
              sub="Copies your Vault notes to Files. Always free."
              onClick={() => void exportPersonalVault()}
            />
          ) : null}
          {reposRoomShut
            ? REPO_CONNECTORS.filter((c) => connectedRepoPlatforms[c.id]).map((c) => (
                <SettingsRow
                  key={c.id}
                  label={c.name}
                  sub="Connected. Removing its sign-in from this device is always free."
                  trailing={
                    <button
                      type="button"
                      className="btn ghost sm press-fb"
                      onClick={async () => {
                        await disconnectRepoPlatform(c.id);
                        showToast(`${c.name} disconnected.`);
                      }}
                    >
                      Remove
                    </button>
                  }
                />
              ))
            : null}
          <SettingsRow
            label="Appearance"
            sub={signedIn ? 'Follows you to every device you sign in on' : 'Stays on this device'}
            trailing={
              <div className="segmented" role="radiogroup" aria-label="Appearance">
                {(['system', 'light', 'dark'] as const).map((t) => {
                  const active = (settings.theme ?? 'system') === t;
                  return (
                    <button
                      key={t}
                      role="radio"
                      aria-checked={active}
                      className={`seg press-fb${active ? ' active' : ''}`}
                      onClick={() => {
                        void saveSettings({ theme: t });
                      }}
                    >
                      {t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark'}
                    </button>
                  );
                })}
              </div>
            }
          />
          <SettingsRow
            label="App icon"
            sub={appIconNote(isPhone() ? 'phone' : isDesktop() ? 'desktop' : 'web')}
          />
          <div className="icon-picker" role="radiogroup" aria-label="App icon">
            {APP_ICONS.map((icon) => {
              const active = (settings.appIcon ?? 'default') === icon.id;
              return (
                <button
                  key={icon.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className="icon-choice press-fb"
                  onClick={() => {
                    if (active) return;
                    hapticCommit();
                    void saveSettings({ appIcon: icon.id });
                  }}
                >
                  <span className="icon-choice-tile">
                    <BrandMark size={56} icon={icon.id} />
                  </span>
                  {icon.label}
                </button>
              );
            })}
          </div>
          <SettingsRow
            label="Keep an activity log"
            sub="A plain log of what the app did, kept on this device for troubleshooting. Off by default."
            trailing={
              <Switch
                checked={insightsOn}
                label="Keep an activity log"
                onChange={(next) => {
                  void saveSettings({ insightsOptIn: next });
                  showToast(
                    next ? 'Activity log on. It stays on this device.' : 'Activity log off.',
                  );
                }}
              />
            }
          />
          {insightsOn ? (
            <SettingsRow
              label="Activity log"
              value={`${insightsCount()} events`}
              onClick={() => setSheet('log')}
            />
          ) : null}
          <SettingsRow
            label="Store tokens and secrets"
            sub="A per-project note of your credentials, encrypted here. Off by default."
            trailing={
              <Switch
                checked={Boolean(settings.storeSecrets)}
                label="Store tokens and secrets"
                onChange={(next) => {
                  void saveSettings({ storeSecrets: next });
                  showToast(
                    next
                      ? 'On. Secrets stay sealed on this device, and only a local model can use them.'
                      : 'Off. Your saved secrets stay on this device but no model will use them.',
                  );
                }}
              />
            }
          />
        </SettingsGroup>

        {/* Approvals (CX, 2026-09-24, after Zed's "trust all projects" row):
            not a blanket trust switch, one comfort level for edits, the same
            choice the setup walk asks once a repository connects. Kept on this
            device. Commands ask first unless the person allows them (Terminal
            Control, a project's always allow), the same words as the
            Repositories lead, and Plan and Bypass stay in a coding chat's mode
            pill. */}
        <SettingsGroup title="Approvals" index={group++}>
          <SettingsRow
            label="When the agent edits"
            sub={
              editMode === 'default' || editMode === 'acceptEdits'
                ? 'Commands ask first unless you allow them. Plan and Bypass are set from a coding chat.'
                : editMode === 'bypassPermissions'
                  ? // Bypass says what it does, not "unless Bypass is on" while it is.
                    'Bypass is on, set from a coding chat. Commands run without asking. Cloud spend still asks.'
                  : `${permissionModeLabel(editMode)} is on, set from a coding chat. Commands ask first unless you allow them.`
            }
            trailing={
              <div className="segmented" role="radiogroup" aria-label="When the agent edits">
                {(['default', 'acceptEdits'] as const).map((m) => {
                  const active = editMode === m;
                  return (
                    <button
                      key={m}
                      role="radio"
                      aria-checked={active}
                      className={`seg press-fb${active ? ' active' : ''}`}
                      onClick={() => {
                        if (active) return;
                        void setPermissionMode(m, 'settings');
                        showToast(
                          m === 'default'
                            ? 'Ask first. OpenShore checks before each edit.'
                            : 'Accept edits. Each diff shows in the chat.',
                        );
                      }}
                    >
                      {permissionModeLabel(m)}
                    </button>
                  );
                })}
              </div>
            }
          />
          {isDesktop() || settings.daemon ? (
            <SettingsRow
              label="Opening web pages"
              sub={webFetchLine(settings.webFetchMode ?? 'ask')}
              trailing={
                <div className="segmented" role="radiogroup" aria-label="Opening web pages">
                  {WEB_FETCH_MODES.map((m) => {
                    const active = (settings.webFetchMode ?? 'ask') === m;
                    return (
                      <button
                        key={m}
                        role="radio"
                        aria-checked={active}
                        className={`seg press-fb${active ? ' active' : ''}`}
                        onClick={() => {
                          if (active) return;
                          if (m === 'allow') hapticCommit();
                          void setWebFetchMode(m).then((reached) =>
                            showToast(
                              reached
                                ? webFetchLine(m)
                                : 'Your computer is not in reach, so nothing changed. Try again when it is.',
                            ),
                          );
                        }}
                      >
                        {WEB_FETCH_LABEL[m]}
                      </button>
                    );
                  })}
                </div>
              }
            />
          ) : null}
        </SettingsGroup>

        {termTargetId ? (
          <SettingsGroup title="Terminal" index={group++}>
            <SettingsRow
              label="Terminal Control"
              sub={
                termControlOn
                  ? `On. The model runs commands on ${termLabel}.`
                  : `Off. The model stays out of the terminal on ${termLabel}. You run commands yourself.`
              }
              trailing={
                canControlTerm ? (
                  <Switch
                    checked={termControlOn}
                    label="Terminal Control"
                    onChange={(next) => {
                      if (next) hapticCommit();
                      void setTerminalControl(next);
                      showToast(
                        next
                          ? `Terminal Control on for ${termLabel}.`
                          : `Terminal Control off for ${termLabel}.`,
                      );
                    }}
                  />
                ) : (
                  <span className="pill">admin only</span>
                )
              }
            />
          </SettingsGroup>
        ) : null}

        {SHIPS_LAUNCH && codemagicConnected ? (
          <SettingsGroup title="Launch with Codemagic" index={group++}>
            <SettingsRow
              label="Codemagic Access"
              sub={
                codemagicAccessIsOn
                  ? 'On. The model can trigger builds, read the failure, fix, and rebuild until it goes green, then tell you where it landed.'
                  : 'Off. The model stays out of Codemagic. You run the builds yourself.'
              }
              trailing={
                canControlCm ? (
                  <Switch
                    checked={codemagicAccessIsOn}
                    label="Codemagic Access"
                    onChange={(next) => {
                      if (next) hapticCommit();
                      void setCodemagicAccess(next);
                      showToast(next ? 'Codemagic Access on.' : 'Codemagic Access off.');
                    }}
                  />
                ) : (
                  <span className="pill">admin only</span>
                )
              }
            />
          </SettingsGroup>
        ) : null}

        {SHIPS_STACKHEALTH && shHub ? (
          <SettingsGroup title="Stack Health" index={group++}>
            <SettingsRow
              label="Who can see Stack Health"
              sub={
                shVisibility === 'admins'
                  ? 'Admins only. Stack Health shows this computer. The numbers are always its total, never broken down by person.'
                  : 'Everyone on the team. Stack Health shows this computer. The numbers are always its total, never broken down by person.'
              }
              trailing={
                canControlSh ? (
                  <Switch
                    checked={shVisibility === 'admins'}
                    label="Stack Health admins only"
                    onChange={(next) => {
                      if (!shHub) return;
                      const v: StackHealthVisibility = next ? 'admins' : 'everyone';
                      const prev = shVisibility;
                      setShVisibility(v); // optimistic
                      if (next) hapticCommit();
                      void setStackHealthVisibility(shHub, v).then((ok) => {
                        if (ok) {
                          showToast(
                            v === 'admins'
                              ? 'Stack Health is now admins only.'
                              : 'Stack Health is now open to everyone on the team.',
                          );
                        } else {
                          setShVisibility(prev); // revert on failure
                          showToast('Could not reach your computer to change that.');
                        }
                      });
                    }}
                  />
                ) : (
                  <span className="pill">admin only</span>
                )
              }
            />
          </SettingsGroup>
        ) : null}

        <SettingsGroup title="Web search" index={group++}>
          <SettingsRow
            label="Let models search the web"
            // Crew routines follow this switch and only search (founder,
            // 2026-10-01); every other web tool stays off for them.
            sub={`${
              webSearchOn(settings.webSearchConsent)
                ? 'On. A model sends its search words to the search service below, and nothing else from your chat.'
                : settings.webSearchConsent === 'declined'
                  ? 'Off. Models answer from what they know.'
                  : isDesktop()
                    ? 'Asks the first time a chat model wants to search. The coding agent searches only once this is on.'
                    : 'Asks the first time a model wants to search.'
            } ${ROUTINES_SEARCH_LINE}`}
            trailing={
              <Switch
                checked={webSearchOn(settings.webSearchConsent)}
                label="Let models search the web"
                onChange={(next) => {
                  if (next) hapticCommit();
                  void setWebSearchAllowed(next);
                  showToast(next ? 'Web search on.' : 'Web search off.');
                }}
              />
            }
          />
          <SettingsRow
            label="Search service"
            sub="Where local models send their searches"
            value={SEARCH_BACKEND_LABEL[activeSearchBackend]}
            onClick={() => {
              setSearchKeyValue('');
              setSheet('search');
            }}
          />
        </SettingsGroup>

        <SettingsGroup title="Harbor" index={group++}>
          {!isDesktop() ? (
            <>
              <SettingsRow
                label="Harbor Lite"
                sub={HARBOR_MINI_ROW_SUB}
                trailing={<HarborInstallButton bundled={HARBOR_MINI_BUNDLED} />}
              />
              <SettingsRow
                label="Harbor"
                sub={HARBOR_BYLINE}
                trailing={
                  <HarborInstallButton
                    ready={settings.harborReady}
                    download={harborDownload}
                    onInstall={() => void installHarbor()}
                    onUninstall={() => void uninstallHarbor()}
                    onCancel={() => cancelHarbor()}
                  />
                }
              />
            </>
          ) : null}
          {isDesktop() ? (
            <SettingsRow
              label="DeepBlue"
              sub={HARBOR_MASTER_BYLINE}
              trailing={
                <HarborInstallButton
                  ready={harborMasterPresent}
                  download={harborMasterDownload}
                  onInstall={() => void installHarborMaster()}
                />
              }
            />
          ) : null}
        </SettingsGroup>

        <SettingsGroup title="Reasoning" index={group++}>
          <SettingsRow
            label="Chain of Thought"
            sub="Shows a model's reasoning above its answer, then folds it away. Off by default."
            trailing={
              <Switch
                checked={chainOfThoughtOn}
                label="Chain of Thought"
                onChange={(next) => {
                  void saveSettings({ chainOfThought: next });
                  showToast(
                    next
                      ? 'Chain of Thought on. Reasoning shows above each answer.'
                      : 'Chain of Thought off. Models answer without thinking out loud.',
                  );
                }}
              />
            }
          />
          <InfoSheet
            title="Chain of Thought"
            renderTrigger={(open) => (
              <SettingsRow
                label="How this works"
                sub="What it shows, and what it costs"
                onClick={open}
              />
            )}
          >
            <p>
              With Chain of Thought on, you see how a model works a problem through. Its thinking
              streams into a quiet block above the answer while it works, and folds to one line,
              "Thought for 12s", the moment the answer starts. Tap the line to read it again.
            </p>
            <p>
              Models that reason on their own, like Claude and the Qwen3 and DeepSeek R1 families,
              are asked through their own interface. Claude shows a readable summary of its
              reasoning, not every token. Every other model is asked to think step by step before
              answering, so this works on any model you run, local or cloud.
            </p>
            <p>
              Thinking costs time and tokens. On a local model it slows each answer, and on a paid
              model the thinking is billed like any other output. That is why it is off by default.
              Off, no model is asked to think out loud, and any reasoning a model sends anyway stays
              out of the chat.
            </p>
            <p>
              It reaches your chats here and any session this app starts on your paired computer. A
              session already open on your computer keeps the setting it started with until you
              start a new chat, though turning it off hides the thinking right away.
            </p>
          </InfoSheet>
        </SettingsGroup>

        <SettingsGroup title="Writing" index={group++}>
          <SettingsRow
            label="Humanize Writing"
            sub="Keeps generated text plain and specific, free of AI writing tells. On by default."
            trailing={
              <Switch
                checked={humanizeOn}
                label="Humanize Writing"
                onChange={(next) => {
                  void saveSettings({ humanizeWriting: next });
                  showToast(
                    next
                      ? 'Humanize Writing on. Generated text avoids AI writing tells.'
                      : 'Humanize Writing off. Models run on a shorter prompt.',
                  );
                }}
              />
            }
          />
          <InfoSheet
            title="Humanize Writing"
            renderTrigger={(open) => (
              <SettingsRow label="How this works" sub="What it changes, and why" onClick={open} />
            )}
          >
            <p>
              With Humanize Writing on, any text a model writes for you, whether a report, a commit
              message, docs, or copy, is held to a plain, specific, honest voice. The model is told
              to avoid the habits that mark text as AI-written: inflated significance, brochure
              language, vague attribution, the rule of three, Title Case headings, formulaic "faces
              challenges" endings, leftover chatbot chatter, and the rest.
            </p>
            <p>
              The list of tells is distilled from the community-maintained field guide "Signs of AI
              writing" and shipped with the app as a fixed snapshot, so nothing is fetched from the
              web while you work.
            </p>
            <p>
              It is on by default. Turn it off and the standard drops out of the prompt, so a model
              reads a shorter prompt. Off reaches your chats here and any session this app starts on
              your paired computer.
            </p>
            <p>
              Two things it does not touch. A project can keep its own setting in its config, and
              that always wins. And the small on-device models (Harbor and Harbor Lite) are left as
              they are, to protect their limited context.
            </p>
          </InfoSheet>
          <WritingVoiceField />
        </SettingsGroup>

        <SettingsGroup title="Voice mode" index={group++}>
          <SettingsRow
            label="Voice"
            sub="Spoken replies use this device's voices. Premium voices download once, then work offline."
            value={voiceName || 'Default'}
            onClick={() => setVoicePickerOpen(true)}
          />
          <SettingsRow
            label="Speaking speed"
            trailing={
              <div className="segmented" role="radiogroup" aria-label="Speaking speed">
                {(
                  [
                    ['Slow', 0.3],
                    ['Normal', 0.5],
                    ['Fast', 0.7],
                  ] as const
                ).map(([label, val]) => {
                  const active = Math.abs(voiceRate - val) < 0.01;
                  return (
                    <button
                      key={label}
                      role="radio"
                      aria-checked={active}
                      className={`seg press-fb${active ? ' active' : ''}`}
                      onClick={() => void saveSettings({ voiceRate: val })}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            }
          />
          <SettingsRow
            label="Speak replies aloud"
            sub="In voice mode, read the model's replies. Off keeps voice as listen and send."
            trailing={
              <Switch
                checked={speakReplies}
                label="Speak replies aloud"
                onChange={(next) => {
                  void saveSettings({ voiceReplies: next });
                  showToast(
                    next
                      ? 'Replies will be spoken in voice mode.'
                      : 'Replies stay on screen; voice still listens and sends.',
                  );
                }}
              />
            }
          />
        </SettingsGroup>

        {/* Notices: a banner for what finished while you were away. iPhone only. */}
        {isPhone() ? (
          <SettingsGroup title="Notifications" index={group++}>
            {noticeStatus === 'denied' ? (
              <SettingsRow
                label="Notifications are off for OpenShore"
                sub="Turn them on in iOS Settings, then OpenShore, then Notifications."
              />
            ) : null}
            <SettingsRow
              label="Downloads"
              sub="When a model finishes downloading while you are away."
              trailing={
                <Switch
                  checked={noticeEnabled('download', settings)}
                  label="Download notifications"
                  onChange={(next) => void saveSettings({ noticeDownloads: next })}
                />
              }
            />
            <SettingsRow
              label="Replies"
              sub="When a reply is ready, or a chat needs your approval, while you are away."
              trailing={
                <Switch
                  checked={noticeEnabled('reply', settings)}
                  label="Reply notifications"
                  onChange={(next) => void saveSettings({ noticeReplies: next })}
                />
              }
            />
          </SettingsGroup>
        ) : null}

        {/* Wayfinding: how the agent finds its way. On by default. */}
        <SettingsGroup title="Wayfinding" index={group++}>
          {WAYFINDING_READY.map((id) => (
            <Fragment key={id}>
              <SettingsRow
                label={WAYFINDING[id].label}
                // Memory now says what it gates: the vault in chats too.
                sub={id === 'memory' ? VAULT_MEMORY_SUB : WAYFINDING[id].sub}
                trailing={
                  <Switch
                    checked={wayfindingOn(settings, id)}
                    label={WAYFINDING[id].label}
                    onChange={(next) => {
                      void setWayfinding(id, next);
                      showToast(`${WAYFINDING[id].label} ${next ? 'on' : 'off'}.`);
                    }}
                  />
                }
              />
              {/* Directly after Memory (Vault M7, CX Y4, Y7): the vault's two
                  device switches and its settings. Rows of this group, never
                  a group or a room of their own. */}
              {id === 'memory' ? (
                <>
                  <SettingsRow
                    label={VAULT_SETTINGS_ROWS.context}
                    sub={memoryOn ? vaultNotesInChatsSub(PACK_BY_CLASS) : VAULT_SWITCH_MEMORY_OFF}
                    trailing={
                      <Switch
                        checked={vaultDevice.context.on}
                        disabled={!memoryOn}
                        label={VAULT_SETTINGS_ROWS.context}
                        onChange={(next) => {
                          void saveSettings(vaultDevicePatch({ context: next }));
                          showToast(vaultNotesInChatsToast(next));
                        }}
                      />
                    }
                  />
                  <SettingsRow
                    label={VAULT_SETTINGS_ROWS.handoff}
                    sub={memoryOn ? VAULT_HANDOFF_SUB : VAULT_SWITCH_MEMORY_OFF}
                    trailing={
                      <Switch
                        checked={vaultDevice.handoff.on}
                        disabled={!memoryOn}
                        label={VAULT_SETTINGS_ROWS.handoff}
                        onChange={(next) => {
                          void saveSettings(vaultDevicePatch({ handoff: next }));
                          showToast(vaultHandoffToast(next));
                        }}
                      />
                    }
                  />
                  <SettingsRow
                    label={VAULT_SETTINGS_TITLE}
                    value={vaultStorageName}
                    onClick={() => {
                      // The personal vault only (the team vault is never in
                      // context, D15).
                      void (async () => {
                        if (vaultScope === 'team') await setVaultScope('personal');
                        setVaultSettingsOpen(true);
                      })();
                    }}
                  />
                </>
              ) : null}
            </Fragment>
          ))}
          {/* Research (Perplexity): a sibling of Browser, but OFF by default and
              gated on a connected Perplexity key, since it spends that key on
              every search. Reuses the Cloud Connections key, so no second ask;
              inert with a reason until the key exists. */}
          <SettingsRow
            label="Research"
            sub={
              connectedProviders.perplexity ? (
                'Web research through Perplexity, on your Perplexity API key. Spent with your approval, on every search.'
              ) : (
                <>
                  Web research through Perplexity. Connect a Perplexity API key in{' '}
                  <button
                    type="button"
                    className="linklike press-fb"
                    onClick={() => setView('connections')}
                  >
                    Cloud Connections
                  </button>{' '}
                  to turn this on.
                </>
              )
            }
            trailing={
              <Switch
                checked={settings.perplexityResearch === true}
                disabled={!connectedProviders.perplexity}
                label="Research"
                onChange={(next) => {
                  void setPerplexityResearch(next);
                  showToast(`Research ${next ? 'on' : 'off'}.`);
                }}
              />
            }
          />
        </SettingsGroup>

        {/* Currents (Agentic and Harness) moved to per-project settings
            (founder, 2026-09-23): a current is a workflow choice, so it lives
            on the project (ProjectDetailScreen), where different projects run
            different currents at once. Connecting one stays device-local, on
            its connect sheet, reached from the project row. */}

        <SettingsGroup index={group++}>
          <SettingsRow
            label="Clear chats"
            sub="Removes every chat from this device"
            danger
            onClick={() => setSheet('clear')}
          />
        </SettingsGroup>

        <p className="hint settings-foot">
          OpenShore 0.1.0 · {platformLabel()}
          <br />
          {/* The one line for what OpenShore is (D23): the setup page's
              headline and Harbor Lite's overview say it too. */}
          Your models. Your keys.
        </p>
      </div>

      <Sheet open={sheet === 'account'} onClose={close}>
        <SheetHead
          title={signedIn ? 'Your account' : signInMode === 'signup' ? 'Create account' : 'Sign in'}
          onClose={close}
        />
        {/* A team's plan and price are v4 (founder 2026-09-30: Personal first). */}
        {SHIPS_TEAMS && signedIn && account?.type === 'commercial' && org ? (
          <p className="sheet-sub">
            {tierById(org.tierId).name} plan ·{' '}
            {shownPrice(tierById(org.tierId), PAY_GATES_ENABLED)
              ? `${shownPrice(tierById(org.tierId), PAY_GATES_ENABLED)} · `
              : ''}
            {org.members.length} {org.members.length === 1 ? 'person' : 'people'}
          </p>
        ) : null}
        <SignInCard variant="sheet" onModeChange={setSignInMode} />
        {SHIPS_ADMIN && signedIn && account?.type === 'commercial' && isOrgAdmin(account) ? (
          <button
            className="btn ghost block"
            onClick={() => {
              close();
              setView('admin');
            }}
          >
            Manage the company account
          </button>
        ) : null}
        {/* Delete account (Apple 5.1.1(v), CX ruling 3): last in the sheet,
            shown only while signed in; its goodbye closes this sheet too. */}
        <DeleteAccount signedIn={signedIn} onDelete={deleteAccount} onDone={close} />
      </Sheet>

      <Sheet open={sheet === 'log'} onClose={close}>
        <SheetHead title="Activity log" onClose={close} />
        <p className="sheet-sub">
          A plain record of where setup goes smoothly or gets stuck, kept on this device. Nothing is
          ever sent unless you copy it and hand it back yourself.
        </p>
        <p className="hint">{insightsCount()} events recorded on this device.</p>
        <div className="sheet-actions">
          <button className="btn primary press-fb" onClick={() => void copyLog()}>
            Copy log
          </button>
          <button
            className="btn quiet press-fb"
            onClick={() => {
              void clearInsights();
              showToast('Activity log cleared.');
              close();
            }}
          >
            Clear the log
          </button>
        </div>
      </Sheet>

      <Sheet open={sheet === 'search'} onClose={close}>
        <SheetHead title="Web search" onClose={close} />
        <p className="sheet-sub">
          Your local models search the web when they need to. DuckDuckGo needs no API key. Bring
          your own Brave Search or Tavily API key to search on your own account.
        </p>
        <div className="segmented" role="radiogroup" aria-label="Search provider">
          {(['brave', 'tavily'] as const).map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={searchChoice === c}
              className={`seg press-fb${searchChoice === c ? ' active' : ''}`}
              onClick={() => setSearchChoice(c)}
            >
              {SEARCH_BACKEND_LABEL[c]}
            </button>
          ))}
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="settings-search-key">{SEARCH_BACKEND_LABEL[searchChoice]} API key</label>
          <input
            id="settings-search-key"
            type="password"
            placeholder="Paste the key"
            value={searchKeyValue}
            onChange={(e) => setSearchKeyValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void saveSearch()}
          />
        </div>
        <div className="sheet-actions">
          <button
            className="btn primary press-fb"
            disabled={!searchKeyValue.trim()}
            onClick={() => void saveSearch()}
          >
            Save API key
          </button>
          {searchKeyConfigured ? (
            <button
              className="btn quiet press-fb"
              onClick={() => {
                void clearSearchBackend();
                showToast('Back to DuckDuckGo.');
                close();
              }}
            >
              Back to DuckDuckGo
            </button>
          ) : null}
        </div>
      </Sheet>

      <Sheet open={sheet === 'clear'} onClose={close} variant="confirm">
        <h3>Clear every chat on this device?</h3>
        <p>Session journals on your computer stay there. This cannot be undone.</p>
        <div className="confirm-row">
          <button className="btn ghost" onClick={close}>
            Keep them
          </button>
          <button
            className="btn danger"
            onClick={() => {
              void clearConversations();
              close();
              showToast('Chats cleared.');
            }}
          >
            Clear
          </button>
        </div>
      </Sheet>

      <VoicePicker
        open={voicePickerOpen}
        onClose={() => setVoicePickerOpen(false)}
        selectedId={settings.voiceId}
        rate={voiceRate}
        onSelect={(id) => {
          void saveSettings({ voiceId: id });
          void listVoices().then((voices) =>
            setVoiceName(voices.find((v) => v.id === id)?.name ?? ''),
          );
        }}
      />
      {/* The same Vault settings sheet as the Vault room's (CX Y4). "Where it
          lives" goes to the Vault room and opens its storage sheet there. */}
      <VaultSettingsHost
        open={vaultSettingsOpen}
        setOpen={setVaultSettingsOpen}
        onOpenStorage={() => {
          vaultRequestSheet('storage');
          setView('vault');
        }}
      />
    </div>
  );
}
