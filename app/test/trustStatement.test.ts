// The trust statement and its three tiers ship in the app and on the marketing
// site (OpenShore.ai-marketing-site/src/_data/oscode.js, trust.statement and
// trust.tiers), and the site says they stay verbatim to the app. Nothing pinned
// that until now (review 8, section 2). The site's text is vendored here as a
// dated snapshot, so a drift on either side fails this test rather than
// quietly shipping two different promises. When the copy changes, change both
// repos and this snapshot in the same piece of work.
import { describe, expect, it } from 'vitest';
import { TRUST_STATEMENT_LINES, TRUST_STATEMENT_TIERS } from 'os-code/protocol';

// Vendored from oscode.js on 2026-09-16 (trust.statement).
const SITE_STATEMENT = [
  'This app enforces its ethical boundaries by default and will not help you remove them.',
  'It aligns with recognized frameworks: the NIST AI Risk Management Framework, ISO/IEC 42001, and C2PA content provenance.',
  'We block child sexual abuse material, non-consensual intimate imagery, and weapons uplift outright, and we gate the cloning of real people behind consent.',
  "We're honest about the limit: once open model weights are on your own machine, they are beyond any app's control.",
  'What we guarantee is that this app, as shipped, does not assist misuse and does not help you strip these protections out.',
];

// Vendored from oscode.js on 2026-09-24 (trust.tiers; the consent tier
// narrowed to images, advisory org round two).
const SITE_TIERS = [
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

describe('the trust statement, pinned across repos', () => {
  it('says the same five lines the site says', () => {
    expect(TRUST_STATEMENT_LINES).toEqual(SITE_STATEMENT);
  });

  it('says the same three tiers the site says, in the same order', () => {
    expect(TRUST_STATEMENT_TIERS.map((t) => ({ name: t.name, body: t.body }))).toEqual(SITE_TIERS);
  });

  it('has no em dash on either side', () => {
    const dash = String.fromCharCode(8212);
    for (const line of [...TRUST_STATEMENT_LINES, ...TRUST_STATEMENT_TIERS.map((t) => t.body)]) {
      expect(line).not.toContain(dash);
    }
  });
});
