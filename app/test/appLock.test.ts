// App Lock (founder 2026-10-12, CX ruling Q3): when it locks, what a notice
// says while it is on, that our own unlock prompt never reads as a trip to
// the background, and that no room renders while the app is locked.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCK_AFTER,
  LOCKED_APPROVAL_BODY,
  LOCKED_NOTICE_TITLE,
  LOCKED_REPLY_BODY,
  appLockSub,
  lockAfterLabel,
  shouldLock,
  unlockPromptRecent,
} from '../src/lib/appLock.js';
import { approvalNotice, lockedNotice, replyNotice } from '../src/lib/notices.js';

describe('when the app locks', () => {
  it('never while the lock is off', () => {
    expect(shouldLock(undefined, undefined)).toBe(false);
    expect(shouldLock({ on: false }, 0, 10_000_000)).toBe(false);
  });

  it('always at launch while it is on', () => {
    expect(shouldLock({ on: true }, undefined)).toBe(true);
  });

  it('after the chosen time in the background, a minute by default', () => {
    expect(DEFAULT_LOCK_AFTER).toBe(60);
    expect(shouldLock({ on: true }, 0, 59_000)).toBe(false);
    expect(shouldLock({ on: true }, 0, 60_000)).toBe(true);
    expect(shouldLock({ on: true, after: 0 }, 0, 0)).toBe(true);
    expect(shouldLock({ on: true, after: 900 }, 0, 899_000)).toBe(false);
  });

  it('its own prompt is not a trip to the background', () => {
    expect(unlockPromptRecent()).toBe(false);
  });

  it('says the choices and the row in plain words', () => {
    expect([0, 60, 900].map((a) => lockAfterLabel(a as 0 | 60 | 900))).toEqual([
      'Immediately',
      'After 1 minute',
      'After 15 minutes',
    ]);
    expect(appLockSub('faceID', 'this phone')).toBe(
      "Ask for Face ID or this phone's passcode before OpenShore opens. Your data is already encrypted here. This keeps the app closed to anyone holding it unlocked.",
    );
  });
});

describe('a notice while the lock is on names nothing', () => {
  it('a reply and an approval keep their route and lose their chat', () => {
    const reply = replyNotice('c1', 'Payroll migration', 'complete')!;
    const locked = lockedNotice('reply', reply);
    expect(locked).toMatchObject({
      title: LOCKED_NOTICE_TITLE,
      body: LOCKED_REPLY_BODY,
      route: reply.route,
    });
    expect(JSON.stringify(locked)).not.toContain('Payroll');
    expect(lockedNotice('approval', approvalNotice('c1', 'Payroll')).body).toBe(
      LOCKED_APPROVAL_BODY,
    );
  });
});

describe('no room renders while the app is locked', () => {
  const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');

  it('the lock screen returns before any room, the onboarding, or the drawer', () => {
    const locked = app.indexOf('if (appLocked)');
    expect(locked).toBeGreaterThan(0);
    for (const later of ['<OnboardingScreen', 'const room =', '<Sidebar', '<AccountSetup']) {
      expect(app.indexOf(later), later).toBeGreaterThan(locked);
    }
    const lockBranch = app.slice(locked, app.indexOf('}', app.indexOf('</div>', locked)));
    expect(lockBranch).toContain('<AppLockScreen />');
    expect(lockBranch).not.toMatch(/Room|Sidebar|toast/);
  });
});
