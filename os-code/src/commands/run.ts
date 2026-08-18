// osc run (and the bare `osc`): open a session in this workspace, TUI by
// default, --plain for dumb terminals, with a one-shot prompt optional.
import React from 'react';
import { render } from 'ink';
import { bootstrapSession } from '../core/agent/bootstrap.js';
import { StackError, describeStack } from '../router/stack.js';
import { App } from '../tui/app.js';
import { runPlain } from '../tui/plain.js';
import { setColorEnabled, t } from '../brand/theme.js';
import { out } from './util.js';

export interface RunOptions {
  prompt?: string;
  plain?: boolean;
  cwd?: string;
}

export async function runCommand(options: RunOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  let session;
  try {
    session = bootstrapSession({ cwd, profile: 'local-interactive' });
  } catch (err) {
    if (err instanceof StackError) {
      out(t.warn(err.message));
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  for (const warning of session.warnings) out(t.warn(warning));

  const stackDescription = describeStack(session.router.stack);
  const egress = session.toolContext.egress;
  const shared = {
    driver: session.driver,
    initialPrompt: options.prompt,
    stackDescription,
    setWebEnabled: (on: boolean) => egress.setWebEnabled(on),
    webEnabled: () => egress.webEnabled,
  };

  const wantPlain = options.plain || session.config.ui.plain || !process.stdout.isTTY;
  if (wantPlain) {
    setColorEnabled(process.stdout.isTTY ? undefined : false);
    await runPlain(shared);
    return;
  }

  const app = render(React.createElement(App, shared), { exitOnCtrlC: false });
  await app.waitUntilExit();
}
