// Notices follow the Claude app's pattern: only when you are away, asked for in
// context, a tap opens the thing, calm and private, switchable per kind. These
// pin the pure policy and the wiring that makes a finished download notice
// work even when iOS relaunched the app in the background to finish it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  approvalNotice,
  decodeTap,
  downloadNoticeCopy,
  encodeRoute,
  noticeEnabled,
  replyNotice,
  shouldNotice,
} from '../src/lib/notices.js';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const NATIVE = 'plugins/oscode-llama/ios/Sources/OscodeLlamaPlugin';

describe('the notice gate', () => {
  const on = { prefs: {}, permission: 'granted' as const, visible: false };

  it('posts only when the app is not in front', () => {
    expect(shouldNotice('reply', on)).toBe(true);
    expect(shouldNotice('reply', { ...on, visible: true })).toBe(false);
  });

  it('needs a granted permission', () => {
    expect(shouldNotice('reply', { ...on, permission: 'prompt' })).toBe(false);
    expect(shouldNotice('reply', { ...on, permission: 'denied' })).toBe(false);
  });

  it('defaults every kind on and honors each toggle', () => {
    expect(noticeEnabled('download', {})).toBe(true);
    expect(noticeEnabled('reply', {})).toBe(true);
    expect(noticeEnabled('download', { noticeDownloads: false })).toBe(false);
    expect(noticeEnabled('reply', { noticeReplies: false })).toBe(false);
    // Approvals ride the Replies toggle.
    expect(noticeEnabled('approval', { noticeReplies: false })).toBe(false);
    expect(noticeEnabled('approval', { noticeDownloads: false })).toBe(true);
  });
});

describe('notice copy', () => {
  it('names the model and routes a guide tap into its chat', () => {
    const c = downloadNoticeCopy('Harbor', 'harbor');
    expect(c.doneTitle).toBe('Harbor is ready');
    expect(decodeTap({ route: c.route })).toEqual({ to: 'guide', modelId: 'harbor' });
    expect(c.failTitle).toContain('Harbor');
  });

  it('routes a Marketplace model to the Stack', () => {
    const c = downloadNoticeCopy('Qwen 2.5 Coder 3B');
    expect(decodeTap({ route: c.route })).toEqual({ to: 'view', view: 'stack' });
  });

  it('never puts reply text on the lock screen, and one notice per chat', () => {
    const n = replyNotice('c1', 'Fix the login bug', 'complete')!;
    expect(n.title).toBe('Fix the login bug');
    expect(n.body).toBe('Your reply is ready.');
    expect(n.id).toBe(approvalNotice('c1', 'Fix the login bug').id);
    expect(decodeTap({ route: n.route })).toEqual({ to: 'chat', conversationId: 'c1' });
  });

  it('stays quiet for an ending you caused yourself', () => {
    expect(replyNotice('c1', 't', 'aborted')).toBeNull();
    expect(replyNotice('c1', 't', 'declined')).toBeNull();
    expect(replyNotice('c1', 't', 'error')).not.toBeNull();
  });

  it('falls back to the app name for an untitled chat', () => {
    expect(replyNotice('c1', 'New chat', 'complete')!.title).toBe('OpenShore');
  });

  it('keeps every line free of em dashes', () => {
    const lines = [
      ...Object.values(downloadNoticeCopy('Harbor', 'harbor')),
      ...(['complete', 'error', 'guardrail'] as const).map((r) => replyNotice('c', 't', r)!.body),
      approvalNotice('c', 't').body,
    ];
    for (const line of lines) expect(line).not.toContain(String.fromCharCode(0x2014));
  });
});

describe('tap routing', () => {
  it('maps a desktop completion push to its session', () => {
    expect(decodeTap({ sessionId: 's9' })).toEqual({ to: 'session', sessionId: 's9' });
  });

  it('opens nothing for a malformed payload', () => {
    expect(decodeTap({ route: 'not json' })).toBeNull();
    expect(decodeTap({ route: encodeRoute({ to: 'chat' } as never) })).toBeNull();
    expect(decodeTap({})).toBeNull();
  });
});

describe('the wiring', () => {
  it('posts download notices natively, so a background relaunch still gets one', () => {
    const store = read(`${NATIVE}/ModelStore.swift`);
    expect(store).toContain('Notices.downloadFinished(id: id, ok: true)');
    expect(store).toContain('Notices.downloadFinished(id: id, ok: false)');
    const notices = read(`${NATIVE}/Notices.swift`);
    expect(notices).toContain('applicationState != .active');
  });

  it('hands every download its notice copy', () => {
    expect(read('src/state/store.ts').match(/notice: downloadNoticeCopy\(/g)?.length).toBe(2);
    expect(read('src/screens/MarketplaceScreen.tsx')).toContain('notice: downloadNoticeCopy(');
  });

  it('routes a tapped notice back to the web layer', () => {
    expect(read('ios/App/App/AppDelegate.swift')).toContain('OscodeLlamaPlugin.deliverNoticeTap');
    expect(read('src/state/store.ts')).toContain("Llama.addListener('noticeTap'");
  });

  it('never asks for permission at launch', () => {
    const store = read('src/state/store.ts');
    const init = store.slice(
      store.indexOf('async init()'),
      store.indexOf('async refreshConnectivity()'),
    );
    expect(init).not.toContain('askForNotices');
  });
});
