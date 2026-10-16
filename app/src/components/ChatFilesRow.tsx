// Settings, Chats, Save chats as files (founder, 2026-10-16): each chat is
// also one markdown file in OpenShore/Chats on this device, on by default.
// Turning it off asks first, in a confirm sheet, whether the files already
// written go too; nothing is removed without that answer, and closing the
// sheet keeps the switch on.
import { useState } from 'react';
import { Sheet } from './Sheet.js';
import { Switch } from './Switch.js';
import { SettingsRow } from './SettingsRow.js';

export const CHAT_FILES_COPY = {
  label: 'Save chats as files',
  offTitle: 'Stop saving chats as files?',
  offBody:
    'Your chats stay in OpenShore either way. The files already in OpenShore/Chats can stay where they are, or be removed now.',
  keep: 'Keep the files',
  remove: 'Remove the files',
  onToast: 'Saving chats as files.',
  keptToast: 'Chats are no longer saved as files. The files you have stay.',
  removedToast: 'Chats are no longer saved as files, and their files are removed.',
} as const;

export function ChatFilesRow({
  where,
  on,
  onSet,
  toast,
}: {
  /** Where the files go on this device (lib/chatFiles.ts chatFilesWhere). */
  where: string;
  on: boolean;
  onSet: (on: boolean, opts?: { removeFiles?: boolean }) => Promise<void> | void;
  toast: (text: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const c = CHAT_FILES_COPY;
  const close = () => setAsking(false);
  return (
    <>
      <SettingsRow
        label={c.label}
        sub={where}
        trailing={
          <Switch
            checked={on}
            label={c.label}
            onChange={(next) => {
              if (next) {
                void onSet(true);
                toast(c.onToast);
              } else {
                setAsking(true);
              }
            }}
          />
        }
      />
      <Sheet open={asking} onClose={close} variant="confirm">
        <h3>{c.offTitle}</h3>
        <p>{c.offBody}</p>
        <div className="confirm-row">
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              close();
              void onSet(false);
              toast(c.keptToast);
            }}
          >
            {c.keep}
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              close();
              void onSet(false, { removeFiles: true });
              toast(c.removedToast);
            }}
          >
            {c.remove}
          </button>
        </div>
      </Sheet>
    </>
  );
}
