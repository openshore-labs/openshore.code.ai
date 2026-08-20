// Native deep-link sign-in. Supabase magic-link and email-confirmation links
// return to the app through the oscode:// URL scheme (see authRedirectTo in the
// store). Capacitor hands us that URL both on a warm open (the appUrlOpen event)
// and on a cold launch (getLaunchUrl); either way we pass it to
// completeAuthCallback, which parses the token out of the fragment and signs in.
// Off native this is a no-op: the browser origin receives the redirect directly.
import { useEffect } from 'react';
import { useApp } from '../state/store.js';
import { platform } from '../lib/platform.js';

export function useAuthDeepLink(): void {
  const { completeAuthCallback, showToast } = useApp();
  useEffect(() => {
    if (platform() !== 'ios') return;
    let cancelled = false;
    let remove: (() => void) | undefined;

    const handle = async (url: string | undefined | null) => {
      if (!url || !url.includes('auth-callback')) return;
      try {
        const ok = await completeAuthCallback(url);
        if (ok) showToast('Signed in.');
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    };

    void (async () => {
      const { App } = await import('@capacitor/app');
      const listener = await App.addListener('appUrlOpen', (e) => void handle(e.url));
      remove = () => void listener.remove();
      if (cancelled) {
        remove();
        return;
      }
      // Cold start: the app may have been launched by the link itself.
      const launch = await App.getLaunchUrl();
      await handle(launch?.url);
    })();

    return () => {
      cancelled = true;
      remove?.();
    };
  }, [completeAuthCallback, showToast]);
}
