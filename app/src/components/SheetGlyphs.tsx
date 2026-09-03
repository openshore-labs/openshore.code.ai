// The two glyphs a sheet header uses in its round button: close and back.
// Drawn as strokes, not typed as characters. A text "×" or "‹" carries the
// font's side bearings and baseline with it, so it lands low and to the left
// of the circle it sits in (founder screenshot, 2026-09-03). A path in a
// square viewBox is centered by geometry, whatever font is loaded.
export function CloseGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg
      className="sheet-glyph"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function BackGlyph() {
  return (
    <svg
      className="sheet-glyph"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* Optically nudged one unit left so the chevron's mass reads centered. */}
      <path d="M15 5L8 12l7 7" />
    </svg>
  );
}
