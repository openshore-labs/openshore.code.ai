// The xterm canvas colors, read from the theme tokens at mount (UI-12) so the
// two terminal surfaces (the from-a-chat takeover and the room) and the CSS
// host behind them share one source. The fallbacks match theme.css :root for
// a build where the stylesheet has not applied yet.
export function terminalTheme(): { background: string; foreground: string } {
  const read = (name: string, fallback: string): string => {
    if (typeof document === 'undefined') return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  };
  return { background: read('--term-bg', '#0b0d12'), foreground: read('--term-fg', '#e6e6e6') };
}

/** The line xterm shows when the shell ends, and the status message beside it. */
export function exitLine(code: number): string {
  return code === 0 ? 'The shell exited.' : `The shell exited with code ${code}.`;
}
