# OpenShore Terms of Use

Last updated: 2026-09-05

These terms cover OpenShore OS Code: the desktop engine, the iOS and desktop
apps, and the accounts that connect them. Plain language throughout, because
terms nobody reads protect nobody.

## 1. What OpenShore is

OpenShore is a tool for building software with models you choose. You can run
models on your own hardware, or connect a cloud provider on your own account and
your own key. Your work stays yours.

## 2. Prohibited uses

You may not use OpenShore to generate, describe, plan, refine, or assist with:

**Child sexual abuse material.** Sexual content involving minors, in any form,
including drawn, written, and synthetic depictions.

**Non-consensual intimate imagery of real, identifiable people.** This includes
undressing or "nudifying" an image of a person, placing a real person's face
into sexual material, and any other sexualization of an identifiable person who
has not consented.

**Weapons capable of mass casualties.** Actionable assistance with synthesizing
or deploying biological, chemical, nuclear, or high-yield explosive weapons, or
with materially increasing the harm such a weapon would cause.

**Cloning a real person's face or voice without authorization.** Recreating the
likeness or voice of a real, identifiable person is permitted only when you are
authorized for that specific person: they are you, they gave you permission, or
they licensed the likeness to you. You assert that authorization in the product,
and the assertion is recorded against your account.

The first three have no exception and no consent option. The fourth is gated
behind your authorization, not forbidden.

## 3. What is not prohibited

To be clear about the boundary, because a vague rule chills legitimate work:

Legal adult content between adults, dark and violent fiction, horror, and edgy
humor are permitted. Satire, parody, and criticism of public figures are
permitted. Security research, red teaming, exploit analysis, and vulnerability
work for defensive purposes are permitted. Controversial, unpopular, and
dissenting opinions are permitted.

OpenShore does not add refusals or commentary to any of this.

## 4. Consequences of misuse

Misuse under section 2 results in immediate and permanent removal from the
platform, and will be reported to the appropriate authorities where the law
requires or permits it. In the United States, child sexual abuse material is
reported to the National Center for Missing and Exploited Children.

We take this seriously and we want to be direct about why. Deepfakes,
non-consensual intimate imagery, and synthetic child sexual abuse material are
spreading because the tools to make them became easy to get. This product exists
in part to be one of the tools that does not help, and enforcement is how that
promise is kept rather than merely stated.

## 5. Enforcement scope

We may terminate accounts used for prohibited purposes.

We may also ban IP addresses associated with prohibited use, subject to human
review. IP address bans are never automatic. An address is proposed for a ban
only after an account is terminated, and a person reviews and decides each one,
with an expiry, because addresses are routinely shared by households, offices,
public networks, and carrier-grade NAT, and a wrong ban falls on people who did
nothing.

IP addresses are not logged in ordinary use. Nothing is recorded when you sync,
when you sign in, or when you send a request that is not blocked. When a
signed-in request is blocked, that block record carries the address it came
from, and an authorization assertion carries the address it was made from. Those
are the only moments an address is collected.

## 6. What we record when something is blocked

When the guardrail blocks a request, we record the category, the tier, the time,
which model path served it (local or cloud), and a one-way SHA-256 hash of the
request.

We do not store the prompt, the completion, or any excerpt of either. A hash is
enough to recognize a repeat and to identify the same content in a lawful
report, and retaining harmful material in order to police harmful material is
its own harm.

## 7. Honest limits

OpenShore enforces these boundaries as shipped, and does not help you remove
them. There is no setting, configuration file, or environment variable in the
product that turns the guardrail off.

We cannot control models you run independently on your own hardware. Open model
weights on your own machine are outside the reach of any application, including
this one. We do not claim otherwise, and we do not claim that misuse is
impossible. What we guarantee is narrower and real: this app, as shipped, does
not assist the uses in section 2 and does not help you strip these protections
out.

## 8. Standards alignment

OpenShore aligns its risk practices with the NIST AI Risk Management Framework
and ISO/IEC 42001, and attaches content provenance using the C2PA assertion
vocabulary.

This is a self-attestation of alignment. No third party has certified,
endorsed, or audited this product against those frameworks, and we will not say
otherwise. Provenance records written by this product are unsigned, because
signing requires a certificate from a C2PA-recognized authority that OpenShore
does not currently hold.

## 9. Your content and your models

Your prompts, code, and generated work are yours. Local model work stays on your
machine. Cloud model work goes to the provider you connected, on your account,
under that provider's terms. A cloud provider's own policies apply in addition
to these terms, never instead of them.

## 10. Changes

We will update these terms as the product changes. Material changes to section 2
or section 5 will be surfaced in the app.

## 11. Contact

Questions, appeals of an enforcement decision, and reports of misuse:
support@openshore.ai
