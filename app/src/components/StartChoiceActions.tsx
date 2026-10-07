// The break after the setup walk's opening (lib/guidedSetup.ts START_CHOICES,
// founder 2026-10-01): the guide has said what setup is and that chatting is
// fine too, and the person picks. Just chat says where setup waits and then
// the tide carries them to the main chat page (components/TideTurn.tsx),
// rising from the button they tapped; Set up OpenShore introduces step one
// (D4). One row of equal widths (Creative Studio): Just chat first and full
// size, so skipping setup is never small, and Set up OpenShore filled, since
// it answers the question the intro asked.
import type { MouseEvent } from 'react';
import { useApp } from '../state/store.js';
import { hapticCommit } from '../lib/haptics.js';
import { START_CHOICES } from '../lib/guidedSetup.js';

export function StartChoiceActions() {
  const chooseStart = useApp((s) => s.chooseStart);
  const pick = (choice: (typeof START_CHOICES)[number]['choice'], e: MouseEvent) => {
    hapticCommit();
    const r = e.currentTarget.getBoundingClientRect();
    chooseStart(choice, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  };
  return (
    <div className="setup-actions" role="group" aria-label="Chat now or set up">
      <div className="setup-actions-row">
        {START_CHOICES.map((c) => (
          <button
            key={c.choice}
            type="button"
            className={`btn ${c.choice === 'setup' ? 'primary' : 'ghost'} press-fb`}
            onClick={(e) => pick(c.choice, e)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
