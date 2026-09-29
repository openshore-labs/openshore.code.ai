// The main process's small checks (electron/mainGuards.ts), exactly as
// main.ts runs them: which folders a session may work in, which device
// permissions the window may have, and what the sign-in listener does with
// each request it hears (the D2 shell package), and the words of the three
// native confirms (CX cleanup 2).
import { describe, expect, it } from 'vitest';
import {
  LAUNCH_AT_LOGIN_CONFIRM,
  OAUTH_REDIRECT_PATH,
  appPermissionAllowed,
  cloneConfirm,
  readOAuthCallback,
  sessionRootRefusal,
  trustConfirm,
} from '../electron/mainGuards.js';

describe('sessionRootRefusal: the folders a coding session may not work in', () => {
  const env = { home: '/home/me', oscHome: '/home/me/.os-code', platform: 'linux' as const };

  it('refuses the top of the disk and the home folder itself', () => {
    expect(sessionRootRefusal('/', env)).toBe('root');
    expect(sessionRootRefusal('/home/me', env)).toBe('home');
  });

  it("refuses anything above home, and OpenShore's own settings folder from either side", () => {
    expect(sessionRootRefusal('/home', env)).toBe('home-ancestor');
    expect(sessionRootRefusal('/home/me/.os-code', env)).toBe('osc-home');
    expect(sessionRootRefusal('/home/me/.os-code/sessions', env)).toBe('osc-home');
    // A settings folder moved out of home: its parent is refused too.
    const moved = { ...env, oscHome: '/data/osc/home' };
    expect(sessionRootRefusal('/data/osc', moved)).toBe('osc-home');
  });

  it('lets a project folder through, inside home or out', () => {
    expect(sessionRootRefusal('/home/me/code/app', env)).toBeUndefined();
    expect(sessionRootRefusal('/home/me/OSCode/scratch', env)).toBeUndefined();
    expect(sessionRootRefusal('/srv/project', env)).toBeUndefined();
    // A sibling whose name starts like home is not inside it.
    expect(sessionRootRefusal('/home/me-too', env)).toBeUndefined();
  });

  it('folds case where the disk does (macOS, Windows)', () => {
    const mac = { home: '/Users/Me', oscHome: '/Users/Me/.os-code', platform: 'darwin' as const };
    expect(sessionRootRefusal('/users/me', mac)).toBe('home');
    expect(sessionRootRefusal('/Users/Me/Code', mac)).toBeUndefined();
  });
});

describe('appPermissionAllowed: the main window gets no device by default', () => {
  const app = 'file:///opt/OpenShore/resources/app/dist/index.html';

  it('the app page may use the microphone for audio only', () => {
    expect(appPermissionAllowed('media', { requestingUrl: app, mediaTypes: ['audio'] }, app)).toBe(
      true,
    );
    expect(
      appPermissionAllowed('media', { requestingUrl: `${app}#/chat`, mediaType: 'audio' }, app),
    ).toBe(true);
    expect(
      appPermissionAllowed('media', { requestingUrl: app, mediaTypes: ['audio', 'video'] }, app),
    ).toBe(false);
    expect(appPermissionAllowed('media', { requestingUrl: app, mediaTypes: ['video'] }, app)).toBe(
      false,
    );
    expect(appPermissionAllowed('media', { requestingUrl: app, mediaType: 'unknown' }, app)).toBe(
      false,
    );
    expect(appPermissionAllowed('media', { requestingUrl: app }, app)).toBe(false);
  });

  it('camera, location, notifications and opening other apps are always no', () => {
    for (const permission of [
      'geolocation',
      'notifications',
      'openExternal',
      'midi',
      'pointerLock',
    ]) {
      expect(appPermissionAllowed(permission, { requestingUrl: app }, app), permission).toBe(false);
    }
  });

  it('the copy buttons and full screen work for the app page, and nothing for another page', () => {
    expect(appPermissionAllowed('clipboard-sanitized-write', { requestingUrl: app }, app)).toBe(
      true,
    );
    expect(appPermissionAllowed('fullscreen', { requestingUrl: app }, app)).toBe(true);
    for (const url of ['https://example.com/', 'file:///tmp/evil.html', undefined]) {
      for (const permission of ['media', 'clipboard-sanitized-write', 'fullscreen']) {
        expect(
          appPermissionAllowed(permission, { requestingUrl: url, mediaTypes: ['audio'] }, app),
          `${permission} ${url}`,
        ).toBe(false);
      }
    }
  });
});

describe('readOAuthCallback: the sign-in listener answers only the redirect', () => {
  const at = (query: string) => `${OAUTH_REDIRECT_PATH}?${query}`;

  it('the redirect with a code and a state is the answer', () => {
    expect(readOAuthCallback('GET', at('code=c1&state=s1'))).toEqual({
      kind: 'done',
      result: { code: 'c1', state: 's1' },
    });
    expect(readOAuthCallback('GET', at('error=access_denied&state=s1'))).toEqual({
      kind: 'done',
      result: { error: 'access_denied' },
    });
  });

  it('any other path or method is ignored, so the listener keeps listening', () => {
    expect(readOAuthCallback('GET', '/favicon.ico')).toEqual({ kind: 'ignore' });
    expect(readOAuthCallback('GET', '/')).toEqual({ kind: 'ignore' });
    expect(readOAuthCallback('GET', `/other?code=c1&state=s1`)).toEqual({ kind: 'ignore' });
    expect(readOAuthCallback('POST', at('code=c1&state=s1'))).toEqual({ kind: 'ignore' });
    expect(readOAuthCallback('GET', '//evil.example/oauth2redirect')).toEqual({ kind: 'ignore' });
  });

  it('the redirect without its state is incomplete: an error page, still listening', () => {
    expect(readOAuthCallback('GET', at('code=c1'))).toEqual({ kind: 'incomplete' });
    expect(readOAuthCallback('GET', at('error=access_denied'))).toEqual({ kind: 'incomplete' });
    expect(readOAuthCallback('GET', at('state=s1'))).toEqual({ kind: 'incomplete' });
    expect(readOAuthCallback('GET', OAUTH_REDIRECT_PATH)).toEqual({ kind: 'incomplete' });
  });
});

describe("the second key's words (CX cleanup 2)", () => {
  it('the trust dialog lists each waiting setting as the card does, then the folder', () => {
    const words = trustConfirm(
      ['uses its own check command', 'lets the agent reach api.example.com'],
      '/Users/me/OSCode/app',
    );
    expect(words.message).toBe('Trust this folder?');
    expect(words.confirm).toBe('Trust folder');
    expect(words.detail).toBe(
      'Its own settings will apply on this computer:\n' +
        '\u2022 It uses its own check command.\n' +
        '\u2022 It lets the agent reach api.example.com.\n' +
        'Trust it only if you know who made it. If its settings change, OpenShore asks again.\n\n' +
        '/Users/me/OSCode/app',
    );
  });

  it('the trust dialog still reads as a sentence when nothing is waiting', () => {
    expect(trustConfirm([], '/p').detail).toBe(
      'Its own settings will apply on this computer.\n' +
        'Trust it only if you know who made it. If its settings change, OpenShore asks again.\n\n/p',
    );
  });

  it('copying a repository and starting with the computer say what they do', () => {
    expect(cloneConfirm('https://github.com/me/app')).toEqual({
      message: 'Copy this repository to your computer?',
      detail:
        'OpenShore downloads a copy into its projects folder so you can work on it in a chat. Its own settings stay off until you trust it.\n\nhttps://github.com/me/app',
      confirm: 'Copy repository',
    });
    expect(LAUNCH_AT_LOGIN_CONFIRM).toEqual({
      message: 'Start OpenShore with your computer?',
      detail:
        'It opens in the background each time you sign in to this computer, so your phone can reach it and your routines can run. Turn it off any time from the same switch.',
      confirm: 'Start with my computer',
    });
  });
});
