// Your Claude Code commands work here (P3, CTO wave-3). A person's command
// files (the repository's .claude/commands, their own ~/.claude/commands) run
// as /name: the chat shows what they typed, the file's filled-in text rides in
// the preamble, and nothing else changes. OpenShore's own names win, then the
// repository's, then the person's own, and a file that loses is reported. A
// file that links out of its folder, or is too big, is refused. The system
// prompt is the same byte for byte whether a folder has commands or not.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  BUILT_IN_COMMANDS,
  COMMAND_FILE_MAX_BYTES,
  COMMAND_FILES_MAX,
  commandNotLoadedLine,
  commandNotRunNote,
  expandCommandBody,
  parseCommandFile,
  parseSlashInput,
} from '../src/core/agent/commandText.js';
import { discoverCommands } from '../src/core/agent/customCommands.js';
import { LocalDriver, type DriverEvent } from '../src/daemon/session.js';
import {
  SLASH_COMMANDS,
  findRepoCommand,
  repoCommandHelp,
  slashMatches,
} from '../src/tui/slash.js';
import type { ChatRequest } from '../src/providers/types.js';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import { removeTempDir } from './helpers/portable.js';

let work: string;
let outside: string;
const oscHome = () => process.env.OSC_HOME!;
const claudeDir = () => process.env.CLAUDE_CONFIG_DIR!;

function put(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function clearDir(dir: string): void {
  for (const entry of readdirSync(dir)) rmSync(join(dir, entry), { recursive: true, force: true });
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'osc-cmd-work-'));
  outside = mkdtempSync(join(tmpdir(), 'osc-cmd-outside-'));
  // The person's own folders are the suite's temp homes (test/helpers/setup).
  rmSync(join(oscHome(), 'commands'), { recursive: true, force: true });
  clearDir(claudeDir());
});

afterEach(async () => {
  await removeTempDir(work);
  await removeTempDir(outside);
});

const names = (found: ReturnType<typeof discoverCommands>) => found.commands.map((c) => c.name);

describe('finding the commands', () => {
  it('reads every folder, in order, with the words a menu shows', () => {
    put(join(work, '.oscode/commands/ship.md'), 'Ship it.');
    put(
      join(work, '.claude/commands/review.md'),
      '---\ndescription: Review a pull request\nargument-hint: [pr-number] [priority]\n---\nReview PR $1.',
    );
    put(
      join(work, '.claude/commands/frontend/component.md'),
      '# Build a component\n\nMake $ARGUMENTS.',
    );
    put(
      join(work, '.claude/skills/pdf-tools/SKILL.md'),
      '---\nname: pdf-tools\ndescription: Work with PDFs\n---\nUse pdftotext.',
    );
    put(join(oscHome(), 'commands/standup.md'), 'Write my standup.');
    put(join(claudeDir(), 'commands/Fix-Issue.md'), 'Fix issue $1.');

    const found = discoverCommands(work);
    expect(names(found)).toEqual([
      'ship',
      'review',
      'component',
      'pdf-tools',
      'standup',
      'fix-issue',
    ]);
    expect(found.notLoaded).toEqual([]);
    const review = found.commands.find((c) => c.name === 'review')!;
    expect(review).toMatchObject({
      from: 'project',
      file: '.claude/commands/review.md',
      description: 'Review a pull request',
      // Kept as written: YAML would refuse this line, Claude Code shows it.
      argumentHint: '[pr-number] [priority]',
      body: 'Review PR $1.',
    });
    // No description: the first line of prose stands in.
    expect(found.commands.find((c) => c.name === 'component')!.description).toBe(
      'Build a component',
    );
    expect(found.commands.find((c) => c.name === 'pdf-tools')).toMatchObject({
      file: '.claude/skills/pdf-tools/SKILL.md',
      description: 'Work with PDFs',
    });
    expect(found.commands.find((c) => c.name === 'fix-issue')!.from).toBe('user');
  });

  it("OpenShore's own commands win, then the repository's, and each loser is reported", () => {
    put(join(work, '.claude/commands/help.md'), 'Not the help.');
    put(join(work, '.claude/commands/review.md'), 'The repository review.');
    put(join(work, '.oscode/commands/review.md'), 'The OpenShore-folder review.');
    put(join(claudeDir(), 'commands/review.md'), 'My own review.');
    put(join(oscHome(), 'commands/mine.md'), 'Mine first.');
    put(join(claudeDir(), 'commands/mine.md'), 'Mine second.');

    const found = discoverCommands(work);
    expect(names(found)).toEqual(['review', 'mine']);
    expect(found.commands[0]!.body).toBe('The OpenShore-folder review.');
    expect(found.commands[1]!.body).toBe('Mine first.');
    expect(found.notLoaded).toEqual([
      {
        file: '.claude/commands/help.md',
        name: 'help',
        from: 'project',
        reason: 'built-in',
      },
      {
        file: '.claude/commands/review.md',
        name: 'review',
        from: 'project',
        reason: 'shadowed',
        by: 'project',
      },
      expect.objectContaining({ name: 'mine', from: 'user', reason: 'shadowed', by: 'user' }),
      expect.objectContaining({ name: 'review', from: 'user', reason: 'shadowed', by: 'project' }),
    ]);
    const lines = found.notLoaded.map(commandNotLoadedLine);
    expect(lines[0]).toBe(
      "/help (.claude/commands/help.md) was not loaded: OpenShore's own /help comes first.",
    );
    expect(lines[2]).toContain('another /mine on your computer was found first.');
    expect(lines[3]).toContain('this repository has its own /review, and it comes first.');
    // Every built-in name is reserved, the terminal's and the composer's.
    for (const c of SLASH_COMMANDS) expect(BUILT_IN_COMMANDS).toContain(c.name.slice(1));
  });

  it('refuses a linked file whose real path leaves its folder, and keeps a link inside it', () => {
    put(join(outside, 'secret.md'), 'PRIVATE KEY');
    put(join(work, '.claude/commands/real.md'), 'The real one.');
    symlinkSync(join(outside, 'secret.md'), join(work, '.claude/commands/leak.md'));
    symlinkSync(join(work, '.claude/commands/real.md'), join(work, '.claude/commands/alias.md'));
    // A linked subfolder that leaves is not followed either.
    mkdirSync(join(outside, 'more'));
    put(join(outside, 'more/sneak.md'), 'PRIVATE');
    symlinkSync(join(outside, 'more'), join(work, '.claude/commands/more'));

    const found = discoverCommands(work);
    expect(names(found)).toEqual(['alias', 'real']);
    expect(JSON.stringify(found.commands)).not.toContain('PRIVATE');
    expect(found.notLoaded).toEqual([
      { file: '.claude/commands/more', from: 'project', reason: 'outside-folder' },
      { file: '.claude/commands/leak.md', name: 'leak', from: 'project', reason: 'outside-folder' },
    ]);
    expect(commandNotLoadedLine(found.notLoaded[1]!)).toBe(
      '/leak (.claude/commands/leak.md) was not loaded: it links to a file outside its commands folder.',
    );
  });

  it("refuses a repository's commands folder that is a link out of the workspace", () => {
    put(join(outside, 'commands/steal.md'), 'PRIVATE');
    mkdirSync(join(work, '.claude'));
    symlinkSync(join(outside, 'commands'), join(work, '.claude/commands'));
    const found = discoverCommands(work);
    expect(found.commands).toEqual([]);
    expect(found.notLoaded).toEqual([
      { file: '.claude/commands', from: 'project', reason: 'outside-folder' },
    ]);
  });

  it('reads a file of 16 KB, reports one over it, and looks at 200 files at most', () => {
    put(join(work, '.claude/commands/edge.md'), 'x'.repeat(COMMAND_FILE_MAX_BYTES));
    put(join(work, '.claude/commands/huge.md'), 'x'.repeat(COMMAND_FILE_MAX_BYTES + 1));
    let found = discoverCommands(work);
    expect(names(found)).toEqual(['edge']);
    expect(found.notLoaded).toEqual([
      { file: '.claude/commands/huge.md', name: 'huge', from: 'project', reason: 'too-large' },
    ]);
    expect(commandNotLoadedLine(found.notLoaded[0]!)).toContain('the file is over 16 KB');

    rmSync(join(work, '.claude'), { recursive: true });
    for (let i = 0; i < COMMAND_FILES_MAX + 5; i++) {
      put(join(work, `.claude/commands/c${String(i).padStart(3, '0')}.md`), `Command ${i}.`);
    }
    put(join(claudeDir(), 'commands/never.md'), 'Never looked at.');
    found = discoverCommands(work);
    expect(found.commands).toHaveLength(COMMAND_FILES_MAX);
    expect(names(found)).not.toContain('never');
    expect(found.notLoaded).toEqual([
      { file: '.claude/commands', from: 'project', reason: 'too-many' },
    ]);
  });

  it('reports a name a command cannot carry, and reads a shared folder once', () => {
    put(join(work, '.claude/commands/my command.md'), 'Spaces.');
    expect(discoverCommands(work).notLoaded).toEqual([
      { file: '.claude/commands/my command.md', from: 'project', reason: 'bad-name' },
    ]);
    // A session in the folder that holds Claude Code's own: one read, no
    // report of every command against itself.
    const home = mkdtempSync(join(tmpdir(), 'osc-cmd-home-'));
    try {
      put(join(home, '.claude/commands/one.md'), 'One.');
      const previous = process.env.CLAUDE_CONFIG_DIR;
      process.env.CLAUDE_CONFIG_DIR = join(home, '.claude');
      try {
        const found = discoverCommands(home);
        expect(names(found)).toEqual(['one']);
        expect(found.notLoaded).toEqual([]);
      } finally {
        process.env.CLAUDE_CONFIG_DIR = previous;
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('reading and filling a command', () => {
  it('keeps description and argument-hint, and sets allowed-tools and model aside', () => {
    const file = parseCommandFile(
      '---\nallowed-tools: Bash(git add:*), Bash(git commit:*)\nargument-hint: [message]\ndescription: "Create a git commit"\nmodel: claude-3-5-haiku-20241022\n---\n\n## Context\n\nCommit with $ARGUMENTS.\n',
    );
    expect(file).toEqual({
      description: 'Create a git commit',
      argumentHint: '[message]',
      body: '## Context\n\nCommit with $ARGUMENTS.\n',
      asksFor: ['tools', 'model'],
    });
    // Nothing of the frontmatter reaches the text a task gets.
    expect(file.body).not.toContain('allowed-tools');
    expect(file.body).not.toContain('haiku');
  });

  it('fills $ARGUMENTS and $1, $2, the way Claude Code does', () => {
    expect(
      expandCommandBody('Fix issue #$1 with priority $2. All: $ARGUMENTS', '123 high').text,
    ).toBe('Fix issue #123 with priority high. All: 123 high');
    // A quoted run is one word; a missing one is empty.
    expect(expandCommandBody('[$1] [$2] [$3]', '"two words" next').text).toBe(
      '[two words] [next] []',
    );
    // A body with no slot gets the words on an ARGUMENTS line.
    expect(expandCommandBody('Review the code.\n', 'src/a.ts').text).toBe(
      'Review the code.\n\nARGUMENTS: src/a.ts',
    );
    expect(expandCommandBody('Review the code.', '').text).toBe('Review the code.');
    // What the person typed is never filled in again.
    expect(expandCommandBody('Say $ARGUMENTS', '$1 and $ARGUMENTS').text).toBe(
      'Say $1 and $ARGUMENTS',
    );
  });

  it('turns ! lines into text and a list, and runs nothing', () => {
    const out = expandCommandBody(
      '## Context\n- Status: !`git status`\n!git diff HEAD\n![a picture](shot.png)\nThen commit.',
      '',
    );
    expect(out.notRun).toEqual(['git status', 'git diff HEAD']);
    expect(out.text).toContain('- Status: `git status` (not run)');
    expect(out.text).toContain(
      '(Not run: `git diff HEAD`. OpenShore does not run commands from a command file.)',
    );
    expect(out.text).toContain('![a picture](shot.png)');
    expect(commandNotRunNote('commit', out.notRun)).toBe(
      '/commit asked to run "git status" and "git diff HEAD" first. OpenShore did not run them: a command file never runs anything on its own.',
    );
    // A ! the person typed is theirs, not the file's.
    expect(expandCommandBody('Do $ARGUMENTS', '!`rm -rf /`').notRun).toEqual([]);
  });

  it('reads /name and its arguments, a - in the name included', () => {
    expect(parseSlashInput('/Fix-Issue 123 high')).toEqual({ name: 'fix-issue', args: '123 high' });
    expect(parseSlashInput('  /review\nline two')).toEqual({ name: 'review', args: 'line two' });
    expect(parseSlashInput('/')).toBeUndefined();
    expect(parseSlashInput('/ review')).toBeUndefined();
    expect(parseSlashInput('review this')).toBeUndefined();
  });
});

// ---- through the session driver, the way the daemon and the desktop run it --

async function waitFor(check: () => boolean, ms = 10_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

interface Run {
  driver: LocalDriver;
  provider: MockProvider;
  events: DriverEvent[];
  approvals: number;
  first: ChatRequest;
  permissionMode: string;
}

/** One task through a LocalDriver whose agent is a real AgentSession on the
 *  mock provider, in `work`. */
async function runThrough(text: string, turns = [textTurn('done')]): Promise<Run> {
  const provider = new MockProvider('mock', turns);
  const driver = new LocalDriver(work, { persist: false, checkpoints: false });
  const session = makeTestSession(provider, {
    cwd: work,
    approve: () => ({ approve: false }),
    onEvent: (event) => driver.emit(event),
  });
  const events: DriverEvent[] = [];
  driver.onEvent((e) => events.push(e));
  driver.attachAgent(session.agent);
  driver.send(text);
  await waitFor(() => events.some((e) => e.type === 'task-done') && !driver.busy);
  return {
    driver,
    provider,
    events,
    approvals: session.approvals.length,
    first: provider.requests[0]!,
    permissionMode: session.agent.permissionMode,
  };
}

const systemOf = (r: ChatRequest) => JSON.stringify(r.messages.find((m) => m.role === 'system'));
const userOf = (r: ChatRequest) => {
  const user = r.messages.filter((m) => m.role === 'user').at(-1)!;
  return typeof user.content === 'string' ? user.content : JSON.stringify(user.content);
};

describe('running a command in a session', () => {
  it('shows what the person typed, and the filled-in file rides in the preamble', async () => {
    put(
      join(work, '.claude/commands/review.md'),
      '---\ndescription: Review a file\n---\nReview $1 for bugs. Focus: $2.',
    );
    const run = await runThrough('/review src/a.ts security');
    expect(run.events.find((e) => e.type === 'task-start')).toEqual({
      type: 'task-start',
      input: '/review src/a.ts security',
    });
    const user = userOf(run.first);
    expect(user).toContain(
      '[command] The person ran /review, saved in this repository at .claude/commands/review.md.',
    );
    expect(user).toContain(
      '<command name="review">\nReview src/a.ts for bugs. Focus: security.\n</command>',
    );
    expect(user.endsWith('\n\n/review src/a.ts security')).toBe(true);
    expect(user).not.toContain('description: Review a file');
  });

  it('leaves any other slash text as it is', async () => {
    const run = await runThrough('/nothing here');
    expect(userOf(run.first)).toBe('/nothing here');
  });

  it('keeps the system prompt byte-identical with and without commands', async () => {
    const without = await runThrough('hello');
    put(join(work, '.claude/commands/review.md'), 'Review $ARGUMENTS.');
    put(join(claudeDir(), 'commands/standup.md'), 'Write my standup.');
    const plain = await runThrough('hello');
    const ran = await runThrough('/review src/a.ts');
    expect(userOf(ran.first)).toContain('Review src/a.ts.');
    expect(systemOf(plain.first)).toBe(systemOf(without.first));
    expect(systemOf(ran.first)).toBe(systemOf(without.first));
    // And the tools offered are the same list.
    expect(ran.first.tools).toEqual(without.first.tools);
  });

  it('runs no ! line, and says so right under the message', async () => {
    put(join(work, '.claude/commands/commit.md'), 'Context: !`touch ran.txt`\nCommit it.');
    const run = await runThrough('/commit');
    expect(existsSync(join(work, 'ran.txt'))).toBe(false);
    const start = run.events.findIndex((e) => e.type === 'task-start');
    expect(run.events[start + 1]).toEqual({
      type: 'note',
      message:
        '/commit asked to run "touch ran.txt" first. OpenShore did not run it: a command file never runs anything on its own.',
    });
    expect(userOf(run.first)).toContain('The file asked to run `touch ran.txt` first.');
  });

  it('never loosens anything: its tools and model are ignored, and a shell step still asks', async () => {
    const baseline = await runThrough('hello');
    put(
      join(work, '.claude/commands/yolo.md'),
      '---\nallowed-tools: Bash(*), Write(*)\nmodel: claude-opus-4-1\npermission-mode: bypassPermissions\n---\nRun the build.',
    );
    const run = await runThrough('/yolo', [
      toolTurn('runShell', { command: 'echo hi' }),
      textTurn('done'),
    ]);
    // The shell step asked, as it does without the command (shell: ask).
    expect(run.approvals).toBe(1);
    expect(run.first.model).toBe(baseline.first.model);
    expect(run.first.tools).toEqual(baseline.first.tools);
    expect(run.permissionMode).toBe(baseline.permissionMode);
    const user = userOf(run.first);
    expect(user).not.toContain('allowed-tools');
    expect(user).not.toContain('claude-opus');
    expect(user).not.toContain('bypassPermissions');
    expect(run.events).toContainEqual({
      type: 'note',
      message:
        '/yolo asks for its own tools and model. OpenShore ignores that: your model and your permission mode stay as they are.',
    });
  });
});

describe('the repo-info event carries the list', () => {
  it('says the commands and what was left out, then only when they change', async () => {
    put(join(work, '.claude/commands/review.md'), '---\nargument-hint: <file>\n---\nReview it.');
    put(join(work, '.claude/commands/help.md'), 'Shadowed by the built-in.');
    put(join(claudeDir(), 'commands/standup.md'), 'Standup.');
    const run = await runThrough('hello');
    await waitFor(() => run.events.filter((e) => e.type === 'repo-info').length >= 3);
    const infos = run.events.filter(
      (e): e is Extract<DriverEvent, { type: 'repo-info' }> => e.type === 'repo-info',
    );
    // The first, said as the agent attached, before any task.
    expect(infos[0]!.commands).toEqual([
      { name: 'review', from: 'project', argumentHint: '<file>', description: 'Review it.' },
      { name: 'standup', from: 'user', description: 'Standup.' },
    ]);
    expect(infos[0]!.commandsNotLoaded).toEqual([
      { file: '.claude/commands/help.md', name: 'help', from: 'project', reason: 'built-in' },
    ]);
    expect(run.events.indexOf(infos[0]!)).toBeLessThan(
      run.events.findIndex((e) => e.type === 'task-start'),
    );
    // Unchanged since: the later ones carry the branch chip only.
    for (const info of infos.slice(1)) expect(info.commands).toBeUndefined();
    // A new file: the list rides again on the next one.
    put(join(work, '.claude/commands/ship.md'), 'Ship.');
    await run.driver.emitRepoInfo();
    const last = run.events.filter((e) => e.type === 'repo-info').at(-1) as Extract<
      DriverEvent,
      { type: 'repo-info' }
    >;
    expect(last.commands?.map((c) => c.name)).toEqual(['review', 'ship', 'standup']);
    // Names and words only: a command's text never rides the event.
    expect(JSON.stringify(run.events.filter((e) => e.type === 'repo-info'))).not.toContain(
      'Shadowed by the built-in.',
    );
  });

  it('says nothing new for a folder with no commands', async () => {
    const run = await runThrough('hello');
    await waitFor(() => run.events.filter((e) => e.type === 'repo-info').length >= 2);
    for (const e of run.events) {
      if (e.type === 'repo-info') expect(e.commands).toBeUndefined();
    }
  });
});

describe('the terminal lists them too', () => {
  const list = {
    commands: [
      {
        name: 'review',
        from: 'project' as const,
        description: 'Review a PR',
        argumentHint: '<pr>',
      },
      { name: 'fix-issue', from: 'user' as const },
    ],
    notLoaded: [
      {
        file: '.claude/commands/help.md',
        name: 'help',
        from: 'project' as const,
        reason: 'built-in' as const,
      },
    ],
  };

  it('/help names each with where it came from, and what was not loaded', () => {
    expect(repoCommandHelp(list)).toEqual([
      'From this repository:',
      '  /review <pr>  Review a PR',
      'From your computer:',
      '  /fix-issue',
      'Not loaded:',
      "  /help (.claude/commands/help.md) was not loaded: OpenShore's own /help comes first.",
    ]);
    expect(repoCommandHelp({ commands: [], notLoaded: [] })).toEqual([]);
  });

  it('hints them after the built-ins and knows a line that runs one', () => {
    expect(
      slashMatches('/', list, 20)
        .map((m) => m.name)
        .slice(-2),
    ).toEqual(['/review', '/fix-issue']);
    expect(slashMatches('/fix', list)).toEqual([
      { name: '/fix-issue', description: '(from your computer)' },
    ]);
    expect(slashMatches('/re', list)[0]).toEqual({
      name: '/review',
      description: 'Review a PR (from this repository)',
    });
    expect(findRepoCommand('/fix-issue 12', list)?.name).toBe('fix-issue');
    expect(findRepoCommand('/help', list)).toBeUndefined();
    expect(findRepoCommand('/review', undefined)).toBeUndefined();
  });
});
