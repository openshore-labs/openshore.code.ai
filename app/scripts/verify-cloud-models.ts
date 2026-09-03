// Dev check: are the cloud models we offer actually available on each
// provider's API right now? OpenShore is a full client for your own key, so a
// model we list that the provider has retired is a dead button. This script
// asks each provider for its live model list and compares it to what we offer,
// so a maintainer can confirm every offered model is real (and spot new ones
// worth adding) before a release. It reaches the network and needs real keys,
// so it is a manual dev tool, never part of CI.
//
// Run it with the keys you want to check in the environment:
//   ANTHROPIC_API_KEY=... OPENAI_API_KEY=... GEMINI_API_KEY=... \
//   MOONSHOT_API_KEY=... pnpm --filter oscode-app verify:models
//
// A provider with no key is skipped. Exit code is non-zero if any offered model
// is missing from a provider we could reach, so it can gate a release check.
import { CLAUDE_MODELS } from '../src/lib/claudeModels.js';
import { PROVIDERS, anthropicHeaders, providerInfo } from '../src/lib/providers.js';

/** Env vars that may carry each provider's key, in order of preference. */
const KEY_ENV: Record<string, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  moonshot: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
};

function keyFor(providerId: string): string | undefined {
  for (const name of KEY_ENV[providerId] ?? []) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return undefined;
}

/** The model ids we offer for a provider. Claude comes from the client catalog
 *  (the chat sheet and bench read it); the rest from the provider catalog. */
function offeredIds(providerId: string): string[] {
  if (providerId === 'anthropic') return CLAUDE_MODELS.map((m) => m.id);
  return providerInfo(providerId)?.models.map((m) => m.id) ?? [];
}

/** Live model ids from a provider's models endpoint, or undefined on failure. */
async function liveIds(providerId: string, key: string): Promise<string[] | undefined> {
  try {
    if (providerId === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=1000', {
        headers: anthropicHeaders(key, process.env.ANTHROPIC_WORKSPACE_ID?.trim()),
      });
      if (!res.ok) {
        console.log(`  ! ${providerId}: models endpoint answered ${res.status}`);
        return undefined;
      }
      const json = (await res.json()) as { data?: Array<{ id?: string }> };
      return (json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
    }
    const base = providerInfo(providerId)?.openaiBaseUrl;
    if (!base) return undefined;
    const res = await fetch(`${base}/models`, {
      headers: { authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      console.log(`  ! ${providerId}: models endpoint answered ${res.status}`);
      return undefined;
    }
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    return (json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
  } catch (err) {
    console.log(`  ! ${providerId}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/** A provider may return dated ids (claude-opus-5-20260101) for our alias
 *  (claude-opus-5). Count an offered id as present on an exact match or when a
 *  live id begins with it (the dated form of the same alias). */
function isAvailable(offered: string, live: string[]): boolean {
  return live.some((id) => id === offered || id.startsWith(`${offered}-`));
}

async function main(): Promise<void> {
  let missingTotal = 0;
  let checked = 0;

  for (const provider of PROVIDERS) {
    const key = keyFor(provider.id);
    if (!key) {
      console.log(`- ${provider.name} (${provider.id}): skipped, no key in env`);
      continue;
    }
    const live = await liveIds(provider.id, key);
    if (!live) {
      console.log(`- ${provider.name} (${provider.id}): could not read the model list`);
      continue;
    }
    checked += 1;
    const offered = offeredIds(provider.id);
    const missing = offered.filter((id) => !isAvailable(id, live));
    const covered = new Set<string>();
    for (const id of offered)
      for (const l of live) if (l === id || l.startsWith(`${id}-`)) covered.add(l);
    const extra = live.filter((id) => !covered.has(id));

    console.log(`\n== ${provider.name} (${provider.id}) ==`);
    console.log(`  offered: ${offered.length}, live: ${live.length}`);
    if (missing.length) {
      missingTotal += missing.length;
      console.log(`  MISSING (offered but not available, a dead button):`);
      for (const id of missing) console.log(`    - ${id}`);
    } else {
      console.log('  all offered models are available');
    }
    if (extra.length) {
      console.log(`  available but not offered (candidates to add), first 20:`);
      for (const id of extra.slice(0, 20)) console.log(`    + ${id}`);
      if (extra.length > 20) console.log(`    ...and ${extra.length - 20} more`);
    }
  }

  console.log(
    `\nChecked ${checked} provider(s). ${missingTotal === 0 ? 'No dead buttons.' : `${missingTotal} offered model(s) missing.`}`,
  );
  if (missingTotal > 0) process.exitCode = 1;
}

void main();
