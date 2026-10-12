// What a docked device may know about the machine it docked to (many
// machines, one person, 2026-10-12): its memory, its cores and its processor
// family, so Computer and a project's Runs on can tell a 4 GB shared server
// from a 32 GB computer at home. Facts read from this process, never a claim:
// no speed, no verdict on a model. No probe and no spawn either: a server's
// engine runs with PrivateDevices (install-server.sh), so it could not see a
// graphics card, and it says nothing about one rather than say "none".
import { availableParallelism, cpus } from 'node:os';
import { hostRamGB } from '../providers/hostMemory.js';

export interface MachineFacts {
  /** Total memory in whole GB, the rounding the served window uses. */
  ramGB: number;
  /** Cores this process may run on (a VPS's vCPUs). */
  cpus: number;
  /** Node's name for the processor family: 'x64' or 'arm64' on a server. */
  arch: string;
}

export function machineFacts(): MachineFacts {
  let cores = 0;
  try {
    cores = availableParallelism();
  } catch {
    cores = cpus().length;
  }
  return { ramGB: hostRamGB(), cpus: Math.max(1, cores), arch: process.arch };
}
