import { Icon } from './Icon.js';
// The attach tray: what the composer's + opens on a phone. It sits under the
// composer, as tall as its one row of tiles (--tray-inset in theme.css), so
// the chat box itself never grows (founder, 2026-09-03: "the image selector
// expands the chat box too") and never lifts a keyboard's height over empty
// paper (founder, 2026-09-25). Three ways in, each a real picker: the camera, the
// photo library, and any file. On the desktop the + goes straight to the
// file picker and this never renders.

export type AttachSource = 'camera' | 'photos' | 'files';

function CameraGlyph() {
  return (
    <Icon size={26}>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.3-2h6l1.3 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="13" r="3.4" />
    </Icon>
  );
}

function PhotosGlyph() {
  return (
    <Icon size={26}>
      <rect x="4" y="5" width="16" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M20 15.5l-4.2-4.2a1.5 1.5 0 0 0-2.1 0L7 18" />
    </Icon>
  );
}

function FilesGlyph() {
  return (
    <Icon size={26}>
      <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h4l1.8 2h7.2A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
    </Icon>
  );
}

const TILES: Array<{ source: AttachSource; label: string; glyph: () => JSX.Element }> = [
  { source: 'camera', label: 'Camera', glyph: CameraGlyph },
  { source: 'photos', label: 'Photos', glyph: PhotosGlyph },
  { source: 'files', label: 'Files', glyph: FilesGlyph },
];

export function AttachTray({
  closing,
  onPick,
}: {
  /** The exit is playing; the tray slides down while the composer settles. */
  closing: boolean;
  onPick: (source: AttachSource) => void;
}) {
  return (
    <div className={`attach-tray${closing ? ' closing' : ''}`} role="group" aria-label="Attach">
      {TILES.map(({ source, label, glyph: Glyph }) => (
        <button
          key={source}
          type="button"
          className="attach-tile press-fb press-fb--tile"
          onClick={() => {
            onPick(source);
          }}
        >
          <span className="attach-tile-glyph">
            <Glyph />
          </span>
          <span className="attach-tile-label">{label}</span>
        </button>
      ))}
    </div>
  );
}
