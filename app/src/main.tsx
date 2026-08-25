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

// Dismiss the boot splash once the first React frame has painted. A double
// rAF waits for the app's initial layout so the hand-off is a clean cross-fade
// (splash out as the app is already on screen), never a flash of empty chrome.
// The node removes itself after the fade so it can never trap taps; the timing
// mirrors the 0.42s transition declared in index.html.
function dismissBootSplash(): void {
  const splash = document.getElementById('boot-splash');
  if (!splash) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      splash.classList.add('boot-splash-hidden');
      const remove = () => splash.remove();
      splash.addEventListener('transitionend', remove, { once: true });
      // Fallback for reduced-motion / no transitionend: remove shortly after.
      window.setTimeout(remove, 700);
    }),
  );
}

dismissBootSplash();
