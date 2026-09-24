// The trust statement. One source, shown in the app and on the marketing site,
// so the two can never drift into saying different things.
//
// Every clause here is one OpenShore can stand behind literally.
//   "enforces by default" and "will not help you remove them" are claims about
//   this app as shipped, which is exactly what the code does.
//   "aligns with" names public frameworks and is a self-attestation. It does
//   NOT say any third party certified, endorsed, or audited this product,
//   because none has.
//   The honest-limit sentence is not a disclaimer bolted on. Open weights on
//   someone's own hardware are outside any app's control, and saying so is the
//   difference between a trustworthy claim and marketing.
//
// The house rule against em dashes applies here too, so the framework list
// runs on a colon.

export const TRUST_STATEMENT = [
  'This app enforces its ethical boundaries by default and will not help you remove them.',
  'It aligns with recognized frameworks: the NIST AI Risk Management Framework, ISO/IEC 42001, and C2PA content provenance.',
  'We block child sexual abuse material, non-consensual intimate imagery, and weapons uplift outright, and we gate the cloning of real people behind consent.',
  "We're honest about the limit: once open model weights are on your own machine, they are beyond any app's control.",
  'What we guarantee is that this app, as shipped, does not assist misuse and does not help you strip these protections out.',
].join(' ');

/** The three tiers, in the same words on the site and in Settings. The site
 *  (oscode.js, trust.tiers) says these stay verbatim to the app; the app's
 *  trustStatement test pins them against a vendored copy of the site text so
 *  that promise holds in CI, not in memory. */
export const TRUST_STATEMENT_TIERS: ReadonlyArray<{ name: string; body: string }> = [
  {
    name: 'Refused outright',
    body: 'Child sexual abuse material. Sexual or nude imagery of a real, identifiable person. Concrete help building or deploying biological, chemical, nuclear, or high-yield explosive weapons. There is no consent option for any of these.',
  },
  {
    name: 'Gated behind consent',
    body: 'Synthesizing an image of a real, identifiable person, allowed only when you state you are authorized for that specific person. Writing about a person in text is not gated. Images of a real person made on your computer carry a provenance record saying they are AI-generated. Video or voice of a real person is refused until it can be marked the same way.',
  },
  {
    name: 'Left alone',
    body: 'Legal adult content, dark and violent fiction, horror, edgy humor, satire and political parody, security research and red teaming, and unpopular opinions. No added refusal, no commentary. Over-blocking your legitimate work is a defect we treat as seriously as letting real harm through.',
  },
];

/** The same statement as separate lines, for a surface that sets them apart. */
export const TRUST_STATEMENT_LINES: string[] = [
  'This app enforces its ethical boundaries by default and will not help you remove them.',
  'It aligns with recognized frameworks: the NIST AI Risk Management Framework, ISO/IEC 42001, and C2PA content provenance.',
  'We block child sexual abuse material, non-consensual intimate imagery, and weapons uplift outright, and we gate the cloning of real people behind consent.',
  "We're honest about the limit: once open model weights are on your own machine, they are beyond any app's control.",
  'What we guarantee is that this app, as shipped, does not assist misuse and does not help you strip these protections out.',
];
