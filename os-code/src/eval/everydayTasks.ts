// The everyday suite: the jobs a person who is not a developer brings to a
// coding agent (a page for their business, a folder of photos named by date,
// a chart from a spreadsheet, a button that does nothing), scored by behavior
// like the code suite. These are the tasks OpenShore's first-time person
// actually does, so they are the ones the floor has to hold on.
//
// None carries a verify script: a person's own folder has no test suite, so
// whatever the harness checks here it has to find for itself. Scoring still
// comes from each task's independent checker, never from the agent.
//
// The checkers read files and run small scripts with `node` alone (a stub DOM
// for the button), so every score is reproducible on any machine with no
// browser and no dependencies.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalTask, EvalTaskScore } from './tasks.js';

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function listDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

// The one-page site ----------------------------------------------------------

export const SITE_BAKERY = 'Rise and Crumb';
export const SITE_EMAIL = 'hello@riseandcrumb.example';

/** Grade the bakery page: a quarter each for a real page, the name as the
 *  main heading, the hours, and the email link. */
export function gradeSite(html: string | undefined): EvalTaskScore {
  if (html === undefined) return { score: 0, detail: 'no index.html was made' };
  const missing: string[] = [];
  let score = 0;
  const page = /<!doctype html|<html[\s>]/i.test(html) && /<\/(html|body)>/i.test(html);
  if (page) score += 0.25;
  else missing.push('a complete HTML page');
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '';
  const heading = h1
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  if (/rise\s*(and|&)\s*crumb/i.test(heading)) score += 0.25;
  else missing.push('the bakery name as the main heading');
  const text = html.replace(/<[^>]+>/g, ' ');
  const hours =
    /tue/i.test(text) &&
    /sun/i.test(text) &&
    /\b7(\s*(am|a\.m\.)|:00)/i.test(text) &&
    /\b(3(\s*(pm|p\.m\.)|:00)|15:00)/i.test(text);
  if (hours) score += 0.25;
  else missing.push('the opening hours');
  if (new RegExp(`href\\s*=\\s*["']mailto:${SITE_EMAIL.replace(/\./g, '\\.')}`, 'i').test(html)) {
    score += 0.25;
  } else missing.push('an email link');
  return score === 1
    ? { score, detail: 'a complete page with the name, the hours, and the email link' }
    : { score, detail: `missing ${missing.join(', ')}` };
}

// The photos -----------------------------------------------------------------

/** Camera names, the names they should end up with, and each photo's bytes
 *  (stand-ins: the check only needs the content to travel with the rename). */
export const PHOTO_RENAMES: ReadonlyArray<{ from: string; to: string; content: string }> = [
  { from: 'IMG_20240312_101500.jpg', to: '2024-03-12_10-15.jpg', content: 'photo-a: the market' },
  { from: 'IMG_20240312_163000.jpg', to: '2024-03-12_16-30.jpg', content: 'photo-b: the harbor' },
  { from: 'IMG_20240315_184210.jpg', to: '2024-03-15_18-42.jpg', content: 'photo-c: the sunset' },
  { from: 'IMG_20240401_090000.jpg', to: '2024-04-01_09-00.jpg', content: 'photo-d: the kitchen' },
];
/** A file in the folder that is not a photo and must be left alone. */
export const PHOTO_KEEP = { name: 'notes.txt', content: 'Shot list for the spring menu.\n' };

/** Grade the renamed folder: the share of photos under their new name with
 *  their own content and the old name gone, capped at half when the notes
 *  file was changed or lost. */
export function gradePhotos(dir: string): EvalTaskScore {
  const names = new Set(listDir(dir));
  let right = 0;
  const wrong: string[] = [];
  for (const photo of PHOTO_RENAMES) {
    const moved = readText(join(dir, photo.to)) === photo.content && !names.has(photo.from);
    if (moved) right += 1;
    else wrong.push(photo.from);
  }
  let score = right / PHOTO_RENAMES.length;
  const notesKept = readText(join(dir, PHOTO_KEEP.name)) === PHOTO_KEEP.content;
  if (!notesKept) score = Math.min(score, 0.5);
  if (score === 1) return { score, detail: 'every photo renamed by date, the notes left alone' };
  const parts: string[] = [];
  if (wrong.length) parts.push(`${wrong.length} of ${PHOTO_RENAMES.length} photos not renamed`);
  if (!notesKept) parts.push('notes.txt was changed or lost');
  return { score, detail: parts.join('; ') };
}

// The chart ------------------------------------------------------------------

export const CHART_DATA: ReadonlyArray<{ month: string; sales: number }> = [
  { month: 'January', sales: 1200 },
  { month: 'February', sales: 950 },
  { month: 'March', sales: 1430 },
  { month: 'April', sales: 1100 },
  { month: 'May', sales: 1675 },
  { month: 'June', sales: 1320 },
];

const CHART_CSV = ['month,sales', ...CHART_DATA.map((r) => `${r.month},${r.sales}`), ''].join('\n');

/** Grade the chart page: it has to open from the file on its own (the data
 *  inside it, since a page opened from disk cannot fetch the CSV) and draw
 *  something (SVG bars, a canvas, or a chart library). Full marks for both,
 *  half for one. */
export function gradeChart(html: string | undefined): EvalTaskScore {
  if (html === undefined) return { score: 0, detail: 'no chart.html was made' };
  const labels = CHART_DATA.every(
    (r) => html.includes(r.month) || html.includes(r.month.slice(0, 3)),
  );
  const values = CHART_DATA.every(
    (r) => html.includes(String(r.sales)) || html.includes(r.sales.toLocaleString('en-US')),
  );
  const rects = (html.match(/<rect[\s>]/gi) ?? []).length;
  const draws =
    (/<svg[\s>]/i.test(html) && rects >= CHART_DATA.length) ||
    /<canvas[\s>]/i.test(html) ||
    /chart\.js|chartjs|plotly|echarts|d3(\.min)?\.js|vega/i.test(html);
  const data = labels && values;
  if (data && draws) return { score: 1, detail: 'a chart with every month and value inside it' };
  if (draws) return { score: 0.5, detail: 'draws a chart, but some months or values are missing' };
  if (data) return { score: 0.5, detail: 'has the data but draws no chart' };
  return { score: 0, detail: 'neither a chart nor the data' };
}

// The button -----------------------------------------------------------------

const BUTTON_HTML = [
  '<!doctype html>',
  '<html>',
  '  <head>',
  '    <meta charset="utf-8">',
  '    <title>Rise and Crumb news</title>',
  '  </head>',
  '  <body>',
  '    <h1>Rise and Crumb news</h1>',
  '    <p>Hear about new bakes first.</p>',
  '    <button id="join">Join the list</button>',
  '    <p id="thanks" hidden>Thanks! You are on the list.</p>',
  '    <script src="script.js"></script>',
  '  </body>',
  '</html>',
  '',
].join('\n');

// The bug a person meets: the script looks for an id the page does not have,
// so the click handler is never attached and the button does nothing.
const BUTTON_SCRIPT = [
  "const button = document.getElementById('join-button');",
  "button.addEventListener('click', () => {",
  "  document.getElementById('thanks').hidden = false;",
  '});',
  '',
].join('\n');

/**
 * The button check, run with `node` in the workspace: a small stand-in DOM
 * built from the page's own ids, the page's scripts run against it (script.js
 * or whatever script tags the page now carries, and any inline onclick), then
 * a click on the Join button. Exit 0 when the thank-you message ends up
 * showing, 2 when a script throws, 1 when the click changes nothing.
 */
export const BUTTON_CHECK = `
import { readFileSync, existsSync } from 'node:fs';
const html = readFileSync('index.html', 'utf8');
const listeners = {};
function makeEl(tag, id, attrs) {
  const classes = new Set((/class=["']([^"']*)["']/.exec(attrs)?.[1] ?? '').split(/\\s+/).filter(Boolean));
  const el = {
    tagName: tag.toUpperCase(), id, hidden: /\\bhidden\\b/.test(attrs), style: {}, textContent: '',
    innerHTML: '', value: '', disabled: false, _l: {},
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, f) => { const on = f ?? !classes.has(c); on ? classes.add(c) : classes.delete(c); return on; },
      contains: (c) => classes.has(c),
    },
    addEventListener(type, fn) { (this._l[type] ??= []).push(fn); },
    removeEventListener(type, fn) { this._l[type] = (this._l[type] ?? []).filter((f) => f !== fn); },
    setAttribute(name, value) { if (name === 'hidden') this.hidden = true; if (name === 'style') this.style.display = /display:\\s*none/.test(value) ? 'none' : 'block'; },
    removeAttribute(name) { if (name === 'hidden') this.hidden = false; },
    getAttribute() { return null; },
    toggleAttribute(name, force) { if (name === 'hidden') this.hidden = force ?? !this.hidden; return this.hidden; },
    click() { fire(this, 'click'); },
    _classes: classes,
    onclick: null,
    _inline: /onclick=(["'])([\\s\\S]*?)\\1/.exec(attrs)?.[2],
  };
  return el;
}
const els = [];
for (const m of html.matchAll(/<(\\w+)([^>]*?)\\sid=["']([^"']+)["']([^>]*)>/g)) {
  els.push(makeEl(m[1], m[3], m[2] + ' ' + m[4]));
}
const byId = (id) => els.find((e) => e.id === id) ?? null;
const pick = (sel) => {
  sel = sel.trim();
  if (sel.startsWith('#')) return byId(sel.slice(1));
  if (sel.startsWith('.')) return els.find((e) => e._classes.has(sel.slice(1))) ?? null;
  const idAttr = /\\[id=["']?([^"'\\]]+)["']?\\]/.exec(sel);
  if (idAttr) return byId(idAttr[1]);
  return els.find((e) => e.tagName === sel.split(/[#.\\[\\s]/)[0].toUpperCase()) ?? null;
};
const document = {
  getElementById: byId,
  querySelector: pick,
  querySelectorAll: (sel) => els.filter((e) => e === pick(sel)),
  addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
  readyState: 'loading',
  body: makeEl('body', '', ''),
};
const window = { document, addEventListener: document.addEventListener, alert() {}, console };
function fire(el, type) {
  const event = { type, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {} };
  for (const fn of el._l[type] ?? []) fn.call(el, event);
  if (typeof el.onclick === 'function' && type === 'click') el.onclick.call(el, event);
  if (el._inline && type === 'click') new Function('document', 'window', 'event', el._inline).call(el, document, window, event);
}
const scripts = [];
for (const m of html.matchAll(/<script([^>]*)>([\\s\\S]*?)<\\/script>/gi)) {
  const src = /src=["']([^"']+)["']/.exec(m[1])?.[1];
  if (src) { if (existsSync(src)) scripts.push(readFileSync(src, 'utf8')); }
  else if (m[2].trim()) scripts.push(m[2]);
}
try {
  for (const code of scripts) new Function('document', 'window', code)(document, window);
  document.readyState = 'complete';
  for (const type of ['DOMContentLoaded', 'load']) for (const fn of listeners[type] ?? []) fn({ type });
  const button = els.find((e) => e.tagName === 'BUTTON');
  if (!button) process.exit(1);
  fire(button, 'click');
} catch (err) {
  console.error(err && err.message);
  process.exit(2);
}
const thanks = byId('thanks');
if (!thanks) process.exit(1);
const display = thanks.style.display;
const shown = (display && display !== 'none') || (!thanks.hidden && display !== 'none' && !thanks._classes.has('hidden'));
process.exit(shown ? 0 : 1);
`;

function buttonExitCode(cwd: string): number {
  try {
    execFileSync('node', ['--input-type=module', '-e', BUTTON_CHECK], {
      cwd,
      stdio: 'ignore',
      timeout: 10_000,
    });
    return 0;
  } catch (err) {
    const status = (err as { status?: number | null }).status;
    return typeof status === 'number' ? status : 1;
  }
}

/** Grade the fixed page by clicking the button in the stand-in DOM. */
export function gradeButton(cwd: string): EvalTaskScore {
  const code = buttonExitCode(cwd);
  if (code === 0) return { score: 1, detail: 'the button now shows the thank-you message' };
  if (code === 2) return { score: 0, detail: "the page's script still fails when it loads" };
  return { score: 0, detail: 'clicking the button still shows nothing' };
}

export const EVAL_EVERYDAY_TASKS: EvalTask[] = [
  {
    id: 'everyday-site',
    title: 'Make a one-page site',
    category: 'create',
    files: {},
    prompt: `Make a one-page website for my bakery, ${SITE_BAKERY}, saved as index.html. Put the bakery's name at the top as the main heading, say we're open Tuesday to Sunday from 7am to 3pm, and give people a link to email us at ${SITE_EMAIL}.`,
    async check({ cwd }) {
      return gradeSite(readText(join(cwd, 'index.html')));
    },
  },
  {
    id: 'everyday-photos',
    title: 'Rename photos by date',
    category: 'edit',
    files: {
      ...Object.fromEntries(PHOTO_RENAMES.map((p) => [`photos/${p.from}`, p.content])),
      [`photos/${PHOTO_KEEP.name}`]: PHOTO_KEEP.content,
    },
    prompt:
      'My camera named the photos in the photos folder like IMG_20240312_101500.jpg, which means it was taken on 12 March 2024 at 10:15. Rename each photo to its date and time in the form 2024-03-12_10-15.jpg so they sort nicely. Leave everything else in the folder alone.',
    async check({ cwd }) {
      return gradePhotos(join(cwd, 'photos'));
    },
  },
  {
    id: 'everyday-chart',
    title: 'Turn a spreadsheet into a chart',
    category: 'create',
    files: { 'sales.csv': CHART_CSV },
    prompt:
      'Turn sales.csv into a bar chart I can open in my web browser: one bar per month, each labelled with its month. Save it as chart.html.',
    async check({ cwd }) {
      return gradeChart(readText(join(cwd, 'chart.html')));
    },
  },
  {
    id: 'everyday-button',
    title: 'Fix a button that does nothing',
    category: 'edit',
    files: { 'index.html': BUTTON_HTML, 'script.js': BUTTON_SCRIPT },
    prompt:
      "The Join the list button on my page (index.html) doesn't do anything when I click it. It should show the thank-you message. Please fix it.",
    async check({ cwd }) {
      return gradeButton(cwd);
    },
  },
];
