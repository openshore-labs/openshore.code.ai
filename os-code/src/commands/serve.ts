// osc serve: run the daemon. It owns the generation so phones can come and
// go; it binds loopback or the tailnet interface only.
import { banner, t } from '../brand/theme.js';
import { loadConfig } from '../config/load.js';
import { startDaemon } from '../daemon/serve.js';
import { okLine, out, warnLine } from './util.js';

export interface ServeOptions {
  bind?: 'loopback' | 'tailscale';
  port?: number;
}

export async function serveCommand(options: ServeOptions): Promise<void> {
  const { config } = loadConfig();
  const bind = options.bind ?? config.daemon.bind;
  const port = options.port ?? config.daemon.port;

  out(banner('osc serve'));
  try {
    const daemon = await startDaemon({ config, bind, port });
    okLine(`Daemon up on ${daemon.host}:${daemon.port} (${bind}).`);
    okLine('Auth: the bearer token at ~/.os-code/daemon.token (mode 600).');
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
    process.exitCode = 1;
  }
}
