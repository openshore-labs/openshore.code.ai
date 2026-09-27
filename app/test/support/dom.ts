// A small DOM for the few tests that must mount React for real. An error
// boundary only catches a fault thrown inside a real client render, which
// server rendering (renderToStaticMarkup) never runs, so a boundary test
// without one proves only the static hooks. linkedom is the engine's own HTML
// parser, a dependency of os-code (the app's workspace package), so it is
// resolved from there and no new package comes in for it.
//
// Call mountDom() before anything imports react-dom/client: React DOM decides
// whether it has a DOM when that module first loads.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';

const fromEngine = createRequire(
  resolve(fileURLToPath(import.meta.url), '../../../../os-code/package.json'),
);

export interface TestDom {
  container: HTMLElement;
  render(node: ReactNode): Promise<void>;
  /** Click the button whose text is exactly this, the way a tap does. */
  click(label: string): Promise<void>;
  /** Everything mounted, as text. */
  text(): string;
  /** The labels of the buttons on screen, in order. */
  buttons(): string[];
  unmount(): Promise<void>;
}

export async function mountDom(): Promise<TestDom> {
  const { parseHTML } = fromEngine('linkedom') as {
    parseHTML: (html: string) => { window: Window & typeof globalThis; document: Document };
  };
  const { window, document } = parseHTML(
    '<!doctype html><html><body><div id="root"></div></body></html>',
  );
  Object.assign(globalThis, {
    window,
    document,
    HTMLElement: window.HTMLElement,
    Node: window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const container = document.getElementById('root') as HTMLElement;
  const root = createRoot(container);
  const buttons = () => [...container.querySelectorAll('button')];
  return {
    container,
    render: (node) =>
      act(async () => {
        root.render(node);
      }),
    click: async (label) => {
      const button = buttons().find((b) => b.textContent === label);
      if (!button) {
        throw new Error(`No "${label}" button in: ${buttons().map((b) => b.textContent)}`);
      }
      await act(async () => {
        button.dispatchEvent(new window.Event('click', { bubbles: true }));
      });
    },
    text: () => container.textContent ?? '',
    buttons: () => buttons().map((b) => b.textContent ?? ''),
    unmount: () =>
      act(async () => {
        root.unmount();
      }),
  };
}
