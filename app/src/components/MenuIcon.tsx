// The menu (hamburger) glyph for the top-left drawer button. A drawn SVG rather
// than the thin Unicode bars, so it reads a touch more substantial: three full
// width, round-capped strokes on the shared 24-unit icon grid. Decorative; the
// button carries its own aria-label. With `open`, the bars fold into a back
// chevron on the door clock (theme.css .menu-glyph.open), so the control
// acknowledges the drawer it opened.
export function MenuIcon({ size = 22, open = false }: { size?: number; open?: boolean }) {
  return (
    <svg
      className={`menu-glyph${open ? ' open' : ''}`}
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
      <path className="menu-bar-top" d="M3.5 6.75h17" />
      <path className="menu-bar-mid" d="M3.5 12h17" />
      <path className="menu-bar-bottom" d="M3.5 17.25h17" />
    </svg>
  );
}
