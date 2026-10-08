// The honest note for image reading (founder, 2026-10-07). A plan's image
// step with nothing set for Image reading runs on the chat path's reader with
// no card (the founder kept that default, narrowing tenet 4 for this one
// step), so the line the working row shows as the step starts names the model
// that reads it and what it runs on. The chat's own status line, after its
// ask-first card, says the same plain fact, and the card itself names a
// model set for Image reading that is not reading this picture. Pure, and
// apart from imageReading.ts so the guides can read the catalog picks
// without pulling in the stack (stack.ts reaches the guide cards through
// harborMini.ts).
import { NO_IMAGE_MODEL, placedHeldLine, type ImageReaderGap } from './imageReading.js';
import { providerInfo } from './providers.js';
import {
  refKey,
  refName,
  visionCapable,
  visionSlots,
  type AppStack,
  type StackModelRef,
} from './stack.js';

/** A cloud provider by the name Cloud Connections shows it ("Claude"). */
function connectionName(provider: string): string {
  return providerInfo(provider)?.name ?? provider;
}

/** Who reads, and on what, as the rest of the note's sentence: the Reasoning
 *  model by its role, a cloud model by the connection it spends on, a model
 *  the person connected by name. */
function readerClause(
  reader: StackModelRef,
  anchor: StackModelRef | undefined,
  what: string,
): string {
  const name = refName(reader);
  if (anchor && refKey(anchor) === refKey(reader)) {
    return `${name}, your Reasoning model, reads ${what}`;
  }
  if (reader.kind === 'cloud') {
    return `${name} reads ${what} on your ${connectionName(reader.provider)} connection`;
  }
  return `${name}, a model you connected, reads ${what}`;
}

/** A plan's working note as an image step starts while nothing is set for
 *  Image reading: it names the model that reads the step. With no reader at
 *  all, the Reasoning model works from the text, and the note says so. */
export function imageStepNote(
  title: string,
  reader: StackModelRef | undefined,
  anchor: StackModelRef,
): string {
  if (reader) return `${title}. ${NO_IMAGE_MODEL}, so ${readerClause(reader, anchor, 'it')}.`;
  return `${title}. Nothing here can read images yet, so ${refName(anchor)}, your Reasoning model, works from the text.`;
}

/** A plan's working note when the model set for Image reading cannot take
 *  the step here, so the Reasoning model covers it from the text: a model on
 *  this device (none reads images yet), or one out of reach. */
export function imageStepCoveredNote(
  title: string,
  placed: StackModelRef,
  anchor: StackModelRef,
): string {
  const why = placed.kind === 'device' ? 'cannot read images yet' : 'is out of reach';
  return `${title}. ${refName(placed)} ${why}, so ${refName(anchor)}, your Reasoning model, works from the text.`;
}

/** The chat's status line once a picture goes, after the person approved it,
 *  to a model not set for Image reading. */
export function imageTurnLine(
  reader: StackModelRef,
  anchor: StackModelRef | undefined,
  count: number,
): string {
  const what = count === 1 ? 'this image' : `these ${count} images`;
  return `${NO_IMAGE_MODEL}, so ${readerClause(reader, anchor, what)}.`;
}

/** The model set for Image reading that is not reading here, and why: the
 *  first filled slot (Local, then Cloud) whose model cannot take a picture,
 *  a model on this device (none reads images yet), one that does not read
 *  images, or one out of reach in this status. Undefined when both slots are
 *  empty or a slot's model can read. One rule for the offer's lead and the
 *  ask-first card, so neither calls a set model missing. */
export function heldImageModel(
  stack: AppStack,
  reachable: (ref: StackModelRef) => boolean,
): ImageReaderGap['placed'] {
  const { local, cloud } = visionSlots(stack);
  const held = [local, cloud].find((m) => m && !(visionCapable(m.ref) && reachable(m.ref)));
  if (!held) return undefined;
  return {
    model: refName(held.ref),
    why:
      held.ref.kind === 'device'
        ? 'device'
        : !visionCapable(held.ref)
          ? 'cannot-see'
          : 'out-of-reach',
  };
}

/** The ask-first card's detail, before its stop line: why the picture would
 *  go to a model not set for Image reading, where it would go, and how to
 *  stop being asked. With a model set there that cannot read this picture,
 *  the card names it and why (`status` names what holds it out of reach),
 *  never "Nothing in Stack is set". */
export function imageAskDetail(
  reader: StackModelRef,
  count: number,
  held?: ImageReaderGap['placed'],
  status?: string,
): string {
  const what = count === 1 ? 'this image' : `these ${count} images`;
  const spend = reader.kind === 'cloud' ? ' on your own API key' : '';
  const why = held
    ? placedHeldLine(held, status ? ` while ${status}` : '')
    : 'Nothing in Stack is set for Image reading';
  const after = !held
    ? 'Set a model for Image reading in Stack and images go to it without asking.'
    : held.why === 'out-of-reach'
      ? `Once ${held.model} is in reach, images go to it without asking.`
      : 'Set a model that reads images for Image reading in Stack and images go to it without asking.';
  return `${why}, so ${what} would go to ${refName(reader)}${spend}. Nothing is sent until you approve. ${after}`;
}
