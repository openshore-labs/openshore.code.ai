// The UI rules the 2026-10-07 review set (Creative Studio and CMO), written as
// functions over source files. app/test/uiGuards.test.ts holds every file no
// room package owns, and each room's app/test/uiGuards.<room>.test.ts holds its
// own files, so a new file nobody lists still falls under a guard. A rule is a
// name and a check that returns one offence per line it fails, as
// 'path:line rule: text'. Emergency door is an exemption with its reason
// written beside it, never a loosened rule.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

export type Room = 'chat' | 'shell' | 'machines' | 'places';

/** The files each room package owns, src-relative. A listed file that does
 *  not exist yet is skipped (lib/chatScope.ts arrives in wave 1). */
export const ROOM_FILES: Record<Room, string[]> = {
  chat: [
    'components/Composer.tsx',
    'screens/ChatScreen.tsx',
    'components/ModelSheet.tsx',
    'components/ModeSheet.tsx',
    'components/RepoPicker.tsx',
    'components/ThinkingBlock.tsx',
    'components/TodoCard.tsx',
    'components/ChangedFilesCard.tsx',
    'components/WindowCutCard.tsx',
    'components/TrustCard.tsx',
    'components/AppActionCard.tsx',
    'components/FirstSeat.tsx',
    'components/ProfileStatus.tsx',
    'components/GuideSetupLink.tsx',
    'components/ToolCard.tsx',
    'lib/chatRepos.ts',
    'lib/greeting.ts',
    'lib/thinkingWords.ts',
    'drivers/cloudChat.ts',
    'drivers/cloudClaudeDriver.ts',
    'drivers/cloudOpenAiDriver.ts',
    'state/store.ts',
  ],
  shell: [
    'components/Sidebar.tsx',
    'screens/ChatsScreen.tsx',
    'screens/ProjectsScreen.tsx',
    'screens/ProjectDetailScreen.tsx',
    'screens/ProjectMemoryScreen.tsx',
    'components/ProjectVaultPins.tsx',
    'screens/OnboardingScreen.tsx',
    'components/StartingPaths.tsx',
    'components/UpdateBanner.tsx',
    'lib/chatScope.ts',
    'lib/guidedSetup.ts',
  ],
  machines: [
    'screens/PairScreen.tsx',
    'components/QrScanner.tsx',
    'screens/TerminalRoomScreen.tsx',
    'screens/TerminalScreen.tsx',
    'components/DesktopTerminal.tsx',
    'screens/ReposScreen.tsx',
    'screens/ConnectionsScreen.tsx',
    'components/StackManager.tsx',
    'screens/StackScreen.tsx',
    'components/InstallByName.tsx',
    'lib/providers.ts',
    'lib/stack.ts',
    'lib/packs.ts',
  ],
  places: [
    'screens/VaultScreen.tsx',
    'lib/vaultCopy.ts',
    'screens/CrewScreen.tsx',
    'screens/CrewCommandScreen.tsx',
    'lib/routines.ts',
    'screens/SettingsScreen.tsx',
    'components/SettingsRow.tsx',
    'components/WritingVoiceField.tsx',
    'components/WebSearchAsk.tsx',
    'components/VoicePicker.tsx',
    'components/SignInCard.tsx',
    'lib/egressManifest.ts',
    'lib/guideCards.ts',
    'lib/setupGuides.ts',
    'components/VaultProperties.tsx',
    'components/ProjectMultiSelect.tsx',
    'components/vault/VaultBacklinks.tsx',
    'components/VaultAgentRecent.tsx',
  ],
};

/** Every .ts and .tsx under app/src, src-relative, with posix separators. */
export function srcFiles(dir = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) srcFiles(path, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
      out.push(relative(SRC, path).split(sep).join('/'));
  }
  return out.sort();
}

/** The files no room package owns. */
export function restFiles(): string[] {
  const owned = new Set(Object.values(ROOM_FILES).flat());
  return srcFiles().filter((f) => !owned.has(f));
}

/** Comments out, code and copy in, the way copy-glossary.test.ts strips them,
 *  but a block comment keeps its line breaks so an offence carries its true
 *  line. A line comment goes from its slashes to the end of the line, unless
 *  the slashes follow a colon (a URL inside a string, like https://). Whole
 *  line comments go first, and a block opens only at a line's start, after a
 *  space or a brace, so a glob like 'Private/**' or 'lib/voice/*' in a string
 *  or a comment never blanks the code below it until some later star-slash. */
export function stripComments(src: string): string {
  return src
    .replace(/^([ \t]*)\/\/.*$/gm, '$1')
    .replace(
      /(^|[\s{(])\/\*[\s\S]*?\*\//gm,
      (m, lead: string) => lead + m.slice(lead.length).replace(/[^\n]/g, ' '),
    )
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** Every opening tag of this element in a source, with its line. The tag
 *  ends at the first `>` outside braces and quotes, so an arrow function or
 *  a template in an attribute does not end it early. A tag on a comment
 *  line is prose, not markup. (polish-standards.test.ts holds the same.) */
export function openingTags(src: string, name: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  for (const m of src.matchAll(new RegExp(`<${name}\\b`, 'g'))) {
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(src.slice(lineStart, m.index + 1))) continue;
    let i = m.index + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    for (; i < src.length; i++) {
      const c = src[i]!;
      if (quote) {
        if (c === quote && src[i - 1] !== '\\') quote = null;
      } else if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push({ line: src.slice(0, m.index).split('\n').length, text: src.slice(m.index, i + 1) });
  }
  return out;
}

/** An attribute's raw value in a tag: "..." or a balanced {...}. */
function attr(tag: string, name: string): string {
  const m = new RegExp(`\\b${name}=`).exec(tag);
  if (!m) return '';
  let i = m.index + m[0].length;
  if (tag[i] === '"') return tag.slice(i + 1, tag.indexOf('"', i + 1));
  if (tag[i] !== '{') return '';
  const start = i;
  let depth = 0;
  for (; i < tag.length; i++) {
    if (tag[i] === '{') depth++;
    else if (tag[i] === '}' && --depth === 0) break;
  }
  return tag.slice(start, i + 1);
}

const offence = (path: string, line: number, rule: string, text: string) =>
  `${path}:${line} ${rule}: ${text.replace(/\s+/g, ' ').trim().slice(0, 100)}`;

/** Every line of a source that matches, as an offence, unless allowed. */
function lineHits(
  path: string,
  src: string,
  rule: string,
  re: RegExp,
  allow: (line: string) => boolean = () => false,
): string[] {
  const out: string[] = [];
  src.split('\n').forEach((line, i) => {
    if (re.test(line) && !allow(line)) out.push(offence(path, i + 1, rule, line));
  });
  return out;
}

// The later tiers' files, each with no door in a Personal build. A rule that
// skips them says so where it does.
const LATER_TIER: Record<string, string> = {
  'screens/AdminScreen.tsx': 'Admin, v4: no door in Personal',
  'screens/MarketplaceScreen.tsx': 'the Marketplace, v3: no door in Personal',
  'screens/StackHealthScreen.tsx': 'Stack Health, v2: no door in Personal',
  'screens/LaunchScreen.tsx': 'Launch with Codemagic, v2: no door in Personal',
};

/** Retired on 2026-10-07, each with what to use instead. Case sensitive and
 *  word-bounded, so modelFamilies.ts's 'Reasoning models' stays clear. */
export const RETIRED_2026_10_07: Array<{ pattern: RegExp; use: string }> = [
  { pattern: /\bReasoning model\b/, use: "'Reasoning LLM' (founder, 2026-09-15)" },
  { pattern: /\blead model\b/, use: "'Reasoning LLM'" },
  { pattern: /\bPair your computer\b/, use: "'Connect your computer' (the pairing review)" },
  { pattern: /\bSet up pairing\b/, use: "'Connect your computer'" },
  { pattern: /\bmain computer\b/, use: "'your computer'" },
  { pattern: /\bcentral computer\b/, use: "'your computer'" },
  {
    pattern: /\bAbout \$?\{HARBOR_APPROX_LABEL\}/,
    use: "HARBOR_APPROX_LABEL alone: it already starts with 'about'",
  },
];

export const RULES: Array<{ name: string; check(path: string, src: string): string[] }> = [
  {
    // The large-title ruling (Creative Studio, 2026-10-02): a room whose page
    // title is an h1 tucks its BackBar title until that h1 scrolls under the
    // bar. A note for the rooms: never share one ref across two returns.
    // BackBar persists across a component's branches, and useTucked
    // re-observes only when the ref object changes, so a room with two
    // returns declares one ref per branch, above any early return.
    name: 'tuck',
    check(path, src) {
      const EXEMPT_FILES: Record<string, string> = {
        ...LATER_TIER,
        'screens/CrewCommandScreen.tsx': 'its h1 is the hero headline, not the page title',
      };
      // `inside` names the function the tag sits in, where the same text
      // also heads a room that has an h1 (the Vault room and its fallback).
      const EXEMPT_TAGS: Array<{ file: string; text: string; inside?: string; why: string }> = [
        {
          file: 'screens/ProjectDetailScreen.tsx',
          text: '<BackBar title="Project" />',
          why: 'the not-found state, which has no h1',
        },
        {
          file: 'screens/VaultScreen.tsx',
          text: '<BackBar title="Vault" />',
          inside: 'VaultFault',
          why: 'the error boundary, which has no h1',
        },
      ];
      if (!path.endsWith('.tsx') || EXEMPT_FILES[path]) return [];
      const code = stripComments(src);
      if (!openingTags(code, 'h1').length) return [];
      const lines = code.split('\n');
      const enclosing = (line: number): string | undefined => {
        for (let i = line - 1; i >= 0; i--) {
          const fn = lines[i]!.match(/^(?:export\s+)?(?:default\s+)?function\s+(\w+)/)?.[1];
          if (fn) return fn;
        }
        return undefined;
      };
      return openingTags(code, 'BackBar')
        .filter((t) => !/\btitleHiddenUntil=/.test(t.text))
        .filter(
          (t) =>
            !EXEMPT_TAGS.some(
              (e) =>
                e.file === path &&
                e.text === t.text &&
                (!e.inside || enclosing(t.line) === e.inside),
            ),
        )
        .map((t) => offence(path, t.line, 'tuck', t.text));
    },
  },
  {
    // Words the 2026-10-07 copy review retired. copy-glossary.test.ts holds
    // the older list over every file at once; this one runs file by file, so
    // each room clears its own.
    name: 'retiredCopy',
    check(path, src) {
      const out: string[] = [];
      stripComments(src)
        .split('\n')
        .forEach((line, i) => {
          for (const { pattern, use } of RETIRED_2026_10_07)
            if (pattern.test(line))
              out.push(offence(path, i + 1, 'retiredCopy', `${line.trim()} (use ${use})`));
        });
      return out;
    },
  },
  {
    // A .btn takes its size by class (sm, block), never an inline padding or
    // width, so two buttons that mean the same thing are the same size.
    name: 'btnSize',
    check(path, src) {
      const EXEMPT: Record<string, string> = {
        'screens/AdminScreen.tsx': LATER_TIER['screens/AdminScreen.tsx']!,
        'screens/LaunchScreen.tsx': LATER_TIER['screens/LaunchScreen.tsx']!,
        'screens/MarketplaceScreen.tsx': LATER_TIER['screens/MarketplaceScreen.tsx']!,
        'components/AccountSetup.tsx': 'teams and plans, v4: no door in Personal',
        'components/PlusNote.tsx': 'the pay gate, reviewed with the paywall',
      };
      if (!path.endsWith('.tsx') || EXEMPT[path]) return [];
      return openingTags(stripComments(src), 'button')
        .filter((t) => /(?<![\w-])btn(?![\w-])/.test(attr(t.text, 'className')))
        .filter((t) =>
          /\b(padding(?:Top|Bottom|Left|Right|Inline|Block)?|width)\s*:/.test(
            attr(t.text, 'style'),
          ),
        )
        .map((t) => offence(path, t.line, 'btnSize', t.text));
    },
  },
  {
    // Carets, chevrons and checks are drawn (SheetGlyphs.tsx), never typed: a
    // typed one carries the font's bearings and sits off its line. The
    // terminal's typed $ and its arrow keys stay typed.
    name: 'typedGlyph',
    check(path, src) {
      const EXEMPT: Record<string, string> = {
        'screens/MarketplaceScreen.tsx': LATER_TIER['screens/MarketplaceScreen.tsx']!,
        'components/LibraryIntro.tsx': 'the Marketplace library, v3: no door in Personal',
      };
      if (!path.endsWith('.tsx') || EXEMPT[path]) return [];
      return lineHits(path, stripComments(src), 'typedGlyph', /[▾▸▴›✓]/);
    },
  },
  {
    // Teal means local and private, only. A state wears the ink pill and a
    // choice the accent; `pill local` and an inline --local stay for local
    // work, each line here with its reason.
    name: 'pillLocal',
    check(path, src) {
      const EXEMPT: Record<string, string> = {
        'screens/MarketplaceScreen.tsx': LATER_TIER['screens/MarketplaceScreen.tsx']!,
        'components/Stars.tsx': 'the Marketplace ratings, v3: no door in Personal',
        'components/AccountSetup.tsx': 'teams and plans, v4: no door in Personal',
      };
      const LINES: Array<{ file: string; match: RegExp; why: string }> = [
        {
          file: 'screens/StackScreen.tsx',
          match: /\bpill local\b/,
          why: "a prefab stack's local download size",
        },
        {
          file: 'components/StackManager.tsx',
          match: /\bpill local\b/,
          why: 'the via-current chip (Currents, a later tier)',
        },
        {
          file: 'screens/CrewCommandScreen.tsx',
          match: /on its own computer/,
          why: 'a crew member at work on its own computer: local work',
        },
      ];
      if (!path.endsWith('.tsx') || EXEMPT[path]) return [];
      return lineHits(path, stripComments(src), 'pillLocal', /\bpill local\b|'var\(--local/, (l) =>
        LINES.some((e) => e.file === path && e.match.test(l)),
      );
    },
  },
  {
    // Icons sit on an even size scale; an odd size rounds up one step.
    name: 'iconScale',
    check(path, src) {
      const SCALE = new Set([12, 14, 16, 18, 20, 22, 26, 30]);
      const EXEMPT: Record<string, string> = {
        'screens/MarketplaceScreen.tsx': LATER_TIER['screens/MarketplaceScreen.tsx']!,
        'components/LibraryIntro.tsx': 'the Marketplace library, v3: no door in Personal',
      };
      if (!path.endsWith('.tsx') || EXEMPT[path]) return [];
      return openingTags(stripComments(src), 'Icon')
        .filter((t) => {
          const size = t.text.match(/\bsize=\{(\d+(?:\.\d+)?)\}/)?.[1];
          return size !== undefined && !SCALE.has(Number(size));
        })
        .map((t) => offence(path, t.line, 'iconScale', t.text));
    },
  },
  {
    // Rows step by the --stagger token, through an index (--i) in the
    // stylesheet, never a step written inline.
    name: 'inlineStagger',
    check(path, src) {
      if (!path.endsWith('.tsx')) return [];
      return lineHits(
        path,
        stripComments(src),
        'inlineStagger',
        /['"]--stagger['"](?:\s+as\s+[\w.]+)?\]?\s*:/,
      );
    },
  },
];

/** Every rule over every file (src-relative; a missing file is skipped). */
export function offences(files: string[]): string[] {
  const out: string[] = [];
  for (const file of files) {
    const path = join(SRC, file);
    if (!existsSync(path)) continue;
    const src = readFileSync(path, 'utf8');
    for (const rule of RULES) out.push(...rule.check(file, src));
  }
  return out;
}
