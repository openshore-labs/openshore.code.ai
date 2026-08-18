// osc attach [<id>]: reattach to a session the daemon owns. No id picks the
// most recent. The transcript replays from the journal, so nothing that
// happened while you were away is missing.
import React from 'react';
import { render } from 'ink';
import { setColorEnabled, t } from '../brand/theme.js';
import { loadConfig } from '../config/load.js';
import {
  RemoteDriver,
  createRemoteSession,
  defaultTarget,
  listRemoteSessions,
} from '../daemon/attach.js';
import { App } from '../tui/app.js';
import { runPlain } from '../tui/plain.js';
import { okLine, out, warnLine } from './util.js';

export interface AttachOptions {
  id?: string;
  url?: string;
  token?: string;
  plain?: boolean;
  new?: boolean;
}

export async function attachCommand(options: AttachOptions): Promise<void> {
  const { config } = loadConfig();
  const base = defaultTarget(config.daemon.port);
  const target = {
    baseUrl: options.url ?? base.baseUrl,
    token: options.token ?? base.token,
  };

  let sessions;
  try {
    sessions = await listRemoteSessions(target);
  } catch (err) {
    warnLine(`${(err as Error).message}`);
    out(
      t.muted(
        'Start it on the desktop with: osc serve (or osc serve --bind tailscale for phone access).',
      ),
    );
    process.exitCode = 1;
    return;
  }

  let id = options.id;
  if (options.new || (!id && !sessions.live.length && !sessions.stored.length)) {
    id = await createRemoteSession(target, process.cwd());
    okLine(`Started session ${id}.`);
  }
  if (!id) {
    id = sessions.live[0]?.id ?? sessions.stored[0]?.id;
    if (!id) {
      warnLine('No sessions to attach to. osc attach --new starts one.');
      return;
    }
    const title = sessions.stored.find((s) => s.id === id)?.title;
    okLine(`Attaching to the latest session ${id}${title ? ` (${title})` : ''}.`);
  }

  const cwd =
    sessions.live.find((s) => s.id === id)?.cwd ?? sessions.stored.find((s) => s.id === id)?.cwd;
  const driver = new RemoteDriver(id, target, cwd ?? '(remote workspace)');

  const shared = {
    driver,
    stackDescription: 'remote session (the daemon owns the stack)',
  };
  if (options.plain || !process.stdout.isTTY) {
    setColorEnabled(process.stdout.isTTY ? undefined : false);
    await runPlain(shared);
    return;
  }
  const app = render(React.createElement(App, shared), { exitOnCtrlC: false });
  await app.waitUntilExit();
  driver.close();
}
