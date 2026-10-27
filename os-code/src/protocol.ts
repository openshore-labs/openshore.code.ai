// The browser-safe protocol surface. The native apps (React UI in Electron,
// Capacitor iOS) import ONLY this subpath ('os-code/protocol'): event and
// approval types, the catalog schema, and the capability taxonomy. Every
// value export here is pure (zod and plain data); every runtime import chain
// stays free of Node built-ins, so it bundles cleanly for a WebView.
export type {
  AgentEvent,
  ApprovalAnswer,
  ApprovalRequest,
  CheckpointFileChange,
  CommitStage,
  DriverEvent,
  PermissionMode,
  StageFile,
  StageSecret,
  StopReason,
  TodoItem,
  ToolHandoff,
} from './core/agent/types.js';
export { PERMISSION_MODES } from './core/agent/types.js';
import type { PermissionMode } from './core/agent/types.js';
import type { OfflineReason } from './core/agent/offline.js';
export { INIT_PROMPT } from './core/agent/initPrompt.js';
// The person's own slash commands (P3): OpenShore's built-in names, the
// label a menu shows beside one, and the sentence for a file left out. The
// engine finds and fills them; every surface lists them with these words.
export {
  BUILT_IN_COMMANDS,
  commandFromLabel,
  commandNotLoadedLine,
  isBuiltInCommand,
  parseSlashInput,
} from './core/agent/commandText.js';
export type {
  CommandFrom,
  CommandNotLoadedReason,
  RepoCommand,
  RepoCommandNotLoaded,
} from './core/agent/commandText.js';
// The reserved terminal scope for the plain home-folder shell (no session).
export { HOME_SHELL_ID } from './daemon/homeShellId.js';
// The local addresses a started program prints (P1), so the desktop's command
// card offers the one the engine read as ready.
export { localAddresses } from './core/exec/localAddress.js';

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
  type CatalogFile,
  type CatalogRunner,
  type Library,
  type SourceKind,
} from './market/schema.js';
// The model library (founder, 2026-10-12): sections, categories (Stack
// slots), shelves (jobs), collections, and the pure pick rules, shared by the
// engine and every app.
export {
  SIZE_CLASSES,
  SIZE_CLASS_INFO,
  MEDIA_SLOTS,
  MEDIA_JOBS,
  MEDIA_JOB_INFO,
  slotJobs,
  RUNTIME_INFO,
  LIBRARY_SECTIONS,
  LIBRARY_CATEGORIES,
  LIBRARY_SHELVES,
  LIBRARY_COLLECTIONS,
  isMediaSlot,
  runtimeOf,
  libraryCategory,
  libraryShelf,
  categoryShelves,
  libraryCollection,
  shelfSlot,
  shelfPicks,
  categoryPicks,
  filledShelves,
  filledCategories,
  libraryModelIds,
  picksForModel,
  sizesFor,
  bestPickFor,
  collectionPicks,
  filledCollections,
  searchLibrary,
  libraryProblems,
  withLibrary,
} from './market/library.js';
export type {
  SizeClass,
  SizeClassInfo,
  LibrarySlot,
  MediaSlot,
  MediaJob,
  LibraryJob,
  ModelRuntime,
  RuntimeInfo,
  SectionId,
  CategoryId,
  LibrarySection,
  LibraryCategory,
  LibraryShelf,
  LibraryCollection,
  LibraryPick,
  LibraryDevice,
} from './market/library.js';
// The published catalog's signature (security review, 2026-10-12).
export {
  CATALOG_PUBLIC_KEY,
  SIGNED_CATALOG_FILE,
  olderThanTrusted,
  verifyCatalogBytes,
} from './market/catalogSignature.js';
export type { CatalogVerdict } from './market/catalogSignature.js';

export {
  CAPABILITIES,
  SPECIALIST_ROLES,
  MEDIA_SPECIALIST_ROLES,
  ALL_SPECIALIST_SLOTS,
  ROLE_CATEGORY,
  plainLabel,
} from './router/roles.js';
export { MEDIA_RUNTIMES, toolJobs } from './media/jobs.js';
export { SOURCE_NAMES, SOURCE_HOSTS, allSourceHosts } from './market/sources.js';
export type { MediaRuntime, MediaToolName, MediaJobInfo } from './media/jobs.js';
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
// The free chat's events (tech review ruling 8): what the daemon streams to a phone
// and the desktop's main process forwards to its window. Types only.
export type { FreeChatEvent } from './daemon/freeChat.js';
// The Memory switch's precedence: the app's switch can only turn project
// memory off, and a project's config off always wins.
export { memoryEnabled } from './core/agent/memorySwitch.js';
// Desktop Offline (2026-10-07): the engine's words for working with
// no internet, so the app's door for "no model on your computer can answer
// yet" matches the line the engine ends that turn with. Pure.
export {
  ONLINE_AGAIN_NOTE,
  offlineNowDenied,
  offlineNeedsLocalModel,
  offlineNoModelLine,
  offlineNote,
  rankLocalModels,
} from './core/agent/offline.js';
export type { MachineOffline, OfflineReason } from './core/agent/offline.js';
// A model download that fails with the network up says what failed and the
// way on, in the same words on the desktop and in the engine. Pure.
export { pullFailedLine, pullFailure } from './market/pullLine.js';
export type { PullFailure, PullResult } from './market/pullLine.js';
// A pick with license conditions is got only after the person accepts them,
// in the same words in the app and the CLI. Pure.
export { needsTermsAccepted, termsQuestion, termsLines, TERMS_ACCEPT } from './market/terms.js';
// The line diff approvals show, shared so the Vault's resolve sheet compares
// two versions of a note with the exact same lines (Vault M1, 1.1). Pure and
// import-free.
export { unifiedDiff } from './core/edit/diff.js';
export type { DiffStats } from './core/edit/diff.js';
// The Vault's shared core (Vault M3, tech review H1, H2 and H4): the one new-name
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
  // Vault M7 (tech review L8): the agent's hard deny under any dot folder.
  isAgentWritablePath,
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
// Vault M6 "Obsidian day one" (tech review K4, K7, K8, K10, K11, K15): the pure core
// the app and the engine share. Stubs until each stream lands.
export { planLinkRewrites, rewriteForMoves } from './harness/vault/move.js';
export { highlightRanges, parseVaultQuery, phrasesMatch } from './harness/vault/query.js';
export {
  VAULT_DAILY_DEFAULTS,
  dailyNotePath,
  datePartsOf,
  fillTemplate,
  formatVaultDate,
} from './harness/vault/dates.js';
export {
  UNLINKED_MENTION_CAP,
  blockAnchorAt,
  findHighlights,
  findUnlinkedMentions,
  listTasks,
  maskComments,
  outlineOf,
  parseCallout,
  sectionOf,
  toggleTaskAt,
} from './harness/vault/markdown.js';
export type { VaultOutlineItem } from './harness/vault/markdown.js';
export {
  VAULT_ATTACHMENT_MAX_BYTES,
  attachmentLinkText,
  attachmentMime,
  bytesMatchMime,
  isAttachmentPath,
  resolveAttachment,
} from './harness/vault/attachments.js';
// Vault M7 "The customization surface" (tech review L1 to L4, L9, L10, L13): the
// vault settings core, provenance, and the hand-written YAML scalar. Stubs
// until each stream lands (settings.ts stream A, provenance.ts stream B).
export {
  VAULT_SETTINGS_DEFAULTS,
  VAULT_SETTINGS_FIELDS,
  VAULT_SETTINGS_LIST_MAX,
  VAULT_SETTINGS_STRING_MAX,
  WIDENING_KEYS,
  WIDENING_PLAIN,
  configJson,
  obsidianIgnoreFilters,
  parseVaultSettingsFile,
  patchVaultSettingsFile,
  readDailyNotesConfig,
  readObsidianAppConfig,
  readTemplatesConfig,
  resolveVaultSettings,
  retrievalSkipped,
  unionNarrowing,
  vaultContextOn,
  vaultHandoffOn,
  vaultPackSize,
} from './harness/vault/settings.js';
export type {
  DailyNotesConfig,
  ObsidianAppConfig,
  TemplatesConfig,
} from './harness/vault/settings.js';
export { PROV_KEYS, mergeProvenance, readProvenance } from './harness/vault/provenance.js';
export { yamlString } from './harness/vault/yamlScalar.js';
// The Vault's shared core contract (Vault M3, tech review H1 to H5): the types the
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
  // Vault M6 (tech review K2, K4, K7, K8, K10, K11, K15)
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
  // Vault M7 (tech review L1 to L14)
  ConfigWriteGuard,
  ConfigWriteResult,
  NoteProvenance,
  ProvKey,
  ProvSize,
  ProvSource,
  ProvWhere,
  ProvenanceFields,
  ProvenanceMerge,
  ResolvedVaultSettings,
  VaultDeleteMode,
  VaultEditorFont,
  VaultEditorSize,
  VaultIgnoreFilters,
  VaultLinkFormat,
  VaultLinkStyle,
  VaultLinkUpdateRule,
  VaultNewNoteLocation,
  VaultOpenMode,
  VaultOverrides,
  VaultPackSize,
  VaultSettingsConfigName,
  VaultSettingsField,
  VaultSettingsFile,
  VaultSettingsFileState,
  VaultSettingsParse,
  VaultSettingsPatch,
  VaultSettingsReads,
  VaultSettingsSetAside,
  VaultSettingsSetAsideReason,
  VaultSettingsSource,
  VaultTreeSort,
} from './harness/vault/types.js';
// Vault privacy (Vault M4, tech review I4, I5): one judge of which notes are hidden and
// which stay on this computer, and the stub a leaving seat sees in their place.
export {
  LOCAL_ONLY_STUB,
  compileVaultPrivacy,
  oscodeMarks,
  withholdLocalOnly,
} from './harness/vault/privacy.js';
// The vault context pack (Vault M4, tech review I6 to I10), pure, so the app's drivers
// (M5) render the exact pack the engine does.
export {
  PACK_BY_CLASS,
  PACK_PINS_MAX,
  PACK_PLAN_MAX_READS,
  PACK_SIZE_FACTOR,
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
// The served window (Vault M4, tech review I1, I2): the app computes the same number
// the engine sends (M5).
export {
  NUM_CTX_CEILING,
  NUM_CTX_RAM_BANDS_GB,
  VAULT_PACK_MAX_TOKENS,
  numCtxCeiling,
  servedContextTokens,
} from './harness/profile.js';
export type { ModelClass } from './harness/profile.js';
// Every app seat's class and profile (Vault M5, tech review J2, J4), derived exactly as
// the engine derives its own.
export { MODEL_CLASSES, deriveModelClass, deriveProfile } from './harness/profile.js';
export type { DeriveInput, ModelClassPolicy, ModelClassProfile } from './harness/profile.js';
// What counts as this computer's own network (Vault M5, tech review J2): one pure
// judge, by address, shared with the engine's isLocalHost. A seat is judged by
// its model's name too: an Ollama cloud tag leaves through a local Ollama, so
// the app reads the engine's own seat judge (privacy review, 2026-10-08).
// `hostIsLoopback` is the narrower test for words that say "on this computer"
// (UX and copy review, 2026-10-08): never the LAN or the tailnet.
export {
  hostIsLocal,
  hostIsLoopback,
  isIPv4Literal,
  isIPv6Literal,
  isOllamaCloudTag,
  tailnetSuffixOf,
} from './harness/locality.js';
export { leavesThisNetwork, seatLeaves } from './providers/types.js';
export type { HostIsLocalOptions } from './harness/locality.js';
// The words said once a chat holds a private note's text (UX and copy review,
// 2026-10-08, A, D, F, G, H): one source for the engine and the app.
export {
  HANDOFF_LOCAL_ONLY_DENIED,
  HANDOFF_PIN_DENIED,
  MEMORY_DECLINED,
  MEMORY_ROUTINE_DENIED,
  MEMORY_ROUTINE_REFUSED,
  MEMORY_WHY_PIN,
  MEMORY_WHY_READ,
  PRIVATE_WEB_LEAD_PIN,
  PRIVATE_WEB_LEAD_READ,
  WEB_DECLINED,
  handoffCardSummary,
  handoffDeclined,
  handoffRefusalLine,
  memoryWhyLine,
  placeholderLine,
  privatePageCard,
  privateSearchCard,
  privateWebLead,
  searchServiceName,
} from './harness/privacyLines.js';
export type { PrivateCause } from './harness/privacyLines.js';
// The handoff (Vault M5, tech review J11 to J13): extractive, offline, no thinking.
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
// The vault tools' shared descriptions (Vault M5, tech review J10).
export { VAULT_TOOL_TEXT, vaultToolText } from './harness/vault/toolText.js';
export type { VaultToolName } from './harness/vault/toolText.js';
// The daemon's vault wire (Vault M5, tech review J6, J7): the hub's routes, the
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
  // Vault M6 (tech review K13)
  VAULT_ATTACHMENTS_ROUTE,
  VAULT_FILES_ROUTE,
  VAULT_FOLDERS_RENAME_ROUTE,
  VAULT_FOLDERS_ROUTE,
  VAULT_RENAME_ROUTE,
  VAULT_TRASH_RESTORE_ROUTE,
  VAULT_TRASH_ROUTE,
  vaultFileRoute,
  // Vault M7 (tech review L7)
  VAULT_SETTINGS_CONFIG_NAME,
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
  // Vault M6 (tech review K13)
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
  // Vault M7 (tech review L7)
  VaultConfigConflictResponse,
  VaultConfigPutBody,
  VaultConfigPutResponse,
  VaultConfigWriteResult,
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
  RoutineClockStatus,
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
  SEARCHED_NOTE,
  SEARCH_PREFIX,
  SEARCH_PROTOCOL_NOTE,
  SearchLineFilter,
  parseSearchLine,
  searchFirstQuery,
} from './harness/localSearch.js';

// Project Wayfinder: a project's own environment, the `.env` text, the
// limits a session create is held to, and the network levels.
export {
  PROJECT_ENV_MAX_VALUE,
  PROJECT_ENV_MAX_VARS,
  PROJECT_NETWORKS,
  SETUP_SCRIPT_MAX_CHARS,
  cleanProjectEnv,
  cleanSetupScript,
  isEnvName,
  isProjectNetwork,
  parseEnvText,
  projectNetworkNote,
} from './harness/projectEnv.js';
export type { ProjectNetwork } from './harness/projectEnv.js';

// Lessons: a project's harness keeps a few approved lessons from what
// actually happened (step 8 of the harness plan, brought forward 2026-10-27).
export {
  LESSONS_MAX,
  LESSON_MAX_CHARS,
  alreadyKept,
  cleanLesson,
  distilPrompt,
  hasSetback,
  isCorrection,
  lessonBudgetChars,
  lessonDoubtful,
  lessonFromCorrection,
  lessonSource,
  lessonsBlock,
  lessonsToRide,
  parseDistilled,
  scoreLessons,
  signalsFrom,
  taskWentWell,
} from './harness/lessons.js';
export type { Lesson, LessonSignal } from './harness/lessons.js';

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
  /** `kind` is judged by address: cloud when its requests leave the
   *  computer's network. */
  orchestrator?: {
    model: string;
    provider: string;
    kind: 'local' | 'cloud';
    /** Set when it stays on this network and its server is this computer
     *  itself (`hostIsLoopback`, never the LAN or the tailnet), so a chip can
     *  say "On this computer" rather than "On your network" (UX and copy review,
     *  2026-10-08). Additive: absent from an older daemon. */
    onThisComputer?: true;
  };
  /** Each placed specialist. `kind` is judged as the orchestrator's is
   *  (seatLeaves: by address and by an Ollama cloud tag), and
   *  `onThisComputer` as above, on a specialist that stays. Both additive:
   *  an older daemon sends neither, and a client then shows no chip. */
  specialists: Array<{
    role: string;
    model: string;
    kind?: 'local' | 'cloud';
    onThisComputer?: true;
  }>;
  /** This daemon takes a local-only turn (POST /sessions/:id/input with
   *  `localOnly: true`) and holds it to the engine's D5 rules, so a private
   *  plan's step may run here (UX and copy review, 2026-10-08, J). Absent from an
   *  older daemon, which would run such a step unmarked. */
  acceptsLocalOnly?: true;
  /** Why the computer works offline right now (Desktop Offline): no network,
   *  or the person chose Offline there. Absent while it is online, and from
   *  an older daemon, which reads as online. GET /health carries it too. */
  offline?: OfflineReason;
  /** While offline, the model that answers on the computer (the engine's
   *  offline seat). Absent when no model there can answer. */
  offlineSeat?: { model: string; provider: string };
}

// Keys on your server (2026-10-09): the routes a docked server answers to an
// admin device, and only on a server (`GET /health` says `keysOnServer`).
// No row ever carries a key, a fingerprint, or a date.
export { PROVIDER_ID_PATTERN, isProviderId } from './config/providerKeyRef.js';

/** One provider holding a key on the server (GET /keys). */
export interface DaemonProviderKey {
  id: string;
  label: string;
  /** The host its requests go to, e.g. "openrouter.ai". */
  host: string;
}

export interface DaemonKeysList {
  keys: DaemonProviderKey[];
}

/** PUT /keys/:id. `baseUrl` is the provider's versioned OpenAI-compatible
 *  base, https and off the server's own network (a model server on it is set
 *  up in the stack instead); a provider the engine names may leave it out.
 *  `workspaceId` goes only with the Claude key. */
export interface DaemonPutKeyBody {
  key: string;
  baseUrl?: string;
  label?: string;
  workspaceId?: string;
}

export interface DaemonPutKeyAnswer {
  ok: true;
  provider: DaemonProviderKey;
}

/** DELETE /keys/:id and DELETE /keys (every key the server keeps, for
 *  forgetting it). `slotsCleared` names each stack slot that pointed at a
 *  removed provider ('orchestrator', or a specialist role). */
export interface DaemonRemoveKeysAnswer {
  ok: true;
  removed: string[];
  slotsCleared: string[];
}

/** POST /stack/orchestrator: place a configured provider's model as the
 *  server's model. `contextTokens` is the window the app knows for it, kept
 *  only for a provider off the server's network. */
export interface DaemonPlaceOrchestratorBody {
  provider: string;
  model: string;
  contextTokens?: number;
}

export interface DaemonPlaceOrchestratorAnswer {
  ok: true;
  orchestrator: {
    provider: string;
    model: string;
    kind: 'local' | 'cloud';
    contextTokens?: number;
  };
}

// The Vault index (Vault M3, tech review H3) and the readConfig folder rule (H5).
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
