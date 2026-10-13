// Stand-ins for a chat that holds a private note's text, shared by the tests
// of the UX and copy review rulings (2026-10-08): a vault read that returns today's
// Journal note marked local-only, as the vault tools return it to a seat that
// stays on this network, and a vault source whose project pin sits under
// Private/, rendered by the real pack builder.
import { z } from 'zod';
import { compileVaultPrivacy } from '../../src/harness/vault/privacy.js';
import type { PreparedVaultContext, VaultContextSource } from '../../src/harness/vaultContext.js';
import type { AgentEvent } from '../../src/core/agent/types.js';

export const NOTE = 'NOTE-SECRET-4410';
export const PIN = 'PIN-SECRET-7731';
export const PIN_PATH = 'Private/plan.md';

/** A vault read that returns a private Journal note's text. */
export const journalRead = {
  name: 'vaultRead',
  description: 'Read a vault note.',
  schema: z.object({ path: z.string() }),
  risk: 'read' as const,
  pathJail: 'own' as const,
  async execute() {
    return {
      ok: true,
      content: `Dear diary, ${NOTE}. ${'It was a long day. '.repeat(10)}`,
      localOnly: true as const,
    };
  },
};

/** A vault source whose one project pin is a private note. */
export function pinnedSource(): VaultContextSource {
  return {
    async prepare(): Promise<PreparedVaultContext> {
      return {
        index: null,
        bodies: new Map([[PIN_PATH, `# Plan\n\nThe plan says ${PIN}.\n`]]),
        pins: [],
        projectPins: [PIN_PATH],
        privacy: compileVaultPrivacy({
          exclude: [],
          localOnly: { paths: ['Private/', 'Journal/'], tags: ['private'] },
        }),
      };
    },
  };
}

/** Every tool-denied reason, in order. */
export const deniedReasons = (events: AgentEvent[]): string[] =>
  events.flatMap((e) => (e.type === 'tool-denied' ? [e.reason] : []));

/** Every status line, in order. */
export const statusLines = (events: AgentEvent[]): string[] =>
  events.flatMap((e) => (e.type === 'status' ? [e.message] : []));
