// Chats as files (folder and sync plan, M3; founder, 2026-10-16): one
// markdown file per chat in OpenShore/Chats, filed by month. The renderer
// keeps code fences whole and never writes a model's thinking; the path is
// safe on every file system the app runs on; the switch is on by default and
// stays on this device.
import { describe, expect, it } from 'vitest';
import {
  CHAT_SLUG_MAX,
  chatFilePath,
  chatFilesOn,
  chatFilesPrivacyLine,
  chatFilesWhere,
  chatIdTag,
  chatModels,
  chatMonth,
  chatReadyToMirror,
  chatSlug,
  closeFences,
  fileIsForChat,
  isChatFileRel,
  nameAttachments,
  renderChatMarkdown,
} from '../src/lib/chatFiles.js';
import { SETTINGS_REACH } from '../src/lib/settingsReach.js';
import { SNAPSHOT_ITEMS } from '../src/state/transcript.js';
import { emptyThread, type Conversation, type ThreadItem } from '../src/state/types.js';
import { isChatFileRel as mainIsChatFileRel } from '../electron/chatFilesFs.js';

function conv(items: ThreadItem[], over: Partial<Conversation> = {}): Conversation {
  return {
    id: 'cmgx1a2b3c4',
    title: 'Fix the login bug',
    source: { kind: 'cloud', provider: 'anthropic', model: 'Claude Opus 5.5' },
    createdAt: '2026-10-16T09:30:00.000Z',
    updatedAt: '2026-10-16T09:45:00.000Z',
    thread: { ...emptyThread(), items },
    ...over,
  };
}

const user = (text: string, id = 'u1'): ThreadItem => ({ kind: 'user', id, text });
const reply = (text: string, model?: string, id = 'a1'): ThreadItem => ({
  kind: 'assistant',
  id,
  text,
  streaming: false,
  ...(model ? { model } : {}),
});

describe('the setting', () => {
  it('is on unless turned off', () => {
    expect(chatFilesOn({})).toBe(true);
    expect(chatFilesOn({ chatFiles: undefined })).toBe(true);
    expect(chatFilesOn({ chatFiles: true })).toBe(true);
    expect(chatFilesOn({ chatFiles: false })).toBe(false);
  });

  it('stays on this device: it names where this device writes', () => {
    expect(SETTINGS_REACH.chatFiles).toBe('device');
  });

  it('says where the files go, per platform, naming the device through its noun', () => {
    expect(chatFilesWhere('electron')).toBe(
      'In OpenShore/Chats on this computer, one markdown file per chat.',
    );
    expect(chatFilesWhere('ios')).toMatch(
      /^In OpenShore\/Chats on this (phone|iPad), open in the Files app\.$/,
    );
    expect(chatFilesWhere('web')).toBeUndefined();
    // The privacy page says plainly the files are not sealed.
    expect(chatFilesPrivacyLine('electron')).toMatch(/not sealed/);
    expect(chatFilesPrivacyLine('ios')).toMatch(/not sealed/);
    expect(chatFilesPrivacyLine('web')).toBeUndefined();
  });
});

describe('the path', () => {
  it('is Chats/YYYY-MM/<slug>-<id8>.md, by the month the chat started', () => {
    expect(chatFilePath(conv([]))).toBe('2026-10/fix-the-login-bug-cmgx1a2b.md');
    expect(chatMonth('2026-01-31T23:59:59.000Z')).toBe('2026-01');
    // A time it cannot read still files somewhere valid.
    expect(chatMonth('not a date')).toBe('1970-01');
    expect(chatIdTag('c-1/2')).toBe('c12');
    expect(chatIdTag('')).toBe('chat');
  });

  it('slugs a title safely for Windows, macOS, iOS and Linux', () => {
    expect(chatSlug('What is: a "pipe" | <tag>? *star* / back\\slash')).toBe(
      'what-is-a-pipe-tag-star-back-slash',
    );
    expect(chatSlug('  ...hidden  ')).toBe('hidden');
    expect(chatSlug('')).toBe('chat');
    expect(chatSlug('!!!')).toBe('chat');
    expect(chatSlug('Café résumé')).toBe('café-résumé');
    expect(chatSlug('日本語のチャット')).toBe('日本語のチャット');
    // Windows device names are never a bare stem.
    for (const name of ['CON', 'prn', 'Aux', 'NUL', 'COM1', 'lpt9']) {
      expect(chatSlug(name)).toBe(`${name.toLowerCase()}-chat`);
    }
    // Bounded by characters, never cutting a letter in half.
    const long = chatSlug('a'.repeat(300));
    expect(long.length).toBe(CHAT_SLUG_MAX);
    const emoji = chatSlug('😀'.repeat(10) + 'x'.repeat(200));
    expect(Array.from(emoji).length).toBeLessThanOrEqual(CHAT_SLUG_MAX);
    expect(emoji).not.toMatch(/[\uD800-\uDFFF](?![\uDC00-\uDFFF])/);
  });

  it('every path it makes passes both its own check and main’s', () => {
    for (const title of ['CON', 'a:b', '..', '.env', 'x'.repeat(500), 'tab\there', '']) {
      const p = chatFilePath(conv([], { title }));
      expect(isChatFileRel(p), p).toBe(true);
      expect(mainIsChatFileRel(p), p).toBe(true);
    }
  });

  it('refuses anything that is not a month folder and one markdown file', () => {
    for (const bad of [
      '../x.md',
      '2026-10/../x.md',
      '/etc/x.md',
      '2026-10/x.txt',
      '2026-10/.x.md',
      '2026-13/x.md',
      '2026-10/a/b.md',
      '2026-10\\x.md',
      'x.md',
      `2026-10/${'a'.repeat(300)}.md`,
      '2026-10/a:b.md',
      '2026-10/con.md',
    ]) {
      expect(isChatFileRel(bad), bad).toBe(false);
      expect(mainIsChatFileRel(bad), bad).toBe(false);
    }
    expect(fileIsForChat('old-title-cmgx1a2b.md', 'cmgx1a2b3c4')).toBe(true);
    expect(fileIsForChat('old-title-cother00.md', 'cmgx1a2b3c4')).toBe(false);
  });
});

describe('the markdown', () => {
  it('starts with a small front matter: id, title, created, updated, models, project', () => {
    const md = renderChatMarkdown(
      conv([user('hi'), reply('hello', 'Claude Opus 5.5'), reply('again', 'Harbor', 'a2')]),
      { projectName: 'Shop "app"' },
    );
    const head = md.split('\n---\n')[0]!;
    expect(head).toBe(
      [
        '---',
        'id: "cmgx1a2b3c4"',
        'title: "Fix the login bug"',
        'created: "2026-10-16T09:30:00.000Z"',
        'updated: "2026-10-16T09:45:00.000Z"',
        'models:',
        '  - "Claude Opus 5.5"',
        '  - "Harbor"',
        'project: "Shop \\"app\\""',
      ].join('\n'),
    );
    expect(md).toContain('\n# Fix the login bug\n');
    expect(md).toContain('### You\n\nhi');
    expect(md).toContain('### Claude Opus 5.5\n\nhello');
    expect(md).toContain('### Harbor\n\nagain');
  });

  it('names the source model when no reply named one, and leaves project out when none', () => {
    const c = conv([user('q'), reply('a')]);
    expect(chatModels(c)).toEqual(['Claude Opus 5.5']);
    const md = renderChatMarkdown(c);
    expect(md).not.toContain('project:');
    expect(md).toContain('### Claude Opus 5.5\n\na');
  });

  it('keeps code fences intact, and closes one a message left open', () => {
    const code = 'Here:\n\n```ts\nconst x = 1;\n```\n\nDone.';
    const md = renderChatMarkdown(conv([user('show me'), reply(code)]));
    expect(md).toContain(code);
    expect(closeFences('```js\nlet a')).toBe('```js\nlet a\n```');
    expect(closeFences('~~~~\nx\n~~~~')).toBe('~~~~\nx\n~~~~');
    expect(closeFences('````\n```\nstill code')).toBe('````\n```\nstill code\n````');
    const open = renderChatMarkdown(conv([reply('```py\nprint(1)'), user('next', 'u2')]));
    expect(open).toContain('```py\nprint(1)\n```\n\n### You\n\nnext');
  });

  it('never writes a model’s thinking', () => {
    const thought = 'SECRET REASONING STEP';
    const md = renderChatMarkdown(
      conv([
        user('why?'),
        { kind: 'thinking', id: 't1', text: thought, streaming: false, startedAt: 1 },
        reply(`<think>${thought} inline</think>Because.`),
      ]),
    );
    expect(md).not.toContain(thought);
    expect(md).not.toContain('<think>');
    expect(md).toContain('Because.');
  });

  it('names attachments without embedding them, and sums up tool steps in one line', () => {
    const items = nameAttachments([user('look at this')], 'look at this', [
      'screen.png',
      'notes.pdf',
    ]);
    const md = renderChatMarkdown(
      conv([
        ...items,
        {
          kind: 'tool',
          id: 't',
          name: 'readFile',
          summary: 'src/app.ts\nsecond line',
          state: 'ok',
          detail: 'FULL FILE BODY',
        },
        { kind: 'tool', id: 't2', name: 'shell', summary: 'rm -rf /', state: 'denied' },
        {
          kind: 'command',
          id: 'c',
          runId: 'r',
          command: 'npm test',
          output: 'LOTS OF OUTPUT',
          state: 'done',
          exitCode: 0,
        },
        reply('Fixed.'),
      ]),
    );
    expect(md).toContain('_Attached: screen.png, notes.pdf_');
    expect(md).not.toContain('data:');
    expect(md).toContain('> Tool `readFile`: src/app.ts second line');
    expect(md).toContain('> Tool `shell`: rm -rf /, not allowed');
    expect(md).toContain('> Ran `npm test`, exit 0');
    expect(md).not.toContain('FULL FILE BODY');
    expect(md).not.toContain('LOTS OF OUTPUT');
    // Names ride only the newest matching line, once.
    expect(nameAttachments(items, 'look at this', ['other.png'])).toBe(items);
  });

  it('leaves a withheld message out, saying only that one was held back', () => {
    const md = renderChatMarkdown(
      conv([{ ...user('blocked words'), withheld: true } as ThreadItem]),
    );
    expect(md).not.toContain('blocked words');
    expect(md).toContain('held back by the ethical boundaries');
  });

  it('carries no em dash in what it writes', () => {
    const dash = String.fromCharCode(0x2014);
    const md = renderChatMarkdown(conv([user('a'), reply('b')]), { projectName: 'p' });
    expect(md).not.toContain(dash);
  });
});

describe('when a chat is ready to write', () => {
  it('waits for the turn to settle and for something to be said', () => {
    expect(chatReadyToMirror(conv([]), SNAPSHOT_ITEMS)).toBe(false);
    expect(chatReadyToMirror(conv([user('q'), reply('a')]), SNAPSHOT_ITEMS)).toBe(true);
    const busy = conv([user('q')]);
    busy.thread.busy = true;
    expect(chatReadyToMirror(busy, SNAPSHOT_ITEMS)).toBe(false);
    const streaming = conv([user('q'), { ...reply('a'), streaming: true } as ThreadItem]);
    expect(chatReadyToMirror(streaming, SNAPSHOT_ITEMS)).toBe(false);
  });

  it('never writes a computer chat from its read-only snapshot over the full file', () => {
    const many = Array.from({ length: SNAPSHOT_ITEMS }, (_, i) => user(`m${i}`, `u${i}`));
    const desktop = conv(many, { source: { kind: 'desktop', sessionId: 's' } });
    expect(chatReadyToMirror(desktop, SNAPSHOT_ITEMS)).toBe(false);
    desktop.thread.lastSeq = 12; // replayed from the journal this launch
    expect(chatReadyToMirror(desktop, SNAPSHOT_ITEMS)).toBe(true);
    const short = conv([user('q')], { source: { kind: 'desktop', sessionId: 's' } });
    expect(chatReadyToMirror(short, SNAPSHOT_ITEMS)).toBe(true);
  });
});
