// The --plain renderer: no Ink, no cursor tricks, just clean sequential
// output and readline prompts. For dumb terminals, CI capture, screen
// readers, and the narrowest phone screens. Still considered: color when the
// terminal has it, aligned tool lines, the same approval rhythm.
import { createInterface, type Interface } from 'node:readline';
import { GLYPHS, banner, t } from '../brand/theme.js';
import type { ApprovalRequest } from '../core/agent/types.js';
import type { DriverEvent, SessionDriver } from '../daemon/session.js';
import { runSlash, type SlashContext } from './slash.js';

export interface PlainOptions {
  driver: SessionDriver;
  initialPrompt?: string;
  stackDescription: string;
  setWebEnabled?: (on: boolean) => void;
  webEnabled?: () => boolean;
}

export async function runPlain(options: PlainOptions): Promise<void> {
  const { driver } = options;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // A plain-text log of everything shown, so /find works here too. Bounded so
  // a long session never grows without limit.
  const log: string[] = [];
  const LOG_CAP = 5000;
  const record = (line: string) => {
    log.push(line);
    if (log.length > LOG_CAP) log.shift();
  };
  const out = (text: string) => {
    record(text);
    process.stdout.write(`${text}\n`);
  };
  let dollars = 0;
  let pendingApproval: ApprovalRequest | undefined;
  let taskResolve: (() => void) | undefined;

  out(banner());
  out(
    t.muted(
      `workspace ${driver.cwd} ${GLYPHS.bullet} plain mode ${GLYPHS.bullet} /help for commands`,
    ),
  );

  let streamBuf = '';
  const unsubscribe = driver.subscribe((event: DriverEvent) => {
    switch (event.type) {
      case 'text-delta':
        streamBuf += event.text;
        process.stdout.write(event.text);
        break;
      case 'text-final':
        if (streamBuf.trim()) record(streamBuf.trim());
        streamBuf = '';
        process.stdout.write('\n');
        break;
      case 'tool-start':
        out(
          t.local(
            `${GLYPHS.bullet} ${event.call.name} ${JSON.stringify(event.call.args).slice(0, 80)}`,
          ),
        );
        break;
      case 'tool-end':
        out(
          (event.result.ok ? t.ok : t.danger)(
            `  ${event.result.ok ? GLYPHS.ok : GLYPHS.fail} ${event.call.name} (${(event.durationMs / 1000).toFixed(1)}s) ${event.result.content.split('\n')[0]?.slice(0, 100) ?? ''}`,
          ),
        );
        break;
      case 'tool-denied':
        out(t.muted(`  ${GLYPHS.skip} ${event.call.name}: ${event.reason}`));
        break;
      case 'citations':
        for (const c of event.citations) out(t.muted(`  source: ${c.title.slice(0, 50)} ${c.url}`));
        break;
      case 'status':
        out(t.muted(`${GLYPHS.arrow} ${event.message}`));
        break;
      case 'note':
        out(t.warn(`${GLYPHS.bullet} ${event.message}`));
        break;
      case 'usage':
        dollars += event.dollars;
        break;
      case 'model-switch':
        out(t.cloud(`switched to ${event.model}: ${event.reason}`));
        break;
      case 'turn-start':
        break;
      case 'task-done':
        if (event.message) out((event.reason === 'complete' ? t.muted : t.warn)(event.message));
        taskResolve?.();
        taskResolve = undefined;
        break;
      case 'approval-request':
        pendingApproval = event.request;
        break;
      case 'approval-resolved':
        pendingApproval = undefined;
        break;
    }
  });

  // Approvals poll: readline questions cannot interleave mid-stream reliably,
  // so the loop watches for a pending request and asks in order.
  const approvalWatcher = setInterval(() => {
    if (!pendingApproval) return;
    const request = pendingApproval;
    pendingApproval = undefined;
    const label = request.kind === 'cloud-spend' ? 'CLOUD SPEND' : `approve ${request.toolName}`;
    out(t.warn(`\n${label}: ${request.summary}`));
    if (request.detail) out(t.muted(request.detail.split('\n').slice(0, 12).join('\n')));
    rl.question(t.warn('yes once [y], yes for session [a], no [n]: '), (answer) => {
      const ch = answer.trim().toLowerCase();
      driver.answerApproval(request.id, {
        approve: ch === 'y' || ch === 'a' || ch === 'yes',
        alwaysThisSession: ch === 'a',
      });
    });
  }, 150);

  const runTask = (text: string) =>
    new Promise<void>((resolve) => {
      taskResolve = resolve;
      driver.send(text);
    });

  const slashContext: SlashContext = {
    driver,
    dollars,
    stackDescription: options.stackDescription,
    print: out,
    clear: () => process.stdout.write('\u001b[2J\u001b[H'),
    exit: () => {
      cleanup();
      process.exit(0);
    },
    setWebEnabled: options.setWebEnabled,
    webEnabled: options.webEnabled,
    find: (query) => {
      const needle = query.toLowerCase();
      const hits = log
        .flatMap((line) => line.split('\n'))
        .filter((line) => line.toLowerCase().includes(needle))
        .slice(-20);
      if (hits.length) {
        out(t.muted(`Found "${query}" in ${hits.length} line${hits.length === 1 ? '' : 's'}:`));
        for (const hit of hits) out(`  ${hit.trim().slice(0, 100)}`);
      } else {
        out(t.muted(`No transcript line contains "${query}".`));
      }
    },
  };

  function cleanup(): void {
    clearInterval(approvalWatcher);
    unsubscribe();
    rl.close();
  }

  if (options.initialPrompt) {
    await runTask(options.initialPrompt);
    // One-shot mode: with no interactive stdin (scripts, pipes, cron), the
    // task IS the session. Finish clean instead of prompting the void.
    if (!process.stdin.isTTY) {
      cleanup();
      return;
    }
  }

  let closed = false;
  rl.on('close', () => {
    closed = true;
  });

  while (!closed) {
    let line: string;
    try {
      line = await question(rl, t.local(`\n${GLYPHS.arrow} `));
    } catch {
      break; // stdin ended (Ctrl+D or a pipe ran dry): leave quietly
    }
    const text = line.trim();
    if (!text) continue;
    if (text.startsWith('/')) {
      slashContext.dollars = dollars;
      if (!runSlash(text, slashContext))
        out(t.muted(`No command ${text.split(' ')[0]}. Try /help.`));
      continue;
    }
    await runTask(text);
  }
  cleanup();
}

function question(rl: Interface, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const onClose = () => reject(new Error('stdin closed'));
    rl.once('close', onClose);
    rl.question(prompt, (answer) => {
      rl.off('close', onClose);
      resolve(answer);
    });
  });
}
