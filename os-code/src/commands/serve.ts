// osc serve: run the daemon. It owns the generation so phones can come and
// go; it binds loopback or the tailnet interface only.
import { banner, t } from '../brand/theme.js';
import { loadConfig, loadDaemonConfig } from '../config/load.js';
import { ensureOpenshoreFolder } from '../config/openshoreFolder.js';
import { startDaemon } from '../daemon/serve.js';
import { installProcessGuards } from '../daemon/processGuard.js';
import { okLine, out, warnLine } from './util.js';

export interface ServeOptions {
  bind?: 'loopback' | 'tailscale';
  port?: number;
}

export async function serveCommand(options: ServeOptions): Promise<void> {
  const { config } = loadConfig();
  ensureOpenshoreFolder();
  // The daemon's own bind and port are machine config, read from the global
  // file alone (DAE-9): a project file in the cwd cannot move the listener.
  const daemon = loadDaemonConfig();
  const bind = options.bind ?? daemon.bind;
  const port = options.port ?? daemon.port;

  out(banner('osc serve'));
  // One stray rejection must not take the daemon, and every paired phone's
  // session, down with it (H1): log it, tell the working sessions, stay up.
  installProcessGuards({
    where: 'osc serve',
    onFault: (kind) => warnLine(`Caught a stray ${kind}; the daemon kept running. See its log.`),
  });
  try {
    // Run on its own, this is a server: a phone docks with `osc pair --server`
    // in another terminal, where the person says yes to it.
    const daemon = await startDaemon({ config, bind, port, pairingConsole: true, kind: 'server' });
    okLine(`Daemon up on ${daemon.host}:${daemon.port} (${bind}).`);
    okLine('Auth: the bearer token at ~/.os-code/daemon.token (mode 600).');
    out(
      t.muted(
        `  Dock a phone: run ${t.local('osc pair --server')} in another terminal and scan its code.`,
      ),
    );
    out(t.muted('  From a phone over the tailnet: ssh in, then osc attach.'));
    out(t.muted('  Ctrl+C stops the daemon; stored sessions survive and reattach later.'));
    const shutdown = () => {
      out(t.muted('\nStopping the daemon. Sessions are journaled; osc attach picks them back up.'));
      daemon.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    await new Promise(() => {}); // stay up until a signal
  } catch (err) {
    warnLine((err as Error).message);
    out(t.muted('  For the whole picture, with one fix per line: npx osc doctor'));
    process.exitCode = 1;
  }
}
