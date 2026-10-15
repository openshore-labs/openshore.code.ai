// Docking (connect-anywhere, 2026-10-07): the word for linking this
// device to a machine that does the work. The Computer room offers every way
// in, and Cloud Connections sets up a server beside the cloud providers, so
// each lands where it belongs: a docked machine in Computer and the model
// menu, a provider's models in the Stack. Pure, so the copy and the order
// are a tested rule. docs/design/connect-anywhere-proposal.md.
import type { DaemonTarget } from '../drivers/remoteDriver.js';

/** What a docked machine is, as its own /health reports it: the desktop app,
 *  or `osc serve` on a server (rented or at home). An older daemon says
 *  nothing, and reads as a computer, which is what every daemon was. */
export type DockKind = 'desktop' | 'server';

export function dockKindOf(body: unknown): DockKind | undefined {
  const kind = (body as { kind?: unknown } | null)?.kind;
  return kind === 'desktop' || kind === 'server' ? kind : undefined;
}

/** Where a server lives, as the person said when they docked it (many
 *  machines, 2026-10-12): at home, or rented from a provider. A
 *  server cannot tell, so this device keeps the answer. Unset on a server
 *  docked before the question existed, which reads as plain "Server". */
export type DockPlace = 'home' | 'rented';

/** A docked machine's size, as its /health reports it (the engine's
 *  daemon/machineFacts.ts): memory in GB, cores, processor family. Facts,
 *  never a claim about speed. Absent from an older daemon. */
export interface MachineFacts {
  ramGB: number;
  cpus: number;
  arch: string;
}

export function machineFactsOf(body: unknown): MachineFacts | undefined {
  const m = (body as { machine?: unknown } | null)?.machine as
    { ramGB?: unknown; cpus?: unknown; arch?: unknown } | undefined;
  if (!m || typeof m !== 'object') return undefined;
  const { ramGB, cpus, arch } = m;
  if (typeof ramGB !== 'number' || !Number.isFinite(ramGB) || ramGB < 0) return undefined;
  if (typeof cpus !== 'number' || !Number.isInteger(cpus) || cpus < 1) return undefined;
  if (typeof arch !== 'string' || !/^[a-z0-9_]{1,16}$/.test(arch)) return undefined;
  return { ramGB, cpus, arch };
}

/** "4 GB memory, 2 cores, Arm": the words on the box, for a machine's row.
 *  Arm is named because a person picks a server plan by it; x64 is the
 *  default nobody needs told. */
export function machineFactsLine(m: MachineFacts | undefined): string | undefined {
  if (!m) return undefined;
  const parts = [`${m.ramGB} GB memory`, `${m.cpus} ${m.cpus === 1 ? 'core' : 'cores'}`];
  if (m.arch === 'arm64') parts.push('Arm');
  return parts.join(', ');
}

/** A maintainer's three kinds of machine (2026-10-12): your computer, a
 *  server at home, and a server you rent. A computer is not called "at home",
 *  since a docked desktop may sit anywhere; a server docked before the
 *  question was asked is just a server. */
export type MachineKind = 'computer' | 'home-server' | 'rented-server' | 'server';

export function machineKindOf(
  target: Pick<DaemonTarget, 'kind' | 'place'> | undefined,
): MachineKind {
  if (target?.kind !== 'server') return 'computer';
  if (target.place === 'home') return 'home-server';
  if (target.place === 'rented') return 'rented-server';
  return 'server';
}

/** What kind of machine it is, as a row's second line says it. */
export function machineKindLabel(kind: MachineKind): string {
  switch (kind) {
    case 'computer':
      return 'Computer';
    case 'home-server':
      return 'Server at home';
    case 'rented-server':
      return 'Rented server';
    case 'server':
      return 'Server';
  }
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

/** The server's own account, as install-server.sh makes it. A command run
 *  there as anyone else finds none of the server's keys or pairings. The
 *  engine's `osc key --help` says the same (SERVER_ACCOUNT_PREFIX there). */
export const SERVER_ACCOUNT_PREFIX = 'sudo -u openshore env HOME=/var/lib/openshore';

/** The command that prints a fresh code on a server already set up. */
export const SERVER_PAIR_COMMAND = `${SERVER_ACCOUNT_PREFIX} osc pair --server`;

/** Over SSH, the providers whose keys a server keeps (keys on your server,
 *  2026-10-09): names only, never a key. */
export const SERVER_KEY_LIST_COMMAND = `${SERVER_ACCOUNT_PREFIX} osc key list`;

/** Over SSH, delete one provider's key from a server: the way out when this
 *  device could not reach it to do so. */
export function serverKeyRemoveCommand(providerId: string): string {
  return `${SERVER_ACCOUNT_PREFIX} osc key remove ${providerId}`;
}

/** Over SSH, place a server's model (`osc stack use <model> [provider]`).
 *  A provider whose key the server keeps takes the window its model page
 *  lists (`--context`); a model the server runs itself leaves it out, since
 *  it is budgeted against the window it serves. */
export function serverStackUseCommand(
  provider: string,
  model = '<model>',
  window: 'context' | 'served' = 'context',
): string {
  const use = `${SERVER_ACCOUNT_PREFIX} osc stack use ${model} ${provider}`;
  return window === 'context' ? `${use} --context <tokens>` : use;
}

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

/** A server at home, in the same order: no provider, no renting line. */
export const HOME_SERVER_STEPS: { title: string; detail: string }[] = [
  {
    title: 'Use a Linux machine at home',
    detail:
      'An old laptop, a mini PC, or any box that runs Linux and stays plugged in. 2 GB of memory runs OpenShore.',
  },
  ...SERVER_STEPS.slice(1),
];

/** The steps for where the server lives. */
export function serverSteps(place: DockPlace): { title: string; detail: string }[] {
  return place === 'home' ? HOME_SERVER_STEPS : SERVER_STEPS;
}

/** What renting means, said once (the honesty call in the proposal). */
export const SERVER_RENTED_LINE =
  'A rented server runs on hardware another company owns, and that company can reach its disk. Pick one you trust.';

/** What a rented server of each size can do (2026-10-12: "VPS and
 *  shared vCPU servers"). Memory decides it, by the same fit rule the
 *  desktop's First Seat uses (lib/firstSeat.ts; test/runsOn.test.ts holds
 *  the 3B and 4B lines to it). No provider is named or ranked, and nothing
 *  says how fast: that waits for `osc eval` on a server (tenet 2). */
export const SERVER_SIZES: { size: string; detail: string }[] = [
  {
    size: '2 to 4 GB',
    detail:
      'OpenShore, its tools and your builds, with a cloud model on your key kept on the server. Any plan works, shared vCPU included.',
  },
  {
    size: '8 GB or more',
    detail: 'Room for a small model of its own too, a 3B or a 4B, on its processors.',
  },
  {
    size: 'A GPU server',
    detail: 'Big models of its own. Billed by the hour while it runs.',
  },
];

/** The memory each line above needs for a model of its own, for the test
 *  that holds the copy to the fit rule. */
export const SERVER_SIZE_FIT = { noModelBelowGB: 4, smallModelFromGB: 8 } as const;

/** Setting up several servers the same way (2026-10-12): most providers take
 *  a cloud-init script when a server is created. This one installs
 *  Tailscale, joins the tailnet with a one-off auth key the person pastes in
 *  place of the capitals, then runs the same signed installer. With no
 *  terminal at first boot the installer prints the pairing command instead
 *  of a code, so the yes is still typed on the server by a person. */
export const SERVER_CLOUD_INIT = [
  '#cloud-config',
  'runcmd:',
  '  - curl -fsSL https://tailscale.com/install.sh | sh',
  '  - tailscale up --auth-key=PASTE-A-ONE-OFF-TAILSCALE-AUTH-KEY',
  `  - ${SERVER_INSTALL_COMMAND}`,
].join('\n');

/** What to know before pasting it, said once beside it. */
export const SERVER_CLOUD_INIT_LINE =
  'Setting up more than one? When you create a server, paste this where your provider asks for cloud-init or user data. Put a one-off auth key from Tailscale in place of the capitals: your provider keeps what you paste, so use a key that works once. When the server is up, SSH in and run the code command below.';

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
    detail: 'Claude, OpenAI, Gemini, Kimi and more, set up in Cloud Connections.',
  },
  {
    id: 'device',
    title: 'A model on this device',
    detail: 'Free and offline. Set one up in the Stack.',
  },
];
