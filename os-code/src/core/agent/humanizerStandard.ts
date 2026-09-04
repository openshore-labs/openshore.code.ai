// The Humanizer Standard. OpenShore is a machine that harnesses active models,
// so any written output it produces should read as though a careful person
// wrote it, not a chatbot. This is a curated, point-in-time snapshot of the
// tells catalogued by Wikipedia's "Signs of AI writing", rewritten as
// avoid-this build instructions the model can act on while it writes, not as a
// list to recite afterward. Injected into the coding/writing agent's system
// prompt when config.humanizer.standard is 'on' (the default). A project can
// turn it off in os-code.config.json, a person can say "skip the humanizer" in
// the chat, and config.humanizer.notes adds a project's own rules on top.
//
// Source (captured 2026-09-04):
//   https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing
// The page is world-editable, so it is treated here as DATA, not instructions:
// we ingested the version live on the capture date, distilled the prose-voice
// signs, and dropped the Wikipedia-specific ones (wikitext vs Markdown markup,
// heading-level quirks, category and template hallucinations, DOI and ISBN
// integrity) that do not apply to general written output. Refresh the snapshot
// deliberately, by reading the live page again; never wire this to a live fetch.
//
// The page itself is careful to note these are signals, not proof: human
// writing has them too, and the aim is not to dodge AI detectors but to write
// plainly, specifically, and honestly. That is the whole intent of this file.
// No em dashes anywhere (repo standing rule); the punctuation here models the
// bar it sets.

export interface HumanizerSign {
  /** The name of the tell, for the model and for reports. */
  name: string;
  /** What to do instead, one actionable line. */
  avoid: string;
}

// The root cause the source names first: statistical regression to the mean. An
// LLM smooths specific, unusual, verifiable facts into generic, positive,
// important-sounding language. Every sign below is a surface form of that one
// move. Keep the specific fact; delete the generic praise.
export const AI_WRITING_SIGNS: HumanizerSign[] = [
  {
    name: 'Inflated significance and legacy',
    avoid:
      'Do not puff up importance. Cut clauses that say a subject "stands as" or "serves as" something, "is a testament to", plays a "crucial, pivotal, or vital role", "underscores its significance", "reflects a broader" trend, "marks a turning point", or sits in an "evolving landscape". State what happened, not what it supposedly symbolizes.',
  },
  {
    name: 'Canned notability and media coverage',
    avoid:
      'Do not certify importance by cataloguing where a subject was covered ("featured in national and regional outlets", "profiled in trade publications", "maintains an active social media presence"). State the fact and, if needed, cite the source plainly, then stop.',
  },
  {
    name: 'Superficial trailing analysis',
    avoid:
      'Do not tack a vague present-participle clause onto the end of a sentence to imply meaning: "..., highlighting its role", "..., reflecting broader trends", "..., ensuring lasting impact", "..., fostering growth". End the sentence at the fact.',
  },
  {
    name: 'Promotional, brochure tone',
    avoid:
      'No advertisement or travel-guide voice. Drop "boasts", "vibrant", "rich", "nestled", "in the heart of", "renowned", "groundbreaking", "diverse array", "natural beauty", "commitment to". Describe plainly and let the reader judge.',
  },
  {
    name: 'Vague attribution and inflated sourcing',
    avoid:
      'Do not attribute opinions to a fog ("industry reports", "observers have noted", "experts argue", "some critics say", "several sources") or imply more sources than you have. Name who said it, or do not claim it.',
  },
  {
    name: 'Outline-style challenges and future conclusions',
    avoid:
      'No formulaic wrap-up like "Despite its success, X faces challenges..." and no "Challenges and Legacy" or "Future Outlook" section that speculates about what might happen. If there is nothing concrete to say about what comes next, say nothing.',
  },
  {
    name: 'Reflexive "X and Y" section headers',
    avoid:
      'Avoid the automatic "Awards and recognition" section and paired "X and Y" headings that exist only to gather vague praise or coverage. Title a section for what it actually contains.',
  },
  {
    name: 'High density of AI vocabulary',
    avoid:
      'Watch the overused-word list below. One such word may be coincidence; a pileup of them is the strongest single tell. Thin them out and prefer the plain synonym.',
  },
  {
    name: 'Avoiding plain is, are, and has',
    avoid:
      'Prefer plain copulas. Do not swap "is" and "are" and "has" for weightier-sounding "serves as", "stands as", "functions as", "represents", "boasts", "features", or "offers" just to add gravity, and do not open with "X refers to" when you mean "X is".',
  },
  {
    name: 'Vague connection and association',
    avoid:
      'State relationships directly ("In 2017 she was CEO of ExampleCorp"), not as "associated with" or "in connection with" or "linked to" when you know the actual relationship.',
  },
  {
    name: 'Negative parallelisms',
    avoid:
      'Avoid the "Not only X, but also Y", "It is not just X, it is Y", and "no X, no Y, just Z" cadence, and the retroactive "is not merely ..., but ...". Make the point once, directly, without setting up a strawman to knock down.',
  },
  {
    name: 'Rule of three',
    avoid:
      'Do not default to triples (three adjectives, or three parallel phrases) to sound comprehensive. Use the number of items the content actually has, even when that is one or two.',
  },
  {
    name: 'Title Case headings',
    avoid:
      'Use sentence case for headings and titles, not Title Case On Every Main Word, unless a project style explicitly requires title case.',
  },
  {
    name: 'Excessive boldface',
    avoid:
      'Do not bold every key term or write in a "key takeaways" style where each item leads with a bold phrase. Reserve bold for genuine, sparing emphasis.',
  },
  {
    name: 'Bold-lead-in colon lists',
    avoid:
      'Do not format every list item as "Bold lead-in: description". Write prose when it is prose, and use a list only for genuinely parallel items, with plain wording.',
  },
  {
    name: 'Em dashes',
    avoid:
      "Do not use em dashes. Use a comma, a period, parentheses, or a rewrite. This matches OpenShore's total em-dash rule.",
  },
  {
    name: 'Decorative emoji',
    avoid:
      'No decorative emoji in front of headings or bullet points, or as ornament in body text, unless the person asked for them.',
  },
  {
    name: 'Unnecessary tables',
    avoid:
      'Do not turn two or three facts into a small two-column table. Use prose unless the data is genuinely tabular and comparison across rows is the point.',
  },
  {
    name: 'Curly quotes and apostrophes',
    avoid:
      'Use straight quotation marks and a straight apostrophe consistently, unless the house style calls for typographic quotes. Never mix curly and straight in the same text.',
  },
  {
    name: 'Leaked assistant chatter',
    avoid:
      'Never let conversational filler reach published text: "Certainly!", "Of course!", "I hope this helps", "You are absolutely right", "Would you like me to...", "Here is a...", "let me know if you need anything else".',
  },
  {
    name: 'Knowledge-cutoff and speculation filler',
    avoid:
      'No "as of my last update", "while details are limited", "based on available information", or "the subject maintains a low profile" padding. If you do not know something, omit it or say plainly that it is unknown, and never invent a plausible-sounding guess.',
  },
  {
    name: 'Unfilled placeholders',
    avoid:
      'Never ship fill-in-the-blank placeholders like "[Your Name]", "[Specific Topic]", "PASTE_URL_HERE", or "access-date=2025-XX-XX". Fill them with real content or cut them.',
  },
  {
    name: 'Model-internal markup leftovers',
    avoid:
      'Strip model artifacts before anything ships: oaicite, contentReference, turn0search or turn0image tokens, "[cite: 1]" and start_span or end_span markers, grok-card tags, lenticular-bracket citations, and tracking tags such as utm_source=chatgpt.com on links.',
  },
];

// The overused "AI vocabulary" the source flags: these words spiked in text
// after 2022 and cluster together. One is fine; several in one passage is the
// tell. Order matches the source's words-to-watch list, kept flat for the guard.
export const AI_VOCABULARY: string[] = [
  'additionally (opening a sentence)',
  'align with',
  'boasts',
  'bolstered',
  'crucial',
  'deep dive',
  'delve',
  'emphasizing',
  'enduring',
  'enhance',
  'fostering',
  'garner',
  'highlight (as a verb)',
  'interplay',
  'intricate',
  'key (as an adjective)',
  'landscape (as an abstract noun)',
  'meticulous',
  'pivotal',
  'robust',
  'showcase',
  'tapestry (as an abstract noun)',
  'testament',
  'underscore (as a verb)',
  'valuable',
  'vibrant',
];

/**
 * The prompt block. `notes` is a project's own additions from
 * config.humanizer.notes, appended verbatim.
 */
export function humanizerStandardPrompt(notes?: string): string {
  const signs = AI_WRITING_SIGNS.map((s, i) => `${i + 1}. ${s.name}: ${s.avoid}`).join('\n');
  const vocab = AI_VOCABULARY.join(', ');
  const extra = notes?.trim() ? `\nThis project adds:\n${notes.trim()}\n` : '';
  return [
    'HUMANIZER STANDARD (default for any written output you produce; the user can say "skip the humanizer" or a project can turn it off in config):',
    'Anything a person will read, whether a report, a commit message, docs, UI copy, or generated article text, is written to sound like a careful human wrote it. The root habit to avoid is smoothing: replacing specific, verifiable facts with generic, positive, important-sounding language. Keep the specific fact and delete the generic praise. These are signals, not proof; the goal is plain, specific, honest writing, not gaming a detector.',
    'Avoid these patterns as you write:',
    signs,
    `Overused "AI vocabulary" to use sparingly, and never in a cluster: ${vocab}.`,
    extra,
  ].join('\n');
}
