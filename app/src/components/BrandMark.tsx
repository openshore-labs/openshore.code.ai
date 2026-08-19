// The OpenShore wave-mark, given the glossy "glass tube" treatment (the same
// specular-lighting + floating-shadow gloss the Uki app tile uses): a cream
// glass horizon bar and a teal glass wave, lit from the top-left, over a
// gradient ink tile with a top sheen. Geometry matches the openshore.ai brand
// tile (authored in a 1024 viewBox so the filters scale to any render size).
// The full-bleed / paper-splash rasterizations live in scripts/brand/*.svg.
//
// Colors are hardcoded on purpose: the tile must look identical on any surface,
// light or dark. IDs are namespaced with useId() so multiple marks on a page
// never collide on their gradient/filter references.
import { useId } from 'react';

export function BrandMark({ size = 28 }: { size?: number }) {
  const uid = useId().replace(/:/g, '');
  const id = (name: string) => `${uid}-${name}`;
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 1024 1024"
      width={size}
      height={size}
      role="img"
      aria-label="OpenShore"
      focusable="false"
    >
      <defs>
        <linearGradient id={id('tile')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#223039" />
          <stop offset="1" stopColor="#162028" />
        </linearGradient>
        <linearGradient id={id('sheen')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="0.42" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient
          id={id('cream')}
          gradientUnits="userSpaceOnUse"
          x1="480"
          y1="384"
          x2="544"
          y2="448"
        >
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#f6f4ef" />
          <stop offset="1" stopColor="#c2bbad" />
        </linearGradient>
        <linearGradient id={id('teal')} x1="0" y1="0" x2="0.14" y2="1">
          <stop offset="0" stopColor="#5e9dad" />
          <stop offset="0.5" stopColor="#4b90a3" />
          <stop offset="1" stopColor="#2f5c6a" />
        </linearGradient>
        <filter id={id('tube')} filterUnits="userSpaceOnUse" x="120" y="330" width="784" height="430">
          <feGaussianBlur in="SourceAlpha" stdDeviation="18" result="shb" />
          <feOffset in="shb" dx="0" dy="16" result="sho" />
          <feFlood floodColor="#06121b" floodOpacity="0.5" result="shc" />
          <feComposite in="shc" in2="sho" operator="in" result="shadow" />
          <feGaussianBlur in="SourceAlpha" stdDeviation="9" result="b" />
          <feSpecularLighting
            in="b"
            surfaceScale="9"
            specularConstant="0.95"
            specularExponent="20"
            lightingColor="#ffffff"
            result="s"
          >
            <feDistantLight azimuth="225" elevation="56" />
          </feSpecularLighting>
          <feComposite in="s" in2="SourceAlpha" operator="in" result="sc" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="sc" />
          </feMerge>
        </filter>
        <clipPath id={id('round')}>
          <rect width="1024" height="1024" rx="240" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id('round')})`}>
        <rect width="1024" height="1024" fill={`url(#${id('tile')})`} />
        <rect width="1024" height="1024" fill={`url(#${id('sheen')})`} />
      </g>
      <path
        d="M224 416 L800 416"
        fill="none"
        stroke={`url(#${id('cream')})`}
        strokeWidth="64"
        strokeLinecap="round"
        filter={`url(#${id('tube')})`}
      />
      <path
        d="M224 608 Q368 502.4 512 608 T800 608"
        fill="none"
        stroke={`url(#${id('teal')})`}
        strokeWidth="64"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#${id('tube')})`}
      />
    </svg>
  );
}
