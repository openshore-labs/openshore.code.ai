// The Vault room's fallback (0.10) always has a way out that works. App.tsx
// mounts the room as <VaultRoom />, the Vault screen inside its error
// boundary. On a note, the way back closes the note and shows the notes list.
// In the notes list there is no note to close, and the same render would
// fault again, so the fallback leaves the room (the next visit mounts it
// fresh) and offers a try again for a fault that has passed. Mounted in a real
// (small) DOM, since a boundary only catches inside a real render.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

// The store, as far as the room reads it: the open note, closing it, and
// moving to another room.
const app = vi.hoisted(() => {
  type State = {
    vaultNote?: { path: string };
    vaultCloseNote: () => void;
    setView: (view: string) => void;
  };
  const listeners = new Set<() => void>();
  const views: string[] = [];
  const state: State = {
    vaultNote: undefined,
    vaultCloseNote: () => {
      state.vaultNote = undefined;
      listeners.forEach((l) => l());
    },
    setView: (view) => {
      views.push(view);
    },
  };
  return { state, listeners, views };
});
vi.mock('../src/state/store.js', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (l: () => void) => {
    app.listeners.add(l);
    return () => app.listeners.delete(l);
  };
  return {
    useApp: <T,>(select: (s: typeof app.state) => T) =>
      useSyncExternalStore(subscribe, () => select(app.state)),
    agenticView: () => ({}),
    vaultHeldFor: () => [],
  };
});
// The top bar reads the rest of the store; the fallback is what is tested.
vi.mock('../src/components/BackBar.js', () => ({
  BackBar: ({ title }: { title: string }) => <header>{title}</header>,
}));

const { VaultRoom } = await import('../src/screens/VaultScreen.js');

// Stands in for the Vault screen: it faults while `faults.list` (the notes
// list) or `faults.note` (a note is open) says so.
const faults = { list: true, note: true };
function Screen() {
  const open = app.state.vaultNote !== undefined;
  if (open ? faults.note : faults.list) throw new Error('render fault');
  return <p>{open ? 'the note' : 'the notes list'}</p>;
}

describe('the Vault room fallback', () => {
  let dom: TestDom;
  beforeEach(async () => {
    app.state.vaultNote = undefined;
    app.views.length = 0;
    faults.list = true;
    faults.note = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    dom = await mountDom();
  });
  afterEach(async () => {
    await dom.unmount();
    vi.restoreAllMocks();
  });

  it('a fault in the notes list leaves the room, never re-renders the same fault', async () => {
    await dom.render(
      <VaultRoom>
        <Screen />
      </VaultRoom>,
    );
    expect(dom.text()).toContain('This could not be shown.');
    expect(dom.buttons()).not.toContain('Back to your notes');
    await dom.click('Leave the Vault');
    expect(app.views).toEqual(['chat']);
  });

  it('a try again in the notes list shows it once the fault has passed', async () => {
    await dom.render(
      <VaultRoom>
        <Screen />
      </VaultRoom>,
    );
    faults.list = false;
    await dom.click('Try again');
    expect(dom.text()).toBe('the notes list');
    expect(app.views).toEqual([]);
  });

  it('a fault on a note goes back to the notes list', async () => {
    app.state.vaultNote = { path: 'Plan.md' };
    faults.list = false;
    await dom.render(
      <VaultRoom>
        <Screen />
      </VaultRoom>,
    );
    expect(dom.buttons()).toContain('Back to your notes');
    await dom.click('Back to your notes');
    expect(app.state.vaultNote).toBeUndefined();
    expect(dom.text()).toBe('the notes list');
    expect(app.views).toEqual([]);
  });

  it('a note whose list faults too still ends on a way out', async () => {
    app.state.vaultNote = { path: 'Plan.md' };
    await dom.render(
      <VaultRoom>
        <Screen />
      </VaultRoom>,
    );
    await dom.click('Back to your notes');
    expect(dom.buttons()).toContain('Leave the Vault');
  });
});
