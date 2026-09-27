// Where this machine's OS Code state lives. Its own module so the config
// loader and the trust store can both reach it without importing each other.
import { homedir } from 'node:os';
import { join } from 'node:path';

/** ~/.os-code (or OSC_HOME, which tests and multi-profile setups use). */
export function oscHome(): string {
  return process.env.OSC_HOME ?? join(homedir(), '.os-code');
}
