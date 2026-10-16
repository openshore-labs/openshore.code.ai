// Settings, Chats, iCloud Backup (founder, 2026-10-16): on the iPhone and the
// iPad, the Vault and Chats folders are plain files, and the device's backup
// would carry them to Apple. Off by default, so they stay in the closed loop
// (this device, your other devices, your computer). Turning it on asks first,
// in a confirm sheet that says plainly what leaves; closing the sheet keeps it
// off. Turning it off needs no question.
import { useState } from 'react';
import { Sheet } from './Sheet.js';
import { Switch } from './Switch.js';
import { SettingsRow } from './SettingsRow.js';

export function phoneBackupCopy(device: string) {
  return {
    label: 'Include notes and chats in iCloud Backup',
    offSub: `Off: your notes and chats stay on ${device}, your other devices and your computer, and never go to Apple's backups.`,
    onSub: `On: ${device}'s iCloud Backup carries your notes and chats to Apple as plain files.`,
    askTitle: 'Leave the closed loop?',
    askBody:
      "Your notes, private ones included, and your chats would go to Apple's iCloud Backup as plain files. That leaves the closed loop OpenShore keeps them in: this device, your other devices and your computer. Apple, not OpenShore, then holds a copy.",
    keepOut: 'Keep them out',
    include: 'Include them',
    onToast: 'Your notes and chats now go into iCloud Backup.',
    offToast: 'Your notes and chats are kept out of iCloud Backup.',
  } as const;
}

export function PhoneBackupRow({
  device,
  on,
  onSet,
  toast,
}: {
  /** The device in hand (lib/deviceNoun.ts thisDeviceNoun). */
  device: string;
  on: boolean;
  onSet: (on: boolean) => Promise<void> | void;
  toast: (text: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const c = phoneBackupCopy(device);
  const close = () => setAsking(false);
  return (
    <>
      <SettingsRow
        label={c.label}
        sub={on ? c.onSub : c.offSub}
        trailing={
          <Switch
            checked={on}
            label={c.label}
            onChange={(next) => {
              if (next) {
                setAsking(true);
              } else {
                void onSet(false);
                toast(c.offToast);
              }
            }}
          />
        }
      />
      <Sheet open={asking} onClose={close} variant="confirm">
        <h3>{c.askTitle}</h3>
        <p>{c.askBody}</p>
        <div className="confirm-row">
          <button type="button" className="btn ghost" onClick={close}>
            {c.keepOut}
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              close();
              void onSet(true);
              toast(c.onToast);
            }}
          >
            {c.include}
          </button>
        </div>
      </Sheet>
    </>
  );
}
