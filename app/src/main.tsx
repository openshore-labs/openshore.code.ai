import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './theme.css';

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// How long the boot splash stays on screen, at minimum, measured from when the
// document started loading (performance.now() is time-since-navigation-start,
// and the splash paints on parse, so this is effectively its on-screen time).
// This is the "hold" that makes the opening feel premium instead of a flash:
// without it the splash dismissed the instant React mounted (~0.3s on a fast
// phone), which read as too fast. Modeled on the Claude iOS app's unhurried
// opening. THIS IS THE KNOB to make it slower or faster; pair it with the
// entrance/exit durations in index.html. The mark holds until this time, then
// the 0.5s cross-fade runs, so total opening is roughly SPLASH_MIN_MS + 500ms.
const SPLASH_MIN_MS = 2500;

// Dismiss the boot splash once BOTH the first React frame has painted AND the
// deliberate minimum hold has elapsed, whichever is later. A double rAF waits
// for the app's initial layout so the hand-off is a clean cross-fade (splash
// out as the app is already on screen), never a flash of empty chrome. The node
// removes itself after the fade so it can never trap taps.
function dismissBootSplash(): void {
  const splash = document.getElementById('boot-splash');
  if (!splash) return;
  const dismiss = () => {
    splash.classList.add('boot-splash-hidden');
    const remove = () => splash.remove();
    splash.addEventListener('transitionend', remove, { once: true });
    // Fallback for reduced-motion / no transitionend: remove after the fade.
    window.setTimeout(remove, 900);
  };
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      // React has painted; now honor the remaining hold before dismissing.
      const remainingHold = Math.max(0, SPLASH_MIN_MS - performance.now());
      window.setTimeout(dismiss, remainingHold);
    }),
  );
}

dismissBootSplash();
