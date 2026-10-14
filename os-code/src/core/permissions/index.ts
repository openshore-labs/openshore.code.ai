// Permission engine. The rhythm a Claude Code user knows: reads flow, writes
// ask with a diff, shell asks with the exact command, and anything that spends
// cloud quota gets its own distinct confirmation.
import { posix } from 'node:path';
import { minimatch } from '../util/minimatch.js';
import { foldPath } from '../../harness/vault/paths.js';
import type { SecurityProfile } from '../security/profiles.js';
import { PROJECT_MEMORY_WRITE_TOOL, isMemoryFilePath } from '../agent/projectMemory.js';
import { shellForThisMachine, type ShellChoice } from '../exec/shell.js';

/** What a tool can do to you, coarse-grained for policy. */
export type ToolRisk = 'read' | 'write' | 'shell' | 'network' | 'push' | 'cloud-spend';

export type Decision = 'allow' | 'ask' | 'deny';

export interface PermissionRule {
  /** Tool name or '*' for every tool of the risk class. */
  tool: string;
  decision: Decision;
  /** Optional glob the primary path argument must match (writes and edits). */
  pathGlob?: string;
  /** For shell rules: the first word every segment of the command must start
   *  with, exactly (see commandMatchesPrefix). */
  commandPrefix?: string;
}

/**
 * Commands that hand control to another program or shell. A prefix rule for
 * one of these would allow anything, so they never match and are never saved
 * as a prefix (ENG-4).
 */
export const SHELL_WRAPPERS: ReadonlySet<string> = new Set([
  'env',
  'sudo',
  'bash',
  'sh',
  'zsh',
  'eval',
  'exec',
  'source',
  '.',
  'xargs',
  'nohup',
  'time',
  'command',
  'nice',
  'timeout',
  'watch',
  'doas',
  'su',
  // Windows: PowerShell's own evaluators and the shells themselves.
  'iex',
  'Invoke-Expression',
  'pwsh',
  'powershell',
  'cmd',
  // Interpreters and package runners: each runs whatever code or package its
  // arguments name (`node -e`, `python -c`, `npx some-package`), so a saved
  // `node` would allow any program at all (D3).
  'node',
  'python',
  'python3',
  'perl',
  'ruby',
  'npx',
  'bunx',
  'deno',
  // The Windows launcher for python.
  'py',
]);

const FOLDED_WRAPPERS: ReadonlySet<string> = new Set(
  [...SHELL_WRAPPERS].map((word) => word.toLowerCase()),
);

/** A shell wrapper by any spelling that still runs it: PowerShell and cmd
 *  ignore case (`IEX`, `PowerShell.exe`), so does a Mac's disk (`Bash`), a
 *  path names the same program (`/bin/sh`, `C:\Windows\System32\cmd.exe`),
 *  and a versioned interpreter is the interpreter (`python3.12`, `perl5.34`). */
export function isShellWrapper(word: string): boolean {
  const base = programOf(word);
  return FOLDED_WRAPPERS.has(base) || /^(?:python|perl|ruby|node)[\d.]+$/.test(base);
}

/** The boundaries between the simple commands of a shell line. An `&` that
 *  belongs to a redirect (`2>&1`, `&>`) joins, never splits. */
const SEGMENT_SPLIT = /\n|;|&&|\|\||\||(?<![<>])&(?!>)/;

/** A redirect that leaves a segment harmless: a descriptor copied onto
 *  another (`2>&1`) or output thrown away (`> /dev/null`). Any other `>` or
 *  `>>` writes a file the permission engine never saw, so it breaks a match. */
const HARMLESS_REDIRECT = /(?:\d|&)?>>?\s*(?:&\d+|\/dev\/null)(?=\s|$)/g;

/** Would this one segment reach past its first word? A command
 *  substitution, a process substitution (`<(` or `>(`), or a redirect into a
 *  file all run or write something the prefix never named. */
function segmentEscapes(segment: string): boolean {
  if (segment.includes('$(') || segment.includes('`')) return true;
  if (segment.includes('<(') || segment.includes('>(')) return true;
  return segment.replace(HARMLESS_REDIRECT, ' ').includes('>');
}

/** Git's global options that point git at a program: `-c core.pager=...`
 *  and `-c alias.x=!...` run a command, `--config-env` does the same through
 *  a variable, and `--exec-path` swaps the folder git runs its helpers from. */
function gitRunsConfiguredProgram(words: string[]): boolean {
  for (let i = 1; i < words.length; i++) {
    const w = words[i]!;
    if (!w.startsWith('-')) return false;
    if (w === '-c' || w.startsWith('--config-env') || w.startsWith('--exec-path=')) return true;
    // `-C <dir>` takes the next word as its argument.
    if (w === '-C') i += 1;
  }
  return false;
}

/** A command's first word as the program it runs: its last path part,
 *  lowercased, without `.exe`. */
function programOf(word: string): string {
  return (word.split(/[\\/]/).pop() ?? word).toLowerCase().replace(/\.exe$/, '');
}

/**
 * Does every simple command in `command` start with exactly `prefix`?
 * Segments are split on `;`, `&&`, `||`, `|`, `&`, and newlines. A segment
 * with command substitution (`$(` or a backtick) or a shell-wrapper first
 * word never matches, because its real command is something else.
 *
 * The split is bash's grammar. Under PowerShell (Windows without Git Bash)
 * script blocks, the call operator and backtick escapes read differently, so
 * a prefix could reach a command it never named: no prefix grant matches
 * there, and every command asks. `shell` defaults to this computer's.
 */
export function commandMatchesPrefix(
  command: string,
  prefix: string,
  shell: ShellChoice['kind'] = shellForThisMachine().kind,
): boolean {
  if (shell === 'powershell') return false;
  if (!prefix || isShellWrapper(prefix)) return false;
  const segments = command
    .split(SEGMENT_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!segments.length) return false;
  return segments.every((segment) => {
    if (segmentEscapes(segment)) return false;
    const words = segment.split(/\s+/);
    const first = words[0] ?? '';
    if (programOf(first) === 'git' && gitRunsConfiguredProgram(words)) return false;
    if (carriesCode(words)) return false;
    return first === prefix && !isShellWrapper(first);
  });
}

/** Flags that hand an interpreter, a database client or a script runner the
 *  code to run on the command line: `-e` and `--eval` (node, perl, ruby,
 *  osascript, tsx), `-c` (python, psql, `npm exec -c`), `-p` and `--print`
 *  (node, perl). Python's `-m` needs no entry: every python spelling is a
 *  wrapper already. */
const CODE_FLAGS: ReadonlySet<string> = new Set(['-e', '-c', '-p', '--eval', '--print']);

/** File utilities whose `-c`, `-e` or `-p` means count, a pattern, or make
 *  the parents (`grep -c`, `mkdir -p`), never code, so their grants still
 *  save and match. */
const PLAIN_FLAG_PROGRAMS: ReadonlySet<string> = new Set([
  'mkdir',
  'cp',
  'mv',
  'ls',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'wc',
  'cut',
  'head',
  'tail',
  'sort',
  'uniq',
  'diff',
  'cat',
  'touch',
  'rm',
  'echo',
]);

/**
 * The words of one simple command as the shell hands them to the program:
 * quotes removed, a backslash escaping the next character. Undefined when a
 * quote is left open, which the callers read as "cannot tell", and so as code.
 */
export function shellWords(text: string): string[] | undefined {
  const out: string[] = [];
  let word = '';
  let has = false;
  let quote: "'" | '"' | undefined;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote === "'") {
      if (c === "'") quote = undefined;
      else word += c;
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = undefined;
      else if (c === '\\' && i + 1 < text.length && '"\\$`'.includes(text[i + 1]!))
        word += text[++i];
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      has = true;
    } else if (c === '\\') {
      if (i + 1 < text.length) word += text[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has || word) out.push(word);
      word = '';
      has = false;
    } else {
      word += c;
      has = true;
    }
  }
  if (quote) return undefined;
  if (has || word) out.push(word);
  return out;
}

/** find's actions that run a program on each file it finds. */
const FIND_RUNS: ReadonlySet<string> = new Set(['-exec', '-execdir', '-ok', '-okdir']);

/**
 * Whether one sed script runs a command: the `e` command, or the `e` flag on
 * `s`, which runs the pattern space. Read command by command in GNU sed's
 * grammar, and failing closed: anything it cannot read counts as code.
 */
export function sedScriptRunsCode(script: string): boolean {
  let i = 0;
  const n = script.length;
  const at = () => script[i] ?? '';
  const skipSpace = () => {
    while (i < n && /[ \t]/.test(at())) i++;
  };
  const toLineEnd = () => {
    while (i < n && at() !== '\n') {
      if (at() === '\\') i++;
      i++;
    }
  };
  const toLabelEnd = () => {
    while (i < n && at() !== '\n' && at() !== ';') i++;
  };
  /** Past one delimited part (a regex or a replacement); false when it never
   *  closes. */
  const delimited = (delim: string): boolean => {
    while (i < n) {
      const c = at();
      if (c === '\\') {
        i += 2;
        continue;
      }
      i++;
      if (c === delim) return true;
    }
    return false;
  };
  const address = (): boolean => {
    const c = at();
    if (/\d/.test(c)) {
      while (/[\d~]/.test(at())) i++;
      return true;
    }
    if (c === '$') {
      i++;
      return true;
    }
    if (c === '/' || c === '\\') {
      const delim = c === '/' ? '/' : script[i + 1];
      if (!delim || delim === '\n' || delim === '\\') return false;
      i += c === '/' ? 1 : 2;
      if (!delimited(delim)) return false;
      while (at() === 'I' || at() === 'M') i++;
      return true;
    }
    return true;
  };
  while (i < n) {
    const c = at();
    if (/[\s;]/.test(c)) {
      i++;
      continue;
    }
    if (c === '#') {
      toLineEnd();
      continue;
    }
    if (!address()) return true;
    if (at() === ',') {
      i++;
      if (at() === '+' || at() === '~') i++;
      if (!address()) return true;
    }
    skipSpace();
    if (at() === '!') i++;
    skipSpace();
    const cmd = at();
    i++;
    switch (cmd) {
      case 'e':
        return true;
      case 's': {
        const delim = at();
        if (!delim || delim === '\n' || delim === '\\') return true;
        i++;
        if (!delimited(delim) || !delimited(delim)) return true;
        while (/[gpiImMe0-9w]/.test(at())) {
          if (at() === 'e') return true;
          if (at() === 'w') {
            toLineEnd();
            break;
          }
          i++;
        }
        break;
      }
      case 'y': {
        const delim = at();
        if (!delim || delim === '\n' || delim === '\\') return true;
        i++;
        if (!delimited(delim) || !delimited(delim)) return true;
        break;
      }
      case 'a':
      case 'i':
      case 'c':
      case 'r':
      case 'R':
      case 'w':
      case 'W':
        toLineEnd();
        break;
      case ':':
      case 'b':
      case 't':
      case 'T':
      case 'v':
        toLabelEnd();
        break;
      case 'q':
      case 'Q':
      case 'l':
      case 'L':
        skipSpace();
        while (/\d/.test(at())) i++;
        break;
      case '{':
      case '}':
      case '=':
      case 'd':
      case 'D':
      case 'F':
      case 'g':
      case 'G':
      case 'h':
      case 'H':
      case 'n':
      case 'N':
      case 'p':
      case 'P':
      case 'x':
      case 'z':
        break;
      default:
        return true;
    }
  }
  return false;
}

/** sed's scripts (from `-e`, `--expression`, or its first operand) and
 *  whether any runs a command; a script read from a file cannot be seen, so
 *  it counts as code. */
function sedRunsCode(args: string[]): boolean {
  const scripts: string[] = [];
  const operands: string[] = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k]!;
    if (a === '--') {
      operands.push(...args.slice(k + 1));
      break;
    }
    if (a.startsWith('--')) {
      if (a === '--file' || a.startsWith('--file=')) return true;
      if (a.startsWith('--expression=')) scripts.push(a.slice('--expression='.length));
      else if (a === '--expression') scripts.push(args[++k] ?? '');
      else if (a === '--line-length') k++;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const flag = a[j]!;
        if (flag === 'f') return true;
        if (flag === 'e' || flag === 'l') {
          const value = a.slice(j + 1) || args[++k] || '';
          if (flag === 'e') scripts.push(value);
          break;
        }
        // -i takes the rest of its cluster as the backup suffix.
        if (flag === 'i') break;
      }
      continue;
    }
    operands.push(a);
  }
  if (!scripts.length && operands.length) scripts.push(operands[0]!);
  return scripts.some(sedScriptRunsCode);
}

/** tar's options that name a program for it to run: a checkpoint action, a
 *  program to pipe each file to, a compressor, a volume script, a remote
 *  shell. Old-style key letters (`tar xIf`) and short clusters count too. */
function tarRunsCode(args: string[]): boolean {
  return args.some(
    (a, k) =>
      /^--(?:checkpoint-action|to-command|use-compress-program|info-script|new-volume-script|rsh-command|rmt-command)(?:=|$)/.test(
        a,
      ) ||
      /^-[A-Za-z]*[IF]/.test(a) ||
      (k === 0 && /^[A-Za-z]+$/.test(a) && /[IF]/.test(a)),
  );
}

/** awk's program runs a command through `system()`, a pipe, or an extension
 *  it loads; a program read from a file cannot be seen. The program is the
 *  first operand after the options (`-v` and `-F` take a value). */
function awkRunsCode(args: string[]): boolean {
  for (let k = 0; k < args.length; k++) {
    const a = args[k]!;
    if (a === '--') return awkProgramRunsCode(args[k + 1]);
    if (/^(?:-f|--file|-E|--exec|-i|--include|-l|--load)(?:=|$)|^-[fEil]./.test(a)) return true;
    if (a === '-v' || a === '-F' || a === '--assign' || a === '--field-separator') {
      k++;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) continue;
    return awkProgramRunsCode(a);
  }
  return false;
}

function awkProgramRunsCode(program: string | undefined): boolean {
  return Boolean(program && /\bsystem\s*\(|\||@load|@include/.test(program));
}

/** Programs whose own grammar can run another program, read per program. */
const PROGRAM_RUNS_CODE: Readonly<Record<string, (args: string[]) => boolean>> = {
  find: (args) => args.some((a) => FIND_RUNS.has(a)),
  gfind: (args) => args.some((a) => FIND_RUNS.has(a)),
  sed: sedRunsCode,
  gsed: sedRunsCode,
  tar: tarRunsCode,
  gtar: tarRunsCode,
  bsdtar: tarRunsCode,
  awk: awkRunsCode,
  gawk: awkRunsCode,
  mawk: awkRunsCode,
  nawk: awkRunsCode,
};

/** Does this simple command hand its program code on the command line? A
 *  code flag (`-e`, `-c`, `--eval`), or a program whose own grammar runs
 *  another: `find -exec`, sed's `e`, tar's `--to-command`, awk's `system()`. */
function carriesCode(words: string[]): boolean {
  const program = programOf(words[0] ?? '');
  const special = PROGRAM_RUNS_CODE[program];
  if (special) {
    const argv = shellWords(words.slice(1).join(' '));
    if (!argv || special(argv)) return true;
  }
  if (PLAIN_FLAG_PROGRAMS.has(program)) return false;
  return words.slice(1).some((w) => CODE_FLAGS.has(w));
}

/**
 * Why "always allow this command in this project" cannot be saved for
 * `command`, in one plain sentence, or undefined when it can. The rule the
 * loop would save is the first word, so it is refused when that word runs
 * other programs (a wrapper or an interpreter, which covers python's `-m`),
 * when the command hands a program code on its command line (`-e`, `-c`,
 * `-p`, `--eval`), when git is pointed at a program (`git -c`), and under
 * PowerShell, where no prefix grant ever matches (D3, tech review 10). Matching
 * refuses the same commands, so a rule saved from a plain call never
 * reaches a later one that carries code.
 */
export function prefixGrantRefusal(
  command: string,
  shell: ShellChoice['kind'] = shellForThisMachine().kind,
): string | undefined {
  const words = command.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? '';
  if (shell === 'powershell') {
    return 'Commands run in PowerShell on this computer, where a saved command rule never applies, so it will keep asking.';
  }
  if (!first || isShellWrapper(first)) {
    return 'That command starts with a shell wrapper, so it will keep asking.';
  }
  if (programOf(first) === 'git' && gitRunsConfiguredProgram(words)) {
    return 'That git command sets a program for git to run (git -c), so it will keep asking.';
  }
  if (carriesCode(words)) {
    return 'That command runs code written on its own command line, so it will keep asking.';
  }
  return undefined;
}

export interface PermissionConfig {
  /** Baseline decision per risk class. */
  defaults: Record<ToolRisk, Decision>;
  /** Fine-grained overrides, evaluated top down, first match wins. */
  rules: PermissionRule[];
  /** Repos the user marked trusted: writes inside them flow without asking. */
  trustedRepos: string[];
}

export const DEFAULT_PERMISSIONS: PermissionConfig = {
  defaults: {
    read: 'allow',
    network: 'allow', // web search and fetch, still governed by the egress policy
    write: 'ask',
    shell: 'ask',
    push: 'ask',
    'cloud-spend': 'ask',
  },
  rules: [],
  trustedRepos: [],
};

export interface PermissionQuery {
  toolName: string;
  risk: ToolRisk;
  /** Primary path argument, when the tool has one. */
  path?: string;
  /** The shell command, when the tool runs one (prefix-scoped rules). */
  command?: string;
  /** Workspace root, used for the trusted-repo check. */
  cwd?: string;
  /** The tool declared it must always ask. Overrides every auto-allow path. */
  alwaysAsk?: boolean;
}

export interface PermissionResult {
  decision: Decision;
  /** One human sentence explaining the decision, shown in approval prompts. */
  reason: string;
  /** An ask no permission mode may turn into an allow (Accept edits and
   *  Bypass included): a write to a file that decides what code runs. */
  sticky?: boolean;
}

/**
 * Workspace files the agent must not quietly rewrite, because they decide what
 * code runs. Writes under .git are refused outright: .git/config can name a
 * program git runs on its own (core.fsmonitor, core.hooksPath), so one silent
 * write would turn the next `git status` into code execution. OpenShore's own
 * os-code.config.json and the coding CLIs' settings folders (Claude Code hooks,
 * a Codex config) always ask, in every mode, since a quiet edit there changes
 * what runs next time. `path` is workspace-relative, as the jail computed it.
 */
export function protectedWrite(path: string): 'deny' | 'ask' | undefined {
  const segments = permissionPath(path).replace(/^\.\//, '').split('/').map(protectedName);
  if (segments.includes('.git') || segments.some((s) => /^git~\d+$/.test(s))) return 'deny';
  if (segments[segments.length - 1] === 'os-code.config.json') return 'ask';
  if (segments.includes('.claude') || segments.includes('.codex')) return 'ask';
  return undefined;
}

/** Whether a rule's glob covers a path. A deny or an ask also matches
 *  folded (NFC, lowercase), so `secrets/**` fences `Secrets/k`, which a Mac or
 *  Windows disk opens as the same folder (security review 2026-09-29). An
 *  allow matches the spelling exactly, so folding only ever makes a decision
 *  stricter, never looser. Folded on every platform, as protectedWrite is: on
 *  a disk that tells case apart it fences a sibling spelling too. */
export function ruleMatchesPath(path: string, glob: string, decision: Decision): boolean {
  if (minimatch(path, glob)) return true;
  return decision !== 'allow' && minimatch(foldPath(path), foldPath(glob));
}

/** A path as the permission engine compares it: a backslash is a separator
 *  (the Windows spelling, and what a model writes there), then the dotted
 *  segments are folded away (`./a`, `a/../b`), so a glob sees one spelling. */
export function permissionPath(path: string): string {
  return posix.normalize(path.replace(/\\/g, '/'));
}

/** One path segment as a disk that ignores case and Windows would open it:
 *  folded (`.GIT` is `.git` on a Mac or Windows disk), with Windows' trailing
 *  dots and spaces dropped (`.git.` opens `.git`) and any stream name cut
 *  (`.git::$INDEX_ALLOCATION`). A short name like `GIT~1` is caught by the
 *  caller. For comparing only, never for writing. */
function protectedName(segment: string): string {
  const colon = segment.indexOf(':');
  const folded = foldPath(colon === -1 ? segment : segment.slice(0, colon));
  return folded.replace(/[. ]+$/, '') || folded;
}

export class PermissionEngine {
  private sessionAllows = new Set<string>();
  /** Scoped allows granted during this session ("always in this project"
   *  before the config is reloaded). Evaluated after the config rules, so a
   *  configured deny still wins. */
  private sessionRules: PermissionRule[] = [];

  constructor(
    private readonly config: PermissionConfig = DEFAULT_PERMISSIONS,
    private readonly profile?: SecurityProfile,
    /** A routine may run webSearch, and only webSearch, unattended: the person
     *  allowed web search and the registry kept the tool (2026-10-01). */
    private readonly offlineWebSearch = false,
    /** Opening a web page (2026-10-02): `ask` before each page unless
     *  this session allowed it, or `allow`. A permission rule still wins. */
    private readonly webFetchMode: 'ask' | 'allow' = 'allow',
  ) {}

  /** Grant "always allow for this session" for one tool. Profile-gated. */
  allowForSession(toolName: string): boolean {
    if (this.profile && !this.profile.allowSessionAutoApprove) return false;
    this.sessionAllows.add(toolName);
    return true;
  }

  /** Add a scoped rule for the rest of this session. Profile-gated the same
   *  way as a session grant; the restrictive-profile check on shell and cloud
   *  allows applies at decision time as for every rule. */
  addSessionRule(rule: PermissionRule): boolean {
    if (this.profile && !this.profile.allowSessionAutoApprove) return false;
    this.sessionRules.push(rule);
    return true;
  }

  /** On a restrictive profile, no allow (session grant, rule, or configured
   *  default) may make a shell, push, or cloud-spend step silent. */
  private autoAllowBlocked(risk: ToolRisk, toolName?: string): boolean {
    if (!this.profile) return false;
    if (risk === 'shell') return !this.profile.allowShellAutoApprove;
    if (risk === 'cloud-spend') return !this.profile.allowCloudAutoApprove;
    if (risk === 'push') return !this.profile.allowPushAutoApprove;
    if (risk === 'network') {
      if (this.offlineWebSearch && toolName === 'webSearch') return false;
      return !this.profile.allowNetworkAutoApprove;
    }
    return false;
  }

  /** A network step on a profile with nobody to ask (headless) is denied,
   *  never asked: an unanswered ask would hold the run for 15 minutes and
   *  then decline anyway, and the step is one an injected line could use to
   *  send a secret out (tech review 3). */
  private networkRefused(risk: ToolRisk, toolName?: string): boolean {
    return risk === 'network' && this.autoAllowBlocked(risk, toolName);
  }

  decide(q: PermissionQuery): PermissionResult {
    const result = this.evaluate(q);
    // An always-ask tool prompts every time: no session grant, permission
    // rule, or trusted repo can make it silent. This is the "never silent"
    // guarantee for agent vault writes. It only ever turns an allow into an
    // ask; a deny (a rule, a deny default) still wins, so a person can switch
    // vault writes off or fence a folder (Vault v1, 1.6).
    if (q.alwaysAsk && result.decision !== 'deny') {
      return { decision: 'ask', reason: 'this action always asks first' };
    }
    return result;
  }

  private evaluate(q: PermissionQuery): PermissionResult {
    // Belt and braces under the loop's jail-based normalization (ENG-3): a
    // dotted spelling (`./secrets/k`, `src/../secrets/k`) or a backslashed one
    // (`secrets\\k`) must match the same globs as the plain one, whoever
    // built the query.
    const path = q.path === undefined ? undefined : permissionPath(q.path);

    // Headless means offline: before any grant, rule, or default can allow it.
    if (this.networkRefused(q.risk, q.toolName)) {
      return {
        decision: 'deny',
        reason: `routines work offline, so ${q.toolName} does not run on the ${this.profile?.name ?? 'restricted'} profile`,
      };
    }

    // Files that decide what code runs, before any grant, rule, or trusted
    // repo can make a write to them quiet (see protectedWrite).
    if (q.risk === 'write' && path !== undefined) {
      const guard = protectedWrite(path);
      if (guard === 'deny') {
        return {
          decision: 'deny',
          reason: 'the agent never writes inside .git, where a setting can make git run a program',
        };
      }
      if (guard === 'ask') {
        return {
          decision: 'ask',
          reason: 'this file decides what runs, so a change to it always asks',
          sticky: true,
        };
      }
    }

    // Narrow, built-in exception (ruling): the coding agent keeps each
    // project's five memory notes current, and those writes land silently but
    // visibly. Only this dedicated tool, and only a managed memory file in the
    // repo's "OpenShore Project <name> MDs/", is auto-allowed here; every general
    // vault write stays always-ask above. The write tool is itself hard-scoped
    // to those five files, so this is defense in depth, not the only guard.
    if (q.toolName === PROJECT_MEMORY_WRITE_TOOL && path !== undefined && isMemoryFilePath(path)) {
      return { decision: 'allow', reason: 'project memory note, kept current by the agent' };
    }

    // Session grants never apply to shell or cloud spend on restrictive
    // profiles, and never to an always-ask tool, whose grant could only mean
    // "ask" and must not hide a deny rule below it.
    if (
      !q.alwaysAsk &&
      this.sessionAllows.has(q.toolName) &&
      !this.autoAllowBlocked(q.risk, q.toolName)
    ) {
      return { decision: 'allow', reason: 'allowed for this session' };
    }

    for (const rule of [...this.config.rules, ...this.sessionRules]) {
      if (rule.tool !== '*' && rule.tool !== q.toolName) continue;
      if (rule.pathGlob) {
        if (!path || !ruleMatchesPath(path, rule.pathGlob, rule.decision)) continue;
      }
      if (rule.commandPrefix) {
        if (!q.command || !commandMatchesPrefix(q.command, rule.commandPrefix)) continue;
      }
      // A configured allow is no louder than a session grant: on the phone or
      // headless profile it cannot make shell or cloud spend silent (ENG-4).
      if (rule.decision === 'allow' && this.autoAllowBlocked(q.risk, q.toolName)) continue;
      return { decision: rule.decision, reason: `permission rule for ${rule.tool}` };
    }

    // Opening a web page asks first unless the person set it to always allow,
    // or allowed it for this session (above).
    if (q.toolName === 'webFetch' && this.webFetchMode === 'ask') {
      return { decision: 'ask', reason: 'opening a web page asks first (Settings)' };
    }

    if (q.risk === 'write' && q.cwd && this.config.trustedRepos.includes(q.cwd)) {
      return { decision: 'allow', reason: 'trusted repo, writes flow without asking' };
    }

    const decision = this.config.defaults[q.risk];
    // The configured default is no louder than a rule: a config that sets
    // shell (or push, or cloud spend) to allow cannot make it silent on the
    // phone or headless profile. A routine running at 3am asks, or is denied
    // when no one answers; it never runs a shell command unattended (the tech review's
    // must-fix for unattended crew).
    if (decision === 'allow' && this.autoAllowBlocked(q.risk, q.toolName)) {
      return {
        decision: 'ask',
        reason: `${q.risk} never runs silently on the ${this.profile?.name ?? 'restricted'} profile`,
      };
    }
    return { decision, reason: `default for ${q.risk} tools` };
  }
}
