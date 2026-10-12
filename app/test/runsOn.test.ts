// Where the work runs (founder, 2026-10-12): a device docks to as many
// machines as the person likes (a computer, a server at home, a rented
// server), each project may name one, and each chat goes back to the machine
// its session opened on, never to another that has never heard of it.
import { describe, expect, it } from 'vitest';
import {
  THIS_COMPUTER,
  deviceWhere,
  dockedTarget,
  forgetRunsOn,
  goneLine,
  projectWhere,
  projectsOn,
  sessionWhere,
  whereKey,
  type WhereContext,
} from '../src/lib/runsOn.js';
import { firstSeatNeeded } from '../src/lib/firstSeat.js';
import { waitsOnFirstSeat } from '../src/state/firstRunOps.js';
import {
  machineFactsLine,
  machineFactsOf,
  machineKindLabel,
  machineKindOf,
} from '../src/lib/docking.js';

const HOME = { baseUrl: 'http://100.64.0.1:4816', token: 'a', kind: 'desktop' as const };
const VPS = {
  baseUrl: 'http://100.64.0.2:4816',
  token: 'b',
  kind: 'server' as const,
  place: 'rented' as const,
};
const BOX = {
  baseUrl: 'http://100.64.0.3:4816',
  token: 'c',
  kind: 'server' as const,
  place: 'home' as const,
};
const hubs = [HOME, VPS, BOX];

const phone: WhereContext = { desktopLocal: false, hubs, active: HOME };
const desk: WhereContext = { desktopLocal: true, hubs, active: VPS };

describe('the device default, unchanged', () => {
  it('a desktop runs on itself, unless pointed at another machine', () => {
    expect(deviceWhere(desk)).toEqual({ kind: 'local' });
    expect(deviceWhere({ ...desk, preferRemoteHub: true })).toEqual({
      kind: 'docked',
      target: VPS,
    });
  });

  it('a phone runs on its active machine, or nowhere', () => {
    expect(deviceWhere(phone)).toEqual({ kind: 'docked', target: HOME });
    expect(deviceWhere({ desktopLocal: false, hubs: [] })).toEqual({ kind: 'none' });
  });

  it('an active machine from before the list still counts', () => {
    expect(deviceWhere({ desktopLocal: false, hubs: [], active: HOME })).toEqual({
      kind: 'docked',
      target: HOME,
    });
  });
});

describe("a project's choice", () => {
  it('runs on the machine it names, whatever is active', () => {
    expect(projectWhere({ runsOn: VPS.baseUrl }, phone)).toEqual({ kind: 'docked', target: VPS });
    expect(projectWhere({ runsOn: BOX.baseUrl }, desk)).toEqual({ kind: 'docked', target: BOX });
  });

  it('this computer runs on the desktop even while it points elsewhere', () => {
    expect(projectWhere({ runsOn: THIS_COMPUTER }, { ...desk, preferRemoteHub: true })).toEqual({
      kind: 'local',
    });
    // A phone cannot honor it, and follows its own default.
    expect(projectWhere({ runsOn: THIS_COMPUTER }, phone)).toEqual({
      kind: 'docked',
      target: HOME,
    });
  });

  it('no choice, or a forgotten machine, follows the device', () => {
    expect(projectWhere({}, phone)).toEqual({ kind: 'docked', target: HOME });
    expect(projectWhere(undefined, desk)).toEqual({ kind: 'local' });
    expect(projectWhere({ runsOn: 'http://100.64.0.99:4816' }, phone)).toEqual({
      kind: 'docked',
      target: HOME,
    });
  });
});

describe("a chat's session goes back where it opened", () => {
  it('a chat with no session yet opens where its project runs', () => {
    expect(sessionWhere({}, { runsOn: VPS.baseUrl }, phone)).toEqual({
      kind: 'docked',
      target: VPS,
    });
  });

  it('a recorded machine wins over the project and the active machine', () => {
    const src = { sessionId: 's1', hub: BOX.baseUrl };
    expect(sessionWhere(src, { runsOn: VPS.baseUrl }, phone)).toEqual({
      kind: 'docked',
      target: BOX,
    });
    expect(sessionWhere({ sessionId: 's1', hub: THIS_COMPUTER }, undefined, desk)).toEqual({
      kind: 'local',
    });
  });

  it('a forgotten machine is gone, never another machine', () => {
    const lost = 'http://100.64.0.99:4816';
    expect(sessionWhere({ sessionId: 's1', hub: lost }, undefined, phone)).toEqual({
      kind: 'gone',
      key: lost,
    });
    expect(sessionWhere({ sessionId: 's1', hub: THIS_COMPUTER }, undefined, phone)).toEqual({
      kind: 'gone',
      key: THIS_COMPUTER,
    });
    expect(goneLine(lost)).toMatch(/100\.64\.0\.99, which this device no longer docks to/);
    expect(goneLine(lost, 'hetzner-1')).toMatch(/^This chat ran on hetzner-1,/);
  });

  it('a chat from before the record follows the device, as it always did', () => {
    expect(sessionWhere({ sessionId: 's1' }, { runsOn: VPS.baseUrl }, phone)).toEqual({
      kind: 'docked',
      target: HOME,
    });
  });

  it('records the machine by its address, or this computer', () => {
    expect(whereKey({ kind: 'local' })).toBe(THIS_COMPUTER);
    expect(whereKey({ kind: 'docked', target: VPS })).toBe(VPS.baseUrl);
    expect(whereKey({ kind: 'none' })).toBeUndefined();
    expect(dockedTarget({ kind: 'docked', target: VPS })).toBe(VPS);
    expect(dockedTarget({ kind: 'local' })).toBeUndefined();
  });
});

describe('forgetting a machine', () => {
  it('sends every project that named it back to the device default', () => {
    const projects = [
      { id: 'a', runsOn: VPS.baseUrl },
      { id: 'b', runsOn: BOX.baseUrl },
      { id: 'c' },
    ];
    const after = forgetRunsOn(projects, VPS.baseUrl);
    expect(after).toEqual([{ id: 'a' }, { id: 'b', runsOn: BOX.baseUrl }, { id: 'c' }]);
    expect('runsOn' in after[0]!).toBe(false);
    // Nothing named it: the same array, so the caller skips the save.
    expect(forgetRunsOn(after, VPS.baseUrl)).toBe(after);
    expect(projectsOn(projects, VPS.baseUrl)).toBe(1);
    expect(projectsOn(undefined, VPS.baseUrl)).toBe(0);
  });
});

describe('the three kinds of machine, and their size', () => {
  it('names a computer, a server at home, a rented server, and a server', () => {
    expect(machineKindLabel(machineKindOf(HOME))).toBe('Computer');
    expect(machineKindLabel(machineKindOf(BOX))).toBe('Server at home');
    expect(machineKindLabel(machineKindOf(VPS))).toBe('Rented server');
    expect(machineKindLabel(machineKindOf({ kind: 'server' }))).toBe('Server');
    // A computer is never "rented", whatever a stale place says.
    expect(machineKindOf({ kind: 'desktop', place: 'rented' })).toBe('computer');
    expect(machineKindOf(undefined)).toBe('computer');
  });

  it('reads the size a daemon reports, and refuses anything odd', () => {
    expect(machineFactsOf({ machine: { ramGB: 4, cpus: 2, arch: 'arm64' } })).toEqual({
      ramGB: 4,
      cpus: 2,
      arch: 'arm64',
    });
    expect(machineFactsOf({})).toBeUndefined();
    expect(machineFactsOf({ machine: { ramGB: '4', cpus: 2, arch: 'x64' } })).toBeUndefined();
    expect(machineFactsOf({ machine: { ramGB: 4, cpus: 0, arch: 'x64' } })).toBeUndefined();
    expect(machineFactsOf({ machine: { ramGB: 4, cpus: 2, arch: '<b>' } })).toBeUndefined();
    expect(machineFactsLine({ ramGB: 4, cpus: 2, arch: 'arm64' })).toBe(
      '4 GB memory, 2 cores, Arm',
    );
    expect(machineFactsLine({ ramGB: 32, cpus: 1, arch: 'x64' })).toBe('32 GB memory, 1 core');
    expect(machineFactsLine(undefined)).toBeUndefined();
  });
});

describe('a desktop whose project runs on a docked machine', () => {
  it('shows no First Seat and holds no send, though its own engine has no model', () => {
    const empty = {
      platform: 'electron' as const,
      desktopStatusKnown: true,
      desktopConfigured: false,
      stackReady: false,
      cloudReady: false,
      hubPaired: false,
    };
    expect(firstSeatNeeded(empty)).toBe(true);
    expect(firstSeatNeeded({ ...empty, runsElsewhere: true })).toBe(false);
    const send = { desktop: true, statusKnown: true, configured: false, cloudReady: false };
    expect(waitsOnFirstSeat(send)).toBe(true);
    expect(waitsOnFirstSeat({ ...send, runsElsewhere: true })).toBe(false);
  });
});
