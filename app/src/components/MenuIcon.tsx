// The menu (hamburger) glyph for the top-left drawer button. A drawn SVG rather
// than the thin Unicode bars, so it reads a touch more substantial: three full
// width, round-capped strokes on the shared 24-unit icon grid. Decorative; the
// button carries its own aria-label.
export function MenuIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      className="menu-glyph"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.5 6.75h17M3.5 12h17M3.5 17.25h17" />
    </svg>
  );
}
