// COPY GLOSSARY GUARD (Creative Studio brand sweep, founder 2026-09-24). One
// thing has one name everywhere a person reads it: the room is Stack (never
// "Your stack" or "My Stack" as a name), the machine is "your computer", a
// field for an endpoint is an Address, the pairing room is Desktop + phone, and
// nothing says "Always on" or "OS Code". This scans the app's UI source with
// comments stripped (string literals and JSX text are what is left that a
// person can read) and fails on any retired string. It also pins the room
// names to one exported list (navRooms.ts ROOM_LABELS) that the Sidebar, the
// BackBar, and Harbor Lite's Menu card all read, so they cannot drift apart.
// The plan and its glossary: docs/brand-sweep-2026-09-24.md.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROOM_LABELS, navRooms } from '../src/lib/navRooms.js';
import { GUIDE_CARDS } from '../src/lib/guideCards.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const SRC = join(ROOT, 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Every UI source file: all .tsx, plus the pure libs a screen or Harbor
 *  Lite reads copy from (src/lib/*.ts, one level, no subfolders), plus the
 *  store and drivers, whose toasts and errors reach the screen. */
const FILES = walk(SRC)
  .filter((p) => {
    const rel = relative(SRC, p).split('\\').join('/');
    if (rel.endsWith('.tsx')) return true;
    if (/^lib\/[^/]+\.ts$/.test(rel)) return true;
    if (/^(state|drivers)\/[^/]+\.ts$/.test(rel)) return true;
    return false;
  })
  .sort();

/** Comments out, code and copy in. Block and JSX comments go whole; a line
 *  comment goes from its slashes to the end of the line, unless the slashes
 *  follow a colon (a URL inside a string, like https://). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** A retired string, why it is retired, and what to say instead. Case
 *  sensitive on purpose: Harbor Lite's lowercase match keywords ("my stack",
 *  "local llms") are how a person might still ask, not copy anyone reads. */
const RETIRED: Array<{ pattern: RegExp; use: string }> = [
  { pattern: /\bYour [Ss]tack\b/, use: 'Stack (the room); "your stack" only mid-sentence' },
  { pattern: /\bMy Stack\b/, use: 'Stack' },
  { pattern: /\bDesktop and phone\b/, use: 'Desktop + phone' },
  { pattern: /\bDesktop connection\b/, use: 'Desktop + phone' },
  { pattern: /\bHub address\b/, use: 'Address' },
  { pattern: /\bDesktop address\b/, use: 'Address' },
  { pattern: /\bEndpoint URL\b/, use: 'Address' },
  { pattern: /(['"`>]\s*)Setup(\s*['"`<])/, use: 'Set up (a verb), or Set up OpenShore' },
  { pattern: /\bAlways on\b/, use: 'Enforced, or say what is true' },
  { pattern: /\bOS Code\b/, use: 'OpenShore' },
  { pattern: /\bOpen Shore\b/, use: 'OpenShore' },
  { pattern: /\bDeep Blue\b/, use: 'DeepBlue' },
  { pattern: /\bCloud Providers\b/, use: 'Cloud models' },
  { pattern: /\bLocal LLMs\b/, use: 'Local models' },
  { pattern: /\bCloud connections\b/, use: 'Cloud Connections' },
  { pattern: /\bApp Launch\b/, use: 'Launch with Codemagic' },
  { pattern: /\bHistorical knowledge\b/, use: 'What it has learned' },
  { pattern: /['"`>]\s*Project notes\b/, use: 'What it has learned' },
  { pattern: /\bBuffered while off-home\b/, use: 'Waiting to sync home' },
  { pattern: /\bhome system\b/, use: 'your computer' },
  { pattern: /\byour hub\b/i, use: 'your computer' },
  {
    pattern: /\bthe marketplace\b/,
    use: 'the Marketplace (Coming soon), or Stack and Settings, Harbor',
  },
  { pattern: /\bRead only\b/, use: 'Read-only' },
  { pattern: /(['"`>]\s*)Retry(\s*['"`<])/, use: 'Try again' },
];

/** Deliberate exceptions, each with its reason. Keep this short. */
const ALLOW: Array<{ file: string; pattern: RegExp; why: string }> = [];

function allowed(file: string, pattern: RegExp): boolean {
  return ALLOW.some((a) => a.file === file && a.pattern.source === pattern.source);
}

describe('retired UI strings', () => {
  it('scans a real set of files', () => {
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES.some((f) => f.endsWith('Sidebar.tsx'))).toBe(true);
  });

  it('no retired string survives in anything a person reads', () => {
    const hits: string[] = [];
    for (const file of FILES) {
      const rel = relative(ROOT, file).split('\\').join('/');
      const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        for (const { pattern, use } of RETIRED) {
          if (pattern.test(line) && !allowed(rel, pattern)) {
            hits.push(`${rel}:${i + 1} matches ${pattern} (use: ${use}): ${line.trim()}`);
          }
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it('the guard itself catches what it should (strip keeps copy, drops comments)', () => {
    const sample = stripComments(
      [
        '// Your stack in a comment is fine',
        "const a = 'https://example.com'; /* My Stack in a block is fine */",
        "const b = 'Open Your stack';",
      ].join('\n'),
    );
    expect(sample).toContain('https://example.com');
    expect(sample).not.toContain('My Stack');
    expect(RETIRED[0]!.pattern.test(sample)).toBe(true);
  });
});

// Title Case only for proper nouns (founder, 2026-09-24); Sentence case for the
// rest, where only the first word is capitalized (and a proper noun inside it,
// like Codemagic).
const PROPER_NOUN_ROOMS = new Set([
  'My Crew',
  'Cloud Connections',
  'Stack Health',
  'Vault',
  'Marketplace',
  'Settings',
]);
const PROPER_WORDS = new Set(['Codemagic', 'OpenShore', 'Harbor', 'DeepBlue']);

function sentenceCase(label: string): boolean {
  return label
    .split(' ')
    .slice(1)
    .every((w) => w === '+' || PROPER_WORDS.has(w) || w === w.toLowerCase());
}

describe('room names come from one list', () => {
  it('every room name is Title Case only for a proper noun, else Sentence case', () => {
    for (const label of Object.values(ROOM_LABELS)) {
      expect(PROPER_NOUN_ROOMS.has(label) || sentenceCase(label), label).toBe(true);
    }
  });

  it('names the stack Stack, and the renamed rooms by their new names', () => {
    expect(ROOM_LABELS.stack).toBe('Stack');
    expect(ROOM_LABELS.launch).toBe('Launch with Codemagic');
    expect(ROOM_LABELS.pair).toBe('Desktop + phone');
  });

  it('the nav groups read their labels from the list', () => {
    for (const input of [
      { desktop: true, hubPaired: false },
      { desktop: false, hubPaired: false },
    ]) {
      const { primary, explore } = navRooms(input);
      for (const r of [...primary, ...explore]) expect(r.label).toBe(ROOM_LABELS[r.view]);
    }
  });

  it('the Sidebar and the BackBar spell no room name of their own', () => {
    const sidebar = stripComments(readFileSync(join(SRC, 'components/Sidebar.tsx'), 'utf8'));
    expect(sidebar).toContain('ROOM_LABELS[view]');
    const backbar = stripComments(readFileSync(join(SRC, 'components/BackBar.tsx'), 'utf8'));
    expect(backbar).toContain('...ROOM_LABELS');
    for (const label of Object.values(ROOM_LABELS)) {
      // Admin sits beside the list in the Sidebar (company admins only).
      expect(sidebar, `Sidebar spells "${label}"`).not.toContain(`label: '${label}'`);
      expect(backbar, `BackBar spells "${label}"`).not.toMatch(new RegExp(`: '${label}',`));
    }
  });

  it("every screen's top bar names its room from the list", () => {
    // Titles outside the nav list: Crew command (reached from My Crew), Admin
    // (company admins), and pages inside a room. A name the person chose (a
    // project, a note) is an expression, not a literal, so it never shows here.
    const NOT_ROOMS = new Set([
      'Crew command',
      'Admin',
      'Project',
      'Codemagic',
      'What it has learned',
    ]);
    const rooms = new Set(Object.values(ROOM_LABELS));
    for (const file of FILES) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/<BackBar\s+title="([^"]+)"/g)) {
        const title = m[1]!;
        expect(rooms.has(title) || NOT_ROOMS.has(title), `${file}: ${title}`).toBe(true);
      }
    }
  });

  it("Harbor Lite's Menu card lists every room by its name", () => {
    const menu = GUIDE_CARDS.find((c) => c.id === 'menu');
    expect(menu).toBeTruthy();
    for (const label of Object.values(ROOM_LABELS)) expect(menu!.text).toContain(label);
  });
});
