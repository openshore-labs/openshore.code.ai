// Connector and secret manifest, the single source of truth for every cloud
// connector OS Code can talk to, the credential each one uses, WHERE that
// secret lives, and WHICH components depend on it. Modeled on the pattern
// proven in the Uki app repo (serverMap.manifest.js): make "what uses what"
// machine-readable from day one, before connectors multiply, so rotating or
// removing a key can never silently break a flow.
//
// Enforcement: test/connectorMap.test.ts fails when a secret-ish env var is
// read anywhere in src/ without being declared here, and when a declared
// credential drifts out of the store/env it claims to live in.
//
// Secret HOMES:
//   'credential-store' — the OS keychain via secret-tool, or the encrypted
//                        file at ~/.os-code/credentials (see src/auth/store.ts).
//   'env'              — an environment variable the user exports.
//   'file'             — a mode-600 file under ~/.os-code/.
//   'none'             — the connector needs no secret at all.

export interface Connector {
  id: string;
  /** Public-safe nickname; UI surfaces render this and nothing rawer. */
  nickname: string;
  /** What the connector is for, one sentence. */
  purpose: string;
  /** Credential name(s) and every home each one lives in. */
  secrets: Array<{
    name: string;
    homes: Array<'credential-store' | 'env' | 'file' | 'none'>;
    /** Env var name when 'env' is a home. */
    envVar?: string;
    /** Store key when 'credential-store' is a home. */
    storeKey?: string;
    /** File path (relative to ~/.os-code) when 'file' is a home. */
    file?: string;
  }>;
  /** Modules that break if this secret rotates or vanishes. */
  consumers: string[];
  /** Optional by design? Everything cloud is optional; local-first is the default. */
  optional: boolean;
}

export const CONNECTORS: Connector[] = [
  {
    id: 'ollama',
    nickname: 'Local model server',
    purpose: 'Runs the local fleet (Ollama, LM Studio, llama.cpp, vLLM). The default engine.',
    secrets: [{ name: 'none', homes: ['none'] }],
    consumers: ['providers/openaiCompatible', 'router', 'context/index (embeddings)'],
    optional: false,
  },
  {
    id: 'anthropic',
    nickname: 'Claude cloud',
    purpose: 'Cloud escalation and the optional cloud orchestrator, on the user\'s own key.',
    secrets: [
      {
        name: 'Anthropic API key',
        homes: ['credential-store', 'env'],
        envVar: 'ANTHROPIC_API_KEY',
        storeKey: 'anthropic-api-key',
      },
    ],
    consumers: ['providers/anthropic', 'router (escalation)', 'commands/login', 'commands/doctor'],
    optional: true,
  },
  {
    id: 'github',
    nickname: 'GitHub',
    purpose: 'Push, PRs, and repo metadata through Octokit.',
    secrets: [
      {
        name: 'GitHub token (device flow or PAT)',
        homes: ['credential-store', 'env'],
        envVar: 'GITHUB_TOKEN',
        storeKey: 'github-token',
      },
      {
        name: 'GitHub OAuth app client id (self-hosters only, not a secret)',
        homes: ['env'],
        envVar: 'OSC_GITHUB_CLIENT_ID',
      },
    ],
    consumers: ['github/index', 'auth/github', 'commands/authGithub'],
    optional: true,
  },
  {
    id: 'brave-search',
    nickname: 'Brave Search',
    purpose: 'Optional web-search backend.',
    secrets: [{ name: 'Brave API key', homes: ['env'], envVar: 'BRAVE_API_KEY' }],
    consumers: ['core/tools/search/brave'],
    optional: true,
  },
  {
    id: 'tavily',
    nickname: 'Tavily',
    purpose: 'Optional web-search backend tuned for agents.',
    secrets: [{ name: 'Tavily API key', homes: ['env'], envVar: 'TAVILY_API_KEY' }],
    consumers: ['core/tools/search/tavily'],
    optional: true,
  },
  {
    id: 'searxng',
    nickname: 'SearXNG (self-hosted)',
    purpose: 'The fully private search backend; a URL in config, no secret.',
    secrets: [{ name: 'none', homes: ['none'] }],
    consumers: ['core/tools/search/searxng'],
    optional: true,
  },
  {
    id: 'duckduckgo',
    nickname: 'DuckDuckGo',
    purpose: 'The zero-config default search backend. No account, no key.',
    secrets: [{ name: 'none', homes: ['none'] }],
    consumers: ['core/tools/search/duckduckgo'],
    optional: true,
  },
  {
    id: 'openshore-license',
    nickname: 'OpenShore licensing',
    purpose: 'License activation for the curated feed and update channel.',
    secrets: [
      { name: 'License key + cached entitlement', homes: ['file'], file: 'license.json' },
    ],
    consumers: ['license/verify', 'license/entitlement', 'commands/license', 'market/catalog (gating)'],
    optional: true,
  },
  {
    id: 'daemon',
    nickname: 'OS Code daemon',
    purpose: 'The phone-facing control channel over the tailnet.',
    secrets: [{ name: 'Daemon bearer token', homes: ['file'], file: 'daemon.token' }],
    consumers: ['daemon/serve', 'daemon/attach', 'connect/pair', 'connect/health'],
    optional: true,
  },
  {
    id: 'image-server',
    nickname: 'Local image server',
    purpose: 'Diffusion endpoint for the image-generation specialist (A1111 or OpenAI-images).',
    secrets: [{ name: 'none', homes: ['none'] }],
    consumers: ['providers/imageGen', 'core/tools/generateImage'],
    optional: true,
  },
];

/** Every env var the manifest claims OS Code reads for a secret. */
export function declaredEnvVars(): string[] {
  return CONNECTORS.flatMap((c) => c.secrets.flatMap((s) => (s.envVar ? [s.envVar] : [])));
}

/** Every credential-store key the manifest declares. */
export function declaredStoreKeys(): string[] {
  return CONNECTORS.flatMap((c) => c.secrets.flatMap((s) => (s.storeKey ? [s.storeKey] : [])));
}

/** Public-safe projection: nicknames and purposes only, never names or homes. */
export function publicProjection(): Array<{ nickname: string; purpose: string; optional: boolean }> {
  return CONNECTORS.map((c) => ({ nickname: c.nickname, purpose: c.purpose, optional: c.optional }));
}
