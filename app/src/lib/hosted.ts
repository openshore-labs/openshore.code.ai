// Hosted (cloud) models, found in Cloud Connections and only there (founder,
// 2026-10-13: the Local Library lists what runs on your own machines). The
// trillion-parameter frontier models (Kimi K3, Claude Opus, GPT-5, Gemini Pro)
// never run on a laptop, so they are never a download. This module derives a
// browsable, searchable list from the bring-your-own-key providers so the two
// can never drift. No room renders it as a sheet since the Frontier models
// sheet left Cloud Connections (founder, 2026-10-15). Pure: no React, no
// platform calls, unit-tested directly.
import type { CapabilityCategory } from 'os-code/protocol';
import { PROVIDERS, type ProviderInfo } from './providers.js';
import type { StackModelRef } from './stack.js';

export interface HostedModel {
  /** Stable id: `hosted:<provider>:<model>`. */
  id: string;
  providerId: string;
  providerName: string;
  modelId: string;
  name: string;
  tagline: string;
  categories: CapabilityCategory[];
  contextTokens?: number;
  released?: string;
  openWeights: boolean;
  /** The same model on Ollama's cloud, when Ollama hosts it. */
  ollamaCloudRef?: string;
  apiKeyUrl: string;
  /** The stack reference a connected provider puts on the bench. */
  ref: StackModelRef;
}

export const HOSTED_SHELF = {
  key: 'hosted',
  title: 'Frontier models',
  // Not "hosted by their makers": a live provider's picks sit here too, and
  // Groq, Together AI or Hugging Face host other makers' models (2026-10-09).
  subtitle:
    'Cloud models on your own key. Billed to you by their provider, spent only with your say.',
};

/** Days after release a hosted model still reads as new. */
export const HOSTED_NEW_DAYS = 90;

export function hostedModels(providers: ProviderInfo[] = PROVIDERS): HostedModel[] {
  return providers.flatMap((p) =>
    p.models.map((m): HostedModel => ({
      id: `hosted:${p.id}:${m.id}`,
      providerId: p.id,
      providerName: p.name,
      modelId: m.id,
      name: m.label,
      tagline: m.tagline ?? '',
      categories: m.categories ?? [],
      contextTokens: m.contextTokens,
      released: m.released,
      openWeights: Boolean(m.openWeights),
      ollamaCloudRef: m.ollamaCloudRef,
      apiKeyUrl: p.apiKeyUrl,
      ref: { kind: 'cloud', provider: p.id, model: m.id, label: m.label },
    })),
  );
}

/** The haystack for a hosted model: name, provider, api id, and tagline, so
 *  "kimi", "moonshot", and "k3" all land on the same rows. */
export function hostedSearchText(m: HostedModel): string {
  return `${m.name} ${m.providerName} ${m.modelId} ${m.tagline}`;
}

/** A hosted model is found by a plain substring, not the catalog's subsequence
 *  fuzzy match: the shelf is a dozen well-known names, and a typed name like
 *  "kimi" must never also surface Haiku because its letters appear in order
 *  across a tagline. Case and whitespace insensitive on the query. */
export function hostedMatches(query: string, m: HostedModel): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, '');
  if (!q) return true;
  return hostedSearchText(m).toLowerCase().replace(/\s+/g, '').includes(q);
}

function releaseTime(m: HostedModel): number | undefined {
  if (!m.released) return undefined;
  const t = Date.parse(m.released);
  return Number.isNaN(t) ? undefined : t;
}

/** Newest release first; a model with no release date keeps provider order
 *  after every dated one, never sorted by a fabricated date. */
export function sortHostedNewest(models: HostedModel[]): HostedModel[] {
  return models
    .map((m, i) => ({ m, i, t: releaseTime(m) }))
    .sort((a, b) => {
      if (a.t === undefined && b.t === undefined) return a.i - b.i;
      if (a.t === undefined) return 1;
      if (b.t === undefined) return -1;
      return b.t - a.t || a.i - b.i;
    })
    .map((x) => x.m);
}

/** The single newest dated hosted model. */
export function newestHosted(models: HostedModel[]): HostedModel | undefined {
  return sortHostedNewest(models).find((m) => releaseTime(m) !== undefined);
}

export function hostedIsNew(m: HostedModel, now = Date.now()): boolean {
  const t = releaseTime(m);
  if (t === undefined) return false;
  return now - t <= HOSTED_NEW_DAYS * 24 * 60 * 60 * 1000;
}

/** Search and capability filtering for hosted models. */
export function filterHosted(
  models: HostedModel[],
  query: string,
  capability?: CapabilityCategory,
): HostedModel[] {
  return models.filter((m) => {
    if (!hostedMatches(query, m)) return false;
    if (capability && !m.categories.includes(capability)) return false;
    return true;
  });
}

/** A compact context label: 1M, 256K, 128K. */
export function contextLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_048_576)}M`;
  return `${Math.round(tokens / 1024)}K`;
}
