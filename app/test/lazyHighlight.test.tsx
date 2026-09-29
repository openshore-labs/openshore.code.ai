// The chat's code highlighter loads on first need (the cleanup package): a
// message with no fenced block never asks for it, a message with one renders
// the block as plain, readable code in its box at once, and the tint lands in
// place when the chunk arrives. Mounted in a real (small) DOM, with a
// stand-in highlighter that marks each code element it touches.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

const hl = vi.hoisted(() => ({ loads: 0 }));

vi.mock('rehype-highlight', () => {
  hl.loads++;
  type Node = {
    type: string;
    tagName?: string;
    properties?: Record<string, unknown>;
    children?: Node[];
  };
  const mark = (node: Node) => {
    if (node.type === 'element' && node.tagName === 'code') {
      const cls = (node.properties?.className as string[] | undefined) ?? [];
      node.properties = { ...node.properties, className: [...cls, 'hl-mock'] };
    }
    for (const child of node.children ?? []) mark(child);
  };
  return { default: () => (tree: Node) => mark(tree) };
});

vi.mock('../src/state/store.js', () => ({
  useApp: <T,>(select: (s: unknown) => T) =>
    select({ runCommand: () => {}, canRunCommands: () => false }),
}));

let dom: TestDom;
beforeEach(async () => {
  dom = await mountDom();
});
afterEach(async () => {
  await dom.unmount();
});

describe('the code highlighter waits for the first code block', () => {
  it('tells a fenced block from prose', async () => {
    const { hasCodeFence } = await import('../src/lib/lazyHighlight.js');
    expect(hasCodeFence('Run `npm test` and read the output.')).toBe(false);
    expect(hasCodeFence('Here:\n```ts\nconst a = 1\n```')).toBe(true);
    expect(hasCodeFence('   ~~~\ncode\n~~~')).toBe(true);
  });

  it('prose never loads it; the first fence does, and the block reads plain until it lands', async () => {
    const { Markdown } = await import('../src/components/Markdown.js');
    await dom.render(<Markdown text="Just words, and `inline code`." />);
    await dom.settle();
    expect(hl.loads).toBe(0);

    await dom.render(<Markdown text={'Try this:\n\n```ts\nconst answer = 42;\n```'} />);
    // At once: the code, whole and readable, in its usual box.
    const code = () => dom.container.querySelector('.md-code pre code');
    expect(code()?.textContent).toBe('const answer = 42;\n');
    expect(dom.container.querySelector('.md-code-bar')).not.toBeNull();
    // Then the tint, in place, from the one load.
    for (let i = 0; i < 50 && !code()?.className.includes('hl-mock'); i++) await dom.settle();
    expect(code()?.className).toContain('hl-mock');
    expect(code()?.textContent).toBe('const answer = 42;\n');
    expect(hl.loads).toBe(1);

    // A second message reuses it.
    await dom.render(<Markdown text={'```\nls\n```'} />);
    await dom.settle();
    expect(hl.loads).toBe(1);
  });
});
