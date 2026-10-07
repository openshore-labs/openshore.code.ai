// Docking (connect-anywhere, founder 2026-10-07): the word for linking this
// device to a machine that does the work. The Computer room offers every way
// in, and Cloud Connections sets up a server beside the cloud providers, so
// each lands where it belongs: a docked machine in Computer and the model
// menu, a provider's models in the Stack. Pure, so the copy and the order
// are a tested rule. docs/connect-anywhere-proposal.md.
import type { DaemonTarget } from '../drivers/remoteDriver.js';

/** What a docked machine is, as its own /health reports it: the desktop app,
 *  or `osc serve` on a server (rented or at home). An older daemon says
 *  nothing, and reads as a computer, which is what every daemon was. */
export type DockKind = 'desktop' | 'server';

export function dockKindOf(body: unknown): DockKind | undefined {
  const kind = (body as { kind?: unknown } | null)?.kind;
  return kind === 'desktop' || kind === 'server' ? kind : undefined;
}

/** How a docked machine is named on screen. */
export function dockedNoun(target: Pick<DaemonTarget, 'kind'> | undefined): string {
  return target?.kind === 'server' ? 'Your server' : 'Your computer';
}

/** The same, mid-sentence. */
export function dockedNounLower(target: Pick<DaemonTarget, 'kind'> | undefined): string {
  return target?.kind === 'server' ? 'your server' : 'your computer';
}

/** What to check when a docked machine does not answer. A server has no
 *  app to open; a computer needs OpenShore open on it. */
export function unreachableLine(target: Pick<DaemonTarget, 'kind'> | undefined): string {
  return target?.kind === 'server'
    ? 'Not reachable right now. Check that the server is running and on Tailscale.'
    : 'Not reachable right now. Check that it is awake with OpenShore open.';
}

/** The one command that puts OpenShore on a server, run there over SSH. It
 *  downloads the signed server package from the public releases, refuses it
 *  unless the signature checks, and prints the code to scan
 *  (os-code/scripts/install-server.sh). */
export const SERVER_INSTALL_COMMAND =
  'curl -fsSL https://github.com/openshore-labs/openshore-releases/releases/latest/download/install-server.sh | sh';

/** The command that prints a fresh code on a server already set up. */
export const SERVER_PAIR_COMMAND =
  'sudo -u openshore env HOME=/var/lib/openshore osc pair --server';

/** Setting up a server, in the order a person does it. No provider is named
 *  or ranked: any Linux server works. */
export const SERVER_STEPS: { title: string; detail: string }[] = [
  {
    title: 'Get a Linux server',
    detail:
      'Rent one from any provider, or use a machine at home. 2 GB of memory runs OpenShore; a big model needs a GPU server, which is billed by the hour.',
  },
  {
    title: 'Put Tailscale on it',
    detail:
      'Sign in to the same Tailscale account as this device. That private link is the only way in: OpenShore never listens on the open internet.',
  },
  {
    title: 'Run one command on it',
    detail:
      'Over SSH, paste the command below. It checks the download is signed by OpenShore, installs it, keeps it running, and prints a code.',
  },
  {
    title: 'Scan the code, then say yes',
    detail:
      'Scan it here. The server shows a four-digit code and asks whether this device may dock; type y there.',
  },
];

/** What renting means, said once (the honesty call in the proposal). */
export const SERVER_RENTED_LINE =
  'A rented server runs on hardware another company owns, and that company can reach its disk. Pick one you trust.';

/** The ways to give OpenShore a brain, and the room each one lives in. The
 *  Computer room lists them so no one has to know where to look. */
export type DockPath = 'computer' | 'server' | 'cloud' | 'device';

export const DOCK_PATHS: { id: DockPath; title: string; detail: string }[] = [
  {
    id: 'computer',
    title: 'Your computer at home',
    detail: 'Dock to the desktop app over Tailscale. Its models and files do the work.',
  },
  {
    id: 'server',
    title: 'A server you rent',
    detail: 'Dock to OpenShore on a Linux server. It keeps working while this device sleeps.',
  },
  {
    id: 'cloud',
    title: 'A cloud model on your key',
    detail: 'Claude, OpenAI, Gemini, Venice, OpenRouter and more, set up in Cloud Connections.',
  },
  {
    id: 'device',
    title: 'A model on this device',
    detail: 'Free and offline. Set one up in the Stack.',
  },
];
