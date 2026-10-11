// Every sheet is a named dialog that animates out (G2, the screens review).
// The house <Sheet> gives its card role="dialog" and aria-modal, and its
// SheetHead (or SheetTitle) names it through aria-labelledby. The connection
// sheet and the QR scanner used to hand-roll their scrims
// with no dialog role; they ride the house sheet now. Mounted in a real
// (small) DOM, since the name is wired up in a layout effect.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

// The store, as far as these sheets read it.
const app = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state: Record<string, unknown> = {};
  const set = (patch: Record<string, unknown>) => {
    Object.assign(state, patch);
    listeners.forEach((l) => l());
  };
  Object.assign(state, {
    authSession: undefined,
  });
  return { state, set, listeners };
});

vi.mock('../src/state/store.js', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useApp: (select: (s: Record<string, unknown>) => unknown = (s) => s) =>
      useSyncExternalStore(
        (listener) => {
          app.listeners.add(listener);
          return () => app.listeners.delete(listener);
        },
        () => select(app.state),
      ),
  };
});

let dom: TestDom;
beforeEach(async () => {
  dom = await mountDom();
});
afterEach(async () => {
  await dom.unmount();
  vi.unstubAllGlobals();
});

const dialog = () => dom.container.querySelector<HTMLElement>('[role="dialog"]');
const nameOf = (el: HTMLElement | null) => {
  const id = el?.getAttribute('aria-labelledby');
  return id ? (dom.container.querySelector(`[id="${id}"]`)?.textContent ?? null) : null;
};

describe('the house sheet', () => {
  it('is named by its SheetHead', async () => {
    const { Sheet } = await import('../src/components/Sheet.js');
    const { SheetHead } = await import('../src/components/SheetHead.js');
    await dom.render(
      <Sheet open onClose={() => {}}>
        <SheetHead title="Name this computer" onClose={() => {}} />
      </Sheet>,
    );
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    expect(nameOf(dialog())).toBe('Name this computer');
  });

  it('points at no name when it has no title', async () => {
    const { Sheet } = await import('../src/components/Sheet.js');
    await dom.render(
      <Sheet open onClose={() => {}}>
        <p>Nothing to call it</p>
      </Sheet>,
    );
    expect(dialog()).not.toBeNull();
    expect(dialog()!.hasAttribute('aria-labelledby')).toBe(false);
  });
});

describe('the sheets that used to hand-roll their scrims', () => {
  it('the QR scanner is a named dialog whose Cancel closes it', async () => {
    // The small DOM has no animation frames; the scanner never gets that far.
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const { QrScanner } = await import('../src/components/QrScanner.js');
    let closed = 0;
    await dom.render(<QrScanner open onDecode={() => {}} onClose={() => closed++} />);
    await dom.settle();
    expect(nameOf(dialog())).toBe('Scan the QR on your computer');
    // No camera here, so it says so instead of failing silently.
    expect(dom.text()).toMatch(/camera/i);
    await dom.click('Cancel');
    expect(closed).toBe(1);
  });
});
