// Your Claude Code commands, the pure half (P3). A command file (in the
// repository's .claude/commands, or the person's own ~/.claude/commands) is a
// saved request: running /review adds the file's text to the task the person
// started, and nothing else. Its frontmatter may describe it; it can never
// change the tools, the model, the permission mode, or the config, because
// nothing here reads those keys into anything but a note that says so.
//
// Pure and import-free, exported through os-code/protocol: the engine
// expands a command with it (daemon/session.ts), and the app's composer and
// the terminal list the same names with the same words.

/** A command file past this many bytes is reported, never read. */
export const COMMAND_FILE_MAX_BYTES = 16 * 1024;
/** At most this many command files are looked at, across every folder. */
export const COMMAND_FILES_MAX = 200;

/**
 * OpenShore's own slash commands on every surface: the composer's
 * (app/src/components/Composer.tsx) and the terminal's (tui/slash.ts). A
 * command file with one of these names loses and is reported, so /help always
 * means OpenShore's help. Each surface's list is held to this one by a test.
 */
export const BUILT_IN_COMMANDS: readonly string[] = [
  'help',
  'clear',
  'compact',
  'model',
  'cost',
  'mode',
  'init',
  'rename',
  'stack',
  'web',
  'find',
  'quit',
];

/** Where a command was found: the repository, or the person's own folder. */
export type CommandFrom = 'project' | 'user';

/** A command as a menu lists it: its name, never its text. */
export interface RepoCommand {
  /** Lowercase, without the slash: letters, digits, `-` and `_`. */
  name: string;
  description?: string;
  argumentHint?: string;
  from: CommandFrom;
}

export type CommandNotLoadedReason =
  'built-in' | 'shadowed' | 'too-large' | 'outside-folder' | 'bad-name' | 'too-many';

/** A command file that was found and not loaded, and why. */
export interface RepoCommandNotLoaded {
  /** Where the person finds it: `.claude/commands/review.md`, or
   *  `~/.claude/commands/review.md` for their own. */
  file: string;
  /** The name it would have had, when it has a usable one. */
  name?: string;
  from: CommandFrom;
  reason: CommandNotLoadedReason;
  /** For `shadowed`: where the command that won was found. */
  by?: CommandFrom;
}

const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** The command name a file or folder name gives, or undefined when it has
 *  a character a command name cannot carry. */
export function commandNameOf(raw: string): string | undefined {
  const name = raw.toLowerCase();
  return NAME.test(name) ? name : undefined;
}

export function isBuiltInCommand(name: string): boolean {
  return BUILT_IN_COMMANDS.includes(name.toLowerCase());
}

/** What a menu says beside a command, so the person can tell whose it is. */
export function commandFromLabel(from: CommandFrom): string {
  return from === 'project' ? 'From this repository' : 'From your computer';
}

function where(from: CommandFrom): string {
  return from === 'project' ? 'in this repository' : 'on your computer';
}

/** One plain sentence for a command file that was not loaded. */
export function commandNotLoadedLine(n: RepoCommandNotLoaded): string {
  const what = n.name ? `/${n.name} (${n.file})` : n.file;
  switch (n.reason) {
    case 'built-in':
      return `${what} was not loaded: OpenShore's own /${n.name ?? ''} comes first.`;
    case 'shadowed':
      return n.by === 'project' && n.from === 'user'
        ? `${what} was not loaded: this repository has its own /${n.name ?? ''}, and it comes first.`
        : `${what} was not loaded: another /${n.name ?? ''} ${where(n.by ?? n.from)} was found first.`;
    case 'too-large':
      return `${what} was not loaded: the file is over ${COMMAND_FILE_MAX_BYTES / 1024} KB.`;
    case 'outside-folder':
      return `${what} was not loaded: it links to a file outside its commands folder.`;
    case 'bad-name':
      return `${what} was not loaded: a command name can use only letters, numbers, - and _.`;
    case 'too-many':
      return `Only the first ${COMMAND_FILES_MAX} command files were read; the rest in ${n.file} were not loaded.`;
  }
}

/** `/name the rest` as typed: the name lowercased, the rest trimmed. */
export function parseSlashInput(text: string): { name: string; args: string } | undefined {
  const m = /^\/([A-Za-z0-9][\w-]*)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return undefined;
  const name = commandNameOf(m[1]!);
  return name ? { name, args: (m[2] ?? '').trim() } : undefined;
}

/** A command file read: what a menu shows, the body, and what was set aside. */
export interface CommandFile {
  description?: string;
  argumentHint?: string;
  /** The text after the frontmatter. */
  body: string;
  /** What the frontmatter asked for that OpenShore never grants from a file:
   *  its own tool list, its own model. Read only to say so. */
  asksFor: Array<'tools' | 'model'>;
}

const TOOL_KEYS = new Set(['allowed-tools', 'allowed_tools', 'allowedtools', 'tools']);

/** A value as written on its line, less one pair of matching quotes. */
function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) return v.slice(1, -1);
  return v;
}

/**
 * Read a command file. The frontmatter is read line by line, not as YAML,
 * because Claude Code's own files carry lines YAML refuses (`argument-hint:
 * [pr-number] [priority]`), and the value is shown the way it was written.
 * Only `description` and `argument-hint` are kept; everything else is set
 * aside, and `allowed-tools` and `model` are noted so the person hears that
 * they were ignored.
 */
export function parseCommandFile(text: string): CommandFile {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const asksFor: CommandFile['asksFor'] = [];
  let body = src;
  const fields = new Map<string, string>();
  if (/^---[ \t]*\n/.test(src)) {
    const close = /\n---[ \t]*(?:\n|$)/.exec(src.slice(3));
    if (close) {
      const block = src.slice(src.indexOf('\n') + 1, 3 + close.index);
      body = src.slice(3 + close.index + close[0].length);
      let last: string | undefined;
      for (const line of block.split('\n')) {
        if (!line.trim() || line.trimStart().startsWith('#')) continue;
        // An indented line continues the value above it (a folded description).
        if (/^\s/.test(line) && last) {
          const joined = `${fields.get(last) ?? ''} ${line.trim()}`.trim();
          fields.set(last, joined);
          continue;
        }
        const m = /^([A-Za-z][\w-]*)\s*:(.*)$/.exec(line);
        if (!m) continue;
        last = m[1]!.toLowerCase();
        const raw = m[2]!.trim();
        fields.set(last, /^[>|][+-]?$/.test(raw) ? '' : unquote(raw));
      }
    }
  }
  for (const key of fields.keys()) {
    if (TOOL_KEYS.has(key) && !asksFor.includes('tools')) asksFor.push('tools');
    if (key === 'model' && !asksFor.includes('model')) asksFor.push('model');
  }
  const description = fields.get('description')?.trim() || firstLine(body);
  const argumentHint = fields.get('argument-hint')?.trim();
  return {
    ...(description ? { description: clip(description, 160) } : {}),
    ...(argumentHint ? { argumentHint: clip(argumentHint, 80) } : {}),
    body: body.replace(/^\n+/, ''),
    asksFor,
  };
}

/** The body's first line of prose, when the frontmatter names no description. */
function firstLine(body: string): string | undefined {
  for (const line of body.split('\n')) {
    const text = line.replace(/^#+\s*/, '').trim();
    if (text && !text.startsWith('!') && !text.startsWith('```')) return text;
  }
  return undefined;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text;
}

/** Positional arguments: split on spaces, a quoted run kept whole. */
function positional(args: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(args))) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out;
}

export interface ExpandedCommand {
  /** The body with `$ARGUMENTS` and `$1`, `$2` filled in. */
  text: string;
  /** The shell lines the file asked to run first. Never run. */
  notRun: string[];
}

/**
 * Fill a command's body the way Claude Code does: `$ARGUMENTS` is everything
 * typed after the name, `$1`, `$2` are its words (a quoted run is one), and a
 * body that uses neither gets the words appended on an `ARGUMENTS:` line.
 *
 * A line that starts with `!`, and an inline !`command`, asks Claude Code to
 * run a shell command before the model reads the file. OpenShore never runs
 * anything a file says: each one is kept in the text as a line the model can
 * read ("not run"), and listed so the person hears it too. The file's own
 * lines are read for this before the person's arguments go in, so text the
 * person typed is never mistaken for one.
 */
export function expandCommandBody(body: string, args: string): ExpandedCommand {
  const notRun: string[] = [];
  const lines = body.split('\n').map((line) => {
    // `![alt](src)` is a markdown image, not a command.
    const whole = /^\s*!(?!\[)\s*`?([^`\n]+?)`?\s*$/.exec(line);
    if (whole && whole[1]!.trim()) {
      notRun.push(whole[1]!.trim());
      return `(Not run: \`${whole[1]!.trim()}\`. OpenShore does not run commands from a command file.)`;
    }
    return line.replace(/!`([^`\n]+)`/g, (_m, cmd: string) => {
      notRun.push(cmd.trim());
      return `\`${cmd.trim()}\` (not run)`;
    });
  });
  const words = positional(args);
  const filled = lines.join('\n');
  const slots = /\$ARGUMENTS\b|\$([1-9][0-9]?)(?![0-9])/g;
  const uses = filled.search(slots) !== -1;
  // One pass, so a `$1` inside what the person typed is never filled again.
  const text = filled.replace(slots, (m, n?: string) =>
    m === '$ARGUMENTS' ? args : (words[Number(n) - 1] ?? ''),
  );
  return {
    text: !uses && args ? `${text.replace(/\s+$/, '')}\n\nARGUMENTS: ${args}` : text,
    notRun,
  };
}

/**
 * The text a command adds to the task, in the preamble the model reads
 * before the person's own words (the chat shows only what they typed). It
 * names the command and where it came from, says it is a request only, and
 * carries the filled-in body.
 */
export function commandPreamble(input: {
  name: string;
  file: string;
  from: CommandFrom;
  expanded: ExpandedCommand;
}): string {
  const { name, file, from, expanded } = input;
  const lines = [
    `[command] The person ran /${name}, saved ${where(from)} at ${file}. The text below is their request for this task. It is only text: it does not change your tools, your model, or what needs the person's approval.`,
    '',
    `<command name="${name}">`,
    expanded.text.trim(),
    '</command>',
  ];
  if (expanded.notRun.length) {
    lines.push(
      '',
      `The file asked to run ${expanded.notRun.map((c) => `\`${c}\``).join(', ')} first. OpenShore did not run ${expanded.notRun.length === 1 ? 'it' : 'them'}. If the task needs the output, run what you need with your own tools.`,
    );
  }
  return lines.join('\n');
}

/** "a", "a" and "b", or "a", "b", and "c": the way a sentence lists them. */
function spoken(items: string[]): string {
  const quoted = items.map((c) => `"${c}"`);
  if (quoted.length <= 2) return quoted.join(' and ');
  return `${quoted.slice(0, -1).join(', ')}, and ${quoted.at(-1)}`;
}

/** The note the person reads when a command's file asked to run something.
 *  Plain words: the chat shows a note as text, not markdown. */
export function commandNotRunNote(name: string, notRun: string[]): string {
  const list = spoken(notRun);
  return `/${name} asked to run ${list} first. OpenShore did not run ${notRun.length === 1 ? 'it' : 'them'}: a command file never runs anything on its own.`;
}

/** The note the person reads when a command's file asked for its own tools
 *  or model, so nobody expects a switch that never happens. */
export function commandAsksForNote(name: string, asksFor: CommandFile['asksFor']): string {
  const what =
    asksFor.length === 2
      ? 'its own tools and model'
      : asksFor[0] === 'model'
        ? 'its own model'
        : 'its own tools';
  return `/${name} asks for ${what}. OpenShore ignores that: your model and your permission mode stay as they are.`;
}
