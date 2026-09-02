// Deep-link router for the two moments the OS bounces a flow back into the app
// over the oscode:// scheme: a Supabase auth callback (magic link, email
// confirmation, or password reset) and the Stripe checkout-return page. On iOS
// Capacitor hands us the URL via appUrlOpen (warm) and getLaunchUrl (cold); on
// Electron the main process forwards it over the bridge's onDeepLink (see
// electron/main.ts). Off both, the browser origin receives the redirect
// directly and this is a no-op.
import { useEffect } from 'react';
import { useApp } from '../state/store.js';
import { platform } from '../lib/platform.js';
import { bridge } from '../lib/electronBridge.js';

export function useAuthDeepLink(): void {
  const { completeAuthCallback, onCheckoutReturn, showToast } = useApp();
  useEffect(() => {
    let cancelled = false;
    const removers: Array<() => void> = [];

    // Exact scheme + host matching, never a substring check, so a crafted link
    // cannot smuggle one route's name inside another's URL.
    const routeOf = (url: string): 'checkout' | 'auth' | undefined => {
      try {
        const u = new URL(url);
        if (u.protocol !== 'oscode:') return undefined;
        const host = (u.hostname || u.pathname.replace(/^\/+/, '').split('/')[0] || '').toLowerCase();
        if (host === 'checkout-success') return 'checkout';
        if (host === 'auth-callback') return 'auth';
        return undefined;
      } catch {
        return undefined;
      }
    };

    const route = async (url: string | undefined | null) => {
      if (!url) return;
      const kind = routeOf(url);
      if (kind === 'checkout') {
        await onCheckoutReturn();
        return;
      }
      if (kind === 'auth') {
        try {
          const ok = await completeAuthCallback(url);
          if (ok) showToast('Signed in.');
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err));
        }
      }
    };

    if (platform() === 'ios') {
      void (async () => {
        const { App } = await import('@capacitor/app');
        const listener = await App.addListener('appUrlOpen', (e) => void route(e.url));
        if (cancelled) {
          void listener.remove();
          return;
        }
        removers.push(() => void listener.remove());
        // Cold start: the app may have been launched by the link itself.
        const launch = await App.getLaunchUrl();
        await route(launch?.url);
      })();
    } else {
      const b = bridge();
      if (b) removers.push(b.onDeepLink((url) => void route(url)));
    }

    return () => {
      cancelled = true;
      for (const r of removers) r();
    };
  }, [completeAuthCallback, onCheckoutReturn, showToast]);
}
