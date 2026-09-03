// Store iconography: a line glyph per capability (used in the category rail and
// on shelf headers) and a per-model wordmark tile (the "app icon"). Models ship
// no artwork, so the tile is generated from the brand: a rounded square, water
// teal for anything that runs on the phone, deep ink otherwise, with a Fraunces
// two-letter monogram. Distinct enough to scan a shelf by, on-brand on any card.
import type { CapabilityCategory } from 'os-code/protocol';
import { modelMonogram } from './marketplace.js';

const CAP_PATHS: Record<CapabilityCategory, JSX.Element> = {
  // The quarterback: a four-point spark.
  reasoning: (
    <path d="M12 3l1.4 7.1L21 12l-7.6 1.9L12 21l-1.4-7.1L3 12l7.6-1.9z" fill="currentColor" />
  ),
  coding: <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />,
  writing: <path d="M4 20l4-1L18 9l-3-3L5 16zM14 6l3 3" />,
  analysis: <path d="M4 20h16M7 20v-6M12 20V6M17 20v-9" />,
  vision: (
    <>
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.4" />
    </>
  ),
  'image-gen': (
    <>
      <path d="M4 5h16v14H4zM4 16l4-4 3 3 4-5 5 6" />
      <circle cx="8.5" cy="9" r="1.3" />
    </>
  ),
  embedding: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4-4" />
    </>
  ),
  fast: <path d="M13 3L5 13h5l-1 8 8-11h-5z" fill="currentColor" />,
};

/** A line glyph for a capability. Strokes/fills follow currentColor. */
export function CapIcon({ cap, size = 16 }: { cap: CapabilityCategory; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {CAP_PATHS[cap]}
    </svg>
  );
}

/** The generated "app icon" tile for a model. Teal for on-device (local and
 *  private), the amber spend family for a cloud-hosted model, ink otherwise. */
export function ModelTile({
  name,
  onDevice = false,
  cloud = false,
  size = 52,
  transitionName,
}: {
  name: string;
  onDevice?: boolean;
  cloud?: boolean;
  size?: number;
  /** A view-transition-name for one hop, so this tile is the shared element
   *  a product page's tile flies from (or back to). Set on exactly one tile
   *  at a time: a duplicate name makes the platform skip the transition. */
  transitionName?: string;
}) {
  const style: Record<string, string | number> = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.36),
  };
  if (transitionName) style.viewTransitionName = transitionName;
  return (
    <div
      className={`model-tile${onDevice ? ' on-device' : ''}${cloud ? ' cloud' : ''}`}
      style={style}
      aria-hidden="true"
    >
      {modelMonogram(name)}
    </div>
  );
}
