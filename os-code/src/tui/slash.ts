// Slash commands: fast, discoverable, shared between the Ink TUI and the
// plain renderer. Anything that needs full-screen flow (init, market) points
// at its command instead of half-reimplementing it inline.
import type { SessionDriver } from '../daemon/session.js';

export interface SlashContext {
  driver: SessionDriver;
  /** Session cloud spend so far (the UI tracks it from usage events). */
  dollars: number;
  stackDescription: string;
  print(text: string): void;
  clear(): void;
  exit(): void;
  setWebEnabled?: (on: boolean) => void;
  webEnabled?: () => boolean;
}

export interface SlashCommand {
  name: string;
  description: string;
  run(args: string, ctx: SlashContext): void;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: '/help',
    description: 'show commands and keys',
    run(_args, ctx) {
      ctx.print(
        [
          'Commands:',
          ...SLASH_COMMANDS.map((c) => `  ${c.name.padEnd(10)} ${c.description}`),
          'Keys: Esc stops the current run. Ctrl+C twice quits. Up/Down recalls input history.',
          'Bigger flows have their own commands: osc init, osc market, osc doctor, osc pair.',
        ].join('\n'),
      );
    },
  },
  {
    name: '/stack',
    description: 'show the active model stack',
    run(_args, ctx) {
      ctx.print(
        `Stack: ${ctx.stackDescription}\nEdit it with osc stack, or rerun osc init for a preset.`,
      );
    },
  },
  {
    name: '/cost',
    description: 'show cloud spend this session',
    run(_args, ctx) {
      ctx.print(
        ctx.dollars > 0
          ? `Cloud spend this session: $${ctx.dollars.toFixed(2)}. Local work stays free.`
          : 'Nothing spent. Everything so far ran on your own hardware.',
      );
    },
  },
  {
    name: '/web',
    description: 'toggle web access (on|off)',
    run(args, ctx) {
      if (!ctx.setWebEnabled || !ctx.webEnabled) {
        ctx.print(
          'Web toggling is not available for this session; set egress.webEnabled in your config.',
        );
        return;
      }
      const arg = args.trim().toLowerCase();
      if (arg === 'on' || arg === 'off') {
        ctx.setWebEnabled(arg === 'on');
        ctx.print(
          arg === 'on'
            ? 'Web access is on. Searches leave this machine; a self-hosted SearXNG keeps them private.'
            : 'Web access is off. The agent will work from local knowledge only.',
        );
      } else {
        ctx.print(`Web access is ${ctx.webEnabled() ? 'on' : 'off'}. Use /web on or /web off.`);
      }
    },
  },
  {
    name: '/clear',
    description: 'clear the screen',
    run(_args, ctx) {
      ctx.clear();
    },
  },
  {
    name: '/quit',
    description: 'leave OS Code',
    run(_args, ctx) {
      ctx.exit();
    },
  },
];

export function runSlash(text: string, ctx: SlashContext): boolean {
  const [name, ...rest] = text.split(' ');
  const command = SLASH_COMMANDS.find((c) => c.name === name);
  if (!command) return false;
  command.run(rest.join(' '), ctx);
  return true;
}
