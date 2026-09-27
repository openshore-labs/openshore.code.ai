// The Vault context card (Vault M4, 4.4) says exactly what the pack did: how
// many Vault notes went to the seat, whether that was only this project's
// Current State, how many private notes stayed behind, and where the seat
// is (teal local, amber cloud). On a phone driving the session it says the
// notes are on the computer, since the phone cannot open them yet.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContextPackCard } from '../src/components/ContextPackCard.js';
import { contextPackCopy } from '../src/lib/vaultCopy.js';
import type { ThreadItem } from '../src/state/types.js';

type Card = Extract<ThreadItem, { kind: 'context-pack' }>;

const note = (title: string, layer: Card['sources'][number]['layer'] = 'search') => ({
  layer,
  path: `Notes/${title}.md`,
  title,
});

function card(over: Partial<Card> = {}): Card {
  return {
    kind: 'context-pack',
    id: 'c1',
    seat: 'local',
    mode: 'full',
    sources: [note('Ideas'), note('Roadmap', 'pin'), note('Launch', 'link')],
    withheld: 0,
    cold: false,
    ...over,
  };
}

const render = (c: Card, remote = false) =>
  renderToStaticMarkup(<ContextPackCard item={c} remote={remote} />);

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

describe('the context pack card', () => {
  it('counts the Vault notes and lists their titles', () => {
    const out = text(render(card()));
    expect(out).toContain('Used 3 notes from your Vault');
    expect(out).toContain('Ideas');
    expect(out).toContain('Roadmap');
    expect(out).toContain('Launch');
  });

  it('says one note, not one notes', () => {
    const out = text(render(card({ sources: [note('Ideas')] })));
    expect(out).toContain('Used 1 note from your Vault');
    expect(out).not.toContain('1 notes');
  });

  it('reads a Current State only pack honestly', () => {
    const cs = {
      layer: 'current-state' as const,
      path: 'CURRENT_STATE.md',
      title: 'Current State',
    };
    const only = text(render(card({ mode: 'current-state', sources: [cs] })));
    expect(only).toContain("Used this project's Current State");
    expect(only).not.toContain('from your Vault');
    const both = text(render(card({ sources: [cs, note('Ideas')] })));
    expect(both).toContain("Used this project's Current State and 1 note from your Vault");
  });

  it('says a cold index left the turn with Current State only', () => {
    const cs = {
      layer: 'current-state' as const,
      path: 'CURRENT_STATE.md',
      title: 'Current State',
    };
    const out = text(render(card({ mode: 'current-state', sources: [cs], cold: true })));
    expect(out).toContain('still loading');
    expect(text(render(card()))).not.toContain('still loading');
  });

  it('wears teal for a local seat and amber for a cloud one', () => {
    const local = render(card());
    expect(local).toContain('context-pack-card local');
    expect(text(local)).toContain('Stayed with a local model');
    const cloud = render(card({ seat: 'cloud' }));
    expect(cloud).toContain('context-pack-card cloud');
    expect(text(cloud)).toContain('Sent to a cloud model');
  });

  it('names the withheld private notes only when some were held back', () => {
    expect(text(render(card({ seat: 'cloud', withheld: 2 })))).toContain(
      '2 private notes stayed on this computer.',
    );
    expect(text(render(card({ seat: 'cloud', withheld: 1 })))).toContain(
      '1 private note stayed on this computer.',
    );
    expect(text(render(card()))).not.toContain('private');
  });

  it('shows a card when every note was held back, and none for an empty pack', () => {
    const held = text(render(card({ seat: 'cloud', sources: [], withheld: 2 })));
    expect(held).toContain('No notes from your Vault went to this model');
    expect(held).toContain('2 private notes stayed on this computer.');
    expect(render(card({ sources: [], withheld: 0 }))).toBe('');
  });

  it('on a phone, says the notes are on the computer', () => {
    const out = text(render(card({ seat: 'cloud', withheld: 1 }), true));
    expect(out).toContain('These notes are on your computer. Open them there for now.');
    expect(out).toContain('1 private note stayed on your computer.');
    expect(out).not.toContain('this computer');
    const one = contextPackCopy(card({ sources: [note('Ideas')] }), { remote: true });
    expect(one?.remote).toBe('This note is on your computer. Open it there for now.');
    expect(text(render(card()))).not.toContain('Open them there');
  });

  it('never counts Current State as a Vault note in the list', () => {
    const cs = {
      layer: 'current-state' as const,
      path: 'CURRENT_STATE.md',
      title: 'Current State',
    };
    const copy = contextPackCopy(card({ sources: [cs, note('Ideas')] }), { remote: false });
    expect(copy?.notes).toEqual([{ path: 'Notes/Ideas.md', title: 'Ideas' }]);
  });

  // Wave 2: the engine's full pack also lists the Vault map and the handoff
  // (layer 'map' and 'handoff', path ''), and Current State as a note-shaped
  // source. None of them is a Vault note, so none is counted or listed.
  it('counts only real Vault notes: never the map, the handoff, or Current State', () => {
    const full = card({
      sources: [
        {
          layer: 'current-state',
          path: 'OpenShore Project Atlas MDs/Current State.md',
          title: 'Current State',
        },
        { layer: 'handoff', path: '', title: 'Handoff' },
        note('Ideas'),
        note('Launch', 'link'),
        note('Ideas'),
        { layer: 'map', path: '', title: 'Vault map' },
      ],
    });
    const copy = contextPackCopy(full, { remote: false });
    expect(copy?.headline).toBe("Used this project's Current State and 2 notes from your Vault");
    expect(copy?.notes.map((n) => n.title)).toEqual(['Ideas', 'Launch']);
    const out = text(render(full));
    expect(out).not.toContain('Vault map');
    expect(out).not.toContain('Handoff');
    expect(out).not.toContain('4 notes');
    // A pack that sent only the outline says so, and claims no note.
    const mapOnly = contextPackCopy(
      card({ sources: [{ layer: 'map', path: '', title: 'Vault map' }] }),
      {
        remote: true,
      },
    );
    expect(mapOnly?.headline).toBe('Used an outline of your Vault, no notes');
    expect(mapOnly?.notes).toEqual([]);
    expect(mapOnly?.remote).toBeUndefined();
  });

  // Vault M5 (CTO J9): when this device's vault can open the note, each title
  // is a button, and the foot no longer says the notes are only on the
  // computer. Without an opener the titles stay plain.
  it('opens a note from its title when this device can, and stays plain when not', () => {
    const opened: string[] = [];
    const el = ContextPackCard({ item: card(), remote: true, onOpen: (p) => opened.push(p) });
    const html = renderToStaticMarkup(el!);
    expect(html).toContain(
      '<button type="button" class="linklike press-fb context-pack-open">Ideas</button>',
    );
    expect(text(html)).not.toContain('Open them there');
    const plain = render(card(), true);
    expect(plain).not.toContain('<button');
    expect(text(plain)).toContain('Open them there for now.');
  });
});
