// Deterministic signal detection for the ethics layer.
//
// This file answers one question per signal: does this text contain a term of
// the given kind, and where. It makes NO decisions. classify.ts combines
// signals into a tier, so a reviewer can read the evidence here and the
// judgement there without the two tangling.
//
// Two rules govern everything below:
//   1. A single keyword never decides anything. Every block in classify.ts
//      needs a co-occurrence (a sexual term NEAR a minor term, an agent of
//      concern NEAR a production verb), because keywords alone both over-fire
//      and under-fire.
//   2. Suppressors are first-class. A word that marks fiction, defense, or an
//      adult subject is evidence too, and it counts toward the least
//      restrictive reading of an ambiguous request.
//
// The vocabulary is deliberately narrow. Everything not listed here is Tier 3,
// which is the large majority of what people ask a coding agent.

export type SignalName =
  // Sexual content of any kind (legal adult content included: this signal on
  // its own is Tier 3 and blocks nothing).
  | 'sexual'
  // The subject is, or is implied to be, a minor.
  | 'minor'
  // An explicit stated age under 18 / 18 or over.
  | 'ageUnder18'
  | 'age18Plus'
  // A real, identifiable person: a relation, a role, an attached photo.
  | 'realPerson'
  // The person asking is the subject ("my own voice", "a photo of me").
  | 'selfSubject'
  // Fiction, satire, parody, or an explicitly invented character.
  | 'fictionMarker'
  // Stripping or sexualizing an image of someone (the "nudify" family).
  | 'nudify'
  // Producing image, video, or audio output, as opposed to text.
  | 'mediaSynthesis'
  // A face, a voice, a likeness.
  | 'likenessTarget'
  // A chemical, biological, nuclear, or high-yield explosive agent of concern.
  | 'cbrnAgent'
  // Actionable production or deployment of one ("synthesize", "aerosolize").
  | 'productionVerb'
  // Weaker actionable framing that needs the classifier to resolve.
  | 'weakActionVerb'
  // Defensive, medical, historical, or policy framing.
  | 'defensiveContext'
  // Defensive security research, red teaming, vulnerability analysis.
  | 'securityResearch';

export interface SignalHit {
  signal: SignalName;
  /** The matched text, kept only long enough to reach a decision. Never logged. */
  term: string;
  index: number;
}

interface Pattern {
  signal: SignalName;
  re: RegExp;
}

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

// Sexual content. Present in a great deal of legitimate adult creative work, so
// this signal is never a block on its own. Note what is NOT here: "girl",
// "boy", "baby", "hot", "sexy", "lingerie". Those appear constantly in adult
// writing about adults, and pairing them with a minor term would over-block the
// exact Tier 3 use the layer is required to leave alone.
const SEXUAL = [
  'nude',
  'nudes',
  'naked',
  'topless',
  'porn',
  'porno',
  'pornographic',
  'pornography',
  'nsfw',
  'xxx',
  'erotic',
  'erotica',
  'sexual',
  'sexually',
  'sex scene',
  'sex act',
  'having sex',
  'intercourse',
  'genitals',
  'genitalia',
  'penis',
  'vagina',
  'masturbat\\w*',
  'orgasm\\w*',
  'fellatio',
  'blowjob',
  'hentai',
  'rule 34',
  'explicit sexual',
  'sexualize\\w*',
  'sexualise\\w*',
];

// Minor indicators. Bare "girl" and "boy" are deliberately absent (see above);
// the qualified forms are present because they carry the age meaning.
const MINOR = [
  'child',
  'children',
  'childs',
  "child's",
  'kid',
  'kids',
  'minor',
  'minors',
  'underage',
  'under-age',
  'under age',
  'preteen',
  'pre-teen',
  'prepubescent',
  'toddler',
  'infant',
  'newborn',
  'teen',
  'teens',
  'teenage',
  'teenager',
  'teenagers',
  'adolescent',
  'adolescents',
  'schoolgirl',
  'schoolboy',
  'school girl',
  'school boy',
  'elementary school',
  'middle school',
  'grade school',
  'high school student',
  'little girl',
  'little boy',
  'young girl',
  'young boy',
  'baby girl',
  'baby boy',
  'loli',
  'lolicon',
  'shota',
  'shotacon',
  'jailbait',
  'cp',
  'csam',
  'csem',
];

// A real, identifiable person. Relations, a pointed-at photo, and the public
// roles a named figure occupies. A bare proper noun is NOT here on purpose:
// "write erotica about Sarah Connor" is fiction about a fictional character,
// and treating any capitalized pair as a real person would over-block it.
const REAL_PERSON = [
  'my ex',
  'my girlfriend',
  'my boyfriend',
  'my wife',
  'my husband',
  'my partner',
  'my friend',
  "my friend's",
  'my coworker',
  'my co-worker',
  'my colleague',
  'my classmate',
  'my neighbou?r',
  'my boss',
  'my teacher',
  'my student',
  'my roommate',
  'this photo of',
  'this picture of',
  'this image of',
  'the attached photo',
  'the attached picture',
  'the attached image',
  'attached photo of',
  'photo of her',
  'photo of him',
  'photos? i took of',
  'her instagram',
  'his instagram',
  'their instagram',
  'from her profile',
  'from his profile',
  'a real person',
  'real woman',
  'real man',
  'real people',
  'she is real',
  'he is real',
  'someone i know',
  'a girl i know',
  'a guy i know',
  'celebrity',
  'celebrities',
  'famous actress',
  'famous actor',
  'this politician',
  'the president',
  'the prime minister',
  'the senator',
  'the governor',
  'the mayor',
  'this streamer',
  'this influencer',
  'this youtuber',
  'this singer',
  'the singer',
  'public figure',
];

const SELF_SUBJECT = [
  'myself',
  'my own voice',
  'my own face',
  'my own likeness',
  'my voice',
  'my face',
  'my likeness',
  'a photo of me',
  'a picture of me',
  'an image of me',
  'of me speaking',
  'i am the subject',
  'i own the rights',
  'i have permission',
  'i am authorized',
  'i am authorised',
];

const FICTION_MARKER = [
  'fictional',
  'fiction',
  'made up',
  'made-up',
  'invented',
  'original character',
  'my character',
  'a character named',
  'novel',
  'short story',
  'screenplay',
  'in my story',
  'in my book',
  'not a real person',
  'not based on',
  'nobody real',
  'no real person',
  'generic',
  'anonymous person',
  'satire',
  'satirical',
  'parody',
  'lampoon',
  'send-up',
  'the onion',
  'sketch comedy',
];

// The "nudify" family: turning an image of a person into a sexual one. These
// are the concrete acts the Tier 1 non-consensual imagery rule is about.
const NUDIFY = [
  'nudify',
  'nudifier',
  'undress',
  'undressing',
  'strip her',
  'strip him',
  'strip them',
  'remove her clothes',
  'remove his clothes',
  'remove their clothes',
  'remove the clothes',
  'take off her clothes',
  'take off his clothes',
  'see through her',
  'see-through her',
  'x-ray her',
  'deepfake nude',
  'deepfake porn',
  'deepfake sex',
  'fake nudes',
  'ai nudes',
  'put her face on',
  'put his face on',
  'put their face on',
  'face on a porn',
  'face onto a porn',
  'face swap.{0,24}porn',
  'swap her face',
  'swap his face',
  'revenge porn',
  'without her consent',
  'without his consent',
  'without their consent',
  'she did not consent',
  'he did not consent',
  'she has not consented',
];

const MEDIA_SYNTHESIS = [
  'generate an? (?:image|photo|picture|video|clip|audio|voice|song)',
  'create an? (?:image|photo|picture|video|clip|audio|voice)',
  'make an? (?:image|photo|picture|video|clip|audio|voice)',
  'render an? (?:image|photo|picture|video)',
  'draw',
  'image of',
  'photo of',
  'picture of',
  'video of',
  // Forms that depict a person by definition. Without these, "a portrait of
  // <name>" reached an image server without ever passing the consent gate,
  // which is exactly the request the gate exists for.
  'portrait of',
  'headshot of',
  'selfie of',
  'avatar of',
  'render of',
  'painting of',
  'drawing of',
  'likeness of',
  'deepfake',
  'deep fake',
  'face swap',
  'faceswap',
  'lip ?sync',
  'text to speech',
  'text-to-speech',
  'tts',
  'voice model',
  'voice clone',
  'voice cloning',
  'clone the voice',
  'clone his voice',
  'clone her voice',
  'clone their voice',
  'synthesize (?:the |his |her |their )?voice',
  'synthesise (?:the |his |her |their )?voice',
  'speaking in the voice of',
  'sound like',
  'sounds just like',
  'impersonate.{0,20}voice',
  'train a (?:voice |speech )?model on',
];

const LIKENESS_TARGET = [
  'face',
  'facial',
  'voice',
  'likeness',
  'portrait',
  'headshot',
  'avatar',
  'speech',
  'accent',
  'appearance',
];

// Agents of concern. Narrow on purpose: these are the categories where concrete
// assistance is uplift, not the general chemistry, biology, and physics that
// people legitimately work with every day.
const CBRN_AGENT = [
  'sarin',
  'soman',
  'tabun',
  'novichok',
  'vx nerve',
  'nerve agent',
  'nerve gas',
  'mustard gas',
  'sulfur mustard',
  'phosgene',
  'chlorine gas',
  'hydrogen cyanide',
  'chemical weapon',
  'chemical warfare agent',
  'ricin',
  'abrin',
  'botulinum',
  'anthrax',
  'bacillus anthracis',
  'smallpox',
  'variola',
  'yersinia pestis',
  'bubonic plague',
  'ebola',
  'marburg',
  'nipah',
  'select agent',
  'biological weapon',
  'bioweapon',
  'bio-weapon',
  'biological warfare',
  'weapons.grade',
  'weapon.grade',
  'fissile material',
  'highly enriched uranium',
  'enriched uranium',
  'plutonium pit',
  'implosion lens',
  'nuclear weapon',
  'nuclear device',
  'atomic bomb',
  'dirty bomb',
  'radiological dispersal',
  'tatp',
  'triacetone triperoxide',
  'rdx',
  'petn',
  'hmx',
  'anfo',
  'nitroglycerin',
  'plastic explosive',
  'shaped charge',
  'pipe bomb',
  'car bomb',
  'truck bomb',
  'pressure cooker bomb',
  'improvised explosive device',
  'blasting cap',
  'detonator',
];

// Strong actionable framing. Paired with an agent of concern this is the Tier 1
// bright line, and no framing suppresses it: "for defensive research, give me
// the synthesis route for sarin" is the same request either way.
const PRODUCTION_VERB = [
  'synthesi[sz]e',
  'synthesis',
  'synthesis route',
  'manufactur\\w*',
  'produce',
  'production of',
  'make (?:some |a |an )?(?:batch|quantity|amount)',
  'how (?:do|would) i make',
  'how to make',
  'how to build',
  'how to produce',
  'how to synthesi[sz]e',
  'build (?:a|an|the) (?:bomb|device|weapon)',
  'assemble (?:a|an|the) (?:bomb|device|weapon)',
  'step[- ]by[- ]step',
  'recipe',
  'protocol for',
  'procedure for',
  'precursor',
  'precursors',
  'starting material',
  'scale up',
  'scale it up',
  'increase the yield',
  'purify',
  'purification',
  'culture (?:the|a|it)',
  'cultivate',
  'weaponi[sz]e\\w*',
  'aerosoli[sz]e\\w*',
  'disperse',
  'dispersal method',
  'dissemination',
  'enrich',
  'enrichment',
  'critical mass',
  'initiator design',
  'trigger mechanism',
  'detonat\\w*',
  'maximi[sz]e (?:casualties|deaths|damage|lethality)',
  'more lethal',
  'more transmissible',
  'increase transmissibility',
  'gain of function',
  'defeat detection',
  'evade detection',
];

const WEAK_ACTION_VERB = [
  'build',
  'make',
  'create',
  'design',
  'obtain',
  'acquire',
  'get hold of',
  'source',
  'buy',
  'deploy',
  'use it on',
  'quantity',
  'dose',
  'dosage',
  'amount needed',
];

const DEFENSIVE_CONTEXT = [
  'detect',
  'detection',
  'detector',
  'defend',
  'defense',
  'defence',
  'defensive',
  'protect against',
  'protection against',
  'decontaminat\\w*',
  'antidote',
  'treatment',
  'treat (?:a|the|patients)',
  'symptoms',
  'diagnos\\w*',
  'medical response',
  'first responder',
  'public health',
  'epidemiolog\\w*',
  'biosecurity',
  'biosafety',
  'safeguards',
  'inspection',
  'arms control',
  'non-?proliferation',
  'treaty',
  'disarmament',
  'history of',
  'historical',
  'policy',
  'regulation',
  'export control',
  'threat assessment',
  'preparedness',
  'evacuation',
  'triage',
  'why (?:is|are|was|were)',
  'what happened',
  'explain the effects',
  'health effects',
];

// Defensive security work. Not a suppressor for anything above; it exists so a
// reviewer can see the layer recognizes this as protected Tier 3 work, and so
// the classifier has the evidence in front of it.
const SECURITY_RESEARCH = [
  'ctf',
  'capture the flag',
  'penetration test',
  'pentest',
  'red team',
  'blue team',
  'bug bounty',
  'responsible disclosure',
  'vulnerability',
  'vulnerabilities',
  'cve-',
  'exploit',
  'sql injection',
  'xss',
  'cross-site scripting',
  'buffer overflow',
  'use after free',
  'race condition',
  'threat model',
  'threat modeling',
  'security review',
  'security audit',
  'hardening',
  'sandbox escape',
  'privilege escalation',
  'fuzzing',
  'reverse engineering',
  'malware analysis',
  'incident response',
];

function compile(signal: SignalName, terms: string[]): Pattern[] {
  return terms.map((term) => ({
    signal,
    // Word boundaries on both ends, so "cp" does not fire inside "cpu" and
    // "teen" does not fire inside "canteen".
    re: new RegExp(`(?<![a-z0-9])(?:${term})(?![a-z0-9])`, 'gi'),
  }));
}

const PATTERNS: Pattern[] = [
  ...compile('sexual', SEXUAL),
  ...compile('minor', MINOR),
  ...compile('realPerson', REAL_PERSON),
  ...compile('selfSubject', SELF_SUBJECT),
  ...compile('fictionMarker', FICTION_MARKER),
  ...compile('nudify', NUDIFY),
  ...compile('mediaSynthesis', MEDIA_SYNTHESIS),
  ...compile('likenessTarget', LIKENESS_TARGET),
  ...compile('cbrnAgent', CBRN_AGENT),
  ...compile('productionVerb', PRODUCTION_VERB),
  ...compile('weakActionVerb', WEAK_ACTION_VERB),
  ...compile('defensiveContext', DEFENSIVE_CONTEXT),
  ...compile('securityResearch', SECURITY_RESEARCH),
];

// Stated ages. "17 year old" is a minor signal even with no other minor word;
// "22 year old" is positive evidence the subject is an adult, which matters for
// leaving legal adult content alone.
const AGE_RE =
  /(?<![a-z0-9])(\d{1,3})\s*(?:-|\s)?\s*(?:years?[- ]old|yrs?[- ]old|yo|y\/o)(?![a-z0-9])/gi;

/**
 * Every signal hit in the text, in order. Cheap: a few dozen regexes over a
 * prompt, no allocation beyond the hits themselves.
 */
export function detectSignals(text: string): SignalHit[] {
  const hits: SignalHit[] = [];
  for (const { signal, re } of PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      hits.push({ signal, term: match[0], index: match.index });
      // Guard against a zero-length match looping forever.
      if (match.index === re.lastIndex) re.lastIndex++;
    }
  }
  AGE_RE.lastIndex = 0;
  let ageMatch: RegExpExecArray | null;
  while ((ageMatch = AGE_RE.exec(text)) !== null) {
    const age = Number(ageMatch[1]);
    if (!Number.isFinite(age)) continue;
    hits.push({
      signal: age < 18 ? 'ageUnder18' : 'age18Plus',
      term: ageMatch[0],
      index: ageMatch.index,
    });
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** Does this signal appear at all? */
export function has(hits: SignalHit[], signal: SignalName): boolean {
  return hits.some((h) => h.signal === signal);
}

/** Every hit for one signal. */
export function hitsOf(hits: SignalHit[], signal: SignalName): SignalHit[] {
  return hits.filter((h) => h.signal === signal);
}

/**
 * Do two signals co-occur within `window` characters of each other? This is the
 * proximity rule that keeps a long document from tripping a block because a
 * sexual scene sits in chapter two and the word "child" sits in chapter nine.
 */
export function near(hits: SignalHit[], a: SignalName, b: SignalName, window = 240): boolean {
  const left = hitsOf(hits, a);
  const right = hitsOf(hits, b);
  for (const l of left) {
    for (const r of right) {
      if (Math.abs(l.index - r.index) <= window) return true;
    }
  }
  return false;
}

/** The signal names present, deduplicated. Used for the audit record. */
export function signalNames(hits: SignalHit[]): SignalName[] {
  return [...new Set(hits.map((h) => h.signal))].sort();
}
