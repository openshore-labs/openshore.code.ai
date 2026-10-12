// App Lock's row, first in Settings, Privacy (CX ruling Q3, 2026-10-12). Off by
// default and needs no account. Turning it on or off, or changing the time,
// each takes one unlock (store.setAppLock). A device with no passcode cannot
// lock, so the row says so and stays off. iPhone and iPad only for now: the
// row is not drawn anywhere else (lib/appLock.ts says why).
import { useEffect, useState } from 'react';
import { useApp } from '../state/store.js';
import { SettingsRow } from './SettingsRow.js';
import { Switch } from './Switch.js';
import { thisDeviceNoun } from '../lib/deviceNoun.js';
import {
  APP_LOCK_LABEL,
  DEFAULT_LOCK_AFTER,
  LOCK_AFTER_CHOICES,
  appLockStatus,
  appLockSub,
  lockAfterLabel,
  noPasscodeSub,
  type Biometry,
} from '../lib/appLock.js';
import { platform } from '../lib/platform.js';

export function AppLockRow() {
  const setting = useApp((s) => s.settings.appLock);
  const setAppLock = useApp((s) => s.setAppLock);
  const [status, setStatus] = useState<{ available: boolean; biometry: Biometry }>();
  const ios = platform() === 'ios';
  useEffect(() => {
    if (ios) void appLockStatus().then(setStatus);
  }, [ios]);
  if (!ios || !status) return null;

  const on = setting?.on === true;
  const after = setting?.after ?? DEFAULT_LOCK_AFTER;
  const device = thisDeviceNoun();
  return (
    <>
      <SettingsRow
        label={APP_LOCK_LABEL}
        sub={status.available ? appLockSub(status.biometry, device) : noPasscodeSub(device)}
        disabled={!status.available}
        trailing={
          <Switch
            checked={on}
            label={APP_LOCK_LABEL}
            disabled={!status.available}
            onChange={(next) => void setAppLock({ on: next, after })}
          />
        }
      />
      {on ? (
        <div className="segmented app-lock-after" role="radiogroup" aria-label="Lock after">
          {LOCK_AFTER_CHOICES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={after === c}
              className={`seg press-fb${after === c ? ' active' : ''}`}
              onClick={() => {
                if (c !== after) void setAppLock({ on: true, after: c });
              }}
            >
              {lockAfterLabel(c)}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
