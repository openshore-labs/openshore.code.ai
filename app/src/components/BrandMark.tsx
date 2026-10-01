import { appIconOf, type AppIconId } from '../lib/appIcon.js';

// The OpenShore wave-mark, 1:1 with the openshore.ai header tile and favicon:
// a rounded ink tile, a cream horizon line, a teal shore wave. Same geometry
// and colors as the marketing site's mark, verbatim. The colors do not follow
// light or dark, so the tile looks the same on any surface; they follow the app
// icon the person picked (Settings, Appearance, lib/appIcon.ts) through the
// `data-icon` attribute on the root (theme.css .brand-mark), with the default
// ink tile as the fallback written here. `icon` pins one, for the picker. The mark
// group is nudged up 0.81 so it sits optically centered in the tile (matches
// the icon, favicon, and marketing header verbatim).
export function BrandMark({ size = 28, icon }: { size?: number; icon?: AppIconId }) {
  const pinned = icon ? appIconOf(icon) : undefined;
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
      <rect
        className="bm-tile"
        width="32"
        height="32"
        rx="7.5"
        fill="#1c2a33"
        style={pinned ? { fill: pinned.tile } : undefined}
      />
      <g transform="translate(0 -0.81)">
        <line
          x1="7"
          y1="13"
          x2="25"
          y2="13"
          className="bm-line"
          stroke="#f6f4ef"
          style={pinned ? { stroke: pinned.line } : undefined}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M7 19q4.5-3.3 9 0t9 0"
          className="bm-wave"
          fill="none"
          stroke="#4b90a3"
          style={pinned ? { stroke: pinned.wave } : undefined}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
