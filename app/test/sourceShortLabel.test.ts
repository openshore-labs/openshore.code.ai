import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { computerName, sourceLabel, sourceShortLabel } from '../src/state/types.js';
import { sourceShort } from '../src/screens/ChatsScreen.js';
import type { Conversation } from '../src/state/types.js';

// The composer's model pill: a cloud model is named for its own provider,
// never "Claude" for every cloud source (brand sweep 2026-09-24, wave 1 #5).
describe('sourceShortLabel', () => {
  it('names Claude as Claude', () => {
    expect(sourceShortLabel({ kind: 'cloud', provider: 'anthropic', model: 'claude-opus-5' })).toBe(
      'Claude',
    );
  });

  it('names OpenAI and the other providers for themselves', () => {
    expect(sourceShortLabel({ kind: 'cloud', provider: 'openai', model: 'gpt-5' })).toBe('OpenAI');
    const gemini = sourceShortLabel({ kind: 'cloud', provider: 'google', model: 'gemini-2.5-pro' });
    expect(gemini).not.toBe('Claude');
    expect(gemini.length).toBeGreaterThan(0);
  });

  it('falls back to the provider id for an unknown provider', () => {
    expect(sourceShortLabel({ kind: 'cloud', provider: 'acme', model: 'x-1' })).toBe('acme');
  });

  it('keeps the short names for the other sources', () => {
    expect(sourceShortLabel(undefined)).toBe('Stack');
    expect(sourceShortLabel({ kind: 'stack' })).toBe('Stack');
    expect(sourceShortLabel({ kind: 'mock' })).toBe('Demo');
  });
});

// UX review cleanup 4: the computer is "This computer" in the desktop app and "Your
// computer" on the phone; "chat" tells the free chat from the agent, and the
// pill, the Chats list, and the model sheet use the same words.
describe('naming the computer, the free chat, and the agent', () => {
  const g = globalThis as { window?: { oscode?: { platform?: string } } };
  const onDesktop = () => {
    g.window = { oscode: { platform: 'electron' } };
  };
  afterEach(() => {
    delete g.window;
  });
  const chats = (source: Conversation['source']) => sourceShort({ source } as Conversation);

  it('the desktop calls itself This computer', () => {
    onDesktop();
    expect(computerName()).toBe('This computer');
    expect(sourceShortLabel({ kind: 'desktop-chat' })).toBe('This computer · chat');
    expect(chats({ kind: 'desktop-chat' })).toBe('This computer · chat');
    expect(sourceLabel({ kind: 'desktop-chat' })).toBe('This computer · chat');
    expect(sourceShortLabel({ kind: 'desktop' })).toBe('This computer');
    expect(chats({ kind: 'desktop' })).toBe('This computer');
    expect(sourceShortLabel({ kind: 'desktop', repoName: 'shop' })).toBe('shop');
    expect(sourceLabel({ kind: 'desktop', repoName: 'shop' })).toBe('This computer · shop');
  });

  it('the phone calls the paired one Your computer', () => {
    expect(computerName()).toBe('Your computer');
    expect(sourceShortLabel({ kind: 'desktop-chat' })).toBe('Your computer · chat');
    expect(chats({ kind: 'desktop-chat' })).toBe('Your computer · chat');
    expect(sourceShortLabel({ kind: 'desktop' })).toBe('Your computer');
    expect(chats({ kind: 'desktop', repoName: 'shop' })).toBe('shop');
    expect(sourceLabel({ kind: 'desktop' })).toBe('Your computer · Stack');
  });

  it('"My computer" is gone from every screen and guide', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) files.push(path);
      }
    };
    walk(join(process.cwd(), 'src'));
    const hits = files.filter((f) => readFileSync(f, 'utf8').includes('My computer'));
    expect(hits).toEqual([]);
  });
});
