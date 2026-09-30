// What leaves this device (v1 Phase 2): a row, not a room, first under
// Settings, Privacy. It renders the one list the egress test reads
// (lib/egressManifest.ts), grouped by who receives it with OpenShore first,
// amber for what leaves and teal for what stays, so the words on screen and
// the code can never say different things.
import { InfoSheet } from './InfoSheet.js';
import { SettingsRow } from './SettingsRow.js';
import { STAYS_ON_DEVICE, egressByRecipient, type EgressEntry } from '../lib/egressManifest.js';
import { RELEASE_TIER } from '../lib/focus.js';
import { platform } from '../lib/platform.js';

const START_WORDS: Record<EgressEntry['start'], string> = {
  on: 'On by default',
  off: 'Off until you turn it on',
  tap: 'Only on your tap',
};

export function WhatLeavesSheet() {
  // This platform's list: the iPhone and iPad leave out the Stripe rail.
  const groups = egressByRecipient(RELEASE_TIER, platform());
  return (
    <InfoSheet
      title="What leaves this device"
      renderTrigger={(open) => (
        <SettingsRow
          label="What leaves this device"
          sub="Everything OpenShore sends, who gets it, and when"
          onClick={open}
        />
      )}
    >
      <p>
        Everything below is true of this version. If it is not on this list, it does not leave this
        device.
      </p>
      {groups.map((group) => (
        <section key={group.recipient} className="egress-group">
          <h3 className="settings-sheet-head">{group.recipient}</h3>
          <ul className="egress-list">
            {group.entries.map((e) => (
              <li key={e.id} className="egress-item cloud">
                <span className="egress-what">{e.what}</span>
                <span className="egress-when">
                  {e.when} {START_WORDS[e.start]}.
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className="egress-group">
        <h3 className="settings-sheet-head">Stays on this device</h3>
        <ul className="egress-list">
          {STAYS_ON_DEVICE.map((line) => (
            <li key={line} className="egress-item local">
              <span className="egress-what">{line}</span>
            </li>
          ))}
        </ul>
      </section>
    </InfoSheet>
  );
}
