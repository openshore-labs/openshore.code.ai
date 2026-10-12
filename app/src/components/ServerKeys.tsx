// Keys on your server (2026-10-09; docs/design/byok-any-provider-plan.md,
// part 3), the room's half. Cloud Connections lists, under each docked server
// that keeps keys and takes this device as its admin, which provider keys it
// keeps and which model it runs; these are the two sheets those rows open,
// and the note shown when a key could not be deleted there. The server is
// the source of truth: it is read when the room opens, when either sheet
// opens, and after each change made there, and nothing about it is kept on
// this device. Pure choices and copy live in
// lib/serverKeys.ts, the wire in drivers/remoteDriver.ts, the lifecycle in
// state/serverKeysOps.ts. A member device, a computer and an older server
// see none of it.
import { useCallback, useEffect, useState } from 'react';
import type { DaemonProviderKey, DaemonStackInfo } from 'os-code/protocol';
import { useApp } from '../state/store.js';
import {
  daemonDeleteKey,
  daemonHealth,
  daemonListKeys,
  daemonPlaceOrchestrator,
  daemonStack,
  type DaemonTarget,
} from '../drivers/remoteDriver.js';
import { putKeyOnServer } from '../state/serverKeysOps.js';
import {
  SERVER_KEYS_HOLD,
  SERVER_KEYS_LEAD,
  SERVER_MODEL_LOCAL_ONLY,
  dockedModelLine,
  namesLine,
  serverKeyProviders,
  serverModelChoices,
  serverModelWindow,
  whereStartsSentence,
} from '../lib/serverKeys.js';
import {
  SERVER_KEY_LIST_COMMAND,
  serverKeyRemoveCommand,
  serverStackUseCommand,
} from '../lib/docking.js';
import type { ProviderInfo } from '../lib/providers.js';
import { Sheet } from './Sheet.js';
import { SheetHead } from './SheetHead.js';
import { SettingsGroup, SettingsRow } from './SettingsRow.js';
import { Switch } from './Switch.js';
import { CommandRow } from './ServerSetup.js';

/** What a server that keeps keys for this device keeps, as last read. */
export interface ServerKeysView {
  keys: DaemonProviderKey[] | 'checking' | 'error';
  stack: DaemonStackInfo | 'checking' | 'error';
}

/** The docked servers whose keys this device may see and change: each
 *  says it keeps keys (GET /health's keysOnServer) and answers this device
 *  as its admin. A server that does not answer, a member's device and an
 *  older server get no entry, so the room shows nothing new for them.
 *  `offersNone` names the servers that answered and offer this device no
 *  keys (an older server, a member's device), which can keep none of its. */
export function useServerKeys(servers: readonly DaemonTarget[]): {
  views: Record<string, ServerKeysView>;
  offersNone: Readonly<Record<string, true>>;
  refresh: (baseUrl: string) => Promise<void>;
} {
  const [views, setViews] = useState<Record<string, ServerKeysView>>({});
  const [offersNone, setOffersNone] = useState<Record<string, true>>({});
  const read = useCallback(async (server: DaemonTarget, live: () => boolean) => {
    const [keys, stack] = await Promise.all([
      daemonListKeys(server).catch(() => 'error' as const),
      daemonStack(server).catch(() => 'error' as const),
    ]);
    if (live()) setViews((v) => ({ ...v, [server.baseUrl]: { keys, stack } }));
  }, []);
  // Asked again only when the docked servers change, not on every render.
  const docked = servers.map((s) => `${s.baseUrl} ${s.token}`).join('\n');
  useEffect(() => {
    let live = true;
    setViews({});
    setOffersNone({});
    for (const server of servers) {
      void (async () => {
        const health = await daemonHealth(server);
        if (!live || !health.ok) return;
        if (!health.keysOnServer || health.role !== 'admin') {
          setOffersNone((n) => ({ ...n, [server.baseUrl]: true }));
          return;
        }
        setViews((v) => ({ ...v, [server.baseUrl]: { keys: 'checking', stack: 'checking' } }));
        await read(server, () => live);
      })();
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docked]);
  const refresh = useCallback(
    async (baseUrl: string) => {
      const server = servers.find((s) => s.baseUrl === baseUrl);
      if (server) await read(server, () => true);
    },
    [servers, read],
  );
  return { views, offersNone, refresh };
}

/** The keys row's line: what the server keeps, by name. */
export function keysRowSub(view: ServerKeysView): string {
  if (view.keys === 'checking') return 'Checking what it keeps...';
  if (view.keys === 'error') return 'Could not read what it keeps right now.';
  if (!view.keys.length) {
    return 'None yet. Turn one on, so its coding sessions can use it while this device sleeps.';
  }
  return `Keeps ${namesLine(view.keys.map((k) => k.label))}.`;
}

/** Where the server says a provider's key goes, for naming who gets its
 *  model's turns (dockedModelLine). Unknown until its keys are read. */
function keyHost(view: ServerKeysView, provider: string): string | undefined {
  return Array.isArray(view.keys) ? view.keys.find((k) => k.id === provider)?.host : undefined;
}

/** The model row's line: what the server runs, where, or how to choose. */
export function modelRowSub(view: ServerKeysView, where: string): string {
  if (view.stack === 'checking') return 'Checking...';
  if (view.stack === 'error') return 'Could not read its model right now.';
  const orchestrator = view.stack.orchestrator;
  if (orchestrator)
    return dockedModelLine(orchestrator, where, keyHost(view, orchestrator.provider));
  return Array.isArray(view.keys) && view.keys.length
    ? 'No model yet. Choose one from a provider it keeps a key for.'
    : 'No model yet. Turn on a provider key for it first, then choose one of its models.';
}

/** A question the keys sheet asks in place, before a delete: a key only the
 *  server keeps, or turning off the key the server's model runs on. */
type KeysQuestion =
  { kind: 'only'; key: DaemonProviderKey } | { kind: 'off'; provider: ProviderInfo; model: string };

/** Which keys a server keeps, and a switch for each of this device's
 *  providers it can take. The server says only which providers it keeps a
 *  key for, never whose key it is, so the rows say no more than that. A key
 *  it keeps for a provider this device has no key for can be removed, after
 *  a word. */
export function ServerKeysSheet({
  server,
  where,
  view,
  onChanged,
  onChooseModel,
  onClose,
}: {
  server?: DaemonTarget;
  where: string;
  view?: ServerKeysView;
  onChanged: () => Promise<void>;
  onChooseModel: () => void;
  onClose: () => void;
}) {
  const connectedProviders = useApp((s) => s.connectedProviders);
  const workspaceId = useApp((s) => s.settings.anthropicWorkspaceId);
  const showToast = useApp((s) => s.showToast);
  // The provider whose key is going on or off right now, and which way its
  // switch was turned, so the knob moves at the tap.
  const [busy, setBusy] = useState<{ id: string; on?: boolean } | undefined>();
  // A delete's question, while it is open.
  const [asking, setAsking] = useState<KeysQuestion | undefined>();
  const open = Boolean(server && view);
  useEffect(() => {
    if (!open) setAsking(undefined);
  }, [open]);

  const held = view && Array.isArray(view.keys) ? view.keys : [];
  const heldIds = new Set(held.map((k) => k.id));
  const offered = serverKeyProviders(connectedProviders);
  const offeredIds = new Set(offered.map((p) => p.id));
  const only = held.filter((k) => !offeredIds.has(k.id));
  const Where = whereStartsSentence(where);
  const orchestrator =
    view && view.stack !== 'checking' && view.stack !== 'error'
      ? view.stack.orchestrator
      : undefined;

  const turn = async (p: ProviderInfo, on: boolean) => {
    if (!server || busy) return;
    setAsking(undefined);
    setBusy({ id: p.id, on });
    try {
      if (on) {
        await putKeyOnServer(server, p, workspaceId);
        showToast(`${p.name} key kept on ${where}.`);
      } else {
        const gone = await daemonDeleteKey(server, p.id);
        showToast(
          gone.slotsCleared.includes('orchestrator')
            ? `${p.name} key deleted from ${where}. Its model ran on it, so choose another.`
            : `${p.name} key deleted from ${where}.`,
        );
      }
      await onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : `Could not change the keys on ${where}.`);
    } finally {
      setBusy(undefined);
    }
  };

  // Turning off the key the server's model runs on stops that model, so it
  // asks first, as deleting a key only the server keeps does.
  const switchTo = (p: ProviderInfo, on: boolean) => {
    if (!on && orchestrator?.provider === p.id) {
      setAsking({ kind: 'off', provider: p, model: orchestrator.model });
      return;
    }
    void turn(p, on);
  };

  const remove = async (key: DaemonProviderKey) => {
    if (!server || busy) return;
    setAsking(undefined);
    setBusy({ id: key.id });
    try {
      await daemonDeleteKey(server, key.id);
      showToast(`${key.label} key deleted from ${where}.`);
      await onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : `Could not change the keys on ${where}.`);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Sheet open={open} onClose={onClose}>
      {server && view ? (
        asking?.kind === 'only' ? (
          <>
            <SheetHead title={`Delete the ${asking.key.label} key?`} onClose={onClose} />
            <p className="sheet-sub">
              It is deleted from {where}, and its coding sessions stop using it.
              {orchestrator?.provider === asking.key.id
                ? ` Its model, ${orchestrator.model}, runs on it, so the server has none until you choose another.`
                : ''}{' '}
              This device has no key for it, so putting it back means adding it again over SSH, or
              from a device that has one.
            </p>
            <div className="confirm-row">
              <button
                type="button"
                className="btn ghost press-fb"
                onClick={() => setAsking(undefined)}
              >
                Keep
              </button>
              <button
                type="button"
                className="btn danger press-fb"
                onClick={() => void remove(asking.key)}
              >
                Delete
              </button>
            </div>
          </>
        ) : asking?.kind === 'off' ? (
          <>
            <SheetHead
              title={`Delete the ${asking.provider.name} key from ${where}?`}
              onClose={onClose}
            />
            <p className="sheet-sub">
              The model on {where}, {asking.model}, runs on it, so the server has none until you
              choose another. The key stays on this device.
            </p>
            <div className="confirm-row">
              <button
                type="button"
                className="btn ghost press-fb"
                onClick={() => setAsking(undefined)}
              >
                Keep
              </button>
              <button
                type="button"
                className="btn danger press-fb"
                onClick={() => void turn(asking.provider, false)}
              >
                Delete
              </button>
            </div>
          </>
        ) : (
          <>
            <SheetHead title={`Keys on ${where}`} onClose={onClose} />
            <p className="sheet-sub">{SERVER_KEYS_LEAD}</p>
            <p className="hint">{SERVER_KEYS_HOLD}</p>
            {view.keys === 'checking' ? (
              <p className="hint" role="status">
                Checking what {where} keeps...
              </p>
            ) : view.keys === 'error' ? (
              <p className="hint" role="status">
                Could not read what {where} keeps right now. Check that it is running and on
                Tailscale.
              </p>
            ) : (
              <div className="settings">
                <SettingsGroup title="From this device" index={0}>
                  {offered.length ? (
                    offered.map((p) => {
                      const on = heldIds.has(p.id);
                      // The tapped switch shows where it is going while the
                      // server answers; a refusal puts it back.
                      const shown = busy?.id === p.id && busy.on !== undefined ? busy.on : on;
                      return (
                        <SettingsRow
                          key={p.id}
                          label={p.name}
                          sub={on ? `${Where} keeps a ${p.name} key.` : 'Only on this device.'}
                          trailing={
                            <Switch
                              checked={shown}
                              disabled={busy !== undefined}
                              label={`Keep the ${p.name} key on ${where}`}
                              onChange={(next) => switchTo(p, next)}
                            />
                          }
                        />
                      );
                    })
                  ) : (
                    <SettingsRow
                      label="No provider connected here"
                      sub={`Connect one under Cloud providers first. Its key can then go to ${where} too.`}
                    />
                  )}
                </SettingsGroup>
                {only.length ? (
                  <SettingsGroup title={`Only on ${where}`} index={1}>
                    {only.map((k) => (
                      <SettingsRow
                        key={k.id}
                        label={k.label}
                        sub={
                          k.host
                            ? `${Where} keeps it; this device has no key for it. It goes to ${k.host}.`
                            : `${Where} keeps it; this device has no key for it.`
                        }
                        trailing={
                          <button
                            type="button"
                            className="btn ghost sm press-fb"
                            disabled={busy !== undefined}
                            aria-label={`Delete the ${k.label} key from ${where}`}
                            onClick={() => setAsking({ kind: 'only', key: k })}
                          >
                            Delete
                          </button>
                        }
                      />
                    ))}
                  </SettingsGroup>
                ) : null}
                <SettingsGroup index={2}>
                  <SettingsRow
                    label="Its model"
                    sub={modelRowSub(view, where)}
                    onClick={onChooseModel}
                  />
                </SettingsGroup>
              </div>
            )}
          </>
        )
      ) : null}
    </Sheet>
  );
}

/** Choosing the server's model from the models this device knows for a
 *  provider it keeps a key for. The window this device knows goes with it.
 *  Every model offered here is a cloud model, so placing one over a local
 *  model asks first: Crew routines and Chat with your server stop while it
 *  is there, and the local one goes back only over SSH. */
export function ServerModelSheet({
  server,
  where,
  view,
  onChanged,
  onClose,
}: {
  server?: DaemonTarget;
  where: string;
  view?: ServerKeysView;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const showToast = useApp((s) => s.showToast);
  const [placing, setPlacing] = useState<string | undefined>();
  // A cloud model picked over the local one, while its question is open.
  const [asking, setAsking] = useState<{ provider: string; model: string; label: string }>();
  const open = Boolean(server && view);
  useEffect(() => {
    if (!open) setAsking(undefined);
  }, [open]);
  const held = view && Array.isArray(view.keys) ? view.keys : [];
  const choices = serverModelChoices(held.map((k) => k.id));
  const known = new Set(choices.map((c) => c.provider));
  // A provider the server keeps a key for whose models this device does not
  // know (a live provider not connected here, a name only the server has).
  const unknown = held.filter((k) => !known.has(k.id));
  const current =
    view && view.stack !== 'checking' && view.stack !== 'error'
      ? view.stack.orchestrator
      : undefined;
  const currentLine =
    current && view ? dockedModelLine(current, where, keyHost(view, current.provider)) : '';

  const place = async (provider: string, model: string, label: string) => {
    if (!server || placing) return;
    setAsking(undefined);
    setPlacing(`${provider}:${model}`);
    try {
      const contextTokens = serverModelWindow(provider, model);
      await daemonPlaceOrchestrator(server, {
        provider,
        model,
        ...(contextTokens ? { contextTokens } : {}),
      });
      await onChanged();
      showToast(`${label} is the model on ${where} now.`);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : `Could not change the model on ${where}.`);
    } finally {
      setPlacing(undefined);
    }
  };

  const pick = (provider: string, model: string, label: string) => {
    if (current && current.kind !== 'cloud') {
      setAsking({ provider, model, label });
      return;
    }
    void place(provider, model, label);
  };

  return (
    <Sheet open={open} onClose={onClose}>
      {server && view ? (
        asking && current ? (
          <>
            <SheetHead title={`Make ${asking.label} the model on ${where}?`} onClose={onClose} />
            <p className="sheet-sub">
              {current.model} runs on {where} now. {SERVER_MODEL_LOCAL_ONLY} To put {current.model}{' '}
              back, run this over SSH:
            </p>
            <CommandRow
              command={serverStackUseCommand(current.provider, current.model, 'served')}
              label={`Copy the command that puts ${current.model} back`}
            />
            <div className="confirm-row">
              <button
                type="button"
                className="btn ghost press-fb"
                onClick={() => setAsking(undefined)}
              >
                Keep
              </button>
              <button
                type="button"
                className="btn primary press-fb"
                onClick={() => void place(asking.provider, asking.model, asking.label)}
              >
                Use {asking.label}
              </button>
            </div>
          </>
        ) : (
          <>
            <SheetHead title={`Model on ${where}`} onClose={onClose} />
            <p className="sheet-sub">
              {view.stack === 'checking'
                ? `Checking the model on ${where}...`
                : view.stack === 'error'
                  ? `Could not read the model on ${where} right now.`
                  : current
                    ? current.kind === 'cloud'
                      ? `${currentLine}. Its coding sessions ask first in each task.`
                      : `${currentLine}.`
                    : `No model on ${where} yet. Choose one of the models this device knows for a provider it keeps a key for.`}
            </p>
            {view.keys === 'checking' ? (
              <p className="hint" role="status">
                Checking what {where} keeps...
              </p>
            ) : view.keys === 'error' ? (
              <p className="hint" role="status">
                Could not read what {where} keeps right now. Check that it is running and on
                Tailscale.
              </p>
            ) : choices.length ? (
              <>
                <p className="hint">{SERVER_MODEL_LOCAL_ONLY}</p>
                <div className="settings">
                  {choices.map((c, i) => (
                    <SettingsGroup key={c.provider} title={c.name} index={i}>
                      {c.models.map((m) => {
                        const now = current?.provider === c.provider && current.model === m.id;
                        const going = placing === `${c.provider}:${m.id}`;
                        return (
                          <SettingsRow
                            key={m.id}
                            label={m.label}
                            sub={going ? 'Placing...' : m.id === m.label ? undefined : m.id}
                            value={now ? <span className="pill ink">Current</span> : undefined}
                            disabled={placing !== undefined}
                            onClick={now ? undefined : () => pick(c.provider, m.id, m.label)}
                          />
                        );
                      })}
                    </SettingsGroup>
                  ))}
                </div>
              </>
            ) : held.length ? null : (
              <p className="hint" role="status">
                {whereStartsSentence(where)} keeps no provider key yet. Turn one on under Keys on{' '}
                {where}, then choose one of its models here.
              </p>
            )}
            {unknown.length ? (
              <>
                <p className="hint">
                  For {namesLine(unknown.map((k) => k.label))}, this device knows no models. Choose
                  one over SSH, as the server&apos;s account, with the window its model page lists:
                </p>
                <CommandRow
                  command={serverStackUseCommand(
                    unknown.length === 1 ? unknown[0]!.id : '<provider>',
                  )}
                  label="Copy the command that chooses a model"
                />
              </>
            ) : null}
          </>
        )
      ) : null}
    </Sheet>
  );
}

/** A key a server may still keep, because it could not be deleted there
 *  (the server did not answer, or would not delete it): said plainly, with
 *  the commands that delete it over SSH. */
export interface KeysLeft {
  /** The server, named in a sentence. */
  where: string;
  /** The one provider whose key may be left, when a disconnect left it. */
  provider?: { id: string; name: string };
}

export function ServerKeysLeftSheet({ left, onClose }: { left?: KeysLeft; onClose: () => void }) {
  return (
    <Sheet open={Boolean(left)} onClose={onClose}>
      {left ? (
        <>
          <SheetHead
            title={
              left.provider
                ? `The ${left.provider.name} key may still be on ${left.where}`
                : `Keys may stay on ${left.where}`
            }
            onClose={onClose}
          />
          {left.provider ? (
            <>
              <p className="sheet-sub">
                OpenShore could not delete the {left.provider.name} key on {left.where}, if it keeps
                one. It stays there until you delete it over SSH:
              </p>
              <CommandRow
                command={serverKeyRemoveCommand(left.provider.id)}
                label="Copy the command that deletes the key"
              />
            </>
          ) : (
            <>
              <p className="sheet-sub">
                OpenShore could not delete the provider keys {left.where} may keep. They stay there
                until you delete them over SSH. List them, then delete each by its name:
              </p>
              <CommandRow
                command={SERVER_KEY_LIST_COMMAND}
                label="Copy the command that lists keys"
              />
              <CommandRow
                command={serverKeyRemoveCommand('<provider>')}
                label="Copy the command that deletes a key"
              />
            </>
          )}
        </>
      ) : null}
    </Sheet>
  );
}
