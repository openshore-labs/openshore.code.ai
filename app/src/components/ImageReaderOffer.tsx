// Nothing in a Stack chat can read images (founder, 2026-10-07): instead of
// an error, a calm card says what is missing and offers two doors, a local
// model to source and a cloud model to connect, each opening its
// step-by-step guide chat (setupGuides.ts), the way every Walk me through it
// does. It wears the changed-files card's quiet frame, arrives on msg-in like
// its neighbours, and keeps teal for the local door's mark and amber for the
// cloud door's, nothing else. Once something can read images, the lead and
// the doors fold away on the reveal fold the trust card uses, the title says
// so, and one line says what to do next. Every word is from
// lib/imageReading.ts.
import type { ThreadItem } from '../state/types.js';
import type { SetupGuideId } from '../lib/setupGuides.js';
import {
  CONNECT_CLOUD,
  IMAGE_OFFER_READY_TITLE,
  SOURCE_LOCAL,
  cloudDoor,
  imageOfferLead,
  imageOfferReady,
  imageOfferTitle,
  localDoor,
  localImagePick,
  type ImageDoor,
} from '../lib/imageReading.js';

/** What the card needs from the room around it. */
export interface ImageOfferContext {
  /** Something in this chat's stack can read images now. */
  ready: boolean;
  /** The engine's fit for a download of this size, once the computer's
   *  memory has been read (firstSeat.ts fitVerdict). A phone has no read of
   *  its paired computer today, so the chat leaves it out and LLaVA leads. */
  fit?: (sizeGB: number) => 'fits' | 'tight' | 'too-big';
  /** Open a guide chat (the store's startGuideChat). */
  onOpenGuide: (id: SetupGuideId) => void;
}

/** One door's row: its teal or amber mark, its name, and what it costs. */
function Door({ kind, label, door }: { kind: 'local' | 'cloud'; label: string; door: ImageDoor }) {
  return (
    <li className="image-offer-door">
      <span className={`kind-chip ${kind}`}>{label}</span>
      <span className="image-offer-door-text">
        <span className="image-offer-door-head">{door.head}</span>
        <span className="image-offer-door-body">{door.body}</span>
      </span>
    </li>
  );
}

export function ImageReaderOffer({
  item,
  ready,
  fit,
  onOpenGuide,
}: { item: Extract<ThreadItem, { kind: 'image-offer' }> } & ImageOfferContext) {
  const pick = localImagePick(fit);
  const titleId = `${item.id}-title`;
  return (
    <div className="image-offer" role="group" aria-labelledby={titleId}>
      <div className="image-offer-title" id={titleId}>
        {ready ? IMAGE_OFFER_READY_TITLE : imageOfferTitle(item)}
      </div>
      <div className={`reveal${ready ? '' : ' open'}`} aria-hidden={ready || undefined}>
        <div className="reveal-inner">
          <p className="image-offer-lead">{imageOfferLead(item)}</p>
          <ul className="image-offer-doors">
            <Door kind="local" label="Local" door={localDoor(pick)} />
            <Door kind="cloud" label="Cloud" door={cloudDoor(item)} />
          </ul>
          <div className="image-offer-actions">
            <button
              type="button"
              className="btn primary press-fb"
              tabIndex={ready ? -1 : undefined}
              onClick={() => onOpenGuide('image-reader-local')}
            >
              {SOURCE_LOCAL}
            </button>
            <button
              type="button"
              className="btn ghost press-fb"
              tabIndex={ready ? -1 : undefined}
              onClick={() => onOpenGuide('image-reader-cloud')}
            >
              {CONNECT_CLOUD}
            </button>
          </div>
        </div>
      </div>
      <div className={`reveal image-offer-ready-fold${ready ? ' open' : ''}`}>
        <div className="reveal-inner">
          <p className="image-offer-ready" role="status">
            {ready ? imageOfferReady(item.from) : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
