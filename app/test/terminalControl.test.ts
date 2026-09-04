// Terminal Control rules. The load-bearing contract: Off by default, scoped per
// target so an On state never travels from one machine to another, and it gates
// exactly one tool (runShell) and nothing else.
import { describe, expect, it } from 'vitest';
import type { ApprovalRequest } from 'os-code/protocol';
import {
  LOCAL_TARGET,
  canControlTerminal,
  isShellApproval,
  shouldAutoRunShell,
  terminalControlOn,
  terminalTargetId,
  terminalTargetLabel,
} from '../src/lib/terminalControl.js';

const shell = (): Pick<ApprovalRequest, 'kind' | 'toolName'> => ({
  kind: 'tool',
  toolName: 'runShell',
});
const edit = (): Pick<ApprovalRequest, 'kind' | 'toolName'> => ({
  kind: 'tool',
  toolName: 'editFile',
});
const spend = (): Pick<ApprovalRequest, 'kind' | 'toolName'> => ({
  kind: 'cloud-spend',
  toolName: 'cloud',
});

describe('target identity', () => {
  it('is the fixed local key when this app is the engine', () => {
    expect(terminalTargetId({ desktopLocal: true, daemon: { baseUrl: 'http://x' } })).toBe(
      LOCAL_TARGET,
    );
  });
  it('is the hub base URL when attached over the tailnet', () => {
    expect(
      terminalTargetId({ desktopLocal: false, daemon: { baseUrl: 'http://100.1.2.3:4816' } }),
    ).toBe('http://100.1.2.3:4816');
  });
  it('is undefined when nothing is reachable', () => {
    expect(terminalTargetId({ desktopLocal: false })).toBeUndefined();
  });
  it('labels the local engine and a hub distinctly', () => {
    expect(terminalTargetLabel({ desktopLocal: true })).toBe('This computer');
    expect(
      terminalTargetLabel({ desktopLocal: false, daemon: { baseUrl: 'http://100.1.2.3:4816' } }),
    ).toBe('100.1.2.3');
  });
});

describe('default off and per target isolation', () => {
  it('reads Off with no stored state', () => {
    expect(terminalControlOn(undefined, LOCAL_TARGET)).toBe(false);
    expect(terminalControlOn({}, LOCAL_TARGET)).toBe(false);
  });
  it('reads Off for an undefined target even when other targets are On', () => {
    expect(terminalControlOn({ [LOCAL_TARGET]: true }, undefined)).toBe(false);
  });
  it('does not let On at one target leak to another', () => {
    const map = { [LOCAL_TARGET]: true };
    expect(terminalControlOn(map, LOCAL_TARGET)).toBe(true);
    expect(terminalControlOn(map, 'http://100.1.2.3:4816')).toBe(false);
  });
});

describe('it gates only the shell tool', () => {
  it('recognizes a runShell tool call', () => {
    expect(isShellApproval(shell())).toBe(true);
  });
  it('ignores edits and cloud spend', () => {
    expect(isShellApproval(edit())).toBe(false);
    expect(isShellApproval(spend())).toBe(false);
  });
});

describe('who may control the terminal', () => {
  it('lets a personal account control its own box', () => {
    expect(canControlTerminal({ type: 'personal' }, false)).toBe(true);
    expect(canControlTerminal(undefined, false)).toBe(true);
  });
  it('lets a commercial org admin control it', () => {
    expect(canControlTerminal({ type: 'commercial' }, true)).toBe(true);
  });
  it('refuses a commercial org member', () => {
    expect(canControlTerminal({ type: 'commercial' }, false)).toBe(false);
  });
});

describe('the auto run decision', () => {
  const on = { [LOCAL_TARGET]: true };
  it('auto runs a shell call only when On for a controllable target', () => {
    expect(
      shouldAutoRunShell(shell(), { targetId: LOCAL_TARGET, control: on, canControl: true }),
    ).toBe(true);
  });
  it('never auto runs when Off (the manual default)', () => {
    expect(
      shouldAutoRunShell(shell(), { targetId: LOCAL_TARGET, control: {}, canControl: true }),
    ).toBe(false);
  });
  it('never auto runs for someone not permitted, even with On stored', () => {
    expect(
      shouldAutoRunShell(shell(), { targetId: LOCAL_TARGET, control: on, canControl: false }),
    ).toBe(false);
  });
  it('never auto runs a non shell tool', () => {
    expect(
      shouldAutoRunShell(edit(), { targetId: LOCAL_TARGET, control: on, canControl: true }),
    ).toBe(false);
    expect(
      shouldAutoRunShell(spend(), { targetId: LOCAL_TARGET, control: on, canControl: true }),
    ).toBe(false);
  });
  it('never auto runs when the On state belongs to a different target', () => {
    expect(
      shouldAutoRunShell(shell(), {
        targetId: 'http://100.1.2.3:4816',
        control: on,
        canControl: true,
      }),
    ).toBe(false);
  });
});
