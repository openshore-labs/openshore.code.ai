// Passkeys in the Your account sheet (CX ruling Q2, 2026-10-12). Drawn only
// where a passkey can really be made (the founder's VITE_PASSKEYS flag, an
// iPhone or iPad, the plugin saying yes). Never a prompt right after an email
// sign-in: one offer card here, whose "Not now" is final on this device, and a
// list that stays put either way. Adding one needs an email sign-in in the
// last 10 minutes (0031's step-up trigger); past that, a fresh code first.
import { useCallback, useEffect, useId, useState } from 'react';
import { useApp } from '../state/store.js';
import { Sheet } from './Sheet.js';
import {
  CONFIRM_FIRST,
  CREATE_PASSKEY,
  NOT_NOW,
  PASSKEYS_TITLE,
  PASSKEY_ADDED,
  PASSKEY_EXPLAINER,
  PASSKEY_OFFER_TITLE,
  PASSKEY_REMOVED,
  REMOVE_PASSKEY_BODY,
  REMOVE_PASSKEY_TITLE,
  passkeyLine,
  passkeyProblem,
  passkeysAvailable,
  type Passkey,
} from '../lib/passkeys.js';
import { CODE_LABEL, CODE_LENGTH, codeDigits } from '../state/emailSignInOps.js';
import { plainError } from '../lib/plainError.js';

export function PasskeysSection() {
  const app = useApp();
  const { showToast, settings, saveSettings, authSession } = app;
  const [available, setAvailable] = useState(false);
  const [keys, setKeys] = useState<Passkey[]>();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string>();
  const [removing, setRemoving] = useState<Passkey>();
  const fieldId = useId();

  const refresh = useCallback(async () => {
    try {
      setKeys(await useApp.getState().listPasskeys());
    } catch {
      setKeys([]);
    }
  }, []);

  useEffect(() => {
    void passkeysAvailable().then((ok) => {
      setAvailable(ok);
      if (ok) void refresh();
    });
  }, [refresh]);

  if (!available || !keys) return null;

  const create = async () => {
    setBusy(true);
    setProblem(undefined);
    try {
      const done = await useApp.getState().addPasskey();
      if (done === 'confirm') {
        await useApp.getState().sendSignInEmail(authSession?.user.email ?? '');
        setConfirming(true);
        return;
      }
      showToast(PASSKEY_ADDED);
      await refresh();
    } catch (err) {
      setProblem(passkeyProblem(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (typed: string) => {
    if (busy || !codeDigits(typed)) return;
    setBusy(true);
    setProblem(undefined);
    try {
      await useApp.getState().confirmByCode(typed);
      setConfirming(false);
      setCode('');
    } catch (err) {
      setCode('');
      setProblem(err instanceof Error ? err.message : plainError(err));
      setBusy(false);
      return;
    }
    setBusy(false);
    await create();
  };

  const offer = keys.length === 0 && !settings.passkeyOfferDismissed;

  return (
    <div className="passkeys">
      {offer ? (
        <div className="card">
          <h3>{PASSKEY_OFFER_TITLE}</h3>
          <p className="sub">{PASSKEY_EXPLAINER}</p>
          <div className="confirm-row">
            <button
              type="button"
              className="btn ghost press-fb"
              disabled={busy}
              onClick={() => void saveSettings({ passkeyOfferDismissed: true })}
            >
              {NOT_NOW}
            </button>
            <button
              type="button"
              className="btn primary press-fb"
              disabled={busy}
              onClick={() => void create()}
            >
              {CREATE_PASSKEY}
            </button>
          </div>
        </div>
      ) : null}
      {confirming ? (
        <div className="card">
          <p className="sub">{CONFIRM_FIRST}</p>
          <div className="field">
            <label htmlFor={`${fieldId}-code`}>{CODE_LABEL}</label>
            <input
              id={`${fieldId}-code`}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={CODE_LENGTH + 2}
              value={code}
              disabled={busy}
              onChange={(e) => {
                setCode(e.target.value);
                if (codeDigits(e.target.value)) void confirm(e.target.value);
              }}
            />
          </div>
        </div>
      ) : null}
      {problem ? (
        <p className="hint sign-in-problem" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="card">
        <h3>{PASSKEYS_TITLE}</h3>
        {!offer ? <p className="sub">{PASSKEY_EXPLAINER}</p> : null}
        {keys.map((k) => (
          <div className="card-row" key={k.id}>
            <div className="grow">
              <div>{k.name}</div>
              <div className="sub">{passkeyLine(k)}</div>
            </div>
            <button
              type="button"
              className="btn ghost sm press-fb"
              disabled={busy}
              onClick={() => setRemoving(k)}
            >
              Remove
            </button>
          </div>
        ))}
        {!offer ? (
          <button
            type="button"
            className="btn ghost block press-fb"
            disabled={busy || confirming}
            onClick={() => void create()}
          >
            {CREATE_PASSKEY}
          </button>
        ) : null}
      </div>
      <Sheet open={Boolean(removing)} onClose={() => setRemoving(undefined)} variant="confirm">
        {removing ? (
          <>
            <h3>{REMOVE_PASSKEY_TITLE}</h3>
            <p>{REMOVE_PASSKEY_BODY}</p>
            <div className="confirm-row">
              <button
                type="button"
                className="btn ghost press-fb"
                onClick={() => setRemoving(undefined)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn danger press-fb"
                onClick={() => {
                  const id = removing.id;
                  setRemoving(undefined);
                  void (async () => {
                    try {
                      await useApp.getState().removePasskey(id);
                      showToast(PASSKEY_REMOVED);
                      await refresh();
                    } catch (err) {
                      setProblem(passkeyProblem(err));
                    }
                  })();
                }}
              >
                Remove
              </button>
            </div>
          </>
        ) : null}
      </Sheet>
    </div>
  );
}
