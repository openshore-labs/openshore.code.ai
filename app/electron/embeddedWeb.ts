// A contained web site inside the shell: one WebContentsView, fenced to a
// named site's hosts, with its own cookie partition so a sign-in persists
// across launches and never mixes with the app's own session. The renderer
// asks for a site by NAME (never a URL), places it by bounds, and gets state
// back (url, title, loading, canGoBack). Anything outside the fence is handed
// to the system browser, so the view can never become a general browser.
import { BrowserWindow, WebContentsView, session, shell } from 'electron';
import type { WebContents } from 'electron';

export interface EmbeddedRule {
  /** A host; a leading dot allows every subdomain too. */
  host: string;
  /** When set, only these path prefixes are allowed on the host. Keeps a
   *  sign-in provider to its sign-in pages, so the view never becomes a way
   *  to browse GitHub or Google. */
  paths?: string[];
  /** Exact path shapes, for a page that sits under a prefix too wide to
   *  allow whole (an org's SAML prompt lives under /orgs/, which is also
   *  every org's home page). */
  pathPatterns?: RegExp[];
}

export interface EmbeddedSite {
  /** The page the view opens on. */
  home: string;
  /** Where the view may navigate. Everything else goes to the system browser. */
  allow: EmbeddedRule[];
  /** The cookie/storage partition. `persist:` keeps the sign-in across launches. */
  partition: string;
}

export const EMBEDDED_SITES: Record<string, EmbeddedSite> = {
  codemagic: {
    home: 'https://codemagic.io/apps',
    allow: [
      { host: '.codemagic.io' },
      // The sign-in providers Codemagic offers, held to their sign-in pages.
      // Google refuses to finish OAuth in an embedded view; it is listed so
      // the person sees Google's own notice rather than a blank denial.
      // GitHub is the likely route: sign-in and two-factor, the Codemagic
      // GitHub App install page a repo connection lands on, and an org's
      // SAML prompt. Still never a way to browse GitHub itself.
      {
        host: 'github.com',
        paths: ['/login', '/sessions', '/session', '/apps/', '/settings/installations'],
        // Only an org's SSO prompt, never its home or repositories (UI-5).
        pathPatterns: [/^\/orgs\/[^/]+\/sso(?:\/|$)/],
      },
      { host: 'gitlab.com', paths: ['/oauth', '/users/sign_in', '/-/'] },
      { host: 'bitbucket.org', paths: ['/site/oauth2', '/account'] },
      { host: 'id.atlassian.com' },
      { host: 'accounts.google.com' },
      { host: '.googleusercontent.com' },
      { host: '.gstatic.com' },
    ],
    partition: 'persist:embedded-codemagic',
  },
};

export interface EmbeddedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EmbeddedState {
  site: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
}

export function hostAllowed(url: string, site: EmbeddedSite): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return u.protocol === 'about:';
  const host = u.hostname.toLowerCase();
  return site.allow.some((rule) => {
    const h = rule.host;
    const hostOk = h.startsWith('.') ? host === h.slice(1) || host.endsWith(h) : host === h;
    if (!hostOk) return false;
    if (!rule.paths && !rule.pathPatterns) return true;
    return (
      Boolean(rule.paths?.some((p) => u.pathname.startsWith(p))) ||
      Boolean(rule.pathPatterns?.some((re) => re.test(u.pathname)))
    );
  });
}

/** Fence one WebContents to the site: in-place navigation stays inside,
 *  anything else goes to the system browser and is denied here. Popups
 *  (an OAuth window) get their own fenced BrowserWindow on the same session. */
function fence(contents: WebContents, site: EmbeddedSite, parent?: BrowserWindow): void {
  contents.on('will-navigate', (event, url) => {
    if (hostAllowed(url, site)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  contents.on('will-redirect', (event, url) => {
    if (hostAllowed(url, site)) return;
    event.preventDefault();
  });
  // Sub-frames are fenced the same way (UI-5): an iframe inside the page must
  // not become a way to load a host the main frame could not.
  contents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return;
    if (!hostAllowed(event.url, site)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (!hostAllowed(url, site)) {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent,
        width: 560,
        height: 720,
        autoHideMenuBar: true,
        webPreferences: {
          partition: site.partition,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      },
    };
  });
  contents.on('did-create-window', (child) => {
    fence(child.webContents, site, parent);
  });
}

export class EmbeddedWeb {
  private view?: WebContentsView;
  private siteName?: string;
  private bounds: EmbeddedBounds = { x: 0, y: 0, width: 0, height: 0 };
  private visible = true;

  constructor(
    private readonly getWindow: () => BrowserWindow | undefined,
    private readonly onState: (state: EmbeddedState) => void,
  ) {}

  /** Open (or refocus) a named site inside the window. */
  open(name: string, bounds: EmbeddedBounds): boolean {
    const site = EMBEDDED_SITES[name];
    const win = this.getWindow();
    if (!site || !win) return false;
    if (this.view && this.siteName === name) {
      this.setBounds(bounds);
      return true;
    }
    this.close();
    const view = new WebContentsView({
      webPreferences: {
        partition: site.partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.view = view;
    this.siteName = name;
    const part = session.fromPartition(site.partition);
    // Nothing inside the fence gets a device (UI-5). Electron's default would
    // approve camera, microphone, and location for any host here without a
    // prompt; a sign-in page needs none of them, so every request is denied,
    // and the check-time answer matches so a site never sees "granted".
    part.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    part.setPermissionCheckHandler(() => false);
    // A plain browser identity so sites treat it as a normal Chrome, not an
    // app shell. Ends the "unsupported browser" walls some dashboards show.
    view.webContents.setUserAgent(part.getUserAgent().replace(/ Electron\/\S+/, ''));
    fence(view.webContents, site, win);
    const emit = () => {
      if (this.view !== view) return;
      this.onState({
        site: name,
        url: view.webContents.getURL(),
        title: view.webContents.getTitle(),
        loading: view.webContents.isLoading(),
        canGoBack: view.webContents.navigationHistory.canGoBack(),
      });
    };
    for (const ev of [
      'did-navigate',
      'did-navigate-in-page',
      'did-start-loading',
      'did-stop-loading',
      'page-title-updated',
    ] as const) {
      view.webContents.on(ev as 'did-navigate', emit);
    }
    win.contentView.addChildView(view);
    this.setBounds(bounds);
    void view.webContents.loadURL(site.home);
    return true;
  }

  setBounds(bounds: EmbeddedBounds): void {
    this.bounds = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    };
    this.apply();
  }

  /** Hide while something must draw over it (the drawer, a sheet). */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.apply();
  }

  private apply(): void {
    if (!this.view) return;
    this.view.setVisible(this.visible && this.bounds.width > 0 && this.bounds.height > 0);
    this.view.setBounds(this.bounds);
  }

  back(): void {
    const wc = this.view?.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  reload(): void {
    this.view?.webContents.reload();
  }

  home(): void {
    const site = this.siteName ? EMBEDDED_SITES[this.siteName] : undefined;
    if (site) void this.view?.webContents.loadURL(site.home);
  }

  /** Forget the sign-in: clear the partition's cookies and storage. */
  async signOut(): Promise<void> {
    const site = this.siteName ? EMBEDDED_SITES[this.siteName] : undefined;
    if (!site) return;
    const s = session.fromPartition(site.partition);
    await s.clearStorageData();
    await s.clearCache();
    this.home();
  }

  close(): void {
    const view = this.view;
    const win = this.getWindow();
    if (!view) return;
    this.view = undefined;
    this.siteName = undefined;
    if (win && !win.isDestroyed()) win.contentView.removeChildView(view);
    view.webContents.close();
  }
}
