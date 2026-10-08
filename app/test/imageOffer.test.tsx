// Nothing in a Stack chat can read images (founder, 2026-10-07): "respond in
// the chat with what local model you suggest to download and assign to image
// processing in stack and/or the need for a cloud connection", then the step
// by step on whichever door the person picks. The words, the event's card, the
// two guides, and the rule that the card never rides into a model's history.
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DriverEvent } from 'os-code/protocol';
import bundled from 'os-code/catalog.sample.json';
import { mountDom, type TestDom } from './support/dom.js';
import {
  CONNECT_CLOUD,
  IMAGE_OFFER_READY_TITLE,
  IMAGE_OFFER_TITLE,
  LOCAL_IMAGE_READER,
  SMALL_IMAGE_READER,
  SOURCE_LOCAL,
  cloudDoor,
  imageOfferLead,
  imageOfferReady,
  imageOfferTitle,
  localDoor,
  localImagePick,
  otherCloudReaders,
} from '../src/lib/imageReading.js';
import { SETUP_GUIDES, guideOpening } from '../src/lib/setupGuides.js';
import { GUIDE_CARDS } from '../src/lib/guideCards.js';
import { thisDeviceNoun } from '../src/lib/deviceNoun.js';
import { emptyThread, seedEntries, type ThreadItem, type ThreadState } from '../src/state/types.js';
import { threadHandoffTurns } from '../src/state/handoffs.js';

type OfferItem = Extract<ThreadItem, { kind: 'image-offer' }>;
const offer = (over: Partial<OfferItem> = {}): OfferItem => ({
  id: 'o1',
  kind: 'image-offer',
  from: 'image',
  cloud: 'none',
  ...over,
});

describe('the words', () => {
  it('names the local readers from the catalog, never a number typed twice', () => {
    const byId = (id: string) => bundled.models.find((m) => m.id === id)!;
    expect(LOCAL_IMAGE_READER).toEqual({
      id: 'llava-7b',
      name: byId('llava-7b').name,
      sizeGB: byId('llava-7b').sizeGB,
      ref: byId('llava-7b').source.ref,
      pull: byId('llava-7b').source.pullCommand,
    });
    expect(LOCAL_IMAGE_READER).toMatchObject({ name: 'LLaVA 7B', sizeGB: 4.7, ref: 'llava:7b' });
    expect(SMALL_IMAGE_READER).toMatchObject({
      name: 'Moondream 2',
      sizeGB: 1.7,
      pull: 'ollama pull moondream',
    });
  });

  it('leads with what is missing, true to the state', () => {
    expect(imageOfferLead(offer())).toBe(
      'No image model is set in Stack, and no connected cloud model reads images. Add one of these, then send the picture again.',
    );
    // A reader set up but out of reach needs only the status left behind.
    expect(imageOfferLead(offer({ cloud: 'out-of-reach', status: 'Offline' }))).toBe(
      'No image model is set in Stack, and your cloud models are out of reach while Offline. Send the picture again when you leave Offline.',
    );
    expect(
      imageOfferLead(
        offer({ placed: { model: 'LLaVA 7B', why: 'out-of-reach' }, status: 'Offline' }),
      ),
    ).toBe(
      'LLaVA 7B is set for Image reading, but it is out of reach while Offline, and no connected cloud model reads images. Send the picture again when you leave Offline.',
    );
    // Offline with nothing set up: adding one is not enough on its own.
    expect(imageOfferLead(offer({ status: 'Offline' }))).toBe(
      'No image model is set in Stack, and no connected cloud model reads images. Add one of these, then send the picture again when you leave Offline.',
    );
    expect(imageOfferLead(offer({ placed: { model: 'Harbor Lite', why: 'device' } }))).toBe(
      `Harbor Lite is set for Image reading, but a model on ${thisDeviceNoun()} cannot read images yet, and no connected cloud model reads images. Add one of these, then send the picture again.`,
    );
    expect(
      imageOfferLead(
        offer({
          placed: { model: 'LLaVA', why: 'out-of-reach' },
          cloud: 'out-of-reach',
          status: 'Offline',
        }),
      ),
    ).toBe(
      'LLaVA, set for Image reading, and your cloud models are out of reach while Offline. Send the picture again when you leave Offline.',
    );
    expect(imageOfferLead(offer({ from: 'play' }))).toBe(
      'No image model is set in Stack, and no connected cloud model reads images, so the image step ran on the text alone. Add one of these, then attach the picture and ask again.',
    );
  });

  it('titles the card with the status that holds reading back, never a "yet" it cannot keep', () => {
    expect(imageOfferTitle(offer())).toBe(IMAGE_OFFER_TITLE);
    expect(IMAGE_OFFER_TITLE).toBe('Nothing here can read images yet');
    expect(imageOfferTitle(offer({ cloud: 'out-of-reach', status: 'Offline' }))).toBe(
      'Nothing can read images while Offline',
    );
  });

  it('suggests LLaVA first with Moondream for little room, or Moondream alone when LLaVA cannot fit', () => {
    expect(localDoor(localImagePick())).toEqual({
      head: 'LLaVA 7B on your computer',
      body: 'Runs through Ollama, about 4.7\u00a0GB. Set it in Stack under Image reading, Local, and your images stay on your own network. Short on room? Moondream 2 is about 1.7\u00a0GB.',
    });
    const small = localImagePick((gb) => (gb > 3 ? 'too-big' : 'fits'));
    expect(small).toEqual({ first: SMALL_IMAGE_READER });
    expect(localDoor(small)).toEqual({
      head: 'Moondream 2 on your computer',
      body: 'Runs through Ollama, about 1.7\u00a0GB. Set it in Stack under Image reading, Local, and your images stay on your own network.',
    });
    expect(localImagePick(() => 'tight').first).toBe(LOCAL_IMAGE_READER);
  });

  it('says the cloud door costs the person their own key and asks first', () => {
    expect(cloudDoor({ cloud: 'none' })).toEqual({
      head: 'A cloud model on your own API key',
      body: 'Claude reads images out of the box. Each image asks first until you set the model in Stack under Image reading, Cloud.',
    });
    expect(cloudDoor({ cloud: 'out-of-reach', status: 'Offline' })).toMatchObject({
      head: 'Your connected cloud model',
      body: expect.stringMatching(/^It reads images again when you leave Offline\./),
    });
  });

  it('names only other providers whose listed models read images', () => {
    expect(otherCloudReaders()).toEqual(['OpenAI GPT-5', 'Gemini 2.5 Pro', 'Kimi K3']);
  });
});

describe('the event and the transcript', () => {
  it('folds into a calm card after the answer, never a stopped turn', async () => {
    const { reduceEvent } = await import('../src/state/transcript.js');
    let thread: ThreadState = { ...emptyThread(), busy: true };
    const events: DriverEvent[] = [
      { type: 'task-start', input: 'Who is this?' },
      { type: 'text-final', text: '' },
      { type: 'image-reader-offer', from: 'image', cloud: 'none' },
      { type: 'task-done', reason: 'complete' },
    ];
    for (const e of events) thread = reduceEvent(thread, e);
    const kinds = thread.items.map((i) => i.kind);
    expect(kinds).toEqual(['user', 'image-offer']);
    expect(thread.items[1]).toMatchObject({ kind: 'image-offer', from: 'image', cloud: 'none' });
    expect(kinds).not.toContain('stopped');
    expect(thread.busy).toBe(false);
  });

  it('never rides into a model history or a handoff', () => {
    const items: ThreadItem[] = [
      { kind: 'user', id: 'u', text: 'Who is this?' },
      offer(),
      { kind: 'assistant', id: 'a', text: 'Hello', streaming: false },
    ];
    expect(seedEntries(items).map((t) => t.text)).toEqual(['Who is this?', 'Hello']);
    expect(threadHandoffTurns(items).map((t) => t.text)).toEqual(['Who is this?', 'Hello']);
  });
});

describe('the two guides', () => {
  it('exist with their exact, numbered steps', () => {
    const local = SETUP_GUIDES['image-reader-local']!;
    const cloud = SETUP_GUIDES['image-reader-cloud']!;
    expect(local.title).toBe(SOURCE_LOCAL);
    expect(cloud.title).toBe(CONNECT_CLOUD);
    const pastes = local.steps.flatMap((s) => (typeof s === 'string' ? [] : [s.paste]));
    expect(pastes).toEqual([
      'curl -fsSL https://ollama.com/install.sh | sh',
      'ollama pull llava:7b',
      'ollama pull moondream',
      'launchctl setenv OLLAMA_HOST "0.0.0.0"',
      '[Service]\nEnvironment="OLLAMA_HOST=0.0.0.0"',
      'launchctl unsetenv OLLAMA_HOST',
    ]);
    const text = guideOpening(local);
    // Ollama's own way to listen on the network on each system, so the
    // setting holds and the service keeps the models it pulled.
    expect(text).toContain('sudo systemctl edit ollama');
    expect(text).toContain('sudo systemctl restart ollama');
    expect(text).toContain('add OLLAMA_HOST with the value 0.0.0.0 to your account');
    expect(text).not.toContain('ollama serve');
    expect(text).toContain('never forward port 11434 to the internet');
    // 0.0.0.0 is every network a laptop joins, and Ollama has no password
    // (privacy review, 2026-10-08): said before the setting, never "your
    // home network", and each system's way to take it away again.
    expect(text).not.toMatch(/home network too/);
    expect(text).toContain(
      'Ollama has no password, so once this is set it answers anyone on every network this computer joins, not only your home one, until you remove the setting',
    );
    expect(text).toContain('On a laptop, keep to networks you trust, or remove the setting');
    expect(text.indexOf('Ollama has no password')).toBeLessThan(
      text.indexOf('add OLLAMA_HOST with the value 0.0.0.0'),
    );
    expect(text).toContain('delete OLLAMA_HOST from your account');
    expect(text).toContain('delete the two lines you added');
    // The plan is walked one step at a time, so each way back says it is for
    // later, on every system, and nobody takes the setting away by mistake
    // on their way to the next picture (sign-off, 2026-10-08).
    const ways = local.steps.slice(-2).map((s) => (typeof s === 'string' ? s : s.text));
    expect(ways).toHaveLength(2);
    for (const way of ways) {
      expect(way).toMatch(/\blater\b/i);
      expect(way).toMatch(/\bremove\b/);
    }
    expect(text).toContain('Connect a model under Bench');
    expect(text).toContain('Address: `http://100.x.y.z:11434/v1`');
    expect(text).toContain('Model name: llava:7b');
    expect(text).toContain('tap Local under Image reading');
    expect(text).toContain(`A model on ${thisDeviceNoun()} cannot read images yet`);
    expect(local.done).toMatch(/without asking, and stays on your own network/);

    const cloudText = guideOpening(cloud);
    expect(cloudText).toContain('Claude reads images out of the box');
    expect(cloudText).toContain('OpenAI GPT-5, Gemini 2.5 Pro, and Kimi K3 read them too');
    expect(cloudText).toContain('Open Cloud Connections and tap that provider');
    expect(cloudText).toContain('tap Cloud under Image reading');
    expect(cloud.done).toMatch(/asks first/);
  });

  it('give Harbor Lite a card about reading images that matches', () => {
    const card = GUIDE_CARDS.find((c) => c.id === 'image-reading')!;
    expect(card.text).toContain(SOURCE_LOCAL);
    expect(card.text).toContain(CONNECT_CLOUD);
    expect(card.text).toContain('LLaVA 7B, about 4.7 GB');
    expect(card.text).toContain('Moondream 2, about 1.7 GB');
  });
});

describe('the card', () => {
  let dom: TestDom;
  beforeEach(async () => {
    dom = await mountDom();
  });
  afterEach(async () => {
    await dom.unmount();
  });

  async function show(item: OfferItem, ready = false) {
    const { ImageReaderOffer } = await import('../src/components/ImageReaderOffer.js');
    const opened: string[] = [];
    await dom.render(
      <ImageReaderOffer item={item} ready={ready} onOpenGuide={(id) => opened.push(id)} />,
    );
    return opened;
  }

  it('says what is missing and offers the two doors', async () => {
    await show(offer());
    expect(dom.text()).toContain(IMAGE_OFFER_TITLE);
    expect(dom.text()).toContain(imageOfferLead(offer()));
    const local = localDoor(localImagePick());
    expect(dom.text()).toContain(local.head);
    expect(dom.text()).toContain(local.body);
    expect(dom.text()).toContain(cloudDoor({ cloud: 'none' }).head);
    expect(dom.buttons()).toEqual([SOURCE_LOCAL, CONNECT_CLOUD]);
    // Teal for the local door and amber for the cloud door, nothing else.
    expect(dom.container.querySelector('.kind-chip.local')?.textContent).toBe('Local');
    expect(dom.container.querySelector('.kind-chip.cloud')?.textContent).toBe('Cloud');
    // Never an error card.
    expect(dom.container.querySelector('.msg-stopped, .warn, .danger')).toBeNull();
  });

  it('opens the local guide from one door and the cloud guide from the other', async () => {
    const opened = await show(offer());
    await dom.click(SOURCE_LOCAL);
    await dom.click(CONNECT_CLOUD);
    expect(opened).toEqual(['image-reader-local', 'image-reader-cloud']);
    for (const id of opened) expect(SETUP_GUIDES[id as 'image-reader-local']).toBeDefined();
  });

  it('folds its doors away once something can read images, and says so', async () => {
    await show(offer(), true);
    expect(dom.container.querySelector('.image-offer-title')?.textContent).toBe(
      IMAGE_OFFER_READY_TITLE,
    );
    expect(IMAGE_OFFER_READY_TITLE).toBe('Ready to read images');
    expect(imageOfferReady('image')).toBe('Send the picture again.');
    expect(imageOfferReady('play')).toBe('Attach the picture and ask again.');
    expect(dom.text()).toContain(imageOfferReady('image'));
    const doors = dom.container.querySelector('.reveal[aria-hidden="true"]');
    expect(doors?.className).not.toContain('open');
    expect(dom.container.querySelector('.image-offer-ready-fold')?.className).toContain('open');
  });

  it('rides the transcript in a Stack chat', { timeout: 20_000 }, async () => {
    const NodeEvent = globalThis.Event;
    globalThis.Event = window.Event as unknown as typeof Event;
    const proto = window.HTMLElement.prototype as unknown as { scrollTo?: unknown };
    const before = proto.scrollTo;
    proto.scrollTo = () => {};
    onTestFinished(() => {
      globalThis.Event = NodeEvent;
      proto.scrollTo = before;
    });
    const { MessageList } = await import('../src/components/MessageList.js');
    const opened: string[] = [];
    const thread: ThreadState = {
      ...emptyThread(),
      items: [{ kind: 'user', id: 'u1', text: 'Who is this?' }, offer()],
    };
    await dom.render(
      <MessageList
        thread={thread}
        imageOffer={{ ready: false, onOpenGuide: (id) => opened.push(id) }}
      />,
    );
    await dom.click(SOURCE_LOCAL);
    expect(opened).toEqual(['image-reader-local']);
  });

  it('is wired to the guide chats and takes a picture in a Stack chat off the desktop', () => {
    const chat = readFileSync(join(process.cwd(), 'src/screens/ChatScreen.tsx'), 'utf8');
    expect(chat).toContain('onOpenGuide: (id) => void startGuideChat(id)');
    expect(chat).toContain('imageOffer={imageOffer}');
    // A phone or an iPad takes the picture and answers with the doors; the
    // desktop, whose Stack has no Image reading row, keeps the toast.
    expect(chat.replace(/\s+/g, ' ')).toContain(
      "visionSupported={ sourceSupportsVision(composerSource) || (composerSource.kind === 'stack' && (stackVision || !isDesktop())) }",
    );
  });

  it('wears a quiet frame that arrives like its neighbours, teal and amber kept for the doors', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'theme.css'), 'utf8');
    const rules = [...css.matchAll(/\.image-offer[\w-]*[^{]*\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(rules.length).toBeGreaterThan(4);
    for (const body of rules) expect(body).not.toMatch(/--danger|--warn|--local|--cloud/);
    expect(css).toMatch(/\.image-offer \{[^}]*animation: msg-in var\(--dur-3\)/);
    expect(css).toMatch(/\.image-offer \{[^}]*padding: var\(--card-pad\)/);
  });
});
