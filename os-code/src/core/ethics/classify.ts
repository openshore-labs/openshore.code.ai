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
  if (!has(hits, 'mediaSynthesis')) return undefined;
  const targetsLikeness =
    near(hits, 'mediaSynthesis', 'likenessTarget', 200) ||
    near(hits, 'mediaSynthesis', 'realPerson', 200) ||
    near(hits, 'mediaSynthesis', 'selfSubject', 200) ||
    namesAPersonAsSubject(text);
  if (!targetsLikeness) return undefined;
  const identifiable =
    has(hits, 'realPerson') || has(hits, 'selfSubject') || namesAPersonAsSubject(text);
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
  ].map((w) => w.toLowerCase()),
);

/** Cues that the subject of a media request is a person. */
const PERSON_CUE =
  /\b(?:he|she|they|him|her|his|hers|their|man|woman|person|people|guy|girl|boy|singer|actor|actress|politician|president|senator|governor|mayor|ceo|founder|streamer|influencer|youtuber|celebrity|speaking|talking|saying|singing|smiling|dancing|posing|portrait|headshot|selfie|mr|mrs|ms|dr|prof)\b/i;

/**
 * Does this request name a person as the subject of media it wants made?
 *
 * A full name after "image of", "video of", "voice of" and friends is read as a
 * person unless it carries a place or organization word. A single capitalized
 * word needs a person cue nearby, which is what keeps "an image of Paris" out
 * of the consent gate while keeping "a video of Paris speaking" in it.
 */
function namesAPersonAsSubject(text: string): boolean {
  const re =
    /\b(image|images|photo|photos|picture|pictures|portrait|headshot|selfie|video|clip|deepfake|voice|audio|render|footage)\s+(?:of|featuring|as|like)\s+(?:the\s+)?([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const media = match[1]!.toLowerCase();
    const name = match[2]!;
    const words = name.split(/\s+/);
    if (words.some((w) => NON_PERSON_NAME_WORDS.has(w.toLowerCase().replace(/['.-]/g, '')))) {
      continue;
    }
    // Media forms that only depict people carry their own cue.
    const personOnlyMedia = /^(portrait|headshot|selfie|deepfake|voice|audio)$/.test(media);
    if (personOnlyMedia) return true;
    if (words.length >= 2) return true;
    // A single name needs corroboration from the surrounding sentence.
    const around = text.slice(Math.max(0, match.index - 120), match.index + match[0].length + 120);
    if (PERSON_CUE.test(around.replace(name, ' '))) return true;
  }
  // "in the voice of X", "sounds just like X", "impersonate X".
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
