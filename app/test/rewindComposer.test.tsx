// Esc Esc in an empty desktop composer (P2): the keyboard's way to the rewind
// for the last message, the way Claude Code's works. One Escape does nothing;
// a draft in the field is cleared first and that Escape does not count.
// Mounted in a real (small) DOM on a stub store (test/support/dom.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

const app = vi.hoisted(() => ({
  state: {
    settings: { permissionMode: 'default' },
    showToast: () => {},
    runCommand: () => {},
    listFiles: async () => [] as string[],
    addMemory: async () => {},
    setPermissionMode: async () => {},
  },
}));
vi.mock('../src/state/store.js', () => ({
  useApp: <T,>(select?: (s: typeof app.state) => T) => (select ? select(app.state) : app.state),
}));

let dom: TestDom;

beforeEach(async () => {
  dom = await mountDom();
  Object.assign(window, { matchMedia: () => ({ matches: false }) });
  const area = window.HTMLTextAreaElement.prototype as { setSelectionRange?: unknown };
  area.setSelectionRange ??= () => {};
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof cancelAnimationFrame;
});
afterEach(async () => {
  await dom.unmount();
});

describe("the composer's Esc Esc", () => {
  it(
    'two Escapes in an empty field open the rewind; one does not, and a draft is cleared first',
    { timeout: 20_000 },
    async () => {
      const { Composer, ESC_ESC_MS } = await import('../src/components/Composer.js');
      const { act } = await import('react');
      let rewinds = 0;
      const render = (onRewind?: () => void) =>
        dom.render(
          <Composer
            busy={false}
            visionSupported={false}
            onSend={() => {}}
            onStop={() => {}}
            onOpenModelSheet={() => {}}
            onOpenModeSheet={() => {}}
            onRewind={onRewind}
          />,
        );
      await render(() => rewinds++);
      const field = dom.container.querySelector('textarea')!;
      const placeholder = field.getAttribute('placeholder')!;
      const esc = () =>
        act(async () => {
          const event = new window.Event('keydown', { bubbles: true }) as Event & { key: string };
          Object.assign(event, { key: 'Escape' });
          field.dispatchEvent(event);
        });

      await esc();
      expect(rewinds).toBe(0);
      await esc();
      expect(rewinds).toBe(1);

      // With words in the field, the first Escape clears them and does not count.
      await dom.type(placeholder, 'half a thought');
      await esc();
      expect(dom.value(placeholder)).toBe('');
      await esc();
      expect(rewinds).toBe(1);
      await esc();
      expect(rewinds).toBe(2);

      // Two Escapes far apart are two single presses.
      await esc();
      await act(() => new Promise<void>((r) => setTimeout(r, ESC_ESC_MS + 50)));
      await esc();
      expect(rewinds).toBe(2);

      // With nothing to rewind to, the composer is as it was.
      await render(undefined);
      await esc();
      await esc();
      expect(rewinds).toBe(2);
    },
  );
});
