// The OpenShore wave-mark, 1:1 with the openshore.ai header tile and favicon:
// a rounded ink tile, a cream horizon line, a teal shore wave. Same geometry
// and colors as the marketing site's mark, verbatim. Colors are hardcoded on
// purpose so the tile looks identical on any surface, light or dark. The mark
// group is nudged up 0.81 so it sits optically centered in the tile (matches
// the icon, favicon, and marketing header verbatim).
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role="img"
      aria-label="OpenShore"
      focusable="false"
    >
      <rect width="32" height="32" rx="7.5" fill="#1c2a33" />
      <g transform="translate(0 -0.81)">
        <line
          x1="7"
          y1="13"
          x2="25"
          y2="13"
          stroke="#f6f4ef"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M7 19q4.5-3.3 9 0t9 0"
          fill="none"
          stroke="#4b90a3"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
