// The tap that applies an app action, and the way into the shaping chat
// (founder, 2026-10-01), mounted in a real DOM (test/support/dom.ts). A
// chat reply's proposal renders as a card, and only Add to Settings writes
// the setting; the same fence in a note renders as plain code. Settings'
// "Shape it in a chat" opens a fresh chat with the prompt in the composer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { mountDom, type TestDom } from './support/dom.js';

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  isDesktop: () => false,
  isPhone: () => true,
  dataUnlockState: async () => 'ok',
  openExternal: () => {},
  openInAppBrowser: () => {},
  storeGetJson: async () => undefined,
  storeSetJson: async () => {},
  storeGet: async () => null,
  storeSet: async () => {},
  storeDelete: async () => {},
  sealExistingKeys: async () => {},
  secretGet: async () => null,
  secretSet: async () => {},
  secretDelete: async () => {},
}));

vi.mock('../src/lib/insights.js', () => ({
  loadInsights: async () => {},
  logEvent: () => {},
  logOnce: () => {},
  setInsightsEnabled: () => {},
  insightsAsText: () => '',
  insightsCount: () => 0,
  clearInsights: async () => {},
}));

const dom: TestDom = await mountDom();
const { useApp } = await import('../src/state/store.js');
const { Markdown } = await import('../src/components/Markdown.js');
const { WritingVoiceField } = await import('../src/components/WritingVoiceField.js');
const { WRITING_VOICE_CHAT_PROMPT, WRITING_VOICE_SUB } = await import('../src/lib/writingVoice.js');

const VOICE = 'Dry and brief. British spelling.';
const REPLY = [
  'Here it is.',
  '',
  '```openshore-set:writingVoice',
  VOICE,
  '```',
  '',
  'Want me to add it to your Settings, or would you rather copy it in yourself?',
].join('\n');

beforeEach(() => {
  useApp.setState({
    view: 'settings',
    viewTrail: [],
    activeId: undefined,
    composerSeed: undefined,
    settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
  });
});

afterEach(async () => {
  await dom.render(null);
});

describe('a proposal in a chat reply', () => {
  it('shows the card, and only the tap writes the setting', async () => {
    await dom.render(createElement(Markdown, { text: REPLY, actions: ['writingVoice'] }));
    expect(dom.text()).toContain('Your writing voice');
    expect(dom.text()).toContain(VOICE);
    expect(dom.buttons()).toEqual(['Add to Settings', 'Copy']);
    expect(useApp.getState().settings.writingVoice).toBeUndefined();
    await dom.click('Add to Settings');
    await dom.settle();
    expect(useApp.getState().settings.writingVoice).toBe(VOICE);
    // Once it is in Settings the card says so, and offers Copy only.
    expect(dom.buttons()).toEqual(['Copy']);
    expect(dom.text()).toContain('In Settings, Writing.');
  });

  // CX and CMO, 2026-10-08 (I): the tap replaces a voice already set, so the
  // card says so and where; with none set, it says only that nothing changes.
  it('says the tap replaces a different voice already in Settings, and where', async () => {
    await dom.render(createElement(Markdown, { text: REPLY, actions: ['writingVoice'] }));
    expect(dom.text()).toContain('Nothing changes until you tap Add to Settings.');
    expect(dom.text()).not.toContain('replaces');
    await dom.render(null);
    useApp.setState((s) => ({ settings: { ...s.settings, writingVoice: 'Warm and long.' } }));
    await dom.render(createElement(Markdown, { text: REPLY, actions: ['writingVoice'] }));
    expect(dom.text()).toContain(
      'Nothing changes until you tap Add to Settings, which replaces the one in Settings, Writing.',
    );
    expect(dom.buttons()).toEqual(['Add to Settings', 'Copy']);
    // Behaviour is unchanged: only the tap writes, and then the card says so.
    expect(useApp.getState().settings.writingVoice).toBe('Warm and long.');
    await dom.click('Add to Settings');
    await dom.settle();
    expect(useApp.getState().settings.writingVoice).toBe(VOICE);
    expect(dom.text()).toContain('In Settings, Writing.');
    expect(dom.text()).not.toContain('replaces');
  });

  it('waits while the reply is still arriving', async () => {
    await dom.render(
      createElement(Markdown, { text: REPLY, actions: ['writingVoice'], streaming: true }),
    );
    const add = [...dom.container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Add to Settings',
    );
    expect(add?.hasAttribute('disabled')).toBe(true);
  });

  it('reads a fence missing its prefix as the card', async () => {
    const bare = ['```writingVoice', VOICE, '```'].join('\n');
    await dom.render(createElement(Markdown, { text: bare, actions: ['writingVoice'] }));
    expect(dom.buttons()).toEqual(['Add to Settings', 'Copy']);
  });

  it('shows nothing for a finished, empty proposal (the 2026-10-02 misfire)', async () => {
    const empty = ['Here.', '', '```writingVoice', '```', '', 'Add it?'].join('\n');
    await dom.render(createElement(Markdown, { text: empty, actions: ['writingVoice'] }));
    expect(dom.buttons()).toEqual([]);
    expect(dom.text()).not.toContain('writingvoice');
  });

  it('is plain code anywhere but a chat reply', async () => {
    await dom.render(createElement(Markdown, { text: REPLY }));
    expect(dom.buttons()).not.toContain('Add to Settings');
    expect(dom.text()).toContain(VOICE);
  });

  // data-at-rest-2 (sp-plan): the card follows the contract's own gate. In a
  // chat whose turns never asked for a setting, a reply's fence (a page the
  // agent quoted, a cloud model's answer) stays plain code.
  it('shows in a chat only once its own turns asked for that setting', async () => {
    // The thread follows the latest with scrollTo, which this DOM lacks.
    Object.assign(window.HTMLElement.prototype, { scrollTo() {} });
    const { MessageList } = await import('../src/components/MessageList.js');
    const { emptyThread } = await import('../src/state/types.js');
    const threadAsking = (ask: string) => ({
      ...emptyThread(),
      items: [
        { kind: 'user' as const, id: 'u1', text: ask },
        { kind: 'assistant' as const, id: 'a1', text: REPLY, streaming: false },
      ],
    });
    await dom.render(createElement(MessageList, { thread: threadAsking('summarize this page') }));
    expect(dom.buttons()).not.toContain('Add to Settings');
    expect(dom.text()).toContain(VOICE);
    await dom.render(null);
    await dom.render(
      createElement(MessageList, { thread: threadAsking(WRITING_VOICE_CHAT_PROMPT + 'a pirate') }),
    );
    expect(dom.buttons()).toContain('Add to Settings');
  });
});

describe('Settings, Writing', () => {
  // data-at-rest-m1 (sp-plan): the voice is kept here, but it rides in every
  // app-side seat's system prompt, a cloud one included, so the line says so.
  // sp-claims2: nothing the computer's engine runs reads it (its coding agent,
  // its free chat, Crew routines), so the line names those, on the desktop
  // as on a phone.
  it('says the voice is kept here, and which models it goes to', async () => {
    await dom.render(createElement(WritingVoiceField));
    const sub = dom.container.querySelector('.writing-voice .settings-row-sub')?.textContent;
    expect(sub).toBe(WRITING_VOICE_SUB);
    expect(sub).toBe(
      "Your own words for how models write for you. Works alone or with Humanize Writing. Kept only on this device and never synced. It goes with each message to the model that writes for you, except your computer's coding agent, its free chat, and Crew routines.",
    );
    expect(sub).not.toMatch(/stays on this device/);
  });

  // The line's list, held to the store: the chats whose driver is handed the
  // voice are the app's own (the Stack, a cloud model, a model on this
  // phone), and a chat with the computer's coding agent or its free chat is
  // handed none. A new kind of chat, or a voice carried to the computer,
  // fails here until the line says so.
  it("hands the voice to the app's own drivers, never to the computer's", () => {
    const store = readFileSync(join(process.cwd(), 'src', 'state', 'store.ts'), 'utf8');
    const from = store.indexOf('async function buildUnguardedDriver(');
    expect(from).toBeGreaterThan(-1);
    const rest = store.slice(from);
    const factory = rest.slice(0, rest.slice(1).search(/\n {2}(?:async )?function /) + 1);
    const cases = [...factory.matchAll(/\n {6}case '([a-z-]+)':/g)];
    const handed = Object.fromEntries(
      cases.map((c, i) => [
        c[1],
        /writingVoice/.test(factory.slice(c.index, cases[i + 1]?.index ?? factory.length)),
      ]),
    );
    expect(handed).toEqual({
      desktop: false,
      'desktop-chat': false,
      device: true,
      cloud: true,
      stack: true,
      mock: false,
    });
  });

  it('opens a fresh chat with the shaping prompt in the composer', async () => {
    useApp.setState({ activeId: 'old' });
    await dom.render(createElement(WritingVoiceField));
    const shape = dom.container.querySelector('.writing-voice-shape') as HTMLButtonElement;
    expect(shape.textContent).toContain('Shape it in a chat');
    const { act } = await import('react');
    await act(async () => {
      shape.dispatchEvent(new window.Event('click', { bubbles: true }));
    });
    const s = useApp.getState();
    expect(s.view).toBe('chat');
    expect(s.activeId).toBeUndefined();
    expect(s.composerSeed?.text).toBe(WRITING_VOICE_CHAT_PROMPT);
  });

  it('saves a voice typed in the open field', async () => {
    await dom.render(createElement(WritingVoiceField));
    const placeholder = (
      dom.container.querySelector('#writing-voice') as HTMLTextAreaElement
    ).getAttribute('placeholder')!;
    await dom.type(placeholder, VOICE);
    await dom.click('Save');
    await dom.settle();
    expect(useApp.getState().settings.writingVoice).toBe(VOICE);
  });
});
