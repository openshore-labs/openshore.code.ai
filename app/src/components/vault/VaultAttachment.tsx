// An image or a PDF in a note (Vault M6 6.6, tech review K11, UX review X14). Read-only.
//
// An image never takes its `src` from the note: the reader resolved the
// attachment path against the vault's own attachment list, and this component
// asks the blob registry (lib/vaultBlobs.ts) for a URL it made from bytes the
// provider read. So a note cannot point an image at a `blob:` or `data:` URL,
// and a remote http(s) image is never fetched (the reader shows it as a link
// chip). SVG only ever shows inside `<img>`, where its scripts do not run.
// While the bytes read, a 4:3 skeleton holds the place and the image fades in
// over it; nothing tweens layout. A tap opens the image full screen in a
// presence-aware Sheet with the platform's own pinch zoom.
//
// A PDF is a chip. On the desktop a tap opens it in the system viewer; on a
// phone it names the file until a native preview lands.
import { useEffect, useState } from 'react';
import {
  VAULT_ATTACHMENT_MAX_BYTES,
  bytesMatchMime,
  type AttachmentMeta,
  type BytesRead,
} from 'os-code/protocol';
import {
  vaultBlobKey,
  vaultBlobs,
  type BlobFailure,
  type VaultBlobRegistry,
} from '../../lib/vaultBlobs.js';
import { vaultReaderCopy } from '../../lib/vaultCopy.js';
import { Icon } from '../Icon.js';
import { Sheet } from '../Sheet.js';
import { SheetHead } from '../SheetHead.js';

/** Where the reader gets attachment bytes. Built by the Vault room from the
 *  provider (or the electron bridge) of the vault on screen. */
export interface VaultMedia {
  /** Provider and resource, the first part of every blob key. */
  scope: string;
  /** The vault's attachments, from `listAttachments`. */
  attachments: readonly AttachmentMeta[];
  /** Obsidian's `attachmentFolderPath`, when the vault sets one. */
  attachmentFolder?: string;
  readBytes(path: string): Promise<BytesRead>;
  /** Open a PDF in the system viewer (the desktop's
   *  `osc:vaultOpenAttachment`). Absent on a phone. */
  openAttachment?(path: string): Promise<{ ok: boolean }>;
  /** Your computer is off, so nothing can be read from it. */
  away?: boolean;
  /** The blob registry; the app's own one unless a test injects another. */
  registry?: VaultBlobRegistry;
}

export interface VaultAttachmentProps {
  kind: 'image' | 'pdf';
  /** The resolved attachment path, or absent when nothing matched. */
  path?: string;
  /** The file name as shown. */
  name: string;
  alt?: string;
  /** Obsidian's `|300` size, in CSS pixels. */
  width?: number;
  media?: VaultMedia;
  onNotice?: (message: string) => void;
  /** A tap on a loaded image: the reader shows it full screen. */
  onZoom?: (image: ZoomedImage) => void;
}

function DocGlyph() {
  return (
    <Icon className="vault-chip-glyph" size={16} weight="hairline">
      <path d="M6 2.25h8.25L19.5 7.5v14.25H6z M14.25 2.25V7.5h5.25" />
    </Icon>
  );
}

function ImageGlyph() {
  return (
    <Icon className="vault-chip-glyph" size={16} weight="hairline">
      <rect x="3" y="4.5" width="18" height="15" rx="2.25" />
      <path d="M4.5 18l5.25-6 3.75 4.5 2.25-2.25L19.5 18" />
    </Icon>
  );
}

/** A quiet, non-interactive chip: a glyph, a line, and an optional sub. */
function Chip({ glyph, text, sub }: { glyph: 'doc' | 'image'; text: string; sub?: string }) {
  return (
    <span className="vault-chip">
      {glyph === 'doc' ? <DocGlyph /> : <ImageGlyph />}
      <span className="vault-chip-text">
        <span className="vault-chip-name">{text}</span>
        {sub ? <span className="vault-chip-sub">{sub}</span> : null}
      </span>
    </span>
  );
}

/** An image shown full screen. */
export interface ZoomedImage {
  url: string;
  alt: string;
  name: string;
}

/** The full-screen view: a presence-aware Sheet with the platform's own pinch
 *  zoom; the grabber or the close dismisses it. The reader renders one at its
 *  root, never inside the paragraph an image sits in. It keeps the last image
 *  through the exit, so the sheet never empties while it slides away. */
export function VaultImageSheet({
  image,
  onClose,
}: {
  image: ZoomedImage | null;
  onClose: () => void;
}) {
  const [last, setLast] = useState<ZoomedImage | null>(image);
  if (image && image !== last) setLast(image);
  const shown = image ?? last;
  return (
    <Sheet open={Boolean(image)} onClose={onClose} className="vault-image-sheet">
      {shown ? (
        <>
          <SheetHead title={shown.name} onClose={onClose} />
          <div className="vault-image-zoom">
            <img src={shown.url} alt={shown.alt} />
          </div>
        </>
      ) : null}
    </Sheet>
  );
}

type ImageState =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'failed'; reason: BlobFailure };

function failureLine(reason: BlobFailure, name: string): string {
  switch (reason) {
    case 'absent':
      return vaultReaderCopy.imageMissing(name);
    case 'downloading':
      return vaultReaderCopy.imageDownloading(name);
    case 'too-large':
      return vaultReaderCopy.imageTooLarge(name);
    default:
      return vaultReaderCopy.couldNotOpen(name);
  }
}

function VaultImage({
  path,
  name,
  alt,
  width,
  media,
  onZoom,
}: {
  path: string;
  name: string;
  alt: string;
  width?: number;
  media: VaultMedia;
  onZoom?: (image: ZoomedImage) => void;
}) {
  const meta = media.attachments.find((a) => a.path === path);
  const registry = media.registry ?? vaultBlobs;
  const key = vaultBlobKey(media.scope, path, meta?.version ?? '');
  const tooLarge = (meta?.size ?? 0) > VAULT_ATTACHMENT_MAX_BYTES;
  const [state, setState] = useState<ImageState>({ status: 'loading' });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (media.away || tooLarge) return;
    let live = true;
    setState({ status: 'loading' });
    setLoaded(false);
    void registry
      .acquire(key, async () => {
        const read = await media.readBytes(path);
        // The provider checked too; the registry never makes a URL for bytes
        // that are not the type the name says (K11).
        if (read.ok && !bytesMatchMime(read.bytes, read.mime)) {
          return { ok: false, reason: 'unsupported' } as const;
        }
        return read;
      })
      .then((got) => {
        if (!live) return;
        setState(
          got.ok ? { status: 'ready', url: got.url } : { status: 'failed', reason: got.reason },
        );
      });
    return () => {
      live = false;
      registry.release(key);
    };
    // `media.readBytes` is read through the key: a new provider, resource or
    // version is a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, registry, media.away, tooLarge]);

  if (media.away) return <Chip glyph="image" text={vaultReaderCopy.imageAway} />;
  if (tooLarge) return <Chip glyph="image" text={vaultReaderCopy.imageTooLarge(name)} />;
  if (state.status === 'failed') {
    return <Chip glyph="image" text={failureLine(state.reason, name)} />;
  }
  const size = width ? { maxWidth: `${width}px` } : undefined;
  return (
    <span className="vault-image-frame" style={size} aria-busy={!loaded || undefined}>
      {!loaded ? (
        <span className="vault-image-skeleton">
          <span className="visually-hidden">{vaultReaderCopy.loading(name)}</span>
        </span>
      ) : null}
      {state.status === 'ready' ? (
        <button
          type="button"
          className={`vault-image press-fb${loaded ? ' loaded' : ''}`}
          aria-label={alt}
          onClick={() => onZoom?.({ url: state.url, alt, name })}
        >
          <img src={state.url} alt={alt} draggable={false} onLoad={() => setLoaded(true)} />
        </button>
      ) : null}
    </span>
  );
}

function VaultPdf({
  path,
  name,
  media,
  onNotice,
}: {
  path: string;
  name: string;
  media: VaultMedia;
  onNotice?: (message: string) => void;
}) {
  const open = media.openAttachment;
  if (!open) {
    return (
      <Chip
        glyph="doc"
        text={name}
        sub={`${vaultReaderCopy.pdfSub}. ${vaultReaderCopy.pdfElsewhere}`}
      />
    );
  }
  const onOpen = async (): Promise<void> => {
    let ok = false;
    try {
      ok = (await open(path)).ok;
    } catch {
      ok = false;
    }
    if (!ok) onNotice?.(vaultReaderCopy.couldNotOpen(name));
  };
  return (
    <button
      type="button"
      className="vault-chip vault-chip--button press-fb"
      onClick={() => void onOpen()}
    >
      <DocGlyph />
      <span className="vault-chip-text">
        <span className="vault-chip-name">{name}</span>
        <span className="vault-chip-sub">{vaultReaderCopy.pdfSub}</span>
      </span>
    </button>
  );
}

/** One attachment embed, as the reader resolved it. */
export function VaultAttachment({
  kind,
  path,
  name,
  alt,
  width,
  media,
  onNotice,
  onZoom,
}: VaultAttachmentProps) {
  const glyph = kind === 'pdf' ? 'doc' : 'image';
  if (!media) return <Chip glyph={glyph} text={name} sub={vaultReaderCopy.otherFile} />;
  if (!path) {
    return (
      <Chip
        glyph={glyph}
        text={
          kind === 'pdf' ? vaultReaderCopy.fileMissing(name) : vaultReaderCopy.imageMissing(name)
        }
      />
    );
  }
  if (kind === 'pdf') return <VaultPdf path={path} name={name} media={media} onNotice={onNotice} />;
  return (
    <VaultImage
      path={path}
      name={name}
      alt={alt || name}
      width={width}
      media={media}
      onZoom={onZoom}
    />
  );
}
