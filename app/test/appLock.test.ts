// App Lock (founder 2026-10-12, CX ruling Q3, CTO review): the native side
// decides when a return locks, a notice names nothing while it is on, and no
// room renders while the app is locked.
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
} from '../src/lib/appLock.js';
import { approvalNotice, lockedNotice, replyNotice } from '../src/lib/notices.js';

describe('when the app locks (native, CTO review 2026-10-12)', () => {
  const swift = readFileSync(
    join(
      process.cwd(),
      'plugins/oscode-applock/ios/Sources/OscodeApplockPlugin/OscodeApplockPlugin.swift',
    ),
    'utf8',
  );
  const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');

  it('times the trip away on the uptime clock, which a date change cannot move', () => {
    expect(swift).toContain('ProcessInfo.processInfo.systemUptime');
    expect(swift).not.toMatch(/Date\(\)|timeIntervalSince1970/);
  });

  it('counts only a real trip to the background, never our own prompts', () => {
    expect(swift).toContain('didEnterBackgroundNotification');
    expect(swift).toMatch(/guard self\.lockOn, let left = self\.backgroundedAt/);
    // The JS side locks only when the native side says so.
    expect(app.match(/lockApp\(\)/g)).toHaveLength(1);
    expect(app).toMatch(/onLockRequired\(\(\) => useApp\.getState\(\)\.lockApp\(\)\)/);
  });

  it('holds the cover over the app until the lock screen is drawn', () => {
    expect(swift).toMatch(/holdCover = true[\s\S]*notifyListeners\("lockRequired"/);
    const screen = readFileSync(join(process.cwd(), 'src/components/AppLockScreen.tsx'), 'utf8');
    expect(screen).toContain('revealLockScreen()');
  });

  it('a default of one minute, and the choices in plain words', () => {
    expect(DEFAULT_LOCK_AFTER).toBe(60);
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
