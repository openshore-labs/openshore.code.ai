// Settings: the honest page, written as a ledger. Five short groups under
// serif heads, one row per thing, the current value on the right, and
// everything deeper in a sheet. What this app keeps, where it lives, and a
// few careful switches. No telemetry to toggle because there is none. Built
// with the Creative Studio (2026-09-02, "The Ledger" direction).
import { useEffect, useState } from 'react';
import { isOrgAdmin, useApp, type HarborDownload } from '../state/store.js';
import { useAuth } from '../hooks/useAuth.js';
import { platform, isDesktop } from '../lib/platform.js';
import { bridge } from '../lib/electronBridge.js';
import { HARBOR_BYLINE } from '../lib/harbor.js';
import {
  HARBOR_MINI_BYLINE,
  HARBOR_MINI_BUNDLED,
  HARBOR_MINI_HANDOFF_LINE,
} from '../lib/harborMini.js';
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
import { tierById, priceLabel } from '../lib/plans.js';
import { clearInsights, insightsAsText, insightsCount } from '../lib/insights.js';
import { hapticApproval, hapticTick } from '../lib/haptics.js';
import { BackBar } from '../components/BackBar.js';
import { SignInCard } from '../components/SignInCard.js';
import { InfoSheet } from '../components/InfoSheet.js';
import { Sheet } from '../components/Sheet.js';
import { Switch } from '../components/Switch.js';
import { SettingsGroup, SettingsRow } from '../components/SettingsRow.js';
import { SheetHead } from '../components/SheetHead.js';
import type { SearchBackend } from '../lib/webSearch.js';
import { TRUST_STATEMENT_LINES, type StackHealthSealFact } from 'os-code/protocol';

const SEARCH_BACKEND_LABEL: Record<SearchBackend, string> = {
  duckduckgo: 'DuckDuckGo',
  brave: 'Brave Search',
  tavily: 'Tavily',
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
        Measured on this machine just now, not promised.
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

function platformLabel(): string {
  switch (platform()) {
    case 'ios':
      return 'iPhone';
    case 'electron':
      return 'desktop';
    default:
      return 'web';
  }
}

/** The one control on the right of a Harbor row. A single button whose label
 *  and action follow the model's state: Install when it is absent, its live
 *  percent (tap to cancel) while it downloads, Retry after a failure, Uninstall
 *  once it is on the device. A bundled model (Harbor Light) ships with the app
 *  and cannot be removed, so it shows a plain "Built in" status instead. */
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
  onUninstall?: () => void;
  onCancel?: () => void;
}) {
  if (bundled) {
    return <span className="harbor-action is-builtin">Built in</span>;
  }
  if (download && !download.failed) {
    const label = download.indeterminate ? 'Downloading' : `${Math.round(download.percent)}%`;
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
        Retry
      </button>
    );
  }
  if (ready) {
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
    order,
    settings,
    deleteConversation,
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
    setTerminalControl,
    setCodemagicAccess,
    codemagicConnected,
    serverRole,
  } = useApp();
  const { configured, signedIn, email } = useAuth();
  const insightsOn = Boolean(settings.insightsOptIn);
  const humanizeOn = settings.humanizeWriting !== false;
  const account = settings.account;
  const org = account?.org;
  const [sheet, setSheet] = useState<SheetName | undefined>();
  const [searchChoice, setSearchChoice] = useState<'brave' | 'tavily'>('brave');
  const [searchKeyValue, setSearchKeyValue] = useState('');
  const activeSearchBackend: SearchBackend =
    searchKeyConfigured && settings.searchBackend ? settings.searchBackend : 'duckduckgo';
  const facts = useSeal();
  const sealed = facts ? facts.every((f) => f.state === 'good') : false;
  const close = () => setSheet(undefined);

  const installHarbor = async () => {
    hapticTick();
    // Harbor Light's voice on the handoff: the guide stays beside you while the
    // bigger model comes down. Only when a download actually starts (not when
    // Harbor is already here and ensureHarbor is an instant no-op).
    if (!settings.harborReady) showToast(HARBOR_MINI_HANDOFF_LINE);
    const ok = await ensureHarbor();
    if (ok) showToast('Harbor is installed and ready on this device.');
  };
  const uninstallHarbor = async () => {
    hapticTick();
    await removeHarbor();
    showToast('Harbor removed. You can reinstall it any time.');
  };

  const saveSearch = async () => {
    const key = searchKeyValue.trim();
    close();
    setSearchKeyValue('');
    if (!key) return;
    await setSearchBackend(searchChoice, key);
    showToast(`${SEARCH_BACKEND_LABEL[searchChoice]} connected for Harbor's web search.`);
  };

  const copyLog = async () => {
    const text = insightsAsText();
    try {
      await navigator.clipboard.writeText(text);
      showToast('Activity log copied. Paste it back to the team.');
    } catch {
      showToast('Copy is unavailable here. The log stays on this device.');
    }
  };

  const accountLabel = signedIn
    ? account?.type === 'commercial'
      ? (org?.name ?? 'Company account')
      : 'Personal account'
    : 'Sign in';
  const accountValue = signedIn
    ? account?.type === 'commercial' && org
      ? tierById(org.tierId).name
      : 'Free'
    : 'Optional';

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
  const shHub = settings.daemon;
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
      <BackBar title="Settings" />
      <div className="screen-inner settings">
        <h1>Settings</h1>
        <p className="lead">Yours where it matters. Here is what this app keeps, and where.</p>

        <SettingsGroup title="Account" index={group++}>
          <SettingsRow
            label={accountLabel}
            sub={signedIn ? email : 'Personal use needs no account'}
            value={accountValue}
            onClick={configured ? () => setSheet('account') : undefined}
          />
        </SettingsGroup>

        <SettingsGroup title="Privacy" index={group++}>
          <InfoSheet
            title="Privacy and Conditions"
            renderTrigger={(open) => (
              <SettingsRow
                label="Privacy and Conditions"
                sub="Plainly, encrypted on this device, local models honestly"
                value={facts ? (sealed ? 'Sealed' : 'On this device') : 'On this device'}
                onClick={open}
              />
            )}
          >
            <h3 className="settings-sheet-head">Privacy, plainly</h3>
            <p>
              Local models run on your hardware and nothing leaves it. Cloud models run on your own
              keys and only with your approval. Web search leaves your machine when the agent uses
              it. No telemetry, no analytics, no phone-home, ever.
            </p>
            <h3 className="settings-sheet-head">Encrypted on this device</h3>
            <p>
              Your chats, projects, crew, settings, and session journals are sealed at rest with
              AES-256. The key that unlocks them stays on this device, held in its secure store, the{' '}
              {keyStoreLabel()}, whenever one is available, and it never leaves this machine. API
              keys are held the same way. When you send a turn to a cloud provider, that one
              provider sees that one request on your own account. We do not, and there is nothing in
              between.
            </p>
            {facts ? <LiveSeal facts={facts} /> : null}
            <h3 className="settings-sheet-head">Local models, honestly</h3>
            <p>
              Harbor and Harbor Light, and any model you run on this device, are AI. They can be
              confidently wrong, and neither is a coder. For real work, connect a bigger model. What
              you type to a local model stays on this device. Harbor is Qwen3-1.7B and Harbor Light
              is SmolLM2-135M-Instruct, both used under the Apache License 2.0.
            </p>
            <p>
              OpenShore does not editorialize what a model says. Three narrow limits are enforced on
              every path, local included, and they are the only ones: see Ethical boundaries below.
              The screening itself runs on this device and sends nothing anywhere, so a local chat
              stays local even though it is screened.
            </p>
          </InfoSheet>
        </SettingsGroup>

        {/* The trust statement. One source (os-code/protocol), shown here and on
            the marketing site, so the two can never say different things. */}
        <SettingsGroup title="Ethical boundaries" index={group++}>
          <InfoSheet
            title="Ethical boundaries"
            renderTrigger={(open) => (
              <SettingsRow
                label="Ethical boundaries"
                sub="Enforced by default, on every model, with no switch"
                value="Always on"
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
              chemical, nuclear, or high-yield explosive weapons. There is no consent option for
              any of those.
            </p>
            <p>
              Recreating the face or voice of a real, identifiable person is held back until you
              state that you are authorized for that specific person, and what comes out carries
              provenance metadata saying it was AI-generated.
            </p>
            <h3 className="settings-sheet-head">What is not blocked</h3>
            <p>
              Legal adult content, dark and violent fiction, horror, edgy humor, satire and
              political parody, security research and red teaming, and unpopular opinions. The layer
              adds no refusal and no lecture to any of it. Over-blocking your legitimate work is
              treated as a defect, not a safe default.
            </p>
            <h3 className="settings-sheet-head">What is recorded</h3>
            <p>
              A block records a category, a timestamp, and a one-way hash of the request. Your
              prompt is never stored and never sent. When you are signed in, the record reaches your
              account so enforcement survives a reinstall. Signed out, it stays on this device.
            </p>
          </InfoSheet>
        </SettingsGroup>

        <SettingsGroup title="This device" index={group++}>
          <SettingsRow
            label="Appearance"
            sub="Stays on this device"
            trailing={
              <div className="segmented" role="tablist" aria-label="Appearance">
                {(['system', 'light', 'dark'] as const).map((t) => {
                  const active = (settings.theme ?? 'system') === t;
                  return (
                    <button
                      key={t}
                      role="tab"
                      aria-selected={active}
                      className={`seg press-fb${active ? ' active' : ''}`}
                      onClick={() => {
                        hapticTick();
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
            label="Help improve the test build"
            sub="A plain activity log, kept here. Off by default."
            trailing={
              <Switch
                checked={insightsOn}
                label="Help improve the test build"
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
                      if (next) hapticApproval();
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

        {codemagicConnected ? (
          <SettingsGroup title="App Launch" index={group++}>
            <SettingsRow
              label="Codemagic Access"
              subWrap
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
                      if (next) hapticApproval();
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

        {shHub ? (
          <SettingsGroup title="Stack Health" index={group++}>
            <SettingsRow
              label="Who can see Stack Health"
              subWrap
              sub={
                shVisibility === 'admins'
                  ? 'Admins only. Stack Health shows this hub. The numbers are always the hub total, never broken down by person.'
                  : 'Everyone on the team. Stack Health shows this hub. The numbers are always the hub total, never broken down by person.'
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
                      if (next) hapticApproval();
                      void setStackHealthVisibility(shHub, v).then((ok) => {
                        if (ok) {
                          showToast(
                            v === 'admins'
                              ? 'Stack Health is now admins only.'
                              : 'Stack Health is now open to everyone on the team.',
                          );
                        } else {
                          setShVisibility(prev); // revert on failure
                          showToast('Could not reach your hub to change that.');
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

        <SettingsGroup title="Harbor" index={group++}>
          <SettingsRow
            label="Web search"
            sub="When Harbor needs the web"
            value={SEARCH_BACKEND_LABEL[activeSearchBackend]}
            onClick={() => {
              setSearchKeyValue('');
              setSheet('search');
            }}
          />
          {!isDesktop() ? (
            <>
              <SettingsRow
                label="Harbor Light"
                sub={HARBOR_MINI_BYLINE}
                subWrap
                trailing={<HarborInstallButton bundled={HARBOR_MINI_BUNDLED} />}
              />
              <SettingsRow
                label="Harbor"
                sub={HARBOR_BYLINE}
                subWrap
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
              It is on by default, and most people leave it on. Turn it off and the standard drops
              out of the prompt, so a model runs on a shorter prompt and answers a little faster.
              Off reaches your chats here and any paired desktop session this app starts.
            </p>
            <p>
              Two things it does not touch. A project can keep its own setting in its config, and
              that always wins. And the small on-device guides (Harbor and Harbor Light) are left as
              they are, to protect their limited context.
            </p>
          </InfoSheet>
        </SettingsGroup>

        <SettingsGroup index={group++}>
          <SettingsRow
            label="Clear conversations"
            sub="Removes every chat from this device"
            danger
            onClick={() => setSheet('clear')}
          />
        </SettingsGroup>

        <p className="hint settings-foot">
          OpenShore 0.1.0 · {platformLabel()}
          <br />
          Familiar where it should be, yours where it matters.
        </p>
      </div>

      <Sheet open={sheet === 'account'} onClose={close}>
        <SheetHead title={signedIn ? 'Your account' : 'Sign in'} onClose={close} />
        {signedIn && account?.type === 'commercial' && org ? (
          <p className="sheet-sub">
            {tierById(org.tierId).name} plan · {priceLabel(tierById(org.tierId))} ·{' '}
            {org.members.length} {org.members.length === 1 ? 'person' : 'people'}
          </p>
        ) : null}
        <SignInCard />
        {signedIn && account?.type === 'commercial' && isOrgAdmin(account) ? (
          <button
            className="btn ghost"
            style={{ width: '100%' }}
            onClick={() => {
              close();
              setView('admin');
            }}
          >
            Manage the company account
          </button>
        ) : null}
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
          Harbor searches the web when it needs to. DuckDuckGo needs no key. Bring your own Brave
          Search or Tavily key to search on your own account.
        </p>
        <div className="segmented" role="tablist" aria-label="Search provider">
          {(['brave', 'tavily'] as const).map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={searchChoice === c}
              className={`seg press-fb${searchChoice === c ? ' active' : ''}`}
              onClick={() => setSearchChoice(c)}
            >
              {SEARCH_BACKEND_LABEL[c]}
            </button>
          ))}
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <input
            type="password"
            placeholder={`${SEARCH_BACKEND_LABEL[searchChoice]} API key`}
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
            Save key
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
        <h3>Clear every conversation on this {platformLabel()}?</h3>
        <p>Desktop journals stay on the desktop. This cannot be undone.</p>
        <div className="confirm-row">
          <button className="btn ghost" onClick={close}>
            Keep them
          </button>
          <button
            className="btn danger"
            onClick={() => {
              for (const id of [...order]) deleteConversation(id);
              close();
              showToast('Conversations cleared.');
            }}
          >
            Clear
          </button>
        </div>
      </Sheet>
    </div>
  );
}
