// The main process's small checks (electron/mainGuards.ts), exactly as
// main.ts runs them: which folders a session may work in, which device
// permissions the window may have, and what the sign-in listener does with
// each request it hears (the D2 shell package).
import { describe, expect, it } from 'vitest';
import {
  OAUTH_REDIRECT_PATH,
  appPermissionAllowed,
  readOAuthCallback,
  sessionRootRefusal,
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
