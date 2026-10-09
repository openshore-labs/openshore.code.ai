// Keys on your server (founder, 2026-10-09; docs/byok-any-provider-plan.md,
// part 3), the room's half. Cloud Connections lists, under each docked server
// that keeps keys and takes this device as its admin, which provider keys it
// keeps and which model it runs; these are the two sheets those rows open,
// and the note shown when a server could not be reached to delete a key.
// The server is the source of truth: each sheet reads it when it opens, and
// nothing about it is kept on this device. Pure choices and copy live in
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
  dockedModelLine,
  namesLine,
  serverKeyProviders,
  serverModelChoices,
  serverModelWindow,
} from '../lib/serverKeys.js';
import { SERVER_KEY_LIST_COMMAND, serverKeyRemoveCommand } from '../lib/docking.js';
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
 *  older server get no entry, so the room shows nothing new for them. */
export function useServerKeys(servers: readonly DaemonTarget[]): {
  views: Record<string, ServerKeysView>;
  refresh: (baseUrl: string) => Promise<void>;
} {
  const [views, setViews] = useState<Record<string, ServerKeysView>>({});
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
    for (const server of servers) {
      void (async () => {
        const health = await daemonHealth(server);
        if (!live || !health.ok || !health.keysOnServer || health.role !== 'admin') return;
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
  return { views, refresh };
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

/** The model row's line: what the server runs, where, or how to choose. */
export function modelRowSub(view: ServerKeysView, where: string): string {
  if (view.stack === 'checking') return 'Checking...';
  if (view.stack === 'error') return 'Could not read its model right now.';
  if (view.stack.orchestrator) return dockedModelLine(view.stack.orchestrator, where);
  return Array.isArray(view.keys) && view.keys.length
    ? 'No model yet. Choose one from a provider it keeps a key for.'
    : 'No model yet. Turn on a provider key for it first, then choose one of its models.';
}

/** Which keys a server keeps, and a switch for each of this device's
 *  providers it can take. A key it keeps that this device does not hold
 *  (added over SSH, or from another device) can be removed, after a word. */
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
  // The provider whose key is going on or off right now.
  const [busy, setBusy] = useState<string | undefined>();
  // A key only the server holds, while its question is open.
  const [confirming, setConfirming] = useState<DaemonProviderKey | undefined>();
  const open = Boolean(server && view);
  useEffect(() => {
    if (!open) setConfirming(undefined);
  }, [open]);

  const held = view && Array.isArray(view.keys) ? view.keys : [];
  const heldIds = new Set(held.map((k) => k.id));
  const offered = serverKeyProviders(connectedProviders);
  const offeredIds = new Set(offered.map((p) => p.id));
  const only = held.filter((k) => !offeredIds.has(k.id));

  const turn = async (p: ProviderInfo, on: boolean) => {
    if (!server || busy) return;
    setBusy(p.id);
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

  const remove = async (key: DaemonProviderKey) => {
    if (!server || busy) return;
    setConfirming(undefined);
    setBusy(key.id);
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

  const orchestrator =
    view && view.stack !== 'checking' && view.stack !== 'error'
      ? view.stack.orchestrator
      : undefined;

  return (
    <Sheet open={open} onClose={onClose}>
      {server && view ? (
        confirming ? (
          <>
            <SheetHead title={`Delete the ${confirming.label} key?`} onClose={onClose} />
            <p className="sheet-sub">
              It is deleted from {where}, and its coding sessions stop using it.
              {orchestrator?.provider === confirming.id
                ? ` Its model, ${orchestrator.model}, runs on it, so the server has none until you choose another.`
                : ''}{' '}
              This device does not hold it, so putting it back means adding it over SSH again.
            </p>
            <div className="confirm-row">
              <button
                type="button"
                className="btn ghost press-fb"
                onClick={() => setConfirming(undefined)}
              >
                Keep
              </button>
              <button
                type="button"
                className="btn danger press-fb"
                onClick={() => void remove(confirming)}
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
                      return (
                        <SettingsRow
                          key={p.id}
                          label={p.name}
                          sub={on ? `Kept on ${where} too.` : 'Only on this device.'}
                          trailing={
                            <Switch
                              checked={on}
                              disabled={busy !== undefined}
                              label={`Keep the ${p.name} key on ${where}`}
                              onChange={(next) => void turn(p, next)}
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
                            ? `Added there, not from this device. It goes to ${k.host}.`
                            : 'Added there, not from this device.'
                        }
                        trailing={
                          <button
                            type="button"
                            className="btn ghost sm press-fb"
                            disabled={busy !== undefined}
                            onClick={() => setConfirming(k)}
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
 *  provider it keeps a key for. The window this device knows goes with it. */
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
  const held = view && Array.isArray(view.keys) ? view.keys : [];
  const choices = serverModelChoices(held.map((k) => k.id));
  const known = new Set(choices.map((c) => c.provider));
  // A provider the server keeps a key for whose models this device does not
  // know (a live provider not connected here, a name only the server has).
  const unknown = held.filter((k) => !known.has(k.id)).map((k) => k.label);
  const current =
    view && view.stack !== 'checking' && view.stack !== 'error'
      ? view.stack.orchestrator
      : undefined;

  const place = async (provider: string, model: string, label: string) => {
    if (!server || placing) return;
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

  return (
    <Sheet open={Boolean(server && view)} onClose={onClose}>
      {server && view ? (
        <>
          <SheetHead title={`Model on ${where}`} onClose={onClose} />
          <p className="sheet-sub">
            {view.stack === 'checking'
              ? `Checking the model on ${where}...`
              : view.stack === 'error'
                ? `Could not read the model on ${where} right now.`
                : current
                  ? current.kind === 'cloud'
                    ? `${dockedModelLine(current, where)}. Its coding sessions ask first in each task.`
                    : `${dockedModelLine(current, where)}.`
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
            <div className="settings">
              {choices.map((c, i) => (
                <SettingsGroup key={c.provider} title={c.name} index={i}>
                  {c.models.map((m) => {
                    const now = current?.provider === c.provider && current.model === m.id;
                    return (
                      <SettingsRow
                        key={m.id}
                        label={m.label}
                        sub={m.id === m.label ? undefined : m.id}
                        value={now ? <span className="pill ink">Current</span> : undefined}
                        disabled={placing !== undefined}
                        onClick={now ? undefined : () => void place(c.provider, m.id, m.label)}
                      />
                    );
                  })}
                </SettingsGroup>
              ))}
            </div>
          ) : held.length ? null : (
            <p className="hint" role="status">
              {capital(where)} keeps no provider key yet. Turn one on under Keys on {where}, then
              choose one of its models here.
            </p>
          )}
          {unknown.length ? (
            <p className="hint">
              For {namesLine(unknown)}, this device knows no models. Choose one over SSH with osc
              stack use.
            </p>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}

/** "your server" at the start of a sentence. */
function capital(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** A key a server may still keep, because it could not be reached to delete
 *  it: said plainly, with the commands that delete it over SSH. */
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
                ? `Its key may still be on ${left.where}`
                : `Keys may stay on ${left.where}`
            }
            onClose={onClose}
          />
          {left.provider ? (
            <>
              <p className="sheet-sub">
                OpenShore could not reach {left.where} to delete its {left.provider.name} key, if it
                keeps one. It stays there until you delete it over SSH:
              </p>
              <CommandRow
                command={serverKeyRemoveCommand(left.provider.id)}
                label="Copy the command that deletes the key"
              />
            </>
          ) : (
            <>
              <p className="sheet-sub">
                OpenShore could not reach {left.where} to delete the provider keys it may keep. They
                stay there until you delete them over SSH. List them, then delete each by its name:
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
