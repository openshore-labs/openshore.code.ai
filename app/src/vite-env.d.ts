/// <reference types="vite/client" />

// Custom build-time env, injected by Vite. All optional: absent means the
// feature (sign-in, billing) is simply off and the app stays local-first.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
  readonly VITE_GDRIVE_IOS_CLIENT_ID?: string;
  readonly VITE_GDRIVE_DESKTOP_CLIENT_ID?: string;
  readonly VITE_GDRIVE_DESKTOP_CLIENT_SECRET?: string;
  readonly VITE_GITHUB_CLIENT_ID?: string;
  readonly VITE_GITLAB_CLIENT_ID?: string;
  readonly VITE_BITBUCKET_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
