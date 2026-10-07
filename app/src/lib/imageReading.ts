// Image reading in plain words (founder, 2026-10-07): the offer. When nothing
// in a Stack chat can read images, the chat says what is missing and offers
// two doors, a local model to source and a cloud model to connect, each
// opening its step-by-step guide (setupGuides.ts). The local pick comes from
// the catalog (LLaVA 7B, and Moondream 2 for a computer with little room), so
// no name, size or pull command is typed twice. The note that names the
// reader while nothing is set for Image reading is imageNote.ts.
//
// Pure: no React, no platform calls, so every line is pinned by a test. It
// stays clear of stack.ts on purpose: the guides read it, and stack.ts
// reaches the guide cards through harborMini.ts.
import bundled from 'os-code/catalog.sample.json';
import { cloudImageReaders } from './providers.js';
import { thisDeviceNoun } from './deviceNoun.js';

/** How every note opens while nothing is set for Image reading. */
export const NO_IMAGE_MODEL = 'No image model is set in Stack';

// ---- the offer ------------------------------------------------------------

/** Why nothing here can read images, as the chat's driver found it. */
export interface ImageReaderGap {
  /** A picture went unread ('image'), or a plan's image step ran on the text
   *  alone ('play'). */
  from: 'image' | 'play';
  /** A connected cloud reader that is out of reach here, or none at all. */
  cloud: 'none' | 'out-of-reach';
  /** A model set for Image reading that cannot read here, and why. */
  placed?: { model: string; why: 'device' | 'cannot-see' | 'out-of-reach' };
  /** The reach status that holds image reading back ("Offline"): until the
   *  person leaves it, nothing that reads images is in reach, set up or not. */
  status?: string;
}

/** The card's title, and the one it takes once something can read images. */
export const IMAGE_OFFER_TITLE = 'Nothing here can read images yet';
export const IMAGE_OFFER_READY_TITLE = 'Ready to read images';

/** The title for this gap: while a status holds reading back, it names the
 *  status rather than "yet", since a reader may already be set up. */
export function imageOfferTitle(gap: Pick<ImageReaderGap, 'status'>): string {
  return gap.status ? `Nothing can read images while ${gap.status}` : IMAGE_OFFER_TITLE;
}

/** The two doors, in the founder's words. */
export const SOURCE_LOCAL = 'Source a local model';
export const CONNECT_CLOUD = 'Connect a cloud model';

/** The card's first line: what is missing, true to the state. */
export function imageOfferLead(gap: ImageReaderGap): string {
  const where = gap.status ? ` while ${gap.status}` : '';
  const placed = gap.placed;
  const bothAway = placed?.why === 'out-of-reach' && gap.cloud === 'out-of-reach';
  const missing = bothAway
    ? `${placed.model}, set for Image reading, and your cloud models are out of reach${where}`
    : [
        !placed
          ? NO_IMAGE_MODEL
          : placed.why === 'device'
            ? `${placed.model} is set for Image reading, but a model on ${thisDeviceNoun()} cannot read images yet`
            : placed.why === 'cannot-see'
              ? `${placed.model} is set for Image reading, but it does not read images`
              : `${placed.model} is set for Image reading, but it is out of reach${where}`,
        gap.cloud === 'out-of-reach'
          ? `and your cloud models are out of reach${where}`
          : 'and no connected cloud model reads images',
      ].join(', ');
  // What to do next. A reader already set up but out of reach needs only
  // the status left behind, never a second model; and while a status holds
  // reading back, adding one is not enough on its own, so the line says when
  // the picture can go. A plan never carries the picture itself (its steps
  // run on the text), so its line asks for the picture with the question.
  const away = placed?.why === 'out-of-reach' || gap.cloud === 'out-of-reach';
  const leave = gap.status ? ` when you leave ${gap.status}` : away ? ' once it is in reach' : '';
  const send =
    gap.from === 'image'
      ? { start: 'Send the picture again', mid: 'send the picture again' }
      : { start: 'Attach the picture and ask again', mid: 'attach the picture and ask again' };
  const next = away ? `${send.start}${leave}.` : `Add one of these, then ${send.mid}${leave}.`;
  return gap.from === 'image'
    ? `${missing}. ${next}`
    : `${missing}, so the image step ran on the text alone. ${next}`;
}

/** The line that takes the doors' place once something can read images. */
export function imageOfferReady(from: ImageReaderGap['from']): string {
  return from === 'image' ? 'Send the picture again.' : 'Attach the picture and ask again.';
}

// ---- the local pick, from the catalog -------------------------------------

/** A local image reader as the catalog lists it. */
export interface LocalImageModel {
  id: string;
  name: string;
  sizeGB: number;
  /** The Ollama tag, the Model name a connection asks for. */
  ref: string;
  /** The one command that pulls it. */
  pull: string;
}

function catalogModel(id: string): LocalImageModel {
  const m = bundled.models.find((x) => x.id === id);
  if (!m || typeof m.sizeGB !== 'number' || !m.source.pullCommand) {
    throw new Error(`The catalog has no local image reader ${id}.`);
  }
  return { id, name: m.name, sizeGB: m.sizeGB, ref: m.source.ref, pull: m.source.pullCommand };
}

/** The suggested reader, and the one for a computer with little room. */
export const LOCAL_IMAGE_READER = catalogModel('llava-7b');
export const SMALL_IMAGE_READER = catalogModel('moondream');

/** About how big a download is, in the person's units. */
export function aboutGB(model: LocalImageModel): string {
  return `about ${model.sizeGB} GB`;
}

/** Which local reader to name first. A computer whose memory is known and
 *  cannot fit the suggested one gets the small one alone; otherwise the
 *  suggested one leads and the small one is the option for little room.
 *  `fit` is the engine's verdict for a download of that size (firstSeat.ts
 *  fitVerdict), absent when the computer has not been read. */
export function localImagePick(fit?: (sizeGB: number) => 'fits' | 'tight' | 'too-big'): {
  first: LocalImageModel;
  small?: LocalImageModel;
} {
  if (fit && fit(LOCAL_IMAGE_READER.sizeGB) === 'too-big') return { first: SMALL_IMAGE_READER };
  return { first: LOCAL_IMAGE_READER, small: SMALL_IMAGE_READER };
}

/** One door: a head that names it, and a body that says what it costs, where
 *  it runs and where it is set. */
export interface ImageDoor {
  head: string;
  body: string;
}

/** The local door: the model, where it runs, its size and where it is set.
 *  A model on the phone itself cannot read images on this build
 *  (stack.ts visionCapable), so the local reader is one on your computer,
 *  which the phone reaches as a model you connect. */
export function localDoor(pick: ReturnType<typeof localImagePick>): ImageDoor {
  // A size keeps its unit on its line in the card.
  const size = (m: LocalImageModel) => aboutGB(m).replace(/ GB$/, '\u00a0GB');
  const small = pick.small ? ` Short on room? ${pick.small.name} is ${size(pick.small)}.` : '';
  return {
    head: `${pick.first.name} on your computer`,
    body: `Runs through Ollama, ${size(pick.first)}. Set it in Stack under Image reading, Local, and your images stay on your own network.${small}`,
  };
}

// ---- the cloud door -------------------------------------------------------

/** The other providers whose listed models read images, by the name the
 *  approval card and the Stack show ("OpenAI GPT-5"), in the order the chat
 *  tries them. Claude leads the list and is named on its own. */
export function otherCloudReaders(): string[] {
  return cloudImageReaders()
    .filter((r) => r.provider !== 'anthropic')
    .map((r) => r.label);
}

/** "a, b, and c". */
export function listWords(words: readonly string[]): string {
  return words.length > 1
    ? `${words.slice(0, -1).join(', ')}, and ${words.at(-1)}`
    : (words[0] ?? '');
}

/** The cloud door: on the person's key, asking first until it is set. With a
 *  reader already connected but out of reach, it says when that one reads
 *  again instead of offering a second. */
export function cloudDoor(gap: Pick<ImageReaderGap, 'cloud' | 'status'>): ImageDoor {
  const ask = 'Each image asks first until you set the model in Stack under Image reading, Cloud.';
  if (gap.cloud === 'out-of-reach') {
    return {
      head: 'Your connected cloud model',
      body: gap.status
        ? `It reads images again when you leave ${gap.status}. ${ask}`
        : `It reads images again once it is in reach. ${ask}`,
    };
  }
  return {
    head: 'A cloud model on your own API key',
    body: `Claude reads images out of the box. ${ask}`,
  };
}
