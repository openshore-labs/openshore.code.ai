// Pairing logic: gather everything the phone needs to reach this desktop.
// The pair COMMAND renders this warmly; the logic stays testable here. OS
// Code orchestrates Tailscale and the SSH client, it embeds neither.
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { detectTailscale, type TailscaleStatus } from './tailscale.js';
import { loadOrCreateToken } from '../core/security/daemonAuth.js';
import { oscHome } from '../config/load.js';

export interface PairPlan {
  tailscale: TailscaleStatus;
  /** ssh connection string for Termius, when the tailnet is up. */
  sshTarget?: string;
  sshUser: string;
  /** The command the phone runs after connecting. */
  attachCommand: string;
  daemonToken: string;
  steps: PairStep[];
}

export interface PairStep {
  title: string;
  detail: string;
  /** Runnable command, when the fix is one command. */
  command?: string;
  done: boolean;
}

export function buildPairPlan(): PairPlan {
  const tailscale = detectTailscale();
  const sshUser = userInfo().username;
  const host = tailscale.dnsName ?? tailscale.ip;
  const sshTarget = host ? `${sshUser}@${host}` : undefined;
  const daemonToken = loadOrCreateToken(join(oscHome(), 'daemon.token'));

  const steps: PairStep[] = [
    {
      title: 'Tailscale on this desktop',
      detail: tailscale.running
        ? `Connected as ${host}.`
        : (tailscale.hint ?? 'Install and start Tailscale.'),
      command: tailscale.running
        ? undefined
        : tailscale.installed
          ? 'sudo tailscale up'
          : 'curl -fsSL https://tailscale.com/install.sh | sh',
      done: tailscale.running,
    },
    {
      title: 'Tailscale on the phone',
      detail:
        'Install the Tailscale app from the App Store, sign in to the SAME tailnet, and toggle the VPN on.',
      done: false,
    },
    {
      title: 'Termius on the phone',
      detail: sshTarget
        ? `Install Termius from the App Store and add a host: ${sshTarget}. Keys beat passwords; Termius can generate one, then add its public key to ~/.ssh/authorized_keys here.`
        : 'Install Termius from the App Store. The exact host appears here once Tailscale is up.',
      done: false,
    },
    {
      title: 'Keep the desktop awake',
      detail:
        'A sleeping desktop kills in-flight runs. osc doctor checks this and prints the one-line fix if this machine suspends when idle.',
      done: false,
    },
    {
      title: 'Start the daemon',
      detail: 'The daemon owns the generation, so a dropped phone connection just reattaches.',
      command: 'osc serve --bind tailscale',
      done: false,
    },
  ];

  return {
    tailscale,
    sshTarget,
    sshUser,
    attachCommand: 'osc attach',
    daemonToken,
    steps,
  };
}
