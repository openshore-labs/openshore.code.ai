// OS Code brand theme. Every color, glyph, and wordmark in the product comes
// from this file, so a rebrand is a one-file change.
//
// OPENSHORE: replace with real brand tokens. The values below are considered
// placeholders in the OpenShore palette direction: deep ocean navy ground,
// off-white text, a bright signal accent for LOCAL work, warm amber for CLOUD
// escalation, muted gray for secondary chrome.

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
  bg: '#0B1B2B', // OPENSHORE: replace with real brand tokens
  text: '#F2EFE9', // OPENSHORE: replace with real brand tokens
  local: '#2DD4BF', // OPENSHORE: replace with real brand tokens (signal teal)
  cloud: '#F5A623', // OPENSHORE: replace with real brand tokens (warm amber)
  muted: '#8A97A5', // OPENSHORE: replace with real brand tokens
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

function paint(hex: string, s: string, bold = false): string {
  if (!colorEnabled()) return s;
  const [r, g, b] = hexToRgb(hex);
  const boldSeq = bold ? '\u001b[1m' : '';
  return `${boldSeq}\u001b[38;2;${r};${g};${b}m${s}\u001b[0m`;
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
