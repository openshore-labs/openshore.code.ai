// Permissions mean what they say (plan 1.6, custom-15). An always-ask tool
// (vaultWrite today) asks before every run, whatever the person allowed
// before, so a standing allow for it never takes effect: the engine used to
// run the call and then post that it would prompt again. The approval request
// now says so (alwaysAsk), and the sheet offers only what will hold: Approve
// once and No, skip it. Mounted in a real (small) DOM so the keyboard answers
// are exercised too (test/support/dom.ts).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApprovalRequest } from 'os-code/protocol';
import { mountDom, type TestDom } from './support/dom.js';

type Answer = { approve: boolean; always?: boolean; inProject?: boolean };

let dom: TestDom;
let answers: Answer[];

beforeEach(async () => {
  dom = await mountDom();
  answers = [];
});

afterEach(async () => {
  await dom.unmount();
});

async function show(request: ApprovalRequest & { alwaysAsk?: boolean }, total = 1) {
  const { ApprovalSheet } = await import('../src/components/ApprovalSheet.js');
  await dom.render(
    <ApprovalSheet
      request={request}
      index={0}
      total={total}
      agent
      mode="default"
      onAnswer={(approve, always, inProject) => answers.push({ approve, always, inProject })}
      onAnswerAll={() => {}}
      onOpenMode={() => {}}
    />,
  );
}

const base = {
  id: 'ap_1',
  kind: 'tool' as const,
  risk: 'write' as const,
  summary: 'Write the note',
};

// Each button's label, without its keyboard hint.
const labels = () =>
  [...dom.container.querySelectorAll('button')].map((b) =>
    [...b.childNodes]
      .filter((n) => n.nodeName !== 'KBD')
      .map((n) => n.textContent)
      .join('')
      .trim(),
  );

async function press(key: string) {
  const { act } = await import('react');
  await act(async () => {
    const event = new window.Event('keydown') as Event & { key: string };
    Object.assign(event, { key });
    window.dispatchEvent(event);
  });
}

describe('the approval sheet for an always-ask tool', () => {
  it('offers Approve once and No, skip it, and no standing allow', async () => {
    await show({ ...base, toolName: 'vaultWrite', alwaysAsk: true });
    const shown = labels();
    expect(shown).toContain('Approve once');
    expect(shown).toContain('No, skip it');
    expect(shown).not.toContain('Approve for this session');
    expect(shown).not.toContain('Always allow this in the project');
  });

  it('hides the project allow even for a tool that could otherwise take one', async () => {
    await show({ ...base, toolName: 'editFile', alwaysAsk: true });
    expect(labels()).not.toContain('Always allow this in the project');
    expect(labels()).not.toContain('Approve for this session');
  });

  it('the a key allows nothing for the session; y and n still answer', async () => {
    // Two in the stack, so an answer lands at once instead of after the exit.
    await show({ ...base, toolName: 'vaultWrite', alwaysAsk: true }, 2);
    await press('a');
    expect(answers).toEqual([]);
    await press('y');
    await press('n');
    expect(answers).toEqual([
      { approve: true, always: undefined, inProject: undefined },
      { approve: false, always: undefined, inProject: undefined },
    ]);
  });
});

describe('the approval sheet for any other tool', () => {
  it('still offers the session allow, and the project allow where it applies', async () => {
    await show({ ...base, toolName: 'editFile' });
    expect(labels()).toContain('Approve for this session');
    expect(labels()).toContain('Always allow this in the project');
  });

  it('alwaysAsk false reads as a plain request', async () => {
    await show({ ...base, toolName: 'runShell', alwaysAsk: false }, 2);
    expect(labels()).toContain('Approve for this session');
    await press('a');
    expect(answers).toEqual([{ approve: true, always: true, inProject: undefined }]);
  });
});

// A project note change after the chat read a private note asks every time
// (CX and CMO, 2026-10-08, A), and its card says why in one line above the
// diff. An older engine sends no `why`, and the card reads as before.
describe('the approval sheet says why a card asks', () => {
  const why =
    'This chat has read a private note, and a cloud model may later read what this change writes.';

  it('shows the why line above the diff', async () => {
    await show({
      ...base,
      toolName: 'projectMemoryWrite',
      alwaysAsk: true,
      why,
      detail: '--- a/NOTES.md\n+++ b/NOTES.md\n@@ -1 +1 @@\n-old\n+new',
    });
    const sub = [...dom.container.querySelectorAll('p.sheet-sub')].map((p) => p.textContent);
    expect(sub).toEqual([why]);
    // The line comes before the diff in the card.
    const kids = [...dom.container.querySelector('.approval-body')!.children];
    const line = kids.findIndex((k) => k.matches('p.sheet-sub'));
    const diff = kids.findIndex((k) => k.matches('.tool-card-detail.diff'));
    expect(line).toBeGreaterThan(-1);
    expect(diff).toBeGreaterThan(line);
  });

  it('shows it above a one-line detail too', async () => {
    await show({ ...base, toolName: 'projectMemoryWrite', why, detail: 'Add a line to NOTES.md' });
    const sub = [...dom.container.querySelectorAll('p.sheet-sub')].map((p) => p.textContent);
    expect(sub).toEqual([why, 'Add a line to NOTES.md']);
  });

  it('shows no line when the engine sends none', async () => {
    await show({ ...base, toolName: 'projectMemoryWrite', detail: 'Add a line to NOTES.md' });
    const sub = [...dom.container.querySelectorAll('p.sheet-sub')].map((p) => p.textContent);
    expect(sub).toEqual(['Add a line to NOTES.md']);
  });
});
