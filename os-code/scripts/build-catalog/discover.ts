// Live discovery: the catalog grows on its own. Every build asks Hugging Face
// which GGUF repos are trending and which landed most recently, reads each
// repo's METADATA (file list, sizes, license tag, gated flag; never weights),
// and turns the ones that clear the honesty bar into catalog entries. A
// discovered entry is clearly labelled (`discovery` set, no ratings, no eval,
// not orchestrator-capable) so the storefront never presents a machine-found
// model as a curated or rated one. The editorial seed always wins on an id
// collision, and the founder's curation and overlay still apply on top.
//
// Pure where it can be: `discoverModels` takes a `DiscoveryClient` so the
// tests drive it with fixtures; `HuggingFaceDiscovery` is the one live client.
import type { CatalogModel } from '../../src/market/schema.js';
import type { CapabilityCategory } from '../../src/router/roles.js';
import { resolveLicense } from './licenses.table.js';

/** One repo from a Hugging Face listing call. */
export interface DiscoveredRepo {
  id: string;
  downloads?: number;
  likes?: number;
  createdAt?: string;
  tags?: string[];
  gated?: boolean | string;
  private?: boolean;
}

/** One file inside a repo, from the detail call with sizes. */
export interface RepoFile {
  rfilename: string;
  size?: number;
}

export interface RepoDetail {
  id: string;
  siblings?: RepoFile[];
  tags?: string[];
  cardData?: { license?: string | string[] };
  gated?: boolean | string;
  private?: boolean;
  lastModified?: string;
  createdAt?: string;
  downloads?: number;
  likes?: number;
}

/** The metadata reads discovery needs. Fixtures in tests, HF in CI. */
export interface DiscoveryClient {
  /** GGUF repos, best first, for one sort axis. */
  list(sort: 'trendingScore' | 'createdAt', limit: number): Promise<DiscoveredRepo[]>;
  /** One publisher's GGUF repos, most recently modified first. */
  listByAuthor(author: string, limit: number): Promise<DiscoveredRepo[]>;
  /** One repo with its file list and sizes. Undefined when it cannot be read. */
  detail(repoId: string): Promise<RepoDetail | undefined>;
}

export interface DiscoverOptions {
  /** How many discovered models the catalog carries at most. */
  cap?: number;
  /** How many repos to read per listing axis. */
  perAxis?: number;
  /** Today, YYYY-MM-DD, for `foundAt` on a first sighting. */
  today: string;
  /** The previously published catalog's discovered models, carried forward so
   *  a quiet source day never empties the shelf (and never trips the count gate). */
  previous?: CatalogModel[];
  /** Ids already in the seed; the seed always wins a collision. */
  reserved?: Set<string>;
}

export interface DiscoverResult {
  models: CatalogModel[];
  /** Why a listed repo did not become an entry, for the build log. */
  skipped: Array<{ repo: string; reason: string }>;
}

/** Quantizations we will pull, best first. One single-file GGUF at one of
 *  these, or the repo is skipped. */
const QUANT_PREFERENCE = ['Q4_K_M', 'Q4_K_S', 'Q5_K_M', 'Q8_0', 'Q6_K', 'Q4_0'];

/** Repos the storefront does not carry, whatever their numbers: guardrail
 *  removals and their many spellings, adult content, and modalities the
 *  stack cannot run (speech in or out). Learned from the first live crop. */
const NAME_DENYLIST = [
  'uncensored',
  'abliterated',
  'obliterated',
  'unleashed',
  'heretic',
  'jailbreak',
  'nsfw',
  'roleplay',
  'erotic',
  'lewd',
  'waifu',
  'hentai',
  '-stt',
  '-asr',
  '-tts',
  'whisper',
  'speech',
  'parakeet',
  'canary',
  'sortformer',
  'codec',
  // Not chat-capable: rerankers, safety classifiers, translation-only models.
  'rerank',
  'guardian',
  'hy-mt',
];

/** Publishers who quantize other people's models. Their upload is trusted as
 *  a faithful conversion, not as a model choice, so a quantizer upload must
 *  also name a known lab family; a lab's own upload needs no such check. */
const QUANTIZERS = new Set([
  'bartowski',
  'unsloth',
  'lmstudio-community',
  'ggml-org',
  'quantfactory',
  'maziyarpanahi',
]);

/** Model families from the labs, matched against a quantizer upload's name. A
 *  quantizer upload that names none of these is skipped, so widening this list
 *  is how a curated quantizer's copy of a new lab model reaches the shelf. */
const LAB_FAMILY =
  /qwen|qwq|llama|gemma|mistral|mixtral|ministral|magistral|devstral|codestral|pixtral|phi-?\d|deepseek|glm|granite|olmo|molmo|smol|kimi|minimax|hunyuan|\bhy-|nemotron|gpt-oss|command|falcon|internlm|intern-?vl|exaone|seed-|ernie|mimo|lfm|afm-|trinity|nomic|jina|bge|gte-|e5-|moondream|llava|dots|yi-|starcoder|codegemma|baichuan|solar|stablelm|dbrx|arctic|jamba|aya|reka|mamba|recurrentgemma|starcoder2|granite-?\d|cogito|skywork|apriel|seed-oss|ling-|ring-|marco|xgen|orca|openchat|openhermes|hermes-?\d|command-?r/i;

/** Publishers whose uploads the storefront carries sight unseen: the model
 *  labs themselves and the quantizers the community pulls from. Both axes are
 *  limited to these; every other publisher is logged as skipped so the list
 *  grows on evidence. Lowercase.
 *
 *  This is the guardrail, NOT the name denylist. The denylist catches the crop
 *  whose NAME advertises what it is (uncensored, abliterated, nsfw); it cannot
 *  catch a guardrail-stripped line with a clean name. Keeping the store to
 *  known labs and curated quantizers is what actually holds that line, so this
 *  set is grown deliberately, publisher by publisher, never opened wholesale
 *  (CTO ruling, 2026-09-03: opening the allowlist reintroduces the junk crop). */
export const TRUSTED_PUBLISHERS = new Set([
  // Curated quantizers the community pulls from. A quantizer upload must also
  // name a known lab family (cheapReject), so these cannot smuggle in a merge.
  'bartowski',
  'unsloth',
  'lmstudio-community',
  'ggml-org',
  'quantfactory',
  'maziyarpanahi',
  // Model labs, carried on their own uploads. Grown from the benchlm coverage
  // pass, 2026-09-03: the labs behind the models a "best local LLM" list ranks.
  'qwen',
  'alibaba-nlp',
  'google',
  'mistralai',
  'deepseek-ai',
  'moonshotai',
  'microsoft',
  'ibm-granite',
  'nvidia',
  'huggingfacetb',
  'allenai',
  'meta-llama',
  'zai-org',
  'thudm',
  'openai',
  'nomic-ai',
  'jinaai',
  'liquidai',
  'arcee-ai',
  'inclusionai',
  'tencent',
  'minimaxai',
  'xiaomimimo',
  'baidu',
  'cohereforai',
  'coherelabs',
  '01-ai',
  'internlm',
  'lgai-exaone',
  'openbmb',
  'tiiuae',
  'stabilityai',
  'ai21labs',
  'upstage',
  'databricks',
  'snowflake',
  'servicenow',
  'bigcode',
  'nousresearch',
  'sarvamai',
  'apple',
  'stepfun-ai',
  'rakutentech',
  'h2oai',
  'ontocord',
  'kwaipilot',
  'agentica-org',
  'open-thoughts',
  'deepcogito',
  'perplexity-ai',
  'baichuan-inc',
  'facebook',
  'google-bert',
  'sentence-transformers',
  'mixedbread-ai',
  'baai',
  'intfloat',
  'skywork',
  'reka-ai',
  'pleias',
  'jetbrains',
  'menlo',
  'tencent-hunyuan',
  'opengvlab',
]);

/** A trending repo must have real pulls behind it; below this it is noise
 *  riding a name. The newest axis is exempt (nothing is downloaded yet). */
const MIN_TRENDING_DOWNLOADS = 100;
/** Below this a GGUF is a toy or a test upload, not a model. */
const MIN_GB = 0.3;

/** HF license tags that map to an allow-list id under a different spelling.
 *  Everything else goes through `resolveLicense` by tag (case-insensitive), so
 *  apache-2.0, mit, bsd-3-clause, gemma, cc-by-4.0 resolve on their own. */
const LICENSE_ALIASES: Record<string, string> = {
  'llama3.1': 'Llama-3.1-Community',
  'llama3.2': 'Llama-3.2-Community',
  llama3: 'Llama-3.1-Community',
};

/** Phones carry a discovered model only under this size. */
const PHONE_MAX_GB = 2.5;
/** The ceiling on a discovered model, raised to carry the flagship local
 *  models a "best local LLM" list ranks (a 70B at Q4 is ~40GB, a 120B MoE
 *  ~65GB). The store never hides one for being large: the machine
 *  recommendation and the iCloud home carry the "you need a big box" story.
 *  The cap only keeps out the 300GB+ frontier dumps no local box runs. */
const DESKTOP_MAX_GB = 200;

/** How many discovered models the catalog carries. Broadened (CTO-approved
 *  ceiling) so the store reflects the fast-moving local-model landscape;
 *  the app renders the list incrementally so a few hundred stays smooth. */
export const DEFAULT_CAP = 250;
export const DEFAULT_PER_AXIS = 120;
/** Recent uploads read per trusted publisher. */
export const PER_PUBLISHER = 20;
/** Metadata reads per build, across every axis. Safe at this level because the
 *  detail reads now run through a bounded concurrency pool (DETAIL_LANES). */
export const MAX_DETAIL_READS = 400;
/** At most this many repo-detail requests in flight at once. Mirrors the seed
 *  popularity pool (sources.ts MAX_IN_FLIGHT) so a large crawl stays under the
 *  Hugging Face rate limit instead of firing hundreds of requests at once. */
export const DETAIL_LANES = 6;
/** How many listing pages to follow per axis, so the crawl reaches past the
 *  first page without an unbounded walk. */
export const MAX_LIST_PAGES = 3;

export async function discoverModels(
  client: DiscoveryClient,
  options: DiscoverOptions,
): Promise<DiscoverResult> {
  const cap = options.cap ?? DEFAULT_CAP;
  const perAxis = options.perAxis ?? DEFAULT_PER_AXIS;
  const reserved = options.reserved ?? new Set<string>();
  const skipped: DiscoverResult['skipped'] = [];

  // Two axes, both limited to trusted publishers: the second live crop showed
  // that open trending is mostly community merges riding a lab's name, and
  // a storefront that says "new" should mean a lab or a known quantizer
  // shipped it. Trending additionally needs real pulls. Shelf order: trusted
  // trending first (what people actually run this week), then trusted new
  // drops. Every unlisted publisher is logged, so the list can grow on
  // evidence: promote a publisher by adding it to TRUSTED_PUBLISHERS.
  const seen = new Set<string>();
  const trending: DiscoveredRepo[] = [];
  const newest: DiscoveredRepo[] = [];
  for (const axis of ['trendingScore', 'createdAt'] as const) {
    let repos: DiscoveredRepo[] = [];
    try {
      repos = await client.list(axis, perAxis);
    } catch (err) {
      console.warn(`discovery: ${axis} listing failed: ${String(err)}`);
    }
    for (const r of repos) {
      if (!r?.id || seen.has(r.id)) continue;
      seen.add(r.id);
      if (!isTrusted(r.id)) {
        skipped.push({ repo: r.id, reason: 'unlisted publisher (see TRUSTED_PUBLISHERS)' });
      } else if (axis === 'trendingScore' && (r.downloads ?? 0) < MIN_TRENDING_DOWNLOADS) {
        skipped.push({ repo: r.id, reason: `under ${MIN_TRENDING_DOWNLOADS} downloads` });
      } else {
        (axis === 'trendingScore' ? trending : newest).push(r);
      }
    }
  }
  // Third axis, and the one that actually fills the shelf: each trusted
  // publisher's own most recent uploads. The global GGUF listings are
  // dominated by community re-uploads (the third live crop found six trusted
  // repos in eighty listings), so the labs' and quantizers' drops are read
  // straight from their pages. Round-robin across publishers, so one prolific
  // quantizer cannot eat the cap.
  const perPublisher: DiscoveredRepo[][] = [];
  for (const author of TRUSTED_PUBLISHERS) {
    let repos: DiscoveredRepo[] = [];
    try {
      repos = await client.listByAuthor(author, PER_PUBLISHER);
    } catch (err) {
      console.warn(`discovery: ${author} listing failed: ${String(err)}`);
    }
    const mine = repos.filter((r) => r?.id && !seen.has(r.id));
    for (const r of mine) seen.add(r.id);
    if (mine.length) perPublisher.push(mine);
  }
  const publisherRecent: DiscoveredRepo[] = [];
  for (let i = 0; perPublisher.some((list) => i < list.length); i++) {
    for (const list of perPublisher) if (i < list.length) publisherRecent.push(list[i]!);
  }
  const listed = [...trending, ...newest, ...publisherRecent];

  const previousByRepo = new Map<string, CatalogModel>();
  for (const m of options.previous ?? []) {
    if (m.discovery) previousByRepo.set(m.discovery.repo, m);
  }

  // Everything that needs no detail read is rejected first (private, gated, a
  // denylisted name, a quantizer upload of an unknown family), in shelf order,
  // up to the read budget. Detail reads then run concurrently over what remains
  // and the entries are built back in shelf order, so parallel I/O never
  // changes which upload wins a collision.
  const toRead: DiscoveredRepo[] = [];
  for (const repo of listed) {
    if (toRead.length >= MAX_DETAIL_READS) {
      skipped.push({ repo: repo.id, reason: 'detail-read budget spent this build' });
      continue;
    }
    const cheap = cheapReject(repo);
    if (cheap) {
      skipped.push({ repo: repo.id, reason: cheap });
      continue;
    }
    toRead.push(repo);
  }

  // Bounded concurrency: at most DETAIL_LANES reads in flight, mirroring the
  // seed popularity pool. A large crawl stays under the Hugging Face rate limit
  // instead of firing one request per candidate at once.
  const details = new Array<RepoDetail | undefined>(toRead.length);
  {
    let next = 0;
    const lane = async (): Promise<void> => {
      for (;;) {
        const i = next++;
        if (i >= toRead.length) return;
        details[i] = await client.detail(toRead[i]!.id);
      }
    };
    const lanes = Math.min(DETAIL_LANES, toRead.length);
    await Promise.all(Array.from({ length: lanes }, () => lane()));
  }

  // One entry per underlying model: the same weights show up from several
  // quantizers and as imatrix ("i1") twins. First in shelf order wins, and a
  // repo whose detail could not be read does NOT reserve its base, so a sibling
  // upload of the same model still gets its turn.
  const bases = new Set<string>();
  const fresh: CatalogModel[] = [];
  for (let i = 0; i < toRead.length; i++) {
    if (fresh.length >= cap) break;
    const repo = toRead[i]!;
    const detail = details[i];
    if (!detail) {
      skipped.push({ repo: repo.id, reason: 'detail unreadable' });
      continue;
    }
    const base = baseKey(repo.id);
    if (bases.has(base)) {
      skipped.push({ repo: repo.id, reason: `duplicate of an earlier upload (${base})` });
      continue;
    }
    const built = entryFrom(repo, detail, {
      today: options.today,
      previous: previousByRepo.get(repo.id),
    });
    if ('skip' in built) {
      skipped.push({ repo: repo.id, reason: built.skip });
      continue;
    }
    if (reserved.has(built.model.id)) {
      skipped.push({ repo: repo.id, reason: 'id already in the editorial seed' });
      continue;
    }
    bases.add(base);
    fresh.push(built.model);
  }

  // Carry forward last time's discoveries that did not reappear, newest
  // sighting first, until the cap. A model ages out only when pushed off by
  // newer ones, so the shelf reassesses without ever collapsing.
  // A carried model must still clear today's bar (the denylist, the size
  // floor, one per underlying model), so tightening the bar cleans the shelf
  // on the next build instead of preserving yesterday's mistakes.
  const have = new Set(fresh.map((m) => m.id));
  const carried: CatalogModel[] = [];
  const candidates = [...previousByRepo.values()]
    .filter((m) => !have.has(m.id) && !reserved.has(m.id))
    .sort((a, b) => (b.discovery?.foundAt ?? '').localeCompare(a.discovery?.foundAt ?? ''));
  for (const m of candidates) {
    const repoId = m.discovery!.repo;
    const reason =
      (isTrusted(repoId) ? undefined : 'unlisted publisher (see TRUSTED_PUBLISHERS)') ??
      cheapReject({ id: repoId }) ??
      (m.sizeGB < MIN_GB ? `too small to be a model (${m.sizeGB} GB)` : undefined) ??
      (bases.has(baseKey(repoId))
        ? `duplicate of an earlier upload (${baseKey(repoId)})`
        : undefined);
    if (reason) {
      skipped.push({ repo: repoId, reason: `carried entry dropped: ${reason}` });
      continue;
    }
    bases.add(baseKey(repoId));
    carried.push(m);
  }
  const models = [...fresh, ...carried].slice(0, cap);

  // Ranks after every seed model, in shelf order, so the default sort keeps
  // the curated roster first and the discoveries as the long tail.
  return {
    models: models.map((m, i) => ({ ...m, curation: { ...m.curation, rank: 1000 + i } })),
    skipped,
  };
}

/** Rejections that need no detail read. */
function cheapReject(repo: DiscoveredRepo): string | undefined {
  if (repo.private) return 'private';
  if (repo.gated) return 'gated (needs a license click)';
  const lower = repo.id.toLowerCase();
  if (!lower.includes('/')) return 'no org';
  for (const word of NAME_DENYLIST) {
    if (lower.includes(word)) return `name contains "${word}"`;
  }
  const [org, name = ''] = lower.split('/');
  if (QUANTIZERS.has(org!) && !LAB_FAMILY.test(name)) {
    return 'quantizer upload of a model family the storefront does not know';
  }
  return undefined;
}

type EntryOutcome = { model: CatalogModel } | { skip: string };

/** Build one catalog entry from a repo's metadata, or say why not. */
export function entryFrom(
  repo: DiscoveredRepo,
  detail: RepoDetail,
  ctx: { today: string; previous?: CatalogModel },
): EntryOutcome {
  if (detail.private) return { skip: 'private' };
  if (detail.gated) return { skip: 'gated (needs a license click)' };

  const licenseTag = licenseTagOf(repo, detail);
  if (!licenseTag) return { skip: 'no license tag' };
  const licenseRow = resolveLicense(LICENSE_ALIASES[licenseTag] ?? licenseTag);
  if (!licenseRow) return { skip: `license "${licenseTag}" is not on the allow-list` };

  const weights = pickWeights(detail.siblings ?? []);
  if (!weights)
    return { skip: 'no single-file GGUF or complete shard set at a supported quantization' };
  if (!weights.sizeBytes) return { skip: 'file size unknown' };
  const sizeGB = Math.round((weights.sizeBytes / 1e9) * 10) / 10;
  if (sizeGB < MIN_GB) return { skip: `too small to be a model (${sizeGB} GB)` };
  if (sizeGB > DESKTOP_MAX_GB) return { skip: `too big for a desktop (${sizeGB} GB)` };

  const categories = classify(repo.id, [...(repo.tags ?? []), ...(detail.tags ?? [])], sizeGB);
  const id = slugId(repo.id);
  const name = displayName(repo.id);
  const quantization = weights.quant;

  const model: CatalogModel = {
    id,
    name,
    tagline: 'New on Hugging Face. Trending, not yet rated by OpenShore.',
    categories,
    // Never an orchestrator until the eval harness has seen it. Use it as a
    // specialist, or run it through install-by-name knowingly.
    orchestratorCapable: false,
    source: {
      kind: 'ollama',
      ref: `hf.co/${repo.id}:${quantization}`,
      pullCommand: `ollama pull hf.co/${repo.id}:${quantization}`,
      popularityRef: repo.id,
    },
    sizeGB,
    quantization,
    // The context window is not readable from the listing, so publish a
    // conservative floor rather than a guess. The note says so.
    contextTokens: 8192,
    license: { id: licenseRow.id, name: licenseRow.name, url: licenseRow.url },
    curation: {
      rank: 1000,
      note: 'Found by live discovery. Unrated; context window shown as a conservative floor.',
    },
    blessed: false,
    discovery: {
      source: 'huggingface',
      repo: repo.id,
      foundAt: ctx.previous?.discovery?.foundAt ?? ctx.today,
    },
    // A phone entry needs a single downloadable file: a sharded model is
    // desktop-only (the Ollama hf.co ref pulls the whole set), and is also far
    // over the phone size ceiling anyway.
    ...(!weights.sharded && weights.rfilename && sizeGB <= PHONE_MAX_GB
      ? {
          onDevice: {
            url: `https://huggingface.co/${repo.id}/resolve/main/${weights.rfilename}`,
            sizeGB,
            minRamGB: Math.max(3, Math.ceil(sizeGB * 2 + 1)),
          },
        }
      : {}),
  };
  return { model };
}

function licenseTagOf(repo: DiscoveredRepo, detail: RepoDetail): string | undefined {
  const card = detail.cardData?.license;
  const fromCard = Array.isArray(card) ? card[0] : card;
  if (fromCard && typeof fromCard === 'string') return fromCard.trim().toLowerCase();
  for (const tag of [...(detail.tags ?? []), ...(repo.tags ?? [])]) {
    if (tag.startsWith('license:')) return tag.slice('license:'.length).trim().toLowerCase();
  }
  return undefined;
}

/** The best single-file GGUF by quant preference. Sharded files
 *  ("-00001-of-00003.gguf") and multimodal projectors ("mmproj") are skipped. */
export function pickGguf(files: RepoFile[]): (RepoFile & { quant: string }) | undefined {
  for (const quant of QUANT_PREFERENCE) {
    const re = new RegExp(`[-_.]${quant}\\.gguf$`, 'i');
    const hit = files.find(
      (f) =>
        re.test(f.rfilename) &&
        !/-\d{4,5}-of-\d{4,5}\.gguf$/i.test(f.rfilename) &&
        !/mmproj/i.test(f.rfilename) &&
        !f.rfilename.includes('/'),
    );
    if (hit) return { ...hit, quant };
  }
  return undefined;
}

/** The weights the storefront will pull: a single-file GGUF first (which a
 *  small model can carry on a phone), else a complete multi-part shard set at a
 *  preferred quant (desktop only, pulled whole by the Ollama hf.co ref). This
 *  is what lets the flagship 40 to 70GB models onto the store, since their quants
 *  ship as shard sets that pickGguf alone rejects. `rfilename` is the single
 *  file, or the first shard, and is used only for a phone download URL. */
export interface WeightsPick {
  quant: string;
  sizeBytes: number;
  rfilename?: string;
  sharded: boolean;
}

export function pickWeights(files: RepoFile[]): WeightsPick | undefined {
  const single = pickGguf(files);
  if (single?.size) {
    return {
      quant: single.quant,
      sizeBytes: single.size,
      rfilename: single.rfilename,
      sharded: false,
    };
  }
  for (const quant of QUANT_PREFERENCE) {
    const set = shardSet(files, quant);
    if (set) return { quant, sizeBytes: set.total, rfilename: set.first, sharded: true };
  }
  return undefined;
}

/** A complete shard set at one quant, summed. Undefined unless every part from
 *  one of N is present with a known size, so a half-uploaded set never becomes
 *  an entry with a wrong (too-small) size. */
export function shardSet(
  files: RepoFile[],
  quant: string,
): { total: number; first: string } | undefined {
  const re = new RegExp(`[-_.]${quant}[-_.]0*(\\d+)-of-0*(\\d+)\\.gguf$`, 'i');
  const parts = new Map<number, { size?: number; name: string }>();
  let expected = 0;
  for (const f of files) {
    if (/mmproj/i.test(f.rfilename) || f.rfilename.includes('/')) continue;
    const m = re.exec(f.rfilename);
    if (!m) continue;
    const idx = Number(m[1]);
    const tot = Number(m[2]);
    if (!expected) expected = tot;
    if (tot !== expected) continue; // a different set at the same quant; ignore
    parts.set(idx, { size: f.size, name: f.rfilename });
  }
  if (!expected || parts.size !== expected) return undefined;
  let total = 0;
  let first: string | undefined;
  for (let i = 1; i <= expected; i++) {
    const p = parts.get(i);
    if (!p?.size) return undefined; // a missing part or an unknown size
    total += p.size;
    if (i === 1) first = p.name;
  }
  if (!first) return undefined;
  return { total, first };
}

/** A heuristic capability read from the name and tags. Categories are what the
 *  router and the presets key on, so a wrong guess costs a mis-shelving, never
 *  a fabricated star. */
export function classify(repoId: string, tags: string[], sizeGB: number): CapabilityCategory[] {
  const text = `${repoId} ${tags.join(' ')}`.toLowerCase();
  const out: CapabilityCategory[] = [];
  if (/embed|bge|e5-|gte-|minilm/.test(text)) return ['embedding'];
  if (
    /coder|codestral|devstral|starcoder|codegemma|deepseek-coder|-code-|codellama|granite-code|code-instruct/.test(
      text,
    )
  ) {
    out.push('coding');
  }
  if (/llava|vision|-vl-|-vl\b|minicpm-v|moondream|pixtral|image-text-to-text/.test(text)) {
    out.push('vision');
  }
  if (/r1|reasoning|think|qwq|-o1|deepthink/.test(text)) out.push('analysis');
  if (sizeGB <= 2) out.push('fast');
  if (!out.length || (!out.includes('coding') && !out.includes('vision'))) {
    out.unshift('reasoning');
  }
  return [...new Set(out)];
}

/** A stable id from the repo: "bartowski/Qwen3-8B-GGUF" becomes
 *  "hf-bartowski-qwen3-8b". Prefixed so it never collides with a seed id. */
export function slugId(repoId: string): string {
  const stripped = repoId.replace(/[-_.]?gguf$/i, '');
  return `hf-${stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')}`;
}

export function isTrusted(repoId: string): boolean {
  return TRUSTED_PUBLISHERS.has((repoId.split('/')[0] ?? '').toLowerCase());
}

/** The underlying model behind an upload: the name without the org, the GGUF
 *  suffix, imatrix markers, and quant suffixes, so "bartowski/X-GGUF",
 *  "mradermacher/X-i1-GGUF" and "unsloth/X-GGUF" all collapse to "x". */
export function baseKey(repoId: string): string {
  const name = (repoId.split('/')[1] ?? repoId).toLowerCase();
  return (
    name
      .replace(/[-_.]?gguf(?=[-_.]|$)/gi, '')
      .replace(/[-_.](i1|imatrix|instruct|it|chat)$/g, '')
      .replace(/[-_.](i1|imatrix)(?=[-_.]|$)/g, '')
      .replace(/[-_.]q\d[a-z0-9_]*$/i, '')
      // A trailing four-digit date stamp (Magistral-Small-2506, -2507, -2509)
      // marks a version of the same model; the newest sighting keeps the slot.
      .replace(/[-_.]\d{4}$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  );
}

function displayName(repoId: string): string {
  const base = repoId.split('/')[1] ?? repoId;
  return base
    .replace(/[-_.]?gguf$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

/** The `rel="next"` URL from an HTTP Link header, or undefined. Hugging Face
 *  paginates the models listing this way. A relative URL is resolved against
 *  the API base. Exported for the unit test. */
export function nextLink(header: string | null, base: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(part.trim());
    if (m?.[1]) {
      try {
        return new URL(m[1], base).toString();
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** The live client. Metadata only, public repos only; HF_TOKEN lifts the
 *  anonymous rate limit when present. Every failure degrades to "nothing
 *  found" so discovery can never fail the build. */
export class HuggingFaceDiscovery implements DiscoveryClient {
  constructor(private readonly base = 'https://huggingface.co') {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json' };
    const token = process.env.HF_TOKEN?.trim();
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  private static readonly EXPAND =
    '&expand[]=gated&expand[]=private&expand[]=tags&expand[]=downloads&expand[]=likes&expand[]=createdAt';

  /** Follow Hugging Face's `Link: rel="next"` pagination up to MAX_LIST_PAGES,
   *  concatenating the arrays, so one listing axis reaches past the first page
   *  without an unbounded walk. Any failure degrades to what was gathered so
   *  far (or nothing), so discovery never fails the build. */
  private async fetchPaged(firstUrl: string): Promise<DiscoveredRepo[]> {
    const out: DiscoveredRepo[] = [];
    let url: string | undefined = firstUrl;
    for (let page = 0; url && page < MAX_LIST_PAGES; page++) {
      let res: Response;
      try {
        res = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(10000) });
      } catch {
        break;
      }
      if (!res.ok) break;
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        break;
      }
      if (!Array.isArray(body) || body.length === 0) break;
      out.push(...(body as DiscoveredRepo[]));
      url = nextLink(res.headers.get('link'), this.base);
    }
    return out;
  }

  async list(sort: 'trendingScore' | 'createdAt', limit: number): Promise<DiscoveredRepo[]> {
    return this.fetchPaged(
      `${this.base}/api/models?filter=gguf&sort=${sort}&direction=-1&limit=${limit}${HuggingFaceDiscovery.EXPAND}`,
    );
  }

  async listByAuthor(author: string, limit: number): Promise<DiscoveredRepo[]> {
    return this.fetchPaged(
      `${this.base}/api/models?author=${encodeURIComponent(author)}&filter=gguf` +
        `&sort=lastModified&direction=-1&limit=${limit}${HuggingFaceDiscovery.EXPAND}`,
    );
  }

  async detail(repoId: string): Promise<RepoDetail | undefined> {
    const path = repoId.split('/').map(encodeURIComponent).join('/');
    // blobs=true adds file sizes to the sibling list; still metadata only.
    const url = `${this.base}/api/models/${path}?blobs=true`;
    try {
      const res = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(10000) });
      if (!res.ok) return undefined;
      return (await res.json()) as RepoDetail;
    } catch {
      return undefined;
    }
  }
}
