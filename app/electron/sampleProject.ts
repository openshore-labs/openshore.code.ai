// The sample page for a first try (v1 Phase 1, desktop first run). A tiny
// page for a bakery's news list whose Join button does nothing, because its
// script looks for an id the page does not have: the most common way a
// beginner's page silently breaks. One tap writes it to ~/OpenShore/Repositories/Try
// OpenShore and opens a chat there that asks for the fix, so a first-time
// person sees the whole loop (the edit, the check, the changed files, Undo)
// on something that cannot hurt their own work. Nothing here touches Electron.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { sectionDir } from 'os-code/dist/src/config/openshoreFolder.js';
import { join } from 'node:path';

export const SAMPLE_FOLDER_NAME = 'Try OpenShore';

export const SAMPLE_FILES: Record<string, string> = {
  'README.md': [
    '# Try OpenShore',
    '',
    'A small page to try OpenShore on. Open index.html in your browser: the',
    '"Join the list" button does nothing. Ask OpenShore to fix it, then try',
    'Undo on the changed files to see your work come back.',
    '',
    'Nothing here is yours, so nothing can go wrong. Delete this folder any time.',
    '',
  ].join('\n'),
  'index.html': [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8">',
    '    <meta name="viewport" content="width=device-width, initial-scale=1">',
    '    <title>Rise and Crumb news</title>',
    '    <link rel="stylesheet" href="style.css">',
    '  </head>',
    '  <body>',
    '    <main>',
    '      <h1>Rise and Crumb</h1>',
    '      <p>Hear about new bakes first.</p>',
    '      <button id="join">Join the list</button>',
    '      <p id="thanks" hidden>Thanks! You are on the list.</p>',
    '    </main>',
    '    <script src="script.js"></script>',
    '  </body>',
    '</html>',
    '',
  ].join('\n'),
  'style.css': [
    'body { font-family: system-ui, sans-serif; background: #faf7f2; color: #2b2622; }',
    'main { max-width: 32rem; margin: 4rem auto; padding: 0 1rem; }',
    'button { font: inherit; padding: 0.6rem 1.2rem; border-radius: 0.5rem; border: 0; background: #2b2622; color: #faf7f2; }',
    '',
  ].join('\n'),
  'script.js': [
    "const button = document.getElementById('join-button');",
    "button.addEventListener('click', () => {",
    "  document.getElementById('thanks').hidden = false;",
    '});',
    '',
  ].join('\n'),
};

/** Write the sample to `root`/Try OpenShore, keeping any file already there
 *  (a second tap reopens the same folder, never overwrites what changed). */
export function createSampleProject(root = sectionDir('repositories')): {
  path: string;
  created: boolean;
} {
  const path = join(root, SAMPLE_FOLDER_NAME);
  const created = !existsSync(path);
  mkdirSync(path, { recursive: true });
  for (const [rel, text] of Object.entries(SAMPLE_FILES)) {
    const file = join(path, rel);
    if (!existsSync(file)) writeFileSync(file, text);
  }
  return { path, created };
}
