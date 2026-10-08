// osc pair --server: dock a phone to this server. Run it over SSH on a box
// running `osc serve`; it prints the QR the phone scans and asks here whether
// each device may dock. The logic lives in connect/serverPair.ts.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import qrcode from 'qrcode-terminal';
import { banner, t } from '../brand/theme.js';
import { loadDaemonConfig, oscHome } from '../config/load.js';
import { tailscaleIp } from '../connect/tailscale.js';
import {
  ServerPairClient,
  isYes,
  serverPairingLink,
  terminalSafe,
  tailnetAddress,
} from '../connect/serverPair.js';
import { header, okLine, out, warnLine } from './util.js';

const POLL_MS = 1500;

export async function pairServerCommand(): Promise<void> {
  out(banner('osc pair --server'));
  const { port } = loadDaemonConfig();
  const tokenPath = join(oscHome(), 'daemon.token');
  if (!existsSync(tokenPath)) {
    warnLine('The OpenShore daemon has not run on this server yet.', 'osc serve --bind tailscale');
    process.exitCode = 1;
    return;
  }
  const client = new ServerPairClient(
    `http://127.0.0.1:${port}`,
    readFileSync(tokenPath, 'utf8').trim(),
  );

  try {
    const health = await client.health();
    if (health.kind === 'desktop') {
      warnLine(
        'The desktop app runs this computer. Dock a phone from the app instead: Computer, then Dock a phone.',
      );
      return;
    }
    const address = tailnetAddress(tailscaleIp(), port);
    if (!address) {
      warnLine(
        'Tailscale is not up here, and a phone can only dock over your own tailnet.',
        'sudo tailscale up',
      );
      process.exitCode = 1;
      return;
    }

    const { claim, expiresAt } = await client.mintClaim();
    header('Scan this with OpenShore on your phone (Computer, then Dock to a server)');
    out();
    qrcode.generate(serverPairingLink(address, claim), { small: true }, (code) => {
      out(
        code
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n'),
      );
    });
    out(t.muted('  Or type these into the phone:'));
    out(`  ${t.muted('Address')} ${t.local(address)}`);
    out(`  ${t.muted('Code   ')} ${t.local(claim)}`);
    out(t.muted('  The code works once and ends in five minutes. Ctrl+C stops waiting.'));

    const until = Date.parse(expiresAt) + 2 * 60_000;
    const asked = new Set<string>();
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      while (Date.now() < until) {
        for (const request of await client.pending()) {
          if (asked.has(request.id)) continue;
          asked.add(request.id);
          const label = terminalSafe(request.label);
          header(`${label} wants to dock`);
          out(`  ${t.text('Check that the phone shows the code')} ${t.local(request.code)}.`);
          const allow = isYes(await rl.question('  Allow this device? [y/N] '));
          const result = await client.answer(request.id, allow).catch((err: Error) => {
            warnLine(err.message);
            return undefined;
          });
          if (result?.state === 'approved') {
            okLine(`${label} is docked. It reaches this server over your tailnet.`);
            out(
              t.muted('  Revoke it any time from the phone, or: osc token list, osc token revoke'),
            );
            return;
          }
          if (result?.state === 'denied') okLine('Not allowed. Nothing was handed out.');
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      warnLine(
        'The code expired with no device docked. Run osc pair --server again for a new one.',
      );
    } finally {
      rl.close();
    }
  } catch (err) {
    warnLine((err as Error).message);
    process.exitCode = 1;
  }
}
