// The profile sheet (founder, 2026-10-02): what the signed-in account button
// in the sidebar opens. Standard and short: who you are signed in as, your
// plan, what follows you between devices, privacy and help, then signing out
// and deleting the account. It reuses the same parts Settings does (the
// sign-in card, the delete flow, the plan rows), so the two never disagree;
// Settings keeps its Account group too, where App Review looks for Restore.
// Held at the shell (App.tsx), opened through lib/profile.ts.
import { Sheet } from './Sheet.js';
import { SheetHead } from './SheetHead.js';
import { SignInCard } from './SignInCard.js';
import { DeleteAccount, SUPPORT_MAILTO } from './DeleteAccount.js';
import { SettingsGroup, SettingsRow } from './SettingsRow.js';
import { useApp } from '../state/store.js';
import { useAuth } from '../hooks/useAuth.js';
import { PAY_GATES_ENABLED } from '../lib/payGate.js';
import { iapAvailable } from '../lib/iap.js';
import { openExternal } from '../lib/platform.js';
import { SUPPORT_EMAIL } from 'os-code/protocol';
import { WhatLeavesSheet } from './WhatLeavesSheet.js';
import {
  FOLLOWS_GROUP_ID,
  accountInitial,
  followsLine,
  planStanding,
  useProfileSheet,
  useSettingsJump,
} from '../lib/profile.js';

export function ProfileSheet() {
  const open = useProfileSheet((s) => s.open);
  const hide = useProfileSheet((s) => s.hide);
  const { signedIn, email } = useAuth();
  const setView = useApp((s) => s.setView);
  const openPaywall = useApp((s) => s.openPaywall);
  const restorePurchases = useApp((s) => s.restorePurchases);
  const recheckPersonal = useApp((s) => s.recheckPersonal);
  const manageSubscription = useApp((s) => s.manageSubscription);
  const deleteAccount = useApp((s) => s.deleteAccount);
  const unlocked = useApp((s) => s.personalUnlockedNow());
  const entitlement = useApp((s) => s.userEntitlement);

  const plan = planStanding({
    gates: PAY_GATES_ENABLED,
    unlocked,
    validUntil: entitlement?.validUntil,
  });
  const appleDevice = iapAvailable();
  const jump = useSettingsJump((s) => s.jump);
  // Lands Settings on the group the preferences that follow you start in.
  const toFollows = () => {
    jump(FOLLOWS_GROUP_ID);
    hide();
    setView('settings', { root: true });
  };

  return (
    <Sheet open={open && signedIn} onClose={hide} className="profile-sheet">
      <SheetHead title="Profile" onClose={hide} />
      <div className="profile-head">
        <span className="profile-avatar" aria-hidden="true">
          {accountInitial(email)}
        </span>
        <span className="profile-id">
          <span className="profile-name">{email}</span>
          {plan.short ? <span className="profile-plan">{plan.short}</span> : null}
        </span>
      </div>

      <div className="settings profile-body">
        {PAY_GATES_ENABLED ? (
          <SettingsGroup title="Plan" index={0}>
            <SettingsRow label="OpenShore Plus" sub={plan.sub} value={plan.value} />
            {PAY_GATES_ENABLED && !unlocked ? (
              <SettingsRow
                label="Get OpenShore Plus"
                sub="Opens Terminal, Repositories, Vault, Crew and Pairing."
                onClick={() => {
                  hide();
                  openPaywall('plus');
                }}
              />
            ) : null}
            {PAY_GATES_ENABLED && appleDevice ? (
              <SettingsRow
                label="Restore purchases"
                sub="Bought Plus already? Unlock it on this device."
                onClick={() => void restorePurchases()}
              />
            ) : null}
            {PAY_GATES_ENABLED && !appleDevice ? (
              <SettingsRow
                label="I already paid"
                sub="Bought Plus already? Check your account again."
                onClick={() => void recheckPersonal()}
              />
            ) : null}
            {PAY_GATES_ENABLED && entitlement ? (
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
        ) : null}

        <SettingsGroup title="On every device" index={1}>
          <SettingsRow
            label="Preferences that follow you"
            sub={followsLine()}
            onClick={toFollows}
          />
          {/* True on every platform (CTO, 2026-10-02): a desktop vault can sit
              in a synced folder and Repositories push to git hosts, so the
              claim is only about the account. */}
          <SettingsRow
            label="Not copied to your account"
            sub="OpenShore does not copy your chats, projects, keys, or vault to your account."
          />
        </SettingsGroup>

        <SettingsGroup title="Privacy and help" index={2}>
          <WhatLeavesSheet />
          <SettingsRow
            label="Contact support"
            sub={SUPPORT_EMAIL}
            onClick={() => void openExternal(SUPPORT_MAILTO)}
          />
        </SettingsGroup>

        <SettingsGroup title="Sign-in" index={3}>
          <div className="profile-signin">
            <SignInCard variant="profile" />
          </div>
        </SettingsGroup>
      </div>

      {/* Delete account (Apple 5.1.1(v)): last, as in Settings; its goodbye
          closes this sheet too. */}
      <DeleteAccount signedIn={signedIn} onDelete={deleteAccount} onDone={hide} />
    </Sheet>
  );
}
