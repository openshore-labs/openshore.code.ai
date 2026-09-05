// The ethics layer, in one import.
//
// Read the files in this order to audit it:
//   signals.ts        what the layer can see (evidence, no judgement)
//   classify.ts       the three tiers and every decision (judgement)
//   chokepoint.ts     the one entry point, fail closed, both sides
//   stream.ts         screening a streamed answer without buffering it whole
//   guardedProvider.ts how the engine cannot get around it
//   enforcement.ts    the account ladder, the review queue, the report hook
//   provenance.ts     what gets attached to generated media
//   journal.ts        what is written to disk, and what is not
//
// There is no configuration in any of them. No flag, no environment variable,
// no setting turns this off, because no code reads one.

export {
  EthicsGuard,
  ethicsGuard,
  configureEthicsGuard,
  failedCheck,
  type EthicsRecord,
  type GuardDeps,
  type ModelPath,
  type RecordSink,
  type ScreenRequest,
  type ScreenResult,
} from './chokepoint.js';

export {
  classifyRules,
  consentCovers,
  extractSubject,
  localIntentCheck,
  normalizeSubject,
  readAssertion,
  tierOf,
  REFUSALS,
  type ClassifyContext,
  type ConsentAssertion,
  type EthicsAction,
  type EthicsCategory,
  type EthicsDecision,
  type EthicsTier,
  type IntentCheck,
  type RuleVerdict,
} from './classify.js';

export {
  detectSignals,
  has,
  hitsOf,
  near,
  signalNames,
  type SignalHit,
  type SignalName,
} from './signals.js';

export { StreamScreener, SCREEN_BATCH, SCREEN_WINDOW, type StreamStep } from './stream.js';

export {
  EthicsBlocked,
  GuardedImageProvider,
  GuardedProvider,
  screenableText,
  type GuardContext,
} from './guardedProvider.js';

export {
  countableViolations,
  evaluateEnforcement,
  prepareReport,
  proposeIpBan,
  IP_REVIEW_NOTES,
  TIER2_RESTRICT_AT,
  TIER2_WARN_AT,
  type AbuseReport,
  type EnforcementAction,
  type EnforcementLevel,
  type EnforcementOutcome,
  type IpBanProposal,
  type ReportOutcome,
  type ReportStatus,
} from './enforcement.js';

export {
  buildProvenanceManifest,
  embedPngProvenance,
  hasProvenance,
  labelGeneratedImage,
  readPngProvenance,
  GENERATOR,
  PROVENANCE_KEYWORD,
  UNSIGNED_NOTE,
  type ProvenanceAssertion,
  type ProvenanceInput,
  type ProvenanceManifest,
} from './provenance.js';

export { sha256, sha256Bytes } from './hash.js';

export { TRUST_STATEMENT, TRUST_STATEMENT_LINES } from './trustStatement.js';
