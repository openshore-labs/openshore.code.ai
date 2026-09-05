// The browser-safe protocol surface. The native apps (React UI in Electron,
// Capacitor iOS) import ONLY this subpath ('os-code/protocol'): event and
// approval types, the catalog schema, and the capability taxonomy. Every
// value export here is pure (zod and plain data); every runtime import chain
// stays free of Node built-ins, so it bundles cleanly for a WebView.
export type {
  AgentEvent,
  ApprovalAnswer,
  ApprovalRequest,
  DriverEvent,
  PermissionMode,
  StopReason,
  TodoItem,
} from './core/agent/types.js';
export { PERMISSION_MODES } from './core/agent/types.js';
import type { PermissionMode } from './core/agent/types.js';
export { INIT_PROMPT } from './core/agent/initPrompt.js';

// Repo reconcile result (push unpushed commits, merge a moved-on remote). Type
// only: the reconcile engine itself pulls Node/simple-git, but its result shape
// is pure data the WebView needs to render the sync outcome. `export type` is
// erased at build, so no Node runtime import reaches the bundle.
export type { ReconcileResult, ReconcileStatus } from './git/reconcile.js';

export {
  CatalogSchema,
  CatalogModelSchema,
  CatalogPresetSchema,
  type Catalog,
  type CatalogModel,
  type CatalogPreset,
} from './market/schema.js';

export { CAPABILITIES, SPECIALIST_ROLES, ROLE_CATEGORY, plainLabel } from './router/roles.js';
// The UX standard every coding model builds to by default (app-side chat
// specialists share it with the engine's agent).
export { UX_LAWS, HOUSE_STANDARD, uxStandardPrompt } from './core/agent/uxStandard.js';
export type { UxLaw } from './core/agent/uxStandard.js';
// The Humanizer Standard every model writes to by default: written output
// avoids AI writing tells (app-side chat specialists share it with the engine).
export {
  AI_WRITING_SIGNS,
  AI_VOCABULARY,
  humanizerStandardPrompt,
  humanizerEnabled,
} from './core/agent/humanizerStandard.js';
export type { HumanizerSign } from './core/agent/humanizerStandard.js';
export type { CapabilityCategory, SpecialistRole } from './router/roles.js';

// The always-on ethics layer. Pure modules only: the tier logic, the
// chokepoint, the streamed-output screener, the enforcement ladder, the
// provenance writer, and the trust statement. The app imports these and screens
// with the EXACT SAME code the desktop engine runs, so the two can never drift
// into enforcing different rules. The Node-side pieces (the on-disk journal and
// the engine host wiring) are deliberately not here.
export {
  EthicsGuard,
  ethicsGuard,
  configureEthicsGuard,
  failedCheck,
  classifyRules,
  consentCovers,
  extractSubject,
  localIntentCheck,
  normalizeSubject,
  readAssertion,
  tierOf,
  REFUSALS,
  detectSignals,
  signalNames,
  StreamScreener,
  countableViolations,
  evaluateEnforcement,
  prepareReport,
  proposeIpBan,
  IP_REVIEW_NOTES,
  TIER2_RESTRICT_AT,
  TIER2_WARN_AT,
  buildProvenanceManifest,
  embedPngProvenance,
  hasProvenance,
  labelGeneratedImage,
  readPngProvenance,
  PROVENANCE_KEYWORD,
  UNSIGNED_NOTE,
  sha256,
  TRUST_STATEMENT,
  TRUST_STATEMENT_LINES,
} from './core/ethics/index.js';
export type {
  AbuseReport,
  ConsentAssertion,
  EnforcementAction,
  EnforcementLevel,
  EnforcementOutcome,
  EthicsAction,
  EthicsCategory,
  EthicsDecision,
  EthicsRecord,
  EthicsTier,
  IntentCheck,
  IpBanProposal,
  ModelPath,
  ProvenanceManifest,
  ReportOutcome,
  ReportStatus,
  ScreenRequest,
  ScreenResult,
  SignalName,
  StreamStep,
} from './core/ethics/index.js';

// Codemagic build-log safety (pure: redact then extract). Shared so the app's
// Launch flow and the engine's codemagic tool apply the exact same guarantee
// before any log text reaches a model. The REST client (fetch + token) stays on
// each side; only these pure helpers and types are shared.
export {
  isTerminal,
  normalizeStatus,
  logArtifacts,
  redactLog,
  extractErrors,
  safeLogExcerpt,
} from './core/codemagic/safety.js';
export type { BuildStatus, BuildArtifact, BuildInfo } from './core/codemagic/safety.js';

// Stack Health: pure payload types only. The aggregator that fills them in
// (insights/stackHealth.ts) touches the filesystem and is NOT imported here.
export type {
  StackHealth,
  StackHealthBucket,
  StackHealthCrewMember,
  StackHealthRange,
  StackHealthSealFact,
  SavingsBasis,
  Sustainability,
  SustainabilityBasis,
  SustainabilityFootprint,
} from './insights/stackHealthTypes.js';

// Crew routines (the botOS clone brief, shipped inside My Crew): the pure model
// and schedule math the phone and desktop render with. The scheduler that
// fires them lives in routines/scheduler.ts and is NOT imported here.
export type {
  Routine,
  RoutineAccess,
  RoutineInput,
  RoutinePresence,
  RoutineRun,
  RoutineRunState,
  RoutineSchedule,
  RoutineView,
} from './routines/model.js';
export {
  PRESET_ROUTINE,
  ROUTINE_LIMITS,
  nextSlotAfter,
  presenceOf,
  scheduleDaysLabel,
  scheduleLabel,
  scheduleTimeLabel,
  validateRoutineInput,
  validateSchedule,
} from './routines/model.js';

/** Wire shapes the daemon serves that are not agent events. */
export interface DaemonSessionInfo {
  id: string;
  cwd: string;
  title?: string;
  busy?: boolean;
  updatedAt?: string;
  /** The permission mode in force on a live session. */
  mode?: PermissionMode;
}

export interface DaemonWorkspace {
  cwd: string;
  name: string;
  lastUsed?: string;
}

export interface DaemonStackInfo {
  description: string;
  orchestrator?: { model: string; provider: string; kind: 'local' | 'cloud' };
  specialists: Array<{ role: string; model: string }>;
}
