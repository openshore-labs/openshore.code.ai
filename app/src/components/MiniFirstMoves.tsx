// The tappable "First Moves" under a fresh Harbor Mini chat, so a brand-new
// person never faces a blank composer. Creative Studio direction "The Standing
// Light": the chips arrive stepped by --stagger, so they assemble calmly under
// the seeded greeting rather than popping in as a block. Each carries press-fb,
// so the very first tap a new user makes answers the finger. Tapping one sends
// it as the person's first message.
import type { CSSProperties } from 'react';
import { HARBOR_MINI_FIRST_MOVES } from '../lib/harborMini.js';
import { hapticTick } from '../lib/haptics.js';

export function MiniFirstMoves({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="first-moves" role="group" aria-label="Try one of these">
      {HARBOR_MINI_FIRST_MOVES.map((move, i) => (
        <button
          key={move}
          type="button"
          className="first-move press-fb"
          style={{ '--i': i } as CSSProperties}
          onClick={() => {
            hapticTick();
            onPick(move);
          }}
        >
          {move}
        </button>
      ))}
    </div>
  );
}
