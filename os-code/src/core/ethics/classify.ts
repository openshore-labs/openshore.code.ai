// Tier classification. This file is where every decision is made, and it is
// meant to be read top to bottom by a reviewer who wants to check the layer
// against its specification.
//
// THE THREE TIERS
//
//   Tier 1  Hard block, no exceptions, no consent override.
//           Child sexual abuse material. Non-consensual intimate imagery of a
//           real, identifiable person. Concrete weapons uplift (biological,
//           chemical, nuclear, high-yield explosive).
//
//   Tier 2  Blocked unless the person affirmatively asserts authorization for
//           the specific named subject.
//           Cloning the face or voice of a real, identifiable person.
//
//   Tier 3  Not blocked. Legal adult content, dark and violent fiction, horror,
//           edgy humor, satire and political parody, security research and
//           red teaming, and controversial or dissenting opinion.
//
// THE BIAS
//
// Over-blocking Tier 3 is a defect of the same severity as under-blocking a
// real harm. When a request is ambiguous, the least restrictive reading wins,
// with exactly two exceptions: it targets a real identifiable person sexually,
// or it seeks concrete weapons uplift. Those two are the bright lines. Almost
// everything else is Tier 3, and the layer stays out of the way.

import {
  detectSignals,
  has,
  near,
  signalNames,
  type SignalHit,
  type SignalName,
} from './signals.js';

export type EthicsTier = 1 | 2 | 3;

export type EthicsCategory =
  /** Tier 1. */
  | 'csam'
  | 'ncii'
  | 'weapons-uplift'
  /** Tier 2. */
  | 'likeness'
  /** Tier 3: nothing to do. */
  | 'permitted'
  /** A check could not complete. Blocked, but not a violation by the person. */
  | 'check-failed';

export type EthicsAction = 'allow' | 'block';

/** A recorded authorization assertion for one subject. */
export interface ConsentAssertion {
  /** The subject as the person named them, normalized for comparison. */
  subject: string;
  /** ISO timestamp of the assertion. */
  assertedAt: string;
}

export interface ClassifyContext {
  /** Consent assertions already on file for this account. */
  consents?: ConsentAssertion[];
  /** Which side of the exchange this text is. Output is screened too. */
  side: 'input' | 'output';
}

export interface EthicsDecision {
  action: EthicsAction;
  tier: EthicsTier;
  category: EthicsCategory;
  /** Why, in one line, for the audit record. Never contains the content. */
  reason: string;
  /** The short, neutral refusal shown to the person. Absent when allowed. */
  message?: string;
  /** The evidence, as signal names only. Never the matched text. */
  signals: SignalName[];
  /** Tier 2: the subject the request names, when one could be identified. */
  subject?: string;
  /**
   * Tier 2 allowed by an assertion: any media this produces must carry
   * provenance metadata. The assertion is an accountability record, not proof,
   * so the label travels with the output.
   */
  requiresProvenance?: boolean;
}

/**
 * An intent check for the cases deterministic rules cannot settle alone. It
 * receives the text and the evidence, and answers whether the candidate
 * category is what the request actually seeks.
 *
 * The layer ships with a local implementation (localIntentCheck below), so the
 * normal path needs no network and no model. A host may install a stronger one.
 * Whatever is installed, a throw or a timeout BLOCKS the request: see
 * chokepoint.ts, which owns the fail-closed behavior.
 */
export type IntentCheck = (input: {
  text: string;
  candidate: EthicsCategory;
  signals: SignalName[];
}) => Promise<{ confirmed: boolean; reason: string }>;

// ---------------------------------------------------------------------------
// Refusal copy. Short, plain, neutral. No sermon, no lecture, no alternative
// suggestions that read as a moral aside.
// ---------------------------------------------------------------------------

export const REFUSALS: Record<Exclude<EthicsCategory, 'permitted'>, string> = {
  csam: 'I will not help with sexual content involving minors. That limit does not move.',
  ncii: 'I will not help make sexual or nude imagery of a real, identifiable person.',
  'weapons-uplift':
    'I will not help with making or deploying weapons meant to cause mass casualties.',
  likeness:
    "Recreating a real person's face or voice needs your authorization for that specific person first. Say who the subject is and that you are authorized, or that it is you.",
  'check-failed':
    'The safety checks could not finish, so nothing was sent to the model. Try that again.',
};

/** The tier a category belongs to. */
export function tierOf(category: EthicsCategory): EthicsTier {
  switch (category) {
    case 'csam':
    case 'ncii':
    case 'weapons-uplift':
      return 1;
    case 'likeness':
      return 2;
    case 'check-failed':
      // Not a person's violation. Treated as tier 1 for blocking, never for
      // enforcement (see enforcement.ts, which ignores this category).
      return 1;
    case 'permitted':
      return 3;
  }
}

// ---------------------------------------------------------------------------
// The rule pass
// ---------------------------------------------------------------------------

export type RuleVerdict =
  | {
      kind: 'block';
      category: Exclude<EthicsCategory, 'permitted' | 'check-failed'>;
      reason: string;
      subject?: string;
    }
  | { kind: 'consent-required'; category: 'likeness'; reason: string; subject?: string }
  | {
      kind: 'candidate';
      category: Exclude<EthicsCategory, 'permitted' | 'check-failed'>;
      reason: string;
    }
  | { kind: 'permitted' };

/**
 * Tier 1a: sexual content involving a minor.
 *
 * Requires a sexual term AND a minor indicator within the same neighborhood. A
 * horror story about a teenager is not this. A sexual story about adults is not
 * this. An explicit adult age stated next to the sexual term is evidence the
 * subject is an adult, and it clears the minor reading unless a minor word is
 * also right there.
 */
function checkCsam(hits: SignalHit[]): RuleVerdict | undefined {
  const sexualAndMinor = near(hits, 'sexual', 'minor') || near(hits, 'sexual', 'ageUnder18');
  if (!sexualAndMinor) return undefined;
  // A stated adult age with no minor word nearby: the subject is an adult, and
  // this is Tier 3 adult content. Only "ageUnder18" plus sexual survives here.
  if (has(hits, 'age18Plus') && !has(hits, 'minor') && !has(hits, 'ageUnder18')) {
    return undefined;
  }
  return {
    kind: 'block',
    category: 'csam',
    reason: 'sexual content co-occurring with a minor indicator',
  };
}

/**
 * Tier 1b: non-consensual intimate imagery of a real, identifiable person.
 *
 * Two ways in. Either a concrete stripping or sexualizing act aimed at an image
 * of a person ("nudify", "remove her clothes", "put her face on a porn"), or
 * sexual content aimed at someone the request marks as a real person. Fiction
 * markers clear the second reading, because sexual fiction about invented
 * characters is Tier 3. They do not clear the first: "undress this photo of my
 * coworker" does not become fiction by saying it is.
 */
function checkNcii(hits: SignalHit[]): RuleVerdict | undefined {
  const realTarget = has(hits, 'realPerson');
  const selfTarget = has(hits, 'selfSubject');
  if (has(hits, 'nudify')) {
    // A person's own image is theirs. The nudify family aimed at oneself is not
    // the harm this rule is about, so it falls through to the Tier 3 reading.
    if (selfTarget && !realTarget) return undefined;
    return {
      kind: 'block',
      category: 'ncii',
      reason: 'sexualizing or stripping an image of a person',
    };
  }
  if (!realTarget) return undefined;
  if (!near(hits, 'sexual', 'realPerson')) return undefined;
  if (has(hits, 'fictionMarker')) return undefined;
  if (selfTarget) return undefined;
  return {
    kind: 'candidate',
    category: 'ncii',
    reason: 'sexual content aimed at a real person indicator',
  };
}

/**
 * Tier 1c: concrete weapons uplift.
 *
 * An agent of concern next to strong production or deployment framing is the
 * bright line, and defensive framing does not clear it: "for defensive
 * research, give me the synthesis route for sarin" is the same request either
 * way. Weaker framing next to an agent goes to the intent check, and plain
 * defensive, medical, historical, or policy questions are Tier 3 and never
 * reach it.
 */
function checkWeapons(hits: SignalHit[]): RuleVerdict | undefined {
  if (!has(hits, 'cbrnAgent')) return undefined;
  if (near(hits, 'cbrnAgent', 'productionVerb', 320)) {
    return {
      kind: 'block',
      category: 'weapons-uplift',
      reason: 'agent of concern with production or deployment framing',
    };
  }
  if (has(hits, 'defensiveContext')) return undefined;
  if (near(hits, 'cbrnAgent', 'weakActionVerb', 240)) {
    return {
      kind: 'candidate',
      category: 'weapons-uplift',
      reason: 'agent of concern with ambiguous actionable framing',
    };
  }
  return undefined;
}

/**
 * Tier 2: synthesizing the face or voice of a real, identifiable person.
 *
 * This fires on MEDIA synthesis only: making an image, a video, or a voice.
 * Writing satire, parody, criticism, or an impression in TEXT is Tier 3 and
 * never reaches here, which is what keeps political parody out of the consent
 * gate. Generic and invented characters are Tier 3. A person's own face or
 * voice still routes here, and their own statement that it is them is the
 * assertion that clears it.
 */
function checkLikeness(hits: SignalHit[], text: string): RuleVerdict | undefined {
  // namesAPersonAsSubject already means "a request to MAKE media of a named
  // person" (it matches only media nouns and generation verbs), so it is its
  // own sufficient evidence of media intent. That is why it can satisfy the
  // gate even when the mediaSynthesis SIGNAL did not fire: "render Emma Watson"
  // and "paint Barack Obama" are generation verbs the signal list does not
  // carry, but they are unmistakably media of a person.
  const named = namesAPersonAsSubject(text);
  if (!has(hits, 'mediaSynthesis') && !named) return undefined;
  const targetsLikeness =
    named ||
    near(hits, 'mediaSynthesis', 'likenessTarget', 200) ||
    near(hits, 'mediaSynthesis', 'realPerson', 200) ||
    near(hits, 'mediaSynthesis', 'selfSubject', 200);
  if (!targetsLikeness) return undefined;
  const identifiable = has(hits, 'realPerson') || has(hits, 'selfSubject') || named;
  if (!identifiable) return undefined;
  // An invented character with no real-person marker is Tier 3.
  if (has(hits, 'fictionMarker') && !has(hits, 'realPerson') && !has(hits, 'selfSubject')) {
    return undefined;
  }
  return {
    kind: 'consent-required',
    category: 'likeness',
    reason: 'synthesis of the face or voice of a real, identifiable person',
    subject: extractSubject(text, hits),
  };
}

/** Run every rule. First block wins; a consent gate outranks a candidate. */
export function classifyRules(text: string, hits: SignalHit[]): RuleVerdict {
  const blocks = [checkCsam(hits), checkNcii(hits), checkWeapons(hits)].filter(
    (v): v is RuleVerdict => Boolean(v),
  );
  const hardBlock = blocks.find((v) => v.kind === 'block');
  if (hardBlock) return hardBlock;
  const likeness = checkLikeness(hits, text);
  if (likeness) return likeness;
  const candidate = blocks.find((v) => v.kind === 'candidate');
  if (candidate) return candidate;
  return { kind: 'permitted' };
}

// ---------------------------------------------------------------------------
// Subjects and consent
// ---------------------------------------------------------------------------

// Words that mark a proper noun as a place, an organization, or a product
// rather than a person. "An image of Times Square" is Tier 3; "an image of
// Emma Watson" is a likeness. There is no structural difference between the two
// name shapes, so this list is what separates them, and it is why the check
// below asks for a full name rather than firing on any capitalized word (which
// would swallow Paris, Tokyo, and every other one-word place).
const NON_PERSON_NAME_WORDS = new Set(
  [
    'mount',
    'lake',
    'fort',
    'san',
    'santa',
    'los',
    'las',
    'new',
    'north',
    'south',
    'east',
    'west',
    'saint',
    'st',
    'cape',
    'port',
    'grand',
    'upper',
    'lower',
    'city',
    'town',
    'street',
    'avenue',
    'road',
    'park',
    'bridge',
    'tower',
    'square',
    'island',
    'islands',
    'beach',
    'valley',
    'canyon',
    'county',
    'state',
    'states',
    'university',
    'college',
    'hospital',
    'airport',
    'station',
    'museum',
    'library',
    'center',
    'centre',
    'stadium',
    'arena',
    'hall',
    'church',
    'cathedral',
    'castle',
    'palace',
    'inc',
    'llc',
    'ltd',
    'corp',
    'company',
    'studios',
    'games',
    'motors',
    'airlines',
    'bank',
    'sea',
    'ocean',
    'river',
    'falls',
    'springs',
    'heights',
    'gardens',
    'plaza',
    'mall',
    'market',
    'theater',
    'theatre',
    'institute',
    'academy',
    'school',
    'union',
    'republic',
    'kingdom',
    'empire',
    'forest',
    'desert',
    'coast',
    'bay',
    'hill',
    'hills',
    'ridge',
    'peak',
    'village',
    'district',
    'province',
    'county',
    // Software, infrastructure, and product vocabulary. In a coding tool
    // "image of X" is overwhelmingly a container or OS image, not a portrait,
    // so a capitalized name carrying any of these is not a person (M1). The
    // list is deliberately broad; a false "not a person" on a genuine surname
    // that happens to be a tech word is recoverable (the person names the
    // subject and asserts consent), while the reverse blocks a developer's
    // ordinary work.
    'linux',
    'ubuntu',
    'debian',
    'fedora',
    'centos',
    'rhel',
    'alpine',
    'arch',
    'mint',
    'suse',
    'kali',
    'bookworm',
    'bullseye',
    'buster',
    'jammy',
    'focal',
    'noble',
    'windows',
    'macos',
    'android',
    'ios',
    'server',
    'client',
    'node',
    'deno',
    'bun',
    'python',
    'ruby',
    'rust',
    'golang',
    'java',
    'kotlin',
    'scala',
    'php',
    'perl',
    'docker',
    'kubernetes',
    'podman',
    'helm',
    'terraform',
    'ansible',
    'postgres',
    'postgresql',
    'mysql',
    'mariadb',
    'sqlite',
    'redis',
    'mongo',
    'mongodb',
    'cassandra',
    'sql',
    'nginx',
    'apache',
    'caddy',
    'traefik',
    'kafka',
    'rabbitmq',
    'elasticsearch',
    'grafana',
    'prometheus',
    'jenkins',
    'gitlab',
    'github',
    'bitbucket',
    'react',
    'angular',
    'vue',
    'svelte',
    'next',
    'nuxt',
    'vite',
    'webpack',
    'chrome',
    'chromium',
    'firefox',
    'safari',
    'edge',
    'webkit',
    'image',
    'images',
    'api',
    'sdk',
    'cli',
    'gui',
    'db',
    'database',
    'cluster',
    'container',
    'containers',
    'runtime',
    'kernel',
    'distro',
    'os',
    'vm',
    'daemon',
    'service',
    'services',
    'endpoint',
    'gateway',
    'proxy',
    'cache',
    'queue',
    'broker',
    'pipeline',
    'workflow',
    'registry',
    'repository',
    'repo',
    'build',
    'deploy',
    'deployment',
    'release',
    'artifact',
    'network',
    'protocol',
    'algorithm',
    'framework',
    'library',
    'module',
    'package',
    'component',
    'interface',
    'schema',
    'model',
    'models',
    'dataset',
    'tensor',
    'machine',
    'learning',
    'intelligence',
    'data',
    'science',
    'analytics',
    'engine',
    'platform',
    'system',
    'systems',
    'software',
    'hardware',
    'firmware',
    'stack',
    'frontend',
    'backend',
    'gpu',
    'cpu',
    'ram',
    'ssd',
    'memory',
    'storage',
    'compute',
    'token',
    'tokens',
    'embedding',
    'transformer',
    'llm',
    'gpt',
    'bert',
    'llama',
    'mistral',
    'qwen',
    'gemma',
    'phi',
    'claude',
  ].map((w) => w.toLowerCase()),
);

// Scene, object, and attribute words. A lowercase two-word candidate made of
// these ("blue mountain", "ocean sunset") is a scene, not a person, so the
// lowercase generation-verb path below never treats it as a likeness.
const SCENE_WORDS = new Set([
  'blue',
  'red',
  'green',
  'yellow',
  'orange',
  'purple',
  'pink',
  'black',
  'white',
  'grey',
  'gray',
  'gold',
  'golden',
  'silver',
  'bronze',
  'dark',
  'light',
  'bright',
  'pale',
  'deep',
  'big',
  'small',
  'tall',
  'short',
  'old',
  'new',
  'young',
  'giant',
  'tiny',
  'ancient',
  'modern',
  'wild',
  'calm',
  'misty',
  'foggy',
  'snowy',
  'sunny',
  'mountain',
  'mountains',
  'hill',
  'valley',
  'forest',
  'jungle',
  'desert',
  'ocean',
  'sea',
  'river',
  'lake',
  'beach',
  'coast',
  'island',
  'sky',
  'cloud',
  'clouds',
  'sunset',
  'sunrise',
  'dawn',
  'dusk',
  'night',
  'day',
  'storm',
  'rain',
  'snow',
  'fire',
  'water',
  'earth',
  'wind',
  'star',
  'stars',
  'moon',
  'sun',
  'galaxy',
  'city',
  'town',
  'street',
  'road',
  'bridge',
  'castle',
  'tower',
  'house',
  'garden',
  'flower',
  'flowers',
  'tree',
  'trees',
  'field',
  'meadow',
  'canyon',
  'waterfall',
  'cat',
  'dog',
  'bird',
  'fox',
  'wolf',
  'bear',
  'lion',
  'tiger',
  'horse',
  'dragon',
  'robot',
  'car',
  'ship',
  'plane',
  'train',
  'rocket',
  'spaceship',
  'landscape',
  'portrait',
  'scene',
  'abstract',
  'pattern',
  'texture',
  'logo',
  'icon',
  'poster',
]);

/** Photorealism cues: a prompt with one of these is asking for a real-looking
 *  image, which is the shape of a deepfake when the subject is a person. */
const PHOTOREAL_CUE =
  /\b(?:photo\s?realistic|photo\s?realism|hyper\s?realistic|photograph|lifelike|8k|4k|dslr|realistic\s+(?:photo|portrait|render)|portrait\s+photo)\b/i;

/** Cues that the subject of a media request is a person. Ambiguous pronouns
 *  that pepper engineering prose ("they", "their") are deliberately absent:
 *  "make sure they run migrations" is not a person cue. */
const PERSON_CUE =
  /\b(?:he|she|him|her|his|hers|man|woman|person|guy|girl|boy|singer|actor|actress|politician|president|senator|governor|mayor|ceo|streamer|influencer|youtuber|celebrity|speaking|talking|saying|singing|smiling|dancing|posing|headshot|selfie|mr|mrs|ms|dr|prof)\b/i;

/** Is a capitalized candidate a software, place, or concept name rather than a
 *  person? True when any of its words is in the not-a-person vocabulary. */
function looksNonPerson(name: string): boolean {
  return name
    .split(/\s+/)
    .some((w) => NON_PERSON_NAME_WORDS.has(w.toLowerCase().replace(/['.-]/g, '')));
}

/**
 * Does this request name a person as the subject of media it wants made?
 *
 * Three shapes are caught. A media noun plus a name ("image of Emma Watson").
 * A generation verb plus a Title Case name ("render Emma Watson"). And an
 * all-lowercase two-word name after a generation verb WHEN the prompt also asks
 * for photorealism ("draw emma watson ... photorealistic, 8k"), which is the
 * deepfake shape and not "draw a blue mountain".
 *
 * A capitalized candidate carrying a software, place, or concept word is never a
 * person, so "image of Ubuntu Server" and "image of Times Square" stay Tier 3.
 * A single capitalized word needs a person cue nearby.
 *
 * Known limit (DECISIONS.md): a lowercase name with no photorealism cue and no
 * other person signal is not caught here. A public-figure gazetteer is out of
 * scope, and guessing would block far more legitimate Tier 3 prompts than it
 * would catch.
 */
function namesAPersonAsSubject(text: string): boolean {
  // Shape 1: a media noun, then of/featuring/as/like, then a Title Case name.
  // The NAME pattern requires a capital first letter per word, so it stops at
  // the first lowercase word ("voice of Barack Obama saying ..." captures only
  // "Barack Obama"). The media-noun first letter is capital-tolerant so a
  // sentence-initial "Photo of ..." still matches.
  const nounRe =
    /\b(?:[Ii]mages?|[Pp]hotos?|[Pp]ictures?|[Pp]ortrait|[Hh]eadshot|[Ss]elfie|[Vv]ideo|[Cc]lip|[Dd]eepfake|[Ff]ootage|[Vv]oice|[Aa]udio|[Rr]ender|[Pp]ainting|[Dd]rawing|[Ll]ikeness)\s+(?:of|featuring|as|like)\s+(?:the\s+)?([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})/g;
  const mediaOf = /\b([A-Za-z]+)\s+(?:of|featuring|as|like)\b/;
  let match: RegExpExecArray | null;
  while ((match = nounRe.exec(text)) !== null) {
    const name = match[1]!;
    if (looksNonPerson(name)) continue;
    const words = name.split(/\s+/);
    // The media word this match hinged on, for the person-only check.
    const media = (mediaOf.exec(match[0]!)?.[1] ?? '').toLowerCase();
    if (/^(portrait|headshot|selfie|deepfake|voice|audio|painting|drawing|likeness)$/.test(media)) {
      return true;
    }
    if (words.length >= 2) return true;
    const around = text.slice(Math.max(0, match.index - 120), match.index + match[0].length + 120);
    if (PERSON_CUE.test(around.replace(name, ' '))) return true;
  }

  // Shape 2: a generation verb directly on a Title Case name ("render Emma
  // Watson", "Paint Barack Obama"). The verb first letter is capital-tolerant so
  // a sentence-initial "Render" matches; the name stays strictly Title Case.
  const verbRe =
    /\b(?:[Dd]raw|[Rr]ender|[Pp]aint|[Ss]ketch|[Dd]epict|[Ii]llustrate|[Ii]magine|[Gg]enerate|[Cc]reate|[Mm]ake)\s+(?:a\s+|an\s+|the\s+)?([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})/g;
  while ((match = verbRe.exec(text)) !== null) {
    const name = match[1]!;
    if (looksNonPerson(name)) continue;
    const words = name.split(/\s+/);
    if (words.length >= 2) return true;
    const around = text.slice(Math.max(0, match.index - 60), match.index + match[0].length + 120);
    if (PERSON_CUE.test(around.replace(name, ' '))) return true;
  }

  // Shape 3: an all-lowercase two-word name after a generation verb or media
  // noun, gated on a photorealism cue and on neither word being a scene word.
  if (PHOTOREAL_CUE.test(text)) {
    const lowerRe =
      /\b(?:draw|render|paint|generate|create|make|depict|photo of|image of|picture of)\s+(?:a\s+|an\s+|the\s+)?([a-z][a-z'-]+\s+[a-z][a-z'-]+)/g;
    while ((match = lowerRe.exec(text)) !== null) {
      const [w1, w2] = match[1]!.split(/\s+/);
      if (!w1 || !w2) continue;
      if (SCENE_WORDS.has(w1) || SCENE_WORDS.has(w2)) continue;
      if (NON_PERSON_NAME_WORDS.has(w1) || NON_PERSON_NAME_WORDS.has(w2)) continue;
      return true;
    }
  }

  // Shape 4: "in the voice of X", "sounds just like X", "impersonate X".
  return /\b(?:in the (?:voice|style of the voice) of|sounds? (?:just )?like|impersonate)\s+(?:the\s+)?[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)+/.test(
    text,
  );
}

/** Normalize a subject for comparison: lowercase, collapsed whitespace. */
export function normalizeSubject(subject: string): string {
  return subject
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:]+$/, '');
}

/**
 * The subject of a likeness request, as best it can be read from the text. A
 * person asking about themselves is the subject "self". Otherwise the first
 * named entity or relation phrase. Undefined when nothing readable is there,
 * in which case the consent gate cannot be satisfied by a generic assertion.
 */
export function extractSubject(text: string, hits?: SignalHit[]): string | undefined {
  const signals = hits ?? detectSignals(text);
  if (has(signals, 'selfSubject')) return 'self';
  const ofName =
    /\b(?:of|as|like|voice of|face of)\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2})\b/.exec(text);
  if (ofName?.[1]) return normalizeSubject(ofName[1]);
  const relation =
    /\b(my\s+(?:ex|wife|husband|partner|girlfriend|boyfriend|friend|coworker|co-worker|colleague|classmate|neighbou?r|boss|teacher|student|roommate))\b/i.exec(
      text,
    );
  if (relation?.[1]) return normalizeSubject(relation[1]);
  const bareName = /\b([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,})\b/.exec(text);
  if (bareName?.[1]) return normalizeSubject(bareName[1]);
  return undefined;
}

/**
 * Does the account hold an authorization assertion covering this subject? An
 * assertion is specific: "self" covers only the person themselves, and a named
 * subject covers only that name. A blanket assertion does not exist.
 */
export function consentCovers(
  consents: ConsentAssertion[] | undefined,
  subject: string | undefined,
): boolean {
  if (!subject || !consents?.length) return false;
  const wanted = normalizeSubject(subject);
  return consents.some((c) => normalizeSubject(c.subject) === wanted);
}

/**
 * Read an authorization assertion out of the person's own words, so asserting
 * consent is one sentence in the chat rather than a settings expedition. The
 * assertion must name the subject or be clearly about themselves.
 */
export function readAssertion(text: string): ConsentAssertion | undefined {
  const selfClaim =
    /\b(?:this is (?:me|my own)|it(?:'s| is) my own|i am the subject|that is my (?:voice|face)|i have the rights to my own)\b/i.test(
      text,
    );
  const authorized =
    /\b(?:i (?:am|'m) authoriz|i am authoris|i have (?:written )?(?:permission|consent|authorization|authorisation|a release|a license|a licence)|they (?:gave|have given) (?:me )?permission|licensed the likeness|i own the rights)\b/i.test(
      text,
    );
  if (!selfClaim && !authorized) return undefined;
  const subject = selfClaim ? 'self' : extractSubject(text);
  if (!subject) return undefined;
  return { subject, assertedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// The local intent check
// ---------------------------------------------------------------------------

/**
 * The shipped intent check. Local, deterministic, no network, no model, so the
 * privacy promise holds for a local-model session: the guardrail never sends
 * the prompt anywhere to decide about it.
 *
 * It resolves the two candidate cases the rules leave open, by weighing the
 * framing evidence that surrounds them.
 */
export const localIntentCheck: IntentCheck = async ({ text, candidate, signals }) => {
  const hits = detectSignals(text);
  if (candidate === 'ncii') {
    // Sexual content plus a real-person marker. Confirm when the request points
    // at an actual image or a specific private individual; clear it when the
    // "real person" reading came from a public role in what is plainly writing
    // about a person rather than imagery of them.
    const pointsAtImage =
      /\b(?:this|the attached|uploaded|from her|from his)\s+\w*\s*(?:photo|picture|image|selfie)\b/i.test(
        text,
      );
    const privateIndividual =
      /\bmy\s+(?:ex|wife|husband|partner|girlfriend|boyfriend|friend|coworker|co-worker|colleague|classmate|neighbou?r|boss|teacher|student|roommate)\b/i.test(
        text,
      );
    const wantsImagery = has(hits, 'mediaSynthesis') || pointsAtImage;
    const confirmed = pointsAtImage || privateIndividual || wantsImagery;
    return {
      confirmed,
      reason: confirmed
        ? 'sexual imagery aimed at a specific real person'
        : 'writing about a public figure without imagery of them',
    };
  }
  if (candidate === 'weapons-uplift') {
    // An agent of concern with soft framing. Confirm when the request asks for
    // an amount, a source, a dose, or a deployment, which is the shape of
    // acquiring or using rather than understanding.
    const operational =
      /\b(?:how much|what (?:quantity|amount|dose)|where (?:can|do) i (?:get|buy|obtain)|lethal dose|ld50|deploy it|use it on|release it in)\b/i.test(
        text,
      );
    const understanding =
      /\b(?:what is|what are|explain|why does|how does .* work|history|mechanism of action|difference between)\b/i.test(
        text,
      );
    const confirmed = operational || (!understanding && signals.includes('weakActionVerb'));
    return {
      confirmed,
      reason: confirmed
        ? 'acquisition or deployment framing around an agent of concern'
        : 'explanatory framing without operational detail',
    };
  }
  return { confirmed: false, reason: 'no candidate to resolve' };
};

// ---------------------------------------------------------------------------
// The permitted decision
// ---------------------------------------------------------------------------

export function permitted(hits: SignalHit[]): EthicsDecision {
  return {
    action: 'allow',
    tier: 3,
    category: 'permitted',
    reason: 'no tier 1 or tier 2 category matched',
    signals: signalNames(hits),
  };
}

export function blockedBy(
  category: Exclude<EthicsCategory, 'permitted'>,
  reason: string,
  hits: SignalHit[],
  subject?: string,
): EthicsDecision {
  return {
    action: 'block',
    tier: tierOf(category),
    category,
    reason,
    message: REFUSALS[category],
    signals: signalNames(hits),
    subject,
  };
}
