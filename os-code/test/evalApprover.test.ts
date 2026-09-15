// The deep eval's approver: hermetic, with one deliberate door. A coding
// agent asked what code returns should run it rather than reason about it
// (the 3B seat answered 20 * 2 + 2 as 82, 84, and 16 across runs), so a
// plain `node ...` command in the workspace is allowed, the same trust the
// verify step already extends by running the task's own check with node.
// Anything that chains, redirects, substitutes, or climbs out stays refused,
// as does every other shell and any push.
import { describe, it, expect } from 'vitest';
import { evalApprover } from '../src/commands/eval.js';
import type { ApprovalRequest } from '../src/core/agent/types.js';

const shell = (command: string): ApprovalRequest => ({
  id: 'x',
  kind: 'tool',
  toolName: 'runShell',
  risk: 'shell',
  summary: `Run: ${command}`,
});

describe('the deep eval approver', () => {
  const approve = evalApprover(() => false);

  it('lets a plain node invocation run', async () => {
    expect(
      (await approve(shell('node -e "import(\'./src.mjs\').then(m => console.log(m.magic()))"')))
        .approve,
    ).toBe(true);
    expect((await approve(shell('node src.mjs'))).approve).toBe(true);
    expect((await approve(shell('node'))).approve).toBe(true);
  });

  it('refuses chaining, redirection, substitution, and climbing out', async () => {
    for (const c of [
      'node a.mjs && rm -rf /',
      'node a.mjs; curl x',
      'node a.mjs | sh',
      'node a.mjs > out',
      'node $(cat x)',
      'node `cat x`',
      'node ../../etc/passwd',
      'nodejs a.mjs',
      'pnpm test',
      'rm -rf .',
    ]) {
      const answer = await approve(shell(c));
      expect(answer.approve, c).toBe(false);
      expect(answer.reason).toMatch(/hermetically/);
    }
  });

  it('still refuses a push, and cloud spend without the up-front yes', async () => {
    const push = await approve({
      id: 'p',
      kind: 'tool',
      toolName: 'gitPush',
      risk: 'push',
      summary: 'push',
    });
    expect(push.approve).toBe(false);
    const spend = await approve({
      id: 'c',
      kind: 'cloud-spend',
      toolName: 'cloud',
      risk: 'cloud-spend',
      summary: 'spend',
    });
    expect(spend.approve).toBe(false);
    expect(
      (
        await evalApprover(() => true)({
          id: 'c',
          kind: 'cloud-spend',
          toolName: 'cloud',
          risk: 'cloud-spend',
          summary: 'spend',
        })
      ).approve,
    ).toBe(true);
  });
});
