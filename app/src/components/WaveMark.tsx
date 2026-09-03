// The OpenShore mark in motion: the working row's "still here" sign. Same
// geometry as BrandMark (the cream horizon line held still, the teal shore
// wave, "q4.5-3.3 9 0t9 0", one wavelength of 18 units), drawn two
// wavelengths wide inside a clip and carried one wavelength to the right per
// loop, so it rolls like surf and the loop seam is invisible. Only the group's
// transform moves (GPU, no layout); the wave itself never redraws. At rest,
// and under reduced motion, the still frame is simply the mark, an honest
// still. Colors ride the theme so it reads on cream and on ink alike: the
// horizon in muted ink (cream on cream would vanish), the wave in the teal.
// Creative Studio direction "Surf", 2026-09-03.
import { useId } from 'react';

export function WaveMark({ width = 24 }: { width?: number }) {
  // One clip id per instance so two marks on a page never share a clipPath.
  // useId's colons are stripped: the id sits inside a url() reference.
  const clipId = `wave-clip-${useId().replace(/:/g, '')}`;
  return (
    <svg
      className="wave-mark"
      viewBox="0 0 18 10"
      width={width}
      height={(width * 10) / 18}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width="18" height="10" />
        </clipPath>
      </defs>
      <line
        className="wave-mark-horizon"
        x1="1"
        y1="2.5"
        x2="17"
        y2="2.5"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <g clipPath={`url(#${clipId})`}>
        <path
          className="wave-mark-surf"
          d="M-18 6.5q4.5-3.3 9 0t9 0t9 0t9 0"
          fill="none"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
