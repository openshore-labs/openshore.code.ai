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
// The reserved terminal scope for the plain home-folder shell (no session).
export { HOME_SHELL_ID } from './daemon/homeShellId.js';

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
// Chain of Thought (off by default): the <think> tag splitter, the prompt a
// non-reasoning model gets, and the Claude thinking parameter, shared so the
// app's drivers route reasoning exactly as the engine does.
export {
  ThinkTagSplitter,
  splitThinkTags,
  chainOfThoughtEnabled,
  chainOfThoughtPrompt,
  reasonsNatively,
  claudeThinking,
} from './core/agent/chainOfThought.js';
export type { ThoughtPiece } from './core/agent/chainOfThought.js';
// The Memory switch's precedence: the app's switch can only turn project
// memory off, and a project's config off always wins.
export { memoryEnabled } from './core/agent/memorySwitch.js';
// The line diff approvals show, shared so the Vault's resolve sheet compares
// two versions of a note with the exact same lines (Vault M1, 1.1). Pure and
// import-free.
export { unifiedDiff } from './core/edit/diff.js';
export type { DiffStats } from './core/edit/diff.js';
// The Vault's shared core (Vault M3, CTO H1, H2 and H4): the one new-name
// rule and the path helpers, the note scanner, the frontmatter reader, link
// resolution, link rewriting and excerpts. The app, the engine's vault tools,
// the scheduler and the desktop's main process all run this same code. Pure
// (js-yaml is the one package), guarded by test/harnessPurity.test.ts.
export {
  checkNewNoteName,
  cleanNotePath,
  eolOf,
  foldPath,
  isConflictCopy,
  isNotePath,
  nonNoteExtension,
  normalizeNotePath,
  noteFolder,
  noteTitle,
  safeNoteName,
  utf8Length,
  vaultConflictCopyPath,
} from './harness/vault/paths.js';
export {
  findFrontmatter,
  isNoteDestination,
  scanInlineLinks,
  scanNote,
} from './harness/vault/scan.js';
export { readFrontmatter } from './harness/vault/frontmatter.js';
export {
  buildPathIndex,
  linkTextFor,
  resolveMarkdownLink,
  resolveMarkdownPath,
  resolveWikilink,
  wikilinkContext,
  wikilinkReplaceRange,
} from './harness/vault/resolve.js';
export { rewriteLinks } from './harness/vault/rewrite.js';
export { excerptAt } from './harness/vault/excerpt.js';
// Vault M6 "Obsidian day one" (CTO K4, K7, K8, K10, K11, K15): the pure core
// the app and the engine share. Stubs until each stream lands.
export { planLinkRewrites, rewriteForMoves } from './harness/vault/move.js';
export { highlightRanges, parseVaultQuery } from './harness/vault/query.js';
export {
  VAULT_DAILY_DEFAULTS,
  dailyNotePath,
  datePartsOf,
  fillTemplate,
  formatVaultDate,
} from './harness/vault/dates.js';
export {
  blockAnchorAt,
  findUnlinkedMentions,
  listTasks,
  maskComments,
  parseCallout,
  sectionOf,
  toggleTaskAt,
} from './harness/vault/markdown.js';
export {
  VAULT_ATTACHMENT_MAX_BYTES,
  attachmentMime,
  bytesMatchMime,
  isAttachmentPath,
  resolveAttachment,
} from './harness/vault/attachments.js';
// The Vault's shared core contract (Vault M3, CTO H1 to H5): the types the
// scanner, frontmatter reader, resolver, index and readConfig seam agree on.
// Types only, so nothing reaches the bundle.
export type {
  BlockIdToken,
  ConfigRead,
  ConfigReadRefusal,
  Eol,
  FmProp,
  FmState,
  FmValue,
  Frontmatter,
  FrontmatterRange,
  HeadingToken,
  IndexHeading,
  IndexLink,
  IndexPhase,
  IndexProgress,
  IsNotePathOptions,
  LinkKind,
  LinkToken,
  LinkWhere,
  NewNoteNameCheck,
  NoteScan,
  ReconcilePlan,
  RewriteResult,
  SkippedKind,
  SkippedRange,
  TagToken,
  TextRange,
  VaultBacklink,
  VaultConfigName,
  VaultExcerpt,
  VaultIndexEntry,
  VaultIndexFile,
  VaultIndexState,
  VaultListedNote,
  VaultPathIndex,
  VaultSearchHit,
  WikilinkContext,
  OscodeMark,
  VaultPrivacy,
  VaultPrivacyConfig,
  VaultPrivacyNarrowing,
  VaultVisibility,
  VaultVisibilityInput,
  // Vault M6 (CTO K2, K4, K7, K8, K10, K11, K15)
  AttachmentFolderSetting,
  AttachmentMeta,
  AttachmentMime,
  BytesRead,
  BytesReadRefusal,
  CalloutFamily,
  CalloutHead,
  DailyNoteConfig,
  DateParts,
  LinkRewriteEdit,
  LinkRewriteLeftReason,
  LinkRewritePlan,
  LinkRewriteSource,
  MoveSourcePaths,
  ReadBytesOptions,
  TaskToggleResult,
  TemplateFill,
  UnlinkedMention,
  VaultDateFormatResult,
  VaultQuery,
  VaultQueryClause,
  VaultQueryClauseKind,
  VaultSearchOptions,
  VaultTask,
  VaultTitleHit,
  VaultTrashEntry,
} from './harness/vault/types.js';
// Vault privacy (Vault M4, CTO I4, I5): one judge of which notes are hidden and
// which stay on this computer, and the stub a leaving seat sees in their place.
export {
  LOCAL_ONLY_STUB,
  compileVaultPrivacy,
  oscodeMarks,
  withholdLocalOnly,
} from './harness/vault/privacy.js';
// The vault context pack (Vault M4, CTO I6 to I10), pure, so the app's drivers
// (M5) render the exact pack the engine does.
export {
  PACK_BY_CLASS,
  PACK_PINS_MAX,
  PACK_PLAN_MAX_READS,
  VAULT_NOTES_FRAMING,
  VAULT_PACK_COLD_MS,
  buildContextPack,
  packBudgetTokens,
  packModeFor,
  planContextPack,
} from './harness/vaultContext.js';
export type {
  ContextPack,
  PackBuildInput,
  PackInput,
  PackLayer,
  PackMode,
  PackSource,
  PreparedVaultContext,
  VaultContextSetting,
  VaultContextSource,
} from './harness/vaultContext.js';
// The served window (Vault M4, CTO I1, I2): the app computes the same number
// the engine sends (M5).
export {
  NUM_CTX_CEILING,
  NUM_CTX_RAM_BANDS_GB,
  VAULT_PACK_MAX_TOKENS,
  numCtxCeiling,
  servedContextTokens,
} from './harness/profile.js';
export type { ModelClass } from './harness/profile.js';
// Every app seat's class and profile (Vault M5, CTO J2, J4), derived exactly as
// the engine derives its own.
export { MODEL_CLASSES, deriveModelClass, deriveProfile } from './harness/profile.js';
export type { DeriveInput, ModelClassPolicy, ModelClassProfile } from './harness/profile.js';
// What counts as this computer's own network (Vault M5, CTO J2): one pure
// judge, by address, shared with the engine's isLocalHost.
export { hostIsLocal, isIPv4Literal, isIPv6Literal, tailnetSuffixOf } from './harness/locality.js';
export type { HostIsLocalOptions } from './harness/locality.js';
// The handoff (Vault M5, CTO J11 to J13): extractive, offline, no thinking.
export {
  HANDOFF_MAX_AGE_DAYS,
  HANDOFF_MAX_BYTES,
  HANDOFF_MAX_TOKENS,
  HANDOFF_MIN_TURNS,
  HANDOFF_WINDOW_FRACTION,
  buildHandoff,
  fitSeed,
  handoffBudgetTokens,
} from './harness/handoff.js';
export type { Handoff, HandoffTurn } from './harness/handoff.js';
// The vault tools' shared descriptions (Vault M5, CTO J10).
export { VAULT_TOOL_TEXT, vaultToolText } from './harness/vault/toolText.js';
export type { VaultToolName } from './harness/vault/toolText.js';
// The daemon's vault wire (Vault M5, CTO J6, J7): the hub's routes, the
// additive /chat and session-create fields.
export {
  VAULT_CONFIG_ROUTE,
  VAULT_INDEX_ROUTE,
  VAULT_NOTES_ROUTE,
  VAULT_PRIVACY_ROUTE,
  VAULT_ROUTE_PREFIX,
  VAULT_WIRE_LIST_MAX,
  VAULT_WIRE_NOTE_MAX_BYTES,
  vaultNoteRoute,
  // Vault M6 (CTO K13)
  VAULT_ATTACHMENTS_ROUTE,
  VAULT_FILES_ROUTE,
  VAULT_FOLDERS_RENAME_ROUTE,
  VAULT_FOLDERS_ROUTE,
  VAULT_RENAME_ROUTE,
  VAULT_TRASH_RESTORE_ROUTE,
  VAULT_TRASH_ROUTE,
  vaultFileRoute,
} from './daemon/vaultWire.js';
export type {
  ChatContextPackEvent,
  ChatVaultFields,
  HubNoteMeta,
  SessionCreateVaultFields,
  VaultConfigResponse,
  VaultNoteConflictResponse,
  VaultNoteDeleteResponse,
  VaultNotePutBody,
  VaultNotePutResponse,
  VaultNoteReadResponse,
  VaultNotesListResponse,
  VaultPrivacyWire,
  VaultWireError,
  // Vault M6 (CTO K13)
  VaultAttachmentsListResponse,
  VaultFolderConflictResponse,
  VaultFolderCreateBody,
  VaultFolderRenameBody,
  VaultFolderRenameResponse,
  VaultFoldersListResponse,
  VaultRenameBody,
  VaultRenameConflictResponse,
  VaultRenameResponse,
  VaultTrashBody,
  VaultTrashConflictResponse,
  VaultTrashEmptyBody,
  VaultTrashEmptyResponse,
  VaultTrashListResponse,
  VaultTrashRestoreBody,
  VaultTrashRestoreResponse,
  VaultTrashResponse,
} from './daemon/vaultWire.js';
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
  nextActionFor,
  BLOCK_NEXT_ACTION,
  REFUSALS,
  SUPPORT_EMAIL,
  detectSignals,
  signalNames,
  StreamScreener,
  countableViolations,
  evaluateEnforcement,
  prepareReport,
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
  TRUST_STATEMENT_TIERS,
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
  ROUTINE_NEEDS_LOCAL_MODEL,
  routineCaps,
  nextSlotAfter,
  presenceOf,
  scheduleDaysLabel,
  scheduleLabel,
  scheduleTimeLabel,
  validateRoutineInput,
  validateSchedule,
} from './routines/model.js';

// Agentic Currents: the roster ids, the per-session handles, the host probe,
// and the Hermes note shapes. Pure; the node side lives in currents/host.ts
// and is NOT imported here.
export type {
  A2aHandle,
  AgenticCurrentId,
  CliAgentCommand,
  CliHandle,
  CurrentsHandles,
  CurrentsHostProbe,
  HarnessCurrentId,
  HarnessCurrentsHandle,
  HermesHandle,
  HermesNote,
  HermesNoteMeta,
  JevHandle,
} from './currents/model.js';
export {
  AGENTIC_CURRENT_IDS,
  CURRENTS_LIMITS,
  HARNESS_CURRENT_IDS,
  isAgenticCurrentId,
  isHarnessCurrentId,
  JEV_DEFAULT_MODEL,
  normalizeHermesBaseUrl,
  normalizeJevBaseUrl,
  parseCurrentsHandles,
  parseHarnessCurrentsHandle,
} from './currents/model.js';

// The Jev decision client and the harness advisor, browser-safe (fetch only,
// no Node built-ins), so the app can reuse the same tested jobs the engine
// uses instead of a second implementation.
export type {
  ClassifyInput,
  ClassifyResult,
  FetchLike,
  GateResult,
  JevAnswers,
  JevQuestions,
  JudgeResult,
} from './harness/jev.js';
export { JevAdvisor, JEV_SYSTEMONE_PATH } from './harness/jev.js';

// Web search for local models: the one-line request a model writes, and the
// stream filter that keeps that line off the screen. Shared so the phone and
// the desktop's free chat speak the same rule.
export {
  NO_SEARCH_NOTE,
  SEARCH_PREFIX,
  SEARCH_PROTOCOL_NOTE,
  SearchLineFilter,
  parseSearchLine,
} from './harness/localSearch.js';

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

// The Vault index (Vault M3, CTO H3) and the readConfig folder rule (H5).
// Pure: the index takes the shared core's grammar and resolution as an
// injected VaultIndexCore; hosts own every read, write and file.
export {
  BM25_B,
  BM25_K1,
  CORE_VERSION,
  INDEX_BODY_MAX_BYTES,
  INDEX_CHECKPOINT_MS,
  INDEX_CHECKPOINT_NOTES,
  INDEX_FILE_MAX_BYTES,
  INDEX_MAX_BODY_TERMS,
  INDEX_MAX_NOTES,
  INDEX_PROGRESS_EVERY_MS,
  INDEX_PROGRESS_SHOW_AFTER_MS,
  INDEX_READ_CONCURRENCY,
  INDEX_SLICE_MS,
  TERM_WEIGHTS,
  VaultIndex,
  compareCodePoints,
  listedVersion,
  loadIndex,
  pathBaseKey,
  planReconcile,
  serializeIndex,
  utf8Bytes,
} from './harness/vault/index.js';
export type {
  IndexedNote,
  LoadedIndex,
  VaultReconcilePlan,
  ResolvedLink,
  SerializedIndex,
  VaultIndexCore,
  VaultIndexCounters,
  VaultIndexOptions,
} from './harness/vault/index.js';
export { BODY_STOPWORDS, eachTerm, queryTerms, tokenize } from './harness/vault/tokenize.js';
export {
  CONFIG_DIR_NAME,
  VAULT_CONFIG_FILES,
  VAULT_CONFIG_MAX_BYTES,
  detectConfigDir,
  isConfigDirCandidate,
  isVaultConfigName,
} from './harness/vault/configDir.js';
export type { ConfigDirCandidate, ConfigDirPlatform } from './harness/vault/configDir.js';
