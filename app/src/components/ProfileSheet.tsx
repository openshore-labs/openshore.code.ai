// The profile sheet (2026-10-02): what the signed-in account button
// in the sidebar opens. Standard and short: who you are signed in as, what
// follows you between devices, privacy and help, then signing out and
// deleting the account. It reuses the same parts Settings does (the sign-in
// card, the delete flow), so the two never disagree.
// Held at the shell (App.tsx), opened through lib/profile.ts.
import { Sheet } from './Sheet.js';
import { SheetHead } from './SheetHead.js';
import { SignInCard } from './SignInCard.js';
import { DeleteAccount, SUPPORT_MAILTO } from './DeleteAccount.js';
import { SettingsGroup, SettingsRow } from './SettingsRow.js';
import { useApp } from '../state/store.js';
import { useAuth } from '../hooks/useAuth.js';
import { openExternal } from '../lib/platform.js';
import { SUPPORT_EMAIL } from 'os-code/protocol';
import { WhatLeavesSheet } from './WhatLeavesSheet.js';
import {
  FOLLOWS_GROUP_ID,
  accountInitial,
  followsLine,
  notCopiedLine,
  useProfileSheet,
  useSettingsJump,
} from '../lib/profile.js';

export function ProfileSheet() {
  const open = useProfileSheet((s) => s.open);
  const hide = useProfileSheet((s) => s.hide);
  const { signedIn, email } = useAuth();
  const setView = useApp((s) => s.setView);
  const deleteAccount = useApp((s) => s.deleteAccount);
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
        </span>
      </div>

      <div className="settings profile-body">
        <SettingsGroup title="On every device" index={0}>
          <SettingsRow
            label="Preferences that follow you"
            sub={followsLine()}
            onClick={toFollows}
          />
          {/* True on every platform (tech review, 2026-10-02): a desktop vault can sit
              in a synced folder and Repositories push to git hosts, so the
              claim is only about the account. And in every tier (privacy
              review, 2026-10-08): with teams on, it claims only the
              person's own, and names what a team keeps (lib/profile.ts). */}
          <SettingsRow label="Not copied to your account" sub={notCopiedLine()} />
        </SettingsGroup>

        <SettingsGroup title="Privacy and help" index={1}>
          <WhatLeavesSheet />
          <SettingsRow
            label="Contact support"
            sub={SUPPORT_EMAIL}
            onClick={() => void openExternal(SUPPORT_MAILTO)}
          />
        </SettingsGroup>

        <SettingsGroup title="Sign-in" index={2}>
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
