// Slash commands: fast, discoverable, shared between the Ink TUI and the
// plain renderer. Anything that needs full-screen flow (init, market) points
// at its command instead of half-reimplementing it inline.
import type { SessionDriver } from '../daemon/session.js';
import {
  commandFromLabel,
  commandNotLoadedLine,
  parseSlashInput,
  type RepoCommand,
  type RepoCommandNotLoaded,
} from '../core/agent/commandText.js';

/** The person's own commands for this folder, as the session last said them
 *  (the repo-info event). Kept by the renderer, read by /help. */
export interface RepoCommandList {
  commands: RepoCommand[];
  notLoaded: RepoCommandNotLoaded[];
}

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
  /** Search the session transcript (the renderer keeps the history). */
  find?: (query: string) => void;
  /** The person's own commands for this folder, for /help. */
  repoCommands?: () => RepoCommandList;
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
          ...repoCommandHelp(ctx.repoCommands?.()),
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
    name: '/find',
    description: 'search this session transcript',
    run(args, ctx) {
      const query = args.trim();
      if (!query) {
        ctx.print(
          'Usage: /find <text>. Your terminal scrollback holds the full history; this jumps to the lines that match.',
        );
        return;
      }
      if (!ctx.find) {
        ctx.print('Transcript search is not available in this view.');
        return;
      }
      ctx.find(query);
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

/** The /help lines for the person's own commands: each one with where it
 *  came from, then every file that was found and not loaded, and why. */
export function repoCommandHelp(list: RepoCommandList | undefined): string[] {
  if (!list || (!list.commands.length && !list.notLoaded.length)) return [];
  const lines: string[] = [];
  for (const from of ['project', 'user'] as const) {
    const mine = list.commands.filter((c) => c.from === from);
    if (!mine.length) continue;
    lines.push(`${commandFromLabel(from)}:`);
    for (const c of mine) {
      const hint = c.argumentHint ? ` ${c.argumentHint}` : '';
      lines.push(`  /${c.name}${hint}${c.description ? `  ${c.description}` : ''}`);
    }
  }
  if (list.notLoaded.length) {
    lines.push('Not loaded:');
    for (const n of list.notLoaded) lines.push(`  ${commandNotLoadedLine(n)}`);
  }
  return lines;
}

/** The person's own command this line runs, when it runs one. The session
 *  fills it in; the renderer only sends the line as typed. */
export function findRepoCommand(
  text: string,
  list: RepoCommandList | undefined,
): RepoCommand | undefined {
  const typed = parseSlashInput(text);
  return typed ? list?.commands.find((c) => c.name === typed.name) : undefined;
}

/** The slash hint line's matches for what is typed so far: the built-ins
 *  first, then the person's own, each with a short description. */
export function slashMatches(
  value: string,
  list: RepoCommandList | undefined,
  limit = 5,
): Array<{ name: string; description: string }> {
  if (!value.startsWith('/') || value.includes(' ')) return [];
  const typed = value.toLowerCase();
  const own = (list?.commands ?? []).map((c) => ({
    name: `/${c.name}`,
    description: `${c.description ? `${c.description} ` : ''}(${commandFromLabel(c.from).toLowerCase()})`,
  }));
  return [...SLASH_COMMANDS, ...own].filter((c) => c.name.startsWith(typed)).slice(0, limit);
}
