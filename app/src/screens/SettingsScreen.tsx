// Settings: the honest page, written as a ledger. Five short groups under
// serif heads, one row per thing, the current value on the right, and
// everything deeper in a sheet. What this app keeps, where it lives, and a
// few careful switches. No telemetry to toggle because there is none. Built
// with the Creative Studio (2026-09-02, "The Ledger" direction).
import { useEffect, useState } from 'react';
import { isOrgAdmin, useApp } from '../state/store.js';
import { useAuth } from '../hooks/useAuth.js';
import { platform } from '../lib/platform.js';
import { bridge } from '../lib/electronBridge.js';
import { tierById, priceLabel } from '../lib/plans.js';
import { clearInsights, insightsAsText, insightsCount } from '../lib/insights.js';
import { hapticTick } from '../lib/haptics.js';
import { BackBar } from '../components/BackBar.js';
import { SignInCard } from '../components/SignInCard.js';
import { InfoSheet } from '../components/InfoSheet.js';
import { Sheet } from '../components/Sheet.js';
import { Switch } from '../components/Switch.js';
import { SettingsGroup, SettingsRow } from '../components/SettingsRow.js';
import { SheetHead } from '../components/SheetHead.js';
import type { SearchBackend } from '../lib/webSearch.js';
import type { StackHealthSealFact } from 'os-code/protocol';

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
  } = useApp();
  const { configured, signedIn, email } = useAuth();
  const insightsOn = Boolean(settings.insightsOptIn);
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
              Harbor and Harbor Mini, and any model you run on this device, are AI. They can be
              confidently wrong, and OpenShore does not filter what a local model says. Neither is a
              coder. For real work, connect a bigger model. What you type to a local model stays on
              this device. Harbor is Qwen3-1.7B and Harbor Mini is Qwen2.5-0.5B-Instruct, both used
              under the Apache License 2.0.
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
