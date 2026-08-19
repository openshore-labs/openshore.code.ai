/// <reference types="vite/client" />

// Custom build-time env, injected by Vite. All optional: absent means the
// feature (sign-in, billing) is simply off and the app stays local-first.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
  /** Public key (base64url) that verifies signed org entitlement claims. */
  readonly VITE_ENTITLEMENT_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
