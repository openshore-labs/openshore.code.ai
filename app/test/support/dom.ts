// A small DOM for the few tests that must mount React for real. An error
// boundary only catches a fault thrown inside a real client render, which
// server rendering (renderToStaticMarkup) never runs, so a boundary test
// without one proves only the static hooks. linkedom is an app devDependency
// pinned to the engine's version.
//
// Call mountDom() before anything imports react-dom/client: React DOM decides
// whether it has a DOM when that module first loads. linkedom computes no
// styles, so getComputedStyle answers empty and the motion tokens read their
// fallbacks (lib/motion.ts), the way a test runner with no document does.
import type { ReactNode } from 'react';

export interface TestDom {
  container: HTMLElement;
  render(node: ReactNode): Promise<void>;
  /** Click the button whose text is exactly this, the way a tap does. */
  click(label: string): Promise<void>;
  /** Everything mounted, as text. */
  text(): string;
  /** The labels of the buttons on screen, in order. */
  buttons(): string[];
  /** Type into the field with this placeholder, the way a keystroke does. */
  type(placeholder: string, value: string): Promise<void>;
  /** What the field with this placeholder holds now. */
  value(placeholder: string): string;
  /** Let async work a tap started (a handler awaiting the store) finish. */
  settle(): Promise<void>;
  unmount(): Promise<void>;
}

export async function mountDom(): Promise<TestDom> {
  const { parseHTML } = await import('linkedom');
  const { window, document } = parseHTML(
    '<!doctype html><html><body><div id="root"></div></body></html>',
  );
  const getComputedStyle = () => ({ getPropertyValue: () => '' });
  Object.assign(window, { getComputedStyle });
  // Every browser has input events; linkedom does not say so, and React DOM
  // would fall back to an old polyfill that never sees a typed value.
  if (!('oninput' in document)) Object.assign(document, { oninput: null });
  // An input with no type attribute is a text field in every browser;
  // linkedom answers null, and React DOM would not read it as one.
  const inputProto = window.HTMLInputElement.prototype;
  const type = Object.getOwnPropertyDescriptor(inputProto, 'type');
  if (type?.get && document.createElement('input').type == null) {
    const read = type.get;
    Object.defineProperty(inputProto, 'type', {
      ...type,
      get(this: HTMLInputElement) {
        return read.call(this) ?? 'text';
      },
    });
  }
  Object.assign(globalThis, {
    window,
    document,
    getComputedStyle,
    HTMLElement: window.HTMLElement,
    Node: window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const container = document.getElementById('root') as HTMLElement;
  const root = createRoot(container);
  const buttons = () => [...container.querySelectorAll('button')];
  const field = (placeholder: string) => {
    const el = container.querySelector(`[placeholder="${placeholder}"]`) as HTMLInputElement | null;
    if (!el) throw new Error(`No field with placeholder "${placeholder}"`);
    return el;
  };
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
    type: async (placeholder, value) => {
      const el = field(placeholder);
      // Set it past React's value tracker, as the browser does, so the input
      // event reads as a change.
      const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      await act(async () => {
        if (set) set.call(el, value);
        else el.value = value;
        el.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
    },
    value: (placeholder) => field(placeholder).value,
    settle: () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }),
    unmount: () =>
      act(async () => {
        root.unmount();
      }),
  };
}
