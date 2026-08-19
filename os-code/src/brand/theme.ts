// OS Code brand theme. Every color, glyph, and wordmark in the product comes
// from this file, so a rebrand is a one-file change.
//
// The openshore.ai palette: ink navy, cream paper, a water teal, warm amber.
// These are painted as FOREGROUND colors over the user's terminal (which owns
// its own, usually dark, background), so `text` stays paper-light and `local`
// uses the brand's lighter shore-teal rather than the deep water teal the app
// UI uses on its cream ground. Status colors stay bright so they read on dark
// terminals. Keep this in step with app/src/theme.css and BrandMark.tsx.

export interface BrandTokens {
  /** Deep ocean navy. Terminals own their background; this is for reference surfaces. */
  bg: string;
  /** Off-white primary text. */
  text: string;
  /** Bright signal accent. Marks LOCAL models and local activity. */
  local: string;
  /** Warm amber. Marks CLOUD models, escalation, and anything that can spend money. */
  cloud: string;
  /** Muted gray for secondary text and chrome. */
  muted: string;
  ok: string;
  warn: string;
  danger: string;
  /** Accent for links and citations. */
  link: string;
}

export const TOKENS: BrandTokens = {
  bg: '#1C2A33', // brand ink (reference surface)
  text: '#F6F4EF', // brand paper, legible on dark terminals
  local: '#4B90A3', // brand shore-teal, LOCAL work
  cloud: '#F5A623', // warm amber, CLOUD / spend
  muted: '#8A949A', // brand ink-faint
  ok: '#4ADE80',
  warn: '#FACC15',
  danger: '#F87171',
  link: '#7DD3FC',
};

/** Small glyph set used across the TUI and plain renderer. */
export const GLYPHS = {
  localDot: '●', // filled circle
  cloudDot: '◉', // ringed circle
  ok: '✓',
  fail: '✗',
  skip: '–',
  arrow: '›',
  bullet: '•',
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
};

/**
 * The OS Code wordmark. Block lettering for wide terminals, with a compact
 * form that fits a phone terminal over SSH (~40 cols).
 */
export const WORDMARK = [
  ' ██████  ███████     ██████  ██████  ██████  ███████',
  '██    ██ ██         ██      ██    ██ ██   ██ ██',
  '██    ██ ███████    ██      ██    ██ ██   ██ █████',
  '██    ██      ██    ██      ██    ██ ██   ██ ██',
  ' ██████  ███████     ██████  ██████  ██████  ███████',
];

export const WORDMARK_COMPACT = ['▐█ OS CODE █▌'];

export const TAGLINE = 'Your machine. Your models. Your keys.';

// ---------------------------------------------------------------------------
// ANSI painting for non-Ink surfaces (plain renderer, doctor, wizards).
// Hand-rolled on purpose: no chalk dependency, predictable over SSH.
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

let colorOverride: boolean | undefined;

/** Force color on or off (the --plain flag and tests use this). */
export function setColorEnabled(enabled: boolean | undefined): void {
  colorOverride = enabled;
}

export function colorEnabled(): boolean {
  if (colorOverride !== undefined) return colorOverride;
  if (process.env.NO_COLOR) return false;
  if (process.env.TERM === 'dumb') return false;
  return Boolean(process.stdout && process.stdout.isTTY);
}

// ---------------------------------------------------------------------------
// Color depth. Ink downsamples truecolor on its own, but the hand-rolled ANSI
// on the non-Ink surfaces (doctor, wizards, plain renderer) always emitted
// 24-bit sequences, which look wrong on a 256- or 16-color terminal. So we
// detect what the terminal actually supports and emit the richest sequence it
// will render: truecolor, then xterm-256, then the ANSI-16 nearest match.
// ---------------------------------------------------------------------------

export type ColorDepth = 'truecolor' | 'ansi256' | 'ansi16';

let depthOverride: ColorDepth | undefined;

/** Force a color depth (tests use this; users never need to). */
export function setColorDepth(depth: ColorDepth | undefined): void {
  depthOverride = depth;
}

export function colorDepth(): ColorDepth {
  if (depthOverride) return depthOverride;
  const colorterm = (process.env.COLORTERM ?? '').toLowerCase();
  if (colorterm.includes('truecolor') || colorterm.includes('24bit')) return 'truecolor';
  const term = (process.env.TERM ?? '').toLowerCase();
  if (/(direct|truecolor)/.test(term)) return 'truecolor';
  if (term.includes('256')) return 'ansi256';
  if (term === '' || term === 'dumb') return 'ansi16';
  // Modern default: most terminals over SSH advertise nothing but render
  // truecolor. Assume it unless the term string says otherwise, and let
  // COLORTERM or a 256 suffix narrow it down above.
  return 'truecolor';
}

/** Map an rgb triple to an xterm-256 index (grays ramp, else the color cube). */
function to256(r: number, g: number, b: number): number {
  if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round(((r - 8) / 247) * 24);
  }
  const q = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.round((v - 35) / 40));
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

// The 16 base ANSI colors as rgb, for nearest-match when that is all there is.
const ANSI16: Array<[number, number, number]> = [
  [0, 0, 0],
  [205, 49, 49],
  [13, 188, 121],
  [229, 229, 16],
  [36, 114, 200],
  [188, 63, 188],
  [17, 168, 205],
  [229, 229, 229],
  [102, 102, 102],
  [241, 76, 76],
  [35, 209, 139],
  [245, 245, 67],
  [59, 142, 234],
  [214, 112, 214],
  [41, 184, 219],
  [255, 255, 255],
];

function toAnsi16(r: number, g: number, b: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < ANSI16.length; i++) {
    const [cr, cg, cb] = ANSI16[i]!;
    const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  // 0..7 map to 30..37, 8..15 to the bright 90..97.
  return best < 8 ? 30 + best : 90 + (best - 8);
}

/** The foreground SGR sequence for an rgb triple at the current depth. */
export function fgSequence(r: number, g: number, b: number): string {
  switch (colorDepth()) {
    case 'ansi16':
      return `\u001b[${toAnsi16(r, g, b)}m`;
    case 'ansi256':
      return `\u001b[38;5;${to256(r, g, b)}m`;
    default:
      return `\u001b[38;2;${r};${g};${b}m`;
  }
}

function paint(hex: string, s: string, bold = false): string {
  if (!colorEnabled()) return s;
  const [r, g, b] = hexToRgb(hex);
  const boldSeq = bold ? '\u001b[1m' : '';
  return `${boldSeq}${fgSequence(r, g, b)}${s}\u001b[0m`;
}

/** Theme painters. One function per token so call sites read as intent. */
export const t = {
  text: (s: string) => paint(TOKENS.text, s),
  local: (s: string) => paint(TOKENS.local, s),
  cloud: (s: string) => paint(TOKENS.cloud, s),
  muted: (s: string) => paint(TOKENS.muted, s),
  ok: (s: string) => paint(TOKENS.ok, s),
  warn: (s: string) => paint(TOKENS.warn, s),
  danger: (s: string) => paint(TOKENS.danger, s),
  link: (s: string) => paint(TOKENS.link, s),
  bold: (s: string) => (colorEnabled() ? `\u001b[1m${s}\u001b[0m` : s),
  dim: (s: string) => (colorEnabled() ? `\u001b[2m${s}\u001b[0m` : s),
};

/** Render the banner block used by `osc` on first paint and by `osc doctor`. */
export function banner(subtitle?: string): string {
  const cols = process.stdout?.columns ?? 80;
  const mark = cols >= 54 ? WORDMARK : WORDMARK_COMPACT;
  const lines = mark.map((l) => t.local(l));
  const tag = t.muted(subtitle ?? TAGLINE);
  return `${lines.join('\n')}\n${tag}`;
}
