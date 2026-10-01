// The tap that applies an app action, and the way into the shaping chat
// (founder, 2026-10-01), mounted in a real DOM (test/support/dom.ts). A
// chat reply's proposal renders as a card, and only Add to Settings writes
// the setting; the same fence in a note renders as plain code. Settings'
// "Shape it in a chat" opens a fresh chat with the prompt in the composer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const { WRITING_VOICE_CHAT_PROMPT } = await import('../src/lib/writingVoice.js');

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
    await dom.render(createElement(Markdown, { text: REPLY, actions: true }));
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

  it('waits while the reply is still arriving', async () => {
    await dom.render(createElement(Markdown, { text: REPLY, actions: true, streaming: true }));
    const add = [...dom.container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Add to Settings',
    );
    expect(add?.hasAttribute('disabled')).toBe(true);
  });

  it('is plain code anywhere but a chat reply', async () => {
    await dom.render(createElement(Markdown, { text: REPLY }));
    expect(dom.buttons()).not.toContain('Add to Settings');
    expect(dom.text()).toContain(VOICE);
  });
});

describe('Settings, Writing', () => {
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
