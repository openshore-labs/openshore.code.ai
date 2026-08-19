// The OpenShore wave-mark: a rounded ink tile with a cream horizon line and a
// shore wave in teal. Same geometry as the openshore.ai header tile and
// favicon, so the app carries the identical brand tile. Colors are hardcoded
// on purpose (they must survive on any surface, light or dark) and match the
// --ink / --bg / --wave theme tokens.
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
      <line x1="7" y1="13" x2="25" y2="13" stroke="#f6f4ef" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M7 19q4.5-3.3 9 0t9 0"
        fill="none"
        stroke="#4b90a3"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
