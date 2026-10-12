// The app store (zustand): conversations, navigation, settings, toasts.
// Drivers live OUTSIDE React state (they hold sockets and native handles);
// the store holds only renderable data. Desktop-backed conversations rebuild
// their transcript by replaying the engine's journal, so the phone and the
// desktop can both close and reopen with nothing lost.
import { create } from 'zustand';
import type { DriverEvent, PullFailure, ReconcileResult } from 'os-code/protocol';
import {
  emptyThread,
  seedFromTranscript,
  sourceLabel,
  type SeedTurn,
  type ThreadItem,
  type Account,
  type BuildRun,
  type Conversation,
  type ConversationSource,
  type CrewAgent,
  type Entitlement,
  type LaunchState,
  type LaunchTarget,
  type Org,
  type OrgMember,
  type OrgRole,
  type Project,
  type ProjectAccess,
  type AppVaultContextSetting,
  type AppVaultHandoffSetting,
  type AppVaultPackSize,
  type VaultPrivacySetting,
  PROJECT_VAULT_PINS_MAX,
  VAULT_PRIVACY_DEFAULTS,
} from './types.js';
import { plainError } from '../lib/plainError.js';
import { APP_LOCK_OFF, APP_LOCK_ON, askUnlock, type AppLockSetting } from '../lib/appLock.js';
import {
  addPasskey as passkeyAdd,
  listPasskeys as passkeyList,
  recentEmailProof,
  removePasskey as passkeyRemove,
  signInWithPasskey as passkeySignIn,
  type Passkey,
} from '../lib/passkeys.js';
import { tierForSeats, type AccountType } from '../lib/plans.js';
import {
  CODEMAGIC_SECRET_KEY,
  buildLogExcerpt,
  getBuild,
  isTerminal,
  triggerBuild,
} from '../lib/codemagic.js';
import {
  REPO_CONNECTORS,
  repoSecretKey,
  type HomeRepo,
  type OutboxFile,
  type OutboxItem,
  type RepoPlatform,
  type RepoState,
} from '../lib/repos.js';
import {
  clearRepoCache,
  firstWorkspace,
  hydrateRepoCache,
  repoContextLine,
} from '../lib/chatRepos.js';
import {
  PLAN_APPROVAL_LINE,
  REACHING_COMPUTER,
  reduceEvent,
  snapshotThread,
  titleFrom,
  legacyTitleFrom,
} from './transcript.js';
import {
  HUB_NO_ANSWER,
  type AppVaultPack,
  type ChatDriver,
  type HubLinkState,
} from '../drivers/types.js';
import { ElectronDriver } from '../drivers/electronDriver.js';
import {
  RemoteDriver,
  daemonApplyOutbox,
  daemonClearHandoffs,
  daemonCreateSession,
  daemonForgetSelf,
  daemonHealth,
  daemonVerifyCommit,
  type DaemonTarget,
} from '../drivers/remoteDriver.js';
import {
  applyResult,
  confirm,
  itemBytes,
  pendingForRepo,
  stopsBatch,
  withinCaps,
} from '../lib/repoSync.js';
import {
  del as supabaseDelete,
  insert as supabaseInsert,
  invokeFunction as supabaseInvoke,
  isConfigured as authConfigured,
  readAuthCallback,
  exchangeAuthCode,
  verifyEmailCode,
  sendEmailSignIn,
  readUserPrefs,
  writeUserPrefs,
  rpc as supabaseRpc,
  select as supabaseSelect,
  signOut as supabaseSignOut,
  update as supabaseUpdate,
  type Session,
} from '../lib/supabase.js';
import {
  memberRowsForPush,
  serverToLocalOrg,
  type ServerMember,
  type ServerOrg,
} from './orgSync.js';
import {
  AuthExpiredError,
  clearSession,
  freshSession,
  loadStoredSession,
  saveSession,
} from '../lib/authSession.js';
import { beatDesktopSession, registerPushForDaemon } from '../lib/push.js';
import {
  approvalNotice,
  askForNotices,
  decodeTap,
  downloadNoticeCopy,
  postChatNotice,
  replyNotice,
  syncNoticePrefs,
} from '../lib/notices.js';
import {
  autoProfile,
  effectiveProfile,
  locationAllowed,
  PROFILE_ORDER,
  type Connectivity,
  type ProfileId,
} from '../lib/profiles.js';
import {
  PROVIDERS,
  applyLiveModels,
  fetchLiveModels,
  pickLiveModels,
  providerInfo,
  providerModelLabel,
  providerSecretKey,
  validateProviderKey,
  type KeyCheck,
  type ProviderModel,
} from '../lib/providers.js';
import { claudeModelLabel } from '../lib/claudeModels.js';
import {
  cloudWaitLine,
  desktopOnline,
  LOCAL_MODEL_SEAT_FAILED,
  localModelFailedLine,
  networkUp,
  offlineChosen,
  offlineNow,
  reportDesktopOffline,
} from './offlineOps.js';
import { thisDeviceNoun } from '../lib/deviceNoun.js';
import { isSetupFailure, rescueSource } from '../lib/chatRescue.js';
import { CloudClaudeDriver, DEFAULT_CLAUDE_MODEL } from '../drivers/cloudClaudeDriver.js';
import { CloudOpenAiDriver } from '../drivers/cloudOpenAiDriver.js';
import { DEFAULT_EFFORT, setActiveEffort, type Effort } from '../lib/effort.js';
import { chainOfThoughtOn, setChainOfThought } from '../lib/chainOfThought.js';
import { setPromptCache } from '../lib/claudeCache.js';
import type { GreetingStyle } from '../lib/greetingDecks.js';
import {
  DEFAULT_PERMISSION_MODE,
  normalizePermissionMode,
  type PermissionMode,
} from '../lib/permissionMode.js';
import {
  canControlTerminal as canControlTerminalFor,
  decideApproval,
  terminalTargetId,
} from '../lib/terminalControl.js';
import {
  canControlCodemagic as canControlCodemagicFor,
  decideCodemagicApproval,
} from '../lib/codemagicControl.js';
import { hapticSuccess } from '../lib/haptics.js';
import { NOTHING_SHOWN, celebratesTurn, turnShown } from './turnEndOps.js';
import type { Attachment } from '../lib/attachments.js';
import { OnDeviceDriver } from '../drivers/onDeviceDriver.js';
import { MockDriver } from '../drivers/mockDriver.js';
import { StackDriver, type StackVaultTools } from '../drivers/stackDriver.js';
import { DesktopChatDriver, ipcFreeChat } from '../drivers/desktopChatDriver.js';
import {
  FIRST_SEAT_COPY,
  defaultComposerSource,
  engineChatReady,
  heldMessagePlan,
  joinHeld,
  waitsOnFirstSeat,
  type HeldFirstMessage,
} from './firstRunOps.js';
import { guardDriver } from '../drivers/guardedDriver.js';
import { setEthicsAuth } from '../lib/ethics.js';
import { setReviewsAuth } from '../lib/reviews.js';
import { setAbuseReviewAuth } from '../lib/abuseReview.js';
import {
  HARBOR_READY_MESSAGE,
  advanceMessage,
  harborForkMessage,
  nextChoiceMessage,
  stepsAhead,
  type NextChoice,
  type MenuReturn,
  type SetupStepId,
  editChoiceLead,
  editChoiceMessage,
  menuStepIntro,
  menuSteps,
  repoConnectedMessage,
  setupHelpIntent,
  setupMenuMessage,
  startSetupMessage,
  SETUP_LATER_LINE,
  walkActive,
  EDIT_CHOICE_QUESTION,
  guideContextLine,
  nextStep,
  openingMessage,
  resumeMessage,
  setupIntent,
  stepHandled,
  type GuidedSetupProgress,
  type SetupFacts,
} from '../lib/guidedSetup.js';
import { REVEAL_SKIP_EVENT, prefersReducedMotion } from '../lib/streamSmoothing.js';
import { SETUP_CHAT_TITLE } from '../lib/chatTitle.js';
import { parsePairingQr } from '../lib/qrDecode.js';
import {
  GREETING_PACE,
  INTRO_START_MS,
  READ_PAUSE_MS,
  GREETING_TO_WALK_PAUSE_MS,
  WALK_PACE,
  introFinished,
  introSkipped,
  inkDurationMs,
  setIntroPlaying,
} from '../lib/introWalk.js';
import { WATER_AFTER_LINE_MS } from '../lib/slackWater.js';
import {
  HARBOR_MINI_BUNDLED,
  HARBOR_MINI_GREETING,
  HARBOR_MINI_SETUP_GREETING,
  setHarborMiniContext,
  guidedSetupLine,
  HARBOR_MINI_MODEL_ID,
  HARBOR_MINI_MODEL_NAME,
  HARBOR_MINI_MODEL_URL,
} from '../lib/harborMini.js';
import {
  HARBOR_GREETING,
  HARBOR_MODEL_ID,
  HARBOR_MODEL_NAME,
  HARBOR_MODEL_URL,
  HARBOR_MODEL_VERSION,
  harborWeightsStale,
  isHarbor,
} from '../lib/harbor.js';
import { resolveHarborMaster } from '../lib/harborMaster.js';
import { hardwareFromSummary } from '../lib/firstSeat.js';
import { SEARCH_SECRET_KEY, webSearchOn, type SearchBackend } from '../lib/webSearch.js';
import { pushWebFetchMode } from '../lib/webFetchMode.js';
import { loadInsights, logEvent, logOnce, setInsightsEnabled } from '../lib/insights.js';
import {
  crewControl as computeCrewControl,
  routinesClient,
  CONTROL_REQUIRES_DOCK,
  type CrewControl,
  type RoutineClockStatus,
  type RoutineInput,
  type RoutineRun,
  type RoutineView,
} from '../lib/routines.js';
import {
  refKey as stackRefKey,
  harborRef,
  refReady,
  stackReady,
  stackForProfile,
  stackVisionReady as stackVisionReadyPure,
  type ReadinessSignals,
  type AppStack,
  type ProfileStacks,
  type Placement,
  type StackModelRef,
} from '../lib/stack.js';
import { byomSecretKey, type ByomConnection } from '../lib/byom.js';
import {
  currentBenchId,
  isCurrentBenchId,
  currentInfo,
  currentSecretKey,
  currentsHandles,
  memoryOverride,
  nextActiveCurrent,
  projectCurrentsSettings,
  type AgenticCurrentId,
  type CurrentConnection,
  type CurrentConnections,
  type CurrentProbes,
  type CurrentsSettings,
  type WayfindingId,
  type WayfindingSettings,
} from '../lib/currents.js';
import { currentsHost, probeCurrent, probeOpenAiCompatible } from '../lib/currentsProbe.js';
import {
  harnessCurrentInfo,
  harnessCurrentSecretKey,
  harnessCurrentsHandle,
  nextActiveHarnessCurrent,
  projectHarnessSettings,
  type HarnessCurrentConnection,
  type HarnessCurrentConnections,
  type HarnessCurrentId,
  type HarnessCurrentProbes,
  type HarnessCurrentsSettings,
} from '../lib/harnessCurrents.js';
import {
  HANDOFF_MAX_BYTES,
  HANDOFF_MIN_TURNS,
  compileVaultPrivacy,
  excerptAt,
  resolveWikilink,
  normalizeHermesBaseUrl,
  normalizeJevBaseUrl,
  vaultConflictCopyPath,
  foldPath,
  listTasks,
  mergeProvenance,
  unionNarrowing,
  type AttachmentMeta,
  type BytesRead,
  type ReadBytesOptions,
  type CurrentsHostProbe,
  type ResolvedVaultSettings,
  type VaultPrivacy,
  type VaultSettingsPatch,
  type VaultVisibility,
} from 'os-code/protocol';
import {
  clearHandoffs,
  desktopHandoffNote,
  handoffNotePath,
  handoffNoteText,
  localDate,
  planSwitchSeed,
  readHandoff,
  spokenTurns,
  switchNoteText,
  wholeHandoff,
  writeHandoff,
  type StoredHandoff,
  type SwitchSeedPlan,
} from './handoffs.js';
import { packSeatFor, hubTailnetSuffix, type PackSeatContext } from '../lib/vaultSeat.js';
import { clearCurrentStateCache, createAppVaultPack } from '../lib/vaultPackSource.js';
import {
  githubRepoReader,
  localRepoReader,
  primaryRepoSource,
  type RepoReader,
} from '../lib/projectMemoryRead.js';
import { CURRENT_STATE_FILE, memoryFilePath, sanitizeFolderSegment } from '../lib/projectMemory.js';
import {
  appVaultPrivacy,
  hubMachinePackSize,
  hubPrivacyCache,
  hubPrivacySource,
  readMachinePackSize,
} from '../lib/vaultPrivacy.js';
import {
  agentRecentNotes,
  excerptForSeat,
  noteFactsFromText,
  pickerNotes,
  pushAgentRecent,
  type ComposerExcerptResult,
  type ComposerSeat,
  type VaultNoteFacts,
  type VaultPickerNote,
} from '../lib/vaultExcerpt.js';
import { HUB_REPOINT_TOAST, HUB_UNPAIR_TOAST } from '../lib/vaultCopy.js';
// The hub vault's link and pairing rule, from the module itself (not the
// gitos barrel), so a test that fakes the storage roster still gets them.
import {
  hubPairPlan,
  hubPersonKey,
  hubUnpairTarget,
  hubReach,
  hubVaultLink,
  setHubVaultLink,
  type HubPairPlan,
  type VaultBeforeHub,
  type VaultHubOffer,
} from '../lib/gitos/hub.js';
import { DEVICE_CONTEXT_TOKENS, ensureDeviceModel } from '../drivers/deviceModel.js';
import { canEdit, projectPermissionFor } from '../lib/projectAccess.js';
import {
  createOrgProject,
  deleteOrgProject,
  listOrgProjects,
  mergeSharedProjects,
  revokeOrgProjectAccess,
  setOrgProjectAccess,
  updateOrgProject,
} from '../lib/orgProjects.js';
import { SETUP_GUIDES, type SetupGuideId } from '../lib/setupGuides.js';
import { NO_BRAIN_GUIDE_NOTE, pacedOpeningFor } from '../lib/guidePacing.js';
import { formatBytes } from '../lib/modelStorage.js';
import {
  providerFor,
  probeReady,
  connectGdrive,
  disconnectGdrive,
  isGdriveConnected,
  setOrgVaultAuth,
  resetOrgVault,
  onOrgVaultPlan,
  onOrgVaultNotMember,
  setOrgVaultDeleteRole,
  clearOrgVaultFull,
  refreshOrgVaultPlan,
  type OrgVaultPlan,
  type OrgVaultDeleteRole,
  isNotePath,
  type GitosResource,
  type Lease,
  type StorageProvider,
  type StorageProviderId,
  type StoredFile,
  type StoredFileMeta,
} from '../lib/gitos/index.js';
import {
  connectRepoOAuth as runRepoOAuthConnect,
  repoToken,
  disconnectRepoOAuth,
  resumeRepoOAuthFromLink,
} from '../lib/gitos/repoOAuth.js';
import {
  TEAM_PATH_MAX,
  fitMadeName,
  normalizeNotePath,
  noteFolder,
  noteTitle,
  restoreEol,
} from '../lib/vault.js';
import {
  currentVaultIndex,
  dropVaultIndex,
  shutVaultIndex,
  vaultIndexFor,
  warmVaultIndex,
  type VaultIndexHost,
  type VaultIndexTarget,
} from '../lib/vaultIndexHost.js';
import {
  versionOf,
  type RemoveResult,
  type TrashEntry,
  type TrashPartial,
  type WriteGuard,
  type WriteResult,
} from '../lib/gitos/providers.js';
import { vaultCaps, type VaultCaps } from '../lib/vaultCaps.js';
import { clearVaultTodayCache, resolveVaultToday, vaultTodayLine } from '../lib/vaultToday.js';
import {
  cachedVaultSettings,
  clearVaultSettingsCache,
  loadVaultSettings,
  saveVaultSetting,
  vaultNarrowingStamp,
  vaultSettingsHint,
  type VaultSettingSave,
} from '../lib/vaultSettings.js';
import { applyVaultStarter, vaultStarterOffered } from '../lib/vaultStarter.js';
import {
  appHandoffOn,
  appPackSize,
  appVaultOverrides,
  type VaultEngineRoomSource,
} from '../lib/vaultDevice.js';
import {
  dropVaultRecent,
  pushVaultRecent,
  renameVaultRecent,
  type VaultRecentEntry,
  type VaultSearchSource,
} from '../lib/vaultSearch.js';
import type { VaultAutosave } from '../lib/vaultAutosave.js';
import type { NavOrder } from '../lib/sidebarOrder.js';
import {
  applyMove as opsApplyMove,
  createFolder as opsCreateFolder,
  deleteFolder as opsDeleteFolder,
  deleteNote as opsDeleteNote,
  emptyTrash as opsEmptyTrash,
  openToday as opsOpenToday,
  toggleTask as opsToggleTask,
  folderCounts as opsFolderCounts,
  listTrash as opsListTrash,
  prepareFolderMove as opsPrepareFolderMove,
  prepareNoteMove as opsPrepareNoteMove,
  refusalOf,
  restoreEntry as opsRestoreEntry,
  undoDelete as opsUndoDelete,
  updateTheRest as opsUpdateTheRest,
  type VaultMovePreview,
  type VaultMoveResult as VaultOpsMoveResult,
  type VaultRewriteReport,
  type VaultOpsDeps,
  type VaultOpsOpenNote,
  type VaultRekeyRebase,
  vaultWaitKind,
  type VaultRestoreResult,
  type VaultUndo,
} from './vaultOps.js';
import { authUserState, invokeFunctionWithCode } from '../lib/supabase.js';
import {
  deleteAccount as runAccountDeletion,
  type DeleteAccountAnswer,
  type DeleteAccountOutcome,
} from './accountDeletion.js';
import { vaultPollDelayMs } from '../lib/vaultPoll.js';
import {
  VAULT_LEASE_RENEW_MS,
  VAULT_LEASE_TTL_MS,
  vaultDeviceKind,
  vaultLeaseMode,
  type VaultLeaseMode,
} from '../lib/vaultLease.js';
import {
  vaultLeaseEnforced,
  HUB_AWAY_READ_ONLY,
  VAULT_TODAY_FAILED,
  VAULT_TICK_FAILED,
  vaultTickChanged,
  vaultTickUnsaved,
  VAULT_GONE_REASON,
  VAULT_UNSEEN_DRAFT_REASON,
  vaultFolderMoveInTrash,
  vaultGoneManyLine,
  VAULT_NO_COPY_NAME_REASON,
  vaultEarlierFolderHeld,
  vaultFolderOffer,
  vaultGoneLine,
  vaultGoneToast,
  vaultCreateWaitToast,
  vaultSaveWaitToast,
  type VaultWaitKind,
  vaultRepointToast,
  vaultLeaveToast,
  vaultReplayCopiesLine,
  vaultResolveToast,
  vaultStaleDeleteToast,
  VAULT_MARKED_NOT_REVIEWED,
  VAULT_MARKED_REVIEWED,
  VAULT_STARTER_NOT_EMPTY,
  VAULT_TEAM_LAPSED_NOT_SAVED,
  VAULT_TEAM_FULL,
  VAULT_TEAM_NOT_MEMBER,
  VAULT_TEAM_NOT_MEMBER_REASON,
  VAULT_TEAM_SETTINGS_ADMINS_ONLY,
  VAULT_TEAM_SIGN_IN_LINE,
  vaultFolderMoveRefused,
  vaultFolderMoveGone,
  vaultFolderMoveTaken,
  vaultRenameFailed,
  vaultTrashGone,
  vaultFolderTrashChanged,
  vaultRefusedLine,
} from '../lib/vaultCopy.js';
import { vaultTeamRefusal, type VaultTeamWrite } from './vaultTeamGate.js';
import { ownerBoundProvider } from './teamOwner.js';
import { dropTeamIndexes, noteTeamIndex } from './teamIndexes.js';
import { projectWorkspaces, reconcileToast, summarizeReconcile } from '../lib/repoReconcile.js';
import { SAMPLE_PROMPT, SAMPLE_REPO_NAME } from '../lib/sampleProject.js';
import { setSearchConsent, type SearchAllowed } from '../lib/localSearch.js';
import {
  WebSearchSheets,
  answersSheet,
  remembersAnswer,
  searchAskShortcut,
  type WebSearchSheet,
} from './webSearchAskOps.js';
import { RELEASE_TIER, featureOn, roomOpen, type ReleaseTier } from '../lib/focus.js';
import {
  ACCOUNT_NOTICE,
  SOURCE_ACCOUNT,
  needsAccount,
  roomAccountFeature,
  type AccountFeature,
} from '../lib/accountGate.js';
import { answerFiles, giveMoreRoomFor } from './securityOps.js';
import {
  REWIND_NOT_NOW,
  cutThread,
  rewindEngine,
  rewindableIds,
  rewindsFiles,
} from './rewindOps.js';
import { exportVaultToFiles, vaultExportLine } from '../lib/vaultExport.js';
import { isEntitled } from '../lib/entitlement.js';
import { appActionPlan, writingVoiceSeed, type ComposerSeed } from './appActionOps.js';
import { sweepProviderRefs } from './providerOps.js';
import {
  byomConnectionsFor,
  markByomForwarding,
  sweepByomRefs,
  type ByomConnectInput,
} from './byomOps.js';
import {
  dockedServers,
  leaveHub,
  removeKeyFromServers,
  type HubKeysCleared,
  type KeyRemoval,
} from './serverKeysOps.js';
import {
  CodingLockedError,
  accountNoticeDue,
  codingLocked,
  detachCodingChats,
  leavesRoomAtSignOut,
} from './gateOps.js';
import {
  SIGNED_OUT_EVERYWHERE,
  SIGNED_OUT_HERE,
  SIGN_OUT_EVERYWHERE_FAILED,
  createPrefsSync,
  noticePrefsChanged,
  revokeEverywhere,
  revokeHere,
} from './signinOps.js';
import {
  CODE_REFUSED,
  LINK_ELSEWHERE,
  LINK_EXPIRED,
  addressKey,
  clearPendingSignIn,
  codeDigits,
  openPendingSignIn,
  readPendingSignIn,
  signedInAsSomeoneElse,
  switchesAccount,
} from './emailSignInOps.js';
import { preferencesChanged, stampOwnChange, type PreferenceStamps } from '../lib/settingsReach.js';
import { readProjectSecrets, writeProjectSecrets } from '../lib/projectSecrets.js';
import {
  bridge,
  type DesktopStatus,
  type PendingUpdate,
  type VaultBringResult,
  type VaultDirInfo,
  type VaultPickResult,
  type VaultRefineChoice,
} from '../lib/electronBridge.js';
import {
  bringPreviousVaultFolder,
  chooseVaultFolder,
  refineVaultFolder,
  vaultFolderInfo,
} from '../lib/vaultFolder.js';
import {
  declineFolderMove,
  shouldOfferFolderMove,
  type VaultMoveOfferState,
} from '../lib/vaultOffer.js';
import { Llama } from '../lib/llamaPlugin.js';
import {
  dataUnlockState,
  isDesktop,
  isPhone,
  openExternal,
  platform,
  sealExistingKeys,
  secretDelete,
  secretGet,
  secretSet,
  storeDelete,
  storeGetJson,
  storeSetJson,
} from '../lib/platform.js';

export type ViewName =
  | 'chat'
  | 'chats'
  | 'marketplace'
  | 'stack'
  | 'stackhealth'
  | 'connections'
  | 'repos'
  | 'vault'
  | 'projects'
  | 'crew'
  | 'crewcommand'
  | 'admin'
  | 'launch'
  | 'pair'
  | 'settings'
  | 'terminal'
  | 'terminalroom'
  | 'project'
  | 'projectmemory'
  | 'onboarding';

export interface AppSettings {
  onboarded: boolean;
  /** The active hub: the desktop this device runs sessions on over the tailnet.
   *  One value, read everywhere a daemon call is made. Multi-hub keeps the saved
   *  set in `daemons` and selecting one writes it here, so every existing reader
   *  keeps working against the active hub. */
  daemon?: DaemonTarget;
  /** Saved hubs, for switching between more than one central computer. The
   *  active one is mirrored into `daemon`. Additive: absent means the single
   *  paired hub in `daemon`, exactly as before. */
  daemons?: DaemonTarget[];
  /** On a desktop only: run sessions on a remote hub (the active `daemon`)
   *  instead of this machine's own engine. A laptop that is not the hub sets
   *  this to reach the central computer, the way the phone does. Off (default)
   *  keeps a desktop as its own engine. Ignored on a phone, which has no engine
   *  of its own. Device local. */
  preferRemoteHub?: boolean;
  claudeModel: string;
  /** Downloaded on-device models: catalog id -> friendly name. */
  deviceModels: Record<string, string>;
  /** Models downloaded to iCloud Drive instead of this device: catalog id ->
   *  friendly name. Their bytes live in the app's iCloud container and are
   *  pulled back on demand when online, so a model too big for the phone still
   *  has a home. Kept separate from deviceModels so the UI can say where it is. */
  cloudModels?: Record<string, string>;
  /** Bring-your-own-model connections: OpenAI-compatible endpoints the user
   *  controls. Metadata only; each connection's API key lives in the secret
   *  store under byomSecretKey(id). */
  byomModels?: ByomConnection[];
  /** gitOS resources: repos and vaults, each pointing at a storage provider.
   *  Metadata only; the bytes live behind the provider seam. */
  gitosResources?: GitosResource[];
  /** The desktop's one-time move card (Vault M1 1.3): what was declined and
   *  when. Device local, never synced. Cleared by any vault move. */
  vaultMoveOffer?: VaultMoveOfferState;
  /** Whether the small built-in guide (Harbor Lite) has been downloaded to this device. */
  harborMiniReady?: boolean;
  /** Whether the preferred guide (Harbor) has been downloaded to this device. */
  harborReady?: boolean;
  /** The HARBOR_MODEL_VERSION of the Harbor weights on this device, recorded at
   *  download. Older (or unrecorded) weights are dropped at launch. */
  harborVersion?: string;
  /** Web search backend for local models, when the user has brought their own key.
   *  Undefined means the zero-config DuckDuckGo default. */
  searchBackend?: SearchBackend;
  /** Whether the Marketplace intro walkthrough has been shown. */
  libraryIntroSeen?: boolean;
  /** The person's sidebar order (founder, 2026-10-01): the rooms above the
   *  recent chats and the rooms below them, as last dragged. Settings and the
   *  sign-in card are pinned and never in it. Unset means the default order;
   *  lib/sidebarOrder.ts resolves it against the rooms this build shows. */
  navOrder?: NavOrder;
  /** Daemon base URLs this device has registered for completion push, so a grant
   *  is minted once per daemon rather than on every desktop session. Device-local
   *  bookkeeping, not synced. */
  pushRegisteredDaemons?: string[];
  /** Web search asks once on this device (the search words go to a search
   *  service, DuckDuckGo unless a key is set): 'allowed' after the person says
   *  yes, 'declined' after they turn it off in Settings; unset until asked
   *  (founder, 2026-10-02, webSearchOn). */
  webSearchConsent?: 'allowed' | 'declined';
  /** Opening web pages for the coding agent on the computer (founder,
   *  2026-10-02): ask (unset), always allow, or never. The computer holds the
   *  real value (`tools.webFetch`); this is the app's copy (lib/webFetchMode). */
  webFetchMode?: 'ask' | 'allow' | 'off';
  /** The user's stack: Reasoning model anchor, active specialists, bench metadata.
   *  Legacy single stack; kept as the migration seed and fallback. The live
   *  configuration is `stacks`, one per connectivity status. */
  stack?: AppStack;
  /** Per-status stacks: one stack for each connectivity profile (docked,
   *  offshore, offline), chosen automatically from the current status. Migrated
   *  once from the single `stack`. */
  stacks?: ProfileStacks;
  /** Project buckets; a saved chat belongs to one. */
  projects?: Project[];
  /** The project new saved chats go into. */
  activeProjectId?: string;
  /** Crew: user-authored agents with personas and call rules. */
  crew?: CrewAgent[];
  /** Account: personal, or a commercial org with members and a plan. */
  account?: Account;
  /** Launch: the Codemagic target and this project's build-run history. */
  launch?: LaunchState;
  /** Repositories: the admin-owned home repo and the buffered outbox. */
  repo?: RepoState;
  /** A stable per-device id, for rescue-branch naming and sync bookkeeping. */
  deviceId?: string;
  /** Manual connectivity-profile override; only ever steps down from auto. */
  profileOverride?: ProfileId;
  /** Opt-in, on-device, manual-export activity log for the test run. */
  insightsOptIn?: boolean;
  /** Appearance: follow the system (default), or pin light or dark. Follows a
   *  signed-in person to their other devices (lib/settingsReach.ts). */
  theme?: 'system' | 'light' | 'dark';
  /** The app icon (Settings, Appearance, founder 2026-10-01): the default ink
   *  tile, turquoise, or white (lib/appIcon.ts). Device-local, since the
   *  Home Screen icon is this device's. Unset is the default. */
  appIcon?: 'default' | 'turquoise' | 'white';
  /** Reasoning effort for new turns, the same idea Claude exposes. Defaults to
   *  'high'. Chosen from the top of the model sheet. */
  effort?: Effort;
  /** How tool approvals are handled for the coding agent. Defaults to
   *  'acceptEdits'. Chosen from the composer's mode pill. */
  permissionMode?: PermissionMode;
  /** The workspace an identity-linked Anthropic key acts in, sent as the
   *  anthropic-workspace-id header. Blank for a workspace-scoped key. */
  anthropicWorkspaceId?: string;
  /** The models the person keeps on the Bench from a provider whose list
   *  loads live (Venice, OpenRouter; lib/providers.ts liveModels), keyed by
   *  provider id. Put back on PROVIDERS at launch. */
  providerModels?: Record<string, ProviderModel[]>;
  /** Models the user pinned (swipe-left) from the Cloud Providers or Local LLMs
   *  sheets. They surface under My Stack on the root model sheet for one-tap
   *  selection, and swipe there to unpin. Only concrete models pin. */
  pinnedModels?: ConversationSource[];
  /** Terminal Control: whether the model may run shell commands on its own,
   *  keyed per target (the local engine, or a hub's base URL) so an On state at
   *  one machine never follows a session to another. Missing means Off, the
   *  opt-in default. Device local by nature (a per device, per machine consent
   *  choice), so it is never synced. */
  terminalControl?: Record<string, boolean>;
  /** Whether the Terminal room's first-run intro has been shown on this device.
   *  A first-run flag, device local, never synced. */
  terminalRoomSeen?: boolean;
  /** Tokens and Secrets: whether the per-project secrets note is enabled. Off by
   *  default (a privacy choice the person makes). When on, a local model may use
   *  the project's stored credentials; the secrets themselves live in the sealed
   *  device-local store, never in a vault or repo, and never sync. Device local
   *  by nature (it turns on access to secrets that only exist on this device). */
  storeSecrets?: boolean;
  /** Humanize Writing: hold generated text to a plain, specific, honest voice
   *  that avoids AI writing tells (distilled from Wikipedia's Signs of AI
   *  writing). On by default; undefined means on. Off drops the standard from
   *  the prompt, so a model runs a little faster on a shorter prompt. */
  humanizeWriting?: boolean;
  /** Your writing voice (Settings, Writing): the person's own instructions for
   *  how a model writes for them, on every app-side seat, alone or layered on
   *  Humanize Writing (lib/writingVoice.ts). A prompt, so it stays on the
   *  device. Undefined or empty means none. */
  writingVoice?: string;
  /** Chain of Thought: show a model's reasoning above its answer, live while it
   *  thinks, then folded to "Thought for Ns" (lib/chainOfThought.ts). OFF by
   *  default; undefined means off. Native reasoners are asked through their own
   *  API, every other model is prompted to think in tags. Off asks no model to
   *  think out loud and keeps any reasoning a model sends out of the chat. */
  chainOfThought?: boolean;
  /** The chat splash's Easter egg (lib/greetingDecks.ts): what a tap and a hold
   *  on the greeting line do. Languages (the default; undefined means it),
   *  Popsicle Jokes, Trivia Night, or Sunday Crossword. Device local. */
  greetingStyle?: GreetingStyle;
  /** Notices (lib/notices.ts): a banner when a model download finishes while
   *  you are away. On by default; undefined means on. Follows a signed-in
   *  person (lib/settingsReach.ts). */
  noticeDownloads?: boolean;
  /** Notices: a banner when a reply lands, or a chat stops for your approval,
   *  while you are away. On by default; undefined means on. Follows a
   *  signed-in person (lib/settingsReach.ts). */
  noticeReplies?: boolean;
  /** Guided setup (lib/guidedSetup.ts): Harbor Lite walking a new person
   *  through setup in its first chat. Device local. */
  guidedSetup?: GuidedSetupProgress;
  /** Voice mode: speak replies aloud during a spoken conversation. On by default
   *  (undefined means on); off keeps voice mode as listen-and-send, with replies
   *  read on screen. Follows a signed-in person (lib/settingsReach.ts). */
  voiceReplies?: boolean;
  /** The chosen text-to-speech voice id, from the device's installed system
   *  voices (lib/voice/tts.ts). Undefined uses the best default voice for the
   *  language. Device local: voices differ per device. */
  voiceId?: string;
  /** Speaking speed for voice mode, normalized 0..1 where 0.5 is the natural
   *  default, so one slider reads the same on iOS and the web backend, which
   *  is why it can follow a signed-in person (lib/settingsReach.ts). */
  voiceRate?: number;
  /** Codemagic Access: whether the model may drive Codemagic builds on its own
   *  (trigger, read the failure, fix, rebuild until green) using this device's
   *  Codemagic token. Off by default; missing means Off, the opt-in default. A
   *  single device-local boolean (not per target like Terminal Control): the
   *  token lives in this device's Keychain and only ever executes on this
   *  device, never on a remote hub. Never synced. See codemagicControl.ts. */
  codemagicAccess?: boolean;
  /** Wayfinding (Settings): memory, skills, browser. How the agent finds its
   *  way. Each is on unless turned off (missing means on). Device local. See
   *  lib/currents.ts. */
  wayfinding?: WayfindingSettings;
  /** Research (Settings): ground web search in Perplexity's Sonar instead of
   *  the default backend. OFF by default (missing means off, unlike Wayfinding)
   *  because it spends the user's Perplexity key on every search. Reuses the
   *  Perplexity key connected in Cloud Connections, so there is no second key
   *  to paste, and does nothing until that key exists. Device local. See
   *  lib/webSearch.ts (resolveSearchKey). */
  perplexityResearch?: boolean;
  /** What the person saved per Agentic Current (an address, a model, a CLI).
   *  Metadata only; an API key lives under currentSecretKey(id). Device-local:
   *  a current is CONNECTED once here and reused, while WHICH current is active
   *  is a per-project choice (Project.agenticCurrent), so different projects run
   *  different currents at once. Kept when unselected so re-selecting is one tap. */
  currentConnections?: CurrentConnections;
  /** What the person saved per Harness Current (an address, a model). Metadata
   *  only; the API key lives under harnessCurrentSecretKey(id). Device-local,
   *  connected once; the per-project selection is Project.harnessCurrent. */
  harnessCurrentConnections?: HarnessCurrentConnections;
  /** The role each paired hub reported for this device's credential (from the
   *  hub's /health), keyed by base URL. Read at pair time and refreshed when a
   *  session attaches. Missing means the hub predates roles and decides per
   *  request. The active hub's role is mirrored into `hubRole` in state so a
   *  component can select it directly. Device local. */
  hubRoles?: Record<string, HubRole>;
  /** Server orgs the person declined to join on this device ("Not now" on the
   *  join sheet), so the question is asked once. Device local; cleared on
   *  sign-out. */
  declinedOrgIds?: string[];
  /** A first message typed before any brain could answer, held while the
   *  person sets one up (a download, a pairing, a key) and offered back on
   *  their return, or, waiting on the desktop's First Seat, sent by itself
   *  once the engine can answer (state/firstRunOps.ts). Text only;
   *  attachments live in memory for the session. Device local. */
  heldFirstMessage?: HeldFirstMessage;
  /** When this device last changed a preference that follows a signed-in
   *  person, from the first account copy (v: 1), which kept one time for all
   *  of them. Read as the stamp of any key without its own (prefsStamps), and
   *  cleared by the first sync that stamps every key. Device local. */
  prefsUpdatedAt?: string;
  /** When each preference that follows a signed-in person last changed here
   *  (lib/settingsReach.ts), so a sync keeps the newer side of each one.
   *  Device local. */
  prefsStamps?: PreferenceStamps;
  /** The account whose preferences were last synced on this device, so a
   *  different person signing in next takes their own account's preferences
   *  rather than racing the last person's times (state/signinOps.ts). Device
   *  local. */
  prefsOwner?: string;
  /** Someone who signed in here before passwords went has signed in by
   *  email since, so the sign-in sheet's one line about it is done (CX Q4,
   *  2026-10-12). Device local. */
  passwordsGoneSeen?: boolean;
  /** App Lock (lib/appLock.ts): the device's own unlock before the app opens,
   *  and how long it may sit in the background first. Off by default. Device
   *  local. */
  appLock?: AppLockSetting;
  /** "Not now" on the Your account sheet's offer to create a passkey: final
   *  on this device (CX Q2). Device local. */
  passkeyOfferDismissed?: boolean;
  /** This device has made or used a passkey, so the sign-in sheet leads with
   *  it (CX Q2). A hint, never a credential. Device local. */
  passkeyUsedHere?: boolean;
  /** The one-time line to someone who used OpenShore before the account gate,
   *  signed out, has been shown. Device local. */
  accountNoticeSeen?: boolean;
  /** When each paired hub last answered this device, keyed by base URL, so a
   *  chat banner can say "Last seen 2h ago" rather than nothing. Device local. */
  hubLastSeen?: Record<string, string>;
  /** The vault context pack on app seats (Vault M5, CTO J4): 'auto' (the
   *  reading while unset) follows the per-class table; 'off' gives no pack.
   *  Device local. */
  vaultContext?: AppVaultContextSetting;
  /** Room for notes on app seats and, through `vaultOverrides`, engine
   *  sessions (Vault M7, CTO L13): lower-only under the machine's
   *  `vault.packSize`. Unset reads as the machine's. Device local. Wave 0:
   *  declared, not yet read (wave 2 wires it). */
  vaultPackSize?: AppVaultPackSize;
  /** The Handoff switch (Vault M7, CTO L13, reconciliation 4): `'off'` stops
   *  handoff writes and reads for new chats; unset leaves the machine and the
   *  project in charge. Device local. Wave 0: declared, not yet read. */
  vaultHandoff?: AppVaultHandoffSetting;
  /** An unpaired phone's own vault privacy rules (CTO J3): union-only over
   *  the source's rules, D5 defaults while unset. No UI until M7. Device
   *  local, never synced. */
  vaultPrivacy?: VaultPrivacySetting;
  /** Anthropic prompt caching on app seats (CTO J16, J17). Off by default
   *  (undefined means off), no UI in M5; flips only on the J19 number.
   *  Device local. */
  promptCache?: boolean;
  /** Where the personal vault was before pairing pointed it at the computer
   *  (Vault M5, CTO J9), so unpairing returns it. Device local. */
  vaultBeforeHub?: VaultBeforeHub;
  /** The one-time "keep one vault on your computer" card (J9). Device local. */
  vaultHubOffer?: VaultHubOffer;
  /** Paths the agent's approved vault writes named on this device, newest
   *  first, at most 20 (J15, "Recently from your agent"). Device local. */
  vaultAgentWrites?: string[];
  /** Empty folders made on a storage without real folders (Local, Vault M6
   *  6.2, CTO K5), per vault (`providerId::resourceId`), kept until a note
   *  lands in them. Device local, never project data (K17). */
  vaultEmptyFolders?: Record<string, string[]>;
  /** The notes this device opened or saved, newest first, 20 per vault
   *  (`providerId::resourceId`), for Recent in search and the switcher
   *  (Vault M6 6.1, CTO K9). Cleared on a repoint and with the chats.
   *  Device local. */
  vaultRecent?: Record<string, VaultRecentEntry[]>;
}

/** What a hub says this device's pairing credential may do. */
export type HubRole = 'admin' | 'member';

/** Progress of the one-time Harbor download, surfaced to onboarding + chat. */
export interface HarborDownload {
  percent: number;
  label: string;
  indeterminate?: boolean;
  failed?: boolean;
  /** A plain line under the card while it waits on something the person does
   *  (finishing the Ollama installer), so the button can stay short. */
  note?: string;
}

/** How long the First Seat waits for Ollama to finish installing before it
 *  says so (the installer is the person's to click through). */
export const OLLAMA_INSTALL_WAIT_MS = 15 * 60_000;
/** How often it asks whether Ollama is answering yet. */
export const OLLAMA_POLL_MS = 2_000;

/** The parts of the desktop bridge that bring Ollama up. */
export type OllamaBridge = Pick<
  NonNullable<ReturnType<typeof bridge>>,
  'ollamaStatus' | 'ollamaStart' | 'ollamaInstall'
>;

/**
 * Get Ollama answering for the First Seat, or say plainly why not: start it
 * when it is installed, install it when it is not (the official installer on
 * macOS and Windows, the one command on Linux), and wait for it. Reports each
 * step through `report`; true once Ollama answers. Exported for its test.
 */
export async function bringUpOllama(
  b: OllamaBridge,
  report: (d: HarborDownload) => void,
  opts: { waitMs?: number; pollMs?: number; platform?: string; detail?: string } = {},
): Promise<boolean> {
  const fail = (label: string) => {
    report({ percent: 0, label, failed: true });
    return false;
  };
  if (!b.ollamaStatus) {
    // An older shell: the engine's own line says what is wrong.
    return fail(opts.detail ?? 'Ollama is not running on this computer. Start it, then try again.');
  }
  const wait = async (label: string, note: string): Promise<boolean> => {
    report({ percent: 0, label, indeterminate: true, note });
    const deadline = Date.now() + (opts.waitMs ?? OLLAMA_INSTALL_WAIT_MS);
    while (Date.now() < deadline) {
      const st = await b.ollamaStatus!().catch(() => undefined);
      if (st?.running) return true;
      if (st?.installed && b.ollamaStart && (await b.ollamaStart().catch(() => false))) return true;
      await new Promise((r) => setTimeout(r, opts.pollMs ?? OLLAMA_POLL_MS));
    }
    return false;
  };
  const status = await b.ollamaStatus().catch(() => undefined);
  if (status?.running) return true;
  if (status?.installed) {
    report({ percent: 0, label: 'Starting Ollama', indeterminate: true });
    if (b.ollamaStart && (await b.ollamaStart().catch(() => false))) return true;
    return fail('Ollama is installed but did not start. Open the Ollama app, then try again.');
  }
  const platform = opts.platform ?? (typeof navigator !== 'undefined' ? navigator.platform : '');
  if (/linux/i.test(platform) || !b.ollamaInstall) {
    const ok = await wait(
      'Waiting for Ollama',
      'Ollama is not installed yet. In a terminal, run: curl -fsSL https://ollama.com/install.sh | sh. This carries on by itself once it is running.',
    );
    return ok || fail('Ollama is not running yet. Once it is installed, try again.');
  }
  report({ percent: 0, label: 'Getting Ollama', indeterminate: true });
  const plan = await b.ollamaInstall().catch(() => undefined);
  const ok = await wait(
    'Waiting for Ollama',
    plan?.installerOpened
      ? "Ollama's installer is open. Click through it, and this carries on by itself."
      : 'The Ollama download page is open. Install it from there, and this carries on by itself.',
  );
  return ok || fail('Ollama is not running yet. Once it is installed, try again.');
}

// Web billing lives on the marketing site (purchase never happens in-app, per
// Apple 3.1.1). Admins are sent here to buy seats or manage a subscription.
const BILLING_URL = 'https://openshore.ai/os-code/';

const SETTINGS_KEY = 'oscode.settings.v1';
const CONVERSATIONS_KEY = 'oscode.conversations.v1';
// The last-known crew snapshot, cached so the activity dashboards are viewable
// away from home (offshore/offline), where the machine cannot be reached to
// read live. Control still requires being docked; this is view-only history.
const ROUTINES_KEY = 'oscode.routines.v1';
const ANTHROPIC_KEY_KEY = 'oscode.secret.anthropic';

// The one personal vault every account starts with, on the Local provider
// until the user moves it to iCloud (or another provider) from the vault's
// storage sheet.
const VAULT_RESOURCE_ID = 'vault.personal';

// How long opening a note waits for this device's save of it that is still
// on its way (E3). A team save is one round trip; past this the note opens
// anyway, and the save's landing reloads it.
const VAULT_OPEN_WAIT_MS = 2000;

/** What a driver build takes besides the chat and its seed. */
interface BuildExtra {
  /** A handoff for a desktop agent's first task (CTO J12). */
  handoff?: string;
}

/** A handoff cut to the create-body cap (`HANDOFF_MAX_BYTES`, UTF-8), on a
 *  character boundary. */
function capHandoffBytes(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= HANDOFF_MAX_BYTES) return text;
  return new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.slice(0, HANDOFF_MAX_BYTES))
    .replace(/\uFFFD+$/, '');
}

/** Which storage provider holds the personal vault right now. */
function vaultProviderId(settings: AppSettings): StorageProviderId {
  return settings.gitosResources?.find((r) => r.id === VAULT_RESOURCE_ID)?.providerId ?? 'local';
}

/** Where a vault action writes: a provider and a resource on it. The Vault
 *  screen captures this (vaultTargetRef) when it schedules a save and hands it
 *  back to vaultSave, so a scope flip or a sign-out inside the debounce can
 *  never send one vault's text to the other (orgvault-16). */
export interface VaultTargetRef {
  providerId: StorageProviderId;
  resourceId: string;
  /** Team vault only: the signed-in account the text was typed under,
   *  captured with the target. Team text is sent, stashed, and shown only
   *  while that account is the one signed in, so no member's words ever go
   *  out under, or show to, another account (orgvault-15, R-19). */
  owner?: string;
}

/** Text a vault could not take and will not retry: a permanent refusal (the
 *  team vault's 1 MB cap, a path it does not allow, not a member, signed out),
 *  a read-only vault, or a draft this device could not stash. It stays in
 *  state and, unless `durable` is false, in the sealed store until the person
 *  copies it and discards it, so leaving the note or backgrounding the app
 *  cannot lose it. Team text leaves with its account instead: a sign-out, or
 *  another account signing in. */
/** One stashed note waiting to be saved (vaultPending), without its text. */
export interface VaultPendingRef {
  providerId: StorageProviderId;
  resourceId: string;
  owner?: string;
  path: string;
}

export interface VaultHeldDraft {
  /** One per vault and path; a newer hold for the same note replaces it. */
  id: string;
  providerId: StorageProviderId;
  resourceId: string;
  path: string;
  text: string;
  /** Why it was not saved, in words the person can act on. A team refusal
   *  carries the server's own line. */
  reason: string;
  /** When the text was set aside, on this device's clock (display only). */
  at: string;
  /** Team text only: the account that typed it. It shows only while that
   *  account is signed in (vaultHeldVisible). */
  owner?: string;
  /** False when this device holds no durable copy (the sealed store refused
   *  it, or team text set aside after its session ended), so the text lasts
   *  only until the app closes. */
  durable: boolean;
  /** The desktop folder only: the folder it was typed in, when that is not
   *  the one the vault uses now (CTO F7.6), and how it reads. */
  folder?: string;
  folderDisplay?: string;
}

/** The held drafts the person signed in now may see: every personal one, and
 *  team text only under the account that typed it. Pure, so a screen can
 *  memoize it over vaultHeld and the session's user id. */
export function vaultHeldFor(held: VaultHeldDraft[], userId: string | undefined): VaultHeldDraft[] {
  return held.filter(
    (h) => h.providerId !== 'org' || (h.owner !== undefined && h.owner === userId),
  );
}

/** A vault note that changed somewhere else while this device had unsaved
 *  edits in it (Vault M1, 1.1), waiting for the person to choose what to keep.
 *  Every provider that enforces compare-and-swap raises one (Vault M2 2.2):
 *  the desktop folder, This device, and iCloud and the team vault once their
 *  providers check the guard. While it is set, typing goes to the durable stash, never the
 *  note, and the stash replay leaves that note alone. */
export interface VaultConflict {
  path: string;
  target: VaultTargetRef;
  /** 'changed': another version is there now (theirs). 'missing': the note
   *  was moved or deleted somewhere else. */
  kind: 'changed' | 'missing';
  /** The text the editor loaded or last saved. */
  base: string;
  /** The version that text was (versionOf), the stash base while this is
   *  open. Absent for a note the storage never held. */
  baseVersion?: string;
  /** What is in the note now ('changed' only). */
  theirs?: StoredFile;
  /** Keep both's name for the person's text, worked out once when the
   *  conflict was found, so the name the sheet shows is the name written. */
  copyPath: string;
  /** When it was found, on this device's clock: the stamp in copyPath, and
   *  the clock the next free copy name counts from. */
  foundAt: number;
  /** The person closed the sheet ("not now"): the card on the note stands in
   *  for it until they reopen it or leave the note. */
  deferred: boolean;
  /** The other version changed again while this was open. */
  again?: boolean;
}

/** What one re-check of the open note did: looked ('checked'), could not
 *  reach the storage ('failed', which backs the poll off), or had nothing
 *  to look at ('skipped'). */
export type VaultRecheckResult = 'checked' | 'failed' | 'skipped';

/** What one choice in the resolve sheet did. `ok` false with `failed` means
 *  the storage refused or did not answer, so nothing changed; without it, the
 *  note changed again and the sheet shows the newest version. */
export interface VaultResolveResult {
  ok: boolean;
  failed?: boolean;
}

/** What vaultMoveTo did. `ok` is true only when the vault now lives on the
 *  target. `moved` lists the notes copied there. `skipped` lists the notes
 *  that did not make it: ones the old home could not hand over (still
 *  downloading, or unreadable) or copies the target did not show. Any skip
 *  refuses the move, so the vault never repoints without them. */
export interface VaultMoveResult {
  ok: boolean;
  moved: string[];
  skipped: string[];
  /** Notes whose name the target already held with different text, so this
   *  device's copy landed beside it: the source path, and the conflict name
   *  it has now. Always present; empty on a refused move. */
  forked: Array<{ from: string; to: string }>;
  /** A refused move takes back the copies it wrote, so a retry starts clean.
   *  These are the ones the target would not let go of (it stopped
   *  answering). Absent when none are left. */
  left?: string[];
  /** Why a move was refused: the target is not usable, a source note could
   *  not be read, a copy failed, or the target did not show every copy. */
  reason?: 'unavailable' | 'unreadable' | 'copy-failed' | 'unverified';
}

/** Every note body vaultReadAll could read, plus the paths it could not (a
 *  read that failed, or a note still downloading). Still an array, so a
 *  caller that only wants the bodies uses it as one. */
/** A note or folder delete from the Vault room (Vault M6 6.3; CTO K6, R2):
 *  moved to Trash where it is real, else deleted for good with the bytes
 *  held in memory for a courtesy Undo (absent when they could not be read).
 *  A refusal the store already said (a toast, the resolve path) is
 *  `undefined`. */
export type VaultDeleteOutcome =
  | {
      ok: true;
      trashed: boolean;
      undo?: VaultUndo;
      notes: number;
      attachments: number;
      /** A folder that went to Trash only in part (the team vault, round 7
       *  E20): how many went, what is left and why; its Undo brings back
       *  exactly what went. */
      partial?: TrashPartial;
    }
  // A refusal for good, as the whole line the room says (the team vault's
  // admins-only delete, CX Y14, or a lapsed plan).
  | { ok: false; reason: 'storage'; line: string }
  // Already gone elsewhere (a teammate deleted or moved it): its gone line.
  | { ok: false; reason: 'missing'; line: string }
  // A folder that moved nothing: every note in it changed while the delete
  // ran (the team vault, round 7 E21), and the line names them.
  | { ok: false; reason: 'changed'; line: string }
  | { ok: false; reason: 'storage' | 'unsupported' | 'missing' | 'changed' | 'downloading' };

/** Today's note from the room (Vault M6 6.4; CTO K7, CX X11): an existing
 *  note opens as it is, a new one opens in the editor with its line, and a
 *  vault that cannot start one says why. */
export type VaultTodayOutcome =
  | { kind: 'opened'; path: string }
  | { kind: 'created'; path: string; line?: string }
  | { kind: 'refused'; line: string };

export type VaultReadAllResult = Array<{ path: string; text: string }> & { failed: string[] };

// D1 (0.18): Google Drive is held back for v1. Its conflict copy is undone by
// the next autosave and its list never refreshes in a session, so a vault that
// already lives there is read-only: it lists and reads, and it moves off
// through vaultMoveTo, but it takes no writes, creates, or deletes.
const DRIVE_READ_ONLY =
  'Google Drive vaults are read-only for now. Move this vault to keep editing.';
function vaultReadOnlyReason(providerId: StorageProviderId): string | undefined {
  return providerId === 'gdrive' ? DRIVE_READ_ONLY : undefined;
}

// The keep-both name ("Note (conflict 2026-09-27 1405).md") is the engine's
// vaultConflictCopyPath (os-code/protocol), the one main's Bring uses too, so
// the store and the desktop name the same note the same way.

/** The reason a vault write failed for good, or undefined when a retry may
 *  work. A provider marks what it knows is permanent (`permanent: true`, the
 *  team vault's OrgVaultRefusal); anything else (offline, a timeout, an error
 *  nobody classified) stays transient and is stashed for replay. */
function vaultRefusal(err: unknown): string | undefined {
  return err instanceof Error && (err as { permanent?: unknown }).permanent === true
    ? err.message
    : undefined;
}

/** A server line ("a note is limited to 1 MB") as a sentence for a toast. */
function asSentence(line: string): string {
  const t = line.trim();
  const s = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

// Drivers are module state, keyed by conversation id.
const drivers = new Map<string, ChatDriver>();

// Nothing a person uses is paid (open source, founder 2026-10-11). The only
// billing left is a commercial org's team seats (a later tier), read by
// refreshEntitlement and checked by growthGatedByBilling.

// Throttle for the foreground entitlement re-check, so returning to the app many
// times in a row never hammers the entitlement read.
let lastEntitlementForegroundAt = 0;

// Device keys the retired Personal plan wrote (open source, 2026-10-11); init
// deletes them.
const RETIRED_ENTITLEMENT_CACHE_KEY = 'oscode.entitlement.personal.v1';
const RETIRED_APPLE_LINK_KEY = 'oscode.iap.pendingLink.v1';

/** What an entitlement refresh learned: the server answered, it could not be
 *  reached, or nobody is signed in. */
export type EntitlementRefresh = 'ok' | 'offline' | 'signed-out';

// Hub pairing credentials live in the secret store (Keychain, safeStorage),
// keyed by hub, never in the settings blob (APP-11). In memory the DaemonTarget
// still carries its token, so every daemon call reads it the same way; only
// what reaches disk is stripped, and init puts the tokens back.
export function hubSecretKey(baseUrl: string): string {
  return `oscode.secret.hub.${baseUrl}`;
}
function stripHubTokens(settings: AppSettings): AppSettings {
  const strip = (d: DaemonTarget): DaemonTarget => ({ ...d, token: '' });
  return {
    ...settings,
    ...(settings.daemon ? { daemon: strip(settings.daemon) } : {}),
    ...(settings.daemons ? { daemons: settings.daemons.map(strip) } : {}),
  };
}
/** The one door to the persisted settings blob. */
async function persistSettings(settings: AppSettings): Promise<void> {
  await storeSetJson(SETTINGS_KEY, stripHubTokens(settings));
}
/** The active hub's role, as the hub last reported it. */
function activeHubRole(settings: AppSettings): HubRole | undefined {
  return settings.daemon ? settings.hubRoles?.[settings.daemon.baseUrl] : undefined;
}
/** Ask a hub what this credential may do. Undefined for an older hub with no
 *  role field (the daemon then decides per request) or when unreachable. */
async function readHubRole(daemon: DaemonTarget): Promise<HubRole | undefined> {
  try {
    const res = await fetch(`${daemon.baseUrl}/health`, {
      headers: { authorization: `Bearer ${daemon.token}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { role?: unknown };
    return body.role === 'admin' || body.role === 'member' ? body.role : undefined;
  } catch {
    return undefined;
  }
}

// Attachments that ride a message held for a driver that has not attached yet
// (APP-10). The text lives on the conversation, persisted; attachments are
// bytes with no durable form, so they wait here for this session only.
const pendingSends = new Map<string, Attachment[] | undefined>();
const unsubscribers = new Map<string, () => void>();
// Chats whose driver is being built right now, so a send that lands mid-open
// parks instead of starting a second build, and a reopen never double-builds.
const building = new Set<string>();
// Which build of a chat's driver is current. A model switch bumps it, so an
// open that was still building the old brain's driver when the person switched
// throws its driver away instead of attaching it over the new one.
const driverEpoch = new Map<string, number>();
function bumpDriverEpoch(conversationId: string): number {
  const next = (driverEpoch.get(conversationId) ?? 0) + 1;
  driverEpoch.set(conversationId, next);
  return next;
}
// Desktop chats showing their saved read-only snapshot (B4): the first journal
// frame replaces the snapshot rather than stacking on top of it.
const snapshotIds = new Set<string>();
// The attachments of the held first message (settings keep only the text).
let heldAttachments: Attachment[] | undefined;
/** How long a reopened desktop chat waits for its first journal frame before
 *  the resume skeleton gives way to whatever is on screen. */
const RESUME_TIMEOUT_MS = 6000;
// Guards against two interleaved outbox syncs (a double "Sync now" tap): the
// second returns immediately rather than racing the first's snapshot save.
let outboxSyncing = false;
// Serialize repo reconcile passes: the boot check and a reconnect can otherwise
// fire at once and push the same clones twice.
let reconcilingRepos = false;
// Desktop Offline (founder, 2026-10-07): main's own read of the network
// (Electron's net.isOnline()), undefined until main has answered. The window's
// navigator.onLine and this both count (state/offlineOps.ts desktopOnline).
let mainNetOnline: boolean | undefined;
// Chats whose repositories changed while their driver held the old list (an
// on-device model and the Stack take it at build). The next send, between
// turns, rebuilds that driver from the transcript so the new list and the
// new working folder apply. A cloud chat reads it fresh every reply instead.
const repoContextStale = new Set<string>();
// Note bodies keyed by `${providerId}::${resourceId}::${path}`, so backlink
// derivation (vaultReadAll on every note open) re-reads only files whose
// version (versionOf) moved. Keyed by version, not updatedAt: two saves in one
// millisecond share an updatedAt and differ only by version (Vault M2 G1.6).
// Self-invalidating: a mismatched version misses; a distinct provider or
// resource (the personal vault before and after a move, or a specific org
// vault) never collides.
const vaultBodyCache = new Map<string, { version: string; text: string }>();

export function driverFor(conversationId: string): ChatDriver | undefined {
  return drivers.get(conversationId);
}

/** The saved hubs, with the older single-hub setup folded in: a device that only
 *  ever had one paired `daemon` reads as a one-item list, so multi-hub is purely
 *  additive and needs no migration. */
export function hubList(settings: AppSettings): DaemonTarget[] {
  if (settings.daemons) return settings.daemons;
  return settings.daemon ? [settings.daemon] : [];
}

/** Crew routines as this device last saw them: the roster of unattended jobs
 *  on the computer that runs them, and their recent runs. Refreshed on demand
 *  and while the command center is open; never persisted here (the scheduler
 *  on the computer is the source of truth). */
export interface RoutinesState {
  routines: RoutineView[];
  runs: RoutineRun[];
  /** True once the first refresh answered (or found nowhere to ask). */
  loaded: boolean;
  /** False when no machine is set up at all (never paired, not on desktop). */
  available: boolean;
  /** True when the current snapshot came from a live read (docked or on the
   *  machine). False means it is the cached last-known picture, shown while
   *  away from home. */
  live: boolean;
  where?: 'desktop' | 'daemon';
  /** Whose clock fires the slots, from the last live read. */
  clock?: RoutineClockStatus;
  error?: string;
}

export function emptyRoutinesState(): RoutinesState {
  return { routines: [], runs: [], loaded: false, available: false, live: false };
}

interface AppState {
  ready: boolean;
  routines: RoutinesState;
  /** Guards init() from running twice (React StrictMode double-invokes effects). */
  initStarted: boolean;
  view: ViewName;
  /** The rooms behind the current one, nearest last. A room opened from the
   *  side panel is a root (the trail clears); a room reached from inside
   *  another room (a settings path, Manage, the terminal) pushes, so its top
   *  bar can offer a way back to where the person came from. */
  viewTrail: ViewName[];
  /** Which project the `project` detail room is showing. Set by openProject;
   *  read by the detail screen and by a chat opened from it (its way back). */
  viewProjectId?: string;
  drawerOpen: boolean;
  /** Text the next chat's composer opens with (state/appActionOps.ts), taken
   *  once by the chat screen. Not persisted. */
  composerSeed?: ComposerSeed;
  conversations: Record<string, Conversation>;
  order: string[];
  activeId?: string;
  settings: AppSettings;
  /** Phone-side Claude key presence (the key itself never sits in state). */
  cloudKeyPresent: boolean;
  /** The Claude key is here but a turn just proved its setup wrong (it needs a
   *  workspace id, or was rejected). A guide skips it until it is fixed, so a
   *  Walk me through it never opens on a brain that cannot answer. */
  cloudKeyNeedsFix: boolean;
  /** Which cloud providers are connected (keys live in the Keychain). */
  connectedProviders: Record<string, boolean>;
  /** A provider whose Connect form Cloud Connections should open on arrival
   *  (set by a Connect tap in the Marketplace, cleared once honored). */
  connectionsFocus?: string;
  /** The provider that was connected most recently and has not yet been
   *  celebrated: the next room that shows its rows pops them once. */
  justConnected?: string;
  /** True when the current room was reached by going back along the trail,
   *  so it may restore where the eye left (scroll, an open page). A forward
   *  navigation starts a room fresh. */
  arrivedBack: boolean;
  /** Whether a Codemagic API token is connected (the token lives in Keychain). */
  codemagicConnected: boolean;
  /** The live half of each Agentic Current's two-part gate: whether its saved
   *  connection answered the last probe. Never persisted; re-probed on open,
   *  on connect, and on demand. */
  currentProbes: CurrentProbes;
  /** The live half of each Harness Current's two-part gate: whether its saved
   *  connection answered the last probe. Never persisted; re-probed like the
   *  agentic ones. */
  harnessCurrentProbes: HarnessCurrentProbes;
  /** What the paired computer (or this desktop) can host for currents: a
   *  Hermes home present, a coding CLI on PATH. Undefined until reachable. */
  currentsHost?: CurrentsHostProbe;
  /** The arrival gesture in flight: where the switch was (viewport px) and
   *  whether the current is flowing in or ebbing out. `seq` restarts the
   *  animation for a second flip. Cleared by the overlay when it settles. */
  currentArrival?: { seq: number; x: number; y: number; ebb: boolean; label: string };
  /** Which repo platforms are connected (tokens live in the Keychain). */
  connectedRepoPlatforms: Record<string, boolean>;
  /** The signed-in Supabase session, when accounts are configured + signed in. */
  authSession?: Session;
  /** Whether this build has sign-in configured at all. */
  authConfigured: boolean;
  /** App Lock is closed: the app shows only the lock screen until the
   *  device's own unlock (lib/appLock.ts). No room renders meanwhile. */
  appLocked?: boolean;
  /** The server-verified org role for the signed-in user, when known. */
  serverRole?: 'admin' | 'member';
  /** A company org someone else added the signed-in person to, waiting for an
   *  explicit yes before this device adopts it (BE-1). */
  orgJoin?: { org: Org; ownerUid: string };
  /** True when the device's sealed data could not be unlocked this launch (the
   *  key exists but cannot be read). Sealed keys are read-only until it is
   *  back; nothing has been overwritten. Surfaced once by init. */
  dataLocked?: boolean;
  /** The active hub's role for this device's credential, as the hub reported
   *  it (admin or member). Undefined for an older hub, which decides per
   *  request. Mirrors settings.hubRoles for the active hub so the composer can
   *  select it in one read. */
  hubRole?: HubRole;
  /** The desktop app's own engine status (Electron only): whether a model is
   *  configured on this machine, which the first-answer gate reads so a chat is
   *  never opened against an engine that cannot start. Refreshed on init and
   *  after the Stack changes. */
  desktopStatus?: DesktopStatus;
  /** The org's billing entitlement (Stripe webhook is the writer), when known. */
  entitlement?: Entitlement;
  /** Live progress while Harbor Lite downloads for the first time. */
  harborMiniDownload?: HarborDownload;
  /** Live progress while Harbor downloads for the first time. */
  harborDownload?: HarborDownload;
  /** Live progress while DeepBlue is pulled through the desktop engine.
   *  Presence itself is never remembered here: the Settings row reads it from
   *  the engine's Ollama list (harborMasterInstalled over desktopStatus). */
  harborMasterDownload?: HarborDownload;
  /** Whether a custom search key (Brave/Tavily) is set; keeps the key itself
   *  out of state, same pattern as codemagicConnected. */
  searchKeyConfigured: boolean;
  /** The active vault's file list, loaded through the gitOS seam. */
  vaultFiles: StoredFileMeta[];
  /** The open vault note, when one is open. `fresh` marks a just-created note
   *  so the editor opens in write mode without treating every empty-bodied
   *  saved note as fresh. `updatedAt` is the provider's version this text was
   *  loaded from or last saved as, and '' while the provider does not hold the
   *  note yet: never this device's clock, since an offline draft records it as
   *  the version it was typed against. */
  vaultNote?: {
    path: string;
    text: string;
    updatedAt: string;
    /** The provider's opaque version of `text` (StoredFile.version), when it
     *  has one. versionOf(vaultNote) is the base a save is guarded with. */
    version?: string;
    fresh?: boolean;
    /** When `text` was read or reloaded on this device (Date.now()), so the
     *  resolve sheet shows the other version's time only when it is later. */
    loadedAt?: number;
    /** Bumped each time the store replaces `text` in place while the note
     *  stays open (a calm reload, or a resolve choice), so the editor takes
     *  the new text; `reloadedFrom` says which. */
    reloaded?: number;
    reloadedFrom?: 'elsewhere' | 'resolve';
    /** Who last saved `text`, when the storage says (the team vault only,
     *  StoredFileMeta.editedBy, CTO G6). Cleared by this device's own save. */
    editedBy?: { id: string; label?: string };
    /** Whether the last save of this sitting was set aside under Not saved
     *  (refused for good, a read-only vault, or no copy kept): true, false
     *  once one lands, undefined before either. The save chip says Not saved
     *  while it is true, never Saved (round 7 E18). */
    held?: boolean;
  };
  /** A note that changed somewhere else under unsaved edits, waiting for the
   *  person's choice (the resolve sheet). At most one at a time. */
  vaultConflict?: VaultConflict;
  /** The desktop vault folder as main reports it (Vault M1 1.4): where it
   *  is, whether it is there, and whether Obsidian opens it. Undefined off
   *  the desktop or before main answered. */
  vaultFolder?: VaultDirInfo;
  /** A vault move is running: the room holds still (nothing that writes). */
  vaultMoving?: boolean;
  /** The vault on screen has finished at least one list since it was last
   *  pointed somewhere, so an empty list means empty, never "still opening". */
  vaultListed?: boolean;
  /** A folder the Vault list should show next, set when the store closes a
   *  note on its own (it was moved or deleted somewhere else). The screen
   *  takes it once and clears it. */
  vaultReturnFolder?: string;
  /** The last vault storage failure, cleared on any success. 'load' means the
   *  file list could not be read (show an offline state, not the first-run
   *  empty state); 'save' means a write failed and the draft was stashed for
   *  replay; 'held' means text was set aside in vaultHeld and will not be
   *  retried (a refusal, a read-only vault, or a stash that failed).
   *  Undefined when the vault is healthy. */
  vaultError?: 'load' | 'save' | 'held';
  /** Why the last 'save' error waits (round 7 E42): the connection, the team
   *  vault being updated, or a storage that did not answer. Read only beside
   *  vaultError 'save'; the chip says "Offline" for the first alone. */
  vaultSaveWait?: VaultWaitKind;
  /** Text no vault took, kept until the person copies and discards it: the
   *  "Not saved" list. Durable in the sealed store unless an entry says
   *  otherwise (`durable: false`). It holds team text of accounts not signed
   *  in now, so a screen shows vaultHeldVisible(), never this list. */
  vaultHeld: VaultHeldDraft[];
  /** Every note with text stashed on this device to save when its storage
   *  answers, as refs (no text): the save chip's pending count (Vault M2
   *  2.2). Kept in step with the stash by every edit of it. */
  vaultPending: VaultPendingRef[];
  /** A save is on its way to the storage right now (the chip's Saving). */
  vaultSaving?: boolean;
  /** True when the lease is enforced on the vault on screen (a storage
   *  without compare-and-swap) and another device holds it live, so this one
   *  shows read-only and writes nothing to a note (Vault M2 2.5, CTO G5). */
  vaultLeaseHeldByOther?: boolean;
  /** Another device holds the lease on the vault on screen: 'advisory' (a
   *  storage with compare-and-swap, the quiet "Also open on your iPad") or
   *  'enforced' (read-only here, with Take over editing), and its device
   *  kind when it said. Undefined when no other device was seen. */
  vaultLeaseOther?: { mode: 'advisory' | 'enforced'; label?: string };
  /** The team sign-in expired while a team note was open (Vault M2 2.6): the
   *  note stays on screen, read-only, with "Sign in again to save to your
   *  team", until the person leaves it or the same account signs back in.
   *  Nothing else of the team vault shows meanwhile. */
  vaultTeamExpired?: boolean;
  /** The team's plan as its settings read last said (Vault M7, CX Y14,
   *  Y15; migration 0025): not entitled is the calm read-only state, every
   *  note still reads and exports; `entitledUntil` is a never-paid team's
   *  notice; `isAdmin` and `deleteRole` decide the settings sheet and who may
   *  delete. Undefined before the first read and after a sign-out. */
  vaultTeamPlan?: OrgVaultPlan;
  /** Which vault the Vault screen is showing: the personal one (on the chosen
   *  storage provider) or the shared team vault (org tier, Supabase-backed).
   *  Team is only reachable when signed in as an active member of an org. */
  vaultScope: 'personal' | 'team';
  /** Trash of the vault on screen, where its storage has a real one (Vault
   *  M6 6.3): the tree's last row shows while it holds something. Undefined
   *  before the first listing and on a storage without Trash. */
  vaultTrash?: TrashEntry[];
  /** Folders of the vault on screen beyond the ones its notes imply: real
   *  folders the storage lists (empty ones too) and the remembered empty
   *  ones (Vault M6 6.2, K5). */
  vaultFolders?: string[];
  /** The vault on screen's resolved settings (Vault M7, CTO L3 to L6):
   *  Obsidian's conventions, then `.oscode/vault.json`, then the defaults.
   *  Undefined before the first read after a repoint. */
  vaultSettings?: ResolvedVaultSettings;
  /** A sheet another room asked the Vault room to open when it shows
   *  (Settings' "Where it lives"). The room takes it once and clears it. */
  vaultSheetRequest?: 'storage';
  /** When true, the Marketplace intro walkthrough is showing over the library. */
  libraryIntro?: boolean;
  /** When true, a brand-new account was just created on a device that never
   *  chose Personal or Business, so the choice shows (AccountSetup). Until an
   *  account exists, OpenShore simply runs as personal and never asks. */
  accountChoice?: boolean;
  /** Live reach signals that drive the active connectivity profile. */
  connectivity: Connectivity;
  /** Project repos whose local commits diverged from the remote and need a
   *  manual merge before they can sync. Set by reconcileProjectRepos; surfaced
   *  in the Vault so pending work is never silently stuck on the device. */
  repoSyncConflicts?: ReconcileResult[];
  toast?: string;
  /** When set, the sign-in sheet is showing for a feature that needs an
   *  account (lib/accountGate.ts). */
  accountGate?: AccountFeature;
  /** A desktop chat whose journal is still being replayed after reopen, so
   *  the screen shows a skeleton (or the saved snapshot) instead of the
   *  empty-state greeting. Cleared by the first journal frame or a timeout. */
  resumingId?: string;
  /** The phone's line to the active hub while it is not simply live:
   *  `reconnecting` while a dropped stream is being reattached, `away` once
   *  that has clearly failed. Absent means live (or no hub in play). */
  hubLink?: { state: 'reconnecting' | 'away'; since: number };
  /** A desktop update the main process has found, pushed over the bridge.
   *  Undefined means nothing pending (or not on desktop at all). */
  updateStatus?: PendingUpdate;

  init(): Promise<void>;
  /** Go to a room. From the panel pass `{ root: true }` so the trail clears;
   *  from inside a room the current room joins the trail. */
  setView(view: ViewName, opts?: { root?: boolean }): void;
  /** Open Cloud Connections with this provider's Connect form already open. */
  openConnections(providerId: string): void;
  clearConnectionsFocus(): void;
  clearJustConnected(): void;
  /** Return to the previous room on the trail; the panel's room if none. */
  goBack(): void;
  setDrawer(open: boolean): void;
  showToast(message: string): void;
  setUpdateStatus(update: PendingUpdate | undefined): void;
  /** Whether account features need a sign-in right now: this build has
   *  accounts and nobody is signed in (lib/accountGate.ts). */
  needsAccountNow(): boolean;
  /** Show the sign-in sheet for a feature; signing in carries on to `returnTo`
   *  when a room was asked for. */
  openAccountGate(feature: AccountFeature, returnTo?: ViewName): void;
  closeAccountGate(): void;
  /** Whether a chat source can produce a real answer on this device right now
   *  (a downloaded on-device model, a paired computer, or a stored cloud key).
   *  The empty-state composer checks this before starting a chat, so a first
   *  message is never sent into a brain that cannot answer. */
  sourceReady(source: ConversationSource): boolean;
  /** Whether a Stack chat can read an image right now: a capable model
   *  placed in the stack, or a connected cloud provider that reads images. The
   *  image offer card folds its doors once this turns true; the Stack chat's
   *  composer takes a picture either way (founder, 2026-10-07). */
  stackVisionReady(): boolean;
  /** Re-read the desktop engine's status (Electron only; no-op elsewhere). */
  refreshDesktopStatus(): Promise<void>;

  /** Open a new chat on `source` and resolve to its id, or to undefined when
   *  no chat opened: the coding agent's sign-in sheet stood in the way, and the caller hands anything typed back to the person. */
  newConversation(
    source: ConversationSource,
    opts?: {
      /** Pre-written turns the chat opens with (a guide's plan). They render
       *  immediately and seed the model's history, so it knows what was said. */
      seedItems?: ThreadItem[];
      title?: string;
      /** The repositories the chat starts with; the project's when omitted. */
      repoIds?: string[];
      /** The first message, parked on the chat before the driver exists so
       *  the bubble is on screen at once and nothing waits on the hub. */
      firstMessage?: { text: string; attachments?: Attachment[] };
      /** A handoff for a desktop agent's first task (Vault M5, CTO J12): a
       *  chat carried to the computer's agent, which takes no message history,
       *  starts from this summary. Capped at `HANDOFF_MAX_BYTES`. */
      handoff?: string;
    },
  ): Promise<string | undefined>;
  /** Replace the repositories a chat works with (the header picker). */
  setConversationRepos(id: string, repoIds: string[]): Promise<void>;
  /** Open a chat with a setup guide: the goal, the plan, and step one, seeded
   *  and ready, on whatever brain can answer here (this computer's engine, a
   *  cloud key, or Harbor Lite on the phone). The Walk me through it button. */
  startGuideChat(guideId: SetupGuideId): Promise<void>;
  /** Switch the model of the OPEN conversation, Claude-style: keep the thread,
   *  reseed the new brain with the transcript, and let the next turn run on it.
   *  Falls back to a fresh chat when there is nothing to carry or the target is
   *  not a chat brain. */
  switchModel(source: ConversationSource, opts?: { resend?: boolean }): Promise<void>;
  /** The brain a failed chat can continue on (never the one that failed),
   *  or undefined when only the model picker is left (lib/chatRescue.ts). */
  rescueSourceFor(conversationId: string): ConversationSource | undefined;
  /** No dead ends: carry the open chat to the rescue brain (downloading Harbor
   *  Lite first if it is not here yet) and send the failed message again. */
  continueElsewhere(): Promise<void>;
  /** Open a fresh, empty chat (the source picker decides who answers). A
   *  project is auto-created on first save, so this never dead-ends. */
  startNewChat(): void;
  /** Settings, Writing: open a fresh chat with the writing voice's shaping
   *  prompt in the composer, for the person to finish and send. */
  startWritingVoiceChat(): void;
  /** The chat screen took the composer seed. */
  clearComposerSeed(): void;
  /** Apply an app action the person tapped on a model's proposal
   *  (lib/appActions.ts). Resolves false for a key or value the app does not
   *  take, which changes nothing. */
  applyAppAction(key: string, value: string): Promise<boolean>;
  /** Send text once the active conversation's driver has attached. */
  sendWhenAttached(conversationId: string, text: string, attachments?: Attachment[]): void;
  /** Try again to deliver a chat's parked first message: rebuild the driver
   *  if it failed to open (the hub did not answer), or flush if it exists. */
  retryPending(conversationId: string): void;
  /** Hold a first message typed before any brain could answer, persisted, so
   *  a trip to the Marketplace or the pair room does not lose it. */
  holdFirstMessage(text: string, attachments?: Attachment[]): Promise<void>;
  /** Take the held message (clearing it) to send it now. */
  takeHeldFirstMessage(): { text: string; attachments?: Attachment[] } | undefined;
  discardHeldFirstMessage(): Promise<void>;
  /** Hold a first message on the desktop's First Seat (state/firstRunOps.ts):
   *  it goes out by itself once the engine can answer. A second one joins it. */
  holdUntilReady(text: string, attachments?: Attachment[]): Promise<void>;
  /** Settle a held first message against what can answer now: send one
   *  waiting on the First Seat once the engine can answer, or hand one back
   *  (returned, and cleared) for the composer. The chat screen calls it as it
   *  mounts and whenever readiness changes. */
  settleHeldMessage(opts: {
    chooserOpen: boolean;
  }): { text: string; attachments?: Attachment[] } | undefined;
  /** The brain a new chat starts on when the person has not picked one
   *  (firstRunOps.defaultComposerSource). */
  composerDefaultSource(): ConversationSource;
  /** Whether a send nothing can answer waits on the First Seat instead of
   *  opening the model chooser (firstRunOps.waitsOnFirstSeat). */
  sendWaitsOnFirstSeat(): boolean;
  /** Create a project and make it active. */
  createProject(name: string): Promise<string>;
  setActiveProject(id: string): void;
  updateProject(
    id: string,
    patch: Partial<Pick<Project, 'name' | 'instructions' | 'repoIds' | 'access'>>,
  ): Promise<void>;
  /** Open a project's detail room (its chats, instructions, repos, access). */
  openProject(id: string): void;

  // Crew routines (the command center). Every call reaches the scheduler on
  // the computer that runs routines; the store keeps the last snapshot.
  /** Open the command center (a sub-page of Crew) and refresh. */
  openCrewCommand(): void;
  /** Whether this device can set up and control routines right now (docked or
   *  on the machine), and where it stands otherwise. Viewing is always on. */
  crewControl(): CrewControl;
  refreshRoutines(): Promise<void>;
  createRoutine(input: RoutineInput): Promise<RoutineView | undefined>;
  updateRoutine(id: string, patch: Partial<RoutineInput>): Promise<void>;
  deleteRoutine(id: string): Promise<void>;
  runRoutineNow(id: string): Promise<void>;
  stopRoutine(id: string): Promise<void>;
  readRoutineNote(runId: string): Promise<{ path: string; markdown: string } | null>;
  /** Open a run's transcript: the journaled session, replayed like any
   *  desktop chat, with a way back to the command center. */
  openRoutineRun(run: RoutineRun): Promise<void>;
  /** Open a project's read-only memory notes (from the Vault section). */
  openProjectMemory(id: string): void;
  /** Start a fresh chat that belongs to a project, opened with a way back to
   *  the project's detail room. */
  startProjectChat(projectId: string): void;
  /** Enterprise: set a project's per-teammate access. For a shared project the
   *  change is applied to the org server (the RLS-enforced roster); for a local
   *  project it is a draft that ships when the project is shared. */
  setProjectAccess(projectId: string, access: ProjectAccess[]): Promise<void>;
  /** Enterprise: share a local project with the org so the team can use it (org
   *  admin only; server-enforced). Its instructions, repos, and any drafted
   *  access grants go up, and it starts syncing. */
  shareProject(id: string): Promise<void>;
  /** Enterprise: stop sharing a project with the team. It becomes a local
   *  project again on this device (the server copy is removed). */
  unshareProject(id: string): Promise<void>;
  /** Enterprise: pull the shared projects the signed-in person can reach and
   *  merge them into the projects list. No-op offline or for a personal account. */
  syncOrgProjects(): Promise<void>;
  /** Remove a project; its chats stay but drop back to no project. A shared
   *  project is also removed on the server (needs edit access). */
  deleteProject(id: string): Promise<void>;

  // Account & organization.
  /** Set up the account: personal, or commercial with an owner email + seats. */
  setupAccount(input: {
    type: AccountType;
    ownerEmail?: string;
    orgName?: string;
    seatCount?: number;
  }): Promise<void>;
  /** Update the declared seat count; re-bands the plan tier. */
  setSeatCount(seatCount: number): Promise<void>;
  /** Whether adding seats or inviting members is allowed right now: a
   *  server-backed commercial org needs an active entitlement, a purely local
   *  org (not yet subject to billing) is never gated. Existing members always
   *  keep working; only growth is gated. */
  canGrowTeam(): boolean;
  /** Admin: add a member by email (default role member). */
  addMember(email: string, displayName?: string): Promise<void>;
  /** Admin: remove a member. */
  removeMember(id: string): Promise<void>;
  /** Admin: grant or revoke another member's admin role. */
  setMemberRole(id: string, role: OrgRole): Promise<void>;
  /** Admin: toggle a read-only preview of the member experience. */
  setPreviewAsMember(on: boolean): Promise<void>;

  // Sign-in (Supabase). All no-op gracefully when accounts are not configured.
  /** Email a sign-in: one message with a link (PKCE, this device only) and a
   *  6-digit code. The first email to a new address makes the account. */
  sendSignInEmail(email: string): Promise<void>;
  /** Sign in with the 6-digit code from that email. Throws when refused. */
  verifySignInCode(email: string, code: string): Promise<void>;
  /** Finish a sign-in from the link the app was opened with. Returns true once
   *  signed in; false when the link was refused, or holds nothing to trade. */
  completeAuthCallback(url: string): Promise<boolean>;
  /** Prove the inbox again while signed in (the step before adding a
   *  passkey): the code from a fresh email renews this session only, for the
   *  same account. Throws when refused. */
  confirmByCode(code: string): Promise<void>;
  /** Sign in with a passkey the keychain holds (lib/passkeys.ts). */
  signInWithPasskey(): Promise<void>;
  /** Add a passkey to the signed-in account. 'confirm' when the last email
   *  sign-in is older than 10 minutes: the caller asks for a code first. */
  addPasskey(): Promise<'added' | 'confirm'>;
  listPasskeys(): Promise<Passkey[]>;
  removePasskey(id: string): Promise<void>;
  /** Turn App Lock on or off, or change its time; each takes one unlock. */
  setAppLock(next: AppLockSetting): Promise<boolean>;
  /** Close the app behind the lock (launch, or a return past the time). */
  lockApp(): void;
  /** Ask for the device's unlock and open the app on a yes. */
  unlockApp(): Promise<void>;
  /** Adopt the server org waiting in orgJoin on this device. */
  joinOrg(): Promise<void>;
  /** Decline it on this device (remembered until sign-out). */
  declineOrg(): Promise<void>;
  /** Sign out on this device only, and forget the session. Always finishes
   *  here, offline too; the person's other devices stay signed in. */
  signOutAccount(): Promise<void>;
  /** End the sign-in on every device, then sign out here. Resolves true once
   *  the server confirmed; false (and nothing changed) when it could not be
   *  reached. */
  signOutEverywhere(): Promise<boolean>;
  /** How many team vault entries the signed-in account has on this device
   *  that have not reached the team (stashed or held), which a sign-out
   *  deletes, so Sign out can ask first. 0 when nobody is signed in. */
  unsentTeamTextCount(): Promise<number>;
  /** Delete the signed-in account on the server (Apple 5.1.1(v)), then sign
   *  this device out. A result, never a throw (state/accountDeletion.ts). */
  deleteAccount(): Promise<DeleteAccountOutcome>;
  /** Re-read the signed-in user's server role into serverRole. */
  refreshOrgRole(): Promise<void>;
  /** Re-read the org's billing entitlement from the server. */
  refreshEntitlement(): Promise<EntitlementRefresh>;
  /** Re-check a commercial org's seat billing when the app returns to the
   *  foreground, so seats bought in the browser land without a refresh.
   *  Fires only for a synced org not yet entitled, and is self-throttled. */
  reconcileEntitlementOnForeground(): Promise<void>;
  /** Handle the checkout-return deep link: refresh the org's entitlement now
   *  (unthrottled) and say what landed. */
  onCheckoutReturn(): Promise<void>;
  /** Open a commercial org's web billing: the Stripe customer portal if
   *  subscribed, else the purchase page. Always in the system browser (Apple 3.1.1); seats are
   *  never bought in-app. */
  manageBilling(): Promise<void>;
  /** Authorize an admin action: server role when signed in, else local UX. */
  authorizeAdmin(): Promise<boolean>;

  // Launch (Codemagic).
  /** Connect Codemagic by API token (stored in the Keychain). */
  connectCodemagic(token: string): Promise<void>;
  disconnectCodemagic(): Promise<void>;
  /** Save (or replace) the launch target. */
  saveLaunchTarget(target: Omit<LaunchTarget, 'id'> & { id?: string }): Promise<void>;
  /** Trigger a Codemagic build and follow it to a result. */
  startBuild(): Promise<void>;
  /** Run the "review builds" crew as a pre-deploy pass (advisory, non-blocking).
   *  Returns the chat id, or undefined when no review crew is in scope. */
  reviewBuild(): Promise<string | undefined>;
  /** Open a chat where the model reads a failed build and proposes a fix. */
  diagnoseBuild(runId: string): Promise<void>;
  /** Open a chat and hand the whole launch to the model: trigger, watch, read
   *  failures, and drive to a green build (Codemagic Access must be on). Returns
   *  the chat id, or undefined when access is off or nothing is set up. */
  launchWithModel(): Promise<string | undefined>;

  // Repositories.
  /** Connect a repo platform (GitHub, etc.) by token, stored in the Keychain. */
  connectRepoPlatform(id: string, token: string): Promise<void>;
  /** Connect a repo platform through one-tap OAuth (the GitHub App path). */
  connectRepoOAuth(id: RepoPlatform): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Finish a one-tap OAuth from a returning deep link when the app cold-started
   *  (it was evicted from memory while the person authorized). No-op when there
   *  is no pending attempt. */
  resumeRepoOAuth(url: string): Promise<void>;
  disconnectRepoPlatform(id: string): Promise<void>;
  /** Admin: set the home repo the whole system works through. */
  setHomeRepo(home: HomeRepo): Promise<void>;
  /** Offload buffered commit-intents to the home repo, confirm each, and clear
   *  the ones now safely in the home repo. Pending work is never deleted. */
  syncOutbox(): Promise<void>;
  /** The producer: compose a set of edits into a buffered commit-intent. Refuses
   *  (returns undefined) rather than truncate when it would exceed a cap. */
  bufferCommitIntent(input: {
    repoId: string;
    branch: string;
    message: string;
    baseCommit: string;
    files: Array<{ path: string; mode: 'upsert' | 'delete'; content?: string }>;
  }): Promise<string | undefined>;
  /** A portable JSON backup of everything not yet synced (the S2 escape hatch). */
  exportBuffer(): string;

  // Crew: user-authored agents.
  /** Create a crew agent and return its id. */
  /** Resolves to the new member's id. */
  createCrewAgent(input: Omit<CrewAgent, 'id' | 'createdAt'>): Promise<string | undefined>;
  updateCrewAgent(
    id: string,
    patch: Partial<Omit<CrewAgent, 'id' | 'createdAt'>>,
  ): Promise<boolean>;
  deleteCrewAgent(id: string): Promise<void>;
  /** Download the Harbor Lite guide model if it is not here yet. Returns success. */
  ensureHarborMini(): Promise<boolean>;
  /** Cancel an in-progress Harbor Lite download (returning users can skip it). */
  cancelHarborMini(): void;
  /** Download the Harbor guide model if it is not here yet. Returns success. */
  ensureHarbor(): Promise<boolean>;
  /** Cancel an in-progress Harbor download. */
  cancelHarbor(): void;
  /** Remove Harbor's weights from this device and drop its ready flag. Harbor
   *  is a real download (about 2.5 GB), so it is uninstallable; Harbor Lite is
   *  bundled with the app and has no counterpart here. */
  removeHarbor(): Promise<void>;
  /** Desktop only. Pull the DeepBlue size that fits this computer through
   *  the engine (Ollama) and seat it as the Reasoning model. Returns success. An
   *  install already running returns false without starting another. With
   *  `seat: false` it is pulled and left unseated: the offline door (Desktop
   *  Offline) gives this computer a model to answer offline without moving
   *  the person's own pick off the Reasoning model. */
  ensureHarborMaster(opts?: { seat?: boolean }): Promise<boolean>;
  /** First-run: start Harbor Lite's download and open the LLM Library intro. */
  beginHarborMiniWithIntro(): void;
  /** First-run: start Harbor's download and open the LLM Library intro. */
  beginHarborWithIntro(): void;
  /** Close the Library intro and return to setup; download keeps going. */
  endLibraryIntro(): void;
  /** Open a fresh chat with a guide, downloading it first if needed. Defaults
   *  to Harbor, the preferred pick. */
  startGuide(modelId?: string): Promise<string | undefined>;
  /** First open on the phone: open Harbor Lite's chat and start the guided
   *  setup walk in it (lib/guidedSetup.ts). */
  beginGuidedSetup(): Promise<void>;
  /** The current setup step's button: start Harbor's download in place, or
   *  open the step's page (the app comes back to the chat once it lands). */
  openSetupStep(): void;
  /** The current setup step's "Skip for now". */
  skipSetupStep(): void;
  /** Pick a paused setup walk back up at its current step. */
  resumeGuidedSetup(): void;
  /** The repository step's one choice: how edits are handled. Undefined
   *  means "decide later" (the starting mode stays). */
  chooseEditMode(mode: PermissionMode | undefined): Promise<void>;
  /** The fork after Harbor (lib/guidedSetup.ts): start chatting (the walk
   *  steps back until "Keep setting up" under the hello) or keep setting up. */
  chooseNext(choice: NextChoice): void;
  /** A pairing link opened from outside the app (the iPhone Camera reading
   *  the computer's QR, CX 2026-10-01): Pairing opens and asks before it
   *  pairs. Never pairs on its own. */
  pairOffer?: { address: string; claim: string };
  /** Open Computer with the link's offer, or say why it is not one. */
  offerPairing(link: string): void;
  clearPairOffer(): void;
  /** The break after the walk's opening (lib/guidedSetup.ts START_CHOICES):
   *  set up now, or just chat, which says where setup waits and carries the
   *  person to the main chat page on Slack Water (components/SlackWater.tsx).
   *  `origin` is where the tap landed, for the water to rise from. */
  chooseStart(choice: NextChoice, origin?: { x: number; y: number }): void;
  /** A step picked from the "help me get set up" list: the guide walks
   *  through it, and the list comes back when it is done or skipped. */
  pickSetupStep(step: SetupStepId): void;
  /** The steps the "help me get set up" list offers right now, read live so
   *  a connection made elsewhere drops its button. */
  setupMenuOffer(): SetupStepId[];
  /** Slack Water, while it plays: rising over the walk's chat as the old chat
   *  thins under it, then clearing off the main chat page (lib/slackWater.ts). */
  slackWater?: { seq: number; x: number; y: number; phase: 'rising' | 'clearing' };
  /** The old chat has thinned away under the water: the main chat page goes in. */
  slackWaterCovered(): void;
  /** The water is still again. */
  endSlackWater(): void;
  /** Bring your own Brave or Tavily key for local models' web search. */
  setSearchBackend(backend: 'brave' | 'tavily', apiKey: string): Promise<void>;

  // Vault (the Obsidian-compatible vault, first consumer of gitOS). Personal by
  // default; the team scope reads and writes the shared org vault.
  /** Switch between the personal and team vault, then refresh. Switching to
   *  team when it is not available is a no-op. */
  setVaultScope(scope: 'personal' | 'team'): Promise<void>;
  /** Whether the shared team vault is reachable right now (accounts configured,
   *  signed in as an active org member). Drives whether the switcher shows. */
  teamVaultAvailable(): boolean;
  /** Ensure the active vault exists and load its file list. */
  vaultRefresh(): Promise<void>;
  /** Open a note into vaultNote, by its exact listed path. A path that is not
   *  listed is a typed name: it is normalized, and when the provider does not
   *  hold it either, it opens as a fresh empty note. */
  // A listed note the storage no longer holds answers 'gone' (said once,
  // unless `quietGone`: a caller that makes it again says its own), and the
  // list is taken again (round 7 E24).
  vaultOpen(path: string, opts?: { quietGone?: boolean }): Promise<'opened' | 'gone' | undefined>;
  /** Create a note from a typed name: write an empty file so it persists
   *  immediately (a fresh note no longer evaporates on back-out), then open it
   *  in write mode. If it already exists, listed or not, just opens it. `at`
   *  pins the vault it lands in. */
  vaultCreate(path: string, content?: string, at?: VaultTargetRef): Promise<void>;
  /** Close the open note (back to the tree). A conflict still open on it is
   *  settled the lossless way first (vaultLeaveConflict). */
  vaultCloseNote(): void;
  /** The editor's live text for the open note, so a re-check can tell a
   *  clean draft (reload it in place) from a dirty one (ask). Not state:
   *  nothing renders from it. */
  vaultNoteDraft(path: string, text: string): void;
  /** Look at the open note again after the folder watcher saw a change
   *  (`paths`, or `tree` when it cannot say which), or when the window comes
   *  back (focus). Same version: nothing. Changed with a clean draft: reload
   *  in place. Changed under unsaved edits: raise vaultConflict. Gone: close
   *  a clean note, or ask about a dirty one. Runs in the note's save chain, so
   *  it never sees this device's own save half done. */
  vaultRecheck(opts: {
    reason: 'watch' | 'focus' | 'poll';
    paths?: string[];
    tree?: boolean;
  }): Promise<VaultRecheckResult>;
  /** Start the team vault's live refresh (Vault M2 2.7): the open note's
   *  head every 30 s (jittered), backing off to 300 s on errors, only while
   *  the team vault is on screen with a note open, the page is visible, and
   *  the device is online. `now` checks once at once (becoming visible). */
  vaultStartPoll(opts?: { now?: boolean }): void;
  /** Stop it (the page is hidden, or the room left). */
  vaultStopPoll(): void;
  /** The person's choice in the resolve sheet: 'both' (their text beside the
   *  note as a conflict copy, the note shows the other version), 'mine' (their
   *  text replaces it, or for a gone note is saved again), 'theirs' (the other
   *  version, their edits dropped), 'discard' (a gone note's edits dropped).
   *  `draft` is the editor's text now. */
  vaultResolve(
    choice: 'both' | 'mine' | 'theirs' | 'discard',
    draft: string,
  ): Promise<VaultResolveResult>;
  /** Close the resolve sheet without choosing ('not now'), or bring it back. */
  vaultDeferConflict(deferred: boolean): void;
  /** Leaving a note with a choice still open: a changed note keeps both
   *  (their text as the conflict copy), a gone note's text goes under Not
   *  saved. Never recreates a note someone else moved or deleted. */
  vaultLeaveConflict(): Promise<void>;
  /** Take the folder the store asked the list to show (vaultReturnFolder). */
  vaultTakeReturnFolder(): string | undefined;
  /** Write a note body and refresh the file list. `at` is the vault captured
   *  when the save was scheduled (vaultTargetRef); without it the save goes to
   *  the vault on screen now. */
  vaultSave(path: string, text: string, at?: VaultTargetRef): Promise<void>;
  /** Delete a note and refresh; closes it if it was open. Resolves true only
   *  when the delete really happened. */
  vaultDelete(path: string, at?: VaultTargetRef): Promise<boolean>;
  /** Every note body, for export, plus the paths that could not be read
   *  (`failed`). */
  vaultReadAll(): Promise<VaultReadAllResult>;
  /** The iPhone's free way out of the sealed Local vault (Settings, while
   *  the Vault room is shut): every personal note, exported to Files. */
  exportPersonalVault(): Promise<void>;
  /** One note's text in the vault on screen, through the body cache (read
   *  only when its listed version moved), for Linked mentions' excerpts.
   *  Undefined when it is not there. */
  vaultReadBody(path: string): Promise<string | undefined>;
  /** The vault on screen now, as a ref a scheduled save can carry. */
  vaultTargetRef(): VaultTargetRef | undefined;
  /** Why the vault on screen takes no writes (a Google Drive vault, D1), or
   *  undefined when it can be edited. */
  vaultReadOnly(): string | undefined;
  /** Drop one held "Not saved" draft, once the person has copied it. */
  vaultDiscardHeld(id: string): Promise<void>;
  /** The "Not saved" list the person signed in now may see: personal text,
   *  and team text typed under this same account (vaultHeldFor). */
  vaultHeldVisible(): VaultHeldDraft[];
  /** Take or renew the lease on the vault on screen now, when its storage
   *  keeps one (lib/vaultLease.ts), and record whether another device holds
   *  it live. A storage that keeps none is left alone. */
  vaultAcquireLease(): Promise<void>;
  /** A keystroke in the editor: take the lease on the first one after a
   *  quiet spell, renew it at most every 60 s while typing continues (TTL
   *  150 s). The only way a lease is held: never at mount, never on a timer. */
  vaultLeaseTouch(): Promise<void>;
  /** Release the lease this device holds (leaving the note or the Vault). */
  vaultReleaseLease(): Promise<void>;
  /** Enforced lease only: make this device the holder, so the other stops
   *  saving at its next renewal and keeps its text in its stash. */
  vaultTakeOverLease(): Promise<void>;
  /** Move the personal vault to a different storage provider (e.g. iCloud):
   *  copy every note across, check the target holds them all, then repoint
   *  the resource. Refused (ok false, nothing repointed) when the target is
   *  not usable or any source note could not be read. */
  vaultMoveTo(providerId: StorageProviderId): Promise<VaultMoveResult>;
  /** Ask main where the desktop vault folder is (vaultFolder). */
  vaultLoadFolder(): Promise<VaultDirInfo | undefined>;
  /** Run the system folder picker in main (a pick only repoints). On a
   *  change, text stashed against the old folder is held under Not saved and
   *  the vault re-lists. Undefined off the desktop. */
  vaultChooseFolder(): Promise<VaultPickResult | undefined>;
  /** One of the choices a pick's result offered (CX 1.4), then the same. */
  vaultRefineFolder(choice: VaultRefineChoice): Promise<VaultPickResult | undefined>;
  /** Bring the notes of the folder before the last pick into this one (the
   *  CTO's ruling): main copies with nothing replaced and nothing removed.
   *  The room holds still meanwhile (vaultMoving), then re-lists. Undefined
   *  off the desktop. */
  vaultBringPrevious(): Promise<VaultBringResult | undefined>;
  /** Whether a chat on this computer's engine is open now, so the storage
   *  sheet says open chats keep their old folder only when one is (CX 1.4). */
  vaultDesktopChatOpen(): boolean;
  /** Whether the one-time desktop move card shows now (Vault M1 1.3). */
  vaultFolderOfferShown(): boolean;
  /** The card's quiet button: keep the vault on this device. */
  vaultDeclineFolderMove(): Promise<void>;
  /** Both notes of a move's forked pair, read from the storage the vault is
   *  on now: the one already there (`from`) and the one moved beside it
   *  (`to`). */
  vaultReadForkPair(pair: {
    from: string;
    to: string;
  }): Promise<{ there: StoredFile; moved: StoredFile } | undefined>;
  /** Settle one forked pair: 'mine' gives the name to the moved note (then
   *  removes its copy), 'theirs' keeps the one already there (removes the
   *  moved copy). Nothing is written unless both are still what was shown. */
  vaultSettleFork(
    pair: { from: string; to: string },
    choice: 'mine' | 'theirs',
    shown: { there: StoredFile; moved: StoredFile },
  ): Promise<{ ok: boolean; changed?: boolean; partial?: boolean }>;
  /** Whether the one-time "keep one vault on your computer" card shows now
   *  (Vault M5, CTO J9): paired, the vault on This device by default, notes
   *  in it, and not declined for this computer. */
  vaultHubOfferShown(): boolean;
  /** The card's move: the existing move to the computer (every copy
   *  `ifAbsent`), remembering where the vault was so unpairing returns it. */
  vaultAcceptHubMove(): Promise<VaultMoveResult>;
  /** The card's quiet button: keep the notes on this device. */
  vaultDeclineHubMove(): Promise<void>;
  /** Run the J9 pairing rule now (the store runs it after a pairing and on
   *  the Vault's first list); resolves to what it did. */
  vaultAfterPairing(): Promise<HubPairPlan>;

  // ---- Vault M5: pins, notes to a model, the switch handoff (CTO J12 to J15)

  /** Pin notes to a project's context (J14): editors only (a local project,
   *  or `myLevel === 'edit'`), at most `PROJECT_VAULT_PINS_MAX`, deduped.
   *  Device local: never sent to the org server. False when refused. */
  setProjectVaultPins(projectId: string, paths: string[]): Promise<boolean>;
  /** "Pin to project context" from a note's options: the active project's
   *  unless one is named. */
  pinVaultNoteToProject(
    path: string,
    projectId?: string,
  ): Promise<'pinned' | 'already' | 'full' | 'refused'>;
  /** Take one pin off a project. */
  unpinVaultNote(projectId: string, path: string): Promise<void>;
  /** A note was renamed: every project's pin follows it (J14). */
  vaultRenamePins(from: string, to: string): Promise<void>;
  /** Whether the person may change this project's pins (an editor). */
  canEditProjectPins(projectId: string): boolean;
  /** Which of these pinned paths the personal vault still holds: 'missing'
   *  shows "Pinned note not found"; 'unknown' when the vault cannot be read. */
  vaultPinStatus(paths: string[]): Promise<Record<string, 'ok' | 'missing' | 'unknown'>>;
  /** Each pinned note's visibility, judged by this device's vault privacy
   *  rules (J3, the judge the pack uses) on the note's own text, or on its
   *  path alone when the text cannot be read, so the pins card can mark a
   *  private pin and say what it holds (CX and CMO, 2026-10-08, G). */
  vaultPinPrivacy(paths: string[]): Promise<Record<string, VaultVisibility>>;
  /** The personal vault's notes as the picker may show them (J15): hidden
   *  notes never, local-only ones with the lock. Never the team vault. */
  vaultPickerNotes(): Promise<VaultPickerNote[]>;
  /** The seat the next send in this chat goes to, for an excerpt's budget
   *  and the local-only refusal. Fails closed (leaves the network) when the
   *  seat cannot be judged. */
  composerSeat(conversationId?: string, fallback?: ConversationSource): ComposerSeat;
  /** A note's excerpt for the composer, sized for the chat's seat, with its
   *  cost line, or the refusal. Never sends anything. */
  composerVaultExcerpt(path: string, conversationId?: string): Promise<ComposerExcerptResult>;
  /** A note waiting to go into a chat's composer ("Ask about this note"),
   *  never auto-sent. The composer takes it once (its `take`), through the
   *  same budget and privacy check as a `[[` pick, and calls
   *  `takeComposerInsert`. */
  composerInsert?: { id: string; conversationId?: string; path: string };
  takeComposerInsert(id: string): void;
  /** A personal note's body for the composer's `[[` pick, with the verdict
   *  its own text gives (J3); null when it is gone or cannot be read. */
  composerVaultRead(
    path: string,
  ): Promise<{ text: string; updatedAt: string; visibility: VaultVisibility } | null>;
  /** "Ask about this note": open the active project's chat (a new one when
   *  none is open) with the excerpt in the composer. */
  askAboutVaultNote(path: string): Promise<void>;
  /** "Recently from your agent" (J15): the newest `crew` notes and the paths
   *  the agent's approved vault writes named on this device. */
  vaultAgentRecent(): Promise<VaultPickerNote[]>;
  /** Remember a path an approved `vaultWrite` or `vaultPropose` wrote (the
   *  device ring of 20). */
  noteAgentVaultWrite(path: string): Promise<void>;
  /** The context pack card's tap on a note title, when this device's vault
   *  can open that note: an app chat's pack (read from this device's vault),
   *  or an engine pack while this device's vault is the computer's (the hub,
   *  or the desktop's own folder). Undefined keeps the titles plain. */
  vaultPackOpener(conversationId: string): ((path: string) => void) | undefined;
  // ---- Vault M6 (state/vaultOps.ts does the work; these are its call sites)
  /** The Vault screen's autosave, bound while the room is mounted, so an
   *  operation writes the pending text first and cancels its timer (a stale
   *  save must never recreate a trashed note). */
  vaultBindAutosave(handle: VaultAutosave<VaultTargetRef> | undefined): void;
  /** What the Vault may offer on the storage on screen right now (CTO K1):
   *  every M6 action's visibility follows this one answer. */
  vaultCapsNow(opts?: { storageOnly?: boolean }): VaultCaps;
  /** Delete a note: to Trash where it is real (one tap), else for good with
   *  a courtesy Undo (R2). Closes it when it was open. */
  vaultDeleteNote(path: string, at?: VaultTargetRef): Promise<VaultDeleteOutcome | undefined>;
  /** Move a folder, whatever is in it, to Trash (only where Trash is real). */
  vaultDeleteFolder(folder: string): Promise<VaultDeleteOutcome | undefined>;
  /** Undo a delete, in the vault it was deleted from. */
  vaultUndoDelete(undo: VaultUndo, at?: VaultTargetRef): Promise<VaultRestoreResult | undefined>;
  /** Read Trash again (the Trash view and the tree's Trash row). */
  vaultLoadTrash(): Promise<TrashEntry[] | undefined>;
  /** Restore one Trash entry where it came from, never overwriting. */
  vaultRestoreTrash(id: string): Promise<VaultRestoreResult>;
  /** An admin sets who may delete team notes (CX Y14; migration 0025):
   *  'changed' when another admin's save landed first (the sheet shows the
   *  value there now), 'failed' when it could not be written. */
  vaultSetTeamDeleteRole(
    role: OrgVaultDeleteRole,
  ): Promise<'ok' | 'changed' | 'failed' | { kind: 'refused'; line: string }>;
  /** Empty Trash (not a team vault's, R3). */
  vaultEmptyTrash(): Promise<
    { ok: true; removed: number; asked: number } | { ok: false; reason: string }
  >;
  /** Plan a rename or move (6.2): the new path checked by the storage later,
   *  the referring notes read, the links counted. Nothing is written. */
  vaultPrepareMove(
    kind: 'note' | 'folder',
    from: string,
    to: string,
  ): Promise<VaultMovePreview | undefined>;
  /** Run a planned rename or move, with the link pass when asked (R1). The
   *  moved notes are adopted at the paths the storage answered with. */
  vaultApplyMove(
    preview: VaultMovePreview,
    updateLinks: boolean,
    onProgress?: (i: number, m: number) => void,
  ): Promise<VaultOpsMoveResult | undefined>;
  /** "Update the rest" on the standing card (CX X7). */
  vaultUpdateRest(
    preview: VaultMovePreview,
    report: VaultRewriteReport,
    onProgress?: (i: number, m: number) => void,
  ): Promise<VaultRewriteReport | undefined>;
  /** Make a folder (a real one, or a remembered empty one on Local). */
  vaultCreateFolder(
    path: string,
  ): Promise<
    | { ok: true; path: string }
    | { ok: false; reason: 'bad-name' | 'exists' | 'storage' | 'unsupported' }
  >;
  /** What a folder holds, for the sheet's counts before it acts (K5). */
  vaultFolderCounts(folder: string): Promise<{ notes: number; attachments: number }>;
  /** What search reads for the vault on screen (6.1): the index's titles and
   *  filtered BM25, and bodies through the body cache. Undefined until the
   *  index opens. */
  vaultSearchSource(): VaultSearchSource | undefined;
  /** The notes this device opened or saved in the vault on screen. */
  vaultRecentRing(): VaultRecentEntry[];
  /** Today's note (6.4): lib/vaultToday resolves which note and what a new
   *  one starts with; vaultOps.openToday writes it only while nothing has
   *  the name (one Today implementation). */
  vaultToday(): Promise<VaultTodayOutcome | undefined>;
  /** A tick in reading view (6.6; CTO K11, CX X13): `line` is the task's
   *  zero-based line in the whole note, frontmatter counted. Writes the box
   *  back by compare-and-swap; false when it did not land (the box then shows
   *  the file's truth, and a note that changed takes the resolve path). */
  vaultToggleTask(path: string, line: number, checked: boolean): Promise<boolean>;
  /** The person's own one-note edit (6.8, Link on an unlinked mention; CX
   *  X16): the note read now, `edit` applied, and written back only while it
   *  is still that version. False when it did not land or `edit` declined. */
  // A refusal for good (a team out of free space) answers its line, verb
  // first, since "try again" would not help; a note moved or deleted
  // somewhere else answers `gone` too, so the room drops its row (E34).
  vaultRewriteNote(
    path: string,
    edit: (text: string) => string | undefined,
  ): Promise<boolean | { ok: false; line: string; gone?: true }>;
  /** What images and PDFs read from on this storage (6.6): its attachments,
   *  Obsidian's attachment folder, and the byte reader. Undefined where the
   *  storage has none. */
  vaultMediaNow(): Promise<
    | {
        scope: string;
        attachments: AttachmentMeta[];
        attachmentFolder?: string;
        readBytes: (path: string, opts?: ReadBytesOptions) => Promise<BytesRead>;
      }
    | undefined
  >;
  /** The vault on screen's settings (Vault M7, CTO L5, L6), through the
   *  loader's 60 second cache; `force` reads now (the room became visible,
   *  a watcher hint). Undefined when no vault is reachable. */
  vaultLoadSettings(opts?: { force?: boolean }): Promise<ResolvedVaultSettings | undefined>;
  /** Where this device's engine sessions run and that computer's own Room
   *  for notes (Vault M8), for the settings sheet's honest line: the
   *  desktop's own machine config through the bridge, or a paired computer's
   *  `GET /vault/privacy`. Undefined with no engine in reach (an unpaired
   *  phone); `machine` undefined when the computer did not say. */
  vaultEngineRoomSource(): Promise<VaultEngineRoomSource | undefined>;
  /** The person's one changed field, written to `.oscode/vault.json` by
   *  compare-and-swap (CTO L7, CX Y5). Only the settings sheet calls it. */
  vaultSaveSetting(patch: VaultSettingsPatch): Promise<VaultSettingSave>;
  /** Mark a note reviewed, or not (CX Y12): the person's own compare-and-
   *  swap write of `oscode-reviewed` through `mergeProvenance`, every other
   *  byte kept. `changed`: the note moved on and the newer version is open. */
  // A refusal for good answers its line, verb first ("Not marked.").
  vaultMarkReviewed(
    path: string,
    reviewed: boolean,
  ): Promise<'ok' | 'changed' | 'failed' | { kind: 'refused'; line: string }>;
  /** Whether the empty vault's ramp offers the starter layout (CTO L12). */
  vaultStarterOffered(): Promise<boolean>;
  /** Add the starter layout (CX Y13's "Add these"): emptiness re-checked,
   *  every write `ifAbsent`. The whole layout toasts here. */
  vaultApplyStarter(): Promise<{ added: number; total: number }>;
  /** Ask the Vault room to open a sheet when it next shows, or clear it. */
  vaultRequestSheet(sheet: 'storage' | undefined): void;
  /** The switch note's "Save to Vault" (J12, D3): the person's own one-tap
   *  write to `Handoffs/<date> <project>.md`, `ifAbsent`, " 2" on a clash. */
  saveHandoffToVault(conversationId: string, itemId: string): Promise<string | undefined>;
  /** A project's latest handoff at most seven days old (J13), for the pack's
   *  handoff layer on a conversation's first send. Memory off reads none. */
  projectHandoff(projectId: string): Promise<StoredHandoff | undefined>;
  /** Run the Google Drive OAuth connect flow. Never throws. */
  connectGdriveAccount(): Promise<{ ok: boolean; error?: string }>;
  /** Revoke and forget the connected Google account. */
  disconnectGdriveAccount(): Promise<void>;
  /** Drop back to the zero-config DuckDuckGo default. */
  clearSearchBackend(): Promise<void>;
  openConversation(id: string): void;
  deleteConversation(id: string): void;
  /** Clear conversations (Settings): every chat on this device, and every
   *  handoff with them (J13), on this device, on this desktop's engine, and
   *  on the paired computer when this device owns it (a member has none to
   *  clear there). Journals on the computer stay. */
  clearConversations(): Promise<void>;
  /** Send to the active chat. While the agent is busy the message queues and
   *  goes out the moment the current task ends, the way Claude Code takes a
   *  message typed mid-run. */
  send(text: string, attachments?: Attachment[]): void;
  /** Drop a queued message before it goes out. */
  unqueue(index: number): void;
  abort(): void;
  answerApproval(
    approvalId: string,
    approve: boolean,
    always?: boolean,
    /** `files`: a commit card's ticked list (D3). */
    opts?: { inProject?: boolean; files?: string[] },
  ): void;
  /** Answer every pending approval at once (Approve all). */
  answerAllApprovals(approve: boolean): void;
  /** Resend the last user message after a stopped turn. */
  retryLast(): void;
  /** Plan mode: accept the proposal. Flips the session to accept-edits and
   *  tells the agent to proceed. */
  approvePlan(): void;
  /** Plan mode: keep the plan in view and hand the person the composer. */
  revisePlan(): void;
  /** The trust card's "Use them": trust the active session's folder on the
   *  computer it runs on (its own settings apply from the next chat there). */
  trustProjectFolder(itemId: string): Promise<void>;
  /** The trust card's "Not now": leave the folder's settings off. */
  dismissProjectTrust(itemId: string): void;
  /** The truncation card's "Give it more room" (C1, CX 6): the session's
   *  computer serves that provider's models the larger window from the next
   *  message, in every chat. */
  giveMoreRoom(itemId: string): Promise<void>;
  /** A model asked to search the web and the person has not answered yet
   *  (web search asks once; What leaves this device). The sheet shows it.
   *  `private` is the card for a search a local model wrote after its chat
   *  read a private note (CX and CMO, 2026-10-08, H): it asks every time,
   *  shows the exact words and why, and its answer is never remembered. */
  webSearchAsk?: WebSearchSheet;
  /** The web search question's answer: allow (remembered on this device) or
   *  not now (asked again after the next launch). `sheet` is the card the
   *  tap was on: an answer for a card no longer on screen (a second tap, or
   *  the scrim, while the sheet slides away) does nothing. */
  answerWebSearch(allow: boolean, sheet?: WebSearchSheet): void;
  /** The Settings switch for web search. */
  setWebSearchAllowed(allowed: boolean): Promise<void>;
  /** Opening web pages for the coding agent: ask, always, or never, carried
   *  to the computer and then saved here (lib/webFetchMode). False, and
   *  nothing changed, when the computer could not be reached. */
  setWebFetchMode(mode: 'ask' | 'allow' | 'off'): Promise<boolean>;
  /** The first try (v1 Phase 1): write the sample page on this computer,
   *  open a chat in it, and ask for the fix, so the whole loop shows on
   *  something that cannot hurt the person's own work. */
  trySampleProject(): Promise<void>;
  /** The changed-files card's undo: put back every file the task changed,
   *  or one (`path`), or redo them. Runs on the computer the session runs on;
   *  the engine echoes it, so every device folds the card. */
  restoreChangedFiles(itemId: string, direction: 'undo' | 'redo', path?: string): Promise<void>;
  /** "Rewind to here" (P2): take the active chat back to just before one of
   *  the person's own messages, and on a coding chat its folder's files too
   *  when `files` is set. Resolves to the message's words for the composer,
   *  or to why it did not happen. */
  rewindTo(itemId: string, opts: { files: boolean }): Promise<{ text: string } | { error: string }>;
  /** Set the permission mode for new sessions and the live one. */
  /** `source` names where the change came from, for the opt-in activity
   *  log's regret signal (a walk choice changed soon after). */
  setPermissionMode(mode: PermissionMode, source?: 'pill' | 'settings' | 'walk'): Promise<void>;
  /** Name a chat by hand; the generated title never overwrites it after. */
  renameConversation(id: string, title: string): Promise<void>;
  /** Fold the active session's history now (the /compact command). */
  compactActive(focus?: string): Promise<void>;
  /** The # shortcut: append a line to the project's standing instructions and
   *  push it to the live session. */
  addMemory(text: string): Promise<void>;
  /** Ranked repo paths for an @ mention in the composer; empty for chat brains. */
  listFiles(query: string): Promise<string[]>;
  /** Whether the active chat is an engine session with the person's controls. */
  activeIsAgent(): boolean;
  /** Add a quiet note row to the active transcript (help text, local status). */
  addNote(text: string): void;
  /** Open a session that lives on the paired desktop but has no chat here yet
   *  (started from the desktop app, or from another phone). */
  openDesktopSession(info: { id: string; cwd: string; title?: string }): Promise<void>;
  /** Chat-to-terminal bridge: run a command on the connected desktop (only a
   *  desktop-backed conversation has a terminal). Output streams into the
   *  transcript as a command card. */
  runCommand(command: string): void;
  sendCommandStdin(runId: string, data: string): void;
  killCommand(runId: string): void;
  /** Whether the active conversation can run terminal commands (desktop-backed). */
  canRunCommands(): boolean;
  /** Set Terminal Control for the machine the active session runs on. On lets
   *  the model run shell commands on its own there; Off (the default) blocks the
   *  model from the terminal entirely. Scoped to that one target. */
  setTerminalControl(on: boolean): Promise<void>;
  setCodemagicAccess(on: boolean): Promise<void>;

  // Wayfinding and Agentic Currents (lib/currents.ts).
  /** Turn one Wayfinding switch on or off. */
  setWayfinding(id: WayfindingId, on: boolean): Promise<void>;
  /** Research (Perplexity): ground web search in Sonar on the connected
   *  Perplexity key. Off by default; reuses the Cloud Connections key. */
  setPerplexityResearch(on: boolean): Promise<void>;
  /** Flip an Agentic Current for a project. One at a time within the project;
   *  different projects select independently. `at` is where the switch sits,
   *  for the arrival gesture. When no project still selects the prior current,
   *  its bench entry is purged from every stack, so off leaves no trace. */
  setAgenticCurrent(
    projectId: string,
    id: AgenticCurrentId,
    on: boolean,
    at?: { x: number; y: number },
  ): Promise<void>;
  /** Save what a current needs (an address, a model, a CLI, a key) and probe
   *  it. Returns whether it answered. */
  connectCurrent(
    id: AgenticCurrentId,
    input: { endpoint?: string; model?: string; command?: 'claude' | 'codex'; apiKey?: string },
  ): Promise<boolean>;
  /** Forget a current's connection and key, and turn it off if it was on. */
  disconnectCurrent(id: AgenticCurrentId): Promise<void>;
  /** Re-probe the host and the saved connections (on open, on reconnect, on
   *  demand). Never throws; an unreachable box reads as Arriving. */
  refreshCurrents(): Promise<void>;
  /** The arrival overlay reports that it settled. */
  clearCurrentArrival(): void;

  // Harness Currents (lib/harnessCurrents.ts): a second, independent group.
  /** Flip a Harness Current (Jev) for a project. One at a time WITHIN the
   *  harness group, but independent of the agentic group, so one of each may be
   *  on; different projects select independently. `at` drives the arrival. */
  setHarnessCurrent(
    projectId: string,
    id: HarnessCurrentId,
    on: boolean,
    at?: { x: number; y: number },
  ): Promise<void>;
  /** Save what a harness current needs (an address, a model, a key) and probe
   *  it. Returns whether it answered. */
  connectHarnessCurrent(
    id: HarnessCurrentId,
    input: { endpoint?: string; model?: string; apiKey?: string },
  ): Promise<boolean>;
  /** Forget a harness current's connection and key, and turn it off if on. */
  disconnectHarnessCurrent(id: HarnessCurrentId): Promise<void>;
  /** Re-probe the saved harness connections. Never throws. */
  refreshHarnessCurrents(): Promise<void>;
  /** Save a hub (upsert by base URL) and make it the active one. The role the
   *  hub reported at pairing rides along; when absent it is read from the hub. */
  saveHub(target: DaemonTarget, opts?: { role?: HubRole }): Promise<void>;
  /** Record what a hub says this device's credential may do. */
  setHubRole(baseUrl: string, role: HubRole | undefined): Promise<void>;
  /** Switch the active hub to a saved one by base URL. */
  selectHub(baseUrl: string): Promise<void>;
  /** Forget a saved hub; if it was active, fall back to another or none. A
   *  server's provider keys are deleted there first, with this device's
   *  credential, before it is revoked; the answer says whether that worked. */
  removeHub(baseUrl: string): Promise<HubKeysCleared>;
  /** Give a saved hub a friendly name (blank clears it). */
  renameHub(baseUrl: string, name: string): Promise<void>;
  /** On a desktop, run sessions on the active remote hub instead of this
   *  machine's own engine. Ignored on a phone. */
  setPreferRemoteHub(on: boolean): Promise<void>;

  saveSettings(patch: Partial<AppSettings>): Promise<void>;
  /** Record a freshly downloaded on-device model, reading fresh state so two
   *  concurrent downloads never clobber each other's deviceModels entry. */
  addDeviceModel(id: string, name: string): Promise<void>;
  /** Record a model downloaded to iCloud Drive rather than this device. */
  addCloudModel(id: string, name: string): Promise<void>;
  setCloudKey(key: string): Promise<void>;
  clearCloudKey(): Promise<void>;
  /** Connect a cloud provider by API key (Keychain), surfacing its models. The
   *  workspace id rides along for an identity-linked Anthropic key. */
  connectProvider(id: string, key: string, workspaceId?: string): Promise<void>;
  /** Keep these models on the Bench for a provider whose list loads live. */
  setProviderModels(id: string, models: ProviderModel[]): Promise<void>;
  /** Set or change the workspace a connected Claude key acts in, without
   *  pasting the key again. Checked with Claude first; kept unless refused. */
  setAnthropicWorkspace(workspaceId: string): Promise<KeyCheck>;
  /** Disconnect a cloud provider and forget its key, here and on every
   *  docked server that keeps it (best effort; the answer says where). */
  disconnectProvider(id: string, onlyServers?: readonly DaemonTarget[]): Promise<KeyRemoval>;

  /** Re-check home reachability + internet, updating the connectivity signals. */
  refreshConnectivity(): Promise<void>;
  /** Push each project repo's unpushed local commits to its remote, so a
   *  project's notes and code never linger only on this device. Runs on app
   *  open and on reconnect; desktop only (that is where the clones live). */
  reconcileProjectRepos(trigger: 'open' | 'reconnect'): Promise<void>;
  /** Manually step down to a more restrictive profile, or clear (auto). */
  setProfileOverride(profile?: ProfileId): Promise<void>;

  // Stack management (the app-side Reasoning model + specialists + bench).
  /** Connect models at an address you name (bring your own keys, Part 2):
   *  one connection per picked model, sharing an addressId, with the key, if
   *  any, under each one's own secret name. Returns the new connections. */
  connectByom(
    input: Omit<ByomConnectInput, 'ownTailnetSuffix'> & { apiKey?: string },
  ): Promise<ByomConnection[]>;
  /** Disconnect BYOM endpoints, one or every model from one address: delete
   *  each one's key and pull them from every stack, in one save. */
  disconnectByom(ids: string | readonly string[]): Promise<void>;
  /** Set or clear "Passes requests to a cloud provider" on every model from
   *  this connection's address, placed refs included (byomOps). */
  setByomForwards(id: string, on: boolean): Promise<void>;
  /** Set the Reasoning model anchor (from the bench or a cloud model) for a
   *  status. Defaults to the current status when `profile` is omitted. */
  setReasoning(ref: StackModelRef, profile?: ProfileId): Promise<void>;
  /** Move a bench model into a status's active stack under a category placement.
   *  Defaults to the current status when `profile` is omitted. */
  placeSpecialist(ref: StackModelRef, placement: Placement, profile?: ProfileId): Promise<void>;
  /** Move an active specialist back to the bench, keeping its metadata. */
  benchSpecialist(key: string, profile?: ProfileId): Promise<void>;
  /** Edit a model's category / trigger / persona, active or benched. */
  editPlacement(key: string, placement: Placement, profile?: ProfileId): Promise<void>;
}

/** Pull a bench id (a current's model) out of EVERY status's stack: the active
 *  specialists, the saved-placement map, and a Reasoning anchor (which falls
 *  back to the built-in guide). The same sweep disconnectByom does, shared so
 *  turning a current off can never leave its model behind in one profile. */
function purgeBenchId(
  stacks: ProfileStacks | undefined,
  benchId: string,
): ProfileStacks | undefined {
  if (!stacks) return stacks;
  const key = `byom:${benchId}`;
  const out: ProfileStacks = { ...stacks };
  for (const p of PROFILE_ORDER) {
    const st = out[p];
    if (!st) continue;
    const active = st.active.filter((m) => stackRefKey(m.ref) !== key);
    const saved = { ...st.saved };
    delete saved[key];
    const reasoning =
      st.reasoning && stackRefKey(st.reasoning) === key ? harborRef() : st.reasoning;
    out[p] = { ...st, active, saved, reasoning };
  }
  return out;
}

/** A stack as a build without Currents runs it (docs/release-tiers.md): a
 *  Current placed by an earlier build is left out of the turn (the anchor
 *  falls back to Harbor), without touching what is saved, so a build that has
 *  Currents finds the placement as it was. Exported for its test. */
export function stackForTier(stack: AppStack, tier: ReleaseTier = RELEASE_TIER): AppStack {
  if (featureOn('currents', tier)) return stack;
  const isCurrent = (ref: StackModelRef | undefined) =>
    ref?.kind === 'byom' && isCurrentBenchId(ref.id);
  if (!isCurrent(stack.reasoning) && !stack.active.some((m) => isCurrent(m.ref))) return stack;
  return {
    ...stack,
    reasoning: isCurrent(stack.reasoning) ? harborRef() : stack.reasoning,
    active: stack.active.filter((m) => !isCurrent(m.ref)),
  };
}

/** The project the person is currently in (activeProjectId, else the first), so
 *  the global rooms read its per-project current selections. */
export function activeProjectOf(settings: AppSettings): Project | undefined {
  const id = settings.activeProjectId ?? settings.projects?.[0]?.id;
  return id ? settings.projects?.find((p) => p.id === id) : undefined;
}

/** The Agentic Currents view for the active project: its selection plus the
 *  device-local connections. The rooms render currents through this. */
export function agenticView(
  settings: AppSettings,
  tier: ReleaseTier = RELEASE_TIER,
): CurrentsSettings {
  // Currents are v2: in an earlier build no current is on anywhere.
  if (!featureOn('currents', tier)) {
    return projectCurrentsSettings(undefined, settings.currentConnections);
  }
  return projectCurrentsSettings(activeProjectOf(settings), settings.currentConnections);
}

/** The Harness Currents view for the active project. */
export function harnessView(
  settings: AppSettings,
  tier: ReleaseTier = RELEASE_TIER,
): HarnessCurrentsSettings {
  if (!featureOn('currents', tier)) {
    return projectHarnessSettings(undefined, settings.harnessCurrentConnections);
  }
  return projectHarnessSettings(activeProjectOf(settings), settings.harnessCurrentConnections);
}

/** An Agentic Current's saved API key, if one is saved. */
async function currentSecretFor(id: AgenticCurrentId | null): Promise<string | null> {
  return id ? secretGet(currentSecretKey(id)) : null;
}

let convSeq = 0;
function newId(): string {
  return `c${Date.now().toString(36)}${(convSeq++).toString(36)}`;
}

/** Standard base64 of bytes (chunked, so large content does not overflow the
 *  argument stack). The daemon decodes this with Buffer.from(x, 'base64'). */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = new Uint8Array(new ArrayBuffer(bytes.length));
  buf.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** An immutable idempotency key for a buffered commit-intent. */
function outboxOpId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `op_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

/**
 * The signed-in member's TRUE authority: a personal account owns everything; in
 * a commercial org, only an admin does. This ignores the preview toggle, so an
 * admin previewing the member view can still exit it and run admin actions.
 * Client-side only: a real backend must enforce this, never the UI alone. Every
 * admin mutation routes through this one seam (authorizeAdmin below) so it can
 * become a server round-trip later without scattering role checks.
 */
export function isOrgAdmin(account?: Account): boolean {
  if (!account || account.type === 'personal') return true;
  const me = account.org?.members.find((m) => m.email === account.selfEmail);
  return me?.role === 'admin';
}

/**
 * Who sees the shared stack and storage as editable. Same as isOrgAdmin, but an
 * admin can flip previewAsMember to view the read-only member experience. Use
 * this for UI gating; use isOrgAdmin to authorize a change.
 */
export function stackAdmin(account?: Account): boolean {
  if (account?.previewAsMember) return false;
  return isOrgAdmin(account);
}

/** The device StackModelRef for the flagship guide (Harbor). Harbor Lite has
 *  its own harborRef() in stack.js; this is its bigger sibling. */
function harborFullRef(): StackModelRef {
  return { kind: 'device', modelId: HARBOR_MODEL_ID, modelName: HARBOR_MODEL_NAME };
}

/**
 * Decide whether a freshly downloaded guide should become the stack's Reasoning
 * anchor, so "My Stack" chat can start right away. Promote when there is no
 * anchor yet, or the current anchor is a built-in guide that is not actually on
 * this device. The preferred guide (Harbor) also upgrades a ready Harbor Lite;
 * Mini never demotes a ready guide, and neither ever overrides a cloud, BYOM,
 * or user-chosen device model the user deliberately set. `ref` is assumed to be
 * a guide that is already downloaded.
 */
function reasoningPromotion(
  stack: AppStack | undefined,
  ref: StackModelRef,
  opts: { harborReady: boolean; harborMiniReady: boolean; preferred: boolean },
): StackModelRef | undefined {
  const current = stack?.reasoning;
  if (!current) return ref;
  if (stackRefKey(current) === stackRefKey(ref)) return undefined;
  if (current.kind !== 'device') return undefined;
  const id = current.modelId;
  const currentReady =
    id === HARBOR_MODEL_ID
      ? opts.harborReady
      : id === HARBOR_MINI_MODEL_ID
        ? opts.harborMiniReady
        : true; // a user-chosen pocket model: respect it
  if (!currentReady) return ref;
  const currentIsGuide = id === HARBOR_MODEL_ID || id === HARBOR_MINI_MODEL_ID;
  return opts.preferred && currentIsGuide ? ref : undefined;
}

/** The status the app is in right now: the auto profile from the connection,
 *  possibly stepped down by a manual override. The per-status stack for this
 *  profile is the one used for new work. */
function activeProfile(connectivity: Connectivity, override?: ProfileId): ProfileId {
  return effectiveProfile(autoProfile(connectivity), override);
}

/** Heal a stack whose Reasoning anchor is a built-in guide not present on this
 *  device: promote it to whichever guide IS downloaded (Harbor preferred), so
 *  the status still answers instead of pointing at a model to download first. A
 *  cloud, BYOM, or user-chosen device anchor is left untouched. Returns the same
 *  reference when nothing changes, so callers can cheaply detect a no-op. */
function healedAnchor(stack: AppStack, harborReady: boolean, harborMiniReady: boolean): AppStack {
  const anchor = stack.reasoning;
  if (anchor?.kind !== 'device') return stack;
  const id = anchor.modelId;
  const isGuide = id === HARBOR_MODEL_ID || id === HARBOR_MINI_MODEL_ID;
  if (!isGuide) return stack;
  const ready = id === HARBOR_MODEL_ID ? harborReady : harborMiniReady;
  if (ready) return stack;
  const promote = harborReady ? harborFullRef() : harborMiniReady ? harborRef() : undefined;
  return promote ? { ...stack, reasoning: promote } : stack;
}

/** Whether a routine change is a pause only (enabled set to false, and
 *  nothing else), which never needs an account. */
function routinePause(patch: Record<string, unknown>): boolean {
  const keys = Object.keys(patch);
  return keys.length === 1 && keys[0] === 'enabled' && patch.enabled === false;
}

// isEntitled lives in lib/entitlement.ts; re-exported for the callers that
// read it from the store.
export { isEntitled };

/** The signed-in member's role in a commercial org, if any. */
export function selfMember(account?: Account): OrgMember | undefined {
  if (!account || account.type !== 'commercial') return undefined;
  return account.org?.members.find((m) => m.email === account.selfEmail);
}

/** A driver that has closed itself for good (a RemoteDriver after its fatal
 *  answer: the session is gone, or the hub revoked this phone). Read by duck
 *  type so the store never reaches into a driver's internals by name. */
function driverClosed(driver: ChatDriver): boolean {
  const d = driver as unknown as { closed?: boolean; terminated?: boolean };
  return d.terminated === true || d.closed === true;
}

export const useApp = create<AppState>((set, get, api) => {
  /** Detach and release a conversation's driver, if any. */
  function dropDriver(conversationId: string): void {
    drivers.get(conversationId)?.dispose();
    drivers.delete(conversationId);
    unsubscribers.get(conversationId)?.();
    unsubscribers.delete(conversationId);
  }

  /** The conversation's driver, unless it has closed itself, in which case it
   *  is dropped and treated as absent so the next open rebuilds it (and a
   *  desktop reopen shows its snapshot first). A disposed driver still sitting
   *  in the map is exactly what a relaunch looks like. */
  function liveDriver(conversationId: string): ChatDriver | undefined {
    const d = drivers.get(conversationId);
    if (d && driverClosed(d)) {
      dropDriver(conversationId);
      return undefined;
    }
    return d;
  }
  function hasLiveDriver(conversationId: string): boolean {
    return liveDriver(conversationId) !== undefined;
  }

  /** APP-10: a message typed before the driver attached goes out now. */
  function flushPendingFirstMessage(conversationId: string, driver: ChatDriver): void {
    const text = get().conversations[conversationId]?.pendingFirstMessage;
    if (!text) return;
    const attachments = pendingSends.get(conversationId);
    pendingSends.delete(conversationId);
    set((state) => {
      const c = state.conversations[conversationId];
      if (!c) return state;
      return {
        conversations: {
          ...state.conversations,
          [conversationId]: { ...c, pendingFirstMessage: undefined, pendingFirstError: undefined },
        },
      };
    });
    deliver(conversationId, driver, text, attachments);
    void persistConversations(get());
  }

  /** A driver that talks to a paired computer over the network (the daemon
   *  path), as opposed to this machine's own engine or a brain in the app. */
  function isRemote(driver: ChatDriver): boolean {
    if (driver.kind !== 'desktop') return false;
    return !(isDesktop() && bridge() && !get().settings.preferRemoteHub);
  }

  /** The one way text leaves for a driver (B3). The user bubble is painted
   *  here, the moment the text leaves, and the chat is busy from that instant;
   *  the driver's own task-start for the same text folds into that bubble in
   *  the reducer, so nothing shows twice. That matters beyond the daemon's
   *  wait: every driver is behind the ethics screen, which runs before the
   *  driver's task-start, so without the paint a second message or a model
   *  switch in that gap would reach a chat that looked idle. The engine on
   *  this machine is left to its own task-start (it may reword the input). */
  function deliver(
    conversationId: string,
    driver: ChatDriver,
    text: string,
    attachments?: Attachment[],
  ): void {
    // Desktop Offline: a cloud chat waits while this device is offline (or
    // Offline is chosen). The send ends here with its plain line, never a
    // request that cannot leave or should not, and the stop card's doors
    // carry on from it (Choose another model, Try again).
    const waiting = offlineCloudWait(conversationId);
    if (waiting) {
      set((state) => {
        const c = state.conversations[conversationId];
        if (!c || c.thread.busy) return state;
        const started = reduceEvent(c.thread, { type: 'task-start', input: text });
        const thread = reduceEvent(started, {
          type: 'task-done',
          reason: 'error',
          message: waiting,
        });
        return {
          conversations: {
            ...state.conversations,
            [conversationId]: { ...c, thread, updatedAt: new Date().toISOString() },
          },
        };
      });
      return;
    }
    const paint = isRemote(driver) || driver.kind !== 'desktop';
    if (paint) {
      set((state) => {
        const c = state.conversations[conversationId];
        if (!c || c.thread.busy) return state;
        const started = reduceEvent(c.thread, { type: 'task-start', input: text });
        const thread = isRemote(driver) ? { ...started, stepNote: REACHING_COMPUTER } : started;
        return {
          conversations: {
            ...state.conversations,
            [conversationId]: { ...c, thread, updatedAt: new Date().toISOString() },
          },
        };
      });
    }
    driver.send(text, attachments);
  }

  /** The line a cloud chat's send ends with while this device is offline,
   *  or undefined when it may go (Desktop Offline). */
  function offlineCloudWait(conversationId: string): string | undefined {
    const s = get();
    const source = s.conversations[conversationId]?.source;
    if (source?.kind !== 'cloud') return undefined;
    if (!offlineNow(s.connectivity, s.settings.profileOverride)) return undefined;
    const name =
      source.provider === 'anthropic'
        ? claudeModelLabel(source.model)
        : providerModelLabel(source.provider, source.model);
    return cloudWaitLine(
      name,
      offlineChosen(s.connectivity, s.settings.profileOverride),
      isDesktop() ? 'this computer' : thisDeviceNoun(),
    );
  }

  /** A driver build's failure in plain words: a hub that did not answer in
   *  time is a sentence with a next step, never the platform's TimeoutError. */
  function friendlyOpenError(err: unknown): string {
    const name = (err as { name?: unknown } | null)?.name;
    const message = err instanceof Error ? err.message : String(err);
    if (name === 'TimeoutError' || /timed? ?out|due to timeout/i.test(message)) {
      return HUB_NO_ANSWER;
    }
    return message;
  }

  /** One door for an account action a screen takes (a routine, a crew
   *  member): the sign-in sheet when nobody is signed in. True when the
   *  action may go ahead. */
  function requireAccount(feature: AccountFeature): boolean {
    if (!get().needsAccountNow()) return true;
    get().openAccountGate(feature);
    return false;
  }

  /** One door to the coding agent (state/gateOps.ts): signed out, no coding
   *  session is built or attached, whichever path asks. Reading a coding chat
   *  stays free; its saved snapshot is what shows. */
  function codingLockedNow(conv: Conversation | undefined): boolean {
    return codingLocked(conv, get().needsAccountNow());
  }

  /** Read a commercial org's seat entitlement from the server
   *  (refreshEntitlement's body). */
  async function readEntitlementsNow(): Promise<EntitlementRefresh> {
    let session: Session | undefined;
    try {
      session = await freshAuth();
    } catch {
      // Offline: keep whatever entitlement we last knew.
      return 'offline';
    }
    if (!session) return 'signed-out';
    const serverId = get().settings.account?.org?.serverId;
    // Org entitlement: only when the account is a synced commercial org. Gates
    // team-seat growth (growthGatedByBilling), unchanged.
    if (!serverId) {
      set({ entitlement: undefined });
      return 'ok';
    }
    try {
      const rows = await supabaseSelect<{
        tier_id: string;
        status: Entitlement['status'];
        valid_until: string | null;
      }>(
        'org_entitlements',
        session.accessToken,
        `select=tier_id,status,valid_until&org_id=eq.${serverId}`,
      );
      const row = rows[0];
      set({
        entitlement: row
          ? { tierId: row.tier_id, status: row.status, validUntil: row.valid_until ?? undefined }
          : undefined,
      });
    } catch {
      // Offline or transient: keep whatever entitlement we last knew.
      return 'offline';
    }
    return 'ok';
  }

  /** The driver could not be built. Say so once, and if a message is parked
   *  on the chat, pin the reason beside its bubble with a Retry. A build
   *  refused at the account door is no failure: a waiting message opens the
   *  sign-in sheet instead, and stays parked for the attach after it. */
  function failOpen(conversationId: string, err: unknown): void {
    if (err instanceof CodingLockedError) {
      if (get().conversations[conversationId]?.pendingFirstMessage) {
        get().openAccountGate('coding');
      }
      return;
    }
    const message = friendlyOpenError(err);
    set((state) => {
      const c = state.conversations[conversationId];
      if (!c || !c.pendingFirstMessage) return state;
      return {
        conversations: {
          ...state.conversations,
          [conversationId]: { ...c, pendingFirstError: message },
        },
      };
    });
    get().showToast(message);
  }

  /** Build and attach a chat's driver unless one exists or is on its way. A
   *  send that lands mid-build parks on the chat and the attach delivers it. */
  function ensureDriver(conversationId: string): void {
    if (hasLiveDriver(conversationId) || building.has(conversationId)) return;
    const conv = get().conversations[conversationId];
    if (!conv) return;
    // Signed out, a coding chat reopens on its snapshot and nothing reaches
    // the engine. A message waiting to go (a send, a Retry) opens the sign-in
    // sheet and stays parked; signing in builds this driver and the attach
    // delivers it (onSignedIn).
    if (codingLockedNow(conv)) {
      if (get().resumingId === conversationId) set({ resumingId: undefined });
      failOpen(conversationId, new CodingLockedError());
      return;
    }
    building.add(conversationId);
    // Desktop threads replay their journal into the UI, so they rebuild from
    // the daemon with no seed. Chat brains (device/cloud/stack) live only in a
    // module-level driver map that is empty after a reload, so a reopened chat
    // MUST reseed the new driver from the persisted transcript, or the model
    // has no memory of a conversation the user is looking at in full.
    const seed = conv.source.kind === 'desktop' ? undefined : seedFromTranscript(conv.thread.items);
    const epoch = driverEpoch.get(conversationId) ?? 0;
    void buildDriver(conv, seed)
      .then((driver) => {
        // The person switched models while this was building: the switch's
        // driver is the chat's brain now, so this one is released unused.
        if ((driverEpoch.get(conversationId) ?? 0) !== epoch) {
          driver.dispose();
          return;
        }
        // A guide line written while this was building is on screen but not
        // in the seed; hand it over so the model has read it too.
        const latest = get().conversations[conversationId];
        if (seed && latest) {
          for (const turn of seedFromTranscript(latest.thread.items).slice(seed.length)) {
            driver.recordLine?.(turn);
          }
        }
        attachDriver(conversationId, driver);
      })
      .catch((err) => failOpen(conversationId, err))
      .finally(() => {
        building.delete(conversationId);
        if (!drivers.has(conversationId) && get().resumingId === conversationId) {
          set({ resumingId: undefined });
        }
      });
  }

  /** The hub's link as the driver reports it: live clears the banner and
   *  notes when the hub was last heard from; the rest is the banner's state. */
  function noteHubLink(baseUrl: string, state: HubLinkState): void {
    if (state === 'live') {
      if (get().hubLink) set({ hubLink: undefined });
      void get().saveSettings({
        hubLastSeen: { ...(get().settings.hubLastSeen ?? {}), [baseUrl]: new Date().toISOString() },
      });
      return;
    }
    set({ hubLink: { state, since: Date.now() } });
  }

  function attachDriver(conversationId: string, driver: ChatDriver): void {
    // A coding session that finished building after a sign-out is let go:
    // the door holds for builds that straddle it too.
    if (codingLockedNow(get().conversations[conversationId])) {
      driver.dispose();
      return;
    }
    dropDriver(conversationId);
    drivers.set(conversationId, driver);
    // APP-13: events fold into ONE state update per tick. A journal replay
    // hands over hundreds of events synchronously, which used to be hundreds
    // of renders; live streaming delivers one event per task, so batching
    // costs it nothing. The side effects below run after the fold, in order.
    const pending: Array<{ event: DriverEvent; seq: number }> = [];
    let scheduled = false;
    // What the turn in flight has shown, for the success tap at its end.
    let shown = NOTHING_SHOWN;
    const flush = () => {
      scheduled = false;
      const batch = pending.splice(0);
      if (!batch.length) return;
      // The first journaled frame (seq 1 and up; a driver's own status rows
      // carry the last seen seq, 0 on a fresh reopen) is the replay landing:
      // a saved snapshot gives way to it, and the resume is over.
      const journaled = batch.some(({ seq }) => seq >= 1);
      set((state) => {
        const conv = state.conversations[conversationId];
        if (!conv) return state;
        let thread = conv.thread;
        if (journaled && snapshotIds.has(conversationId)) {
          snapshotIds.delete(conversationId);
          thread = emptyThread();
        }
        // The first user line names a new chat; the engine's generated title
        // then replaces that placeholder, unless the person named it by hand.
        let title = conv.title;
        for (const { event, seq } of batch) {
          thread = reduceEvent(thread, event, seq);
          if (event.type === 'title' && !conv.renamed) title = event.title;
        }
        if (title === 'New chat') title = titleFrom(thread) ?? title;
        const next: Conversation = {
          ...conv,
          thread,
          title,
          updatedAt: new Date().toISOString(),
        };
        return {
          conversations: { ...state.conversations, [conversationId]: next },
          ...(journaled && state.resumingId === conversationId ? { resumingId: undefined } : {}),
        };
      });
      let celebrated = false;
      for (const { event } of batch) {
        shown = turnShown(shown, event);
        if (celebratesTurn(shown, event) && !celebrated) {
          celebrated = true;
          hapticSuccess();
        }
        afterEvent(event);
      }
      // Persist snapshots for phone-local conversations. P2-12: snapshot at
      // both bookends (task-start captures the user's message immediately;
      // task-done captures the finished reply) and debounce during streaming
      // so a mid-turn relaunch does not lose the answer so far. One write per
      // batch, however many events it folded.
      if (batch.some(({ event }) => event.type === 'task-start' || event.type === 'task-done')) {
        void persistConversations(get());
      } else if (batch.some(({ event }) => event.type === 'text-delta')) {
        persistConversationsSoon();
      }
    };
    const afterEvent = (event: DriverEvent) => {
      // Permission mode on the CLIENT-side brains (the stack runs its tools in
      // the app): auto-answer the approvals the mode covers. Engine sessions
      // decide inside the loop (it never asks for what the mode allows), so a
      // question that reaches here from one is a real one and always shows.
      if (event.type === 'approval-request') {
        // Terminal Control is the master gate for the model's shell on the hub:
        // On (and permitted) auto-runs the command; Off auto-denies it with a
        // reason that sends the person to the switch, keeping the model and the
        // terminal fully separate until they let it in. It governs only a shell
        // call on a desktop-backed session (the engine drivers, the sole
        // emitters of runShell); a non-shell desktop ask (cloud spend) and a
        // client brain fall through untouched to the existing rules.
        const s = get();
        const isAdmin = isOrgAdmin(s.settings.account) || s.serverRole === 'admin';
        // Codemagic Access is the master gate for the model driving builds: On
        // (and permitted) auto-runs the Codemagic tool; Off auto-denies it with a
        // reason that sends the person to the switch. It governs only the one
        // 'codemagic' tool; a non-Codemagic request returns undefined here and
        // falls through to Terminal Control and the permission mode untouched.
        const decision =
          decideCodemagicApproval(event.request, {
            access: s.settings.codemagicAccess,
            canControl: canControlCodemagicFor(s.settings.account, isAdmin),
          }) ??
          decideApproval(event.request, {
            driverKind: driver.kind,
            desktopLocal: isDesktop() && Boolean(bridge()) && !s.settings.preferRemoteHub,
            daemon: s.settings.daemon,
            control: s.settings.terminalControl,
            canControl: canControlTerminalFor(s.settings.account, isAdmin),
            mode: s.settings.permissionMode ?? DEFAULT_PERMISSION_MODE,
          });
        if (decision.action === 'auto-approve') {
          drivers.get(conversationId)?.answerApproval(event.request.id, { approve: true });
        } else if (decision.action === 'auto-deny') {
          drivers
            .get(conversationId)
            ?.answerApproval(event.request.id, { approve: false, reason: decision.reason });
        }
        // 'sheet': leave the approval request on the sheet for the person. A
        // desktop non-shell tool (an always-ask vaultWrite included) is never
        // client-auto-approved; the engine already decided to ask.
        else if (!daemonPushes(conversationId)) {
          const conv = get().conversations[conversationId];
          if (conv) {
            void postChatNotice('approval', approvalNotice(conversationId, conv.title), s.settings);
          }
        }
      }
      // The task ended: a message typed mid-run goes out now, in order. (A
      // completed task's success tap is fired once per batch by flush.)
      if (event.type === 'task-done') {
        // APP-4: a driver that closed itself with this error (the daemon's
        // fatal answer) is dead; drop it so the next open rebuilds instead of
        // queueing every later message behind a run that will never end.
        if (event.reason === 'error' && driverClosed(driver)) {
          dropDriver(conversationId);
          return;
        }
        const conv = get().conversations[conversationId];
        // A Claude turn that proves the key's setup wrong marks it, so the
        // next guide opens on a brain that can answer instead of this one.
        if (
          event.reason === 'error' &&
          conv?.source.kind === 'cloud' &&
          conv.source.provider === 'anthropic' &&
          isSetupFailure(event.message ?? '')
        ) {
          set({ cloudKeyNeedsFix: true });
        }
        // Tell a person who walked away that the turn ended. The gate holds it
        // back while the app is in front, so a journal replay on open (always
        // foreground) never fires one; a desktop session the daemon already
        // pushes for is left to that push.
        if (conversationId === get().settings.guidedSetup?.conversationId) {
          // A question asked mid-walk was answered; pick the walk back up.
          setTimeout(() => advanceGuidedSetup(), 0);
        }
        if (conv && !daemonPushes(conversationId)) {
          void postChatNotice(
            'reply',
            replyNotice(conversationId, conv.title, event.reason),
            get().settings,
          );
        }
        // Activation: the first time a model produces a working reply on this
        // device (once per model, persisted via logOnce). CX's funnel
        // denominator, so we can later measure whether the community layer helps
        // a first-run user pick a model that succeeds. Nothing here is sent
        // anywhere the rest of insights is not; it is local telemetry.
        if (event.reason === 'complete' && conv) {
          const s = conv.source;
          const key =
            s.kind === 'device'
              ? `device:${s.modelId}`
              : s.kind === 'cloud'
                ? `cloud:${s.provider}:${s.model}`
                : s.kind === 'desktop-chat'
                  ? `desktop-chat:${s.model ?? 'unknown'}`
                  : s.kind === 'stack' || s.kind === 'desktop'
                    ? s.kind
                    : undefined;
          if (key) logOnce(`first_successful_run:${key}`, { kind: s.kind, model: key });
        }
        const queued = conv?.thread.queued ?? [];
        if (conv && queued.length) {
          const [head, ...rest] = queued;
          set((state) => {
            const c = state.conversations[conversationId];
            if (!c) return state;
            return {
              conversations: {
                ...state.conversations,
                [conversationId]: { ...c, thread: { ...c.thread, queued: rest } },
              },
            };
          });
          const next = drivers.get(conversationId);
          if (next) deliver(conversationId, next, head!);
        }
      }
      // Funnel milestones (opt-in only; no-ops otherwise).
      const srcKind = get().conversations[conversationId]?.source.kind;
      if (event.type === 'text-final' && srcKind && srcKind !== 'mock') {
        logOnce('first_local_reply', { source: srcKind });
      }
      if (
        event.type === 'tool-end' &&
        event.result?.ok &&
        /edit|write|apply/i.test(event.call.name)
      ) {
        logOnce('first_accepted_edit', { tool: event.call.name });
      }
    };
    const off = driver.subscribe((event: DriverEvent, seq: number) => {
      // Chain of Thought off: reasoning never reaches the chat, whichever
      // driver sent it (a desktop session opened while it was on, or an older
      // engine that does not know the setting). The flip applies at once.
      if (event.type === 'thinking-delta' && !chainOfThoughtOn()) return;
      pending.push({ event, seq });
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    });
    unsubscribers.set(conversationId, off);
    // After the replay (if any) has folded: a journal handed over at subscribe
    // is batched to the next microtask, and a parked message must land on the
    // replayed thread, not on the snapshot the replay is about to replace.
    queueMicrotask(() => {
      if (drivers.get(conversationId) === driver) flushPendingFirstMessage(conversationId, driver);
    });
  }

  /** APP-5: the daemon's session id is state, written through `set` and
   *  persisted at once, so a kill before the first message never orphans a
   *  session on the hub. */
  async function bindSessionId(
    conversationId: string,
    sessionId: string,
    cwd?: string,
  ): Promise<void> {
    set((state) => {
      const c = state.conversations[conversationId];
      if (!c || c.source.kind !== 'desktop') return state;
      // The folder the session started in, kept on the source: the engine
      // cannot move a session, so the picker can say where this chat works.
      const at = c.source.cwd ?? cwd;
      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...c,
            source: { ...c.source, sessionId, ...(at ? { cwd: at } : {}) },
          },
        },
      };
    });
    await persistConversations(get());
  }

  // ---- Guided setup (lib/guidedSetup.ts) --------------------------------------

  // What the walk can see right now.
  function setupFacts(): SetupFacts {
    const s = get();
    return {
      harborReady: Boolean(s.settings.harborReady),
      harborDownloading: Boolean(s.harborDownload && !s.harborDownload.failed),
      computer: Boolean(s.settings.daemon),
      repo:
        Object.values(s.connectedRepoPlatforms).some(Boolean) || Boolean(s.settings.repo?.homeRepo),
      key: s.cloudKeyPresent || Object.values(s.connectedProviders).some(Boolean),
      desktop: isDesktop(),
    };
  }

  let guideSeq = 0;
  function guideItemId(conversationId: string): string {
    return `${conversationId}-setup-${Date.now().toString(36)}${(guideSeq++).toString(36)}`;
  }
  // Add one of the guide's scripted lines to its chat. It mounts as streaming
  // and settles a tick later, so it arrives like a reply (a few words at a
  // time, fading in) rather than landing as a block. Never while the guide is
  // mid-reply: the walk resumes when that reply ends.
  function appendGuideMessage(
    conversationId: string,
    text: string,
    opts: { paced?: 'greeting' | 'walk'; id?: string; settled?: boolean } = {},
  ): boolean {
    const conv = get().conversations[conversationId];
    if (!conv || conv.thread.busy) return false;
    const id = opts.id ?? guideItemId(conversationId);
    // A settled line (reduced motion, a skip) lands whole; otherwise it mounts
    // live and reveals, at its paced beat when it has one.
    const paced = opts.settled ? {} : { paced: opts.paced ?? ('walk' as const) };
    const patch = (streaming: boolean) =>
      set((st) => {
        const c = st.conversations[conversationId];
        if (!c) return st;
        const items = streaming
          ? [
              ...c.thread.items,
              { kind: 'assistant' as const, id, text, streaming: !opts.settled, ...paced },
            ]
          : c.thread.items.map((i) =>
              i.id === id && i.kind === 'assistant' ? { ...i, streaming: false } : i,
            );
        return {
          conversations: {
            ...st.conversations,
            [conversationId]: { ...c, thread: { ...c.thread, items } },
          },
        };
      });
    patch(true);
    // The model answering in this chat hears the line too, so a question about
    // the step is asked of a model that has read it.
    drivers.get(conversationId)?.recordLine?.({ role: 'assistant', text });
    setTimeout(() => {
      patch(false);
      void persistConversations(get());
    }, 0);
    return true;
  }

  // The first open's letter (lib/introWalk.ts, "Tide Letter"): stillness, the
  // greeting written in word groups, a reading pause, then the walk's opening
  // at a brisker pace; the step's buttons follow once its last word inks. Each
  // beat is scheduled from the exact reveal plan of the one before it. A tap
  // or a keystroke skips to the end (every remaining line lands whole), and
  // reduced motion shows it all at once.
  function writeIntroLetter(conversationId: string, opening: string): void {
    const helloId = `${conversationId}-hello`;
    // No screen (a test, a headless run) or reduced motion: the letter lands
    // whole, with no typing and no pauses.
    if (typeof window === 'undefined' || prefersReducedMotion()) {
      appendGuideMessage(conversationId, HARBOR_MINI_SETUP_GREETING, {
        id: helloId,
        settled: true,
      });
      appendGuideMessage(conversationId, opening, { settled: true });
      return;
    }
    setIntroPlaying(true);
    let stage = 0;
    const timers: number[] = [];
    const done = () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener(REVEAL_SKIP_EVENT, onSkip);
    };
    const onSkip = () => {
      done();
      introSkipped();
      if (stage < 1) {
        appendGuideMessage(conversationId, HARBOR_MINI_SETUP_GREETING, {
          id: helloId,
          settled: true,
        });
      }
      if (stage < 2) appendGuideMessage(conversationId, opening, { settled: true });
      stage = 2;
    };
    window.addEventListener(REVEAL_SKIP_EVENT, onSkip);
    let at = INTRO_START_MS;
    timers.push(
      window.setTimeout(() => {
        stage = 1;
        appendGuideMessage(conversationId, HARBOR_MINI_SETUP_GREETING, {
          id: helloId,
          paced: 'greeting',
        });
      }, at),
    );
    at += inkDurationMs(HARBOR_MINI_SETUP_GREETING, GREETING_PACE) + GREETING_TO_WALK_PAUSE_MS;
    timers.push(
      window.setTimeout(() => {
        stage = 2;
        appendGuideMessage(conversationId, opening, { paced: 'walk' });
      }, at),
    );
    at += inkDurationMs(opening, WALK_PACE);
    timers.push(
      window.setTimeout(() => {
        done();
        introFinished();
      }, at),
    );
  }

  // Chats named before the smarter names (lib/chatTitle.ts, founder
  // 2026-10-01) are tidied once at launch: the setup walk's chat becomes
  // "First-time setup", and a name that is still the old 48-character cut of
  // the first message is made again. A chat the person renamed, or one the
  // engine titled, is never touched.
  function retitleChats(): void {
    const walkId = get().settings.guidedSetup?.conversationId;
    let changed = false;
    const conversations = { ...get().conversations };
    for (const [id, c] of Object.entries(conversations)) {
      if (c.renamed) continue;
      let title = c.title;
      if (id === walkId && title === HARBOR_MINI_MODEL_NAME) title = SETUP_CHAT_TITLE;
      else if (title !== 'New chat' && title === legacyTitleFrom(c.thread)) {
        title = titleFrom({ ...c.thread, title: undefined }) ?? title;
      }
      if (title !== c.title) {
        conversations[id] = { ...c, title };
        changed = true;
      }
    }
    if (!changed) return;
    set({ conversations });
    void persistConversations(get());
  }

  // A walk whose letter was cut short (the app closed mid-letter) is made
  // whole on the next launch, settled, so its chat never sits empty.
  function repairIntroLetter(): void {
    const p = get().settings.guidedSetup;
    if (!p || p.finished) return;
    const conv = get().conversations[p.conversationId];
    if (!conv) return;
    const helloId = `${p.conversationId}-hello`;
    const items = conv.thread.items;
    if (!items.some((i) => i.id === helloId)) {
      set((st) => {
        const c = st.conversations[p.conversationId];
        if (!c) return st;
        const hello = {
          kind: 'assistant' as const,
          id: helloId,
          text: HARBOR_MINI_SETUP_GREETING,
          streaming: false,
        };
        return {
          conversations: {
            ...st.conversations,
            [p.conversationId]: {
              ...c,
              thread: { ...c.thread, items: [hello, ...c.thread.items] },
            },
          },
        };
      });
    }
    if (!items.some((i) => i.id.includes('-setup-')) && p.current) {
      appendGuideMessage(p.conversationId, openingMessage(p.current, setupFacts()), {
        settled: true,
      });
    }
  }

  // Show the person's own line in the guide's chat without sending it to the
  // model: used when the walk itself answers it ("let's set up", "skip").
  function appendUserLine(conversationId: string, text: string): void {
    const id = `${conversationId}-u-${Date.now().toString(36)}${(guideSeq++).toString(36)}`;
    set((st) => {
      const c = st.conversations[conversationId];
      if (!c) return st;
      return {
        conversations: {
          ...st.conversations,
          [conversationId]: {
            ...c,
            thread: {
              ...c.thread,
              items: [...c.thread.items, { kind: 'user' as const, id, text }],
            },
          },
        },
      };
    });
    drivers.get(conversationId)?.recordLine?.({ role: 'user', text });
  }

  // "Help me get set up" (founder, 2026-10-01): the walk moves to the chat it
  // was asked in, as a list of what is not set up yet. Whatever the walk was
  // waiting on in its old chat is closed (its buttons leave with it); what
  // was skipped before is offered again, since the person asked.
  function setupMenuProgress(conversationId: string): GuidedSetupProgress {
    const p = get().settings.guidedSetup;
    return {
      ...(p ?? {}),
      conversationId,
      skipped: [],
      paused: false,
      awaiting: undefined,
      ...(p?.startChoice === 'asking' ? { startChoice: 'setup' as const } : {}),
      ...(p?.nextChoice === 'asking' ? { nextChoice: 'setup' as const } : {}),
      ...(p?.editChoice === 'asking' ? { editChoice: 'later' as const } : {}),
    };
  }

  // The walk's state once the list is posted: buttons under it while
  // anything is left, else the walk is finished.
  function setupMenuAfter(base: GuidedSetupProgress, itemId: string): GuidedSetupProgress {
    const facts = setupFacts();
    const left = menuSteps(base, facts).length > 0;
    return {
      ...base,
      current: undefined,
      awaiting: undefined,
      paused: false,
      menu: left ? 'asking' : undefined,
      menuItemId: left ? itemId : undefined,
      finished: !left,
      harborAnnounced: base.harborAnnounced || facts.harborReady,
    };
  }

  // Post the list in the walk's chat, led by what just happened when it comes
  // back after a step.
  function showSetupMenu(base: GuidedSetupProgress, back?: MenuReturn): boolean {
    const id = guideItemId(base.conversationId);
    const text = setupMenuMessage(base, setupFacts(), back);
    if (!appendGuideMessage(base.conversationId, text, { id })) return false;
    void get().saveSettings({ guidedSetup: setupMenuAfter(base, id) });
    return true;
  }

  // Choosing to just chat at the break: the guide's line inks, a short beat
  // lets it land, then Slack Water carries them to the main chat page
  // (components/SlackWater.tsx), the line still readable while the first
  // rings cross it (founder, 2026-10-02: the old three-second read pause felt
  // like a stall). Reduced motion shows the line whole and keeps the reading
  // pause, then lands there without the water. Nothing moves if they went
  // somewhere else or started chatting where they are.
  let slackSeq = 0;
  function carryToGreeting(conversationId: string, origin?: { x: number; y: number }): void {
    const reduced = prefersReducedMotion();
    const lineId = get().conversations[conversationId]?.thread.items.at(-1)?.id;
    const wait = reduced
      ? READ_PAUSE_MS
      : inkDurationMs(SETUP_LATER_LINE, WALK_PACE) + WATER_AFTER_LINE_MS;
    globalThis.setTimeout(() => {
      const s = get();
      const thread = s.conversations[conversationId]?.thread;
      if (s.view !== 'chat' || s.activeId !== conversationId) return;
      if (!thread || thread.busy || thread.items.at(-1)?.id !== lineId) return;
      if (reduced || typeof window === 'undefined') {
        s.startNewChat();
        return;
      }
      const at = origin ?? { x: window.innerWidth / 2, y: window.innerHeight - 96 };
      set({ slackWater: { seq: ++slackSeq, x: at.x, y: at.y, phase: 'rising' } });
    }, wait);
  }

  // A message typed in the walk's chat may be about the walk itself. "I just
  // want to chat" pauses it and still goes to the guide, who answers knowing
  // setup is off the table; a plain "let's set up" or "skip" is answered by
  // the walk. "Help me get set up" is answered in any chat, with the list.
  // Returns true when the message was handled here.
  function interceptSetupMessage(conversationId: string, text: string): boolean {
    if (setupHelpIntent(text)) {
      appendUserLine(conversationId, text);
      logEvent('setup_menu_asked', { via: 'chat' });
      showSetupMenu(setupMenuProgress(conversationId));
      return true;
    }
    const p = get().settings.guidedSetup;
    if (!p || p.conversationId !== conversationId) return false;
    const intent = setupIntent(text);
    if (!intent) return false;
    // The break after the opening, answered in words: "I'd rather just chat"
    // or a bare "skip" is the chat choice; "let's set up" or "next" sets up.
    if (p.startChoice === 'asking' && !p.paused) {
      appendUserLine(conversationId, text);
      get().chooseStart(intent === 'resume' || /^\s*next/i.test(text) ? 'setup' : 'chat');
      return true;
    }
    // The list is up: its buttons are the way on, and anything typed is
    // ordinary talk, except a "not now", which steps the walk back.
    if (p.menu === 'asking' && intent !== 'pause') return false;
    // The fork after Harbor, answered in words. "Not now" or "I just want to
    // chat" is the chat choice, and still goes to the guide, who answers it
    // knowing setup waits. "Let's set up", "keep setting up", or "next" carry
    // on; a bare "skip" skips the rest, which is chatting.
    if (p.nextChoice === 'asking' && !p.paused) {
      if (intent === 'pause') {
        logEvent('guided_setup_fork', { choice: 'chat', via: 'typed' });
        void get().saveSettings({
          guidedSetup: { ...p, nextChoice: 'chat', paused: true, awaiting: undefined },
        });
        return false;
      }
      const choice: NextChoice = intent === 'resume' || /^\s*next/i.test(text) ? 'setup' : 'chat';
      appendUserLine(conversationId, text);
      get().chooseNext(choice);
      return true;
    }
    const walking = walkActive(p);
    if (intent === 'pause') {
      if (walking && !p.paused) {
        logEvent('guided_setup_pause', { step: p.current ?? 'none' });
        void get().saveSettings({ guidedSetup: { ...p, paused: true, awaiting: undefined } });
      }
      return false; // the guide still answers it, now knowing
    }
    if (!walking) return false;
    if (intent === 'resume') {
      if (!p.paused) return false; // already walking: let the guide answer
      appendUserLine(conversationId, text);
      get().resumeGuidedSetup();
      return true;
    }
    if (p.paused) return false; // "next" while just chatting is ordinary talk
    appendUserLine(conversationId, text);
    if (p.editChoice === 'asking') void get().chooseEditMode(undefined);
    else get().skipSetupStep();
    return true;
  }

  // A Harbor Lite chat opens before the model is ready (beginGuidedSetup), so a
  // message typed in that window waits, visibly, as a queued line, and goes out
  // the moment Harbor Lite is ready; anything queued after it follows in order
  // when that reply ends. Returns true when the message was held here.
  const harborLiteWaiters = new Set<string>();
  function holdForHarborLite(
    conversationId: string,
    text: string,
    attachments?: Attachment[],
  ): boolean {
    const conv = get().conversations[conversationId];
    if (conv?.source.kind !== 'device' || conv.source.modelId !== HARBOR_MINI_MODEL_ID)
      return false;
    if (get().settings.harborMiniReady || (attachments && attachments.length) || !text.trim()) {
      return false;
    }
    set((st) => {
      const c = st.conversations[conversationId];
      if (!c) return st;
      return {
        conversations: {
          ...st.conversations,
          [conversationId]: { ...c, thread: { ...c.thread, queued: [...c.thread.queued, text] } },
        },
      };
    });
    // One wait and one flush per chat, however many lines were typed: the
    // first goes out when Harbor Lite is ready, the rest follow it in order
    // (attachDriver sends the next queued line each time a reply ends).
    if (!harborLiteWaiters.has(conversationId)) {
      harborLiteWaiters.add(conversationId);
      void get()
        .ensureHarborMini()
        .then((ok) => {
          harborLiteWaiters.delete(conversationId);
          if (!ok) return; // the failure shows on the download row; lines stay queued
          const c = get().conversations[conversationId];
          const [head, ...rest] = c?.thread.queued ?? [];
          if (!c || head === undefined || c.thread.busy) return;
          set((st) => {
            const cur = st.conversations[conversationId];
            if (!cur) return st;
            return {
              conversations: {
                ...st.conversations,
                [conversationId]: { ...cur, thread: { ...cur.thread, queued: rest } },
              },
            };
          });
          get().sendWhenAttached(conversationId, head);
          ensureDriver(conversationId);
        });
    }
    return true;
  }

  // Move the walk along when the world changed: a step's connection landed
  // (say so, bring the person back to the chat if they went to its page, and
  // bring up the next step), or Harbor finished downloading (say how to switch
  // to it, once). Called on every relevant state change and after each reply.
  function advanceGuidedSetup(): void {
    const s = get();
    const p = s.settings.guidedSetup;
    if (!p) return;
    const conv = s.conversations[p.conversationId];
    if (!conv || conv.thread.busy) return;
    // The edit choice and the break after the opening hold the walk until a
    // button is tapped.
    if (p.editChoice === 'asking' || p.startChoice === 'asking') return;
    const facts = setupFacts();
    // A step picked from the "help me get set up" list: when it lands, say so
    // and bring the list back with what is left (the repository asks its one
    // edit question first, and the list follows the answer).
    if (p.menu === 'step' && !p.paused && p.current && stepHandled(p.current, facts)) {
      const done = p.current;
      const editAsk = done === 'repo' && !p.editChoice;
      const back = p.awaiting === done && (s.view !== 'chat' || s.activeId !== p.conversationId);
      if (editAsk) {
        if (!appendGuideMessage(p.conversationId, repoConnectedMessage())) return;
        void get().saveSettings({
          guidedSetup: { ...p, current: undefined, awaiting: undefined, editChoice: 'asking' },
        });
      } else if (!showSetupMenu(p, { step: done, how: 'done' })) {
        return;
      }
      logEvent('guided_setup_step_done', { step: done, via: 'menu' });
      if (back) s.openConversation(p.conversationId);
      return;
    }
    let next: GuidedSetupProgress = p;
    // The fork after Harbor holds the steps too; only Harbor's ready line
    // still lands while it waits (below).
    const forkOpen = p.nextChoice === 'asking';
    if (!forkOpen && !p.finished && !p.paused && p.current && stepHandled(p.current, facts)) {
      const done = p.current;
      const after = nextStep(p, facts);
      // The repository step ends on one choice (how edits are handled), asked
      // once; the next step waits for the tap (chooseEditMode).
      const asking = done === 'repo' && !p.editChoice;
      // Harbor's step ends on the fork (chat, or keep setting up) whenever
      // setup is still ahead; the next step waits for the tap (chooseNext).
      const fork = done === 'harbor' && !p.nextChoice && stepsAhead(p, facts).length > 0;
      const text = asking
        ? repoConnectedMessage()
        : fork
          ? harborForkMessage('done', p, facts)
          : advanceMessage(done, 'done', after, facts);
      if (!appendGuideMessage(p.conversationId, text)) return;
      logEvent('guided_setup_step_done', { step: done });
      next = {
        ...next,
        current: after,
        finished: !after,
        awaiting: undefined,
        harborAnnounced: next.harborAnnounced || facts.harborReady,
        ...(asking ? { editChoice: 'asking' as const } : {}),
        ...(fork ? { nextChoice: 'asking' as const, finished: false } : {}),
      };
      if (p.awaiting === done && (s.view !== 'chat' || s.activeId !== p.conversationId)) {
        s.openConversation(p.conversationId);
      }
    } else if (facts.harborReady && !p.harborAnnounced) {
      if (!appendGuideMessage(p.conversationId, HARBOR_READY_MESSAGE)) return;
      next = { ...next, harborAnnounced: true };
    }
    if (next !== p) void get().saveSettings({ guidedSetup: next });
  }

  // The walk moves on the moment a step's connection lands or Harbor
  // finishes, wherever in the app that happened.
  api.subscribe((st, prev) => {
    if (!st.settings.guidedSetup) return;
    if (
      st.settings.daemon !== prev.settings.daemon ||
      st.settings.harborReady !== prev.settings.harborReady ||
      st.settings.repo?.homeRepo !== prev.settings.repo?.homeRepo ||
      st.harborDownload !== prev.harborDownload ||
      st.connectedRepoPlatforms !== prev.connectedRepoPlatforms ||
      st.cloudKeyPresent !== prev.cloudKeyPresent ||
      st.connectedProviders !== prev.connectedProviders
    ) {
      advanceGuidedSetup();
    }
  });

  // A desktop session on a daemon this phone registered with pushes its own
  // completion and approval banners (lib/push.ts), so the local notice stands
  // down for it rather than doubling up.
  function daemonPushes(conversationId: string): boolean {
    const s = get();
    const conv = s.conversations[conversationId];
    const daemon = s.settings.daemon;
    return (
      conv?.source.kind === 'desktop' &&
      Boolean(daemon && (s.settings.pushRegisteredDaemons ?? []).includes(daemon.baseUrl))
    );
  }

  // A tapped notice opens the thing it is about: the chat, the guide, the
  // Stack. A desktop completion push carries the daemon's session id, which
  // maps back to the chat that runs it.
  function openNoticeTap(data: { route?: string; sessionId?: string }): void {
    const route = decodeTap(data);
    if (!route) return;
    const s = get();
    if (route.to === 'chat') {
      if (s.conversations[route.conversationId]) s.openConversation(route.conversationId);
    } else if (route.to === 'guide') {
      void s.startGuide(route.modelId);
    } else if (route.to === 'view') {
      s.setView(route.view);
    } else {
      const hit = Object.entries(s.conversations).find(
        ([, c]) => c.source.kind === 'desktop' && c.source.sessionId === route.sessionId,
      );
      if (hit) s.openConversation(hit[0]);
    }
  }

  // A freshly downloaded guide becomes the Reasoning anchor in every status
  // where reasoningPromotion says so (none set, a guide not on the device, or
  // Harbor Lite when Harbor is the preferred pick), so the model the person
  // just downloaded answers docked, offshore and offline alike. A model the
  // person placed in Stack is never touched.
  async function promoteGuide(
    ref: StackModelRef,
    opts: { harborReady?: boolean; harborMiniReady?: boolean; preferred: boolean },
  ): Promise<void> {
    for (const profile of PROFILE_ORDER) {
      const st = get().settings;
      const target = reasoningPromotion(stackForProfile(st.stacks, profile), ref, {
        harborReady: opts.harborReady ?? Boolean(st.harborReady),
        harborMiniReady: opts.harborMiniReady ?? Boolean(st.harborMiniReady),
        preferred: opts.preferred,
      });
      if (target) await get().setReasoning(target, profile);
    }
  }

  // Load Harbor into the phone's one model slot as the last step of its
  // download. Skipped while any chat is writing a reply, since a load ends a
  // reply in flight (UI-1); that chat's next send warms Harbor as before. A
  // load that fails here is not a failed download: the first send reloads and
  // says plainly what went wrong.
  async function warmHarbor(): Promise<void> {
    if (Object.values(get().conversations).some((c) => c.thread.busy)) return;
    const warm = await ensureDeviceModel({
      id: HARBOR_MODEL_ID,
      name: HARBOR_MODEL_NAME,
      contextSize: DEVICE_CONTEXT_TOKENS,
    }).catch(() => ({ ok: false }) as const);
    logEvent(warm.ok ? 'harbor_warm' : 'harbor_warm_failed');
  }

  // Web search asks once (founder, 2026-10-02; What leaves this device). A
  // yes is remembered on this device; a "not now" holds until the next launch,
  // so a chat never asks twice in a row. Concurrent searches share one
  // question.
  let webSearchDeclinedThisRun = false;
  let webSearchPending: Promise<boolean> | undefined;
  // One sheet on screen at a time (state/webSearchAskOps.ts).
  const webSearchSheets = new WebSearchSheets((sheet) => set({ webSearchAsk: sheet }));
  function askWebSearch(
    query: string,
    ask?: { afterPrivate: true; card: { summary: string; detail: string } },
  ): Promise<boolean> {
    // After a private read (H): every search asks, whatever was allowed
    // before, on a card with the exact words; nothing is remembered.
    const shortcut = searchAskShortcut(
      get().settings.webSearchConsent,
      webSearchDeclinedThisRun,
      ask?.afterPrivate === true,
    );
    if (shortcut !== undefined) return Promise.resolve(shortcut);
    if (ask?.afterPrivate) return webSearchSheets.open({ query, private: ask.card });
    if (webSearchPending) return webSearchPending;
    webSearchPending = webSearchSheets.open({ query });
    return webSearchPending;
  }
  function webSearchAllowedNow(): SearchAllowed {
    const consent = get().settings.webSearchConsent;
    if (consent === 'allowed') return 'allowed';
    return consent === 'declined' || webSearchDeclinedThisRun ? 'declined' : 'unknown';
  }

  // Register this device for completion push with the connected daemon, once per
  // daemon. iOS-only and best-effort (see registerPushForDaemon); a failure just
  // means no push until the next desktop session opens.
  async function ensureDesktopPush(): Promise<void> {
    const s = get();
    const daemon = s.settings.daemon;
    const session = s.authSession;
    if (!isPhone() || !daemon || !session) return;
    if ((s.settings.pushRegisteredDaemons ?? []).includes(daemon.baseUrl)) return;
    const ok = await registerPushForDaemon(daemon, session, s.settings.deviceId);
    if (!ok) return;
    const existing = get().settings.pushRegisteredDaemons ?? [];
    if (!existing.includes(daemon.baseUrl)) {
      await get().saveSettings({ pushRegisteredDaemons: [...existing, daemon.baseUrl] });
    }
  }

  /**
   * The one place a conversation brain is built, and therefore the one place
   * the ethics layer has to be attached. Every driver leaves here wrapped in
   * guardDriver, so no chat surface in the app can reach a model without
   * screening on the way in and on the way out. See drivers/guardedDriver.ts.
   */
  async function buildDriver(
    conv: Conversation,
    seed?: SeedTurn[],
    extra?: BuildExtra,
  ): Promise<ChatDriver> {
    // The account door, before anything opens or resumes a session on the
    // engine: every build passes here, so no path reaches it signed out.
    if (codingLockedNow(conv)) throw new CodingLockedError();
    return guardDriver(await buildUnguardedDriver(conv, seed, extra));
  }

  /** The project's standing instructions and the chat's repo context, as one
   *  system-prompt block. Every driver gets the same one (B6), so a project's
   *  brief reaches the pocket model and a cloud key as surely as the engine. */
  function standingContext(conv: Conversation): string | undefined {
    const project = conv.projectId
      ? get().settings.projects?.find((p) => p.id === conv.projectId)
      : undefined;
    return (
      [project?.instructions?.trim(), repoContextLine(conv.repoIds ?? [])]
        .filter(Boolean)
        .join('\n\n') || undefined
    );
  }

  /** standingContext plus, in the guided setup's own chat, where the walk
   *  stands, read fresh on every reply (the step moves while the chat is open).
   *  For every brain but Harbor Lite, which reads the walk inside its own
   *  prompt (and the Stack, which reads it per seat). */
  function chatContext(conv: Conversation): () => string | undefined {
    // Read the conversation fresh each reply too: repositories picked in a
    // live chat reach the model on its next turn, not only after a relaunch.
    return () =>
      [standingContext(get().conversations[conv.id] ?? conv), guidedSetupLine(conv.id)]
        .filter(Boolean)
        .join('\n\n') || undefined;
  }

  // ---- The vault in a chat (Vault M5, CTO J1 to J10) -----------------------

  /** One pack per conversation (J1), so a switch keeps its render cache and a
   *  handoff is read on the conversation's first send only. */
  const vaultPacks = new Map<string, AppVaultPack>();
  /** Personal indexes a chat opened, reconciled once each so a chat that
   *  never visits the Vault room still finds its notes. */
  const packReconciled = new WeakSet<VaultIndexHost>();

  /** Forget every chat's vault context: packs, cached Current State, and the
   *  privacy answer (a sign-out, a pairing change). */
  function forgetVaultContext(): void {
    vaultPacks.clear();
    clearCurrentStateCache();
    privacyCache = undefined;
  }

  /** What `packSeatFor` reads besides the ref: this device's own tailnet
   *  (from the paired hub) and the windows the app knows (J2, J4). */
  function seatContext(): PackSeatContext {
    const s = get().settings;
    return {
      ownTailnetSuffix: hubTailnetSuffix(s.daemon?.baseUrl),
      cloudContextTokens: (provider, model) =>
        providerInfo(provider)?.models.find((m) => m.id === model)?.contextTokens,
      byomContextTokens: (id) => s.byomModels?.find((b) => b.id === id)?.contextTokens,
      byomForwardsToCloud: (id) => s.byomModels?.find((b) => b.id === id)?.forwardsToCloud,
    };
  }

  /** The personal vault's index for a chat's pack and tools, opened through
   *  `vaultIndexFor` when none is warm. Never the team vault's (D15): while
   *  the team index is on screen, a chat gets none, and it never switches one. */
  function packIndex(): VaultIndexHost | undefined {
    const t = personalVault();
    if (!t) return undefined;
    const now = currentVaultIndex();
    if (now && now.target.providerId === 'org') return undefined;
    const want = indexTargetOf(t);
    const same = (h: VaultIndexHost | undefined) =>
      Boolean(
        h &&
        h.target.providerId === want.providerId &&
        h.target.resourceId === want.resourceId &&
        (h.target.owner ?? '') === (want.owner ?? ''),
      );
    let host = warmVaultIndex();
    if (!same(host) && !now) {
      try {
        host = openVaultIndex(t);
      } catch {
        return undefined;
      }
    }
    if (!host || !same(host)) return undefined;
    if (!packReconciled.has(host)) {
      packReconciled.add(host);
      const opened = host;
      void listVaultNotes(t)
        .then((files) => opened.reconcile(files))
        .catch(() => {});
    }
    return host;
  }

  /** A note body from the personal vault, whatever scope is on screen. */
  async function personalRead(path: string): Promise<StoredFile | undefined> {
    const t = personalVault();
    return t ? t.provider.read(t.resourceId, path) : undefined;
  }

  /** This project's Current State from its repo (J1): the working tree on a
   *  desktop with the clone, else the primary GitHub repo. */
  async function projectCurrentState(
    projectId: string | undefined,
  ): Promise<{ path: string; text: string } | undefined> {
    const project = projectId
      ? get().settings.projects?.find((p) => p.id === projectId)
      : undefined;
    if (!project?.name.trim()) return undefined;
    const b = isDesktop() ? bridge() : undefined;
    const source = primaryRepoSource(project.repoIds ?? [], { canReadLocal: Boolean(b) });
    if (!source) return undefined;
    let reader: RepoReader | undefined;
    if (source.kind === 'local') {
      reader = b ? localRepoReader(source.root, b) : undefined;
    } else {
      const token = await repoToken('github').catch(() => undefined);
      reader = token ? githubRepoReader(source.owner, source.repo, token) : undefined;
    }
    if (!reader) return undefined;
    const path = memoryFilePath(sanitizeFolderSegment(project.name), CURRENT_STATE_FILE);
    const text = await reader.readFile(path);
    return text === undefined ? undefined : { path, text };
  }

  /** Whether a chat carries the vault at all: the Memory switch (Wayfinding)
   *  off means no vault in context, no pack and no vault tools. */
  function vaultInChats(): boolean {
    return memoryOverride(get().settings) !== false;
  }

  /** This conversation's pack (J1), or none with Memory off or
   *  `settings.vaultContext === 'off'`. */
  function conversationPack(conv: Conversation): AppVaultPack | undefined {
    const settings = get().settings;
    if (!vaultInChats() || settings.vaultContext === 'off') return undefined;
    const kept = vaultPacks.get(conv.id);
    if (kept) return kept;
    // A handoff opens a conversation's first send only (J13), at most seven
    // days old; a chat that already spoke has its own history. Read from the
    // device store now, while the driver builds (synchronously, so a reopened
    // chat is never parked on it); the first send finds it there.
    let handoff: string | undefined;
    // The device's Handoff switch (Vault M7, CTO L13): off asks for none.
    if (
      conv.projectId &&
      spokenTurns(conv.thread.items) === 0 &&
      appHandoffOn(settings, vaultInChats())
    ) {
      void get()
        .projectHandoff(conv.projectId)
        .then((h) => {
          handoff = h?.text;
        })
        .catch(() => {});
    }
    const projectId = conv.projectId;
    const pack = createAppVaultPack({
      setting: settings.vaultContext ?? 'auto',
      ...(projectId ? { projectKey: projectId } : {}),
      index: packIndex,
      read: async (path) => (await personalRead(path))?.text,
      privacy: vaultPrivacyNow,
      currentState: () => projectCurrentState(projectId),
      projectPins: () =>
        (projectId
          ? get().settings.projects?.find((p) => p.id === projectId)?.vaultPins
          : undefined) ?? [],
      handoff: () => handoff,
      // Room for notes and the Handoff switch (Vault M7, CTO L13), read at
      // each send; the vault's own settings name what retrieval skips.
      packSize: () => appPackSize(get().settings),
      handoffSetting: () => get().settings.vaultHandoff,
      settings: personalSettings,
    });
    vaultPacks.set(conv.id, pack);
    return pack;
  }

  /** The personal vault as the Stack's tools see it (J10), or none with
   *  Memory off. Reads are kept for a moment, so a search that judges each
   *  hit and the read that follows it cost one trip. */
  function stackVaultTools(): StackVaultTools | undefined {
    if (!vaultInChats()) return undefined;
    const reads = new Map<string, { at: number; file: Promise<StoredFile | undefined> }>();
    const read = (path: string): Promise<StoredFile | undefined> => {
      const hit = reads.get(path);
      if (hit && Date.now() - hit.at < 30_000) return hit.file;
      const file = personalRead(path);
      reads.set(path, { at: Date.now(), file });
      file.catch(() => reads.delete(path));
      return file;
    };
    return {
      privacy: vaultPrivacyNow,
      async search(query) {
        const host = packIndex();
        if (!host) return [];
        const hits = await host.search(query, 16);
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        return Promise.all(
          hits.map(async (h) => {
            const text = (await read(h.path).catch(() => undefined))?.text ?? '';
            const lower = text.toLowerCase();
            const at = words.map((w) => lower.indexOf(w)).find((i) => i >= 0) ?? 0;
            return { path: h.path, snippet: text ? excerptAt(text, at).text : '' };
          }),
        );
      },
      async read(path) {
        const file = await read(path);
        return file ? { text: file.text, version: versionOf(file) } : undefined;
      },
      async resolve(name) {
        const host = packIndex();
        return host ? resolveWikilink(name, host.index.paths()) : undefined;
      },
      async write(path, text, guard) {
        const t = personalVault();
        if (!t) throw new Error('Your Vault is not ready on this device yet.');
        const readOnly = vaultReadOnlyReason(t.providerId);
        if (readOnly) throw new Error(readOnly);
        reads.delete(path);
        const r = await putVaultNote(t, path, text, guard);
        if (r.ok) packIndex()?.applyWrite(r.file);
        return r;
      },
      teamVault: () => get().vaultScope === 'team',
      // The vault's agent folder (Vault M7, CTO L2), at the offer and again
      // at approve.
      agentFolder: () => personalSettings()?.agent.folder,
      onWritten: (paths) => {
        void (async () => {
          for (const p of paths) await get().noteAgentVaultWrite(p);
        })();
      },
    };
  }

  async function buildUnguardedDriver(
    conv: Conversation,
    seed?: SeedTurn[],
    extra?: BuildExtra,
  ): Promise<ChatDriver> {
    const { settings } = get();
    switch (conv.source.kind) {
      case 'desktop': {
        // The project's standing instructions ride into the session's system
        // prompt (with any OSCODE.md the engine reads itself), and the composer's
        // mode is the session's starting mode, both the way Claude Code starts.
        const project = conv.projectId
          ? settings.projects?.find((p) => p.id === conv.projectId)
          : undefined;
        // The chat's repositories ride in as context, and the first workspace
        // among them is where the session works when the source names no cwd.
        const repoLine = repoContextLine(conv.repoIds ?? []);
        const instructions =
          [project?.instructions?.trim(), repoLine].filter(Boolean).join('\n\n') || undefined;
        // The project's tokens and secrets, when the person has turned the
        // feature on, so a local model can use them. Read from the sealed
        // device-local store here and handed to the in-process desktop engine
        // (which drops them for a cloud orchestrator). The remote-daemon path
        // below deliberately does NOT forward them (it builds its own opts), so
        // secrets meant for this device never travel to another machine.
        let projectSecrets: string | undefined;
        if (settings.storeSecrets && project) {
          const stored = await readProjectSecrets(project.id);
          if (stored.trim()) projectSecrets = stored;
        }
        // Codemagic Access on: hand this device's Codemagic token and the saved
        // launch target to the in-process local engine, so its codemagic tool
        // can drive App Launch builds. Read from the sealed device-local store
        // here. Like projectSecrets, this rides sessionOpts, which the remote
        // daemon path below deliberately does NOT forward, so the token stays on
        // this device and only ever runs on this device.
        let codemagicToken: string | undefined;
        let codemagicTarget:
          { appId: string; workflowId: string; branch: string; platform?: string } | undefined;
        // Launch is v2 (docs/release-tiers.md): an earlier build never hands
        // the token to a session, whatever a setting left from before says.
        if (settings.codemagicAccess && featureOn('launch')) {
          const tok = await secretGet(CODEMAGIC_SECRET_KEY);
          if (tok) {
            codemagicToken = tok;
            const t = settings.launch?.target;
            if (t) {
              codemagicTarget = {
                appId: t.appId,
                workflowId: t.workflowId,
                branch: t.branch,
                platform: t.platform,
              };
            }
          }
        }
        // The currents ride from THIS conversation's project (per-project
        // selection), with the device-local connection and its key. Unlike the
        // Codemagic token they ride to a remote hub too: a current names a box
        // or a service the person chose to reach FROM the hub, and the key is
        // that service's own key, not a secret bound to this device.
        // Currents are v2: an earlier build sends no current to any session,
        // whatever a project saved in a build that had them.
        const currentsOn = featureOn('currents');
        const currents = currentsOn
          ? currentsHandles(
              projectCurrentsSettings(project, settings.currentConnections),
              (await currentSecretFor(project?.agenticCurrent ?? null)) ?? undefined,
              get().currentsHost,
            )
          : undefined;
        const harnessId = currentsOn ? (project?.harnessCurrent ?? null) : null;
        const harnessCurrents = harnessId
          ? harnessCurrentsHandle(
              projectHarnessSettings(project, settings.harnessCurrentConnections),
              (await secretGet(harnessCurrentSecretKey(harnessId)).catch(() => null)) ?? undefined,
            )
          : undefined;
        const sessionOpts = {
          instructions,
          permissionMode: settings.permissionMode ?? DEFAULT_PERMISSION_MODE,
          // The project's name places its memory notes under
          // "OpenShore Project <name> MDs/" in the repo, so the agent writes the
          // Current State top sheet and the rest to a folder named for the project.
          projectName: project?.name,
          projectSecrets,
          // Humanize Writing setting rides to the engine so a paired desktop
          // honors the toggle too (it only ever turns the humanizer off; a
          // project's own config still wins). Undefined means on.
          humanize: settings.humanizeWriting !== false,
          // Chain of Thought rides to the engine the same way, for this
          // session: on asks its models to think and streams the thinking,
          // off asks them not to. Off by default.
          chainOfThought: settings.chainOfThought === true,
          // The Wayfinding Memory switch, as an override that can only turn
          // project memory off (false) and is absent otherwise, so a
          // project's own config stays in charge while it is on.
          ...(memoryOverride(settings) === false ? { memory: false } : {}),
          // Web search asks once on this device (the search words go to a
          // search service): until the person allows it, the engine session
          // has no webSearch tool.
          ...(webSearchOn(settings.webSearchConsent) ? {} : { webSearch: false }),
          codemagicToken,
          codemagicTarget,
          currents,
          harnessCurrents,
          // A chat carried to the computer's agent (Vault M5, CTO J12): the
          // handoff opens its first task, since the agent takes no history.
          // Conversation content, so it rides even with Memory off.
          ...(extra?.handoff ? { handoff: capHandoffBytes(extra.handoff) } : {}),
          // The project's own pinned notes (J14), read first by the engine's
          // pack. The vault's, so they stay home with Memory off.
          ...(project?.vaultPins?.length && memoryOverride(settings) !== false
            ? { vaultPins: [...project.vaultPins] }
            : {}),
          // Notes in chats, Handoff and Room for notes (Vault M7, CTO L13):
          // off-only and lower-only, taken at open, so a change applies to
          // new chats.
          ...(Object.keys(appVaultOverrides(settings)).length
            ? { vaultOverrides: appVaultOverrides(settings) }
            : {}),
        };
        const cwd = conv.source.cwd ?? firstWorkspace(conv.repoIds ?? []);
        // A desktop is its own engine, unless the person has pointed it at a
        // remote hub (a laptop that is not the central computer): then it runs
        // sessions on that hub over the tailnet, the way the phone does, and
        // falls through to the daemon path below.
        if (isDesktop() && bridge() && !settings.preferRemoteHub) {
          let sessionId = conv.source.sessionId;
          let journal: Array<{ seq: number; event: DriverEvent }> | undefined;
          if (!sessionId) {
            let created: { id: string };
            try {
              created = await bridge()!.createSession(cwd, sessionOpts);
            } catch (err) {
              // The engine's own wording is a CLI instruction ("run osc init").
              // In the app the fix is a screen away, so say that instead.
              const msg = err instanceof Error ? err.message : String(err);
              throw new Error(
                /orchestrator/i.test(msg)
                  ? 'No model is set up on this computer yet. Open Stack and pick one.'
                  : msg,
              );
            }
            sessionId = created.id;
            await bindSessionId(conv.id, sessionId, cwd);
          } else {
            // G1: resume returns the journal so the driver can replay it AFTER
            // it has subscribed (IPC does not buffer a pushed replay).
            const resumed = await bridge()!.resumeSession(sessionId);
            if ('journal' in resumed) journal = resumed.journal;
          }
          return new ElectronDriver(sessionId, journal);
        }
        if (!settings.daemon) {
          throw new Error('Connect to your computer first (Menu, then Computer).');
        }
        let sessionId = conv.source.sessionId;
        if (!sessionId) {
          // Never hand secrets to a remote daemon: this is a phone driving
          // another machine, so the secrets (which are for THIS device's local
          // model) must not travel. Pass an explicit opts object without
          // projectSecrets, so a future change to the daemon client cannot leak
          // them even by accident.
          sessionId = await daemonCreateSession(settings.daemon, cwd, {
            instructions: sessionOpts.instructions,
            // The project's name too, so the hub files project memory in the
            // same folder a desktop-created session does.
            projectName: sessionOpts.projectName,
            permissionMode: sessionOpts.permissionMode,
            humanize: sessionOpts.humanize,
            chainOfThought: sessionOpts.chainOfThought,
            ...(sessionOpts.webSearch === false ? { webSearch: false } : {}),
            memory: sessionOpts.memory,
            currents: sessionOpts.currents,
            harnessCurrents: sessionOpts.harnessCurrents,
            // A switch's handoff (J12) and the project's pins (J14), both
            // capped by the client before they go on the wire.
            handoff: sessionOpts.handoff,
            vaultPins: sessionOpts.vaultPins,
            ...(sessionOpts.vaultOverrides ? { vaultOverrides: sessionOpts.vaultOverrides } : {}),
          });
          await bindSessionId(conv.id, sessionId, cwd);
        }
        // Opening a desktop session is the walk-away-able moment: the run
        // continues on the daemon while the phone is closed. Register for
        // completion push now (contextual, not at launch), once per daemon.
        void ensureDesktopPush();
        // Refresh what this hub says the credential may do, so the composer's
        // terminal affordance tracks the role the hub enforces (P0-1).
        void refreshHubRole(settings.daemon);
        // Replay from zero so the transcript rebuilds exactly. The link
        // callback feeds the chat banner (B4).
        const hubUrl = settings.daemon.baseUrl;
        return new RemoteDriver(sessionId, settings.daemon, 0, {
          onLink: (state) => noteHubLink(hubUrl, state),
        });
      }
      case 'desktop-chat': {
        // Free, read-only chat with the computer's local models. No session is
        // created, so this can never become the paid agent. On the desktop
        // itself it reaches this computer's own engine over IPC (CTO ruling
        // 8): no tools, no session, and no vault pack.
        if (isDesktop() && bridge() && !settings.preferRemoteHub) {
          return new DesktopChatDriver(
            ipcFreeChat(bridge()!, get().desktopStatus?.stack.orchestrator?.model),
            conv.source.model,
            seed,
            chatContext(conv),
            settings.perplexityResearch === true,
          );
        }
        // On the phone, the paired desktop's daemon and its stateless /chat.
        if (!settings.daemon) {
          throw new Error('Connect to your computer first (Menu, then Computer).');
        }
        // The computer builds this chat's pack itself (J6): the phone names
        // the project and never ships note bodies there and back. Memory off
        // says so; the pack setting off sends neither, so none is built.
        const chatProject = conv.projectId
          ? settings.projects?.find((p) => p.id === conv.projectId)
          : undefined;
        const chatCwd = firstWorkspace(
          (conv.repoIds?.length ? conv.repoIds : chatProject?.repoIds) ?? [],
        );
        return new DesktopChatDriver(
          settings.daemon,
          conv.source.model,
          seed,
          chatContext(conv),
          settings.perplexityResearch === true,
          !vaultInChats()
            ? { memory: false }
            : settings.vaultContext === 'off'
              ? {}
              : {
                  vaultPack: {
                    ...(chatCwd ? { cwd: chatCwd } : {}),
                    ...(chatProject?.name ? { projectName: chatProject.name } : {}),
                    // Room for notes (L13): the computer lowers-only.
                    ...(settings.vaultPackSize ? { packSize: settings.vaultPackSize } : {}),
                  },
                },
        );
      }
      case 'device': {
        const vaultPack = conversationPack(conv);
        return new OnDeviceDriver(
          conv.source.modelId,
          conv.source.modelName,
          seed,
          settings.perplexityResearch === true,
          standingContext(conv),
          conv.id,
          { vaultPack, writingVoice: settings.writingVoice },
        );
      }
      case 'cloud': {
        // Claude runs on the Anthropic SDK; every other connected provider runs
        // on the shared OpenAI-compatible chat driver, so a user can chat with
        // any model their provider offers, not only Claude. Held in a const so
        // the narrowing survives the awaits below.
        const source = conv.source;
        if (source.provider === 'anthropic') {
          const key = await secretGet(ANTHROPIC_KEY_KEY);
          if (!key) throw new Error('Add your Claude API key under Cloud Connections first.');
          return new CloudClaudeDriver(
            key,
            source.model,
            seed,
            settings.anthropicWorkspaceId,
            chatContext(conv),
            {
              vaultPack: conversationPack(conv),
              humanize: settings.humanizeWriting !== false,
              writingVoice: settings.writingVoice,
              modelLabel: claudeModelLabel(source.model),
            },
          );
        }
        const info = providerInfo(source.provider);
        if (!info?.openaiBaseUrl) {
          throw new Error(`No endpoint configured for ${source.provider}.`);
        }
        const key = await secretGet(providerSecretKey(source.provider));
        if (!key) throw new Error(`Connect ${info.name} under Cloud Connections first.`);
        const contextWindow = info.models.find((m) => m.id === source.model)?.contextTokens;
        return new CloudOpenAiDriver(
          info.openaiBaseUrl,
          key,
          source.model,
          info.name,
          seed,
          chatContext(conv),
          contextWindow,
          {
            vaultPack: conversationPack(conv),
            humanize: settings.humanizeWriting !== false,
            writingVoice: settings.writingVoice,
            modelLabel: providerModelLabel(source.provider, source.model),
          },
        );
      }
      case 'stack': {
        const s = get();
        const profile = effectiveProfile(autoProfile(s.connectivity), s.settings.profileOverride);
        const project = conv.projectId
          ? s.settings.projects?.find((p) => p.id === conv.projectId)
          : undefined;
        // Crew that applies to this chat: scoped to the project (or all
        // projects), and only the levels that speak inside a chat. "review"
        // agents fire at deploy time, not here.
        const crew = (s.settings.crew ?? []).filter(
          (a) =>
            a.activityLevel !== 'review' &&
            (a.projectIds.length === 0 ||
              (conv.projectId != null && a.projectIds.includes(conv.projectId))),
        );
        // The Harness Current (Jev) for THIS conversation's project, with its
        // resolved key, so the stack can let it steer a paid-seat turn. Absent
        // leaves routing exactly as it was.
        const harnessId = featureOn('currents') ? (project?.harnessCurrent ?? null) : null;
        const harnessCurrents = harnessId
          ? harnessCurrentsHandle(
              projectHarnessSettings(project, s.settings.harnessCurrentConnections),
              (await secretGet(harnessCurrentSecretKey(harnessId)).catch(() => null)) ?? undefined,
            )
          : undefined;
        return new StackDriver(
          stackForTier(stackForProfile(s.settings.stacks, profile)),
          profile,
          {
            projectName: project?.name,
            harnessCurrents,
            projectInstructions:
              [project?.instructions?.trim(), repoContextLine(conv.repoIds ?? [])]
                .filter(Boolean)
                .join('\n\n') || undefined,
            crew,
            humanize: s.settings.humanizeWriting !== false,
            writingVoice: s.settings.writingVoice,
            // A play's engine step opens its own session on the paired
            // computer; the Memory switch rides there the same way.
            memory: memoryOverride(s.settings),
            // So do Notes in chats, Handoff and Room for notes (CTO L13):
            // off-only and lower-only, the same object a chat's session takes.
            vaultOverrides: appVaultOverrides(s.settings),
            researchOn: s.settings.perplexityResearch === true,
            // Codemagic Access on and connected: offer the codemagic tool so the
            // model can drive App Launch builds on the phone (Anthropic path).
            codemagicAccess:
              featureOn('launch') && s.settings.codemagicAccess === true && s.codemagicConnected,
            // Docked to a computer with a local workspace connected to this chat:
            // a play's repo/tool step runs on the engine there. Absent (not
            // docked, or a GitHub-only / repo-less chat) means such a step is
            // described instead of executed.
            daemon: s.settings.daemon,
            repoCwd: firstWorkspace(conv.repoIds ?? []),
            conversationId: conv.id,
            // Prompt caching on Claude, off by default (J16, J19).
            promptCache: s.settings.promptCache === true,
          },
          seed,
          {
            vaultPack: conversationPack(conv),
            // The seat a ref answers as (J2, J4): by address, never by label.
            packSeat: (ref) => packSeatFor(ref, seatContext()),
            vaultTools: stackVaultTools(),
          },
        );
      }
      case 'mock':
        return new MockDriver();
    }
  }

  // Where a magic-link sign-in returns to. Each shell has its own origin the
  // token must land on (auth callbacks stay on the app's own origin).
  function authRedirectTo(): string {
    switch (platform()) {
      case 'ios':
        return 'oscode://auth-callback';
      case 'electron':
        // Desktop registers the oscode:// scheme (see electron/main.ts), so the
        // callback returns straight into the app the same way iOS does. The old
        // fixed-port loopback (127.0.0.1:4817) had no listener and dead-ended.
        return 'oscode://auth-callback';
      default:
        return typeof window !== 'undefined'
          ? `${window.location.origin}/auth-callback`
          : 'http://localhost/auth-callback';
    }
  }

  // Push a locally-created commercial org to the server (owner just signed in),
  // returning the org rebuilt from the server rows, or undefined if it could not
  // be created (RLS, offline).
  async function pushOrgToServer(session: Session, org: Org): Promise<Org | undefined> {
    const [srv] = await supabaseInsert<ServerOrg>('orgs', session.accessToken, {
      name: org.name,
      owner_uid: session.user.id,
      seat_count: org.seatCount,
      tier_id: org.tierId,
      price_year: org.priceYear,
    });
    if (!srv) return undefined;
    const rows = memberRowsForPush(org, srv.id, session);
    // Guarantee the signed-in owner an active admin seat, even if they set the
    // org up without listing their own email, so other devices can pull it.
    if (session.user.email && !rows.some((r) => r.user_id === session.user.id)) {
      rows.unshift({
        org_id: srv.id,
        email: session.user.email,
        role: 'admin',
        user_id: session.user.id,
        status: 'active',
        invited_by: session.user.id,
      });
    }
    const saved = rows.length
      ? await supabaseInsert<ServerMember>('org_members', session.accessToken, rows)
      : [];
    return serverToLocalOrg(srv, saved, new Date().toISOString());
  }

  // Rebuild the local org from the server for the signed-in user (any device):
  // find their active membership, then read the org and its roster. The pick
  // is deterministic (BE-1): memberships come back in creation order, and the
  // org this device already references wins over an older one, so a second
  // membership can never silently swap the account underneath the person.
  async function pullOrgFromServer(
    session: Session,
  ): Promise<{ org: Org; ownerUid: string } | undefined> {
    const mine = await supabaseSelect<{ org_id: string }>(
      'org_members',
      session.accessToken,
      `select=org_id,created_at&user_id=eq.${session.user.id}&status=eq.active&order=created_at.asc`,
    );
    const preferred = get().settings.account?.org?.serverId;
    const orgId = mine.find((m) => m.org_id === preferred)?.org_id ?? mine[0]?.org_id;
    if (!orgId) return undefined;
    const [srv] = await supabaseSelect<ServerOrg>(
      'orgs',
      session.accessToken,
      `select=*&id=eq.${orgId}`,
    );
    if (!srv) return undefined;
    const members = await supabaseSelect<ServerMember>(
      'org_members',
      session.accessToken,
      `select=*&org_id=eq.${orgId}&order=created_at.asc`,
    );
    return {
      org: serverToLocalOrg(srv, members, new Date().toISOString()),
      ownerUid: srv.owner_uid,
    };
  }

  /** Make a server org this device's account. */
  async function adoptOrg(org: Org, selfEmail: string | undefined): Promise<void> {
    await get().saveSettings({ account: { type: 'commercial', org, selfEmail } });
  }

  // Make the org multi-device: an owner who set it up locally pushes it on first
  // sign-in; everyone else (second device, or an invited member) pulls the
  // server's copy so the roster and role match everywhere. An org the person
  // owns, or one this device already references, is adopted outright; an org
  // someone else added them to waits for a yes on the join sheet (BE-1), so a
  // server row can never silently point this device's team vault and projects
  // at another org.
  async function reconcileOrg(): Promise<void> {
    const session = await freshAuth();
    if (!session) return;
    const account = get().settings.account;
    try {
      // The only holder of an unsynced local commercial org is the owner who
      // created it, so push it. (If they typed their own email, it must match
      // the signed-in identity; if they left it blank, we bind them here.)
      const ownsUnpushed =
        account?.type === 'commercial' &&
        account.org &&
        !account.org.serverId &&
        (!account.selfEmail ||
          account.selfEmail.toLowerCase() === (session.user.email ?? '').toLowerCase());
      if (ownsUnpushed && account?.org) {
        const pushed = await pushOrgToServer(session, account.org);
        if (pushed) {
          await get().saveSettings({ account: { ...account, org: pushed } });
          return;
        }
      }
      const pulled = await pullOrgFromServer(session);
      if (!pulled) return;
      const { org, ownerUid } = pulled;
      const mine = ownerUid === session.user.id || account?.org?.serverId === org.serverId;
      if (mine) {
        await adoptOrg(org, session.user.email);
        return;
      }
      if (org.serverId && (get().settings.declinedOrgIds ?? []).includes(org.serverId)) return;
      set({ orgJoin: { org, ownerUid } });
    } catch {
      // Offline or transient: keep the local org as-is.
    }
  }

  // The one door for every server call (APP-1, APP-2): the signed-in session
  // with a live access token, refreshed in one flight when it is near expiry.
  // A dead refresh token signs the device out here, in one place, with one
  // honest line; the caller then sees undefined and degrades to local-only.
  // Any other refresh failure (offline) is rethrown with the session intact.
  async function freshAuth(): Promise<Session | undefined> {
    const session = get().authSession;
    if (!session || !authConfigured()) return undefined;
    try {
      const fresh = await freshSession(session);
      const now = get().authSession;
      if (now === session) {
        if (fresh !== session) set({ authSession: fresh });
        return fresh;
      }
      // The sign-in changed while the refresh was out. Signed out (or someone
      // else signed in): nothing carries on with the old one, and it is never
      // put back. Another caller's refresh landed first: go on with that.
      if (!now || now.user.id !== session.user.id) return undefined;
      return now.refreshToken === fresh.refreshToken ? now : freshAuth();
    } catch (err) {
      // A sign-out already ended this session here: nothing more to say.
      if (get().authSession !== session) return undefined;
      if (err instanceof AuthExpiredError) {
        const kept = await forgetSession(true);
        get().showToast(
          kept
            ? 'Your sign-in expired. Your unsent team vault text is kept on this device for when you sign in again.'
            : 'Your sign-in expired. Sign in again.',
        );
        logEvent('auth_expired');
        return undefined;
      }
      throw err;
    }
  }

  async function accessToken(): Promise<string | undefined> {
    return (await freshAuth())?.accessToken;
  }

  // The guardrail record uploads on the store's session, so there is one
  // refresh in flight on this device, never a second with a spent token.
  setEthicsAuth(() => freshAuth());
  // Reviews and the abuse review queue ride the same door, so a refresh they
  // trigger lands in the store's memory too.
  setReviewsAuth(() => freshAuth());
  setAbuseReviewAuth(() => freshAuth());

  // Accounts (lib/accountGate.ts): the room the sign-in sheet was opened for,
  // so signing in carries on to it.
  let accountReturn: ViewName | undefined;
  // Preferences that follow a signed-in person (lib/settingsReach.ts). A local
  // change is sent a moment after the last one; the account's copy is read at
  // launch and at sign-in. Each is one merge, key by key (state/signinOps.ts).
  let prefsPushTimer: ReturnType<typeof setTimeout> | undefined;
  function schedulePrefsPush(): void {
    if (!get().authSession) return;
    if (prefsPushTimer) clearTimeout(prefsPushTimer);
    prefsPushTimer = setTimeout(() => {
      prefsPushTimer = undefined;
      void syncPreferences();
    }, 1500);
  }
  const syncPreferences = createPrefsSync({
    session: () => freshAuth(),
    read: readUserPrefs,
    write: writeUserPrefs,
    settings: () => get().settings,
    save: (patch) => get().saveSettings(patch),
  });

  // Forget the session on this device: the stored copy, the pending auth
  // binding, the team vault, the org's shared projects, and (APP-7) a
  // server-backed org's roster and the signed-in identity, so local admin
  // authority cannot outlive the sign-in. The org's name and server id stay,
  // so the next sign-in by a member pulls the same org without asking again.
  // `expired` is an involuntary end (a dead refresh token), usually the same
  // person, whose unsent team text is kept rather than wiped. Resolves to how
  // many team drafts that kept.
  async function forgetSession(expired = false): Promise<number> {
    // From its first step a sign-out stops the team vault speaking for this
    // account (speaksNow), so a save that fails while the rest runs is kept
    // in memory only, never stashed after the wipe below took the stash
    // (E11). An expiry keeps the text for the same account instead.
    if (expired) return endSession(true);
    signingOut++;
    try {
      return await endSession(false);
    } finally {
      signingOut--;
    }
  }
  async function endSession(expired: boolean): Promise<number> {
    const uid = get().authSession?.user.id;
    // A preference change still waiting to go belonged to the session.
    if (prefsPushTimer) clearTimeout(prefsPushTimer);
    prefsPushTimer = undefined;
    await clearSession();
    await clearPendingSignIn();
    // Best-effort: signing out of the account also severs any connected
    // Google Drive access, so a shared or handed-off device does not keep
    // standing storage access behind. A revoke failure (offline) must
    // never block sign-out itself.
    await disconnectGdrive().catch(() => {});
    // Sever the team vault too: drop its on-screen state and the provider's
    // memory caches, and fall back to the personal scope, so a handed-off
    // device never shows the previous org's note titles or open note to the
    // next person who signs in. A sign-out also wipes the team's unsent text
    // (R-19). An expiry keeps it, sealed and hidden, for its own account.
    resetOrgVault();
    forgetTeamBodies();
    stopVaultPoll();
    set({ vaultTeamPlan: undefined });
    let kept = 0;
    if (expired && uid) {
      keptTeamOwner = uid;
      kept = await countTeamDrafts(uid);
      await forgetTeamMemory(uid);
    } else {
      keptTeamOwner = undefined;
      await forgetTeamVaultDrafts();
      await forgetTeamMemory();
      // The team index goes with the drafts (M3 3.2): here and where it was kept.
      const orgId = get().settings.account?.org?.serverId;
      if (orgId && uid) await dropVaultIndex({ providerId: 'org', resourceId: orgId, owner: uid });
      // And every other team's this account built here (round 7 E33): a team
      // the account left, or one before its org changed.
      if (uid) await dropTeamIndexes((m) => m.owner !== uid);
    }
    // Whatever index is still warm (the personal one a chat's pack reads)
    // closes with the sign-in (Vault M5, CTO J1), its last write saved first,
    // and the chats' packs, their Current State, and the notes kept from the
    // computer go with it. The pairing itself is not the account's, so the
    // hub link comes back fresh, holding nothing of the last person's.
    await shutVaultIndex().catch(() => {});
    forgetVaultSettings();
    forgetVaultContext();
    await syncHubLink(get().settings.daemon, { forget: true });
    const s = get().settings;
    const patch: Partial<AppSettings> = {};
    // Drop the org's shared projects from this device so the next person to
    // sign in never sees the previous account's team projects. Local projects
    // stay. (Their chats keep their local link; it simply resolves to nothing
    // until the project is pulled again on the next sign-in.)
    const localProjects = (s.projects ?? []).filter((p) => !p.shared);
    if (localProjects.length !== (s.projects ?? []).length) patch.projects = localProjects;
    const account = s.account;
    if (account?.org?.serverId) {
      patch.account = { type: 'commercial', org: { ...account.org, members: [] } };
    }
    if (s.declinedOrgIds?.length) patch.declinedOrgIds = undefined;
    // Whose preference times these are, kept on the device: a different
    // person signing in next takes their own account's preferences instead
    // of racing these times (state/signinOps.ts ownerPatch).
    if (uid && s.prefsOwner !== uid) patch.prefsOwner = uid;
    if (Object.keys(patch).length) await get().saveSettings(patch);
    // An expiry with a team note open keeps that note on screen, read-only,
    // for the same person to sign back in to (Vault M2 2.6); the rest of the
    // team vault's titles leave with the session. A sign-out never keeps it.
    const open = get().vaultNote;
    const keepNote = expired && Boolean(uid) && get().vaultScope === 'team' && Boolean(open);
    // A team choice and the editor's live text belong to the sign-in too
    // (R-19): a sign-out takes them, and an expiry keeps them only on the kept
    // note, for the same account, whose stash holds the text sealed.
    const choice = get().vaultConflict;
    const dropChoice =
      choice?.target.providerId === 'org' &&
      !(keepNote && choice.path === open?.path && choice.target.owner === uid);
    if (!keepNote && get().vaultScope === 'team') vaultLiveDraft = undefined;
    // One door to the coding agent: no coding session stays attached past the
    // sign-in, so nothing typed or approved from here reaches the engine. Its
    // work goes on on the computer, journaled; the chat keeps its snapshot,
    // and signing in again replays the rest.
    const detached = detachCodingChats(get().conversations, [...drivers.keys()]);
    for (const id of detached.ids) {
      dropDriver(id);
      snapshotIds.add(id);
    }
    // Standing in a room that needs an account, the person lands on chat,
    // the free home, rather than on a room they can no longer use.
    const leaveRoom = leavesRoomAtSignOut(get().view, authConfigured());
    set({
      ...(leaveRoom ? { view: 'chat' as const, viewTrail: [] } : {}),
      ...(detached.conversations ? { conversations: detached.conversations } : {}),
      authSession: undefined,
      serverRole: undefined,
      entitlement: undefined,
      orgJoin: undefined,
      ...(dropChoice ? { vaultConflict: undefined } : {}),
      ...(keepNote
        ? {
            vaultTeamExpired: true,
            vaultFiles: get().vaultFiles.filter((f) => f.path === open!.path),
          }
        : {
            vaultTeamExpired: undefined,
            vaultScope: 'personal' as const,
            vaultError: undefined,
            ...clearedVaultRoom(),
          }),
    });
    return kept;
  }

  // Best-effort write-through for an admin edit. No-ops (staying local-only)
  // until the org has been synced to the server and someone is signed in.
  async function orgWrite(
    fn: (session: Session, serverOrgId: string) => Promise<void>,
  ): Promise<void> {
    const serverId = get().settings.account?.org?.serverId;
    if (!serverId) return;
    try {
      const fresh = await freshAuth();
      if (!fresh) return;
      await fn(fresh, serverId);
    } catch (err) {
      get().showToast(err instanceof Error ? err.message : 'Could not sync to your account.');
    }
  }

  // A fresh access token for an org-projects RPC, or undefined when there is no
  // signed-in session / accounts are not configured (so the caller degrades to
  // local-only).
  async function orgProjectToken(): Promise<string | undefined> {
    return accessToken();
  }

  /** Ask the hub what this device's credential may do and record it. */
  async function refreshHubRole(daemon: DaemonTarget | undefined): Promise<void> {
    if (!daemon) return;
    const role = await readHubRole(daemon);
    if (role && role !== get().settings.hubRoles?.[daemon.baseUrl]) {
      await get().setHubRole(daemon.baseUrl, role);
    }
  }

  // Patch a project's locally-stored fields (no server round-trip). The shared
  // write paths call this to reflect a server result on the device.
  async function patchProjectLocal(id: string, patch: Partial<Project>): Promise<void> {
    const projects = (get().settings.projects ?? []).map((p) =>
      p.id === id ? { ...p, ...patch } : p,
    );
    await get().saveSettings({ projects });
  }

  // A1: adding seats or inviting members is gated on an active entitlement, but
  // ONLY once the org is server-backed and subject to billing. A purely local
  // org (offline demo, not yet signed in or synced) is never gated, and existing
  // members always keep working. Manage Billing / Buy stays open regardless.
  function growthGatedByBilling(): boolean {
    const st = get();
    const serverId = st.settings.account?.org?.serverId;
    if (!authConfigured() || !st.authSession || !serverId) return false;
    return !isEntitled(st.entitlement);
  }

  // Which provider and resource the vault actions target, resolved from the
  // active scope. Personal rides the chosen storage provider and the personal
  // resource id; team is the Supabase-backed org vault, addressed by the org's
  // server id and owned by the account signed in now. Returns undefined for
  // team when no signed-in org is present, so the actions no-op instead of
  // throwing.
  type VaultTarget = VaultTargetRef & { provider: StorageProvider };
  // A team target's storage answers only while its account is the one
  // signed in (state/teamOwner.ts), so nothing started under one account is
  // ever sent under the next (R-19).
  const teamStorage = (provider: StorageProvider, owner: string | undefined) =>
    ownerBoundProvider(provider, owner, () => get().authSession?.user.id);
  function vaultTarget(): VaultTarget | undefined {
    const st = get();
    if (st.vaultScope === 'team') {
      const orgId = st.settings.account?.org?.serverId;
      const provider = providerFor('org');
      if (!orgId || !provider) return undefined;
      const owner = st.authSession?.user.id;
      return {
        provider: teamStorage(provider, owner),
        providerId: 'org',
        resourceId: orgId,
        owner,
      };
    }
    const providerId = vaultProviderId(st.settings);
    const provider = providerFor(providerId);
    if (!provider) return undefined;
    return { provider, providerId, resourceId: VAULT_RESOURCE_ID };
  }
  // A target a caller pinned earlier (a scheduled save), or the active one. A
  // team ref speaks only for the account it names; one that names none
  // (pinned while nobody was signed in) speaks for nobody.
  function vaultTargetFrom(at?: VaultTargetRef): VaultTarget | undefined {
    if (!at) return vaultTarget();
    const provider = providerFor(at.providerId);
    if (!provider) return undefined;
    const { providerId, resourceId, owner } = at;
    return providerId === 'org'
      ? { provider: teamStorage(provider, owner), providerId, resourceId, owner }
      : { provider, providerId, resourceId };
  }
  // Whether a target is the vault on screen now, so a late result never
  // paints one vault's list or note over the other's, nor one account's team
  // vault over another's. A team note kept open after an expiry is still its
  // account's.
  function isActiveVault(t: VaultTargetRef): boolean {
    const now = vaultTarget();
    if (!now || now.providerId !== t.providerId || now.resourceId !== t.resourceId) return false;
    return t.providerId !== 'org' || (now.owner ?? keptTeamOwner) === t.owner;
  }
  // Whether text for a target may be sent, stashed, or shown right now:
  // always for a personal vault; for the team vault only while the account
  // that typed it is the one signed in, and no sign-out is under way (E11).
  function speaksNow(t: VaultTargetRef): boolean {
    return (
      t.providerId !== 'org' ||
      (signingOut === 0 && t.owner !== undefined && t.owner === get().authSession?.user.id)
    );
  }
  // The team gate (vaultTeamGate) on the plan as it is now (round 7 E37): a
  // plan that would refuse is read again first, since an admin may have let
  // everyone delete again, or the plan may be active again, since it was
  // read. One settings read, only on the refusal path; a read that does not
  // answer leaves the refusal standing (it fails closed). The free space is
  // learned from a refusal, never a read, so a refusal for it alone is said
  // as it is, with nothing asked.
  async function teamRefusalNow(
    t: VaultTargetRef,
    write: VaultTeamWrite,
  ): Promise<string | undefined> {
    const plan = get().vaultTeamPlan;
    const refused = vaultTeamRefusal(t.providerId, plan, write);
    if (!refused || !plan || t.providerId !== 'org' || !speaksNow(t)) return refused;
    const { full: _full, ...unfull } = plan;
    if (!vaultTeamRefusal(t.providerId, unfull, write)) return refused;
    await refreshOrgVaultPlan(t.resourceId);
    return vaultTeamRefusal(t.providerId, get().vaultTeamPlan, write);
  }
  // Whether a resolve choice may be settled now: any personal one, and a
  // team one only while its account is signed in and its vault is on screen.
  function teamChoiceSpeaks(c: VaultConflict): boolean {
    return c.target.providerId !== 'org' || (speaksNow(c.target) && isActiveVault(c.target));
  }
  // A team choice tapped when it cannot be settled. After an expiry it is
  // the same account's: the words on screen go to the sealed stash, the
  // choice stays for its return, and the line says to sign in. Any other is
  // another account's, dropped with nothing written, kept or said (R-19).
  async function waitForTeamSignIn(c: VaultConflict, draft: string): Promise<VaultResolveResult> {
    const owner = c.target.owner;
    if (owner && owner === keptTeamOwner && !get().authSession) {
      await stashConflictText(c.target, c.path, draft, c.baseVersion);
      get().showToast(VAULT_TEAM_SIGN_IN_LINE);
      return { ok: false };
    }
    if (get().vaultConflict === c) set({ vaultConflict: undefined });
    return { ok: false };
  }
  const vaultKey = (t: VaultTargetRef, path: string) => `${t.providerId}::${t.resourceId}::${path}`;
  // What a provider lists that the Vault treats as notes: `.md` files outside
  // dot folders, so `.obsidian/` and attachments never show or copy (0.6).
  async function listVaultNotes(t: VaultTarget): Promise<StoredFileMeta[]> {
    return (await t.provider.list(t.resourceId)).filter((f) => isNotePath(f.path));
  }
  // The Vault index (M3 3.2, lib/vaultIndexHost.ts) for the vault on screen:
  // opened when its list lands, fed by every write and remove, and asked only
  // for the vault on screen, so a write to any other vault never touches it.
  // A hub vault's index is one per computer and per person on it
  // (`hubIndexTarget`, the link's own target), so two hubs or two members
  // never share one; every other vault is keyed by its own target.
  function indexTargetOf(t: VaultTargetRef): VaultIndexTarget {
    if (t.providerId === 'hub') {
      const link = hubVaultLink();
      if (link) return link.target;
    }
    const { providerId, resourceId, owner } = t;
    return owner ? { providerId, resourceId, owner } : { providerId, resourceId };
  }
  function openVaultIndex(t: VaultTarget): VaultIndexHost {
    // A team index is named on the device's list as it opens, so it leaves
    // with its account whichever way the sign-in ends (round 7 E33).
    if (t.providerId === 'org' && t.owner) void noteTeamIndex(t.resourceId, t.owner);
    return vaultIndexFor(indexTargetOf(t), t.provider);
  }
  function vaultIndexOf(t: VaultTargetRef): VaultIndexHost | undefined {
    const host = currentVaultIndex();
    const now = vaultTarget();
    if (!host || !now || !isActiveVault(t)) return undefined;
    const want = indexTargetOf(now);
    const { providerId, resourceId, owner } = host.target;
    return providerId === want.providerId &&
      resourceId === want.resourceId &&
      (owner ?? '') === (want.owner ?? '')
      ? host
      : undefined;
  }

  // Durable draft rescue for the vault. When a provider write fails (offline
  // cloud vault, expired token), the typed text is stashed to the sealed local
  // store keyed by provider, resource, and path, and replayed the next time a
  // write or a list succeeds against that same provider and resource, never
  // another (a moved vault does not inherit the old home's drafts). Each entry
  // carries the provider's version the text was typed against, so a replay
  // never lands over newer work: when the note changed elsewhere meanwhile,
  // both are kept (data-1). This is what makes a cloud-backed vault safe to
  // type into offline: nothing typed is lost to an unhandled rejection.
  const VAULT_PENDING_KEY = 'oscode.vault.pending';
  type VaultPendingEntry = VaultTargetRef & {
    path: string;
    text: string;
    /** The version (versionOf) this text was typed against; absent when the
     *  provider did not hold the note yet (a new note). For the team vault
     *  that is its rev as a string, once the team provider versions by rev. */
    base?: string;
    /** Legacy, read only: the team server rev an entry stashed before Vault
     *  M2 carried beside an ISO base. The loader turns it into the base once
     *  the team provider compares revs (CTO G3); nothing writes it now. */
    rev?: number;
    /** When it was stashed, on this device's clock (ordering only), always
     *  later than the last (nextStashAt): a save's own entry, and any entry
     *  written after that save began, compare by it (round 7 E10). */
    at: string;
    /** The sitting of the note the text was typed in (the open note's
     *  loadedAt), when it was open. A save supersedes an entry of its own
     *  sitting, since the editor showed those words, but never one of
     *  another: an open shows the vault's read, never the stash (E10). */
    sitting?: number;
    /** The desktop folder only: the folder the text was typed in (its
     *  realpath) and how it reads, so text typed before the vault was
     *  pointed at another folder never replays into the new one (CTO F7.6). */
    folder?: string;
    folderDisplay?: string;
  };
  type VaultPending = Record<string, VaultPendingEntry>;
  // A stash from before entries named their provider cannot be matched to one
  // safely (the vault may have moved since), so it is held for the person to
  // copy rather than replayed anywhere.
  const LEGACY_DRAFT_REASON =
    'Saved offline before an update, so it was not replayed over anything newer. Copy it back into the note if you still need it.';
  async function loadVaultPending(): Promise<VaultPending> {
    const raw =
      (await storeGetJson<Record<string, Partial<VaultPendingEntry>>>(VAULT_PENDING_KEY)) ?? {};
    const p: VaultPending = {};
    const personal: VaultHeldDraft[] = [];
    const team: VaultHeldDraft[] = [];
    let dropped = false;
    let converted = false;
    const st = get();
    const uid = st.authSession?.user.id;
    // Once the team provider compares revs (compare-and-swap, CTO G3), a team
    // entry stashed with a numeric rev is converted, once and for good, to
    // base = String(rev), the version that provider reports. One without a
    // rev keeps its ISO base, which never equals a rev, so its replay keeps
    // both and loses nothing. Before then, the entry is left as it was.
    const orgRevs = Boolean(providerFor('org')?.compareAndSwap);
    for (const [key, e] of Object.entries(raw)) {
      if (typeof e?.path !== 'string' || typeof e.text !== 'string') continue;
      if (typeof e.resourceId !== 'string') continue;
      if (e.providerId && (e.providerId !== 'org' || e.owner)) {
        if (orgRevs && e.providerId === 'org' && 'rev' in e) {
          const { rev, ...rest } = e;
          const base = typeof rev === 'number' && e.base ? String(rev) : e.base;
          p[key] = { ...(rest as VaultPendingEntry), ...(base ? { base } : {}) };
          converted = true;
          continue;
        }
        p[key] = e as VaultPendingEntry;
        continue;
      }
      dropped = true;
      const providerId =
        e.providerId ?? (e.resourceId === VAULT_RESOURCE_ID ? vaultProviderId(st.settings) : 'org');
      if (providerId !== 'org') {
        const ref = { providerId, resourceId: e.resourceId };
        personal.push(heldDraft(ref, e.path, e.text, LEGACY_DRAFT_REASON, e.at));
        continue;
      }
      // Team text with no account on it: nobody knows who typed it, so it
      // never replays and never lands in the sealed store. A member signed in
      // to its org sees it until the app closes (it was written for that
      // team); anyone else, or a signed-out device, never does.
      if (uid && st.settings.account?.org?.serverId === e.resourceId) {
        const ref = { providerId, resourceId: e.resourceId, owner: uid };
        team.push(heldDraft(ref, e.path, e.text, LEGACY_DRAFT_REASON, e.at));
      }
    }
    if (dropped) {
      for (const h of personal) await holdVaultDraft(h, h.path, h.text, h.reason, { at: h.at });
      for (const h of team) {
        await holdVaultDraft(h, h.path, h.text, h.reason, { at: h.at, memoryOnly: true });
      }
    }
    if (dropped || converted) await saveVaultPending(p);
    return p;
  }
  async function saveVaultPending(p: VaultPending): Promise<void> {
    if (Object.keys(p).length === 0) await storeDelete(VAULT_PENDING_KEY);
    else await storeSetJson(VAULT_PENDING_KEY, p);
  }
  // One read-modify-write at a time, so two failures at once (a flush racing
  // a create) cannot drop each other's rescued draft (data-7).
  let vaultPendingChain: Promise<unknown> = Promise.resolve();
  function editVaultPending<T>(edit: (p: VaultPending) => T): Promise<T> {
    const run = vaultPendingChain.then(async () => {
      const p = await loadVaultPending();
      const before = JSON.stringify(p);
      const out = edit(p);
      if (JSON.stringify(p) !== before) await saveVaultPending(p);
      const refs = Object.values(p).map(({ providerId, resourceId, owner, path }) => ({
        providerId,
        resourceId,
        ...(owner ? { owner } : {}),
        path,
      }));
      if (JSON.stringify(refs) !== JSON.stringify(get().vaultPending)) set({ vaultPending: refs });
      return out;
    });
    vaultPendingChain = run.catch(() => {});
    return run;
  }

  // Words on their way to a storage across the network (the team vault, your
  // computer), written to the sealed store before each save goes out and
  // removed once it settles, so a page iOS suspends and reclaims, or a tab
  // closed, while the write is out never takes the last words with it (round
  // 7 E17). Kept apart from the stash, which holds only text still to save:
  // the save chip, the replay and the one-entry-per-note rule never see
  // these while their save runs. What a launch that ended left here goes to
  // the stash on the next refresh (recoverVaultInflight) and replays at the
  // version it was typed on, landing, or settling if it had landed.
  const VAULT_INFLIGHT_KEY = 'oscode.vault.inflight';
  // This launch's entries whose save is still running.
  const liveInflight = new Set<string>();
  let vaultInflightChain: Promise<unknown> = Promise.resolve();
  function editVaultInflight<T>(edit: (p: VaultPending) => T): Promise<T> {
    const run = vaultInflightChain.then(async () => {
      const p = (await storeGetJson<VaultPending>(VAULT_INFLIGHT_KEY)) ?? {};
      const before = JSON.stringify(p);
      const out = edit(p);
      if (JSON.stringify(p) !== before) {
        if (Object.keys(p).length === 0) await storeDelete(VAULT_INFLIGHT_KEY);
        else await storeSetJson(VAULT_INFLIGHT_KEY, p);
      }
      return out;
    });
    vaultInflightChain = run.catch(() => {});
    return run;
  }
  /** Whether a storage's writes cross the network, so a save writes ahead. */
  const writesAhead = (t: VaultTargetRef) => t.providerId === 'org' || t.providerId === 'hub';
  // Put a save's words on the device before it goes out. Resolves to the
  // entry's id, or undefined when the sealed store did not take them (the
  // save still goes, as before).
  async function writeAhead(
    t: VaultTargetRef,
    path: string,
    text: string,
    base: string | undefined,
    sitting: number | undefined,
    mark: string,
  ): Promise<string | undefined> {
    const id = `${vaultKey(t, path)}@${mark}`;
    liveInflight.add(id);
    try {
      await editVaultInflight((p) => {
        p[id] = pendingEntry(t, path, text, base, { sitting, at: mark });
      });
      return id;
    } catch {
      liveInflight.delete(id);
      return undefined;
    }
  }
  // The version a save is sent against, once its turn comes (a save queued
  // behind another learns it only then), so a relaunch replays it there.
  async function restampAhead(id: string, base: string | undefined): Promise<void> {
    await editVaultInflight((p) => {
      const e = p[id];
      if (!e || e.base === base) return;
      const { base: _was, ...rest } = e;
      p[id] = base ? { ...rest, base } : rest;
    }).catch(() => {});
  }
  // A save settled: its words landed, or the save put them in the stash or
  // under Not saved. One that ended some other way (it threw) leaves them in
  // the stash instead, never nowhere.
  async function settleAhead(id: string, ended: boolean): Promise<void> {
    const e = await editVaultInflight((p) => {
      const out = p[id];
      delete p[id];
      return out;
    }).catch(() => undefined);
    liveInflight.delete(id);
    if (!ended && e) {
      await stashDraft(e, e.path, e.text, e.base, { sitting: e.sitting, mark: e.at }).catch(
        () => {},
      );
    }
  }
  // Words a launch that ended left on their way go to the stash, oldest
  // first, for the replay; team words only while their account is signed in
  // (the rest wait sealed for it, or leave with a sign-out or another sign-in).
  async function recoverVaultInflight(): Promise<void> {
    const left = await editVaultInflight((p) => {
      const out: VaultPendingEntry[] = [];
      for (const [id, e] of Object.entries(p)) {
        if (liveInflight.has(id) || !e || typeof e.text !== 'string') continue;
        if (!speaksNow(e)) continue;
        out.push(e);
        delete p[id];
      }
      return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    }).catch(() => [] as VaultPendingEntry[]);
    for (const e of left) {
      await stashDraft(e, e.path, e.text, e.base, { sitting: e.sitting, mark: e.at }).catch(
        () => {},
      );
    }
  }

  // The "Not saved" list: text no vault took and nothing will retry. State is
  // what the screen shows; the sealed store keeps the durable copy, loaded
  // once per launch (vaultRefresh) and edited in step with state. Only the
  // person clears an entry, with vaultDiscardHeld, except team text, which
  // leaves with its account (a sign-out, or another account signing in).
  const VAULT_HELD_KEY = 'oscode.vault.held';
  let vaultHeldChain: Promise<unknown> = Promise.resolve();
  let vaultHeldLoaded = false;
  // Every entry is its own: the id names the note, the account (team text),
  // and the sitting it came from, so a later hold replaces only the same
  // sitting's older text, never an earlier sitting's or another account's
  // (round 7 E7). A hold from no sitting (a create, a replay, a leftover) is
  // always an entry of its own. Entries sealed before this keep their ids.
  let heldSeq = 0;
  function heldDraft(
    t: VaultTargetRef,
    path: string,
    text: string,
    reason: string,
    at = new Date().toISOString(),
    session?: string | number,
  ): VaultHeldDraft {
    const { providerId, resourceId } = t;
    const owner = providerId === 'org' ? t.owner : undefined;
    return {
      id: `${vaultKey(t, path)}::${owner ?? ''}::${session ?? `${at}#${++heldSeq}`}`,
      providerId,
      resourceId,
      path,
      text,
      reason,
      at,
      ...(owner ? { owner } : {}),
      durable: true,
    };
  }
  // Put a held draft in a list: it replaces its own entry (the same sitting's
  // older text) unless that one is newer, and an entry holding the very same
  // words for the same note and account, never anything else.
  const keepNewest = (h: VaultHeldDraft) => (list: VaultHeldDraft[]) => {
    const old = list.find((x) => x.id === h.id);
    if (old && old.at > h.at) return list;
    const twin = (x: VaultHeldDraft) =>
      x.text === h.text &&
      x.path === h.path &&
      x.providerId === h.providerId &&
      x.resourceId === h.resourceId &&
      x.owner === h.owner &&
      x.folder === h.folder;
    return [...list.filter((x) => x.id !== h.id && !twin(x)), h];
  };
  // Apply one edit to the list on screen and, when `durable`, to the sealed
  // copy. Resolves true only when the sealed store now holds the edited list:
  // a write it refused or ignored (full, or a key this launch cannot open)
  // resolves false. A list this launch could not read is never deleted, so
  // one discard on a locked launch cannot erase every earlier draft.
  function editVaultHeld(
    edit: (list: VaultHeldDraft[]) => VaultHeldDraft[],
    durable = true,
  ): Promise<boolean> {
    set({ vaultHeld: edit(get().vaultHeld) });
    if (!durable) return Promise.resolve(false);
    const run = vaultHeldChain.then(async () => {
      const stored = await storeGetJson<VaultHeldDraft[]>(VAULT_HELD_KEY);
      const next = edit(stored ?? []).filter((h) => h.durable !== false);
      // Nothing to change. A list this launch cannot open reads as absent, so
      // this is also what keeps an edit that empties it from deleting it.
      if (JSON.stringify(next) === JSON.stringify(stored ?? [])) return true;
      if (!next.length) {
        await storeDelete(VAULT_HELD_KEY);
        return true;
      }
      await storeSetJson(VAULT_HELD_KEY, next);
      const back = await storeGetJson<VaultHeldDraft[]>(VAULT_HELD_KEY);
      return JSON.stringify(back) === JSON.stringify(next);
    });
    vaultHeldChain = run.catch(() => {});
    return run;
  }
  async function loadVaultHeld(): Promise<void> {
    if (vaultHeldLoaded) return;
    vaultHeldLoaded = true;
    const stored = await storeGetJson<VaultHeldDraft[]>(VAULT_HELD_KEY).catch(() => undefined);
    if (!stored?.length) return;
    const shown = new Set(get().vaultHeld.map((h) => h.id));
    const loaded = stored.filter((h) => !shown.has(h.id)).map((h) => ({ ...h, durable: true }));
    set({ vaultHeld: [...loaded, ...get().vaultHeld] });
  }
  // Set text aside as "Not saved". Durable, except team text whose account is
  // not the one signed in (R-19), or when the caller asks for memory only.
  // Resolves true only when the sealed store holds it; otherwise the entry is
  // marked memory-only so the screen can say it lasts until the app closes.
  async function holdVaultDraft(
    t: VaultTargetRef,
    path: string,
    text: string,
    reason: string,
    opts: {
      at?: string;
      memoryOnly?: boolean;
      folder?: string;
      folderDisplay?: string;
      /** The sitting the text was typed in (the open note's loadedAt), so
       *  refused saves of one sitting keep one entry, its newest text. */
      session?: string | number;
    } = {},
  ): Promise<boolean> {
    // Team text of an account whose sign-in expired stays sealed for its
    // return, hidden until then (vaultHeldFor), like its stash.
    const expiredOwner = t.providerId === 'org' && Boolean(t.owner) && t.owner === keptTeamOwner;
    const durable = !opts.memoryOnly && (speaksNow(t) || expiredOwner);
    const h: VaultHeldDraft = {
      ...heldDraft(t, path, text, reason, opts.at, opts.session),
      durable,
      // Text from an earlier folder keeps its own entry, so a later hold of
      // the same path in the folder used now never replaces it.
      ...(opts.folder ? { id: `${vaultKey(t, path)}::${opts.folder}`, folder: opts.folder } : {}),
      ...(opts.folderDisplay ? { folderDisplay: opts.folderDisplay } : {}),
    };
    let landed = false;
    try {
      landed = await editVaultHeld(keepNewest(h), durable);
    } catch {
      // The sealed store refused the durable copy; state still holds the text.
    }
    if (durable && !landed) {
      set({
        vaultHeld: get().vaultHeld.map((x) => (x === h ? { ...x, durable: false } : x)),
      });
    }
    return landed;
  }
  // How a toast ends after text was held: kept, or kept only until the app
  // closes because this device could not store a copy.
  const heldLine = (landed: boolean) =>
    landed
      ? 'Your text is kept under Not saved.'
      : 'This device could not keep a copy, so it is under Not saved only until the app closes. Copy it somewhere safe now.';
  // The last save of the open note's sitting was set aside under Not saved:
  // the note says so until one lands (E18). Only that sitting's own save.
  function markHeldHere(t: VaultTargetRef, path: string, session: number | undefined): void {
    const open = get().vaultNote;
    if (!isActiveVault(t) || open?.path !== path) return;
    if (session === undefined || open.loadedAt !== session) return;
    set({ vaultNote: { ...open, held: true } });
  }

  // The account an expired sign-in belonged to, while nobody has signed in
  // since. Its unsent team text is kept sealed and hidden for its return; a
  // sign-out, or any sign-in, clears this.
  let keptTeamOwner: string | undefined;
  // How many sign-outs are running (forgetSession). While one is, no team
  // text speaks for anyone: the sign-out is wiping it (E11).
  let signingOut = 0;

  // Team text whose account is no longer the one signed in, from a save that
  // ran or failed after a sign-out, an expiry, or an account switch. It is
  // never sent. After an expiry it is stashed, sealed and hidden, and it
  // replays when the same account signs back in. Otherwise it is held in
  // memory only, shown to that account alone if it signs back in before the
  // app closes.
  async function keepUnsentTeamText(
    t: VaultTargetRef,
    path: string,
    text: string,
    base: string | undefined,
    session?: number,
  ): Promise<void> {
    if (t.owner && t.owner === keptTeamOwner) {
      try {
        await stashDraft(t, path, text, base, { sitting: session });
        get().showToast(
          'Your sign-in expired, so this team vault text is kept on this device for when you sign in again.',
        );
        logEvent('vault_team_text_kept');
        return;
      } catch {
        // No room to stash it: hold it in memory instead, below.
      }
    }
    const reason =
      'Not sent, because you were signed out of your team. Copy it back into the note.';
    await holdVaultDraft(t, path, text, reason, { memoryOnly: true, session });
    get().showToast(
      get().authSession && signingOut === 0
        ? 'Team vault text typed before the account changed was not sent.'
        : 'Not saved to the team vault, because you are signed out. Sign in again with the same account before the app closes to get it back under Not saved.',
    );
    logEvent('vault_team_text_unsent');
  }

  // Re-list the desktop folder when it is the vault on screen.
  async function refreshFolderList(): Promise<void> {
    const t = vaultTarget();
    if (!t || t.providerId !== 'files' || get().vaultScope !== 'personal') return;
    const files = await listVaultNotes(t).catch(() => undefined);
    if (files && isActiveVault(t)) set({ vaultFiles: files });
    if (files) void vaultIndexOf(t)?.reconcile(files);
  }

  // After main repointed the vault folder (a pick, or a choice after one):
  // text stashed against the old folder is held under Not saved naming it,
  // the folder's cached bodies are dropped, and the room re-lists from the
  // new folder, saying it is opening until the list lands (CTO F7.6, CX 1.4).
  async function afterVaultPick(
    result: VaultPickResult,
    before: string | undefined,
  ): Promise<void> {
    if (!result.ok) {
      if ('same' in result) set({ vaultFolder: result.info });
      logEvent('vault_folder_pick', {
        result: 'cancelled' in result ? 'cancelled' : 'same' in result ? 'same' : result.refused,
      });
      return;
    }
    set({ vaultFolder: result.info });
    logEvent('vault_folder_pick', {
      result: 'ok',
      obsidian: result.survey.obsidian,
      inside: Boolean(result.survey.inside),
      holds: result.survey.holds?.length ?? 0,
      cloud: result.survey.cloud ?? 'none',
    });
    if (before === result.info.dir) return;
    for (const key of [...vaultBodyCache.keys()]) {
      if (key.startsWith('files::')) vaultBodyCache.delete(key);
    }
    await holdOtherFolderDrafts(result.info.dir, true);
    if (vaultProviderId(get().settings) === 'files') {
      const open = get().vaultNote;
      if (open && get().vaultScope === 'personal') {
        // The open note belonged to the old folder.
        await leaveVaultConflict();
        vaultLiveDraft = undefined;
        set({ vaultNote: undefined });
      }
      set({ vaultListed: false, vaultFiles: [] });
    }
    await get().vaultRefresh();
  }

  // CX 1.3 (b): a desktop personal vault on Local by default, never by the
  // person's choice, whose list succeeded empty and which holds no stashed or
  // held text, has nothing to move: it points at the folder with one toast.
  // A failed list never counts as empty. True when it repointed.
  async function repointEmptyLocal(t: VaultTarget, files: StoredFileMeta[]): Promise<boolean> {
    if (files.length || t.providerId !== 'local' || t.resourceId !== VAULT_RESOURCE_ID) {
      return false;
    }
    const s = get();
    if (!isDesktop() || s.vaultScope !== 'personal' || s.vaultMoving) return false;
    const folder = s.vaultFolder;
    if (!folder?.exists) return false;
    const row = s.settings.gitosResources?.find((r) => r.id === VAULT_RESOURCE_ID);
    if (!row || row.chosenAt) return false;
    const mine = (e: { providerId: string; resourceId: string }) =>
      e.providerId === 'local' && e.resourceId === VAULT_RESOURCE_ID;
    if (s.vaultHeld.some(mine)) return false;
    const stashed = await editVaultPending((p) => Object.values(p).some(mine)).catch(() => true);
    if (stashed) return false;
    const resources = (s.settings.gitosResources ?? []).map((r) =>
      r.id === VAULT_RESOURCE_ID ? { ...r, providerId: 'files' as const } : r,
    );
    await s.saveSettings({ gitosResources: resources });
    logEvent('vault_repointed_empty');
    s.showToast(vaultRepointToast(folder.display));
    set({ vaultListed: false });
    await get().vaultRefresh();
    return true;
  }

  // The move itself (vaultMoveTo): copy every note, check the target holds
  // them all, then repoint.
  async function moveVaultInner(providerId: StorageProviderId): Promise<VaultMoveResult> {
    const refused = (
      reason: VaultMoveResult['reason'],
      skipped: string[] = [],
      left: string[] = [],
    ): VaultMoveResult => ({
      ok: false,
      moved: [],
      skipped,
      forked: [],
      ...(left.length ? { left } : {}),
      reason,
    });
    // Moving is about where the PERSONAL vault's bytes live. The team vault is
    // a separate shared resource, never a move target, so reject it outright
    // and read the source through the personal provider (not the active
    // scope's), so a move initiated while viewing the team vault is still safe.
    // Google Drive takes no new vault in v1 (D1): a move there would write
    // through the loss path that made existing Drive vaults read-only.
    if (providerId === 'org' || vaultReadOnlyReason(providerId)) return refused('unavailable');
    const from = vaultProviderId(get().settings);
    if (providerId === from) return { ok: true, moved: [], skipped: [], forked: [] };
    const target = providerFor(providerId);
    const source = providerFor(from);
    if (!target || !source || !(await probeReady(providerId))) return refused('unavailable');
    const home: VaultTarget = {
      provider: source,
      providerId: from,
      resourceId: VAULT_RESOURCE_ID,
    };
    // Drafts stranded offline belong to the old home: put them back there
    // first (with the usual never-over-newer rule), so the copy below
    // carries them. A read-only home holds them instead.
    await replayVaultPending(home);
    // Read every note before writing anything. Only notes move (`.md`
    // outside dot folders, so `.obsidian/` and attachments stay put), and a
    // note that is still downloading, reads back empty against a non-empty
    // listing, or fails to read refuses the whole move: repointing without
    // it would drop it from the vault the person sees (data-14).
    let files: StoredFileMeta[];
    try {
      files = await listVaultNotes(home);
    } catch {
      return refused('unreadable');
    }
    const notes: Array<{ path: string; text: string; updatedAt: string }> = [];
    const skipped: string[] = [];
    for (const f of files) {
      if (f.evicted) {
        skipped.push(f.path);
        continue;
      }
      try {
        const note = await source.read(VAULT_RESOURCE_ID, f.path);
        if (!note || (note.text === '' && f.size > 0)) skipped.push(f.path);
        else notes.push({ path: f.path, text: note.text, updatedAt: f.updatedAt });
      } catch {
        skipped.push(f.path);
      }
    }
    if (skipped.length) return refused('unreadable', skipped);
    // Copy every note across before repointing, so a mid-move failure leaves
    // the source vault intact. The source bytes are left in place as a
    // safety copy; a later cleanup pass can reclaim them.
    const landed: string[] = [];
    // The files this attempt wrote where the target held nothing. A refused
    // move takes them back (never a file that was there before), so its
    // "nothing moved" is true and a retry starts clean: a stale copy left
    // here would otherwise keep the note's name on the retry (copy-1). Each
    // carries the version this attempt wrote, and the take-back is guarded
    // with it, so a note someone wrote there since is never taken back
    // (Vault M2 wave 0): it stays, and is named among what is left.
    const created: Array<{ path: string; version: string }> = [];
    const forked: VaultMoveResult['forked'] = [];
    const takeBack = async (): Promise<string[]> => {
      const left: string[] = [];
      for (const c of created) {
        try {
          const r = await target.remove(VAULT_RESOURCE_ID, c.path, { ifMatch: c.version });
          if (!r.ok) left.push(c.path);
        } catch {
          left.push(c.path);
        }
      }
      return left;
    };
    try {
      // A move never overwrites a note already at the target, whatever its
      // age: the target may be a folder the agent, Obsidian, or another
      // device already writes (COR-9, and the reason a desktop move to "This
      // folder" is safe). The same text is already there, so nothing is
      // written; different text lands beside it under a conflict name that
      // is itself free on the target.
      const taken = new Set(
        (await target.list(VAULT_RESOURCE_ID)).map((f) => f.path.toLowerCase()),
      );
      const when = new Date();
      const at = { provider: target, resourceId: VAULT_RESOURCE_ID };
      for (const note of notes) {
        let n = 0;
        // The next conflict name the target has not shown.
        const nextFree = (): string => {
          let dest: string;
          do dest = vaultConflictCopyPath(note.path, when, ++n);
          while (taken.has(dest.toLowerCase()));
          return dest;
        };
        let dest = note.path;
        if (taken.has(note.path.toLowerCase())) {
          const theirs = await target.read(VAULT_RESOURCE_ID, note.path);
          if (theirs?.text === note.text) {
            landed.push(note.path);
            continue;
          }
          dest = nextFree();
        }
        // Every copy is a create (ifAbsent): a name the listing did not
        // show but the target holds (a writer landing mid-move) is never
        // replaced; the same text there is done, different text forks.
        let saved: StoredFile | undefined;
        let same = false;
        for (let tries = 0; tries < 20; tries++) {
          const r = await putVaultNote(at, dest, note.text, { ifAbsent: true });
          if (r.ok) {
            saved = r.file;
            break;
          }
          if (r.conflict !== 'exists') mustLand(r);
          taken.add(dest.toLowerCase());
          if (r.theirs?.text === note.text) {
            same = true;
            break;
          }
          dest = nextFree();
        }
        if (same) {
          landed.push(dest);
          continue;
        }
        if (!saved) throw new Error('No free name for the moved copy.');
        created.push({ path: saved.path, version: versionOf(saved) });
        taken.add(saved.path.toLowerCase());
        landed.push(saved.path);
        if (saved.path !== note.path) forked.push({ from: note.path, to: saved.path });
      }
    } catch {
      return refused('copy-failed', [], await takeBack());
    }
    // Check the target really holds every copy before the vault points at
    // it, note for note (a stricter check than matching counts), or the
    // move is refused and the vault stays where it was.
    let there: StoredFileMeta[];
    try {
      there = (await target.list(VAULT_RESOURCE_ID)).filter((f) => isNotePath(f.path));
    } catch {
      return refused('unverified', [], await takeBack());
    }
    const onTarget = new Set(there.map((f) => f.path));
    const missing = landed.filter((p) => !onTarget.has(p));
    if (missing.length) return refused('unverified', missing, await takeBack());
    // Every move is the person's own choice, stamped so a storage they
    // picked is never repointed or offered a move again (CX 1.3), and any
    // move ends the desktop move offer.
    const chosenAt = new Date().toISOString();
    const current = get().settings.gitosResources ?? [];
    const resources = current.some((r) => r.id === VAULT_RESOURCE_ID)
      ? current.map((r) => (r.id === VAULT_RESOURCE_ID ? { ...r, providerId, chosenAt } : r))
      : [
          ...current,
          {
            id: VAULT_RESOURCE_ID,
            name: 'Vault',
            kind: 'vault' as const,
            providerId,
            createdAt: chosenAt,
            chosenAt,
          },
        ];
    await get().saveSettings({ gitosResources: resources, vaultMoveOffer: undefined });
    // A draft still stashed against the old home never replays onto the new
    // one, and never waits there unseen: it is held for the person.
    const left = await editVaultPending((p) => {
      const out: VaultPendingEntry[] = [];
      for (const [key, e] of Object.entries(p)) {
        if (e.providerId !== from || e.resourceId !== VAULT_RESOURCE_ID) continue;
        out.push(e);
        delete p[key];
      }
      return out;
    }).catch(() => [] as VaultPendingEntry[]);
    const reason =
      'Saved offline before the vault moved, so it was not replayed onto the new storage. Copy it into the note if you still need it.';
    for (const e of left) await holdVaultDraft(e, e.path, e.text, reason, { at: e.at });
    if (get().vaultScope === 'personal') set({ vaultFiles: there });
    logEvent('vault_moved', { to: providerId, forked: forked.length });
    return { ok: true, moved: notes.map((n) => n.path), skipped: [], forked };
  }

  function pendingEntry(
    t: VaultTargetRef,
    path: string,
    text: string,
    base: string | undefined,
    o: { sitting?: number; at?: string } = {},
  ): VaultPendingEntry {
    const { providerId, resourceId } = t;
    const owner = providerId === 'org' ? t.owner : undefined;
    const folder = providerId === 'files' ? get().vaultFolder : undefined;
    return {
      providerId,
      resourceId,
      ...(owner ? { owner } : {}),
      path,
      text,
      ...(base ? { base } : {}),
      at: o.at ?? nextStashAt(),
      ...(o.sitting !== undefined ? { sitting: o.sitting } : {}),
      ...(folder ? { folder: folder.dir, folderDisplay: folder.display } : {}),
    };
  }

  // A stash time on this device's clock, always later than the last, so an
  // entry written after a save began is always newer than that save's mark.
  let lastStashAt = 0;
  function nextStashAt(): string {
    lastStashAt = Math.max(Date.now(), lastStashAt + 1);
    return new Date(lastStashAt).toISOString();
  }

  // Whether a stash entry is a save's to settle: text stashed in the same
  // sitting of the note before the save began (the editor showed those
  // words, so the save supersedes them, data-1), never one written after it
  // began, and never an earlier sitting's, which no editor showed (E10).
  function ownsStash(
    e: VaultPendingEntry | undefined,
    sitting: number | undefined,
    mark: string | undefined,
  ): boolean {
    if (!e || sitting === undefined || e.sitting !== sitting) return false;
    return mark === undefined || e.at <= mark;
  }

  // Put text in the stash, the one entry a note keeps there, and never over
  // words it would lose (round 7 E10). An entry written after `mark` wins:
  // one of the same sitting was typed on top of this text, so this text is
  // superseded; one of another sitting keeps its place and this text goes
  // under Not saved. An older entry of another sitting, with other words, is
  // text no editor showed: it goes under Not saved before this takes its
  // place. Resolves to where this text is now.
  async function stashDraft(
    t: VaultTargetRef,
    path: string,
    text: string,
    base: string | undefined,
    o: { sitting?: number; mark?: string } = {},
  ): Promise<'stashed' | 'superseded' | 'held' | 'unsent'> {
    // Team text is stashed only for the account signed in now, or, after an
    // expiry, for that account's return. Text that settles after its account
    // left (a sign-out under way or done, another account in) is kept in
    // memory only, never sealed behind the wipe (E11).
    if (t.providerId === 'org' && !speaksNow(t) && !(t.owner && t.owner === keptTeamOwner)) {
      await keepUnsentTeamText(t, path, text, base, o.sitting);
      return 'unsent';
    }
    const key = vaultKey(t, path);
    const entry = pendingEntry(t, path, text, base, {
      sitting: o.sitting,
      at: o.mark ?? nextStashAt(),
    });
    const out = await editVaultPending((p) => {
      const e = p[key];
      const same = o.sitting !== undefined && e?.sitting === o.sitting;
      if (e && e.at > entry.at) {
        return same || e.text === text ? ('superseded' as const) : ('held' as const);
      }
      p[key] = entry;
      return e && !same && e.text !== text ? e : undefined;
    });
    if (out === 'superseded') return out;
    if (out === 'held') {
      await holdVaultDraft(t, path, text, VAULT_UNSEEN_DRAFT_REASON, { session: o.sitting });
      set({ vaultError: 'held' });
      return out;
    }
    if (out) {
      await holdVaultDraft(out, out.path, out.text, VAULT_UNSEEN_DRAFT_REASON, {
        at: out.at,
        session: `stash:${out.at}`,
      });
    }
    return 'stashed';
  }

  // Text stashed against the desktop folder while the vault used another one
  // (CTO F7.6): it never replays into the folder the vault uses now. It goes
  // under Not saved, naming the folder it was typed in. `all` also takes
  // entries stashed before they carried a folder, which is right at the
  // moment of a repoint, when every such entry belongs to the folder just left.
  async function holdOtherFolderDrafts(dir: string, all: boolean): Promise<void> {
    const other = await editVaultPending((p) => {
      const out: VaultPendingEntry[] = [];
      for (const [key, e] of Object.entries(p)) {
        if (e.providerId !== 'files') continue;
        if (e.folder === dir || (!all && e.folder === undefined)) continue;
        out.push(e);
        delete p[key];
      }
      return out;
    }).catch(() => [] as VaultPendingEntry[]);
    for (const e of other) {
      const display = e.folderDisplay ?? e.folder ?? 'the earlier folder';
      await holdVaultDraft(e, e.path, e.text, vaultEarlierFolderHeld(display).reason, {
        at: e.at,
        folder: e.folder,
        folderDisplay: display,
      });
    }
    if (other.length) set({ vaultError: 'held' });
  }

  // A write failed. A permanent refusal is held, since retrying cannot fix
  // it; anything else is stashed for replay; and when even the stash fails,
  // the text is held in memory with the error left standing, so it is never
  // lost quietly (data-7, orgvault-9). Team text whose account has signed out
  // meanwhile is never stashed for the next one (orgvault-15).
  async function rescueVaultDraft(
    t: VaultTarget,
    path: string,
    text: string,
    base: string | undefined,
    err: unknown,
    session?: number,
    /** When the save began (its mark), when it was a save (E10). */
    mark?: string,
    /** Held without a toast: this sitting already said why (E27). */
    opts: { quiet?: boolean } = {},
  ): Promise<void> {
    if (!speaksNow(t)) {
      await keepUnsentTeamText(t, path, text, base, session);
      return;
    }
    const key = vaultKey(t, path);
    const refusal = vaultRefusal(err);
    if (refusal) {
      // This text is newer than any draft stashed for the note before it
      // began, so that one must not replay under it. Words of their own (an
      // earlier sitting's) go under Not saved beside this, never away (round
      // 7 E7). One stashed after this save began is newer, and stays.
      const older = await editVaultPending((p) => {
        const e = p[key];
        if (e && mark !== undefined && e.at > mark) return undefined;
        delete p[key];
        return e;
      }).catch(() => undefined);
      if (older && older.text !== text) {
        await holdVaultDraft(older, older.path, older.text, asSentence(refusal), {
          at: older.at,
          session: `stash:${older.at}`,
        });
      }
      const landed = await holdVaultDraft(t, path, text, asSentence(refusal), { session });
      set({ vaultError: 'held' });
      markHeldHere(t, path, session);
      if ((err as { lapsed?: unknown }).lapsed === true) showTeamTextAfterLapse(t, path, text);
      if (!opts.quiet) get().showToast(`Not saved. ${asSentence(refusal)} ${heldLine(landed)}`);
      logEvent('vault_note_save_refused');
      return;
    }
    try {
      // Never over newer words, nor over words no editor showed (E10).
      const where = await stashDraft(t, path, text, base, { sitting: session, mark });
      if (where === 'unsent') return;
      if (where === 'held') {
        get().showToast(`Not saved. ${heldLine(true)}`);
        logEvent('vault_note_save_failed');
        return;
      }
    } catch {
      const reason = 'This device could not keep a copy to retry. Copy it somewhere safe.';
      await holdVaultDraft(t, path, text, reason, { session });
      set({ vaultError: 'held' });
      markHeldHere(t, path, session);
      get().showToast(
        'Could not save to your vault, and this device could not keep a copy to retry. Your text is under Not saved.',
      );
      logEvent('vault_note_stash_failed');
      return;
    }
    // Why it waits, said as it is: a deploy's window or a storage that did
    // not answer is never called the connection (E42).
    const wait = vaultWaitKind(err);
    set({ vaultError: 'save', vaultSaveWait: wait });
    get().showToast(vaultSaveWaitToast(wait));
    logEvent('vault_note_save_failed');
  }

  // The one place a provider write happens (Vault M1, CTO F4): every save,
  // replay, conflict copy, create, and move comes through here, and the guard
  // is required. A provider with compareAndSwap enforces it and answers a
  // conflict as a result; the others accept it and write (M2 adds their
  // check), so their M0 stat-before-write guards stay around the calls.
  // A write to a vault the caller names (a providerId) patches the list and
  // the body cache from its result (patchVaultFiles).
  // ---- Vault M5: seats, privacy, pins, handoffs, the hub (CTO J9, J12 to J15)

  /** The device store the handoffs live in (J13), sealed like the rest. */
  const handoffStorage = {
    get: (k: string) => storeGetJson<unknown>(k),
    set: (k: string, v: unknown) => storeSetJson(k, v),
    remove: (k: string) => storeDelete(k),
  };

  /** The personal vault, whatever scope is on screen (the team vault is
   *  never in context, D15). */
  /** Every note body in a vault, plus the paths that could not be read. */
  async function readAllNotes(target: VaultTarget): Promise<VaultReadAllResult> {
    const notes: Array<{ path: string; text: string }> = [];
    const failed: string[] = [];
    const files = await listVaultNotes(target);
    // Read only the files that changed since we last saw them. Backlinks
    // re-run this on every note open, so without a cache a 300-note Drive
    // vault was 300+ serial reads per open (R-8). The cache key carries the
    // provider and resource, and the read is skipped when the file's
    // version (versionOf) matches. One unreadable file is reported in `failed` and
    // never costs the rest (data-16).
    for (const f of files) {
      const key = vaultKey(target, f.path);
      const cached = vaultBodyCache.get(key);
      if (cached && cached.version === versionOf(f)) {
        notes.push({ path: f.path, text: cached.text });
        continue;
      }
      try {
        const note = await target.provider.read(target.resourceId, f.path);
        if (!note) {
          failed.push(f.path);
          continue;
        }
        vaultBodyCache.set(key, { version: versionOf(note), text: note.text });
        notes.push({ path: note.path, text: note.text });
      } catch {
        failed.push(f.path);
      }
    }
    return Object.assign(notes, { failed });
  }

  function personalVault(): VaultTarget | undefined {
    const providerId = vaultProviderId(get().settings);
    const provider = providerFor(providerId);
    return provider ? { provider, providerId, resourceId: VAULT_RESOURCE_ID } : undefined;
  }

  /** The personal vault's settings as last read (Vault M7), or undefined
   *  before the first read. Sync, for the tools' agent folder and the
   *  pack's skip list. */
  function personalSettings(): ResolvedVaultSettings | undefined {
    const t = personalVault();
    return t ? cachedVaultSettings(foldersKey(t)) : undefined;
  }

  /** The personal vault's settings now, through the loader's cache. */
  async function personalSettingsNow(): Promise<ResolvedVaultSettings | undefined> {
    const t = personalVault();
    if (!t) return undefined;
    try {
      return await loadVaultSettings(t.provider, t.resourceId, foldersKey(t));
    } catch {
      return undefined;
    }
  }

  /** The vault moved, was repointed or picked, the pairing changed or the
   *  account signed out (CTO L6): every vault's settings are read again, and
   *  the one on screen shows none until they are. */
  function forgetVaultSettings(): void {
    clearVaultTodayCache();
    privacyCache = undefined;
    if (get().vaultSettings) set({ vaultSettings: undefined });
  }

  /** The seat a source answers from, as the composer and a switch size it
   *  (CTO J2, J4), judged by `packSeatFor` so the pill, the pack and the
   *  excerpt never disagree. Fails closed: a seat that cannot be judged
   *  leaves the network. A Stack is as private as its least private seat and
   *  as roomy as its smallest, since any of them may answer. */
  function composerSeatFor(
    source: ConversationSource | undefined,
    opts: { anchorOnly?: boolean } = {},
  ): ComposerSeat {
    const s = get().settings;
    const closed: ComposerSeat = { servedTokens: 8192, device: false, leavesNetwork: true };
    const device: ComposerSeat = {
      servedTokens: DEVICE_CONTEXT_TOKENS,
      device: true,
      leavesNetwork: false,
    };
    const ctx = seatContext();
    const judge = (ref: StackModelRef): ComposerSeat => {
      try {
        const seat = packSeatFor(ref, ctx);
        if (!seat) return ref.kind === 'device' ? device : closed;
        return {
          servedTokens: seat.servedTokens,
          device: ref.kind === 'device',
          leavesNetwork: seat.leavesNetwork,
        };
      } catch {
        return ref.kind === 'device' ? device : closed;
      }
    };
    switch (source?.kind) {
      case 'device':
        return judge({ kind: 'device', modelId: source.modelId, modelName: source.modelName });
      case 'cloud':
        return judge({
          kind: 'cloud',
          provider: source.provider,
          model: source.model,
          label: source.model,
        });
      case 'desktop-chat':
        // The daemon pins /chat to a local orchestrator (J2); its window is
        // the computer's, which the app cannot see, so size it modestly.
        return { servedTokens: 8192, device: false, leavesNetwork: false };
      case 'stack': {
        const profile = effectiveProfile(autoProfile(get().connectivity), s.profileOverride);
        const stack = stackForProfile(s.stacks, profile);
        // A switch seeds the history the reasoning anchor reads (a pocket
        // specialist fits its own turns), so it sizes by the anchor alone.
        const members = opts.anchorOnly ? [] : stack.active.map((a) => a.ref);
        const refs = [stack.reasoning, ...members].filter((r): r is StackModelRef => Boolean(r));
        if (!refs.length) return closed;
        const seats = refs.map(judge);
        return {
          servedTokens: Math.min(...seats.map((x) => x.servedTokens)),
          device: seats.every((x) => x.device),
          leavesNetwork: seats.some((x) => x.leavesNetwork),
        };
      }
      default:
        // The computer's agent picks its own seat; the phone cannot judge it.
        return closed;
    }
  }

  /** Where this device's vault privacy rules come from (J3): the desktop's
   *  own machine config through the bridge; on a paired phone the computer
   *  (the hub link's `GET /vault/privacy`, its last answer kept sealed per
   *  hub); on an unpaired phone the device setting alone. The device setting
   *  only ever narrows. */
  function privacyDeps(): Parameters<typeof appVaultPrivacy>[0] {
    const st = get().settings;
    const device = st.vaultPrivacy ? { device: st.vaultPrivacy } : {};
    const b = isDesktop() ? bridge() : undefined;
    if (b?.vaultPrivacy && !st.preferRemoteHub) {
      return { bridge: { vaultPrivacy: () => b.vaultPrivacy() }, ...device };
    }
    const daemon = st.daemon;
    if (daemon?.token) {
      const link = hubVaultLink();
      const hub =
        link && link.target.owner?.startsWith(`${daemon.baseUrl.replace(/\/+$/, '')}#`)
          ? { fetchPrivacy: () => link.fetchPrivacy() }
          : hubPrivacySource({ baseUrl: daemon.baseUrl, token: daemon.token });
      return { hub, cache: hubPrivacyCache(daemon.baseUrl), ...device };
    }
    return device;
  }

  /** The D5 defaults with the device's own narrowing: the rules when no
   *  source answers (fail closed, never no rules). */
  function fallbackPrivacy(): VaultPrivacy {
    return compileVaultPrivacy(
      {
        exclude: [...VAULT_PRIVACY_DEFAULTS.exclude],
        localOnly: {
          paths: [...VAULT_PRIVACY_DEFAULTS.localOnly.paths],
          tags: [...VAULT_PRIVACY_DEFAULTS.localOnly.tags],
        },
      },
      // The vault's own file narrows too (L4): its last read, kept.
      unionNarrowing(get().settings.vaultPrivacy, personalSettings()?.narrowing),
    );
  }

  /** How long a privacy source may take before the kept or default rules
   *  stand in, so a computer that does not answer never holds a send. */
  const PRIVACY_WAIT_MS = 2000;

  /** This device's vault privacy judge (J3), cached briefly. Fail closed:
   *  while it loads, or when it cannot, the D5 defaults with the device's
   *  own narrowing apply, never no rules. */
  let privacyCache: { at: number; stamp: string; privacy: VaultPrivacy } | undefined;
  async function vaultPrivacyNow(): Promise<VaultPrivacy> {
    // The vault's own file's version is part of the key (CTO L6): a new
    // narrowing compiles the rules again.
    const stamp = vaultNarrowingStamp(personalSettings());
    if (privacyCache && privacyCache.stamp === stamp && Date.now() - privacyCache.at < 60_000) {
      return privacyCache.privacy;
    }
    let privacy: VaultPrivacy;
    let settings: ResolvedVaultSettings | undefined;
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      privacy = await Promise.race([
        (async () => {
          settings = await personalSettingsNow();
          return appVaultPrivacy({
            ...privacyDeps(),
            ...(settings ? { vault: settings.narrowing } : {}),
          });
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('slow')), PRIVACY_WAIT_MS);
        }),
      ]).finally(() => clearTimeout(timer));
    } catch {
      return fallbackPrivacy();
    }
    privacyCache = { at: Date.now(), stamp: vaultNarrowingStamp(settings), privacy };
    return privacy;
  }

  /** What is known about the personal vault's notes: the warm index when it
   *  is the personal vault's, else a listing. Undefined when neither reads. */
  async function personalNoteFacts(): Promise<VaultNoteFacts[] | undefined> {
    const t = personalVault();
    if (!t) return undefined;
    const host = currentVaultIndex();
    if (host && host.target.providerId === t.providerId && host.index.size > 0) {
      return host.index.entries().map((e) => ({
        path: e.path,
        title: e.title,
        updatedAt: e.updatedAt,
        tags: e.tags,
        ...(e.oscode ? { oscode: e.oscode } : {}),
      }));
    }
    try {
      return (await listVaultNotes(t)).map((f) => ({
        path: f.path,
        title: noteTitle(f.path),
        updatedAt: f.updatedAt,
      }));
    } catch {
      return undefined;
    }
  }

  /** Point every project's pins at a note's new path (a rename). */
  async function rewriteVaultPins(from: string, to: string): Promise<void> {
    const projects = get().settings.projects ?? [];
    if (!projects.some((p) => p.vaultPins?.includes(from))) return;
    await get().saveSettings({
      projects: projects.map((p) =>
        p.vaultPins?.includes(from)
          ? { ...p, vaultPins: [...new Set(p.vaultPins.map((x) => (x === from ? to : x)))] }
          : p,
      ),
    });
  }

  /** A chat of four or more turns that is left writes the project's handoff
   *  (J13), once per state of the chat. Memory off writes none. */
  const handoffWrittenAt = new Map<string, string>();
  function writeLeftHandoff(id: string): void {
    const conv = get().conversations[id];
    if (!conv?.projectId || conv.thread.busy || conv.source.kind === 'mock') return;
    if (memoryOverride(get().settings) === false) return;
    if (handoffWrittenAt.get(id) === conv.updatedAt) return;
    if (spokenTurns(conv.thread.items) < HANDOFF_MIN_TURNS) return;
    const model = conv.thread.model?.name ?? sourceLabel(conv.source);
    let text: string;
    let turns: number;
    try {
      ({ text, turns } = wholeHandoff(conv.thread.items, { from: model, date: localDate() }));
    } catch {
      return;
    }
    handoffWrittenAt.set(id, conv.updatedAt);
    void writeHandoff(handoffStorage, conv.projectId, {
      text,
      at: new Date().toISOString(),
      model,
      turns,
      conversationId: id,
    }).catch(() => {});
  }
  api.subscribe((state, prev) => {
    if (prev.activeId && prev.activeId !== state.activeId) writeLeftHandoff(prev.activeId);
  });

  /** Whether any stashed or held text belongs to the vault on `providerId`. */
  async function vaultTextWaiting(providerId: StorageProviderId): Promise<boolean> {
    const mine = (e: { providerId: string; resourceId: string }) =>
      e.providerId === providerId && e.resourceId === VAULT_RESOURCE_ID;
    if (get().vaultHeld.some(mine)) return true;
    return editVaultPending((p) => Object.values(p).some(mine)).catch(() => true);
  }

  /** The personal resource row with a new provider, keeping the rest. */
  function withVaultProvider(
    providerId: StorageProviderId,
    chosenAt: string | undefined,
  ): GitosResource[] {
    const current = get().settings.gitosResources ?? [];
    const row = (r: GitosResource): GitosResource => {
      const { chosenAt: _old, ...rest } = r;
      return { ...rest, providerId, ...(chosenAt ? { chosenAt } : {}) };
    };
    return current.some((r) => r.id === VAULT_RESOURCE_ID)
      ? current.map((r) => (r.id === VAULT_RESOURCE_ID ? row(r) : r))
      : [
          ...current,
          {
            id: VAULT_RESOURCE_ID,
            name: 'Vault',
            kind: 'vault' as const,
            providerId,
            createdAt: new Date().toISOString(),
            ...(chosenAt ? { chosenAt } : {}),
          },
        ];
  }

  // What the Vault room holds of the vault on screen: its list, the open
  // note, its folders, its Trash and the folder the list goes back to. A
  // scope switch and each end of a sign-in clear all of it the same way, so
  // nothing of one vault, or of one account's team vault, stays on screen
  // under another (round 7 E12).
  function clearedVaultRoom() {
    return {
      vaultNote: undefined,
      vaultFiles: [] as StoredFileMeta[],
      vaultListed: false,
      vaultTrash: undefined,
      vaultFolders: undefined,
      vaultReturnFolder: undefined,
    };
  }

  /** The vault on screen now points somewhere else: its warm index, list and
   *  open note belonged to the old home (J1 closes the index here, on a
   *  storage change or a pairing change, never on leaving the room). */
  async function afterVaultRepoint(): Promise<void> {
    await shutVaultIndex().catch(() => {});
    forgetVaultSettings();
    if (get().vaultScope === 'personal') {
      if (get().vaultNote) {
        await leaveVaultConflict();
        vaultLiveDraft = undefined;
      }
      set({ vaultNote: undefined, vaultListed: false, vaultFiles: [] });
    }
    set({ vaultTrash: undefined, vaultFolders: undefined });
    // Recent belonged to the old home (K9).
    const rings = get().settings.vaultRecent;
    if (rings && Object.keys(rings).some((k) => k.endsWith(`::${VAULT_RESOURCE_ID}`))) {
      const kept = Object.fromEntries(
        Object.entries(rings).filter(([k]) => !k.endsWith(`::${VAULT_RESOURCE_ID}`)),
      );
      await get()
        .saveSettings({ vaultRecent: Object.keys(kept).length ? kept : undefined })
        .catch(() => {});
    }
  }

  /** The J9 rule after a pairing (D2): an empty vault on This device by
   *  default points at the computer with one toast; one with notes gets the
   *  one-time move card; a storage the person chose is never repointed. The
   *  phone's rule: a desktop keeps its own folder. */
  async function hubPairingStep(): Promise<HubPairPlan> {
    const s = get();
    const hub = s.settings.daemon?.baseUrl;
    if (!hub || isDesktop()) return 'stay';
    const resource = s.settings.gitosResources?.find((r) => r.id === VAULT_RESOURCE_ID);
    const hubReady = Boolean(providerFor('hub')) && (await probeReady('hub').catch(() => false));
    // Not ready yet (the link lands a beat after the pairing): nothing moves
    // now, and the link's arrival runs this again (syncHubLink).
    if (!hubReady) {
      pairingWaitsForLink = true;
      return 'stay';
    }
    pairingWaitsForLink = false;
    let notes: number | undefined;
    if ((resource?.providerId ?? 'local') === 'local' && !resource?.chosenAt) {
      const local = providerFor('local');
      notes = local
        ? await listVaultNotes({
            provider: local,
            providerId: 'local',
            resourceId: VAULT_RESOURCE_ID,
          })
            .then((f) => f.length)
            .catch(() => undefined)
        : undefined;
    }
    const waiting = notes === 0 ? await vaultTextWaiting('local') : false;
    const offer = s.settings.vaultHubOffer;
    const plan = hubPairPlan(resource, notes, {
      waiting,
      declined: offer?.hub === hub && offer.state === 'declined',
    });
    if (plan === 'repoint') {
      const before: VaultBeforeHub = {
        providerId: resource?.providerId ?? 'local',
        ...(resource?.chosenAt ? { chosenAt: resource.chosenAt } : {}),
        hub,
      };
      await get().saveSettings({
        gitosResources: withVaultProvider('hub', undefined),
        vaultBeforeHub: before,
        vaultHubOffer: undefined,
      });
      await afterVaultRepoint();
      logEvent('vault_repointed_hub');
      get().showToast(HUB_REPOINT_TOAST);
      if (get().view === 'vault') void get().vaultRefresh();
    } else if (plan === 'offer-move') {
      if (offer?.hub !== hub || offer.state !== 'offered') {
        await get().saveSettings({ vaultHubOffer: { hub, state: 'offered' } });
      }
    }
    return plan;
  }

  /** Unpairing, or pairing another computer: a vault that points at a hub
   *  that is no longer the paired one returns to where it was before, and
   *  nothing moves back (J9). */
  async function hubUnpairStep(): Promise<void> {
    const s = get().settings;
    const before = s.vaultBeforeHub;
    const offer = s.vaultHubOffer;
    const paired = s.daemon?.baseUrl;
    if (offer && offer.hub !== paired) await get().saveSettings({ vaultHubOffer: undefined });
    if (vaultProviderId(get().settings) !== 'hub') {
      if (before && before.hub !== paired) await get().saveSettings({ vaultBeforeHub: undefined });
      return;
    }
    if (before && before.hub === paired) return;
    const row = get().settings.gitosResources?.find((r) => r.id === VAULT_RESOURCE_ID);
    const back = hubUnpairTarget(row, before?.providerId) ?? 'local';
    await get().saveSettings({
      gitosResources: withVaultProvider(back, before?.chosenAt),
      vaultBeforeHub: undefined,
    });
    await afterVaultRepoint();
    logEvent('vault_unpaired_hub');
    get().showToast(HUB_UNPAIR_TOAST);
    if (get().view === 'vault') void get().vaultRefresh();
  }

  /** The pairing the hub vault is linked to now (base URL and credential),
   *  so a relink happens only when the pairing changes. */
  let hubLinkKey: string | undefined;
  /** A pairing found the hub vault not linked yet; the link's arrival runs
   *  the pairing rule once (CTO J9). */
  let pairingWaitsForLink = false;

  /** Point the hub vault at the paired computer, or at none (CTO J9). Called
   *  whenever `settings.daemon` changes, on load, and on sign-out. A pairing
   *  change (another computer, another credential, or none) closes every
   *  index, the warm one too (J1), and forgets what the old link kept on this
   *  device. Resolves true when the link changed. */
  async function syncHubLink(
    daemon: DaemonTarget | undefined,
    opts: { forget?: boolean; initial?: boolean } = {},
  ): Promise<boolean> {
    const key = daemon?.token ? `${daemon.baseUrl}\n${daemon.token}` : undefined;
    if (key === hubLinkKey && !opts.forget) return false;
    hubLinkKey = key;
    const prev = hubVaultLink();
    // The first link at launch changes nothing that is open; every later
    // change (a pairing, another computer, an unpairing) does.
    if (!opts.initial) {
      await prev?.forget().catch(() => {});
      await shutVaultIndex().catch(() => {});
      forgetVaultSettings();
      forgetVaultContext();
    }
    if (!daemon || !key) {
      setHubVaultLink(undefined);
      return true;
    }
    let hubUserId: string;
    try {
      hubUserId = await hubPersonKey(daemon.token);
    } catch {
      setHubVaultLink(undefined);
      return true;
    }
    // A newer pairing landed while this one was hashed: it links itself.
    if (hubLinkKey !== key) return false;
    const baseUrl = daemon.baseUrl;
    setHubVaultLink({
      baseUrl,
      hubUserId,
      isServer: () => get().settings.daemon?.kind === 'server',
      token: async () => {
        const now = get().settings.daemon;
        return now?.baseUrl === baseUrl ? now.token : undefined;
      },
    });
    if (pairingWaitsForLink) {
      pairingWaitsForLink = false;
      void get().vaultAfterPairing();
    }
    return true;
  }

  /** Unpair first, then pair: one pass per hub change, never throwing. */
  async function settleVaultForHub(): Promise<void> {
    try {
      await hubUnpairStep();
      await hubPairingStep();
    } catch {
      // A vault that cannot be settled now stays where it is.
    }
  }

  async function putVaultNote(
    t: {
      provider: StorageProvider;
      resourceId: string;
      providerId?: StorageProviderId;
      owner?: string;
    },
    path: string,
    text: string,
    guard: WriteGuard,
  ): Promise<WriteResult> {
    const r = await t.provider.write(t.resourceId, path, text, guard);
    // A team write that lands after its account left: the next sign-in's
    // list and body cache never take it (they were cleared for that one).
    if (t.providerId === 'org' && t.owner !== get().authSession?.user.id) return r;
    if (r.ok && t.providerId) {
      const { providerId, resourceId, owner } = t;
      patchVaultFiles(owner ? { providerId, resourceId, owner } : { providerId, resourceId }, {
        saved: r.file,
      });
    }
    return r;
  }

  // After a write or a remove, the file list of the vault on screen is
  // patched from the result instead of re-listed (Vault M2 2.1): one round
  // trip fewer on every save, and a list a slow provider has not caught up
  // with never hides the note just written. The body cache takes the text
  // under its new version. This device's own write names no editor (G6).
  function patchVaultFiles(
    t: VaultTargetRef,
    change: { saved: StoredFile } | { removed: string },
  ): void {
    const key = vaultKey(t, 'saved' in change ? change.saved.path : change.removed);
    if ('saved' in change) {
      vaultBodyCache.set(key, { version: versionOf(change.saved), text: change.saved.text });
    } else {
      vaultBodyCache.delete(key);
    }
    if (!isActiveVault(t)) return;
    // The index takes the text already in hand, so nothing is read (M3 3.2).
    const index = vaultIndexOf(t);
    if ('removed' in change) index?.applyRemove(change.removed);
    else if (isNotePath(change.saved.path)) index?.applyWrite(change.saved);
    const files = get().vaultFiles;
    if ('removed' in change) {
      if (files.some((f) => f.path === change.removed)) {
        set({ vaultFiles: files.filter((f) => f.path !== change.removed) });
      }
      return;
    }
    const f = change.saved;
    if (!isNotePath(f.path)) return;
    const meta: StoredFileMeta = {
      path: f.path,
      updatedAt: f.updatedAt,
      size: new TextEncoder().encode(f.text).length,
      ...(f.version !== undefined ? { version: f.version } : {}),
    };
    const at = files.findIndex((x) => x.path === f.path);
    set({
      vaultFiles:
        at === -1
          ? [...files, meta].sort((a, b) => a.path.localeCompare(b.path))
          : files.map((x, i) => (i === at ? meta : x)),
    });
  }
  // The guard for text typed against a version: replace only that version,
  // or, when the storage never held the note, create it only while nothing
  // has the name.
  const guardFor = (base: string | undefined): WriteGuard =>
    base ? { ifMatch: base } : { ifAbsent: true };
  // A write that must land: a conflict from a provider that does not enforce
  // the guard cannot happen, and one that does is handled before this.
  function mustLand(r: WriteResult): StoredFile {
    if (r.ok) return r.file;
    throw new Error(
      r.conflict === 'downloading'
        ? 'Still downloading this note from your vault storage.'
        : 'The note changed while it was being saved.',
    );
  }

  // ---- Vault M6: the operations' call sites (state/vaultOps.ts) ------------
  // The store builds one VaultOpsDeps per operation, fixed to the vault the
  // operation started on (the 0.7 rule), and vaultOps does the work. Every
  // write goes through putVaultNote; every rename, restore or folder result
  // is adopted by the path the storage answered with, never the one asked for
  // (the desktop matches parents to their spelling on disk).

  /** The Vault screen's autosave while the room is mounted. */
  let vaultAutosaveHandle: VaultAutosave<VaultTargetRef> | undefined;

  const refOf = (t: VaultTargetRef): VaultTargetRef =>
    t.owner
      ? { providerId: t.providerId, resourceId: t.resourceId, owner: t.owner }
      : { providerId: t.providerId, resourceId: t.resourceId };

  /** What the Vault may offer on a storage now (CTO K1). Read-only covers a
   *  lease held elsewhere, Drive, an expired team sign-in, a move in flight
   *  and a folder that is gone; Your computer's reach counts only for it. */
  function capsOf(t: VaultTarget): VaultCaps {
    const st = get();
    const active = isActiveVault(t);
    const readOnly =
      Boolean(vaultReadOnlyReason(t.providerId)) ||
      (active &&
        (Boolean(st.vaultLeaseHeldByOther) ||
          Boolean(st.vaultMoving) ||
          (t.providerId === 'org' && Boolean(st.vaultTeamExpired)) ||
          (t.providerId === 'org' && st.vaultTeamPlan?.entitled === false) ||
          (t.providerId === 'files' && st.vaultFolder?.exists === false)));
    // The vault's Delete choice (L11): For good turns Trash off here.
    // Never on a storage that does not carry Delete out (the team vault,
    // whose deletes stay in its Trash): vaultCaps reads the provider's
    // `unappliedSettings`, and the team provider never reads the key back.
    const settings = cachedVaultSettings(foldersKey(t));
    return vaultCaps(
      t.provider,
      {
        readOnly,
        ...(t.providerId === 'hub' ? { reach: hubReach() } : {}),
        // Only an admin saves a team's settings (CX Y14); before the first
        // read, the account's own role says.
        ...(t.providerId === 'org'
          ? { settingsAdmin: st.vaultTeamPlan?.isAdmin ?? isOrgAdmin(st.settings.account) }
          : {}),
      },
      settings ? { delete: settings.delete } : undefined,
    );
  }

  /** A note's text in one vault, through the body cache. The open note's
   *  version is the newest this device knows of it, so a body cached for an
   *  older version never stands in for it (E2). */
  async function readBodyOf(t: VaultTarget, path: string): Promise<string | undefined> {
    const key = vaultKey(t, path);
    const active = isActiveVault(t);
    const listed = active ? get().vaultFiles.find((f) => f.path === path) : undefined;
    const open = active ? get().vaultNote : undefined;
    const known = (open?.path === path && versionOf(open)) || (listed && versionOf(listed));
    const cached = vaultBodyCache.get(key);
    if (cached && known && cached.version === known) return cached.text;
    const note = await t.provider.read(t.resourceId, path);
    if (!note) return undefined;
    vaultBodyCache.set(key, { version: versionOf(note), text: note.text });
    return note.text;
  }

  /** Write the open note's pending text now and wait for it, with the
   *  debounce timer cancelled, so nothing typed lands after the operation
   *  (a stale save recreating a trashed note). */
  async function flushOpenSave(t: VaultTargetRef): Promise<void> {
    const pending = vaultAutosaveHandle?.take();
    if (pending) await get().vaultSave(pending.path, pending.text, pending.at);
    if (!isActiveVault(t)) return;
    const open = get().vaultNote;
    const chain = open ? vaultSaveChains.get(vaultKey(t, open.path)) : undefined;
    if (chain) await chain;
  }

  /** The note on screen as an operation sees it. */
  function openNoteOf(t: VaultTargetRef): VaultOpsOpenNote | undefined {
    if (!isActiveVault(t)) return undefined;
    const open = get().vaultNote;
    if (!open) return undefined;
    return {
      path: open.path,
      version: vaultBaseOf(t, open.path) ?? '',
      dirty:
        Boolean(vaultAutosaveHandle?.isPending()) || vaultSaveChains.has(vaultKey(t, open.path)),
      choiceOpen: get().vaultConflict?.path === open.path,
    };
  }

  /** A rename landed: the list, the body cache and the index move with it,
   *  at the path and version the storage answered with. */
  function patchVaultRename(t: VaultTargetRef, from: string, to: StoredFileMeta): void {
    const oldKey = vaultKey(t, from);
    const cached = vaultBodyCache.get(oldKey);
    vaultBodyCache.delete(oldKey);
    if (cached && to.version) {
      vaultBodyCache.set(vaultKey(t, to.path), { version: to.version, text: cached.text });
    }
    if (!isActiveVault(t)) return;
    vaultIndexOf(t)?.applyRename(from, to);
    if (!isNotePath(to.path)) return;
    const files = get().vaultFiles.filter((f) => f.path !== from && f.path !== to.path);
    const meta: StoredFileMeta = {
      path: to.path,
      updatedAt: to.updatedAt,
      size: to.size || (cached ? new TextEncoder().encode(cached.text).length : 0),
      ...(to.version ? { version: to.version } : {}),
    };
    set({ vaultFiles: [...files, meta].sort((a, b) => a.path.localeCompare(b.path)) });
  }

  /** Everything this device keys by a note's path follows a rename: project
   *  pins, the stash, and the open note (at the version the storage gave).
   *  A pin names a personal note only (the pack reads personalVault()), so
   *  only a personal rename moves one: a team note of the same name is
   *  another note (round 7 E15). */
  async function rekeyVaultPath(
    t: VaultTargetRef,
    from: string,
    to: string,
    opts: { keepVersion?: boolean; rebase?: VaultRekeyRebase } = {},
  ): Promise<void> {
    if (t.providerId === vaultProviderId(get().settings) && t.resourceId === VAULT_RESOURCE_ID) {
      await rewriteVaultPins(from, to).catch(() => {});
    }
    await editVaultRecent(t, (ring) => renameVaultRecent(ring, from, to)).catch(() => {});
    // A draft stashed on exactly the version this device's rename carried is
    // based on that note where it is now, so its replay lands there, never as
    // a conflict copy over a change nobody made (round 7 E40). One typed on
    // an older version keeps its base, and still keeps both.
    const rebase = opts.rebase;
    await editVaultPending((p) => {
      const e = p[vaultKey(t, from)];
      if (!e) return;
      delete p[vaultKey(t, from)];
      const rebased = rebase?.version !== undefined && e.base === rebase.guard;
      p[vaultKey(t, to)] = { ...e, path: to, ...(rebased ? { base: rebase.version } : {}) };
    }).catch(() => {});
    await rekeyVaultHeld(t, from, to);
    if (!isActiveVault(t)) return;
    const open = get().vaultNote;
    if (open?.path === from) {
      // Following another writer's rename keeps the version this device
      // typed on: the listing's is theirs, and adopting it would let the
      // next save land over theirs unasked (E16).
      const listed = opts.keepVersion ? undefined : get().vaultFiles.find((f) => f.path === to);
      if (vaultLiveDraft?.path === from) vaultLiveDraft = { ...vaultLiveDraft, path: to };
      set({
        vaultNote: {
          ...open,
          path: to,
          ...(listed?.version ? { version: listed.version } : {}),
          ...(listed ? { updatedAt: listed.updatedAt } : {}),
        },
      });
    }
  }

  // Text held under Not saved for a note follows the note to its new name,
  // so the note it was typed in still shows it (round 7 E31). Every account's
  // entry moves, since the name changed for everyone and nothing is shown to
  // anyone new; text from an earlier desktop folder is another note and
  // stays. Each keeps an id of its own at the new name, so a later hold
  // there never replaces it, and a memory-only entry stays out of the
  // sealed store (editVaultHeld keeps only durable ones there).
  async function rekeyVaultHeld(t: VaultTargetRef, from: string, to: string): Promise<void> {
    await loadVaultHeld();
    const moves = (h: VaultHeldDraft) =>
      h.providerId === t.providerId &&
      h.resourceId === t.resourceId &&
      h.path === from &&
      h.folder === undefined;
    if (!get().vaultHeld.some(moves)) return;
    const was = vaultKey(t, from);
    const now = vaultKey(t, to);
    const rekey = (list: VaultHeldDraft[]) => {
      const ids = new Set(list.filter((h) => !moves(h)).map((h) => h.id));
      return list.map((h) => {
        if (!moves(h)) return h;
        let id = h.id.startsWith(was) ? `${now}${h.id.slice(was.length)}` : `${now}::${h.id}`;
        for (let n = 2; ids.has(id); n++) id = `${id.replace(/::moved-\d+$/, '')}::moved-${n}`;
        ids.add(id);
        return { ...h, id, path: to };
      });
    };
    await editVaultHeld(rekey).catch(() => false);
  }

  // The storage answered with the note at another spelling of the same name
  // (the team vault matches a name by letter case, 0021): a teammate renamed
  // it by case only, or a new note met its twin. It is one name, so the open
  // note, its typed text, its stash and Recent follow it there, and the next
  // write is guarded at that spelling, never at one the storage no longer
  // has (a 'missing' and 'changed' loop). The version this device typed on
  // stays the base: theirs is shown, never adopted (round 7 E16). Resolves
  // to the path the note is at now.
  async function followCaseRename(
    t: VaultTargetRef,
    from: string,
    theirs: StoredFile | undefined,
  ): Promise<string> {
    if (!theirs || theirs.path === from) return from;
    if (theirs.path.toLowerCase() !== from.toLowerCase()) return from;
    await rekeyVaultPath(t, from, theirs.path, { keepVersion: true });
    return theirs.path;
  }

  /** The one VaultOpsDeps for an operation on vault `t`. */
  function opsDeps(t: VaultTarget): VaultOpsDeps {
    return {
      target: refOf(t),
      provider: t.provider,
      index: () => vaultIndexOf(t),
      putVaultNote: async (path, text, guard) => {
        const r = await putVaultNote(t, path, text, guard);
        // The open note written by an operation (a link rewrite, a tick)
        // shows the text and version that landed, unless its editor holds
        // words the note does not (a save held or kept for later): those
        // stay on screen, and its next save meets this version as a choice,
        // never over it (E30).
        const open = isActiveVault(t) ? get().vaultNote : undefined;
        if (r.ok && open?.path === r.file.path && (draftOf(open.path) ?? open.text) === open.text) {
          reloadOpenNote(r.file, 'resolve');
        }
        return r;
      },
      readBody: (path) => readBodyOf(t, path),
      patch: {
        saved: (file) => patchVaultFiles(t, { saved: file }),
        removed: (path) => patchVaultFiles(t, { removed: path }),
        renamed: (from, to) => patchVaultRename(t, from, to),
      },
      rekey: (from, to, rebase) => rekeyVaultPath(t, from, to, rebase ? { rebase } : {}),
      flushOpenSave: () => flushOpenSave(t),
      openNote: () => openNoteOf(t),
    };
  }

  /** A note this device deleted is gone from everything it keyed here: its
   *  stash (so no replay resurrects it) and the editor. */
  async function afterNoteGone(t: VaultTargetRef, path: string): Promise<void> {
    await editVaultPending((p) => {
      delete p[vaultKey(t, path)];
    }).catch(() => {});
    await editVaultRecent(t, (ring) => dropVaultRecent(ring, path)).catch(() => {});
    if (!isActiveVault(t)) return;
    if (get().vaultNote?.path === path) {
      vaultLiveDraft = undefined;
      set({ vaultNote: undefined, vaultReturnFolder: noteFolder(path) });
    }
  }

  /** List the vault on screen again after an operation that moved more than
   *  it could patch (a restored folder), and let the index reconcile. */
  async function relistActive(t: VaultTarget): Promise<void> {
    if (!isActiveVault(t)) return;
    const listing = await listVaultNotes(t).catch(() => undefined);
    if (!listing || !isActiveVault(t)) return;
    if ((await teamListHolds(t, listing)) !== 'ok' || !isActiveVault(t)) return;
    set({ vaultFiles: listing });
    void vaultIndexOf(t)?.reconcile(listing);
  }

  /** Trash of the vault on screen, for the tree's row (a storage with a real
   *  Trash only). A failed read leaves the last one. */
  async function refreshVaultTrash(t: VaultTarget): Promise<TrashEntry[] | undefined> {
    if (!capsOf(t).trash) {
      if (isActiveVault(t)) set({ vaultTrash: undefined });
      return undefined;
    }
    const r = await opsListTrash(opsDeps(t));
    if (!r.ok) return undefined;
    if (isActiveVault(t)) set({ vaultTrash: r.entries });
    return r.entries;
  }

  /** The key a vault's cached settings and Today sit under. */
  const foldersKey = (t: VaultTargetRef) => `${t.providerId}::${t.resourceId}`;
  /** The key what this device remembers of a vault for the person sits
   *  under (its empty folders, its Recent ring): the team vault's names the
   *  account too, so one member's folder names and activity never show to
   *  another on a shared device (round 7 E13). */
  const memoryKey = (t: VaultTargetRef) =>
    t.providerId === 'org' ? `${foldersKey(t)}::${t.owner ?? ''}` : foldersKey(t);
  /** Drop what this device remembers of team vaults (empty folders, Recent)
   *  for every account but `keep`: a sign-out drops all of it, an expiry and
   *  a sign-in keep only that account's. A key from before it named an
   *  account belongs to nobody, so it goes too. */
  async function forgetTeamMemory(keep?: string): Promise<void> {
    const s = get().settings;
    const others = (k: string) => k.startsWith('org::') && (!keep || k.split('::')[2] !== keep);
    const trim = <V>(rec: Record<string, V> | undefined) => {
      if (!rec || !Object.keys(rec).some(others)) return undefined;
      const kept = Object.fromEntries(Object.entries(rec).filter(([k]) => !others(k)));
      return { value: Object.keys(kept).length ? kept : undefined };
    };
    const folders = trim(s.vaultEmptyFolders);
    const recent = trim(s.vaultRecent);
    if (!folders && !recent) return;
    await get()
      .saveSettings({
        ...(folders ? { vaultEmptyFolders: folders.value } : {}),
        ...(recent ? { vaultRecent: recent.value } : {}),
      })
      .catch(() => {});
  }

  /** Rewrite one vault's remembered empty folders. */
  async function editEmptyFolders(
    t: VaultTargetRef,
    edit: (list: string[]) => string[],
  ): Promise<void> {
    const all = get().settings.vaultEmptyFolders ?? {};
    const key = memoryKey(t);
    const before = all[key] ?? [];
    const after = [...new Set(edit(before))].sort();
    if (JSON.stringify(after) === JSON.stringify(before)) return;
    const next = { ...all };
    if (after.length) next[key] = after;
    else delete next[key];
    await get().saveSettings({ vaultEmptyFolders: next });
  }

  /** Folders beyond what the notes imply: the storage's real ones (empty
   *  ones too) and this device's remembered ones, a remembered folder
   *  forgotten once a note lands in it (K5). */
  async function refreshVaultFolders(t: VaultTarget): Promise<void> {
    let real: string[] = [];
    if (t.provider.listFolders) {
      real = await t.provider.listFolders(t.resourceId).catch(() => []);
    }
    const notes = isActiveVault(t) ? get().vaultFiles.map((f) => foldPath(f.path)) : [];
    const holds = (folder: string) => notes.some((p) => p.startsWith(`${foldPath(folder)}/`));
    await editEmptyFolders(t, (list) => list.filter((f) => !holds(f))).catch(() => {});
    const kept = get().settings.vaultEmptyFolders?.[memoryKey(t)] ?? [];
    if (isActiveVault(t)) set({ vaultFolders: [...new Set([...real, ...kept])].sort() });
  }

  /** A folder moved or went to Trash: its remembered empty folders follow. */
  async function moveEmptyFolders(t: VaultTarget, from: string, to?: string): Promise<void> {
    const f = foldPath(from);
    await editEmptyFolders(t, (list) =>
      list.flatMap((p) => {
        const fp = foldPath(p);
        if (fp !== f && !fp.startsWith(`${f}/`)) return [p];
        return to === undefined ? [] : [`${to}${p.slice(from.length)}`];
      }),
    ).catch(() => {});
  }

  /** Edit one vault's Recent ring (6.1, K9). */
  async function editVaultRecent(
    t: VaultTargetRef,
    edit: (ring: VaultRecentEntry[]) => VaultRecentEntry[],
  ): Promise<void> {
    const all = get().settings.vaultRecent ?? {};
    const key = memoryKey(t);
    const before = all[key] ?? [];
    const after = edit(before);
    if (JSON.stringify(after) === JSON.stringify(before)) return;
    const next = { ...all };
    if (after.length) next[key] = after;
    else delete next[key];
    await get().saveSettings({ vaultRecent: next });
  }
  /** A note opened or saved here goes to the top of Recent; a save of the
   *  note already on top writes nothing. */
  function noteVaultRecent(t: VaultTargetRef, path: string): void {
    const ring = get().settings.vaultRecent?.[memoryKey(t)] ?? [];
    if (ring[0]?.path === path) return;
    void editVaultRecent(t, (r) => pushVaultRecent(r, path, new Date().toISOString())).catch(
      () => {},
    );
  }

  // A replay found its note moved or deleted since the text was typed (E9).
  class VaultNoteGone extends Error {}

  // The keep-both name for a copy of `path` in vault `t`: the team vault
  // takes a path of at most 512 characters (0015), so there the note's own
  // name is shortened to fit, its folder and the conflict suffix kept
  // (round 7 E43).
  function conflictCopyPathIn(t: VaultTargetRef, path: string, when: Date, n = 1): string {
    const copy = vaultConflictCopyPath(path, when, n);
    return t.providerId === 'org' ? fitMadeName(copy, TEAM_PATH_MAX) : copy;
  }

  // Put text beside a note as a keep-both copy under the first free conflict
  // name ("Note (conflict 2026-09-27 1405).md", then " 2", " 3"), never over
  // anything: a guarded provider refuses a taken name itself (ifAbsent), the
  // others are asked first. Returns the copy's path, or undefined when no
  // name was free after 20 tries.
  async function writeConflictCopy(
    t: VaultTarget,
    path: string,
    text: string,
    when: Date,
    first = conflictCopyPathIn(t, path, when),
  ): Promise<string | undefined> {
    for (let n = 1; n <= 20; n++) {
      const copy = n === 1 ? first : conflictCopyPathIn(t, path, when, n);
      if (!t.provider.compareAndSwap && (await t.provider.stat(t.resourceId, copy))) continue;
      let r: WriteResult;
      try {
        r = await putVaultNote(t, copy, text, { ifAbsent: true });
      } catch (err) {
        // A copy name that is a team note in Trash is passed over (E22).
        if ((err as { nameInTrash?: unknown } | undefined)?.nameInTrash === true) continue;
        throw err;
      }
      if (r.ok) return r.file.path;
      if (r.conflict !== 'exists') mustLand(r);
    }
    return undefined;
  }

  // Put one stashed draft back, never over newer work. It returns to its own
  // path only while the provider still holds the version it was typed
  // against, or no file at all. When the note changed elsewhere since, both
  // are kept: the draft lands beside it as a conflict copy (its path is
  // returned), and a body that already matches is simply done. A guarded
  // provider checks the version itself as it writes (compare-and-swap); the
  // others are asked first, as in M0. On a guarded provider a note moved or
  // deleted since the text was typed throws VaultNoteGone: it is held, never
  // made again, since nobody chose that write (round 7 E9).
  async function replayVaultDraft(
    t: VaultTarget,
    e: VaultPendingEntry,
  ): Promise<string | undefined> {
    let current: StoredFile | undefined;
    if (t.provider.compareAndSwap) {
      // A draft with no base is a note made offline: its write is a create.
      const r = await putVaultNote(t, e.path, e.text, guardFor(e.base));
      if (!r.ok && r.conflict === 'missing') throw new VaultNoteGone();
      if (r.ok) {
        await adoptReplayed(t, e, r.file);
        return undefined;
      }
      if (r.conflict === 'downloading') mustLand(r);
      current = r.theirs;
    } else {
      const now = await t.provider.stat(t.resourceId, e.path);
      let unchanged = e.base !== undefined && now !== undefined && versionOf(now) === e.base;
      if (now?.evicted) unchanged = false;
      if (unchanged && t.providerId === 'org') {
        // A team vault from before compare-and-swap compares revs it learns
        // from a read, and after a relaunch it has forgotten them, so read the
        // note first (which teaches it the rev) and still write only while it
        // is the same version. The store keeps no rev of its own (CTO G3).
        current = await t.provider.read(t.resourceId, e.path);
        unchanged = current !== undefined && versionOf(current) === e.base;
      }
      if (!now || unchanged) {
        const saved = mustLand(await putVaultNote(t, e.path, e.text, guardFor(e.base)));
        await adoptReplayed(t, e, saved);
        return undefined;
      }
      current ??= now.evicted ? undefined : await t.provider.read(t.resourceId, e.path);
    }
    // An offline create nobody typed into is satisfied by the note existing.
    if (e.base === undefined && e.text === '') return undefined;
    if (current?.text === e.text) return undefined;
    const copy = await writeConflictCopy(t, e.path, e.text, new Date());
    if (!copy) throw new Error('No free name for the conflict copy.');
    return copy;
  }

  // A replayed draft that landed on the note open now is what that note last
  // saved as. When the editor already shows those words (a Retry from the
  // save chip with the typed text on screen), the open note takes their text
  // and version quietly, so the next keystroke saves against it. A clean
  // editor showing an older read takes the words in place; one typed into
  // since is asked, its text stashed, so no keystroke ever saves over the
  // replayed words unseen (E8).
  async function adoptReplayed(
    t: VaultTargetRef,
    e: VaultPendingEntry,
    saved: StoredFile,
  ): Promise<void> {
    const open = get().vaultNote;
    if (!isActiveVault(t) || open?.path !== e.path) return;
    const draft = draftOf(e.path) ?? open.text;
    if (draft !== saved.text) {
      if (draft === open.text) {
        reloadOpenNote(saved, 'resolve');
        return;
      }
      if (get().vaultConflict?.path === e.path) return;
      const base = versionOf(open) || undefined;
      raiseVaultConflict(t, e.path, 'changed', saved, base);
      await stashConflictText(t, e.path, draft, base);
      return;
    }
    set({
      vaultNote: {
        ...open,
        text: saved.text,
        updatedAt: saved.updatedAt,
        version: saved.version,
        fresh: undefined,
        editedBy: undefined,
      },
    });
  }

  // Replay the drafts stashed against this provider and resource, and for the
  // team vault only those typed under the account signed in now. A refused
  // one is held instead (retrying cannot fix it), and so is one whose note
  // was moved or deleted elsewhere (E9); a read-only vault holds them all,
  // and anything still failing stays for the next attempt. Never throws: a
  // replay is always a side trip after a success.
  async function replayVaultPending(t: VaultTarget): Promise<void> {
    // While another device holds the enforced lease, nothing replays into
    // its notes; the stash waits for the lease to come back (CTO G5).
    if (leaseBlocks(t)) return;
    // A team replay runs only for the account signed in now, and only its
    // own drafts (R-19).
    if (!speaksNow(t)) return;
    const folderNow = t.providerId === 'files' ? get().vaultFolder?.dir : undefined;
    if (folderNow) await holdOtherFolderDrafts(folderNow, false);
    let mine: VaultPendingEntry[];
    try {
      // A note with a choice open is the person's to settle: its stashed
      // text never replays under them (CX 1.1).
      const open = get().vaultConflict;
      mine = await editVaultPending((p) =>
        Object.values(p).filter(
          (e) =>
            e.providerId === t.providerId &&
            e.resourceId === t.resourceId &&
            speaksNow(e) &&
            (t.providerId !== 'org' || e.owner === t.owner) &&
            !(
              open &&
              open.path === e.path &&
              open.target.providerId === e.providerId &&
              open.target.resourceId === e.resourceId
            ),
        ),
      );
    } catch {
      return;
    }
    if (!mine.length) return;
    const readOnly = vaultReadOnlyReason(t.providerId);
    const settled: VaultPendingEntry[] = [];
    const copies: string[] = [];
    const gone: string[] = [];
    let held = 0;
    let unkept = 0;
    for (const e of mine) {
      // Its account signed out, expired, or gave way to another while the
      // replay ran: the rest waits, sealed for that account (an expiry) or
      // already wiped (a sign-out), and nothing more is sent (R-19).
      if (!speaksNow(e)) break;
      let refusal = readOnly;
      if (!refusal) {
        try {
          // An open of this note waits for it (E8, settledWrites).
          const replay = replayVaultDraft(t, e);
          const key = vaultKey(e, e.path);
          const replayed = replay.then(
            () => undefined,
            () => undefined,
          );
          vaultReplays.set(key, replayed);
          void replayed.then(() => {
            if (vaultReplays.get(key) === replayed) vaultReplays.delete(key);
          });
          const copy = await replay;
          if (copy) copies.push(copy);
          settled.push(e);
          continue;
        } catch (err) {
          if (!speaksNow(e)) break;
          if (err instanceof VaultNoteGone) {
            refusal = VAULT_GONE_REASON;
            gone.push(e.path);
          } else refusal = vaultRefusal(err);
          // Anything else is still failing; keep it for the next attempt.
          if (!refusal) continue;
        }
      }
      const kept = await holdVaultDraft(e, e.path, e.text, asSentence(refusal), {
        at: e.at,
        session: `stash:${e.at}`,
      });
      if (!kept) unkept++;
      settled.push(e);
      held++;
    }
    if (settled.length) {
      await editVaultPending((p) => {
        for (const e of settled) {
          const key = vaultKey(e, e.path);
          // A newer draft stashed for the same note while this ran stays.
          if (p[key]?.at === e.at && p[key]?.text === e.text) delete p[key];
        }
      }).catch(() => {});
    }
    if (copies.length) {
      get().showToast(vaultReplayCopiesLine(copies));
      logEvent('vault_draft_kept_both', { count: copies.length });
    }
    if (held && gone.length === held) {
      // Every one held is text for a note moved or deleted elsewhere (E9).
      set({ vaultError: 'held' });
      get().showToast(
        `${gone.length === 1 ? vaultGoneToast(noteTitle(gone[0]!)) : vaultGoneManyLine(gone.length)} ${heldLine(!unkept)}`,
      );
    } else if (held) {
      set({ vaultError: 'held' });
      const one = held === 1;
      const lead = one
        ? 'An offline edit could not be saved, so it is'
        : `${held} offline edits could not be saved, so they are`;
      get().showToast(
        unkept
          ? `${lead} under Not saved only until the app closes. Copy ${one ? 'it' : 'them'} somewhere safe now.`
          : `${lead} kept under Not saved.`,
      );
    }
  }

  // The lease (Vault M2 2.5, CTO G5; lib/vaultLease.ts). Held only while the
  // person types: taken on the first keystroke after a quiet spell, renewed
  // at most every VAULT_LEASE_RENEW_MS, expiring VAULT_LEASE_TTL_MS after the
  // last renewal, released on leaving the note or the Vault. Advisory on a
  // storage with compare-and-swap (only iCloud keeps a lease file), enforced
  // only on one without it.
  let leaseHeld: { key: string; provider: StorageProvider; resourceId: string } | undefined;
  let leaseTried: { key: string; at: number } | undefined;
  // The other device's holder id while it holds an enforced lease, so Take
  // over editing can release it through the seam.
  let leaseOtherHolder: string | undefined;
  const leaseKeyOf = (t: VaultTargetRef) => `${t.providerId}::${t.resourceId}`;
  const deviceHolder = () => get().settings.deviceId ?? 'dev_unknown';
  function leaseModeOf(t: VaultTarget): VaultLeaseMode {
    // A vault that takes no writes keeps no lease (a Drive vault, D1; team
    // text of an account not signed in now).
    const writable = !vaultReadOnlyReason(t.providerId) && speaksNow(t);
    return vaultLeaseMode(t.provider, writable);
  }
  // Take or renew the lease on a vault, and record what it says: 'mine',
  // 'other' (another device holds it live), or 'none' (this storage keeps no
  // lease, or it did not answer, which never blocks editing).
  async function takeVaultLease(t: VaultTarget): Promise<'mine' | 'other' | 'none'> {
    const mode = leaseModeOf(t);
    const key = leaseKeyOf(t);
    if (mode === 'none') {
      if (isActiveVault(t)) set({ vaultLeaseHeldByOther: false, vaultLeaseOther: undefined });
      return 'none';
    }
    leaseTried = { key, at: Date.now() };
    const me = deviceHolder();
    const label = vaultDeviceKind(platform(), typeof navigator === 'undefined' ? {} : navigator);
    let lease: Lease;
    try {
      lease = await t.provider.acquireLease(t.resourceId, me, VAULT_LEASE_TTL_MS, label);
    } catch {
      return 'none';
    }
    if (!isActiveVault(t)) return 'none';
    const other = lease.holder !== me && new Date(lease.expiresAt).getTime() > Date.now();
    if (!other) {
      leaseHeld = { key, provider: t.provider, resourceId: t.resourceId };
      leaseOtherHolder = undefined;
      set({ vaultLeaseHeldByOther: false, vaultLeaseOther: undefined });
      return 'mine';
    }
    // Another device holds it. On an enforced lease this device was editing
    // until now (it held the lease), so it was displaced: it writes nothing
    // more to the note, and what it types waits in its stash.
    const displaced = mode === 'enforced' && leaseHeld?.key === key;
    if (leaseHeld?.key === key) leaseHeld = undefined;
    leaseOtherHolder = mode === 'enforced' ? lease.holder : undefined;
    set({
      vaultLeaseHeldByOther: mode === 'enforced',
      vaultLeaseOther: { mode, ...(lease.label ? { label: lease.label } : {}) },
    });
    if (displaced) {
      get().showToast(vaultLeaseEnforced(lease.label).displaced);
      logEvent('vault_lease_displaced');
    }
    return 'other';
  }
  // Whether the enforced lease keeps this vault from writing now: another
  // device holds it, as last seen. Only the vault on screen is tracked.
  function leaseBlocks(t: VaultTargetRef): boolean {
    return isActiveVault(t) && Boolean(get().vaultLeaseHeldByOther);
  }
  // Before a create or a delete on an enforced lease, ask again (taking it
  // when free, since this device is about to write): true when refused, with
  // the toast already shown.
  async function leaseRefuses(t: VaultTarget): Promise<boolean> {
    if (leaseModeOf(t) !== 'enforced') return false;
    if ((await takeVaultLease(t)) !== 'other') return false;
    get().showToast(vaultLeaseEnforced(get().vaultLeaseOther?.label).refused);
    logEvent('vault_lease_refused');
    return true;
  }

  // The version of a note an edit is typed against: the open note's provider
  // version (versionOf: its opaque version, else its updatedAt), or none while
  // the provider does not hold the note yet. A save is guarded with it, and a
  // stashed draft carries it so its replay can tell whether the note changed
  // elsewhere since (data-1, Vault M1 F1).
  function vaultBaseOf(t: VaultTargetRef, path: string): string | undefined {
    const open = get().vaultNote;
    if (!isActiveVault(t) || open?.path !== path) return undefined;
    return versionOf(open) || undefined;
  }

  // Saves run one at a time per note (provider, resource, and path), each
  // after the one before it has settled, and each reads its base when it
  // runs. So an older save that lands late can never clear a newer save's
  // stash, and a save typed on top of an earlier one is stashed against the
  // version that one left, never against the one before it (which would make
  // this device's own edit look like a change from elsewhere). Each link
  // resolves to the version the note is at when it is done, as far as this
  // device knows, for the next link when the note has closed meanwhile.
  const vaultSaveChains = new Map<string, Promise<string | undefined>>();
  // How many vaultSave calls are running, for the save chip (vaultSaving).
  let vaultSavesInFlight = 0;
  // Stashed drafts being replayed now, by note, so an open of one waits for
  // its replay to land (E8).
  const vaultReplays = new Map<string, Promise<undefined>>();
  // Every vaultOpen, vaultCloseNote and scope change takes the next number,
  // so an open that waited knows a later tap came after it (E3).
  let vaultOpenSeq = 0;
  // Wait, a bounded while, for this device's writes to a note that are on
  // their way (its save chain, a replay of its stash), so an open reads what
  // they wrote (E3, E8).
  async function settledWrites(t: VaultTargetRef, path: string): Promise<void> {
    const key = vaultKey(t, path);
    const waits = [vaultSaveChains.get(key), vaultReplays.get(key)].filter((w) => w !== undefined);
    if (!waits.length) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(waits).catch(() => undefined),
      new Promise((resolve) => (timer = setTimeout(resolve, VAULT_OPEN_WAIT_MS))),
    ]);
    if (timer) clearTimeout(timer);
  }

  // Run one step as the next link of a note's save chain, so it never sees
  // this device's own save half done (a re-check, a resolve choice).
  async function inSaveChain<T>(
    t: VaultTargetRef,
    path: string,
    step: () => Promise<T>,
  ): Promise<T> {
    const key = vaultKey(t, path);
    const before = vaultSaveChains.get(key);
    const run = (async () => {
      const carried = before ? await before : undefined;
      const out = await step();
      return { out, version: vaultBaseOf(t, path) ?? carried };
    })();
    const link = run.then(
      (r) => r.version,
      () => undefined,
    );
    vaultSaveChains.set(key, link);
    try {
      return (await run).out;
    } finally {
      if (vaultSaveChains.get(key) === link) vaultSaveChains.delete(key);
    }
  }

  // The open note took a version from a read: the body cache holds its text
  // at that version, so nothing pairs an older body with it (E2).
  function cacheOpenBody(file: StoredFile): void {
    const t = vaultTarget();
    const version = versionOf(file);
    if (t && version) vaultBodyCache.set(vaultKey(t, file.path), { version, text: file.text });
  }

  // When the open note's text was read or reloaded: Date.now(), but always
  // later than the last, so two sittings of one note never share one (E7).
  let lastLoadedAt = 0;
  function nextLoadedAt(): number {
    lastLoadedAt = Math.max(Date.now(), lastLoadedAt + 1);
    return lastLoadedAt;
  }

  // The editor's live text for the open note (vaultNoteDraft), so a re-check
  // can tell a clean draft from a dirty one. Not state: nothing renders it.
  let vaultLiveDraft: { path: string; text: string } | undefined;
  function draftOf(path: string): string | undefined {
    if (vaultLiveDraft?.path === path) return vaultLiveDraft.text;
    const open = get().vaultNote;
    return open?.path === path ? open.text : undefined;
  }

  // The plan lapsed under the open note (OV402): the room turns read-only
  // and shows every note as the team holds it, so once the refused words are
  // held under Not saved the editor lets go of them and shows the note's own
  // text, and a later poll never asks about them (round 7 E28). Only when
  // they are the editor's latest: a newer keystroke's save is still on its
  // way, and its own refusal holds it first. A refusal that leaves the note
  // editable (the free space) keeps the words on screen.
  function showTeamTextAfterLapse(t: VaultTargetRef, path: string, text: string): void {
    const open = isActiveVault(t) ? get().vaultNote : undefined;
    if (!open || open.path !== path) return;
    const draft = draftOf(path);
    if (draft === undefined || (draft !== text && restoreEol(open.text, draft) !== text)) return;
    reloadOpenNote(
      {
        path,
        text: open.text,
        updatedAt: open.updatedAt,
        ...(open.version ? { version: open.version } : {}),
      },
      'resolve',
      open.editedBy,
    );
  }

  // Replace the open note's text in place, keeping it open: a calm reload of
  // a clean note, or a resolve choice that shows the other version. The
  // editor takes the new text when `reloaded` moves.
  function reloadOpenNote(
    file: StoredFile,
    from: 'elsewhere' | 'resolve',
    editedBy?: { id: string; label?: string },
  ): void {
    const open = get().vaultNote;
    if (!open || open.path !== file.path) return;
    cacheOpenBody(file);
    vaultLiveDraft = { path: file.path, text: file.text };
    set({
      vaultNote: {
        ...open,
        text: file.text,
        updatedAt: file.updatedAt,
        version: file.version,
        editedBy,
        fresh: undefined,
        held: undefined,
        loadedAt: nextLoadedAt(),
        reloaded: (open.reloaded ?? 0) + 1,
        reloadedFrom: from,
      },
    });
  }

  // This account is no longer a member of the team (round 7 E26): an admin
  // removed it, or it left from another device, so 0002's is_org_member
  // answers no. Every select then answers no rows and every call refuses,
  // which reads like an emptied vault, yet nothing there was deleted, so
  // nothing says so. The team vault goes the way it does at a sign-out (the
  // role this device knew is dropped, so the room stops offering it), the
  // words typed into its open note are kept under Not saved, and the room
  // says why, once. The next launch or sign-in reads the role again.
  async function teamMembershipEnded(resourceId: string): Promise<void> {
    const st = get();
    if (resourceId !== st.settings.account?.org?.serverId) return;
    set({ serverRole: undefined, vaultTeamPlan: undefined });
    if (st.vaultScope !== 'team' || st.vaultTeamExpired) return;
    const t = vaultTarget();
    if (!t || t.providerId !== 'org' || t.resourceId !== resourceId) return;
    stopVaultPoll();
    vaultOpenSeq++;
    const open = st.vaultNote;
    const draft = open ? draftOf(open.path) : undefined;
    const choice = st.vaultConflict?.target.providerId === 'org' ? st.vaultConflict : undefined;
    vaultLiveDraft = undefined;
    set({
      vaultScope: 'personal',
      vaultError: undefined,
      ...clearedVaultRoom(),
      ...(choice ? { vaultConflict: undefined } : {}),
    });
    let line = VAULT_TEAM_NOT_MEMBER;
    if (open && draft !== undefined && draft !== open.text) {
      const landed = await holdVaultDraft(t, open.path, draft, VAULT_TEAM_NOT_MEMBER_REASON, {
        session: open.loadedAt,
      });
      // Held for good: the stash of this sitting would only say it twice.
      if (landed) await dropOwnStash(t, open.path, open.loadedAt, undefined);
      line = `${line} ${heldLine(landed)}`;
    }
    get().showToast(line);
    logEvent('vault_team_not_member');
    await get().vaultRefresh();
  }
  // Whether the team still counts this account a member. Its selects answer
  // a removed member with no rows, never an error, so before a team note is
  // called gone, or a team list that had notes is taken as empty, the team is
  // asked once: a settings read, which refuses a non-member (E26). 'removed'
  // has already taken the room back (teamMembershipEnded); 'failed' did not
  // answer, so nothing is concluded.
  async function teamMembership(t: VaultTarget): Promise<'member' | 'removed' | 'failed'> {
    if (t.providerId !== 'org' || !t.provider.readConfig) return 'member';
    try {
      await t.provider.readConfig(t.resourceId, 'oscode/vault');
      return 'member';
    } catch (err) {
      return (err as { notMember?: unknown } | undefined)?.notMember === true
        ? 'removed'
        : 'failed';
    }
  }

  // Whether a team list may be taken as it came: one that had notes and now
  // reads none is asked about first (teamMembership, E26).
  async function teamListHolds(
    t: VaultTarget,
    files: StoredFileMeta[],
  ): Promise<'ok' | 'removed' | 'failed'> {
    if (t.providerId !== 'org' || files.length || !get().vaultFiles.length) return 'ok';
    const member = await teamMembership(t);
    return member === 'member' ? 'ok' : member;
  }

  // A note the list shows that the storage no longer holds (round 7 E24): a
  // teammate or another device deleted or renamed it since the list. The
  // team is asked first whether this account is still a member, since a
  // removed member reads no rows either (E26). The list is taken again, a
  // note at another spelling of the name (a case-only rename) opens at its
  // own, once, and otherwise the note is said gone, once. Nothing opens.
  let vaultOpenFollowing = false;
  async function vaultOpenGone(
    target: VaultTarget,
    path: string,
    seq: number,
    opts: { quietGone?: boolean },
  ): Promise<'opened' | 'gone' | undefined> {
    const member = await teamMembership(target);
    if (member === 'removed') return undefined;
    if (member === 'failed') {
      get().showToast('Could not open that note. Check your vault storage connection.');
      return undefined;
    }
    const listing = await listVaultNotes(target).catch(() => undefined);
    if (seq !== vaultOpenSeq || !isActiveVault(target)) return undefined;
    // Out of the list and the index at once, so a caller that goes on to
    // make it again (Today, New note) does not find it there.
    patchVaultFiles(target, { removed: path });
    if (listing) {
      set({ vaultFiles: listing });
      void vaultIndexOf(target)?.reconcile(listing);
    }
    const want = foldPath(path);
    const twin = listing?.find((f) => f.path !== path && foldPath(f.path) === want);
    if (twin && !vaultOpenFollowing) {
      vaultOpenFollowing = true;
      try {
        return await get().vaultOpen(twin.path, opts);
      } finally {
        vaultOpenFollowing = false;
      }
    }
    if (!opts.quietGone) get().showToast(vaultGoneToast(noteTitle(path)));
    logEvent('vault_note_gone', { dirty: false });
    return 'gone';
  }

  // This device's own renames and deletes on their way to the storage, and
  // a count of every one begun, so a look at the open note that overlaps one
  // says nothing about it (round 7 E35): the note is not there because this
  // device moved it, and the move itself brings the note along.
  let vaultOwnMoves = 0;
  let vaultOwnMoveGen = 0;
  async function asOwnMove<T>(run: () => Promise<T>): Promise<T> {
    vaultOwnMoves++;
    vaultOwnMoveGen++;
    try {
      return await run();
    } finally {
      vaultOwnMoves--;
    }
  }

  // CTO F3: look at the open note once. Same version: nothing. Gone: close a
  // clean note back to its folder, or ask about a dirty one. Changed: adopt
  // the version silently when the text is what this device loaded (a touch,
  // an identical rewrite) or what the person already typed; reload a clean
  // draft in place; ask about a dirty one. While a choice is open, a newer
  // other version updates it in place.
  async function recheckOpenNote(target: VaultTarget, path: string): Promise<VaultRecheckResult> {
    const open = get().vaultNote;
    if (!open || open.path !== path || !isActiveVault(target)) return 'skipped';
    // What it finds speaks only for the sitting it looked at, and never for
    // this device's own rename or delete on its way (round 7 E35): the note
    // closed and another opened, or the same note opened again, or a rename
    // that has already moved it on the storage while its answer is still on
    // the wire. Each is left alone; the next look sees it as it is.
    const moves = vaultOwnMoveGen;
    const sameSitting = () => {
      const now = get().vaultNote;
      return (
        isActiveVault(target) &&
        now?.path === path &&
        now.loadedAt === open.loadedAt &&
        vaultOwnMoves === 0 &&
        moves === vaultOwnMoveGen
      );
    };
    if (vaultOwnMoves > 0) return 'skipped';
    const base = vaultBaseOf(target, path);
    let meta: StoredFileMeta | undefined;
    try {
      meta = await target.provider.stat(target.resourceId, path);
    } catch {
      return 'failed'; // Not answering now; the next event, focus, or poll looks again.
    }
    if (!sameSitting()) return 'skipped';
    let conflict = get().vaultConflict;
    let pending = conflict?.path === path ? conflict : undefined;
    if (!meta && target.providerId === 'org' && (pending ? pending.kind !== 'missing' : base)) {
      // A removed member reads no rows too: ask before anything is called
      // gone (E26), and look again at what the wait left on screen.
      const member = await teamMembership(target);
      if (member !== 'member') return member === 'removed' ? 'checked' : 'failed';
      if (get().vaultNote !== open || !sameSitting()) return 'skipped';
      conflict = get().vaultConflict;
      pending = conflict?.path === path ? conflict : undefined;
    }
    if (!meta) {
      if (pending) {
        if (pending.kind !== 'missing') {
          set({ vaultConflict: { ...pending, kind: 'missing', theirs: undefined, again: true } });
        }
        return 'checked';
      }
      // A note this storage never held (an offline create) is not gone.
      if (!base) return 'checked';
      const draft = draftOf(path) ?? open.text;
      if (draft === open.text) {
        vaultLiveDraft = undefined;
        set({ vaultNote: undefined, vaultReturnFolder: noteFolder(path) });
        const listing = await listVaultNotes(target).catch(() => undefined);
        if (listing && isActiveVault(target)) set({ vaultFiles: listing });
        if (listing) void vaultIndexOf(target)?.reconcile(listing);
        get().showToast(vaultGoneToast(noteTitle(path)));
        logEvent('vault_note_gone', { dirty: false });
        return 'checked';
      }
      raiseVaultConflict(target, path, 'missing', undefined, base);
      await stashConflictText(target, path, draft, base);
      return 'checked';
    }
    const seen = pending?.theirs ? versionOf(pending.theirs) : base;
    if (seen && versionOf(meta) === seen) return 'checked';
    if (meta.evicted) return 'checked';
    // Who saved this version, when the storage says (the team vault, G6).
    const editedBy = meta.editedBy;
    let theirs: StoredFile | undefined;
    try {
      theirs = await target.provider.read(target.resourceId, path);
    } catch {
      return 'failed';
    }
    if (theirs) vaultIndexOf(target)?.noteRead(theirs);
    if (!sameSitting()) return 'skipped';
    if (!theirs) return 'checked';
    if (pending) {
      // Still undecided: the sheet shows this newest version, and says so.
      set({ vaultConflict: { ...pending, kind: 'changed', theirs, again: true } });
      return 'checked';
    }
    const now = get().vaultNote!;
    const draft = draftOf(path) ?? now.text;
    if (theirs.text === now.text || theirs.text === draft) {
      // Nothing to ask: the bytes are what this device loaded, or what the
      // person typed. Adopt the version (and a draft that matches reads clean).
      cacheOpenBody(theirs);
      set({
        vaultNote: {
          ...now,
          text: theirs.text,
          updatedAt: theirs.updatedAt,
          version: theirs.version,
          editedBy,
        },
      });
      return 'checked';
    }
    if (draft === now.text) {
      reloadOpenNote(theirs, 'elsewhere', editedBy);
      logEvent('vault_note_reloaded');
      return 'checked';
    }
    raiseVaultConflict(target, path, 'changed', theirs, base);
    await stashConflictText(target, path, draft, base);
    return 'checked';
  }

  // An operation on a note (a tick, Mark reviewed, linking a mention) found
  // nothing there: its read came back empty, or its guarded write answered
  // `missing` (round 7 E34). That can also be a note still downloading, or
  // one this storage never held (an offline create), so nothing is called
  // gone on that alone. The open note is looked at again in its save chain,
  // which closes a clean one with the gone line, or asks about a dirty one
  // with its words kept; any other note is asked about once (a stat, and for
  // the team, whether this account is still a member, E26) and the list is
  // taken again. 'said': the room has said it (the gone line, the missing
  // choice, or the end of the membership). 'gone': nothing said yet, the
  // caller says it. 'not': not known to be gone, so a retry may help.
  async function noteGoneHere(t: VaultTarget, path: string): Promise<'gone' | 'said' | 'not'> {
    const open = isActiveVault(t) ? get().vaultNote : undefined;
    if (open?.path === path) {
      const r = await inSaveChain(t, path, () => recheckOpenNote(t, path)).catch(
        () => 'failed' as const,
      );
      if (r !== 'checked') return 'not';
      if (!isActiveVault(t)) return 'said';
      const choice = get().vaultConflict;
      if (choice?.path === path && choice.kind === 'missing') return 'said';
      return get().vaultNote?.path === path ? 'not' : 'said';
    }
    let meta: StoredFileMeta | undefined;
    try {
      meta = await t.provider.stat(t.resourceId, path);
    } catch {
      return 'not';
    }
    if (meta) return 'not';
    const member = await teamMembership(t);
    if (member !== 'member') return member === 'removed' ? 'said' : 'not';
    await relistActive(t).catch(() => undefined);
    return 'gone';
  }

  // The team vault's live refresh (Vault M2 2.7, CTO G6; lib/vaultPoll.ts):
  // one timer, and only while the team vault is on screen with a note open,
  // the page is visible, and the device is online. Hidden, there is no
  // timer at all; the screen starts it again, checking at once, on return.
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let pollActive = false;
  let pollFailures = 0;
  // 'run' checks now; 'wait' (offline) waits a normal round and looks again
  // without a request; 'stop' ends the poll until the screen starts it.
  function pollGate(): 'run' | 'wait' | 'stop' {
    const st = get();
    if (st.vaultScope !== 'team' || !st.vaultNote || st.vaultTeamExpired) return 'stop';
    if (!st.teamVaultAvailable()) return 'stop';
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return 'stop';
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'wait';
    return 'run';
  }
  function schedulePoll(delayMs: number): void {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => void pollTick(), delayMs);
  }
  function stopVaultPoll(): void {
    pollActive = false;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = undefined;
  }
  async function pollTick(): Promise<void> {
    pollTimer = undefined;
    const gate = pollGate();
    if (gate === 'stop') {
      stopVaultPoll();
      return;
    }
    let result: VaultRecheckResult = 'skipped';
    if (gate === 'run') {
      try {
        result = await get().vaultRecheck({ reason: 'poll' });
      } catch {
        result = 'failed';
      }
    }
    // Back off on errors, 30 s up to 300 s; reset on a check that answered.
    if (result === 'failed') pollFailures++;
    else if (result === 'checked') pollFailures = 0;
    if (pollActive && !pollTimer) schedulePoll(vaultPollDelayMs(pollFailures));
  }

  // Re-list the tree, coalesced, when the watcher saw a change it cannot
  // name, a note the list does not have, or the window came back.
  let relistTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleRelist(): void {
    if (relistTimer) clearTimeout(relistTimer);
    relistTimer = setTimeout(() => {
      relistTimer = undefined;
      void get().vaultRefresh();
    }, 250);
  }

  // Settle a choice still open on the note being left, the lossless way: a
  // changed note keeps both (the text as the conflict copy named when it was
  // found), a gone note's text goes under Not saved. Clears the conflict at
  // once, so the leaving itself is never blocked; the write follows.
  async function leaveVaultConflict(): Promise<void> {
    const c = get().vaultConflict;
    if (!c) return;
    const text = draftOf(c.path) ?? c.base;
    const open = get().vaultNote;
    const session = open?.path === c.path ? open.loadedAt : undefined;
    set({ vaultConflict: undefined });
    // Team text is written only under the account that typed it, to the
    // team vault on screen; any other choice is dropped unsettled, with
    // nothing sent and nothing said (R-19).
    if (!teamChoiceSpeaks(c)) return;
    const target = vaultTargetFrom(c.target);
    const title = noteTitle(c.path);
    logEvent('vault_conflict_choice', { choice: 'left', kind: c.kind });
    if (!target) return;
    if (c.kind === 'missing') {
      await holdVaultDraft(c.target, c.path, text, VAULT_GONE_REASON, { session });
      await dropStash(c.target, c.path);
      set({ vaultError: 'held' });
      get().showToast(vaultLeaveToast('missing', { title, copyTitle: title }));
      return;
    }
    let copy: string | undefined;
    try {
      copy = await writeConflictCopy(target, c.path, text, new Date(c.foundAt), c.copyPath);
    } catch (err) {
      // The stash still holds the text; the replay makes the same copy later.
      await rescueVaultDraft(target, c.path, text, c.baseVersion, err, session);
      return;
    }
    if (!copy) {
      await holdVaultDraft(c.target, c.path, text, VAULT_NO_COPY_NAME_REASON, { session });
      await dropStash(c.target, c.path);
      set({ vaultError: 'held' });
      return;
    }
    await dropStash(c.target, c.path);
    get().showToast(vaultLeaveToast('edit', { title, copyTitle: noteTitle(copy) }));
  }

  // Whether text is more bytes than the text it was typed on: what 0023
  // counts as growth (E27).
  const grows = (text: string, was: string) =>
    new TextEncoder().encode(text).length > new TextEncoder().encode(was).length;
  // A team save to hold here, unsent: the team is known to be full and this
  // save adds text to what it was typed on. Unknown ground is sent, and the
  // server says (E27).
  function teamFullHolds(t: VaultTargetRef, text: string, baseText: string | undefined): boolean {
    return (
      t.providerId === 'org' &&
      get().vaultTeamPlan?.full === true &&
      baseText !== undefined &&
      grows(text, baseText)
    );
  }
  // Hold a save the full team would refuse, under Not saved with the free
  // space's reason: the sitting's entry takes the newest text, and the toast
  // is said only when this sitting had none yet (E27).
  async function holdFullTeamSave(
    t: VaultTarget,
    path: string,
    text: string,
    base: string | undefined,
    session: number | undefined,
    mark: string | undefined,
  ): Promise<void> {
    const reason = asSentence(VAULT_TEAM_FULL);
    const said =
      session !== undefined &&
      get().vaultHeld.some(
        (h) =>
          h.providerId === t.providerId &&
          h.resourceId === t.resourceId &&
          h.path === path &&
          h.reason === reason &&
          h.id.endsWith(`::${session}`),
      );
    // As the server's own refusal is held (rescueVaultDraft), quietly when
    // this sitting has said it already.
    const refused = Object.assign(new Error(VAULT_TEAM_FULL), { permanent: true });
    await rescueVaultDraft(t, path, text, base, refused, session, mark, { quiet: said });
  }

  async function saveVaultNote(
    target: VaultTarget,
    path: string,
    text: string,
    base: string | undefined,
    opts: {
      /** The sitting the text was typed in: the open note's loadedAt when
       *  the save was asked for, if it was this note. */
      session?: number;
      /** The note's text at `base`, as this device read or saved it, when
       *  it knows (E4). */
      baseText?: string;
      /** When the save was asked for (nextStashAt): a stash entry written
       *  after it is newer than this text (E10). */
      mark?: string;
    } = {},
  ): Promise<string | undefined> {
    const { session, baseText, mark } = opts;
    const readOnly = vaultReadOnlyReason(target.providerId);
    if (readOnly) {
      // A read-only vault takes no write, but typed text is never dropped.
      const landed = await holdVaultDraft(target, path, text, readOnly, { session });
      set({ vaultError: 'held' });
      markHeldHere(target, path, session);
      get().showToast(`${readOnly} ${heldLine(landed)}`);
      return base;
    }
    // Team text is sent only under the account that typed it.
    if (!speaksNow(target)) {
      await keepUnsentTeamText(target, path, text, base, session);
      return base;
    }
    // The team's free space is used up (E27): a save that adds text is held
    // at once, never sent to be refused again, and said once per sitting.
    if (teamFullHolds(target, text, baseText)) {
      await holdFullTeamSave(target, path, text, base, session, mark);
      return base;
    }
    let result: WriteResult;
    try {
      result = await putVaultNote(target, path, text, guardFor(base));
      // The note moved on under this save, but only in its metadata (a touch,
      // a sync client rewriting the same bytes): theirs is the very text this
      // save was typed on, so adopt its version and save again, with nothing
      // to ask (F1). Compared with that text as it was when the save began,
      // never with whatever the note on screen holds when the answer comes
      // (a reopen, another account's note), which may be theirs (E4).
      // Bounded, so a busy writer cannot spin it.
      for (let tries = 0; tries < 3 && !result.ok && result.theirs; tries++) {
        const theirs = result.theirs;
        if (result.conflict !== 'changed' || baseText === undefined) break;
        if (theirs.text !== baseText) break;
        result = await putVaultNote(target, path, text, { ifMatch: versionOf(theirs) });
      }
      if (!result.ok && result.conflict === 'downloading') mustLand(result);
    } catch (err) {
      await rescueVaultDraft(target, path, text, base, err, session, mark);
      return base;
    }
    // Settling can write too (a keep-both copy of a note that closed while
    // this save was out), and that write can be refused for good (a team out
    // of free space, 0023) or fail: the text is held or stashed the same
    // way, never dropped with the rejection (round 5, finding 1).
    if (!result.ok) {
      // The account that typed it left while the write was out: nothing
      // more is sent, and the text is kept for that account alone (R-19).
      if (!speaksNow(target)) {
        await keepUnsentTeamText(target, path, text, base, session);
        return base;
      }
      try {
        return await settleSaveConflict(target, path, text, base, result, session, mark);
      } catch (err) {
        await rescueVaultDraft(target, path, text, base, err, session, mark);
        return base;
      }
    }
    if (!result.ok) return settleSaveConflict(target, path, text, base, result, session, mark);
    const saved = result.file;
    // Text was added and it landed: the team had room for it (E27).
    if (target.providerId === 'org' && (baseText === undefined || grows(text, baseText))) {
      clearOrgVaultFull(target.resourceId);
    }
    // This save supersedes any older draft stashed for the same note in the
    // same sitting, so drop it before the replay below: replaying it now
    // would put the older words back over these (data-1). A draft of an
    // earlier sitting no editor showed stays, and the replay below keeps it
    // beside these words; one stashed after this save began is newer (E10).
    await dropOwnStash(target, path, session, mark);
    // The list and the body cache were patched from the write's result
    // (putVaultNote), so nothing is re-listed here.
    const reopened = isActiveVault(target) && get().vaultNote?.path === path;
    if (reopened && get().vaultNote?.loadedAt !== session) {
      // The note was opened again after this save began, so the editor shows
      // that read, not these words (E3).
      await landOnReopened(target, path, saved);
      if (isActiveVault(target)) set({ vaultError: undefined });
    } else if (isActiveVault(target)) {
      set({
        vaultNote:
          get().vaultNote?.path === path
            ? {
                ...get().vaultNote!,
                path,
                text: saved.text,
                updatedAt: saved.updatedAt,
                version: saved.version,
                fresh: undefined,
                editedBy: undefined,
                held: false,
              }
            : get().vaultNote,
        vaultError: undefined,
      });
    }
    // A successful write means the provider is back; flush the backlog.
    await replayVaultPending(target);
    logEvent('vault_note_save');
    return versionOf(saved);
  }

  // A write this device sent landed on a note opened again (or reloaded)
  // after the save began, so the editor shows that read, not these words: a
  // clean editor takes them in place; one typed into since is asked, with
  // the typed text stashed against the version it was typed on (E3).
  async function landOnReopened(t: VaultTarget, path: string, file: StoredFile): Promise<void> {
    const open = get().vaultNote;
    if (!open || open.path !== path || !isActiveVault(t)) return;
    const draft = draftOf(path) ?? open.text;
    if (draft === open.text || draft === file.text) {
      reloadOpenNote(file, 'resolve');
      return;
    }
    if (get().vaultConflict?.path === path) return;
    const base = versionOf(open) || undefined;
    raiseVaultConflict(t, path, 'changed', file, base);
    await stashConflictText(t, path, draft, base);
  }

  // Stash text for a note while a choice about it is open, stamped with the
  // version it was typed against, so a crash or a quit loses nothing (the
  // next launch's replay turns it into a keep-both copy, or, when the note
  // is gone, holds it under Not saved). Never the note.
  async function stashConflictText(
    t: VaultTargetRef,
    path: string,
    text: string,
    base: string | undefined,
    mark?: string,
  ): Promise<void> {
    // The editor's text, of the sitting on screen when it is this note.
    const open = isActiveVault(t) ? get().vaultNote : undefined;
    const sitting = open?.path === path ? open.loadedAt : undefined;
    await stashDraft(t, path, text, base, { sitting, mark }).catch(() => {});
  }
  async function dropStash(t: VaultTargetRef, path: string): Promise<void> {
    await editVaultPending((p) => {
      delete p[vaultKey(t, path)];
    }).catch(() => {});
  }
  // A save settled its text (it landed, or went beside the note or under Not
  // saved): drop the stash entry it owns, never a newer one or an earlier
  // sitting's no editor showed, which replays on its own (E10).
  async function dropOwnStash(
    t: VaultTargetRef,
    path: string,
    sitting: number | undefined,
    mark: string | undefined,
  ): Promise<void> {
    await editVaultPending((p) => {
      const key = vaultKey(t, path);
      if (ownsStash(p[key], sitting, mark)) delete p[key];
    }).catch(() => {});
  }

  // Raise the choice for the open note: theirs is what is there now (or
  // nothing, when it is gone). The person's text goes to the stash, and the
  // screen opens the sheet at their next pause.
  function raiseVaultConflict(
    t: VaultTargetRef,
    path: string,
    kind: VaultConflict['kind'],
    theirs: StoredFile | undefined,
    baseVersion: string | undefined,
  ): void {
    const open = get().vaultNote;
    const now = Date.now();
    const { providerId, resourceId, owner } = t;
    set({
      vaultConflict: {
        path,
        target: owner ? { providerId, resourceId, owner } : { providerId, resourceId },
        kind,
        base: open?.path === path ? open.text : '',
        ...(baseVersion ? { baseVersion } : {}),
        ...(theirs ? { theirs } : {}),
        copyPath: conflictCopyPathIn(t, path, new Date(now)),
        foundAt: now,
        deferred: false,
      },
    });
    logEvent('vault_conflict_found', { kind });
  }

  // A guarded save that found the note moved on. The version this device
  // loaded or saved is not there any more, so nothing was written. When
  // theirs is exactly this text there is nothing to ask: adopt its version.
  // On the open note, the person chooses (the resolve sheet). On a note
  // that has closed meanwhile nobody is there to ask, so the lossless way
  // settles it: the text lands beside the note as a conflict copy, or, for a
  // note that is gone, under Not saved (never recreated, since nobody chose
  // that write).
  // A guarded delete that found the note is not the version this device
  // loaded: nothing was deleted, and the note stays. The open note takes the
  // M1 recheck path, so a clean one reloads the newer version in place and one
  // with unsaved edits (or one that is gone) raises the resolve sheet, the
  // same as a focus return would. A note that is still downloading is left as
  // it is. The toast says the delete did not happen, never that it did.
  async function settleStaleDelete(
    target: VaultTarget,
    path: string,
    result: Extract<RemoveResult, { ok: false }>,
    base: string | undefined,
  ): Promise<void> {
    const title = noteTitle(path);
    logEvent('vault_delete_stale', { conflict: result.conflict });
    if (result.conflict === 'downloading') {
      get().showToast(vaultStaleDeleteToast('downloading', title));
      return;
    }
    await recheckOpenNote(target, path);
    const open = get().vaultNote;
    const asking = get().vaultConflict?.path === path;
    const reloaded =
      !asking && isActiveVault(target) && open?.path === path && versionOf(open) !== base;
    if (isActiveVault(target) && !asking) {
      const listing = await listVaultNotes(target).catch(() => undefined);
      if (listing) set({ vaultFiles: listing });
      if (listing) void vaultIndexOf(target)?.reconcile(listing);
    }
    get().showToast(vaultStaleDeleteToast('changed', title, reloaded));
  }

  async function settleSaveConflict(
    target: VaultTarget,
    path: string,
    text: string,
    base: string | undefined,
    result: Extract<WriteResult, { ok: false }>,
    session?: number,
    mark?: string,
  ): Promise<string | undefined> {
    const theirs = result.theirs;
    const shown = isActiveVault(target) && get().vaultNote?.path === path;
    // Open, and still the sitting this text was typed in. A note opened again
    // after the save began is settled like a closed one: its editor shows
    // another read, so it is never asked about this text (E3).
    const isOpen = shown && get().vaultNote?.loadedAt === session;
    if (theirs && theirs.text === text) {
      await dropOwnStash(target, path, session, mark);
      if (shown && !isOpen) await landOnReopened(target, path, theirs);
      if (isOpen) {
        set({
          vaultNote: {
            ...get().vaultNote!,
            text: theirs.text,
            updatedAt: theirs.updatedAt,
            version: theirs.version,
            held: false,
          },
        });
      }
      return versionOf(theirs);
    }
    if (isOpen) {
      // Theirs under another spelling of this name: the note follows it (E16).
      const at = await followCaseRename(target, path, theirs);
      const open = get().vaultConflict;
      if (!open || (open.path !== path && open.path !== at)) {
        raiseVaultConflict(
          target,
          at,
          result.conflict === 'missing' ? 'missing' : 'changed',
          theirs,
          base,
        );
      }
      await stashConflictText(target, at, text, base, mark);
      return base;
    }
    if (result.conflict === 'missing' || !theirs) {
      await dropOwnStash(target, path, session, mark);
      const kept = await holdVaultDraft(target, path, text, VAULT_GONE_REASON, { session });
      set({ vaultError: 'held' });
      get().showToast(`${vaultGoneToast(noteTitle(path))} ${heldLine(kept)}`);
      return base;
    }
    const copy = await writeConflictCopy(target, path, text, new Date());
    await dropOwnStash(target, path, session, mark);
    if (!copy) {
      const kept = await holdVaultDraft(target, path, text, VAULT_NO_COPY_NAME_REASON, {
        session,
      });
      set({ vaultError: 'held' });
      get().showToast(`Not saved. ${heldLine(kept)}`);
      return versionOf(theirs);
    }
    get().showToast(vaultReplayCopiesLine([copy]));
    logEvent('vault_draft_kept_both', { count: 1 });
    return versionOf(theirs);
  }

  // Team note bodies cached for backlinks belong to the session that read
  // them; any end of a session drops them.
  function forgetTeamBodies(): void {
    for (const key of [...vaultBodyCache.keys()]) {
      if (key.startsWith('org::')) vaultBodyCache.delete(key);
    }
  }

  // R-19: sign-out wipes the team vault's state on this device, its unsent
  // drafts and held text included, so a replay can never publish one
  // member's words under the next member's identity (orgvault-15).
  // Best-effort: it never blocks sign-out.
  async function forgetTeamVaultDrafts(): Promise<void> {
    await editVaultPending((p) => {
      for (const [key, e] of Object.entries(p)) if (e.providerId === 'org') delete p[key];
    }).catch(() => {});
    await editVaultInflight((p) => {
      for (const [id, e] of Object.entries(p)) if (e.providerId === 'org') delete p[id];
    }).catch(() => {});
    await editVaultHeld((list) => list.filter((h) => h.providerId !== 'org')).catch(() => {});
  }

  // A sign-in keeps the team text its own account left (an expiry kept it
  // for this moment) and drops every other account's, so nothing typed under
  // one account ever replays or shows under another.
  async function settleTeamVaultDrafts(uid: string): Promise<void> {
    await editVaultPending((p) => {
      for (const [key, e] of Object.entries(p)) {
        if (e.providerId === 'org' && e.owner !== uid) delete p[key];
      }
    }).catch(() => {});
    await editVaultInflight((p) => {
      for (const [id, e] of Object.entries(p)) {
        if (e.providerId === 'org' && e.owner !== uid) delete p[id];
      }
    }).catch(() => {});
    await editVaultHeld((list) =>
      list.filter((h) => h.providerId !== 'org' || h.owner === uid),
    ).catch(() => {});
  }

  // How many unsent team drafts (stashed, on their way, or held) an account
  // has on this device, for the expiry line and the sign-out ask: a note
  // counts once however many of its saves are out.
  async function countTeamDrafts(uid: string): Promise<number> {
    const mine = (e: VaultPendingEntry) => e.providerId === 'org' && e.owner === uid;
    const stashed = await editVaultPending((p) => Object.values(p).filter(mine)).catch(
      () => [] as VaultPendingEntry[],
    );
    const out = await editVaultInflight((p) => Object.values(p).filter(mine)).catch(
      () => [] as VaultPendingEntry[],
    );
    const notes = new Set([...stashed, ...out].map((e) => vaultKey(e, e.path)));
    const held = get().vaultHeld.filter((h) => h.providerId === 'org' && h.owner === uid);
    return notes.size + held.length;
  }

  // A sign-in from the email (its code or its link). The first email to an
  // address is also how an account is made, so a device that never answered
  // Personal or Business asks now, once signed in; a Personal build makes it
  // a Personal account with no question (Business is v4).
  // A session the auth server made that this device then refused (another
  // account while someone is signed in, or a renewal that came back as
  // someone else): end it there at once, so it is never left live (CTO review
  // 2026-10-12). Best effort; nothing here waits on it.
  function dropRefused(session: Session): void {
    void supabaseSignOut(session.accessToken, 'local').catch(() => {});
  }

  async function signedInByEmail(session: Session): Promise<void> {
    await onSignedIn(session);
    if (!get().settings.passwordsGoneSeen) await get().saveSettings({ passwordsGoneSeen: true });
    if (!get().settings.account) {
      if (featureOn('teams')) set({ accountChoice: true });
      else await get().saveSettings({ account: { type: 'personal' } });
    }
  }

  // verified email, claim any invited org seat, and read the server role.
  async function onSignedIn(session: Session): Promise<void> {
    await saveSession(session);
    // A fresh session always starts on the personal vault, with no team-vault
    // state or provider cache carried over from a prior account on this device.
    // Unsent team text stays only for the account that typed it.
    resetOrgVault();
    forgetTeamBodies();
    set({ vaultTeamPlan: undefined });
    // The same person signing back in after an expiry that kept a team note
    // open goes on with that note, now able to save (Vault M2 2.6).
    const resume =
      Boolean(get().vaultTeamExpired) &&
      keptTeamOwner === session.user.id &&
      get().vaultScope === 'team' &&
      Boolean(get().vaultNote);
    // Who was signed in before, as this device saved it (an expiry or a
    // relaunch since leaves nothing else), and their team (round 7 E33).
    const before = keptTeamOwner ?? get().settings.prefsOwner;
    const beforeOrg = get().settings.account?.org?.serverId;
    keptTeamOwner = undefined;
    await settleTeamVaultDrafts(session.user.id);
    // Another account's team indexes go with its drafts: every one on the
    // device's list, and the last account's team, for an index built before
    // the list was kept. The same account's wait for it (E33).
    await dropTeamIndexes((m) => m.owner === session.user.id);
    if (before && beforeOrg && before !== session.user.id) {
      await dropVaultIndex({ providerId: 'org', resourceId: beforeOrg, owner: before }).catch(
        () => {},
      );
    }
    await forgetTeamMemory(session.user.id);
    if (resume) {
      set({ authSession: session, vaultTeamExpired: undefined });
    } else {
      // No team choice or typed team text carries into another sign-in.
      if (get().vaultScope === 'team') vaultLiveDraft = undefined;
      const choice = get().vaultConflict;
      set({
        authSession: session,
        vaultScope: 'personal',
        vaultTeamExpired: undefined,
        vaultError: undefined,
        ...clearedVaultRoom(),
        ...(choice?.target.providerId === 'org' ? { vaultConflict: undefined } : {}),
      });
    }
    const account = get().settings.account;
    if (account && session.user.email && account.selfEmail !== session.user.email) {
      await get().saveSettings({ account: { ...account, selfEmail: session.user.email } });
    }
    // Teams are v4 (docs/release-tiers.md): a Personal build claims no seat,
    // syncs no organization and no team projects; it reads the entitlement.
    if (featureOn('teams')) {
      try {
        await supabaseRpc('claim_membership', session.accessToken);
      } catch {
        // No invited seat, or offline: role stays whatever the server says next.
      }
      await reconcileOrg();
      await get().refreshOrgRole();
    }
    void get()
      .refreshEntitlement()
      .catch(() => {});
    if (featureOn('teams')) void get().syncOrgProjects();
    // Preferences that follow the person arrive (or leave) now.
    void syncPreferences();
    // Someone who has signed in knows what the account opens, so the notice
    // for people who used OpenShore before the gate is never theirs, even
    // signed out on a later launch.
    if (!get().settings.accountNoticeSeen) {
      await get()
        .saveSettings({ accountNoticeSeen: true })
        .catch(() => {});
    }
    // Signed in from the account sheet: carry on to the room it was opened
    // for, or back to where the person was.
    if (get().accountGate) {
      const to = accountReturn;
      get().closeAccountGate();
      if (to) get().setView(to);
    }
    // A message kept at the sign-in door on the open chat (a coding session,
    // or a chat with the computer) goes out now: the driver builds and its
    // attach delivers it.
    const openId = get().activeId;
    const open = openId ? get().conversations[openId] : undefined;
    const kept =
      open &&
      (SOURCE_ACCOUNT[open.source.kind] === 'coding' || open.source.kind === 'desktop-chat');
    if (openId && kept && open.pendingFirstMessage && !open.pendingFirstError) {
      ensureDriver(openId);
    }
    // Back on the team note: list the team vault again and replay what was
    // kept for this account while it was signed out.
    if (resume && get().vaultScope === 'team') void get().vaultRefresh();
    logEvent('auth_sign_in');
  }

  return {
    ready: false,
    routines: emptyRoutinesState(),
    initStarted: false,
    view: 'chat',
    viewTrail: [],
    drawerOpen: false,
    conversations: {},
    order: [],
    settings: { onboarded: false, claudeModel: DEFAULT_CLAUDE_MODEL, deviceModels: {} },
    cloudKeyPresent: false,
    cloudKeyNeedsFix: false,
    connectedProviders: {},
    arrivedBack: false,
    codemagicConnected: false,
    currentProbes: {},
    harnessCurrentProbes: {},
    searchKeyConfigured: false,
    vaultFiles: [],
    vaultHeld: [],
    vaultPending: [],
    vaultScope: 'personal',
    connectedRepoPlatforms: {},
    authConfigured: authConfigured(),
    connectivity: { homeReachable: false, online: true },

    async init() {
      // P2-11: React StrictMode invokes the mount effect twice in dev, and a
      // second init() would double timers, listeners, migration writes, and the
      // auth-callback handling. Run exactly once per store lifetime.
      if (get().initStarted) return;
      set({ initStarted: true });

      // Every app-side web search asks the person first, once (lib/localSearch).
      // The readers let a driver leave a declined or offline search out of
      // the prompt before the model writes a word.
      setSearchConsent(askWebSearch, {
        allowed: webSearchAllowedNow,
        online: () =>
          get().connectivity.online &&
          locationAllowed(
            effectiveProfile(autoProfile(get().connectivity), get().settings.profileOverride),
            'cloud',
          ),
      });

      // Wire the team vault (org tier) to the signed-in session: a fresh-token
      // getter and a readiness predicate, so the Supabase-backed provider can
      // authenticate without importing the store (which would be a cycle).
      // The getter answers undefined only when there is no session (never
      // signed in, or a dead refresh token that just signed the device out);
      // a refresh that could not reach the server throws, so a team save made
      // offline is stashed and retried, not held behind a false "Sign in".
      setOrgVaultAuth(
        () => accessToken(),
        () => get().teamVaultAvailable(),
      );
      // The team's plan, from each settings read, a write refused with OV402
      // and a delete refused with OV403: only the signed-in org's, so a late
      // answer for another org never paints this one (CX Y15).
      onOrgVaultPlan((resourceId, plan, learned) => {
        if (resourceId !== get().settings.account?.org?.serverId) return;
        // A plan learned from a refusal says only part of it: the next
        // relist reads the settings again rather than waiting out their
        // cache, so a renewed plan or a switched rule comes back (E37).
        if (learned === 'refusal') clearVaultSettingsCache(`org::${resourceId}`);
        set({ vaultTeamPlan: plan });
      });
      // The server said this account is not a member of the team any more,
      // from any call (round 7 E26): the room takes the team vault away.
      onOrgVaultNotMember((resourceId) => void teamMembershipEnded(resourceId));

      // P0-3: the sealed store settles its key first. 'locked' means a key
      // exists but could not be read this launch; every sealed value reads as
      // absent and stays untouched, and the person is told below.
      const unlock = await dataUnlockState();
      const locked = unlock === 'locked';

      const settings = (await storeGetJson<AppSettings>(SETTINGS_KEY)) ?? {
        onboarded: false,
        claudeModel: DEFAULT_CLAUDE_MODEL,
        deviceModels: {},
      };
      // The picks for providers whose models load live, back on the list
      // every reader uses, before anything renders a Bench.
      for (const [id, models] of Object.entries(settings.providerModels ?? {})) {
        applyLiveModels(id, models);
      }
      const persisted = (await storeGetJson<PersistedConversations>(CONVERSATIONS_KEY)) ?? {
        order: [],
        conversations: {},
      };
      // The cached crew snapshot: the activity dashboards are viewable at once,
      // even offshore, before (or without) a live read from the machine.
      const cachedRoutines = await storeGetJson<{ routines: RoutineView[]; runs: RoutineRun[] }>(
        ROUTINES_KEY,
      );
      const conversations: Record<string, Conversation> = {};
      for (const id of persisted.order) {
        const row = persisted.conversations[id];
        if (!row) continue;
        // Quick chats were retired (2026-09-02); a row from that era is dropped.
        if ((row as { ephemeral?: boolean }).ephemeral) continue;
        conversations[id] = {
          ...row,
          // Desktop threads rebuild from the journal on open, from their saved
          // read-only snapshot (B4); local ones load as saved.
          thread:
            row.source.kind === 'desktop'
              ? snapshotThread(row.thread ?? emptyThread())
              : (row.thread ?? emptyThread()),
        };
      }
      const cloudKeyPresent = Boolean(await secretGet(ANTHROPIC_KEY_KEY));
      const connectedProviders: Record<string, boolean> = {};
      for (const p of PROVIDERS) {
        connectedProviders[p.id] = Boolean(await secretGet(providerSecretKey(p.id)));
      }
      const codemagicConnected = Boolean(await secretGet(CODEMAGIC_SECRET_KEY));
      const searchKeyConfigured = Boolean(await secretGet(SEARCH_SECRET_KEY));
      const connectedRepoPlatforms: Record<string, boolean> = {};
      for (const c of REPO_CONNECTORS) {
        connectedRepoPlatforms[c.id] = Boolean(await secretGet(repoSecretKey(c.id)));
      }
      await loadInsights(settings.insightsOptIn ?? false);
      // On iOS the filesystem is the truth for on-device models: if a model
      // (or Harbor) is gone, drop its label / ready flag so nothing advertises
      // a model that will not load and we can re-prompt the Harbor download.
      if (platform() === 'ios') {
        try {
          const { models } = await Llama.listModels();
          const present = new Set(models.map((m) => m.id));
          // A model in iCloud is still "present" (listModels reports it, evicted
          // or not), so partition by where its bytes live to keep each map true.
          const cloudPresent = new Set(
            models.filter((m) => m.location === 'icloud').map((m) => m.id),
          );
          let changed = false;
          const kept = Object.fromEntries(
            Object.entries(settings.deviceModels).filter(
              ([id]) => present.has(id) && !cloudPresent.has(id),
            ),
          );
          if (Object.keys(kept).length !== Object.keys(settings.deviceModels).length) {
            settings.deviceModels = kept;
            changed = true;
          }
          const keptCloud = Object.fromEntries(
            Object.entries(settings.cloudModels ?? {}).filter(([id]) => cloudPresent.has(id)),
          );
          if (Object.keys(keptCloud).length !== Object.keys(settings.cloudModels ?? {}).length) {
            settings.cloudModels = keptCloud;
            changed = true;
          }
          const harborMiniHere = present.has(HARBOR_MINI_MODEL_ID);
          if (Boolean(settings.harborMiniReady) !== harborMiniHere) {
            settings.harborMiniReady = harborMiniHere;
            changed = true;
          }
          let harborHere = present.has(HARBOR_MODEL_ID);
          // Weights from an older Harbor (the research-licensed 3B before 3.0)
          // are deleted, so the person gets the current Harbor from its row.
          if (harborHere && harborWeightsStale(settings.harborVersion)) {
            await Llama.deleteModel({ id: HARBOR_MODEL_ID }).catch(() => {});
            logEvent('harbor_stale_removed');
            harborHere = false;
          }
          if (Boolean(settings.harborReady) !== harborHere) {
            settings.harborReady = harborHere;
            changed = true;
          }
          if (changed) await persistSettings(settings);
        } catch {
          // Native side unreachable: keep the labels as they are.
        }
      }
      let settingsDirty = false;

      // APP-11: hub credentials live in the secret store, keyed by hub. Put
      // each saved hub's token back from there; a token still riding the blob
      // (a device paired before this change) is moved across once and the
      // blob rewritten without it.
      const withHubToken = async (d: DaemonTarget): Promise<DaemonTarget> => {
        if (d.token) {
          await secretSet(hubSecretKey(d.baseUrl), d.token);
          settingsDirty = true;
          return d;
        }
        return { ...d, token: (await secretGet(hubSecretKey(d.baseUrl))) ?? '' };
      };
      if (settings.daemons) {
        const hubs: DaemonTarget[] = [];
        for (const d of settings.daemons) hubs.push(await withHubToken(d));
        settings.daemons = hubs;
      }
      if (settings.daemon) settings.daemon = await withHubToken(settings.daemon);

      // The GitHub repo cache rides the sealed store; warm the picker's mirror.
      await hydrateRepoCache();

      // Per-status stacks (2026-09-03): the stack was one shared config; it now
      // has one per connectivity profile (docked, offshore, offline), chosen
      // automatically from the current status. On the first launch after this
      // shipped, pin the existing stack to the status the user is in right now
      // and leave the other two at their anchor-only default (founder call: only
      // the current status inherits the old setup). The legacy `stack` field is
      // kept as the seed and a rollback fallback.
      if (!settings.stacks) {
        const current = activeProfile(get().connectivity, settings.profileOverride);
        settings.stacks = settings.stack ? { [current]: settings.stack } : {};
        settingsDirty = true;
      }

      // Heal each configured status's Reasoning anchor: a built-in guide that is
      // not actually on this device is promoted to whichever guide IS downloaded,
      // so "My Stack" chat starts right away instead of failing with "download it
      // first." This is exactly the case a fresh stack (seeded with Harbor Lite)
      // hits when the user only downloaded Harbor. A cloud, BYOM, or user-chosen
      // device anchor is left alone.
      for (const p of PROFILE_ORDER) {
        const st = settings.stacks[p];
        if (!st) continue;
        const healed = healedAnchor(
          st,
          Boolean(settings.harborReady),
          Boolean(settings.harborMiniReady),
        );
        if (healed !== st) {
          settings.stacks[p] = healed;
          settingsDirty = true;
        }
      }

      // The permission modes now match Claude Code's four; a stored value from
      // the earlier three-mode picker ('auto') maps to bypass.
      if (settings.permissionMode !== undefined) {
        const normalized = normalizePermissionMode(settings.permissionMode);
        if (normalized !== settings.permissionMode) {
          settings.permissionMode = normalized;
          settingsDirty = true;
        }
      }

      // A stable device id, generated once, for rescue-branch names and sync.
      if (!settings.deviceId) {
        settings.deviceId = `dev_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
        settingsDirty = true;
      }

      // Bucket migration: a LEGACY saved chat with no project (one that predates
      // projects) would vanish from every list once any project exists, so adopt
      // it into the active (or first) project. P2-13: a chat explicitly unfiled
      // by deleteProject carries `unfiled`, so it is left alone here instead of
      // being silently re-adopted on the next launch. Unfiled chats still show
      // in Chats and Recents, through lib/chatScope.ts.
      const orphanIds = Object.keys(conversations).filter(
        (id) => !conversations[id]!.projectId && !conversations[id]!.unfiled,
      );
      if (orphanIds.length) {
        let activeProjectId = settings.activeProjectId ?? settings.projects?.[0]?.id;
        if (!activeProjectId) {
          const proj: Project = {
            id: `p${Date.now().toString(36)}${(convSeq++).toString(36)}`,
            name: 'My work',
            repoIds: [],
            createdAt: new Date().toISOString(),
          };
          settings.projects = [...(settings.projects ?? []), proj];
          settings.activeProjectId = proj.id;
          activeProjectId = proj.id;
        }
        for (const id of orphanIds) {
          conversations[id] = { ...conversations[id]!, projectId: activeProjectId };
        }
        settingsDirty = true;
      }

      // Stale build runs: the poller cannot survive a relaunch, so any run left
      // in a non-terminal state is orphaned. Settle it so Build is not bricked.
      if (settings.launch?.runs?.some((r) => !isTerminal(r.status) && r.status !== 'unknown')) {
        settings.launch = {
          ...settings.launch,
          runs: settings.launch.runs.map((r) =>
            isTerminal(r.status) || r.status === 'unknown'
              ? r
              : {
                  ...r,
                  status: 'unknown' as const,
                  error: 'Interrupted before it finished. Check Codemagic for the result.',
                  finishedAt: r.finishedAt ?? new Date().toISOString(),
                },
          ),
        };
        settingsDirty = true;
      }

      if (settingsDirty) await persistSettings(settings);

      // Mirror the persisted reasoning effort into the live value the drivers
      // read at send time (defaults to High on a fresh device).
      setActiveEffort(settings.effort ?? DEFAULT_EFFORT);
      // And Chain of Thought (off on a fresh device).
      setChainOfThought(settings.chainOfThought === true);
      // And prompt caching (off until the eval says otherwise, CTO J19).
      setPromptCache(settings.promptCache === true);
      // The hub vault links to the paired computer before anything lists it.
      await syncHubLink(settings.daemon, { initial: true }).catch(() => false);

      // A stored session is a local, encrypted-at-rest read (no network round
      // trip), so it is cheap to check before deciding the first view: a
      // signed-in device skips onboarding and lands straight on chat, same as
      // an already-onboarded one. A fresh sign-in completed via the web
      // magic-link callback (below) is a separate case that only ever applies
      // once the app is already open, so it does not need to gate this.
      const stored: Session | undefined = authConfigured() ? await loadStoredSession() : undefined;

      // The retired Personal plan's device keys (its cached entitlement and
      // an unlinked Apple receipt) are let go once, so nothing about a
      // purchase stays on the device.
      void storeDelete(RETIRED_ENTITLEMENT_CACHE_KEY).catch(() => {});
      void storeDelete(RETIRED_APPLE_LINK_KEY).catch(() => {});
      set({
        settings,
        conversations,
        order: persisted.order.filter((id) => conversations[id]),
        routines: cachedRoutines
          ? {
              routines: cachedRoutines.routines ?? [],
              runs: cachedRoutines.runs ?? [],
              loaded: false,
              available: true,
              live: false,
            }
          : emptyRoutinesState(),
        cloudKeyPresent,
        connectedProviders,
        codemagicConnected,
        searchKeyConfigured,
        connectedRepoPlatforms,
        ready: true,
        // App Lock closes the app at launch until the device's own unlock.
        appLocked: platform() === 'ios' && settings.appLock?.on === true ? true : undefined,
        authSession: stored ?? get().authSession,
        hubRole: activeHubRole(settings),
        dataLocked: locked || undefined,
        // Everyone opens into the chat. A new person is met there by Harbor
        // Lite (below), whose greeting carries the button to the setup page;
        // the page is never a wall in front of the first chat.
        view: 'chat',
      });
      logEvent('app_open', { onboarded: settings.onboarded });
      // Signed in: the account's preferences, if newer, arrive now. Someone
      // signed in already knows what the account opens, so the notice below
      // never reaches them on a later signed-out launch (onSignedIn marks a
      // fresh sign-in the same way).
      if (stored) void syncPreferences();
      if (stored && !settings.accountNoticeSeen) {
        void get()
          .saveSettings({ accountNoticeSeen: true })
          .catch(() => {});
      }
      // Someone who used OpenShore before the account gate, signed out, hears
      // once that their work is still here and what signing in opens.
      if (accountNoticeDue(settings, { configured: authConfigured(), signedIn: Boolean(stored) })) {
        void get().saveSettings({ accountNoticeSeen: true });
        get().showToast(ACCOUNT_NOTICE);
      }
      // First open: no Personal-or-Business question (no account means
      // personal) and no setup wall. On the phone, open the built-in guide's
      // chat with its seeded hello; the desktop's empty chat is the First Seat.
      // A locked device is not a new one, and its writes could not land anyway.
      if (!settings.onboarded && !stored && !locked) {
        void get().saveSettings({ onboarded: true });
        logEvent('onboarding_done', { next: 'chat' });
        if (isPhone()) void get().beginGuidedSetup();
      }
      // The live half of the currents gate: probe what the paired computer can
      // host and whether each saved connection answers. Best effort, off the
      // launch path; an unreachable box simply reads as Arriving.
      void get()
        .refreshCurrents()
        .catch(() => {});
      if (locked) {
        get().showToast(
          'Could not unlock your data on this computer. Nothing was changed. Restart the app, or check your system keychain.',
        );
        logEvent('data_locked');
      }

      // A guide download now runs on a background URLSession, so it keeps going
      // while the app is away and can still be mid-flight when the app is
      // reopened. Re-drive the ensure flow for anything still transferring so
      // the progress bar reappears and resolves, instead of a silent bar that
      // never moves. (A download that finished while away was already caught by
      // the listModels reconciliation above, which flips the ready flags.)
      if (platform() === 'ios') {
        void (async () => {
          try {
            const { ids } = await Llama.activeDownloads();
            if (ids.includes(HARBOR_MINI_MODEL_ID) && !get().settings.harborMiniReady) {
              void get().ensureHarborMini();
            }
            if (ids.includes(HARBOR_MODEL_ID) && !get().settings.harborReady) {
              void get().ensureHarbor();
            }
          } catch {
            // Native side unreachable: nothing to reattach.
          }
        })();
      }

      // Upgrade any pre-encryption data to sealed-at-rest, in the background.
      void sealExistingKeys([SETTINGS_KEY, CONVERSATIONS_KEY, ANTHROPIC_KEY_KEY]);

      // Finish a web sign-in, or reconcile the restored one. On web a
      // magic-link or email-confirmation redirect lands on our own origin
      // with the tokens in the URL hash; complete it, then strip them from
      // the address bar so they are not left in history. (Native handles its
      // callback via the oscode:// deep link in useAuthDeepLink.)
      if (authConfigured()) {
        void (async () => {
          const href = typeof window !== 'undefined' ? window.location.href : '';
          const hasCallback = platform() === 'web' && /auth-callback/.test(href);
          if (hasCallback && (await get().completeAuthCallback(href))) {
            get().showToast('Signed in.');
            window.history.replaceState(null, document.title, window.location.pathname);
            return;
          }
          if (stored) {
            // APP-2: a restored session is validated before it is trusted; a
            // dead refresh token signs the device out here, once, with a
            // toast. An offline launch keeps the session and skips the sync.
            let fresh: Session | undefined;
            try {
              fresh = await freshAuth();
            } catch {
              fresh = undefined;
            }
            if (!fresh) return;
            if (featureOn('teams')) {
              await reconcileOrg();
              await get().refreshOrgRole();
              void get().syncOrgProjects();
            }
            // A pure-web buyer returns from checkout on this origin with
            // ?checkout=success (no deep link to fire); reconcile the
            // entitlement right away instead of waiting for a refocus.
            if (platform() === 'web' && /[?&]checkout=success/.test(href)) {
              await get().onCheckoutReturn();
              window.history.replaceState(null, document.title, window.location.pathname);
            } else {
              void get().refreshEntitlement();
            }
          }
        })();
      }

      // Desktop: learn whether this machine's engine has a model yet, so the
      // first-answer gate can route to the Stack instead of a dead session.
      void get().refreshDesktopStatus();

      // Watch the connection so the profile status is always live.
      void get().refreshConnectivity();
      if (typeof window !== 'undefined') {
        window.addEventListener('online', () => {
          void get().refreshConnectivity();
          // Reconnected: flush any project commits that piled up offline.
          void get().reconcileProjectRepos('reconnect');
        });
        window.addEventListener('offline', () => void get().refreshConnectivity());
        setInterval(() => void get().refreshConnectivity(), 20000);
        // Desktop Offline: main watches the network too (Electron's own read,
        // which holds with the window closed), and says when it changes.
        bridge()?.onNetwork?.((p) => {
          mainNetOnline = p.online;
          void get().refreshConnectivity();
        });
      }

      // On every app open, check for local project work that never reached the
      // remote and push it, so nothing important is stranded on this device.
      void get().reconcileProjectRepos('open');

      repairIntroLetter();
      retitleChats();

      // Guided setup: whichever model answers in the walk's own chat reads
      // where the walk stands on every reply. Keyed by the chat the reply is
      // for, not the chat on screen, so a queued reply elsewhere never hears
      // about setup and the walk's chat keeps it while the person looks away.
      setHarborMiniContext((conversationId, audience) => {
        const p = get().settings.guidedSetup;
        return p && conversationId === p.conversationId
          ? guideContextLine(p, setupFacts(), audience)
          : undefined;
      });

      // Notices: mirror the Downloads toggle to the native side (it reads it on
      // a background relaunch) and open whatever a tapped notice is about. A
      // tap that cold-launched the app is retained until this listener lands.
      if (isPhone()) {
        void syncNoticePrefs(get().settings);
        void Llama.addListener('noticeTap', (data) => openNoticeTap(data)).catch(() => {});
      }

      // While the phone is foreground on a desktop chat, beat the daemon so it
      // knows the user is watching and holds the completion push back. The
      // daemon does not trust its own socket for this (a backgrounded iOS socket
      // lingers half-open), so the phone is the authority on foreground.
      if (isPhone()) {
        setInterval(() => {
          const s = get();
          const daemon = s.settings.daemon;
          if (!daemon || s.view !== 'chat' || !s.activeId) return;
          if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
          const conv = s.conversations[s.activeId];
          if (conv?.source.kind === 'desktop' && conv.source.sessionId) {
            void beatDesktopSession(daemon, conv.source.sessionId);
          }
        }, 12000);
      }
    },

    async refreshConnectivity() {
      let online = typeof navigator !== 'undefined' ? navigator.onLine : true;
      // Desktop Offline: the person's choice reaches this computer's engine
      // on every refresh (main sets its one machine flag), and main's own
      // read of the network counts beside the window's.
      if (isDesktop()) {
        const main = await reportDesktopOffline(
          bridge(),
          get().settings.profileOverride === 'offline',
        );
        if (main !== undefined) mainNetOnline = main;
        online = desktopOnline(online, mainNetOnline);
      }
      let homeReachable = false;
      // Desktop Offline: whether the paired computer itself works offline,
      // and why, as its daemon says (absent from an older one).
      let homeOffline: Connectivity['homeOffline'];
      const daemon = get().settings.daemon;
      if (daemon && online) {
        try {
          const res = await Promise.race([
            daemonHealth(daemon),
            new Promise<{ ok: boolean }>((r) => setTimeout(() => r({ ok: false }), 3000)),
          ]);
          homeReachable = Boolean(res.ok);
          if (res.ok && 'offline' in res) homeOffline = res.offline;
        } catch {
          homeReachable = false;
        }
      }
      const prev = get().connectivity;
      if (
        prev.online !== online ||
        prev.homeReachable !== homeReachable ||
        prev.homeOffline !== homeOffline
      ) {
        set({ connectivity: { online, homeReachable, ...(homeOffline ? { homeOffline } : {}) } });
      }
    },

    async reconcileProjectRepos(trigger) {
      // Desktop only: the clones live here, and the bridge does the git work.
      // Nothing to push from a phone (its repos are remote, read-only here).
      if (!isDesktop() || !bridge()) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      // One at a time: the boot check and a reconnect can otherwise overlap.
      if (reconcilingRepos) return;
      const roots = projectWorkspaces(get().settings.projects ?? []);
      if (!roots.length) return;
      reconcilingRepos = true;
      try {
        // The platforms connected here authorize the push (host-scoped, for
        // that one git command), so a clone made with a token is pushable.
        const tokens: Partial<Record<RepoPlatform, string>> = {};
        for (const c of REPO_CONNECTORS) {
          if (!get().connectedRepoPlatforms[c.id]) continue;
          const t = await repoToken(c.id).catch(() => undefined);
          if (t) tokens[c.id] = t;
        }
        const results = await bridge()!.reconcileRepos(roots, tokens);
        const summary = summarizeReconcile(results);
        set({ repoSyncConflicts: summary.conflicts.length ? summary.conflicts : undefined });
        // reconcileToast is silent unless something is worth saying (a push, a
        // conflict, or an outright failure), so a routine boot with nothing to
        // do stays quiet.
        const message = reconcileToast(summary);
        if (message) get().showToast(message);
        logEvent('repo_reconcile', {
          trigger,
          pushed: summary.pushed,
          conflicts: summary.conflicts.length,
          offline: summary.offline,
        });
      } catch {
        // A failed reconcile is never fatal and never loses work; the next open
        // or reconnect tries again.
      } finally {
        reconcilingRepos = false;
      }
    },

    async setProfileOverride(profile) {
      await get().saveSettings({ profileOverride: profile });
      logEvent('profile_override', { profile: profile ?? 'auto' });
      // On the desktop the choice is this computer's engine's too (Desktop
      // Offline): the refresh reports it to main, which tells every session.
      if (isDesktop()) await get().refreshConnectivity();
    },

    openConnections(providerId) {
      set({ connectionsFocus: providerId });
      get().setView('connections');
    },

    clearConnectionsFocus() {
      if (get().connectionsFocus) set({ connectionsFocus: undefined });
    },

    clearJustConnected() {
      if (get().justConnected) set({ justConnected: undefined });
    },

    setView(view, opts) {
      // Release tiers: a later tier's room has no door in this build, whoever
      // calls (lib/focus.ts).
      if (!roomOpen(view)) {
        set({ drawerOpen: false });
        return;
      }
      // Accounts: every room but chat, the Stack, and Settings is behind a
      // free sign-in (lib/accountGate.ts). The sheet opens instead, and
      // signing in carries on to this room.
      const accountFeature = roomAccountFeature(view);
      if (accountFeature && get().needsAccountNow()) {
        get().openAccountGate(accountFeature, view);
        return;
      }
      const { view: current, viewTrail } = get();
      if (view === current) {
        set({ drawerOpen: false });
        return;
      }
      // A root navigation clears the trail. Chat is always a root: it is the
      // home the panel returns to, never a sub-page of another room.
      const trail = opts?.root || view === 'chat' ? [] : [...viewTrail, current].slice(-8);
      // A fresh connection is celebrated by the next room that shows its rows;
      // a forward hop to anywhere else (Chat from the panel) lets it rest, so
      // the pop never fires on a store opened days later.
      const justConnected =
        view === 'marketplace' || view === 'stack' ? get().justConnected : undefined;
      set({ view, viewTrail: trail, drawerOpen: false, arrivedBack: false, justConnected });
    },

    goBack() {
      const { viewTrail } = get();
      const prev = viewTrail[viewTrail.length - 1];
      if (!prev) return;
      // The same door as setView: a room on the trail that needs an account
      // (the person signed out since) opens the sign-in sheet instead, and
      // signing in carries on to it. The step is spent either way, so "Not
      // now" never leaves a back arrow that only opens the sheet again.
      const accountFeature = roomAccountFeature(prev);
      if (accountFeature && get().needsAccountNow()) {
        set({ viewTrail: viewTrail.slice(0, -1) });
        get().openAccountGate(accountFeature, prev);
        return;
      }
      set({ view: prev, viewTrail: viewTrail.slice(0, -1), drawerOpen: false, arrivedBack: true });
    },

    setDrawer(open) {
      set({ drawerOpen: open });
    },

    needsAccountNow() {
      return needsAccount(authConfigured(), Boolean(get().authSession));
    },
    openAccountGate(feature, returnTo) {
      accountReturn = returnTo;
      logEvent('account_gate_shown', { feature });
      set({ accountGate: feature, drawerOpen: false });
    },
    closeAccountGate() {
      accountReturn = undefined;
      set({ accountGate: undefined });
    },

    sourceReady(source) {
      const s = get();
      const st = s.settings;
      const signals: ReadinessSignals = {
        onDeviceHost: platform() === 'ios',
        deviceModelReady: (id) =>
          Boolean(st.deviceModels[id]) ||
          // A model kept in iCloud counts as ready: the load path pulls its
          // bytes down first (ensureLocal) when you are online.
          Boolean(st.cloudModels?.[id]) ||
          (id === HARBOR_MINI_MODEL_ID && Boolean(st.harborMiniReady)) ||
          (id === HARBOR_MODEL_ID && Boolean(st.harborReady)),
        cloudReady: (provider) =>
          provider === 'anthropic' ? s.cloudKeyPresent : Boolean(s.connectedProviders[provider]),
      };
      switch (source.kind) {
        case 'stack':
          return stackReady(
            stackForProfile(st.stacks, activeProfile(s.connectivity, st.profileOverride)),
            signals,
          );
        case 'device':
          return refReady(
            { kind: 'device', modelId: source.modelId, modelName: source.modelName },
            signals,
          );
        case 'cloud':
          return signals.cloudReady(source.provider);
        case 'desktop':
          // The desktop app's engine refuses to start a session until a model
          // (orchestrator) is configured, so "ready" here means that, not just
          // "we are on a desktop". A phone is ready when a computer is paired.
          if (isDesktop()) return Boolean(s.desktopStatus?.stack.configured);
          return Boolean(st.daemon);
        case 'desktop-chat':
          // The free chat answers from a local model only (the engine refuses
          // one that leaves this network), so on the desktop a cloud
          // orchestrator is not ready for it.
          if (isDesktop()) return engineChatReady(s.desktopStatus);
          return Boolean(st.daemon);
        case 'mock':
          return true;
      }
    },

    stackVisionReady() {
      const s = get();
      const st = s.settings;
      const profile = activeProfile(s.connectivity, st.profileOverride);
      const cloudReachable = locationAllowed(profile, 'cloud');
      const connected = (provider: string) =>
        provider === 'anthropic' ? s.cloudKeyPresent : Boolean(s.connectedProviders[provider]);
      // A device model cannot read images on this build, so its reachability
      // does not decide the gate (visionCapable filters it out anyway); a cloud
      // or BYOM model must be reachable in this profile and, for cloud,
      // connected.
      const reachable = (ref: StackModelRef): boolean => {
        if (ref.kind === 'device') return platform() === 'ios';
        if (ref.kind === 'cloud') return cloudReachable && connected(ref.provider);
        return cloudReachable; // byom runs over the network
      };
      return stackVisionReadyPure(stackForProfile(st.stacks, profile), {
        reachable,
        cloudReachable,
        connected,
      });
    },

    async refreshDesktopStatus() {
      const b = isDesktop() ? bridge() : undefined;
      if (!b) return;
      try {
        set({ desktopStatus: await b.status() });
      } catch {
        // Engine unreachable: keep whatever we last knew (undefined reads as
        // not ready, which is the safe answer).
      }
    },

    showToast(message) {
      set({ toast: message });
      setTimeout(() => set((s) => (s.toast === message ? { toast: undefined } : s)), 3200);
    },

    setUpdateStatus(update) {
      set({ updateStatus: update });
    },

    async newConversation(source, opts) {
      // The coding AGENT is a 'desktop' repo session (it reads the repo, writes
      // edits, runs tools). Central choke point so every coding entry (Repos,
      // Launch) meets the sign-in one way. Resolves to undefined when no chat
      // opened, so no caller mistakes the chat already on screen for the new
      // one.
      const coding = SOURCE_ACCOUNT[source.kind] === 'coding';
      // The coding agent needs a free sign-in (lib/accountGate.ts); chat does
      // not, the free chat with a computer's own model included. The caller
      // hands a typed first message back to the composer.
      if (coding && get().needsAccountNow()) {
        get().openAccountGate('coding');
        return undefined;
      }
      logEvent('source_chosen', { kind: source.kind });
      const id = newId();
      // Every chat belongs to the active project (or the first one). Resolve
      // what exists synchronously; a missing default is created just below,
      // AFTER the conversation is on screen, so a first message never waits on
      // project setup to become visible (B3).
      const s0 = get().settings;
      let projectId = s0.activeProjectId ?? s0.projects?.[0]?.id;
      const seedItems = opts?.seedItems ?? [];
      // The chat's repositories: what the caller picked, else the project's.
      const project = get().settings.projects?.find((p) => p.id === projectId);
      const repoIds = opts?.repoIds ?? project?.repoIds ?? [];
      // A first message rides in parked on the chat (B3): its bubble is on
      // screen before the driver exists, the attach delivers it, and a hub
      // that never answers leaves it there with the reason and a Retry. The
      // conversation is set SYNCHRONOUSLY, before any await, so the bubble
      // exists the instant the caller asks for it.
      const first = opts?.firstMessage;
      if (first?.attachments?.length) pendingSends.set(id, first.attachments);
      // "Help me get set up" as a new chat's first message is answered with
      // the setup list, never sent to a model; the chat's model answers what
      // comes after it.
      const helpFirst = Boolean(first && !first.attachments?.length && setupHelpIntent(first.text));
      const conv: Conversation = {
        id,
        title: opts?.title ?? 'New chat',
        source,
        ...(projectId ? { projectId } : {}),
        repoIds,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        thread: { ...emptyThread(), items: seedItems },
        ...(first && !helpFirst ? { pendingFirstMessage: first.text } : {}),
      };
      set((s) => ({
        conversations: { ...s.conversations, [id]: conv },
        order: [id, ...s.order],
        activeId: id,
        view: 'chat',
        drawerOpen: false,
      }));
      if (first && helpFirst) {
        appendUserLine(id, first.text);
        logEvent('setup_menu_asked', { via: 'new_chat' });
        showSetupMenu(setupMenuProgress(id));
      }
      if (first) void persistConversations(get());
      building.add(id);
      try {
        // Create the default bucket now, if none existed, and patch it onto the
        // conversation before the driver is built (so its instructions carry the
        // project's brief). The chat is already on screen throughout.
        if (!projectId) {
          projectId = await get().createProject('My work');
          set((s) => {
            const c = s.conversations[id];
            if (!c) return s;
            return { conversations: { ...s.conversations, [id]: { ...c, projectId } } };
          });
        }
        const built = get().conversations[id] ?? conv;
        const driver = await buildDriver(
          built,
          seedItems.length ? seedFromTranscript(seedItems) : undefined,
          opts?.handoff ? { handoff: opts.handoff } : undefined,
        );
        attachDriver(id, driver);
      } catch (err) {
        failOpen(id, err);
      } finally {
        building.delete(id);
      }
      void persistConversations(get());
      return id;
    },

    async switchModel(source, opts) {
      const { activeId } = get();
      const conv = activeId ? get().conversations[activeId] : undefined;
      // Only chat brains carry a thread forward. A repo agent ('desktop') or the
      // demo ('mock') is a different mode; with nothing to carry, or no open
      // chat, just open a fresh chat with the chosen brain.
      const seedable =
        source.kind === 'stack' ||
        source.kind === 'cloud' ||
        source.kind === 'device' ||
        source.kind === 'desktop-chat';
      // The computer's agent takes no message history (CTO J12): a chat
      // carried to it opens a new agent chat whose first task starts from the
      // handoff, and a note there says what came along.
      if (
        source.kind === 'desktop' &&
        activeId &&
        conv &&
        conv.source.kind !== 'desktop' &&
        seedFromTranscript(conv.thread.items).length > 0
      ) {
        if (conv.thread.busy) {
          get().showToast('Let the current reply finish, then switch.');
          return;
        }
        let handoff: { text: string; turns: number } | undefined;
        try {
          handoff = wholeHandoff(conv.thread.items, {
            from: conv.thread.model?.name ?? sourceLabel(conv.source),
            date: localDate(),
          });
        } catch {
          handoff = undefined;
        }
        const label = sourceLabel(source);
        const note: ThreadItem = {
          kind: 'note',
          id: newId(),
          text: handoff ? desktopHandoffNote(label, handoff.turns) : `Now using ${label}.`,
        };
        await get().newConversation(source, {
          seedItems: [note],
          repoIds: conv.repoIds,
          ...(handoff ? { handoff: handoff.text } : {}),
        });
        return;
      }
      if (!activeId || !conv || conv.thread.items.length === 0 || !seedable) {
        await get().newConversation(source);
        return;
      }
      // Never swap under a live turn or a pending step (CTO guardrails): that
      // would abort a stream mid-token or orphan an approval bound to the old
      // driver. Claude does not let you switch mid-stream either.
      if (conv.thread.busy) {
        get().showToast('Let the current reply finish, then switch.');
        return;
      }
      if (conv.thread.pendingApprovals.length) {
        get().showToast('Answer the pending step first, then switch.');
        return;
      }
      // Resending the failed message: seed the history before it, so the new
      // brain does not see the same question twice in a row.
      const lastUserAt = conv.thread.items.map((i) => i.kind).lastIndexOf('user');
      const resendItem =
        opts?.resend && lastUserAt >= 0 ? conv.thread.items[lastUserAt] : undefined;
      const carried = resendItem ? conv.thread.items.slice(0, lastUserAt) : conv.thread.items;
      // The handoff (CTO J12): the whole chat when it fits the new seat's
      // window, else a summary of what drops plus the newest turns that fit.
      // Conversation content, so it rides even with Memory off. A core that
      // cannot build one leaves the switch as it was: the whole transcript.
      const date = localDate();
      const from = conv.thread.model?.name ?? sourceLabel(conv.source);
      let plan: SwitchSeedPlan | undefined;
      try {
        plan = planSwitchSeed({
          items: carried,
          servedTokens: composerSeatFor(source, { anchorOnly: true }).servedTokens,
          system: standingContext(conv),
          from,
          date,
        });
      } catch {
        plan = undefined;
      }
      const seed = plan?.seed ?? seedFromTranscript(carried);
      // The spoken turns on screen when the switch began, so anything the walk
      // writes while the driver builds can be handed over after (below).
      const turnsAtStart = seedFromTranscript(conv.thread.items).length;
      // This switch is now the chat's newest build: an open still building the
      // old brain's driver, or an earlier switch still building, loses to it.
      const epoch = bumpDriverEpoch(activeId);
      // Build the new driver BEFORE committing the model change. If the build
      // fails (for example a Claude model with no key stored), the conversation
      // stays on its current brain instead of showing the new model in the top
      // bar while the old driver keeps answering.
      let driver: ChatDriver;
      try {
        driver = await buildDriver(
          { ...conv, source, thread: { ...conv.thread, model: undefined } },
          seed,
        );
      } catch (err) {
        if (driverEpoch.get(activeId) === epoch) {
          get().showToast(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      // The build awaited (a key read, a session open). Whatever changed in
      // that time wins over this switch: a later switch, a message sent to the
      // old brain (it is answering now), or a step waiting on the person.
      const latest = get().conversations[activeId];
      if (driverEpoch.get(activeId) !== epoch || !latest) {
        driver.dispose();
        return;
      }
      if (latest.thread.busy || latest.thread.pendingApprovals.length) {
        driver.dispose();
        get().showToast(
          latest.thread.busy
            ? 'Let the current reply finish, then switch.'
            : 'Answer the pending step first, then switch.',
        );
        return;
      }
      // A line the walk wrote while the driver was building is in the
      // transcript but not the seed; hand it over so the model sees it.
      for (const turn of seedFromTranscript(latest.thread.items).slice(turnsAtStart)) {
        driver.recordLine?.(turn);
      }
      // attachDriver disposes the old driver and keeps the thread, so the
      // visible history is untouched; the new driver starts with the seeded
      // transcript so the next turn has full context.
      attachDriver(activeId, driver);
      // Disclose when a private on-device chat's history is about to cross to a
      // network brain, and when earlier images will not carry over. No request
      // fires until the next send, so these notes land before anything leaves.
      const crossedToNetwork = conv.source.kind === 'device' && source.kind !== 'device';
      let text = switchNoteText(sourceLabel(source), plan);
      if (crossedToNetwork) {
        text += " Your next message sends this chat's history to it for context.";
      }
      if (conv.hadVisionInput) {
        text += ' Images from earlier in this chat are not carried across the switch.';
      }
      // The note carries a handoff for "Save to Vault": the seed's, or one of
      // the whole chat. It is also the project's latest in the device store,
      // read the next day (J13), unless Memory is off.
      const project = conv.projectId
        ? get().settings.projects?.find((p) => p.id === conv.projectId)
        : undefined;
      let kept = plan?.handoff;
      if (!kept && plan) {
        try {
          kept = wholeHandoff(carried, { from, date });
        } catch {
          kept = undefined;
        }
      }
      if (kept && conv.projectId && memoryOverride(get().settings) !== false) {
        void writeHandoff(handoffStorage, conv.projectId, {
          text: kept.text,
          at: new Date().toISOString(),
          model: from,
          turns: kept.turns,
          conversationId: activeId,
        }).catch(() => {});
      }
      set((s) => {
        const c = s.conversations[activeId];
        if (!c) return s;
        const note: ThreadItem = {
          kind: 'note',
          id: newId(),
          text,
          ...(kept
            ? {
                handoff: {
                  text: kept.text,
                  date,
                  ...(project?.name ? { project: project.name } : {}),
                },
              }
            : {}),
        };
        return {
          conversations: {
            ...s.conversations,
            [activeId]: {
              ...c,
              source,
              thread: { ...c.thread, model: undefined, items: [...c.thread.items, note] },
              updatedAt: new Date().toISOString(),
            },
          },
        };
      });
      void persistConversations(get());
      if (resendItem?.kind === 'user') get().send(resendItem.text);
    },

    rescueSourceFor(conversationId) {
      const conv = get().conversations[conversationId];
      if (!conv) return undefined;
      return rescueSource(conv.source, {
        harborLiteHost: platform() === 'ios',
        harborLite: { modelId: HARBOR_MINI_MODEL_ID, modelName: HARBOR_MINI_MODEL_NAME },
        stackReady: get().sourceReady({ kind: 'stack' }),
      });
    },

    async continueElsewhere() {
      const { activeId } = get();
      if (!activeId) return;
      const source = get().rescueSourceFor(activeId);
      if (!source) return;
      const harborLite = source.kind === 'device' && source.modelId === HARBOR_MINI_MODEL_ID;
      if (harborLite && !get().settings.harborMiniReady) {
        get().showToast(`Getting ${HARBOR_MINI_MODEL_NAME} ready. The chat picks up when it is.`);
        const ok = await get().ensureHarborMini();
        if (!ok) {
          get().showToast(
            `${HARBOR_MINI_MODEL_NAME} did not download. Try again, or pick a model.`,
          );
          return;
        }
        // The person may have moved on while it downloaded.
        if (get().activeId !== activeId) return;
      }
      logEvent('chat_rescued', { to: source.kind });
      await get().switchModel(source, { resend: true });
    },

    startNewChat() {
      set({ activeId: undefined, view: 'chat', viewTrail: [], drawerOpen: false });
    },

    startWritingVoiceChat() {
      get().startNewChat();
      set((st) => ({ composerSeed: writingVoiceSeed(st.composerSeed) }));
    },

    clearComposerSeed() {
      if (get().composerSeed) set({ composerSeed: undefined });
    },

    async applyAppAction(key, value) {
      const plan = appActionPlan(key, value);
      if (!plan) return false;
      await get().saveSettings(plan.patch);
      get().showToast(plan.toast);
      logEvent('app_action_applied', { key });
      return true;
    },

    sendWhenAttached(conversationId, text, attachments) {
      const driver = drivers.get(conversationId);
      if (driver) {
        deliver(conversationId, driver, text, attachments);
        return;
      }
      // APP-10: the driver attaches asynchronously (a session still opening on
      // the hub), or its build failed and the next open rebuilds it. Hold the
      // message on the chat, persisted, and let the attach deliver it. No
      // timer, so a slow open or a relaunch mid-open never drops the first
      // message. A second message while one is already parked queues behind
      // it, the same as a message typed mid-run.
      set((state) => {
        const c = state.conversations[conversationId];
        if (!c) return state;
        if (c.pendingFirstMessage) {
          return {
            conversations: {
              ...state.conversations,
              [conversationId]: {
                ...c,
                thread: { ...c.thread, queued: [...c.thread.queued, text] },
              },
            },
          };
        }
        pendingSends.set(conversationId, attachments);
        return {
          conversations: {
            ...state.conversations,
            [conversationId]: { ...c, pendingFirstMessage: text, pendingFirstError: undefined },
          },
        };
      });
      void persistConversations(get());
    },

    retryPending(conversationId) {
      set((state) => {
        const c = state.conversations[conversationId];
        if (!c || !c.pendingFirstError) return state;
        return {
          conversations: {
            ...state.conversations,
            [conversationId]: { ...c, pendingFirstError: undefined },
          },
        };
      });
      const driver = drivers.get(conversationId);
      if (driver) {
        flushPendingFirstMessage(conversationId, driver);
        return;
      }
      ensureDriver(conversationId);
    },

    async holdFirstMessage(text, attachments) {
      heldAttachments = attachments;
      await get().saveSettings({ heldFirstMessage: { text, at: new Date().toISOString() } });
    },

    takeHeldFirstMessage() {
      const held = get().settings.heldFirstMessage;
      if (!held) return undefined;
      const attachments = heldAttachments;
      heldAttachments = undefined;
      void get().saveSettings({ heldFirstMessage: undefined });
      return { text: held.text, attachments };
    },

    async discardHeldFirstMessage() {
      heldAttachments = undefined;
      await get().saveSettings({ heldFirstMessage: undefined });
    },

    async holdUntilReady(text, attachments) {
      const prev = get().settings.heldFirstMessage;
      const kept = prev ? (heldAttachments ?? []) : [];
      const all = [...kept, ...(attachments ?? [])];
      heldAttachments = all.length ? all : undefined;
      await get().saveSettings({
        heldFirstMessage: {
          text: joinHeld(prev?.text, text),
          at: new Date().toISOString(),
          untilReady: true,
        },
      });
    },

    settleHeldMessage({ chooserOpen }) {
      const s = get();
      const status = s.desktopStatus;
      const defaultSource = s.composerDefaultSource();
      const plan = heldMessagePlan({
        held: s.settings.heldFirstMessage,
        emptyChat: s.view === 'chat' && !s.activeId,
        chooserOpen,
        engineReady:
          (defaultSource.kind === 'desktop' || defaultSource.kind === 'desktop-chat') &&
          s.sourceReady(defaultSource),
        statusKnown: !isDesktop() || status !== undefined,
        seatUp: s.sendWaitsOnFirstSeat(),
      });
      if (plan === 'restore') return get().takeHeldFirstMessage();
      if (plan !== 'send') return undefined;
      const held = get().takeHeldFirstMessage();
      if (!held) return undefined;
      get().showToast(FIRST_SEAT_COPY.sending);
      logEvent('held_message_sent', { kind: defaultSource.kind });
      void get()
        .newConversation(defaultSource, {
          firstMessage: { text: held.text, attachments: held.attachments },
        })
        .then((id) => {
          // Nothing opened (a door in the way): hold it again for the
          // composer, so the words are never lost.
          if (!id) void get().holdFirstMessage(held.text, held.attachments);
        });
      return undefined;
    },

    composerDefaultSource() {
      const s = get();
      return defaultComposerSource({
        desktop: isDesktop(),
        needsAccount: s.needsAccountNow(),
        engineChat: engineChatReady(s.desktopStatus),
        stackReady: s.sourceReady({ kind: 'stack' }),
      });
    },

    sendWaitsOnFirstSeat() {
      const s = get();
      return waitsOnFirstSeat({
        desktop: isDesktop(),
        statusKnown: s.desktopStatus !== undefined,
        configured: Boolean(s.desktopStatus?.stack.configured),
        cloudReady: s.cloudKeyPresent,
      });
    },

    async createProject(name) {
      const id = `p${Date.now().toString(36)}${(convSeq++).toString(36)}`;
      const project: Project = {
        id,
        name: name.trim() || 'Untitled project',
        repoIds: [],
        createdAt: new Date().toISOString(),
      };
      const projects = [...(get().settings.projects ?? []), project];
      await get().saveSettings({ projects, activeProjectId: id });
      logEvent('project_create');
      return id;
    },

    setActiveProject(id) {
      void get().saveSettings({ activeProjectId: id });
      logEvent('project_activate');
    },

    openProject(id) {
      // The detail room is a sub-page of the Projects list, so setView pushes
      // Projects onto the trail and the room's top bar offers a way back.
      set({ viewProjectId: id });
      get().setView('project');
      logEvent('project_open');
    },

    openCrewCommand() {
      // A sub-page of Crew: setView pushes Crew onto the trail, so the top
      // bar offers a way back to the roster.
      get().setView('crewcommand');
      logEvent('crew_command_open');
      void get().refreshRoutines();
    },

    crewControl() {
      const s = get();
      return computeCrewControl({
        onDesktop: isDesktop() && Boolean(bridge()),
        hasDaemon: Boolean(s.settings.daemon),
        homeReachable: s.connectivity.homeReachable,
        preferRemoteHub: s.settings.preferRemoteHub,
      });
    },

    async refreshRoutines() {
      const control = get().crewControl();
      // Not set up anywhere: nothing to show but the dormant capabilities.
      if (control.where === 'unpaired') {
        set((s) => ({
          routines: { ...s.routines, loaded: true, available: false, live: false },
        }));
        return;
      }
      // Away from home (offshore/offline): the machine is unreachable, so serve
      // the cached snapshot rather than hang on a fetch that cannot land. The
      // dashboards stay viewable; control is off until we are docked again.
      if (!control.can) {
        set((s) => ({
          routines: { ...s.routines, loaded: true, available: true, live: false },
        }));
        return;
      }
      const client = routinesClient(get().settings);
      if (!client) {
        set((s) => ({
          routines: { ...s.routines, loaded: true, available: false, live: false },
        }));
        return;
      }
      try {
        const snap = await client.list();
        // A routine follows the person's web search switch (founder,
        // 2026-10-01): when this computer's copy differs, carry it over. A
        // failure leaves routines offline, the safe side.
        const wantSearch = webSearchOn(get().settings.webSearchConsent);
        if (snap.webSearch !== undefined && snap.webSearch !== wantSearch) {
          void client.setWebSearch(wantSearch).catch(() => undefined);
        }
        set({
          routines: {
            routines: snap.routines,
            runs: snap.runs,
            loaded: true,
            available: true,
            live: true,
            where: client.where,
            clock: snap.clock,
            error: undefined,
          },
        });
        void persistRoutines(snap.routines, snap.runs);
      } catch (err) {
        // A read that fails while we believed we were docked (home dropped
        // mid-poll): keep the cache and fall back to view-only rather than
        // blank the dashboards.
        set((s) => ({
          routines: {
            ...s.routines,
            loaded: true,
            available: true,
            live: false,
            where: client.where,
            error: err instanceof Error ? err.message : String(err),
          },
        }));
      }
    },

    async createRoutine(input) {
      // Making a routine is Crew's work: it needs the free sign-in.
      if (!requireAccount('crew')) return undefined;
      if (!get().crewControl().can) {
        get().showToast(CONTROL_REQUIRES_DOCK);
        return undefined;
      }
      const client = routinesClient(get().settings);
      if (!client) {
        get().showToast('Connect your computer first. Routines run there.');
        return undefined;
      }
      try {
        const routine = await client.create(input);
        logEvent('routine_created', { access: input.access ?? 'read-only' });
        await get().refreshRoutines();
        // A routine that needs you should reach your phone: register for the
        // computer's notifications now, not only when a desktop chat opens.
        void ensureDesktopPush();
        return routine;
      } catch (err) {
        get().showToast(err instanceof Error ? err.message : String(err));
        return undefined;
      }
    },

    async updateRoutine(id, patch) {
      // Editing or resuming a routine needs the sign-in; pausing one never does.
      if (!routinePause(patch) && !requireAccount('crew')) return;
      if (!get().crewControl().can) {
        get().showToast(CONTROL_REQUIRES_DOCK);
        return;
      }
      const client = routinesClient(get().settings);
      if (!client) return;
      // Optimistic for the switch, so a pause answers the finger at once; the
      // refresh below settles it either way.
      set((s) => ({
        routines: {
          ...s.routines,
          routines: s.routines.routines.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        },
      }));
      try {
        await client.update(id, patch);
        logEvent('routine_updated');
      } catch (err) {
        get().showToast(err instanceof Error ? err.message : String(err));
      }
      await get().refreshRoutines();
    },

    async deleteRoutine(id) {
      if (!get().crewControl().can) {
        get().showToast(CONTROL_REQUIRES_DOCK);
        return;
      }
      const client = routinesClient(get().settings);
      if (!client) return;
      try {
        await client.remove(id);
        logEvent('routine_deleted');
      } catch (err) {
        get().showToast(err instanceof Error ? err.message : String(err));
      }
      await get().refreshRoutines();
    },

    async runRoutineNow(id) {
      if (!requireAccount('crew')) return;
      if (!get().crewControl().can) {
        get().showToast(CONTROL_REQUIRES_DOCK);
        return;
      }
      const client = routinesClient(get().settings);
      if (!client) return;
      try {
        await client.run(id);
        logEvent('routine_run_now');
      } catch (err) {
        get().showToast(err instanceof Error ? err.message : String(err));
      }
      await get().refreshRoutines();
    },

    async stopRoutine(id) {
      if (!get().crewControl().can) {
        get().showToast(CONTROL_REQUIRES_DOCK);
        return;
      }
      const client = routinesClient(get().settings);
      if (!client) return;
      try {
        await client.stop(id);
      } catch (err) {
        get().showToast(err instanceof Error ? err.message : String(err));
      }
      await get().refreshRoutines();
    },

    async readRoutineNote(runId) {
      const client = routinesClient(get().settings);
      if (!client) return null;
      try {
        return await client.note(runId);
      } catch {
        return null;
      }
    },

    async openRoutineRun(run) {
      if (!run.sessionId) {
        get().showToast('That slot was missed, so there is no transcript.');
        return;
      }
      const routine = get().routines.routines.find((r) => r.id === run.routineId);
      const from = get().view;
      await get().openDesktopSession({
        id: run.sessionId,
        cwd: routine?.cwd ?? '',
        title: routine ? routine.name : undefined,
      });
      // The transcript is a page inside the command center: its way back is
      // the center, not the Chats list.
      if (from === 'crewcommand' && get().view === 'chat') set({ viewTrail: ['crewcommand'] });
      logEvent('routine_transcript_open');
    },

    openProjectMemory(id) {
      // The read-only notes view opens from the Vault, over the Vault's own
      // list, so setView pushes Vault onto the trail and the top bar offers a
      // way back to it.
      set({ viewProjectId: id });
      get().setView('projectmemory');
      logEvent('project_memory_open');
    },

    startProjectChat(projectId) {
      // A fresh, empty chat scoped to the project. Making the project active is
      // what binds the chat to it (newConversation reads activeProjectId on the
      // first send); the ['project'] trail gives the chat a way back to here.
      get().setActiveProject(projectId);
      set({
        activeId: undefined,
        view: 'chat',
        viewTrail: ['project'],
        viewProjectId: projectId,
        drawerOpen: false,
        arrivedBack: false,
      });
    },

    async updateProject(id, patch) {
      const project = get().settings.projects?.find((p) => p.id === id);
      const touchesContent =
        patch.name !== undefined || patch.instructions !== undefined || patch.repoIds !== undefined;
      // A shared project's content lives on the org server; the RLS-enforced
      // update_org_project RPC is the write path (only an editor may change it).
      if (project?.shared && project.serverId && touchesContent) {
        const token = await orgProjectToken();
        if (token) {
          try {
            const rev = await updateOrgProject(token, {
              serverId: project.serverId,
              name: patch.name ?? project.name,
              instructions: patch.instructions ?? project.instructions ?? '',
              repoIds: patch.repoIds ?? project.repoIds,
              baseRev: project.rev ?? 1,
            });
            await patchProjectLocal(id, { ...patch, rev });
          } catch (err) {
            // Do not write locally on refusal: the device must not drift from
            // the server the person actually cannot edit.
            get().showToast(err instanceof Error ? err.message : 'Could not save to the team.');
          }
          return;
        }
      }
      await patchProjectLocal(id, patch);
    },

    async setProjectAccess(projectId, access) {
      const project = get().settings.projects?.find((p) => p.id === projectId);
      // A shared project's roster is the server's; diff the draft against it and
      // apply each change through the RLS-enforced grant RPCs, then re-sync.
      if (project?.shared && project.serverId) {
        const token = await orgProjectToken();
        if (!token) {
          get().showToast('Sign in to change who can use this project.');
          return;
        }
        const before = new Map(
          (project.access ?? []).map((g) => [g.email.trim().toLowerCase(), g.level]),
        );
        const after = new Map(access.map((g) => [g.email.trim().toLowerCase(), g.level]));
        try {
          for (const [email, level] of after) {
            if (before.get(email) !== level) {
              await setOrgProjectAccess(token, project.serverId, email, level);
            }
          }
          for (const email of before.keys()) {
            if (!after.has(email)) await revokeOrgProjectAccess(token, project.serverId, email);
          }
        } catch (err) {
          get().showToast(err instanceof Error ? err.message : 'Could not update access.');
        }
        await get().syncOrgProjects(); // resnap to the server's truth either way
        logEvent('project_access_set', { grants: access.length, shared: true });
        return;
      }
      // Local project: a draft roster that ships when the project is shared.
      await patchProjectLocal(projectId, { access });
      logEvent('project_access_set', { grants: access.length });
    },

    async shareProject(id) {
      const account = get().settings.account;
      const orgId = account?.org?.serverId;
      if (account?.type !== 'commercial' || !orgId) {
        get().showToast('Sharing needs a company account signed in.');
        return;
      }
      if (!isOrgAdmin(account)) {
        get().showToast('Only an admin can share a project with the team.');
        return;
      }
      const project = get().settings.projects?.find((p) => p.id === id);
      if (!project || project.shared) return;
      const token = await orgProjectToken();
      if (!token) {
        get().showToast('Sign in to share a project.');
        return;
      }
      try {
        const serverId = await createOrgProject(token, {
          orgId,
          name: project.name,
          instructions: project.instructions ?? '',
          repoIds: project.repoIds,
        });
        // Push any grants drafted while the project was local.
        for (const g of project.access ?? []) {
          try {
            await setOrgProjectAccess(token, serverId, g.email, g.level);
          } catch {
            // A draft email that is not an org member is skipped; the admin can
            // re-add it from the roster once the person has a seat.
          }
        }
        await patchProjectLocal(id, {
          shared: true,
          serverId,
          orgId,
          rev: 1,
          myLevel: 'edit',
        });
        await get().syncOrgProjects();
        get().showToast('Shared with your team.');
        logEvent('project_shared');
      } catch (err) {
        get().showToast(err instanceof Error ? err.message : 'Could not share this project.');
      }
    },

    async unshareProject(id) {
      const project = get().settings.projects?.find((p) => p.id === id);
      if (!project?.shared || !project.serverId) return;
      const token = await orgProjectToken();
      if (token) {
        try {
          await deleteOrgProject(token, project.serverId);
        } catch (err) {
          get().showToast(err instanceof Error ? err.message : 'Could not stop sharing.');
          return;
        }
      }
      await patchProjectLocal(id, {
        shared: false,
        serverId: undefined,
        orgId: undefined,
        rev: undefined,
        myLevel: undefined,
      });
      get().showToast('No longer shared with the team.');
      logEvent('project_unshared');
    },

    async syncOrgProjects() {
      const account = get().settings.account;
      // Only a server-backed commercial org has shared projects to pull.
      if (account?.type !== 'commercial' || !account.org?.serverId) return;
      const token = await orgProjectToken();
      if (!token) return;
      try {
        const rows = await listOrgProjects(token);
        const merged = mergeSharedProjects(get().settings.projects ?? [], rows);
        await get().saveSettings({ projects: merged });
      } catch {
        // Offline, or the migration is not live yet: keep local projects as-is.
      }
    },

    async deleteProject(id) {
      const target = get().settings.projects?.find((p) => p.id === id);
      // A shared project is removed on the server too (the RPC needs edit). Bail
      // if the server refuses, so the row is not orphaned there.
      if (target?.shared && target.serverId) {
        const token = await orgProjectToken();
        if (token) {
          try {
            await deleteOrgProject(token, target.serverId);
          } catch (err) {
            get().showToast(err instanceof Error ? err.message : 'Could not delete this project.');
            return;
          }
        }
      }
      const projects = (get().settings.projects ?? []).filter((p) => p.id !== id);
      const activeProjectId =
        get().settings.activeProjectId === id ? undefined : get().settings.activeProjectId;
      await get().saveSettings({ projects, activeProjectId });
      // Wipe the project's sealed tokens and secrets so nothing lingers in the
      // device store after the project is gone.
      await writeProjectSecrets(id, '');
      // And its handoff (CTO J13): nothing of the project lingers here.
      await clearHandoffs(handoffStorage, { projectId: id }).catch(() => {});
      // Chats that lived in the project stay, but drop their now-dead link. Mark
      // them `unfiled` so the init orphan-migration does not re-adopt them into
      // another project on the next launch (P2-13).
      set((s) => {
        const conversations = { ...s.conversations };
        let touched = false;
        for (const [cid, conv] of Object.entries(conversations)) {
          if (conv.projectId === id) {
            conversations[cid] = { ...conv, projectId: undefined, unfiled: true };
            touched = true;
          }
        }
        return touched ? { conversations } : s;
      });
      void persistConversations(get());
      // If its detail room was open, there is nothing to show; fall back to the
      // Projects list.
      if (get().view === 'project' && get().viewProjectId === id) {
        set({ view: 'projects', viewProjectId: undefined, viewTrail: [] });
      }
      logEvent('project_delete');
    },

    async setupAccount(input) {
      set({ accountChoice: undefined });
      if (input.type === 'personal' || !featureOn('teams')) {
        await get().saveSettings({ account: { type: 'personal' } });
        logEvent('account_setup', { type: 'personal' });
        return;
      }
      const seatCount = Math.max(1, Math.floor(input.seatCount ?? 1));
      const tier = tierForSeats(seatCount);
      const ownerEmail = (input.ownerEmail ?? '').trim();
      const owner: OrgMember = {
        id: `m${Date.now().toString(36)}${(convSeq++).toString(36)}`,
        email: ownerEmail,
        role: 'admin',
        addedAt: new Date().toISOString(),
      };
      const org: Org = {
        id: `o${Date.now().toString(36)}${(convSeq++).toString(36)}`,
        name: input.orgName?.trim() || 'My company',
        seatCount,
        tierId: tier.id,
        priceYear: tier.priceYear,
        members: ownerEmail ? [owner] : [],
        createdAt: new Date().toISOString(),
      };
      await get().saveSettings({
        account: { type: 'commercial', org, selfEmail: ownerEmail || undefined },
      });
      logEvent('account_setup', { type: 'commercial', tier: tier.id });
      // If already signed in, create the org on the server now; otherwise it is
      // pushed on the owner's next sign-in (reconcileOrg).
      if (get().authSession) await reconcileOrg();
    },

    canGrowTeam() {
      return !growthGatedByBilling();
    },

    async setSeatCount(seatCount) {
      const account = get().settings.account;
      if (!account?.org || !isOrgAdmin(account)) return;
      const seats = Math.max(1, Math.floor(seatCount));
      // A1: raising the seat count is growth, so it needs an active entitlement.
      // Lowering or holding is always allowed. Buy/Manage Billing stays open, so
      // a lapsed org renews on the web and comes back unblocked.
      if (seats > account.org.seatCount && growthGatedByBilling()) {
        get().showToast('Renew your subscription to add seats. Your current team keeps working.');
        return;
      }
      const tier = tierForSeats(seats);
      const org: Org = {
        ...account.org,
        seatCount: seats,
        tierId: tier.id,
        priceYear: tier.priceYear,
      };
      await get().saveSettings({ account: { ...account, org } });
      logEvent('org_seats_set', { tier: tier.id });
      // BILLING: tier_id is webhook-owned now (RLS rejects a client write that
      // touches it), so send only seat_count + price_year. The local tier
      // derivation above stays for UX; org_entitlements is the source of truth.
      void orgWrite((s, orgId) =>
        supabaseUpdate('orgs', s.accessToken, `id=eq.${orgId}`, {
          seat_count: seats,
          price_year: tier.priceYear,
        }).then(() => undefined),
      );
    },

    async addMember(email, displayName) {
      const account = get().settings.account;
      if (!account?.org || !isOrgAdmin(account)) return;
      // A1: inviting a member consumes a seat, so it needs an active entitlement
      // on a server-backed org. Existing members are never affected.
      if (growthGatedByBilling()) {
        get().showToast(
          'Renew your subscription to add teammates. Your current team keeps working.',
        );
        return;
      }
      const clean = email.trim().toLowerCase();
      if (!clean || account.org.members.some((m) => m.email.toLowerCase() === clean)) return;
      const member: OrgMember = {
        id: `m${Date.now().toString(36)}${(convSeq++).toString(36)}`,
        email: email.trim(),
        displayName: displayName?.trim() || undefined,
        role: 'member',
        addedAt: new Date().toISOString(),
      };
      const org: Org = { ...account.org, members: [...account.org.members, member] };
      await get().saveSettings({ account: { ...account, org } });
      logEvent('org_member_add');
      // Invite the member on the server and stamp the local row with its id.
      void orgWrite(async (s, orgId) => {
        const [srv] = await supabaseInsert<ServerMember>('org_members', s.accessToken, {
          org_id: orgId,
          email: member.email,
          role: 'member',
          status: 'invited',
          invited_by: s.user.id,
        });
        const cur = get().settings.account;
        if (srv && cur?.org) {
          const members = cur.org.members.map((m) =>
            m.id === member.id ? { ...m, serverId: srv.id, status: 'invited' as const } : m,
          );
          await get().saveSettings({ account: { ...cur, org: { ...cur.org, members } } });
        }
      });
    },

    async removeMember(id) {
      const account = get().settings.account;
      if (!account?.org || !isOrgAdmin(account)) return;
      const removed = account.org.members.find((m) => m.id === id);
      const org: Org = {
        ...account.org,
        members: account.org.members.filter((m) => m.id !== id),
      };
      await get().saveSettings({ account: { ...account, org } });
      logEvent('org_member_remove');
      if (removed) {
        void orgWrite((s, orgId) =>
          supabaseDelete(
            'org_members',
            s.accessToken,
            `org_id=eq.${orgId}&email=eq.${encodeURIComponent(removed.email)}`,
          ),
        );
      }
    },

    async setMemberRole(id, role) {
      const account = get().settings.account;
      if (!account?.org || !isOrgAdmin(account)) return;
      const members = account.org.members.map((m) => (m.id === id ? { ...m, role } : m));
      // Never leave an org with no admin.
      if (!members.some((m) => m.role === 'admin')) {
        get().showToast('Keep at least one admin. Grant another before removing this one.');
        return;
      }
      await get().saveSettings({ account: { ...account, org: { ...account.org, members } } });
      logEvent('org_member_role', { role });
      const target = account.org.members.find((m) => m.id === id);
      if (target) {
        void orgWrite((s, orgId) =>
          supabaseUpdate(
            'org_members',
            s.accessToken,
            `org_id=eq.${orgId}&email=eq.${encodeURIComponent(target.email)}`,
            { role },
          ).then(() => undefined),
        );
      }
    },

    async setPreviewAsMember(on) {
      const account = get().settings.account;
      if (!account || !isOrgAdmin(account)) return;
      await get().saveSettings({ account: { ...account, previewAsMember: on } });
    },

    async sendSignInEmail(email) {
      const challenge = await openPendingSignIn(email);
      await sendEmailSignIn(email.trim(), authRedirectTo(), challenge);
    },

    async verifySignInCode(email, code) {
      const digits = codeDigits(code);
      if (!digits) throw new Error(CODE_REFUSED);
      let session: Session;
      try {
        session = await verifyEmailCode(addressKey(email), digits);
      } catch (err) {
        // GoTrue says "Token has expired or is invalid" for a wrong code too.
        if (/expired|invalid|otp/i.test(err instanceof Error ? err.message : '')) {
          throw new Error(CODE_REFUSED);
        }
        throw err;
      }
      const current = get().authSession;
      if (switchesAccount(current, session)) {
        dropRefused(session);
        throw new Error(signedInAsSomeoneElse(current!.user.email ?? '', session.user.email ?? ''));
      }
      await clearPendingSignIn();
      await signedInByEmail(session);
    },

    async completeAuthCallback(url) {
      const read = readAuthCallback(url);
      if (!read) return false;
      if (read.kind === 'refused') {
        get().showToast(
          /expired|invalid|denied/i.test(read.reason) ? LINK_EXPIRED : plainError(read.reason),
        );
        return false;
      }
      // PKCE: only the device that asked holds the verifier. With none (another
      // device's link, an expired request, or a link something else opened)
      // there is nothing to trade, so nothing signs in.
      const pending = await readPendingSignIn();
      if (!pending) {
        get().showToast(LINK_ELSEWHERE);
        return false;
      }
      let session: Session;
      try {
        session = await exchangeAuthCode(read.code, pending.verifier);
      } catch (err) {
        get().showToast(
          /expired|invalid|not found|flow state/i.test(err instanceof Error ? err.message : '')
            ? LINK_EXPIRED
            : plainError(err),
        );
        return false;
      }
      const current = get().authSession;
      if (switchesAccount(current, session)) {
        dropRefused(session);
        get().showToast(signedInAsSomeoneElse(current!.user.email ?? '', session.user.email ?? ''));
        return false;
      }
      await clearPendingSignIn();
      await signedInByEmail(session);
      return true;
    },

    async confirmByCode(code) {
      const current = get().authSession;
      const email = current?.user.email;
      if (!current || !email) throw new Error('Sign in first.');
      const digits = codeDigits(code);
      if (!digits) throw new Error(CODE_REFUSED);
      let session: Session;
      try {
        session = await verifyEmailCode(addressKey(email), digits);
      } catch (err) {
        if (/expired|invalid|otp/i.test(err instanceof Error ? err.message : '')) {
          throw new Error(CODE_REFUSED);
        }
        throw err;
      }
      // Only ever this account: a renewal, never a switch.
      if (session.user.id !== current.user.id) {
        dropRefused(session);
        throw new Error(CODE_REFUSED);
      }
      await clearPendingSignIn();
      await saveSession(session);
      set({ authSession: session });
      // The session it renews ends, so one sign-in is live here, not two.
      dropRefused(current);
    },

    async signInWithPasskey() {
      const got = await passkeySignIn();
      const session: Session = {
        accessToken: got.access_token,
        refreshToken: got.refresh_token,
        expiresAt: Date.now() + got.expires_in * 1000,
        user: { id: got.user.id, email: got.user.email },
      };
      const current = get().authSession;
      if (switchesAccount(current, session)) {
        dropRefused(session);
        throw new Error(signedInAsSomeoneElse(current!.user.email ?? '', session.user.email ?? ''));
      }
      await onSignedIn(session);
      if (!get().settings.passkeyUsedHere) await get().saveSettings({ passkeyUsedHere: true });
    },

    async addPasskey() {
      const token = await accessToken();
      if (!token) throw new Error('Sign in first.');
      // 0028's trigger refuses a passkey without a fresh email sign-in; ask
      // for the code first rather than meet that refusal.
      if (!recentEmailProof(token)) return 'confirm';
      await passkeyAdd(token);
      await get().saveSettings({ passkeyUsedHere: true, passkeyOfferDismissed: true });
      return 'added';
    },

    async listPasskeys() {
      const token = await accessToken();
      if (!token) return [];
      return passkeyList(token);
    },

    async removePasskey(id) {
      const token = await accessToken();
      if (!token) throw new Error('Sign in first.');
      await passkeyRemove(token, id);
    },

    async setAppLock(next) {
      // Turning it on, off, or changing the time each takes one unlock, so
      // nobody holding the phone unlocked can switch it off.
      if (!(await askUnlock())) return false;
      const was = get().settings.appLock?.on === true;
      await get().saveSettings({ appLock: next.on ? next : undefined });
      if (was !== next.on) get().showToast(next.on ? APP_LOCK_ON : APP_LOCK_OFF);
      return true;
    },

    lockApp() {
      if (get().settings.appLock?.on) set({ appLocked: true });
    },

    async unlockApp() {
      if (await askUnlock()) set({ appLocked: undefined });
    },

    async joinOrg() {
      const waiting = get().orgJoin;
      if (!waiting) return;
      set({ orgJoin: undefined });
      await adoptOrg(waiting.org, get().authSession?.user.email);
      await get().refreshOrgRole();
      void get().refreshEntitlement();
      void get().syncOrgProjects();
      get().showToast(`You joined ${waiting.org.name}.`);
      logEvent('org_joined');
    },

    async declineOrg() {
      const waiting = get().orgJoin;
      set({ orgJoin: undefined });
      const id = waiting?.org.serverId;
      if (!id) return;
      const declined = get().settings.declinedOrgIds ?? [];
      if (!declined.includes(id)) await get().saveSettings({ declinedOrgIds: [...declined, id] });
      logEvent('org_join_declined');
    },

    async signOutAccount() {
      // Only this device's sign-in ends (CX ruling 4), with a live token, and
      // the sign-out finishes here whatever the server says, offline too.
      const session = get().authSession;
      if (session) await revokeHere(session, { fresh: freshSession, logout: supabaseSignOut });
      await forgetSession();
      if (session) get().showToast(SIGNED_OUT_HERE);
      logEvent('auth_sign_out');
    },

    async signOutEverywhere() {
      const outcome = await revokeEverywhere({ fresh: freshAuth, logout: supabaseSignOut });
      if (outcome === 'failed') get().showToast(SIGN_OUT_EVERYWHERE_FAILED);
      if (outcome !== 'done') return false;
      await forgetSession();
      get().showToast(SIGNED_OUT_EVERYWHERE);
      logEvent('auth_sign_out_everywhere');
      return true;
    },

    async unsentTeamTextCount() {
      const uid = get().authSession?.user.id;
      return uid ? countTeamDrafts(uid) : 0;
    },

    async deleteAccount() {
      const outcome = await runAccountDeletion({
        session: freshAuth,
        invoke: (token) => invokeFunctionWithCode<DeleteAccountAnswer>('delete-account', token, {}),
        authState: (token) => authUserState(token),
        // Deleted: a sign-out, nothing of the account kept. A dead sign-in
        // (the account may still be there) ends the way the session door
        // ends one on a dead refresh token, so unsent team vault text stays
        // sealed for the same account.
        forgetSession: () => forgetSession(),
        endSignIn: () => forgetSession(true),
        clearPendingAppleLink: () => storeDelete(RETIRED_APPLE_LINK_KEY),
      });
      logEvent(outcome.kind === 'deleted' ? 'account_deleted' : `account_delete_${outcome.kind}`);
      return outcome;
    },

    async refreshOrgRole() {
      const account = get().settings.account;
      try {
        const fresh = await freshAuth();
        if (!fresh) return;
        // The role in the org this device points at, when it has one: a
        // membership of any other org opens nothing of this one (round 7
        // E13), and a join points the device at its org first.
        const orgId = account?.org?.serverId;
        const inOrg = orgId ? `&org_id=eq.${encodeURIComponent(orgId)}` : '';
        const rows = await supabaseSelect<{ role: 'admin' | 'member'; status: string }>(
          'org_members',
          fresh.accessToken,
          `select=role,status&user_id=eq.${fresh.user.id}&status=eq.active${inOrg}`,
        );
        const role = rows.find((r) => r.role === 'admin')
          ? 'admin'
          : rows.length
            ? 'member'
            : undefined;
        set({ serverRole: role });
        // Mirror the verified email onto the account so the UI reflects it.
        if (account && fresh.user.email && account.selfEmail !== fresh.user.email) {
          await get().saveSettings({ account: { ...account, selfEmail: fresh.user.email } });
        }
      } catch {
        // Offline or transient: keep whatever role we last knew.
      }
    },

    async refreshEntitlement() {
      return readEntitlementsNow();
    },

    async reconcileEntitlementOnForeground() {
      const s = get();
      // Only a synced commercial org has billing to re-read (team seats).
      if (!authConfigured() || !s.authSession || !s.settings.account?.org?.serverId) return;
      if (isEntitled(s.entitlement)) return;
      const now = Date.now();
      if (now - lastEntitlementForegroundAt < 30000) return;
      lastEntitlementForegroundAt = now;
      await get().refreshEntitlement();
    },

    async onCheckoutReturn() {
      if (!authConfigured() || !get().authSession) return;
      await get().refreshEntitlement();
      get().showToast(
        isEntitled(get().entitlement)
          ? 'Payment received. Your team seats are ready.'
          : 'Payment received. Your seats will appear shortly.',
      );
    },

    async manageBilling() {
      const serverId = get().settings.account?.org?.serverId;
      let session: Session | undefined;
      try {
        session = await freshAuth();
      } catch {
        session = undefined;
      }
      if (!session) {
        // Not signed in: still send them to the web page.
        openExternal(BILLING_URL);
        return;
      }
      // A subscribed commercial org gets the Stripe customer portal, in the
      // system browser; otherwise the web purchase page.
      if (get().entitlement && serverId) {
        try {
          const { url } = await supabaseInvoke<{ url: string }>(
            'stripe-portal',
            session.accessToken,
            { orgId: serverId },
          );
          openExternal(url);
          return;
        } catch (err) {
          get().showToast(err instanceof Error ? err.message : 'Could not open billing.');
        }
      }
      openExternal(BILLING_URL);
    },

    async authorizeAdmin() {
      // Server truth when signed in; the local UX check otherwise. The server
      // (RLS + role-gated daemon) is the real enforcement; this gate only
      // decides whether to attempt the action.
      if (authConfigured() && get().authSession) {
        await get().refreshOrgRole();
        const role = get().serverRole;
        if (role) return role === 'admin';
      }
      return isOrgAdmin(get().settings.account);
    },

    async connectCodemagic(token) {
      await secretSet(CODEMAGIC_SECRET_KEY, token.trim());
      set({ codemagicConnected: true });
      logEvent('codemagic_connected');
    },

    async disconnectCodemagic() {
      await secretDelete(CODEMAGIC_SECRET_KEY);
      set({ codemagicConnected: false });
      logEvent('codemagic_disconnected');
    },

    async saveLaunchTarget(target) {
      const id = target.id ?? `l${Date.now().toString(36)}${(convSeq++).toString(36)}`;
      const launch: LaunchState = {
        ...(get().settings.launch ?? { runs: [] }),
        target: { ...target, id },
      };
      await get().saveSettings({ launch });
      logEvent('launch_target_saved', { platform: target.platform });
    },

    async startBuild() {
      const launch = get().settings.launch;
      const target = launch?.target;
      if (!target) {
        get().showToast('Set up your launch target first.');
        return;
      }
      const runId = `b${Date.now().toString(36)}${(convSeq++).toString(36)}`;
      const run: BuildRun = { id: runId, status: 'queued', startedAt: new Date().toISOString() };
      // Two ways to update the run: memory-only (frequent poll ticks, no disk
      // churn) and persisted (meaningful transitions worth surviving a relaunch).
      const applyRun = (patch: Partial<BuildRun>): LaunchState => {
        const cur = get().settings.launch ?? { runs: [] };
        return { ...cur, runs: cur.runs.map((r) => (r.id === runId ? { ...r, ...patch } : r)) };
      };
      const touchRun = (patch: Partial<BuildRun>) =>
        set((s) => ({ settings: { ...s.settings, launch: applyRun(patch) } }));
      const persistRun = (patch: Partial<BuildRun>) =>
        get().saveSettings({ launch: applyRun(patch) });

      await get().saveSettings({
        launch: { ...launch, runs: [run, ...(launch?.runs ?? [])].slice(0, 10) },
      });
      logEvent('build_start', { platform: target.platform });

      try {
        const buildId = await triggerBuild({
          appId: target.appId,
          workflowId: target.workflowId,
          branch: target.branch,
        });
        await persistRun({ buildId, status: 'building' }); // worth surviving relaunch

        // Poll to a terminal state with gentle backoff. Intermediate status
        // ticks update memory only; we persist on real transitions.
        let delay = 5000;
        let lastStatus: string = 'building';
        for (let i = 0; i < 240; i++) {
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(delay + 3000, 30000);
          let info;
          try {
            info = await getBuild(buildId);
          } catch {
            continue; // a transient read failure; keep polling
          }
          if (info.status !== lastStatus) {
            touchRun({ status: info.status });
            lastStatus = info.status;
          }
          if (isTerminal(info.status)) {
            const patch: Partial<BuildRun> = {
              status: info.status,
              finishedAt: new Date().toISOString(),
            };
            if (info.status !== 'finished') {
              try {
                patch.excerpt = await buildLogExcerpt(info);
              } catch {
                patch.excerpt = 'The build failed, and its logs could not be read automatically.';
              }
            }
            await persistRun(patch);
            logEvent('build_done', { status: info.status });
            return;
          }
        }
        await persistRun({ status: 'unknown', error: 'Timed out following this build.' });
      } catch (err) {
        await persistRun({
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    async reviewBuild() {
      const s = get().settings;
      const target = s.launch?.target;
      const activeProjectId = s.activeProjectId ?? s.projects?.[0]?.id;
      const reviewers = (s.crew ?? []).filter(
        (a) =>
          a.activityLevel === 'review' &&
          (a.projectIds.length === 0 ||
            (activeProjectId != null && a.projectIds.includes(activeProjectId))),
      );
      if (!reviewers.length) return undefined;
      const convId = await get().newConversation({ kind: 'stack' });
      if (!convId) return undefined;
      const list = reviewers
        .map((a) => {
          const when = a.whenCalled?.trim() ? ` Focus: ${a.whenCalled.trim()}.` : '';
          return `- ${a.name}: ${a.persona.trim()}.${when}`;
        })
        .join('\n');
      const prompt = [
        `You are about to deploy${target ? ` ${target.platform} from branch ${target.branch}` : ''}. Give a short pre-deploy review.`,
        'Channel each reviewer below in their own voice, one brief perspective each, then a single go or hold call.',
        'This does not block the build. The user decides whether to proceed.',
        '',
        'Reviewers:',
        list,
      ].join('\n');
      get().sendWhenAttached(convId, prompt);
      logEvent('build_review', { reviewers: reviewers.length });
      return convId;
    },

    async diagnoseBuild(runId) {
      const launch = get().settings.launch;
      const run = launch?.runs.find((r) => r.id === runId);
      if (!run?.excerpt) {
        get().showToast('No readable build log for this run yet.');
        return;
      }
      const target = launch?.target;
      const convId = await get().newConversation({ kind: 'stack' });
      if (!convId) return;
      const prompt = [
        'A Codemagic build failed. Read this redacted build log and tell me, in order:',
        '1) the single root cause, 2) the exact fix, 3) which file or setting to change.',
        'Then say to run the build again. Be concrete and brief.',
        target ? `\nPlatform: ${target.platform}. Branch: ${target.branch}.` : '',
        '\nBuild log excerpt (secrets already redacted):\n```\n' + run.excerpt + '\n```',
      ].join('\n');
      get().sendWhenAttached(convId, prompt);
      const runs = (get().settings.launch?.runs ?? []).map((r) =>
        r.id === runId ? { ...r, diagnosisConvId: convId } : r,
      );
      await get().saveSettings({ launch: { ...get().settings.launch!, runs } });
      logEvent('build_diagnose');
    },

    async launchWithModel() {
      const s = get();
      if (!(s.settings.codemagicAccess === true && s.codemagicConnected)) {
        s.showToast('Turn on Codemagic Access in Settings first.');
        return undefined;
      }
      const target = s.settings.launch?.target;
      if (!target) {
        s.showToast('Set up your launch target first.');
        return undefined;
      }
      const convId = await get().newConversation({ kind: 'stack' });
      if (!convId) return undefined;
      const prompt = [
        `Launch my ${target.platform} app with Codemagic, from branch ${target.branch}.`,
        'Trigger a build and watch it. If it fails, read the log, find the single root cause, and tell me the exact fix.',
        'You can retry directly for a transient failure or a build-target change. For a code fix, tell me exactly what to change (I can apply it, or hand it to my computer), then build again once I confirm.',
        'When it is green, tell me plainly where it landed (TestFlight, the App Store, or Google Play).',
      ].join(' ');
      get().sendWhenAttached(convId, prompt);
      logEvent('launch_with_model', { platform: target.platform });
      return convId;
    },

    async connectRepoPlatform(id, token) {
      await secretSet(repoSecretKey(id), token.trim());
      set((s) => ({ connectedRepoPlatforms: { ...s.connectedRepoPlatforms, [id]: true } }));
      logEvent('repo_platform_connected', { platform: id, method: 'token' });
    },

    // One-tap OAuth (the GitHub App path and its GitLab/Bitbucket siblings).
    // The lib runs the consent + code exchange and stores the tokens where the
    // paste path stores a token, so the connected badge lights the same way.
    async connectRepoOAuth(id) {
      const res = await runRepoOAuthConnect(id);
      if (res.ok) {
        set((s) => ({ connectedRepoPlatforms: { ...s.connectedRepoPlatforms, [id]: true } }));
        logEvent('repo_platform_connected', { platform: id, method: 'oauth' });
      }
      return res;
    },

    // Finish a one-tap OAuth that returned after the app was evicted from memory
    // while the person authorized (a cold start): the in-memory connect flow is
    // gone, so the deep-link handler hands the launch URL here to complete the
    // exchange from the persisted attempt. Silent when there is nothing pending.
    async resumeRepoOAuth(url) {
      const res = await resumeRepoOAuthFromLink(url);
      if (!res.handled) return;
      const id = res.provider;
      const name = REPO_CONNECTORS.find((c) => c.id === id)?.name ?? 'The repository';
      if (res.ok && id) {
        set((s) => ({ connectedRepoPlatforms: { ...s.connectedRepoPlatforms, [id]: true } }));
        logEvent('repo_platform_connected', { platform: id, method: 'oauth-resumed' });
        get().showToast(`${name} connected.`);
      } else if (res.error) {
        get().showToast(res.error);
      }
    },

    async disconnectRepoPlatform(id) {
      // Clear both credential shapes: the pasted token and any OAuth tokens and
      // their bookkeeping, so remove is total whichever way it was connected.
      // The action id is a plain string; a non-repo id no-ops in both stores.
      await disconnectRepoOAuth(id as RepoPlatform);
      await secretDelete(repoSecretKey(id));
      // The cached repo list came from these tokens; it leaves with any of
      // them (APP-12), and the next open lists what is still connected.
      await clearRepoCache();
      set((s) => ({ connectedRepoPlatforms: { ...s.connectedRepoPlatforms, [id]: false } }));
      logEvent('repo_platform_disconnected', { platform: id });
    },

    async setHomeRepo(home) {
      // The home repo is a shared, admin-owned location (like the stack).
      if (!isOrgAdmin(get().settings.account)) {
        get().showToast('Only an admin sets the home repository.');
        return;
      }
      const repo: RepoState = { ...(get().settings.repo ?? { outbox: [] }), homeRepo: home };
      await get().saveSettings({ repo });
      logEvent('home_repo_set', { kind: home.kind });
    },

    async syncOutbox() {
      if (outboxSyncing) return;
      const s = get().settings;
      const daemon = s.daemon;
      const home = s.repo?.homeRepo;
      const outbox = s.repo?.outbox ?? [];
      if (!daemon) {
        get().showToast('Connect your computer to sync your waiting work.');
        return;
      }
      if (!home?.homePath) {
        get().showToast('Set the home repository path first, in Repositories.');
        return;
      }
      const pending = pendingForRepo(outbox, home.id);
      if (!pending.length) return;
      outboxSyncing = true;
      try {
        const deviceId = s.deviceId ?? 'dev_unknown';
        let items = [...outbox];
        const patch = (id: string, next: (typeof outbox)[number]) => {
          items = items.map((i) => (i.id === id ? next : i));
        };

        for (const item of pending) {
          let current = item;
          try {
            const res = await daemonApplyOutbox(daemon, {
              cwd: home.homePath,
              clientOpId: item.clientOpId,
              itemId: item.id,
              deviceId,
              branch: item.branch,
              message: item.message,
              baseCommit: item.baseCommit,
              files: item.files.map((f) => ({
                path: f.path,
                mode: f.mode,
                contentBase64: f.contentBase64,
              })),
            });
            current = applyResult(item, res);
          } catch (err) {
            current = {
              ...item,
              state: 'failed',
              attempts: item.attempts + 1,
              lastError: err instanceof Error ? err.message : String(err),
            };
          }
          patch(current.id, current);

          // Independent confirmation before an item is ever considered done. A 200
          // is not confirmation; the ref re-read is.
          if (current.state === 'offloading' && current.resultCommit) {
            try {
              const v = await daemonVerifyCommit(
                daemon,
                home.homePath,
                current.resultCommit,
                current.branch,
              );
              current = confirm(current, { refExists: v.exists, treeMatches: v.onBranch });
              patch(current.id, current);
            } catch {
              // The verify call itself failed (transient, or path not yet
              // allowed): leave the item offloading so it retries on the next
              // sync, rather than falsely marking a landed commit failed.
            }
          }

          // A conflict or failure halts this repo's batch: later items were
          // composed assuming the earlier ones landed.
          if (stopsBatch(current)) break;
        }

        // Re-read the live outbox at save time and merge our results into it,
        // rather than writing back the pre-sync snapshot. An item buffered while
        // this sync ran (bufferCommitIntent appends to settings) must survive
        // (DL-5). Apply our processed version where we have one, keep any newer
        // item untouched, and clear only confirmed items.
        const liveRepo = get().settings.repo;
        const live = liveRepo?.outbox ?? [];
        const processed = new Map(items.map((i) => [i.id, i]));
        const merged = live
          .map((i) => processed.get(i.id) ?? i)
          .filter((i) => i.state !== 'confirmed');
        const cleared = live.length - merged.length;
        await get().saveSettings({ repo: { ...(liveRepo ?? { outbox: [] }), outbox: merged } });
        logEvent('outbox_sync', { pending: pending.length, cleared });
      } finally {
        outboxSyncing = false;
      }
    },

    async bufferCommitIntent(input) {
      const s = get().settings;
      const existing = s.repo?.outbox ?? [];
      const files: OutboxFile[] = [];
      let addBytes = 0;
      let largest = 0;
      for (const f of input.files) {
        if (f.mode === 'delete') {
          files.push({ path: f.path, mode: 'delete', sha256: '' });
          continue;
        }
        const bytes = new Uint8Array(new TextEncoder().encode(f.content ?? ''));
        addBytes += bytes.length;
        largest = Math.max(largest, bytes.length);
        files.push({
          path: f.path,
          mode: 'upsert',
          sha256: await sha256Hex(bytes),
          contentBase64: bytesToBase64(bytes),
        });
      }
      // Enforce the caps that protect the pending window: refuse, never truncate.
      const currentTotal = existing
        .filter((i) => i.state !== 'confirmed')
        .reduce((n, i) => n + itemBytes(i), 0);
      if (!withinCaps(currentTotal, addBytes, largest)) {
        get().showToast(
          'That change is too large to buffer offline. Dock to sync, or split it up.',
        );
        return undefined;
      }
      const item: OutboxItem = {
        // Fixed-width time and sequence so the id sorts in creation order
        // lexicographically (the pendingForRepo ULID-order assumption): an
        // unpadded seq would put 'z' after '10' within the same millisecond.
        id: `o${Date.now().toString(36).padStart(9, '0')}${(convSeq++).toString(36).padStart(4, '0')}`,
        clientOpId: outboxOpId(),
        repoId: input.repoId,
        branch: input.branch,
        message: input.message,
        baseCommit: input.baseCommit,
        files,
        state: 'pending',
        attempts: 0,
        createdAt: new Date().toISOString(),
      };
      await get().saveSettings({
        repo: { ...(s.repo ?? { outbox: [] }), outbox: [...existing, item] },
      });
      logEvent('outbox_buffered', { files: files.length });
      return item.id;
    },

    exportBuffer() {
      const pending = (get().settings.repo?.outbox ?? []).filter((i) => i.state !== 'confirmed');
      return JSON.stringify(
        {
          version: 1,
          deviceId: get().settings.deviceId,
          exportedAt: new Date().toISOString(),
          items: pending,
        },
        null,
        2,
      );
    },

    async createCrewAgent(input) {
      // Making a crew member is Crew's work: it needs the free sign-in.
      // Deleting one never does.
      if (!requireAccount('crew')) return undefined;
      const id = `a${Date.now().toString(36)}${(convSeq++).toString(36)}`;
      const agent: CrewAgent = { ...input, id, createdAt: new Date().toISOString() };
      const crew = [...(get().settings.crew ?? []), agent];
      await get().saveSettings({ crew });
      logEvent('crew_create', { activityLevel: input.activityLevel });
      return id;
    },

    async updateCrewAgent(id, patch) {
      if (!requireAccount('crew')) return false;
      const crew = (get().settings.crew ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a));
      await get().saveSettings({ crew });
      return true;
    },

    async deleteCrewAgent(id) {
      const crew = (get().settings.crew ?? []).filter((a) => a.id !== id);
      await get().saveSettings({ crew });
      logEvent('crew_delete');
    },

    async ensureHarborMini() {
      if (get().settings.harborMiniReady) return true;
      logEvent('harbor_mini_download_start');
      set({ harborMiniDownload: { percent: 0, label: 'Connecting', indeterminate: true } });
      const handle = await Llama.addListener('downloadProgress', ({ id, completed, total }) => {
        if (id !== HARBOR_MINI_MODEL_ID) return;
        set({
          harborMiniDownload: {
            percent: total ? (completed / total) * 100 : 0,
            label: total
              ? `${Math.round((completed / total) * 100)}% of ${formatBytes(total)}`
              : 'Downloading',
            indeterminate: !total,
          },
        });
      });
      try {
        // A bundled Harbor Lite is a copy-in at first open, not a wait, so it
        // never asks for notices (never at launch); a real fetch does.
        if (!HARBOR_MINI_BUNDLED) void askForNotices();
        await Llama.downloadModel({
          id: HARBOR_MINI_MODEL_ID,
          url: HARBOR_MINI_MODEL_URL,
          notice: downloadNoticeCopy('Harbor Lite', HARBOR_MINI_MODEL_ID),
        });
        set({ harborMiniDownload: { percent: 100, label: 'Verifying', indeterminate: true } });
        await get().saveSettings({ harborMiniReady: true });
        logEvent('harbor_mini_ready');
        // Make Harbor Lite the Reasoning anchor, in every status, when the
        // stack has none or its anchor is a guide that is not on the device,
        // so My Stack chat works right away. Never demotes a ready Harbor.
        await promoteGuide(harborRef(), { harborMiniReady: true, preferred: false });
        set({ harborMiniDownload: undefined });
        return true;
      } catch (err) {
        // If the user cancelled, harborMiniDownload was already cleared; leave it
        // cleared rather than flashing a failure.
        if (get().harborMiniDownload) {
          set({
            harborMiniDownload: {
              percent: 0,
              label: err instanceof Error ? err.message : 'Download failed.',
              failed: true,
            },
          });
        }
        return false;
      } finally {
        void handle.remove();
      }
    },

    cancelHarborMini() {
      void Llama.cancelDownload({ id: HARBOR_MINI_MODEL_ID }).catch(() => {});
      logEvent('harbor_mini_download_cancel');
      set({ harborMiniDownload: undefined });
    },

    async ensureHarbor() {
      if (get().settings.harborReady) return true;
      logEvent('harbor_download_start');
      set({ harborDownload: { percent: 0, label: 'Connecting', indeterminate: true } });
      const handle = await Llama.addListener('downloadProgress', ({ id, completed, total }) => {
        if (id !== HARBOR_MODEL_ID) return;
        set({
          harborDownload: {
            percent: total ? (completed / total) * 100 : 0,
            label: total
              ? `${Math.round((completed / total) * 100)}% of ${formatBytes(total)}`
              : 'Downloading',
            indeterminate: !total,
          },
        });
      });
      try {
        void askForNotices();
        await Llama.downloadModel({
          id: HARBOR_MODEL_ID,
          url: HARBOR_MODEL_URL,
          notice: downloadNoticeCopy('Harbor', HARBOR_MODEL_ID),
        });
        // Warming up is the last step of the download (founder, 2026-10-01):
        // Harbor loads into the phone's model slot before it is called ready,
        // so the first message answers without a "Warming up" wait.
        set({ harborDownload: { percent: 100, label: 'Warming up', indeterminate: true } });
        await warmHarbor();
        await get().saveSettings({ harborReady: true, harborVersion: HARBOR_MODEL_VERSION });
        logEvent('harbor_ready');
        // Harbor becomes the phone's model, in every status, when the stack
        // has no anchor, its anchor is a guide not on the device, or the
        // anchor is Harbor Lite (Harbor is the preferred pick). So My Stack
        // chat works right away. Never overrides a cloud, BYOM, or
        // user-chosen device model; the person changes it in Stack.
        await promoteGuide(harborFullRef(), { harborReady: true, preferred: true });
        set({ harborDownload: undefined });
        return true;
      } catch (err) {
        if (get().harborDownload) {
          set({
            harborDownload: {
              percent: 0,
              label: err instanceof Error ? err.message : 'Download failed.',
              failed: true,
            },
          });
        }
        return false;
      } finally {
        void handle.remove();
      }
    },

    cancelHarbor() {
      void Llama.cancelDownload({ id: HARBOR_MODEL_ID }).catch(() => {});
      logEvent('harbor_download_cancel');
      set({ harborDownload: undefined });
    },

    async removeHarbor() {
      // Delete the weights from disk, then drop the ready flag. Any status
      // whose Reasoning anchor was Harbor is healed to whichever guide is still
      // present (Harbor Lite is bundled, so it always is), so "My Stack" chat
      // keeps working instead of pointing at a model that is gone. Harbor is
      // re-downloadable from the same row, so nothing is lost for good.
      await Llama.deleteModel({ id: HARBOR_MODEL_ID }).catch(() => {});
      logEvent('harbor_removed');
      await get().saveSettings({ harborReady: false });
      const stacks = get().settings.stacks;
      if (stacks) {
        let changed = false;
        const next: Partial<Record<ProfileId, AppStack>> = { ...stacks };
        for (const p of PROFILE_ORDER) {
          const st = stacks[p];
          if (!st) continue;
          const healed = healedAnchor(st, false, Boolean(get().settings.harborMiniReady));
          if (healed !== st) {
            next[p] = healed;
            changed = true;
          }
        }
        if (changed) await get().saveSettings({ stacks: next });
      }
    },

    async ensureHarborMaster(opts) {
      // The desktop's own model lives in the engine config, not in an app-side
      // stack ref, so this is the Stack screen's one-tap starter as a store
      // action: the size is resolved against this computer with the engine's
      // own budget, pulled by catalog id (progress rides the install channel),
      // then seated with its Ollama ref. Ollama owns the weights, so there is
      // no cancel and no uninstall here; `ollama rm` is the honest remove.
      const b = isDesktop() ? bridge() : undefined;
      if (!b) return false;
      const running = get().harborMasterDownload;
      if (running && !running.failed) return false;
      set({ harborMasterDownload: { percent: 0, label: 'Connecting', indeterminate: true } });
      let status: DesktopStatus | undefined;
      try {
        status = await b.status();
      } catch {
        status = get().desktopStatus;
      }
      if (status && !status.ollama.up) {
        // v1 Phase 1, desktop first run: no terminal. Installed but stopped,
        // start it; not installed, fetch and open the official installer
        // (the download page on failure), then carry on by itself the moment
        // Ollama answers. Linux has no one-click installer, so it names the
        // one command and waits the same way.
        const up = await bringUpOllama(b, (d) => set({ harborMasterDownload: d }), {
          detail: status.ollama.detail,
        });
        if (!up) return false;
        try {
          status = await b.status();
        } catch {
          status = undefined;
        }
      }
      const hw = status
        ? (status.hardware ?? hardwareFromSummary(status.hardwareSummary))
        : undefined;
      const { size } = resolveHarborMaster(hw);
      logEvent('harbor_master_install_start', { size: size.ollamaRef });
      const off = b.onInstallProgress((p) => {
        if (p.modelId !== size.catalogId) return;
        set({
          harborMasterDownload:
            p.percent != null
              ? { percent: p.percent, label: `${Math.round(p.percent)}%`, indeterminate: false }
              : { percent: 0, label: p.line || 'Downloading', indeterminate: true },
        });
      });
      // The pull's own answer, kept so a failure is worded by why it failed;
      // a failure after it landed is the seat's, never the download's.
      let failedPull: { detail: string; reason?: PullFailure } | undefined;
      let pulledOk = false;
      try {
        const pulled = await b.installModel(size.catalogId);
        if (!pulled.ok) {
          failedPull = pulled;
          throw new Error(pulled.detail);
        }
        pulledOk = true;
        if (opts?.seat !== false) {
          set({ harborMasterDownload: { percent: 100, label: 'Seating', indeterminate: true } });
          const seated = await b.setOrchestrator(size.ollamaRef);
          if (!seated.ok) throw new Error(seated.detail);
        }
        await get().refreshDesktopStatus();
        logEvent('harbor_master_ready', { size: size.ollamaRef });
        set({ harborMasterDownload: undefined });
        return true;
      } catch {
        // One plain line, never the model server's own error: with no
        // network, when it downloads; with the network up, what failed and
        // the way on (Desktop Offline). The store's read counts main's view
        // of the network beside the window's.
        set({
          harborMasterDownload: {
            percent: 0,
            label: pulledOk
              ? LOCAL_MODEL_SEAT_FAILED
              : localModelFailedLine(networkUp(get().connectivity), failedPull),
            failed: true,
          },
        });
        return false;
      } finally {
        off();
      }
    },

    beginHarborMiniWithIntro() {
      logEvent('library_intro_open', { model: HARBOR_MINI_MODEL_ID });
      // Kick the download in the background. ensureHarborMini manages
      // harborMiniDownload / harborMiniReady. Setup downloads in place and the
      // row shows the progress; it does not walk into the Marketplace (a v1
      // room since 2026-10-11), so first-run setup stays on its own page.
      void get().ensureHarborMini();
    },

    beginHarborWithIntro() {
      logEvent('library_intro_open', { model: HARBOR_MODEL_ID });
      void get().ensureHarbor();
    },

    endLibraryIntro() {
      logEvent('library_intro_done');
      // Back to the setup page; Harbor keeps downloading in the background.
      // Leave onboarded alone so a mid-setup relaunch still lands on setup.
      set({ libraryIntro: false, view: 'onboarding' });
      void get().saveSettings({ libraryIntroSeen: true });
    },

    async startGuideChat(guideId) {
      // A later tier's guide is not in a build without it (setupGuides.ts).
      const guide = SETUP_GUIDES[guideId];
      if (!guide) return;
      const s = get();
      // Whatever brain can answer here, best first: this computer's engine on
      // desktop, a connected Claude key anywhere, else Harbor Lite on the phone
      // (downloaded on the spot if needed). Never a brain that cannot answer.
      let source: ConversationSource | undefined;
      if (isDesktop() && s.sourceReady({ kind: 'desktop' })) source = { kind: 'desktop' };
      else if (s.cloudKeyPresent && !s.cloudKeyNeedsFix)
        source = { kind: 'cloud', provider: 'anthropic', model: DEFAULT_CLAUDE_MODEL };
      else if (platform() === 'ios') {
        const ok = s.settings.harborMiniReady || (await get().ensureHarborMini());
        if (ok)
          source = {
            kind: 'device',
            modelId: HARBOR_MINI_MODEL_ID,
            modelName: HARBOR_MINI_MODEL_NAME,
          };
      }
      // No brain can answer here yet (a fresh desktop with no engine and no
      // key): the guide still opens, seeded with the goal, the plan, and step
      // one as plain text the person can follow by hand, plus an honest note
      // that points at the model pill. The steps are static, so a guide never
      // needs a model to be USEFUL, only to chat back (tenet 4, tenet 7).
      const noBrain = !source;
      const opened: ConversationSource = source ?? { kind: 'stack' };
      const harborLight = opened.kind === 'device' && opened.modelId === HARBOR_MINI_MODEL_ID;
      logEvent('guide_chat', { guide: guideId });
      const body = pacedOpeningFor(guide, { harborLight });
      const opening: ThreadItem = {
        kind: 'assistant',
        id: `${newId()}-guide`,
        text: noBrain ? `${body}\n\n${NO_BRAIN_GUIDE_NOTE}` : body,
        streaming: false,
      };
      await get().newConversation(opened, { seedItems: [opening], title: guide.title });
    },

    async startGuide(modelId = HARBOR_MODEL_ID) {
      const guide = isHarbor(modelId)
        ? { name: HARBOR_MODEL_NAME, greeting: HARBOR_GREETING, ensure: get().ensureHarbor }
        : {
            name: HARBOR_MINI_MODEL_NAME,
            greeting: HARBOR_MINI_GREETING,
            ensure: get().ensureHarborMini,
          };
      const ready = isHarbor(modelId) ? get().settings.harborReady : get().settings.harborMiniReady;
      if (!ready) {
        const ok = await guide.ensure();
        if (!ok) return undefined;
      }
      logEvent('guide_started', { model: modelId });
      const id = await get().newConversation({ kind: 'device', modelId, modelName: guide.name });
      if (!id) return undefined;
      // Seed the guide's greeting directly (not model-generated) so first
      // launch is a warm, instant, reliable hello with zero wait.
      set((s) => {
        const conv = s.conversations[id];
        if (!conv) return s;
        const greeting = {
          kind: 'assistant' as const,
          id: `${id}-hello`,
          text: guide.greeting,
          streaming: false,
        };
        const next: Conversation = {
          ...conv,
          title: guide.name,
          thread: { ...conv.thread, items: [greeting] },
        };
        return { conversations: { ...s.conversations, [id]: next } };
      });
      void persistConversations(get());
      return id;
    },

    async beginGuidedSetup() {
      if (!isPhone()) return;
      // Open the walk's chat NOW, without waiting on the model: its hello and
      // its steps are scripted, so nothing on screen needs Harbor Lite loaded.
      // The model gets ready in the background, and a message typed before it
      // is waits for it (see holdForHarborLite).
      const id = await get().newConversation({
        kind: 'device',
        modelId: HARBOR_MINI_MODEL_ID,
        modelName: HARBOR_MINI_MODEL_NAME,
      });
      if (!id) return;
      set((st) => {
        const c = st.conversations[id];
        if (!c) return st;
        return {
          conversations: { ...st.conversations, [id]: { ...c, title: SETUP_CHAT_TITLE } },
        };
      });
      void persistConversations(get());
      if (!get().settings.harborMiniReady) void get().ensureHarborMini();
      const facts = setupFacts();
      const first = nextStep({ skipped: [] }, facts);
      await get().saveSettings({
        guidedSetup: {
          conversationId: id,
          current: first,
          skipped: [],
          finished: !first,
          harborAnnounced: facts.harborReady,
          // The break after the opening: chat now or set up now.
          ...(first ? { startChoice: 'asking' as const } : {}),
        },
      });
      logEvent('guided_setup_start', { first: first ?? 'none' });
      writeIntroLetter(id, openingMessage(first, facts));
    },

    openSetupStep() {
      const p = get().settings.guidedSetup;
      if (!p?.current || p.finished) return;
      logEvent('guided_setup_open', { step: p.current });
      if (p.current === 'harbor') {
        // Stays in the chat: the download runs in the background and the walk
        // moves on the moment it starts.
        void get().ensureHarbor();
        return;
      }
      const view: ViewName =
        p.current === 'computer' ? 'pair' : p.current === 'repo' ? 'repos' : 'connections';
      void get().saveSettings({ guidedSetup: { ...p, awaiting: p.current } });
      get().setView(view);
    },

    resumeGuidedSetup() {
      const p = get().settings.guidedSetup;
      // Chatting was chosen at the break, before any step: picking setup back
      // up offers the list of what is not set up, the same as "help me get set
      // up".
      if (p?.paused && p.startChoice === 'chat' && !p.menu) {
        logEvent('setup_menu_asked', { via: 'resume' });
        showSetupMenu(setupMenuProgress(p.conversationId));
        return;
      }
      if (p?.paused && p.editChoice === 'asking') {
        if (!appendGuideMessage(p.conversationId, `Happy to. ${EDIT_CHOICE_QUESTION}`)) return;
        void get().saveSettings({ guidedSetup: { ...p, paused: false } });
        return;
      }
      if (!p?.current || p.finished || !p.paused) return;
      // Anything connected while paused is passed by: resume at the step
      // that is actually next.
      const facts = setupFacts();
      const current = stepHandled(p.current, facts) ? nextStep(p, facts) : p.current;
      logEvent('guided_setup_resume', { step: current ?? 'none' });
      if (!current) {
        void get().saveSettings({ guidedSetup: { ...p, paused: false, current, finished: true } });
        appendGuideMessage(p.conversationId, advanceMessage(undefined, 'done', undefined, facts));
        return;
      }
      if (!appendGuideMessage(p.conversationId, resumeMessage(current))) return;
      void get().saveSettings({ guidedSetup: { ...p, paused: false, current } });
    },

    async chooseEditMode(mode) {
      const p = get().settings.guidedSetup;
      if (!p || p.editChoice !== 'asking') return;
      // Asked from the list: the answer, then the list with what is left.
      if (p.menu) {
        const back = { step: 'repo' as const, how: 'done' as const, lead: editChoiceLead(mode) };
        if (!showSetupMenu({ ...p, editChoice: mode ?? 'later' }, back)) return;
        if (mode) {
          logEvent('permission_mode_chosen', { mode, source: 'walk' });
          await get().setPermissionMode(mode, 'walk');
        } else {
          logEvent('permission_mode_deferred', { source: 'walk' });
        }
        return;
      }
      const facts = setupFacts();
      // Anything connected while the choice waited is passed by.
      const after = p.current && !stepHandled(p.current, facts) ? p.current : nextStep(p, facts);
      if (!appendGuideMessage(p.conversationId, editChoiceMessage(mode, after, facts))) return;
      // Close the choice before any await, so a second tap finds it answered.
      const saved = get().saveSettings({
        guidedSetup: {
          ...p,
          editChoice: mode ?? 'later',
          current: after,
          finished: !after,
          harborAnnounced: p.harborAnnounced || (!after && facts.harborReady),
        },
      });
      if (mode) {
        logEvent('permission_mode_chosen', { mode, source: 'walk' });
        await get().setPermissionMode(mode, 'walk');
      } else {
        logEvent('permission_mode_deferred', { source: 'walk' });
      }
      await saved;
    },

    chooseNext(choice) {
      const p = get().settings.guidedSetup;
      if (!p || p.nextChoice !== 'asking') return;
      const facts = setupFacts();
      // Anything connected while the fork waited is passed by.
      const after = p.current && !stepHandled(p.current, facts) ? p.current : nextStep(p, facts);
      if (!appendGuideMessage(p.conversationId, nextChoiceMessage(choice, after, facts))) return;
      logEvent('guided_setup_fork', { choice, via: 'button' });
      void get().saveSettings({
        guidedSetup:
          choice === 'chat'
            ? // The walk steps back where it stands; "Keep setting up" or "let's
              // set up" resumes it at the step that is actually next.
              {
                ...p,
                nextChoice: 'chat',
                paused: true,
                awaiting: undefined,
                current: after,
                finished: !after,
              }
            : {
                ...p,
                nextChoice: 'setup',
                current: after,
                finished: !after,
                harborAnnounced: p.harborAnnounced || (!after && facts.harborReady),
              },
      });
    },

    offerPairing(link) {
      const pair = parsePairingQr(link);
      if (!pair) {
        get().showToast('That pairing link is not for a computer on your own network.');
        return;
      }
      logEvent('pair_offer', { via: 'link' });
      set({ pairOffer: pair });
      get().setView('pair', { root: true });
    },

    clearPairOffer() {
      set({ pairOffer: undefined });
    },

    chooseStart(choice, origin) {
      const p = get().settings.guidedSetup;
      if (!p || p.startChoice !== 'asking') return;
      const facts = setupFacts();
      // Anything connected while the break waited is passed by.
      const first = p.current && !stepHandled(p.current, facts) ? p.current : nextStep(p, facts);
      const text = choice === 'chat' ? SETUP_LATER_LINE : startSetupMessage(first, facts);
      if (!appendGuideMessage(p.conversationId, text)) return;
      logEvent('guided_setup_start_choice', { choice });
      void get().saveSettings({
        guidedSetup:
          choice === 'chat'
            ? { ...p, startChoice: 'chat', paused: true, awaiting: undefined, current: first }
            : { ...p, startChoice: 'setup', current: first, finished: !first },
      });
      if (choice === 'chat') carryToGreeting(p.conversationId, origin);
    },

    pickSetupStep(step) {
      const p = get().settings.guidedSetup;
      if (!p || p.menu !== 'asking') return;
      if (!appendGuideMessage(p.conversationId, menuStepIntro(step))) return;
      logEvent('setup_menu_pick', { step });
      void get().saveSettings({
        guidedSetup: {
          ...p,
          menu: 'step',
          menuItemId: undefined,
          current: step,
          finished: false,
          paused: false,
        },
      });
    },

    setupMenuOffer() {
      const p = get().settings.guidedSetup;
      return p ? menuSteps(p, setupFacts()) : [];
    },

    slackWaterCovered() {
      const w = get().slackWater;
      if (!w || w.phase !== 'rising') return;
      get().startNewChat();
      set({ slackWater: { ...w, phase: 'clearing' } });
    },

    endSlackWater() {
      set({ slackWater: undefined });
    },

    skipSetupStep() {
      const p = get().settings.guidedSetup;
      // The fork after Harbor is answered first: the next step has not even
      // been introduced yet, so there is nothing to skip.
      if (!p?.current || p.finished || p.nextChoice === 'asking') return;
      const facts = setupFacts();
      // A step picked from the list: back to the list, without that one.
      if (p.menu === 'step') {
        logEvent('guided_setup_skip', { step: p.current, via: 'menu' });
        showSetupMenu(
          { ...p, skipped: [...p.skipped, p.current] },
          { step: p.current, how: 'skipped' },
        );
        return;
      }
      const skipped = [...p.skipped, p.current];
      const after = nextStep({ skipped }, facts);
      // Skipping Harbor still ends on the fork (chat, or keep setting up)
      // whenever setup is still ahead.
      const fork =
        p.current === 'harbor' && !p.nextChoice && stepsAhead({ skipped }, facts).length > 0;
      const text = fork
        ? harborForkMessage('skipped', { skipped }, facts)
        : advanceMessage(p.current, 'skipped', after, facts);
      if (!appendGuideMessage(p.conversationId, text)) return;
      logEvent('guided_setup_skip', { step: p.current });
      void get().saveSettings({
        guidedSetup: {
          ...p,
          skipped,
          current: after,
          finished: !after && !fork,
          awaiting: undefined,
          harborAnnounced: p.harborAnnounced || (!after && facts.harborReady),
          ...(fork ? { nextChoice: 'asking' as const } : {}),
        },
      });
    },

    async setSearchBackend(backend, apiKey) {
      await secretSet(SEARCH_SECRET_KEY, JSON.stringify({ backend, apiKey: apiKey.trim() }));
      set({ searchKeyConfigured: true });
      await get().saveSettings({ searchBackend: backend });
      logEvent('search_backend_set', { backend });
    },

    async clearSearchBackend() {
      await secretDelete(SEARCH_SECRET_KEY);
      set({ searchKeyConfigured: false });
      await get().saveSettings({ searchBackend: undefined });
      logEvent('search_backend_cleared');
    },

    teamVaultAvailable() {
      // The team vault is v4: a Personal build keeps every note personal.
      if (!featureOn('teams')) return false;
      const st = get();
      return Boolean(
        authConfigured() && st.authSession && st.serverRole && st.settings.account?.org?.serverId,
      );
    },

    async setVaultScope(scope) {
      if (scope === get().vaultScope) return;
      if (scope === 'team' && !get().teamVaultAvailable()) return;
      vaultOpenSeq++;
      // Leaving the note with a choice open keeps both (CS 1c).
      await leaveVaultConflict();
      vaultLiveDraft = undefined;
      stopVaultPoll();
      set({ vaultScope: scope, vaultTeamExpired: undefined, ...clearedVaultRoom() });
      logEvent('vault_scope', { scope });
      await get().vaultRefresh();
    },

    vaultTargetRef() {
      const t = vaultTarget();
      if (!t) return undefined;
      const { providerId, resourceId, owner } = t;
      return owner ? { providerId, resourceId, owner } : { providerId, resourceId };
    },

    vaultReadOnly() {
      const t = vaultTarget();
      return t ? vaultReadOnlyReason(t.providerId) : undefined;
    },

    async vaultDiscardHeld(id) {
      // Only the entry shown: another account's team text is never touched.
      const uid = get().authSession?.user.id;
      const shown = (h: VaultHeldDraft) => vaultHeldFor([h], uid).length > 0;
      await editVaultHeld((list) => list.filter((h) => h.id !== id || !shown(h))).catch(() => {});
      logEvent('vault_held_discarded');
    },

    vaultHeldVisible() {
      return vaultHeldFor(get().vaultHeld, get().authSession?.user.id);
    },

    async vaultRefresh() {
      // A team note kept open after an expiry is all that shows of the team
      // vault until the person signs back in or leaves it: nothing is listed,
      // since the storage would only refuse (Vault M2 2.6).
      if (get().vaultTeamExpired && get().vaultScope === 'team') return;
      // The personal vault is one gitOS resource, auto-registered on first
      // open, on the Local provider. The team vault is server-side and needs no
      // local resource row. More vaults and providers arrive through the same
      // registry when their wiring lands.
      if (get().vaultScope === 'personal') {
        const resources = get().settings.gitosResources ?? [];
        // On the desktop the vault is the folder the agent, routines, and
        // Obsidian share (Vault M1 1.3): main says where it is, and a brand
        // new personal vault is made there, with no card and no toast.
        const desk = isDesktop() && (await probeReady('files').catch(() => false));
        if (desk) await get().vaultLoadFolder();
        if (!resources.some((r) => r.id === VAULT_RESOURCE_ID)) {
          const vault: GitosResource = {
            id: VAULT_RESOURCE_ID,
            name: 'Vault',
            kind: 'vault',
            providerId: desk ? 'files' : 'local',
            createdAt: new Date().toISOString(),
          };
          await get().saveSettings({ gitosResources: [...resources, vault] });
          logEvent('vault_created');
        }
      }
      await loadVaultHeld();
      const target = vaultTarget();
      if (!target) {
        set({ vaultFiles: [], vaultError: undefined, vaultListed: true });
        return;
      }
      // A refresh asks the team afresh whether it has room: what adds text
      // is sent again, and a refusal says so once (E27).
      if (target.providerId === 'org') clearOrgVaultFull(target.resourceId);
      let files: StoredFileMeta[];
      try {
        files = await listVaultNotes(target);
      } catch {
        // A list that fails after its vault left the screen (another vault,
        // or another account's team vault, E32) says nothing about this one.
        if (!isActiveVault(target)) return;
        // Keep the last-known file list so the screen can show an offline
        // state rather than the first-run "empty vault" greeting over notes
        // that really exist.
        set({ vaultError: 'load', vaultListed: true });
        // A Drive vault with no Google account on this device fails for want
        // of the account, not the connection: its read-only card says so, and
        // this toast would blame the network.
        const driveGone =
          target.providerId === 'gdrive' && !(await isGdriveConnected().catch(() => false));
        // A desktop folder that is not there has its own card, which says so.
        const folderGone = target.providerId === 'files' && get().vaultFolder?.exists === false;
        if (!driveGone && !folderGone) {
          get().showToast('Could not reach your vault storage. Showing the last loaded notes.');
        }
        return;
      }
      if (!isActiveVault(target)) return;
      // A team list that had notes and reads empty may be a removed member's
      // (E26): the room says so rather than greet an empty vault.
      const holds = await teamListHolds(target, files);
      if (holds === 'removed' || !isActiveVault(target)) return;
      if (holds === 'failed') {
        set({ vaultError: 'load', vaultListed: true });
        get().showToast('Could not reach your vault storage. Showing the last loaded notes.');
        return;
      }
      set({ vaultFiles: files, vaultError: undefined, vaultListed: true });
      // The index reads only notes whose version moved (M3 3.2).
      void openVaultIndex(target).reconcile(files);
      // Empty folders and the Trash row (Vault M6), each only where the
      // storage has them.
      void refreshVaultFolders(target);
      // The vault's settings (Vault M7, CTO L5), through the 60 s cache.
      void get().vaultLoadSettings();
      void refreshVaultTrash(target);
      // An empty default Local vault on the desktop has nothing to move, so
      // it simply points at the folder (CX 1.3 b).
      if (await repointEmptyLocal(target, files)) return;
      // The list came back, so the provider is reachable: flush any drafts
      // stranded by an earlier offline write, and any words a launch that
      // ended left on their way (E17).
      await recoverVaultInflight();
      await replayVaultPending(target);
    },

    async vaultOpen(path, opts = {}) {
      const target = vaultTarget();
      if (!target) return;
      // The latest tap wins: an open that waited is dropped once another
      // open, a close, or a scope change came after it (E3).
      const seq = ++vaultOpenSeq;
      const files = get().vaultFiles;
      // Open by the exact listed path. A note the agent, a routine, or
      // Obsidian named with characters the typed-name rule strips ("Decision:
      // auth?.md", "C# nightly.md") is still a note, and normalizing it opened
      // a blank editor at a different path (data-12). Only a path that is not
      // listed is a typed name: it is normalized, and it still resolves
      // case-insensitively to an existing note rather than forking a second
      // divergent one (storage keys are case-sensitive, resolution is not).
      let listed = files.find((f) => f.path === path);
      let openPath = path;
      if (!listed) {
        const normalized = normalizeNotePath(path);
        if (!normalized) return;
        listed =
          files.find((f) => f.path === normalized) ??
          files.find((f) => f.path.toLowerCase() === normalized.toLowerCase());
        openPath = listed?.path ?? normalized;
      }
      // Already open (Today on today's note, the switcher): it stays as it
      // is, typed text and all, never re-read under the editor (E3).
      if (get().vaultNote?.path === openPath) return;
      // A save of this note still on its way lands first, so the note opens
      // at what it wrote, never at an older version the next keystroke would
      // save over (E3). Bounded: a hung write never keeps the note shut, and
      // its landing reloads the note (saveVaultNote).
      await settledWrites(target, openPath);
      if (seq !== vaultOpenSeq || !isActiveVault(target)) return;
      const downloading = () =>
        get().showToast('Still downloading this note from your vault storage. Try again shortly.');
      // UI-2: a note whose bytes are evicted from this device (iCloud's
      // placeholder) is still a note. Never open an empty editor over it,
      // which a keystroke would then save back as empty over the cloud copy.
      if (listed?.evicted) {
        // Ask for the bytes, so the download is on its way when the person
        // taps again: a read of an evicted note starts it and answers at once
        // (CTO G2). Its answer is not awaited and opens nothing here.
        void target.provider.read(target.resourceId, openPath).catch(() => undefined);
        downloading();
        return;
      }
      let existing: StoredFile | undefined;
      try {
        existing = await target.provider.read(target.resourceId, openPath);
      } catch {
        get().showToast('Could not open that note. Check your vault storage connection.');
        return;
      }
      if (!existing) {
        // Listed or not, the storage is asked what it holds now (E24). A note
        // it has whose bytes are not here yet (iCloud's placeholder) is never
        // fabricated as an empty note (data-2); a stat and a read are two
        // looks, so a write between them answers a second read. A listed
        // note it no longer has was deleted or renamed somewhere else since
        // the list, and only a name it never held opens fresh.
        let meta: StoredFileMeta | undefined;
        try {
          meta = await target.provider.stat(target.resourceId, openPath);
          if (meta && !meta.evicted) {
            existing = await target.provider.read(target.resourceId, openPath);
          }
        } catch {
          get().showToast('Could not open that note. Check your vault storage connection.');
          return;
        }
        if (meta && !existing) {
          // Only iCloud keeps notes whose bytes are elsewhere; on any other
          // storage "try again shortly" would never come true.
          if (meta.evicted || target.providerId === 'icloud') downloading();
          else get().showToast('Could not open that note. Check your vault storage connection.');
          return;
        }
        if (!meta && listed) return vaultOpenGone(target, openPath, seq, opts);
      }
      if (seq !== vaultOpenSeq || !isActiveVault(target)) return;
      if (existing) vaultIndexOf(target)?.noteRead(existing);
      if (existing) cacheOpenBody(existing);
      // Opening another note leaves this one: a choice still open on it keeps
      // both (CS 1c).
      if (get().vaultConflict && get().vaultConflict?.path !== openPath) {
        await leaveVaultConflict();
        if (seq !== vaultOpenSeq || !isActiveVault(target)) return;
      }
      vaultLiveDraft = undefined;
      set({
        vaultNote: {
          ...(existing ?? { path: openPath, text: '', updatedAt: '' }),
          loadedAt: nextLoadedAt(),
          // Who saved it last, when the list said and it is still that
          // version (the team vault, G6).
          ...(listed?.editedBy && existing && versionOf(listed) === versionOf(existing)
            ? { editedBy: listed.editedBy }
            : {}),
        },
      });
      logEvent('vault_note_open', { fresh: !existing });
      if (existing) noteVaultRecent(target, openPath);
      return 'opened';
    },

    async vaultCreate(path, content = '', at) {
      const normalized = normalizeNotePath(path);
      if (!normalized) return;
      const target = vaultTargetFrom(at);
      if (!target) return;
      const readOnly = vaultReadOnlyReason(target.providerId);
      if (readOnly) {
        get().showToast(readOnly);
        return;
      }
      // A team create goes out only under the account it was asked for.
      const seeded = content.length > 0;
      if (!speaksNow(target)) {
        if (seeded) await keepUnsentTeamText(target, normalized, content, undefined);
        else get().showToast('Sign in to your team to use the team vault.');
        return;
      }
      if (await leaseRefuses(target)) return;
      const active = isActiveVault(target);
      // An existing note (evicted from this device or not, UI-2) opens; it is
      // never overwritten with an empty body.
      const files = active ? get().vaultFiles : [];
      const listed =
        files.find((f) => f.path === normalized) ??
        files.find((f) => f.path.toLowerCase() === normalized.toLowerCase());
      // Gone since the list (a teammate deleted or moved it): the create goes
      // on below, and is guarded there like any other (E24).
      if (listed && (await get().vaultOpen(listed.path, { quietGone: true })) !== 'gone') return;
      // A lapsed team plan takes no new note (OV402): said here, before the
      // server is asked (a listed note still opens, read-only), and a seeded
      // body is held so its words are not lost.
      const teamRefused = await teamRefusalNow(target, 'create');
      if (teamRefused) {
        if (seeded) {
          // The plan's reason, or the free space's (E27).
          const why =
            get().vaultTeamPlan?.entitled === false ? VAULT_TEAM_LAPSED_NOT_SAVED : VAULT_TEAM_FULL;
          await holdVaultDraft(target, normalized, content, why);
          set({ vaultError: 'held' });
        }
        get().showToast(teamRefused);
        return;
      }
      // The list can be stale (the agent, a routine, Obsidian, or another
      // device wrote the note after it loaded), so ask the provider itself
      // before writing, and open what it holds (data-2).
      let stored: StoredFileMeta | undefined;
      let reachable = true;
      // What kept the storage from answering, so the line says why (E42).
      let failure: unknown;
      try {
        stored = await target.provider.stat(target.resourceId, normalized);
      } catch (err) {
        reachable = false;
        failure = err;
      }
      if (stored) {
        if (stored.evicted) {
          get().showToast(
            'Still downloading this note from your vault storage. Try again shortly.',
          );
        } else if (isActiveVault(target)) {
          await get().vaultOpen(stored.path);
        }
        return;
      }
      // A seeded note (a starter/welcome note carries `content`) is already
      // written and readable, so it opens in read mode; a blank new note is
      // fresh and opens in the editor.
      if (reachable) {
        try {
          // Never over anything: a note that appeared under this name since
          // the stat above is opened, not replaced (ifAbsent, CTO F4).
          const result = await putVaultNote(target, normalized, content, { ifAbsent: true });
          // Taken under another spelling (the team vault matches a name by
          // letter case, 0021): open the note that is there, at its own path,
          // never a blank one at the spelling asked for (round 5, finding 6).
          if (!result.ok && result.conflict === 'exists' && result.theirs) {
            if (isActiveVault(target)) await get().vaultOpen(result.theirs.path);
            return;
          }
          if (!result.ok && result.conflict === 'exists') {
            if (isActiveVault(target)) await get().vaultOpen(normalized);
            return;
          }
          const saved = mustLand(result);
          logEvent('vault_note_create');
          if (!isActiveVault(target)) return;
          vaultLiveDraft = undefined;
          set({
            vaultNote: {
              path: normalized,
              text: saved.text,
              updatedAt: saved.updatedAt,
              version: saved.version,
              fresh: !seeded,
              loadedAt: nextLoadedAt(),
            },
            vaultError: undefined,
          });
          return;
        } catch (err) {
          const refusal = vaultRefusal(err);
          if (refusal) {
            // Retrying cannot fix a refusal, so nothing is stashed; a seeded
            // body is held so its words are not lost either.
            if (seeded) {
              await holdVaultDraft(target, normalized, content, asSentence(refusal));
              set({ vaultError: 'held' });
            }
            get().showToast(`Could not create that note. ${asSentence(refusal)}`);
            return;
          }
          failure = err;
        }
      }
      // Offline: still open the editor so the user can write, and stash the
      // note body so the create is not lost. The stash carries no base, so a
      // replay that finds a note already there keeps both, never overwrites.
      // A team create whose account left while it was out is never stashed
      // (E11): a seeded body is kept in memory only, and no editor opens.
      if (!speaksNow(target)) {
        if (seeded) await keepUnsentTeamText(target, normalized, content, undefined);
        return;
      }
      const loadedAt = nextLoadedAt();
      try {
        await stashDraft(target, normalized, content, undefined, { sitting: loadedAt });
      } catch {
        if (seeded) {
          const reason = 'This device could not keep a copy to retry. Copy it somewhere safe.';
          await holdVaultDraft(target, normalized, content, reason);
        }
      }
      if (!isActiveVault(target)) return;
      const wait = vaultWaitKind(failure);
      set({
        vaultNote: { path: normalized, text: content, updatedAt: '', fresh: !seeded, loadedAt },
        vaultError: 'save',
        vaultSaveWait: wait,
      });
      get().showToast(vaultCreateWaitToast(wait));
    },

    vaultCloseNote() {
      // An open still waiting for its note's save never reopens it (E3).
      vaultOpenSeq++;
      // Leaving the note with a choice open keeps both (CS 1c); the conflict
      // clears at once and the copy is written after.
      void leaveVaultConflict();
      vaultLiveDraft = undefined;
      set({ vaultNote: undefined });
      // Leaving a team note kept after an expiry leaves the team vault too:
      // there is nothing of it to show until the person signs back in.
      if (get().vaultTeamExpired) {
        set({
          vaultTeamExpired: undefined,
          vaultScope: 'personal',
          vaultFiles: [],
          vaultListed: false,
        });
        void get().vaultRefresh();
      }
    },

    vaultNoteDraft(path, text) {
      vaultLiveDraft = { path, text };
    },

    async vaultRecheck({ reason, paths, tree }) {
      const target = vaultTarget();
      if (!target) return 'skipped';
      const open = get().vaultNote;
      let result: VaultRecheckResult = 'skipped';
      // Every provider with compare-and-swap can see and settle a change
      // under the editor, and only those; the others keep M0's behavior.
      if (
        open &&
        target.provider.compareAndSwap &&
        (reason === 'focus' || reason === 'poll' || tree || paths?.includes(open.path))
      ) {
        // A poll never runs while a save for the note is still settling; it
        // looks again on the next tick (CTO G6).
        if (reason === 'poll' && vaultSaveChains.has(vaultKey(target, open.path))) {
          return 'skipped';
        }
        result = await inSaveChain(target, open.path, () => recheckOpenNote(target, open.path));
      }
      // The poll looks at the open note only; the tree refreshes on focus.
      if (reason === 'poll') return result;
      // Named paths go to the index, which reads only what moved; a tree
      // change reaches it through the relist below (M3 3.2).
      if (reason === 'watch' && !tree && paths?.length) {
        void vaultIndexOf(target)?.watched({ paths, tree: false }, () => listVaultNotes(target));
      }
      // A change under `.oscode/` or the Obsidian config folder reads the
      // vault's settings again (CTO L6).
      if (reason === 'watch' && paths?.length && vaultSettingsHint(foldersKey(target), paths)) {
        void get().vaultLoadSettings({ force: true });
      }
      const listed = new Set(get().vaultFiles.map((f) => f.path));
      if (reason === 'focus' || tree || paths?.some((p) => !listed.has(p))) scheduleRelist();
      return result;
    },

    vaultStartPoll(opts) {
      if (pollGate() === 'stop') {
        stopVaultPoll();
        return;
      }
      pollActive = true;
      schedulePoll(opts?.now ? 0 : vaultPollDelayMs(pollFailures));
    },

    vaultStopPoll() {
      stopVaultPoll();
    },

    async vaultResolve(choice, draft) {
      const c = get().vaultConflict;
      if (!c) return { ok: false };
      // Another account's team choice, or one whose vault is not on screen,
      // is never settled here: nothing is written, loaded or dropped (R-19).
      // After an expiry, the same account's choice waits for its return.
      if (!teamChoiceSpeaks(c)) return waitForTeamSignIn(c, draft);
      const target = vaultTargetFrom(c.target);
      if (!target) return { ok: false, failed: true };
      const title = noteTitle(c.path);
      const open = get().vaultNote;
      const session = open?.path === c.path ? open.loadedAt : undefined;
      // The stash is dropped where the note is now (a case-only rename
      // followed, E16).
      const done = async (toast: string, at = c.path) => {
        set({ vaultConflict: undefined });
        await dropStash(c.target, at);
        get().showToast(toast);
        logEvent('vault_conflict_choice', { choice, kind: c.kind });
        return { ok: true };
      };
      return inSaveChain(target, c.path, async (): Promise<VaultResolveResult> => {
        try {
          // A lapsed team plan takes no write (OV402): Keep both and Keep
          // yours put the text under Not saved with the plan's reason before
          // any server call, and the note shows what the vault holds (or
          // closes, when it is gone). Nothing typed is lost, nothing is sent.
          const lapsed =
            choice === 'both' || choice === 'mine'
              ? await teamRefusalNow(target, 'save')
              : undefined;
          // Keep both writes a copy, which adds text: refused here once the
          // team is known to be full (E27). Keep yours may only trim, so it
          // goes, and the server says.
          const full =
            !lapsed && choice === 'both' && target.providerId === 'org' && get().vaultTeamPlan?.full
              ? vaultRefusedLine('save', { line: VAULT_TEAM_FULL })
              : undefined;
          const teamRefused = lapsed ?? full;
          if (teamRefused) {
            const landed = await holdVaultDraft(
              c.target,
              c.path,
              draft,
              lapsed ? VAULT_TEAM_LAPSED_NOT_SAVED : VAULT_TEAM_FULL,
              { session },
            );
            set({ vaultError: 'held' });
            if (c.theirs) {
              reloadOpenNote(c.theirs, 'resolve');
            } else {
              vaultLiveDraft = undefined;
              set({ vaultNote: undefined, vaultReturnFolder: noteFolder(c.path) });
            }
            return done(`${teamRefused} ${heldLine(landed)}`);
          }
          if (choice === 'theirs' && c.theirs) {
            // Shown at its own spelling of the name, so the editor takes it (E16).
            const at = await followCaseRename(c.target, c.path, c.theirs);
            reloadOpenNote(c.theirs, 'resolve');
            return done(vaultResolveToast('theirs', { title }), at);
          }
          if (choice === 'discard') {
            vaultLiveDraft = undefined;
            set({ vaultNote: undefined, vaultReturnFolder: noteFolder(c.path) });
            return done(vaultResolveToast('discard', { title }));
          }
          if (choice === 'both' && c.theirs) {
            const copy = await writeConflictCopy(
              target,
              c.path,
              draft,
              new Date(c.foundAt),
              c.copyPath,
            );
            if (!copy) {
              await holdVaultDraft(c.target, c.path, draft, VAULT_NO_COPY_NAME_REASON, {
                session,
              });
              set({ vaultError: 'held' });
            }
            const at = await followCaseRename(c.target, c.path, c.theirs);
            reloadOpenNote(c.theirs, 'resolve');
            return done(
              copy
                ? vaultResolveToast('both', { title, copyTitle: noteTitle(copy) })
                : `Not saved. ${heldLine(true)}`,
              at,
            );
          }
          if (choice === 'mine') {
            const guard: WriteGuard = c.theirs
              ? { ifMatch: versionOf(c.theirs) }
              : { ifAbsent: true };
            // Guarded where theirs is: the spelling the sheet shows (E16).
            let at = await followCaseRename(c.target, c.path, c.theirs);
            let r = await putVaultNote(target, at, draft, guard);
            // Theirs under another spelling of this name (a teammate's
            // case-only rename): the note follows it, and when theirs is
            // just the text this device loaded, nothing is left to ask, so
            // Keep yours lands there, as a save does over a pure touch (E16).
            if (!r.ok && r.theirs) {
              const was = at;
              at = await followCaseRename(c.target, at, r.theirs);
              if (at !== was && r.theirs.text === c.base) {
                r = await putVaultNote(target, at, draft, { ifMatch: versionOf(r.theirs) });
              }
            }
            if (!r.ok) {
              if (r.conflict === 'downloading') return { ok: false, failed: true };
              // It changed again (or came back): the sheet shows what is
              // there now, and the person chooses again.
              const theirs = r.theirs ?? (await target.provider.read(target.resourceId, at));
              const moved =
                at === c.path
                  ? {}
                  : { path: at, copyPath: conflictCopyPathIn(target, at, new Date(c.foundAt)) };
              set({
                vaultConflict: theirs
                  ? { ...c, ...moved, kind: 'changed', theirs, again: true }
                  : { ...c, ...moved, kind: 'missing', theirs: undefined, again: true },
              });
              return { ok: false };
            }
            const saved = r.file;
            const open = get().vaultNote;
            if (open?.path === at) {
              set({
                vaultNote: {
                  ...open,
                  text: saved.text,
                  updatedAt: saved.updatedAt,
                  version: saved.version,
                  editedBy: undefined,
                },
              });
            }
            return done(vaultResolveToast('mine', { title, missing: c.kind === 'missing' }), at);
          }
          return { ok: false };
        } catch (err) {
          // Refused for good (a team out of free space, 0023, or a plan the
          // room had not read yet, OV402): trying again cannot help, so the
          // text goes under Not saved with the refusal's line, and the note
          // shows what the vault holds (or closes, when it is gone), as the
          // lapsed branch above does. A failure that may pass keeps the
          // sheet up (round 5, finding 2).
          // The sign-in ended while the choice was on its way (a dead refresh
          // token found by this tap): the choice and its words wait, sealed.
          if (!teamChoiceSpeaks(c)) return waitForTeamSignIn(c, draft);
          // Only the team vault's refusals hold the text here. A personal
          // vault keeps main's answer: Your computer asleep refuses a create
          // for now, not for good, so the choice stays open (round 7 E29).
          const refusal = c.target.providerId === 'org' ? vaultRefusal(err) : undefined;
          if (refusal) {
            const landed = await holdVaultDraft(c.target, c.path, draft, asSentence(refusal), {
              session,
            });
            set({ vaultError: 'held' });
            if (c.theirs) {
              reloadOpenNote(c.theirs, 'resolve');
            } else {
              vaultLiveDraft = undefined;
              set({ vaultNote: undefined, vaultReturnFolder: noteFolder(c.path) });
            }
            return done(`Not saved. ${asSentence(refusal)} ${heldLine(landed)}`);
          }
          return { ok: false, failed: true };
        }
      });
    },

    vaultDeferConflict(deferred) {
      const c = get().vaultConflict;
      if (c && c.deferred !== deferred) set({ vaultConflict: { ...c, deferred } });
    },

    async vaultLeaveConflict() {
      await leaveVaultConflict();
    },

    vaultTakeReturnFolder() {
      const folder = get().vaultReturnFolder;
      if (folder !== undefined) set({ vaultReturnFolder: undefined });
      return folder;
    },

    async vaultSave(path, typed, at) {
      const target = vaultTargetFrom(at);
      if (!target) return;
      // A textarea hands CRLF back as LF, so an all-CRLF note keeps its line
      // endings (M3, CTO H2): the note as loaded, or as last saved.
      const open = isActiveVault(target) ? get().vaultNote : undefined;
      const loaded =
        open?.path === path ? open.text : vaultBodyCache.get(vaultKey(target, path))?.text;
      const text = loaded === undefined ? typed : restoreEol(loaded, typed);
      // While a choice about this note is open, nothing typed is written to
      // it: the text goes to the durable stash, stamped with the version it
      // was typed against (CX 1.1).
      const c = get().vaultConflict;
      if (
        c &&
        c.path === path &&
        c.target.providerId === target.providerId &&
        c.target.resourceId === target.resourceId
      ) {
        await stashConflictText(target, path, text, c.baseVersion);
        return;
      }
      // Another device holds the enforced lease: nothing is written to the
      // note. The text waits in the stash with the version it was typed
      // against, and its replay keeps both if the note moved on (CTO G5).
      if (leaseBlocks(target)) {
        await stashConflictText(target, path, text, vaultBaseOf(target, path));
        return;
      }
      const key = vaultKey(target, path);
      // Untouched: the open note already holds this text, nothing for it is
      // on its way, and nothing waits to retry, so there is nothing to write.
      if (
        open?.path === path &&
        !open.fresh &&
        text === open.text &&
        !vaultSaveChains.has(key) &&
        get().vaultError === undefined
      ) {
        return;
      }
      // The version at call time, used only when the note has closed and no
      // earlier save for it says more.
      const called = vaultBaseOf(target, path);
      // The sitting this text was typed in, for Not saved (E7), and when
      // this save was asked for, so it never settles a newer stash (E10).
      const session = open?.path === path ? open.loadedAt : undefined;
      const mark = nextStashAt();
      // Across the network the words go on the device first, at once, even
      // for a save queued behind a hung one, and stay until it settles (E17).
      const ahead =
        writesAhead(target) && speaksNow(target) && !vaultReadOnlyReason(target.providerId)
          ? writeAhead(target, path, text, called, session, mark)
          : undefined;
      const before = vaultSaveChains.get(key);
      const run = (async () => {
        const aheadId = ahead ? await ahead : undefined;
        let ended = false;
        try {
          const carried = before ? await before : undefined;
          // The version this text was typed on: the open note's while it is
          // still the sitting the text came from; once the note was opened
          // again, what this device last knew of that sitting (E3).
          const now = isActiveVault(target) ? get().vaultNote : undefined;
          const same = now?.path === path && now.loadedAt === session;
          const base = same
            ? (vaultBaseOf(target, path) ?? carried ?? called)
            : (carried ?? called);
          // The text at that version, as this device knows it now (E4).
          const cached = vaultBodyCache.get(key);
          const baseText =
            base === undefined
              ? undefined
              : same && now && versionOf(now) === base
                ? now.text
                : cached?.version === base
                  ? cached.text
                  : undefined;
          if (aheadId && base !== called) await restampAhead(aheadId, base);
          const out = await saveVaultNote(target, path, text, base, { session, baseText, mark });
          ended = true;
          return out;
        } finally {
          // Landed, or kept in the stash or under Not saved: the words on
          // their way are settled (E17).
          if (aheadId) await settleAhead(aheadId, ended);
        }
      })();
      const link = run.catch(() => undefined);
      vaultSaveChains.set(key, link);
      // The chip says Saving while any save is on its way (2.2).
      vaultSavesInFlight++;
      if (!get().vaultSaving) set({ vaultSaving: true });
      try {
        await run;
        noteVaultRecent(target, path);
      } finally {
        if (vaultSaveChains.get(key) === link) vaultSaveChains.delete(key);
        vaultSavesInFlight--;
        if (vaultSavesInFlight === 0) set({ vaultSaving: false });
      }
    },

    async vaultDelete(path, at) {
      const target = vaultTargetFrom(at);
      if (!target) return false;
      const readOnly = vaultReadOnlyReason(target.providerId);
      if (readOnly) {
        get().showToast(readOnly);
        return false;
      }
      if (await leaseRefuses(target)) return false;
      // Guarded with the version the open note was loaded or saved at, so a
      // delete never removes a version this device has not seen (Vault M2
      // wave 0). A provider that does not check the guard yet removes anyway.
      const base = vaultBaseOf(target, path);
      // The text the person saw at that version, as the delete began (E4).
      const loaded = base ? get().vaultNote?.text : undefined;
      let removed: RemoveResult;
      try {
        removed = await target.provider.remove(
          target.resourceId,
          path,
          base ? { ifMatch: base } : undefined,
        );
        // The note moved on only in its metadata (a touch, a sync client
        // rewriting the same bytes): theirs is the text this device loaded,
        // so the delete still means what the person meant. Bounded, like the
        // save's retry, so a busy writer cannot spin it.
        for (let tries = 0; tries < 3 && !removed.ok && removed.theirs; tries++) {
          if (loaded === undefined) break;
          if (removed.conflict !== 'changed' || removed.theirs.text !== loaded) break;
          removed = await target.provider.remove(target.resourceId, path, {
            ifMatch: versionOf(removed.theirs),
          });
        }
      } catch (err) {
        // The toast says it. The standing 'save' line promises that unsaved
        // text saves later, which is not about a delete, and nothing retries
        // one, so vaultError is left as it was.
        const refusal = vaultRefusal(err);
        // A refusal that is its own whole line (CX Y14) is said as it is.
        if (refusal && (err as { whole?: unknown }).whole === true) {
          get().showToast(refusal);
          return false;
        }
        get().showToast(
          refusal
            ? `Could not delete that note. ${asSentence(refusal)}`
            : 'Could not delete that note. Check your vault storage connection.',
        );
        return false;
      }
      if (!removed.ok) {
        await settleStaleDelete(target, path, removed, base);
        return false;
      }
      const key = vaultKey(target, path);
      patchVaultFiles(target, { removed: path });
      // Drop any stashed draft for a note the user just deleted, so it cannot
      // resurrect on the next replay.
      await editVaultPending((p) => {
        delete p[key];
      }).catch(() => {});
      if (isActiveVault(target)) {
        set({
          vaultNote: get().vaultNote?.path === path ? undefined : get().vaultNote,
          vaultError: undefined,
        });
      }
      logEvent('vault_note_delete');
      return true;
    },

    async vaultReadAll() {
      const target = vaultTarget();
      if (!target)
        return Object.assign([] as Array<{ path: string; text: string }>, { failed: [] });
      return readAllNotes(target);
    },

    async exportPersonalVault() {
      // The iPhone's way out of the sealed Local vault, free from Settings
      // while the Vault room is shut: exporting never needs an account.
      const target = personalVault();
      if (!target) return;
      try {
        const notes = await readAllNotes(target);
        if (!notes.length && !notes.failed.length) {
          get().showToast('Nothing to export yet.');
          return;
        }
        const result = await exportVaultToFiles(notes, notes.failed);
        get().showToast(
          result ? vaultExportLine(result) : 'Export works in OpenShore on the iPhone.',
        );
      } catch {
        get().showToast('Could not export your vault. Check device storage and try again.');
      }
    },

    async vaultReadBody(path) {
      const target = vaultTarget();
      if (!target) return undefined;
      const key = vaultKey(target, path);
      const listed = get().vaultFiles.find((f) => f.path === path);
      const cached = vaultBodyCache.get(key);
      if (cached && listed && cached.version === versionOf(listed)) return cached.text;
      const note = await target.provider.read(target.resourceId, path);
      if (!note) return undefined;
      if (isActiveVault(target))
        vaultBodyCache.set(key, { version: versionOf(note), text: note.text });
      return note.text;
    },

    vaultBindAutosave(handle) {
      vaultAutosaveHandle = handle;
    },

    vaultCapsNow(opts) {
      const t = vaultTarget();
      if (!t) return vaultCaps({} as StorageProvider, { readOnly: true });
      // The storage alone, for the lines that say why it lacks an action
      // (read-only and away keep their own standing lines).
      return opts?.storageOnly ? vaultCaps(t.provider, { readOnly: false }) : capsOf(t);
    },

    async vaultDeleteNote(path, at) {
      const t = vaultTargetFrom(at);
      if (!t) return undefined;
      const readOnly = vaultReadOnlyReason(t.providerId);
      if (readOnly) {
        get().showToast(readOnly);
        return undefined;
      }
      // A lapsed plan, or a member under admins-only (OV402, OV403): the
      // server's refusal, said before it is asked. Lapsed, the caps have no
      // Trash, and the for-good path below must never run on a team note.
      const teamRefused = await teamRefusalNow(t, 'delete');
      if (teamRefused) return { ok: false, reason: 'storage', line: teamRefused };
      if (await leaseRefuses(t)) return undefined;
      if (!capsOf(t).trash) {
        // No real Trash here: the delete is for good (two taps on screen),
        // and the bytes are kept in memory for a courtesy Undo (R2). The
        // pending text is written first, so the Undo brings back what was
        // last typed; M2's guarded delete does the rest.
        await flushOpenSave(t).catch(() => {});
        const text = await readBodyOf(t, path).catch(() => undefined);
        if (!(await get().vaultDelete(path, at))) return undefined;
        return {
          ok: true,
          trashed: false,
          ...(text !== undefined ? { undo: { kind: 'bytes' as const, path, text } } : {}),
          notes: 1,
          attachments: 0,
        };
      }
      const base = vaultBaseOf(t, path);
      const r = await asOwnMove(() => opsDeleteNote(opsDeps(t), path));
      if (!r.ok) {
        // The note moved on, or is gone, or is still downloading: M2's stale
        // delete path says so and reloads it; nothing went to Trash.
        if (r.reason === 'changed' || r.reason === 'downloading') {
          await settleStaleDelete(
            t,
            path,
            { ok: false, conflict: r.reason, theirs: r.theirs },
            base,
          );
          return undefined;
        }
        // Already gone (a teammate deleted or moved it before this list or
        // the open note caught up): nothing is left to delete, so it says so
        // and the list is read again, never "try again". An open note takes
        // M1's path: a clean one closes, one with unsaved edits asks
        // (round 5, finding 5).
        if (r.reason === 'missing') {
          if (isActiveVault(t) && get().vaultNote?.path === path) {
            await inSaveChain(t, path, () => recheckOpenNote(t, path)).catch(() => undefined);
          }
          await relistActive(t);
          return { ok: false, reason: 'missing', line: vaultGoneToast(noteTitle(path)) };
        }
        const refused = refusalOf(r);
        if (refused) {
          return { ok: false, reason: 'storage', line: vaultRefusedLine('delete', refused) };
        }
        return { ok: false, reason: r.reason };
      }
      await afterNoteGone(t, path);
      logEvent('vault_note_trash');
      void refreshVaultTrash(t);
      return r;
    },

    async vaultDeleteFolder(folder) {
      const t = vaultTarget();
      if (!t) return undefined;
      // A lapsed plan, or a member under admins-only (OV402, OV403), said
      // before the server is asked.
      const teamRefused = await teamRefusalNow(t, 'delete');
      if (teamRefused) return { ok: false, reason: 'storage', line: teamRefused };
      if (!capsOf(t).trash) return { ok: false, reason: 'unsupported' };
      if (await leaseRefuses(t)) return undefined;
      const r = await asOwnMove(() => opsDeleteFolder(opsDeps(t), folder));
      const refused = !r.ok ? refusalOf(r) : undefined;
      if (refused) {
        return { ok: false, reason: 'storage', line: vaultRefusedLine('delete', refused) };
      }
      // Nothing went, because every note in it changed while this ran (a
      // teammate saving, E21): the folder is as it was, and the line names
      // them, never "Try again".
      if (!r.ok && r.reason === 'changed' && r.changed?.length) {
        await relistActive(t);
        return {
          ok: false,
          reason: 'changed',
          line: vaultFolderTrashChanged(folder.slice(folder.lastIndexOf('/') + 1), r.changed),
        };
      }
      if (!r.ok) return { ok: false, reason: r.reason === 'changed' ? 'storage' : r.reason };
      // Stopped part way (the team vault, E20): what went is in Trash, the
      // rest is still in the folder, so the folder stays and the list is
      // read again either way.
      const left = new Set(r.partial?.left ?? []);
      const open = get().vaultNote;
      if (open && open.path.startsWith(`${folder}/`) && !left.has(open.path)) {
        await afterNoteGone(t, open.path);
      }
      if (!r.partial) await moveEmptyFolders(t, folder);
      await refreshVaultFolders(t);
      logEvent('vault_folder_trash');
      await relistActive(t);
      void refreshVaultTrash(t);
      return r;
    },

    async vaultUndoDelete(undo, at) {
      const t = vaultTargetFrom(at);
      if (!t) return undefined;
      // The plan lapsed while the toast was up: the Undo is a write the
      // server refuses (OV402), so once a read of the plan says so still
      // (E37) it says the plan's line and writes nothing.
      const teamRefused = await teamRefusalNow(t, 'restore');
      if (teamRefused) return { ok: false, reason: 'unsupported', line: teamRefused, whole: true };
      const r = await opsUndoDelete(opsDeps(t), undo);
      if (r.ok && undo.kind === 'trash' && undo.folder) await relistActive(t);
      void refreshVaultTrash(t);
      // Nothing of it is left in Trash (a teammate brought it back, or its
      // history was cleared): it says so, never "still in Trash", and the
      // list is read again (round 5 sweep).
      if (!r.ok && r.reason === 'missing' && undo.kind === 'trash') {
        await relistActive(t);
        const title = undo.folder
          ? undo.path.slice(undo.path.lastIndexOf('/') + 1)
          : noteTitle(undo.path);
        return { ok: false, reason: 'missing', line: vaultTrashGone(title), whole: true };
      }
      // A refusal for good (the team's free space, 0023) says the verb first.
      const refused = !r.ok ? refusalOf(r) : undefined;
      if (refused) {
        const line = vaultRefusedLine('restore', refused);
        return { ok: false, reason: 'storage', line, whole: true };
      }
      return r;
    },

    async vaultLoadTrash() {
      const t = vaultTarget();
      return t ? refreshVaultTrash(t) : undefined;
    },

    async vaultSetTeamDeleteRole(role) {
      const orgId = get().settings.account?.org?.serverId;
      if (!orgId) return 'failed';
      // A plan read as "not an admin" refuses here, verb first; a plan never
      // read (its first read failed) is asked for, by the write's own read,
      // so a retry the row offers reaches the server (round 7 E55).
      if (get().vaultTeamPlan?.isAdmin === false) {
        return {
          kind: 'refused',
          line: vaultRefusedLine('save', { line: VAULT_TEAM_SETTINGS_ADMINS_ONLY }),
        };
      }
      try {
        return await setOrgVaultDeleteRole(orgId, role);
      } catch (err) {
        // Refused for good (OV402, or no longer an admin): its line, verb
        // first, and the row read again; never "try again".
        const refusal = vaultRefusal(err);
        if (refusal) {
          void get().vaultLoadSettings({ force: true });
          return { kind: 'refused', line: vaultRefusedLine('save', { line: refusal }) };
        }
        return 'failed';
      }
    },

    async vaultRestoreTrash(id) {
      const t = vaultTarget();
      if (!t) return { ok: false, reason: 'unsupported' };
      // A Trash page open when the plan lapsed: Restore is a write the server
      // refuses (OV402), so once a read of the plan says so still (E37) it
      // says the plan's line and writes nothing.
      const teamRefused = await teamRefusalNow(t, 'restore');
      if (teamRefused) return { ok: false, reason: 'unsupported', line: teamRefused, whole: true };
      const entry = get().vaultTrash?.find((e) => e.id === id);
      // A row the page showed: it comes back only while still in Trash (E38).
      const r = await opsRestoreEntry(opsDeps(t), id, { listed: true });
      if (r.ok && entry?.kind === 'folder') await relistActive(t);
      void refreshVaultTrash(t);
      // Nothing of it is left in Trash (restored or cleared elsewhere): it
      // says so, never "still in Trash" (round 5 sweep).
      if (!r.ok && r.reason === 'missing' && entry) {
        await relistActive(t);
        const title =
          entry.kind === 'folder'
            ? entry.path.slice(entry.path.lastIndexOf('/') + 1)
            : noteTitle(entry.path);
        return { ok: false, reason: 'missing', line: vaultTrashGone(title), whole: true };
      }
      // A refusal for good (the team's free space, 0023) says the verb first.
      const refused = !r.ok ? refusalOf(r) : undefined;
      if (refused) {
        const line = vaultRefusedLine('restore', refused);
        return { ok: false, reason: 'storage', line, whole: true };
      }
      return r;
    },

    async vaultEmptyTrash() {
      const t = vaultTarget();
      if (!t || !capsOf(t).emptyTrash) return { ok: false, reason: 'unsupported' };
      const r = await opsEmptyTrash(opsDeps(t));
      await refreshVaultTrash(t);
      return r;
    },

    async vaultPrepareMove(kind, from, to) {
      const t = vaultTarget();
      if (!t || !capsOf(t).rename) return undefined;
      const r =
        kind === 'note'
          ? await opsPrepareNoteMove(opsDeps(t), from, to)
          : await opsPrepareFolderMove(opsDeps(t), from, to);
      return r.ok ? r.preview : undefined;
    },

    async vaultApplyMove(preview, updateLinks, onProgress) {
      const t = vaultTarget();
      if (!t || !capsOf(t).rename) return undefined;
      if (await leaseRefuses(t)) return undefined;
      // A team folder moved where a note would land on a name in Trash moves
      // nothing: each note's move would be refused there anyway (the move
      // would take that note out of Trash), and a folder half moved helps
      // nobody (E22). A single note's move is refused by the storage.
      if (preview.kind === 'folder' && t.providerId === 'org' && t.provider.listTrash) {
        const trash = await t.provider.listTrash(t.resourceId).catch(() => undefined);
        const dead = new Set((trash ?? []).filter((e) => e.kind === 'note').map((e) => e.path));
        const hit = [...preview.moves.values()].find((to) => dead.has(to));
        if (hit) {
          const old = preview.from.slice(preview.from.lastIndexOf('/') + 1);
          return {
            ok: false,
            reason: 'storage',
            line: vaultFolderMoveInTrash(old, noteTitle(hit)),
            whole: true,
          };
        }
      }
      const r = await asOwnMove(() =>
        opsApplyMove(opsDeps(t), preview, {
          updateLinks: updateLinks && capsOf(t).linkRewrite,
          ...(onProgress ? { onProgress } : {}),
        }),
      );
      if (preview.kind === 'folder' && (r.ok || r.reason === 'partial')) {
        // The folder's remembered empty folders follow it, and the list is
        // read again for the spelling the storage gave every moved path.
        if (r.ok) await moveEmptyFolders(t, preview.from, preview.to);
        await relistActive(t);
        await refreshVaultFolders(t);
      }
      if (!r.ok && r.reason === 'changed' && get().vaultNote?.path === preview.from) {
        // Changed somewhere else before the rename ran: the open note takes
        // the M1 path (a clean one reloads, a dirty one asks).
        await inSaveChain(t, preview.from, () => recheckOpenNote(t, preview.from));
      }
      // Gone before the rename ran (a teammate deleted or moved it): it says
      // so, never "try again", and the list is read again. An open note takes
      // the M1 path (round 5, finding 5).
      if (!r.ok && r.reason === 'missing' && preview.kind === 'note') {
        if (get().vaultNote?.path === preview.from) {
          await inSaveChain(t, preview.from, () => recheckOpenNote(t, preview.from)).catch(
            () => undefined,
          );
        }
        await relistActive(t);
        return { ...r, line: vaultGoneToast(noteTitle(preview.from)), whole: true };
      }
      // A folder with nothing left to move (its notes were moved or deleted
      // somewhere else since the list): not a rename, and the list is read
      // again (round 7 E25).
      if (!r.ok && r.reason === 'missing' && preview.kind === 'folder') {
        await relistActive(t);
        await refreshVaultFolders(t);
        const old = preview.from.slice(preview.from.lastIndexOf('/') + 1);
        return { ...r, line: vaultFolderMoveGone(old), whole: true };
      }
      // A folder moved note by note that stopped on a name already taken
      // where it was going (letter case counts): it names that note.
      if (!r.ok && r.stoppedOn === 'exists' && preview.kind === 'folder') {
        const there = r.theirs?.path ?? r.stoppedAt ?? preview.to;
        const line = vaultFolderMoveTaken({
          old: preview.from.slice(preview.from.lastIndexOf('/') + 1),
          moved: r.moved?.length ?? 0,
          total: r.notes ?? preview.notes,
          name: noteTitle(there),
          folder: noteFolder(there),
        });
        return { ...r, line, whole: true };
      }
      // A folder whose first note changed while the move ran moved nothing,
      // and a folder has no newer version to open, so it says only that;
      // trying again is true (round 5 sweep).
      if (!r.ok && r.reason === 'changed' && preview.kind === 'folder') {
        const old = preview.from.slice(preview.from.lastIndexOf('/') + 1);
        return { ...r, line: vaultRenameFailed(old), whole: true };
      }
      if (r.ok) logEvent('vault_rename', { kind: preview.kind, links: preview.links > 0 });
      // A refusal for good (a team past its free space, 0023): the verb
      // first, or, for a folder stopped part way, what moved before it.
      const refused = !r.ok ? refusalOf(r) : undefined;
      if (refused && !r.ok) {
        const line =
          r.reason === 'partial'
            ? vaultFolderMoveRefused(
                preview.from.slice(preview.from.lastIndexOf('/') + 1),
                r.moved?.length ?? 0,
                r.notes ?? preview.notes,
                refused.line,
              )
            : vaultRefusedLine('rename', refused);
        return { ...r, line, whole: true };
      }
      return r;
    },

    async vaultUpdateRest(preview, report, onProgress) {
      const t = vaultTarget();
      if (!t || !capsOf(t).linkRewrite) return undefined;
      return opsUpdateTheRest(opsDeps(t), preview, report, onProgress);
    },

    async vaultCreateFolder(path) {
      const t = vaultTarget();
      if (!t || !capsOf(t).folders) return { ok: false, reason: 'unsupported' };
      const clean = path.trim().replace(/^\/+|\/+$/g, '');
      const known = [...(get().vaultFolders ?? [])];
      if (known.some((f) => foldPath(f) === foldPath(clean)))
        return { ok: false, reason: 'exists' };
      const r = await opsCreateFolder(opsDeps(t), clean);
      if (!r.ok) return { ok: false, reason: r.reason };
      if (r.remembered) await editEmptyFolders(t, (list) => [...list, clean]).catch(() => {});
      await refreshVaultFolders(t);
      return { ok: true, path: clean };
    },

    vaultSearchSource() {
      const t = vaultTarget();
      const host = t ? vaultIndexOf(t) : undefined;
      if (!t || !host) return undefined;
      return {
        titleMatches: (q, limit) => host.index.titleMatches(q, limit),
        // The host's search rebuilds any term vectors kept in memory only
        // first; the filter clauses ride along (A1 dedupes them in q).
        search: (q, opts) => host.search(q, opts),
        note: (path) => {
          const e = host.index.entry(path);
          return e ? { title: e.title, updatedAt: e.updatedAt } : undefined;
        },
        readBody: (path) => readBodyOf(t, path),
      };
    },

    async vaultToday() {
      const t = vaultTarget();
      if (!t || !capsOf(t).today) return undefined;
      const resolve = () =>
        resolveVaultToday({
          provider: t.provider,
          resourceId: t.resourceId,
          paths: get().vaultFiles.map((f) => f.path),
          readBody: (path) => readBodyOf(t, path),
          cacheKey: foldersKey(t),
        }).catch(() => undefined);
      let plan = await resolve();
      if (!plan) return { kind: 'refused', line: VAULT_TODAY_FAILED };
      if (!plan.ok) return { kind: 'refused', line: vaultTodayLine(plan)! };
      // Already there: it opens as it is, with nothing written (K7). Gone
      // since the list (a teammate deleted or moved it), the day is planned
      // again on the list taken then, template and all, and made below
      // like any new day (E24).
      if (plan.exists) {
        if ((await get().vaultOpen(plan.path, { quietGone: true })) !== 'gone') {
          return { kind: 'opened', path: plan.path };
        }
        plan = await resolve();
        if (!plan) return { kind: 'refused', line: VAULT_TODAY_FAILED };
        if (!plan.ok) return { kind: 'refused', line: vaultTodayLine(plan)! };
        if (plan.exists) {
          await get().vaultOpen(plan.path);
          return { kind: 'opened', path: plan.path };
        }
      }
      // A team plan read as lapsed is read again first, and the caps follow
      // what it says now (round 7 E37).
      if (t.providerId === 'org' && get().vaultTeamPlan?.entitled === false) {
        await teamRefusalNow(t, 'create');
      }
      // A start is a write: read-only or away says so in the room's words.
      const caps = capsOf(t);
      if (!caps.taskWriteBack) {
        const why =
          vaultReadOnlyReason(t.providerId) ??
          (t.providerId === 'hub' && hubReach() === 'away' ? HUB_AWAY_READ_ONLY : undefined) ??
          (get().vaultLeaseHeldByOther
            ? vaultLeaseEnforced(get().vaultLeaseOther?.label).line
            : undefined) ??
          // A lapsed team plan takes no new note (OV402): its line, never
          // the generic one.
          vaultTeamRefusal(t.providerId, get().vaultTeamPlan, 'create') ??
          VAULT_TODAY_FAILED;
        return { kind: 'refused', line: why };
      }
      // The team's free space is used up (E27): a new note is refused here,
      // before the server is asked.
      if (t.providerId === 'org' && get().vaultTeamPlan?.full) {
        return { kind: 'refused', line: vaultRefusedLine('today', { line: VAULT_TEAM_FULL }) };
      }
      if (await leaseRefuses(t)) return undefined;
      const r = await opsOpenToday(opsDeps(t), { path: plan.path, text: plan.text });
      // A refusal for good (a team out of free space, 0023) says why.
      const refused = !r.ok ? refusalOf(r) : undefined;
      if (refused) return { kind: 'refused', line: vaultRefusedLine('today', refused) };
      if (!r.ok) {
        return {
          kind: 'refused',
          line:
            r.reason === 'downloading'
              ? 'Still downloading this note from your vault storage. Try again shortly.'
              : VAULT_TODAY_FAILED,
        };
      }
      if (!r.created) {
        // Another device made it a moment ago: open what is there, silently.
        // Gone again by then, the open has said so (E24).
        if ((await get().vaultOpen(r.path)) === 'gone') return undefined;
        return { kind: 'opened', path: r.path };
      }
      if (!isActiveVault(t)) return undefined;
      vaultLiveDraft = undefined;
      set({
        vaultNote: {
          path: r.file.path,
          text: r.file.text,
          updatedAt: r.file.updatedAt,
          version: r.file.version,
          fresh: true,
          loadedAt: nextLoadedAt(),
        },
        vaultError: undefined,
      });
      noteVaultRecent(t, r.file.path);
      logEvent('vault_today', { template: Boolean(plan.template?.found) });
      const line = vaultTodayLine(plan);
      return { kind: 'created', path: r.file.path, ...(line ? { line } : {}) };
    },

    async vaultToggleTask(path, line, checked) {
      const t = vaultTarget();
      if (!t || !capsOf(t).taskWriteBack) return false;
      if (await leaseRefuses(t)) return false;
      const title = noteTitle(path);
      // The tick acts on what the person last typed, saved first.
      await flushOpenSave(t).catch(() => {});
      // The line is counted on the text the person sees: the open note as it
      // stands after that save, else the note as last read. The tick then
      // lands only on that same text (E2).
      const open = isActiveVault(t) ? get().vaultNote : undefined;
      // Unless the editor holds text the note does not have (its save held,
      // kept for later, or waiting on a choice): the reader counted the line
      // on that text, and the note's line there may be another task (E30).
      if (
        open?.path === path &&
        ((draftOf(path) ?? open.text) !== open.text || get().vaultConflict?.path === path)
      ) {
        get().showToast(vaultTickUnsaved(title));
        return false;
      }
      let text: string | undefined;
      try {
        text = open?.path === path ? open.text : await readBodyOf(t, path);
      } catch {
        // Not answering now: a retry may land it.
        get().showToast(VAULT_TICK_FAILED);
        return false;
      }
      // Nothing there: gone (E34) says so; anything else may land on a retry.
      const tickGone = async () => {
        const gone = await noteGoneHere(t, path);
        if (gone === 'gone') get().showToast(vaultGoneLine('tick', title));
        else if (gone === 'not') get().showToast(VAULT_TICK_FAILED);
        return false;
      };
      if (text === undefined) return tickGone();
      // The reader counts lines in the whole note, frontmatter included,
      // the same basis as the core's listTasks.
      const task = listTasks(text).find((x) => x.line === line);
      if (!task || task.custom) return false;
      if (task.checked === checked) return true;
      const r = await opsToggleTask(opsDeps(t), path, task.at, task.status, text);
      if (r.ok) return true;
      // Refused for good (a plan the room had not read yet, OV402): its
      // line, never "try again" (round 5 sweep).
      const tickRefused = refusalOf(r);
      if (tickRefused) {
        get().showToast(vaultRefusedLine('save', tickRefused));
        return false;
      }
      // Moved or deleted somewhere else: said so, never "the newer version
      // is open" over a note that closed (E34).
      if (r.reason === 'missing') return tickGone();
      if (r.reason === 'changed') {
        // Changed somewhere else: the open note takes M1's path (a clean
        // one reloads the newer version, which the box then shows).
        if (isActiveVault(t) && get().vaultNote?.path === path) {
          await inSaveChain(t, path, () => recheckOpenNote(t, path)).catch(() => undefined);
        }
        get().showToast(vaultTickChanged(title));
        return false;
      }
      get().showToast(VAULT_TICK_FAILED);
      return false;
    },

    async vaultRewriteNote(path, edit) {
      const t = vaultTarget();
      if (!t || !capsOf(t).linkRewrite) return false;
      if (await leaseRefuses(t)) return false;
      await flushOpenSave(t).catch(() => {});
      const open = openNoteOf(t);
      // Never under the person: a note open here with a choice waiting.
      if (open?.path === path && open.choiceOpen) return false;
      // Moved or deleted somewhere else: its line, and the room drops the
      // row, never "try again" (E34).
      const linkGone = async () => {
        const gone = await noteGoneHere(t, path);
        if (gone === 'not') return false;
        return {
          ok: false as const,
          line: vaultGoneLine('link', noteTitle(path)),
          gone: true as const,
        };
      };
      try {
        const file = await t.provider.read(t.resourceId, path);
        if (!file) return await linkGone();
        const next = edit(file.text);
        if (next === undefined || next === file.text) return false;
        const r = await opsDeps(t).putVaultNote(path, next, { ifMatch: versionOf(file) });
        if (!r.ok && r.conflict === 'missing') return await linkGone();
        return r.ok;
      } catch (err) {
        // Refused for good (a team out of free space, 0023): say why.
        const refusal = vaultRefusal(err);
        if (refusal) return { ok: false, line: vaultRefusedLine('link', { line: refusal }) };
        return false;
      }
    },

    async vaultMediaNow() {
      const t = vaultTarget();
      if (!t || !capsOf(t).attachments) return undefined;
      // The attachments folder is the vault's resolved setting (Vault M7,
      // CTO L2): Obsidian's where it sets one, else `.oscode/vault.json`.
      const [attachments, settings] = await Promise.all([
        t.provider.listAttachments!(t.resourceId).catch(() => [] as AttachmentMeta[]),
        loadVaultSettings(t.provider, t.resourceId, foldersKey(t)).catch(() => undefined),
      ]);
      const attachmentFolder = settings?.attachments.folder;
      const provider = t.provider;
      const resourceId = t.resourceId;
      return {
        scope: `${t.providerId}:${t.resourceId}`,
        attachments,
        ...(attachmentFolder ? { attachmentFolder } : {}),
        readBytes: (path, opts) => provider.readBytes!(resourceId, path, opts),
      };
    },

    async vaultEngineRoomSource() {
      // The same order as the privacy source (privacyDeps): the desktop's
      // own engine unless it runs sessions on a remote hub, then the paired
      // computer, else no engine at all.
      const st = get().settings;
      const b = isDesktop() ? bridge() : undefined;
      if (b?.vaultPrivacy && !st.preferRemoteHub) {
        try {
          const machine = readMachinePackSize(await b.vaultPrivacy());
          return { where: 'this' as const, ...(machine ? { machine } : {}) };
        } catch {
          return { where: 'this' as const };
        }
      }
      const daemon = st.daemon;
      if (!daemon?.token) return undefined;
      const machine = await hubMachinePackSize({ baseUrl: daemon.baseUrl, token: daemon.token });
      return { where: 'your' as const, ...(machine ? { machine } : {}) };
    },

    async vaultLoadSettings(opts) {
      const t = vaultTarget();
      if (!t) return undefined;
      let settings: ResolvedVaultSettings;
      try {
        settings = await loadVaultSettings(
          t.provider,
          t.resourceId,
          foldersKey(t),
          opts?.force ? { force: true } : {},
        );
      } catch {
        return undefined;
      }
      // A late read never paints another vault's settings, nor a team read
      // made under an account that has since signed out (round 7 E14).
      if (isActiveVault(t) && speaksNow(t) && get().vaultSettings !== settings) {
        set({ vaultSettings: settings });
      }
      return settings;
    },

    async vaultSaveSetting(patch) {
      const t = vaultTarget();
      if (!t || !capsOf(t).settingsWrite || typeof t.provider.writeConfig !== 'function') {
        return { kind: 'read-only' };
      }
      let r: VaultSettingSave;
      try {
        r = await saveVaultSetting(
          { provider: t.provider, resourceId: t.resourceId, key: foldersKey(t) },
          patch,
        );
      } catch {
        r = { kind: 'failed' };
      }
      if ((r.kind === 'saved' || r.kind === 'same-field') && isActiveVault(t)) {
        set({ vaultSettings: r.settings });
      }
      // A new narrowing compiles the privacy rules again on the next read.
      if (r.kind === 'saved') {
        privacyCache = undefined;
        logEvent('vault_setting_saved', { merged: r.merged });
      }
      if (r.kind === 'unreadable' || r.kind === 'failed') {
        void get().vaultLoadSettings({ force: true });
      }
      // Refused for good (a plan that is not active, OV402, or a member no
      // longer an admin): the verb first and the storage's reason, and the
      // settings read again, so the sheet shows who may change them now.
      if (r.kind === 'refused') {
        void get().vaultLoadSettings({ force: true });
        return { kind: 'refused', line: vaultRefusedLine('save', { line: r.line }) };
      }
      return r;
    },

    async vaultMarkReviewed(path, reviewed) {
      const t = vaultTarget();
      if (!t || !capsOf(t).taskWriteBack) return 'failed';
      if (await leaseRefuses(t)) return 'failed';
      // What the person last typed is saved first, so the mark lands on it.
      await flushOpenSave(t).catch(() => {});
      let file: StoredFile | undefined;
      try {
        file = await t.provider.read(t.resourceId, path);
      } catch {
        return 'failed';
      }
      // Moved or deleted somewhere else: its line, never "try again" (E34).
      const markGone = async () => {
        const gone = await noteGoneHere(t, path);
        if (gone === 'not') return 'failed' as const;
        return { kind: 'refused' as const, line: vaultGoneLine('mark', noteTitle(path)) };
      };
      if (!file) return markGone();
      // The person's own write (CX Y12): one line, every other byte kept.
      let next: string;
      try {
        const merged = mergeProvenance(file.text, {
          'oscode-reviewed': reviewed ? new Date().toISOString() : null,
        });
        if (!('text' in merged)) return 'failed';
        next = merged.text;
      } catch {
        return 'failed';
      }
      const done = (): 'ok' => {
        get().showToast(reviewed ? VAULT_MARKED_REVIEWED : VAULT_MARKED_NOT_REVIEWED);
        logEvent('vault_mark_reviewed', { reviewed });
        return 'ok';
      };
      if (next === file.text) return done();
      let r: WriteResult;
      try {
        r = await opsDeps(t).putVaultNote(path, next, { ifMatch: versionOf(file) });
      } catch (err) {
        // Refused for good (a team out of free space, 0023): say why.
        const refusal = vaultRefusal(err);
        if (refusal) return { kind: 'refused', line: vaultRefusedLine('mark', { line: refusal }) };
        return 'failed';
      }
      if (r.ok) return done();
      if (r.conflict === 'missing') return markGone();
      if (r.conflict === 'changed') {
        // The note moved on somewhere else: the newer version opens here.
        if (isActiveVault(t) && get().vaultNote?.path === path) {
          await inSaveChain(t, path, () => recheckOpenNote(t, path)).catch(() => undefined);
        }
        return 'changed';
      }
      return 'failed';
    },

    async vaultStarterOffered() {
      const t = vaultTarget();
      if (!t || get().vaultScope !== 'personal') return false;
      try {
        return await vaultStarterOffered({
          personal: true,
          caps: capsOf(t),
          provider: t.provider,
          resourceId: t.resourceId,
          obsidianFolder: t.providerId === 'files' && get().vaultFolder?.obsidian === 'vault',
        });
      } catch {
        return false;
      }
    },

    async vaultApplyStarter() {
      const t = vaultTarget();
      if (!t || get().vaultScope !== 'personal') return { added: 0, total: 0 };
      if (await leaseRefuses(t)) return { added: 0, total: 0 };
      const r = await applyVaultStarter({
        personal: true,
        caps: capsOf(t),
        provider: t.provider,
        resourceId: t.resourceId,
        obsidianFolder: t.providerId === 'files' && get().vaultFolder?.obsidian === 'vault',
      }).catch(() => undefined);
      if (!r || !r.ok) {
        get().showToast(VAULT_STARTER_NOT_EMPTY);
        return { added: 0, total: 0 };
      }
      // The new notes and the settings file show at once.
      clearVaultTodayCache(foldersKey(t));
      await get().vaultRefresh();
      void get().vaultLoadSettings({ force: true });
      // The whole layout toasts here; a partial result says so in the sheet.
      if (r.added === r.total) get().showToast(r.line);
      logEvent('vault_starter', { added: r.added, total: r.total });
      return { added: r.added, total: r.total };
    },

    vaultRequestSheet(sheet) {
      set({ vaultSheetRequest: sheet });
    },

    vaultRecentRing() {
      const t = vaultTarget();
      return t ? (get().settings.vaultRecent?.[memoryKey(t)] ?? []) : [];
    },

    async vaultFolderCounts(folder) {
      const t = vaultTarget();
      if (!t) return { notes: 0, attachments: 0 };
      return opsFolderCounts(opsDeps(t), folder);
    },

    async vaultAcquireLease() {
      const t = vaultTarget();
      if (t) await takeVaultLease(t);
    },

    async vaultLeaseTouch() {
      const t = vaultTarget();
      if (!t || leaseModeOf(t) === 'none') return;
      const key = leaseKeyOf(t);
      // Renewed at most every VAULT_LEASE_RENEW_MS while typing continues,
      // and asked again no sooner while another device holds it.
      if (leaseTried?.key === key && Date.now() - leaseTried.at < VAULT_LEASE_RENEW_MS) return;
      await takeVaultLease(t);
    },

    async vaultReleaseLease() {
      const held = leaseHeld;
      leaseHeld = undefined;
      leaseTried = undefined;
      if (held) {
        try {
          await held.provider.releaseLease(held.resourceId, deviceHolder());
        } catch {
          // Best-effort; the lease's TTL reclaims it regardless.
        }
      }
      set({ vaultLeaseHeldByOther: false, vaultLeaseOther: undefined });
    },

    async vaultTakeOverLease() {
      const t = vaultTarget();
      if (!t || leaseModeOf(t) !== 'enforced') return;
      const other = leaseOtherHolder;
      if (other) {
        try {
          await t.provider.releaseLease(t.resourceId, other);
        } catch {
          // The acquire below says whether it worked.
        }
      }
      const won = await takeVaultLease(t);
      const label = get().vaultLeaseOther?.label;
      get().showToast(
        won === 'mine'
          ? vaultLeaseEnforced(undefined).tookOver
          : 'Could not take over editing right now. Try again in a moment.',
      );
      logEvent('vault_lease_take_over', { ok: won === 'mine', labelled: Boolean(label) });
    },

    async vaultMoveTo(providerId) {
      // The room holds still while notes move (CX 1.3): nothing that writes.
      set({ vaultMoving: true });
      try {
        const result = await moveVaultInner(providerId);
        // The vault lives somewhere else now: the warm index belonged to the
        // old home (Vault M5, CTO J1 closes it on a storage move).
        if (result.ok) {
          await shutVaultIndex().catch(() => {});
          forgetVaultSettings();
        }
        return result;
      } finally {
        set({ vaultMoving: false });
      }
    },

    async vaultLoadFolder() {
      const info = await vaultFolderInfo();
      if (info) set({ vaultFolder: info });
      return info;
    },

    async vaultChooseFolder() {
      const before = get().vaultFolder?.dir;
      const result = await chooseVaultFolder();
      if (result) await afterVaultPick(result, before);
      return result;
    },

    async vaultRefineFolder(choice) {
      const before = get().vaultFolder?.dir;
      const result = await refineVaultFolder(choice);
      if (result) await afterVaultPick(result, before);
      return result;
    },

    async vaultBringPrevious() {
      // The room holds still while notes arrive, as for a move (CX 1.3).
      set({ vaultMoving: true });
      let result: VaultBringResult | undefined;
      try {
        result = await bringPreviousVaultFolder();
      } finally {
        set({ vaultMoving: false });
      }
      if (result) {
        logEvent('vault_folder_bring', { forked: result.forked.length, ok: result.ok });
        await refreshFolderList();
        await get().vaultLoadFolder();
      }
      return result;
    },

    vaultDesktopChatOpen() {
      return Object.entries(get().conversations).some(
        ([id, c]) => c.source.kind === 'desktop' && hasLiveDriver(id),
      );
    },

    vaultFolderOfferShown() {
      const s = get();
      if (!isDesktop() || s.vaultScope !== 'personal' || s.vaultMoving) return false;
      const row = s.settings.gitosResources?.find((r) => r.id === VAULT_RESOURCE_ID);
      if (!row || row.providerId !== 'local' || row.chosenAt) return false;
      const folder = s.vaultFolder;
      if (!folder?.exists || !s.vaultListed || s.vaultError === 'load') return false;
      if (!s.vaultFiles.length) return false;
      return shouldOfferFolderMove(s.settings.vaultMoveOffer, Date.now(), folder.count);
    },

    async vaultDeclineFolderMove() {
      const s = get();
      await s.saveSettings({
        vaultMoveOffer: declineFolderMove(
          s.settings.vaultMoveOffer,
          Date.now(),
          s.vaultFolder?.count,
        ),
      });
      logEvent('vault_move_offer', { action: 'not_now' });
      s.showToast(vaultFolderOffer(s.vaultFiles.length, undefined).declineToast);
    },

    async vaultReadForkPair(pair) {
      // Through the storage the vault is on now: a move forks on its target,
      // which may be This device or iCloud, not only the folder (M1-2).
      const folder = providerFor(vaultProviderId(get().settings));
      if (!folder) return undefined;
      try {
        const [there, moved] = await Promise.all([
          folder.read(VAULT_RESOURCE_ID, pair.from),
          folder.read(VAULT_RESOURCE_ID, pair.to),
        ]);
        return there && moved ? { there, moved } : undefined;
      } catch {
        return undefined;
      }
    },

    async vaultSettleFork(pair, choice, shown) {
      const on = vaultProviderId(get().settings);
      const folder = providerFor(on);
      if (!folder) return { ok: false };
      // The list catches up with the settle: the folder re-lists itself, any
      // other storage through the room's refresh.
      const relist = () => (on === 'files' ? refreshFolderList() : get().vaultRefresh());
      const at = { provider: folder, resourceId: VAULT_RESOURCE_ID };
      // The moved copy is removed only while it still holds exactly the text
      // that was moved, so nothing written to it since is ever deleted. The
      // remove is guarded with the version just read, so a write landing
      // between the read and the remove keeps the copy too (Vault M2 wave 0).
      const removeMovedCopy = async (): Promise<'gone' | 'changed' | 'failed'> => {
        try {
          const now = await folder.read(VAULT_RESOURCE_ID, pair.to);
          if (!now) return 'gone';
          if (now.text !== shown.moved.text) return 'changed';
          const r = await folder.remove(VAULT_RESOURCE_ID, pair.to, { ifMatch: versionOf(now) });
          if (!r.ok) return r.conflict === 'changed' ? 'changed' : 'failed';
          return 'gone';
        } catch {
          return 'failed';
        }
      };
      if (choice === 'theirs') {
        const r = await removeMovedCopy();
        if (r === 'changed') return { ok: false, changed: true };
        if (r === 'failed') return { ok: false };
      } else {
        let written: WriteResult;
        try {
          written = await putVaultNote(at, pair.from, shown.moved.text, {
            ifMatch: versionOf(shown.there),
          });
        } catch {
          return { ok: false };
        }
        if (!written.ok) return { ok: false, changed: true };
        const r = await removeMovedCopy();
        if (r !== 'gone') {
          await relist();
          return { ok: true, partial: true };
        }
      }
      await relist();
      logEvent('vault_fork_settled', { choice });
      return { ok: true };
    },

    vaultHubOfferShown() {
      const s = get();
      const hub = s.settings.daemon?.baseUrl;
      if (!hub || isDesktop() || s.vaultScope !== 'personal' || s.vaultMoving) return false;
      const offer = s.settings.vaultHubOffer;
      if (offer?.hub !== hub || offer.state !== 'offered') return false;
      const row = s.settings.gitosResources?.find((r) => r.id === VAULT_RESOURCE_ID);
      if ((row?.providerId ?? 'local') !== 'local' || row?.chosenAt) return false;
      return Boolean(s.vaultListed) && s.vaultError !== 'load' && s.vaultFiles.length > 0;
    },

    async vaultAcceptHubMove() {
      const s = get();
      const hub = s.settings.daemon?.baseUrl;
      const row = s.settings.gitosResources?.find((r) => r.id === VAULT_RESOURCE_ID);
      const before: VaultBeforeHub | undefined = hub
        ? {
            providerId: row?.providerId ?? 'local',
            ...(row?.chosenAt ? { chosenAt: row.chosenAt } : {}),
            hub,
          }
        : undefined;
      const result = await get().vaultMoveTo('hub');
      if (result.ok) {
        await get().saveSettings({ vaultHubOffer: undefined, vaultBeforeHub: before });
        await shutVaultIndex().catch(() => {});
        forgetVaultSettings();
        logEvent('vault_hub_offer', { action: 'move', forked: result.forked.length });
        if (get().view === 'vault') void get().vaultRefresh();
      }
      return result;
    },

    async vaultDeclineHubMove() {
      const hub = get().settings.daemon?.baseUrl;
      if (!hub) return;
      await get().saveSettings({ vaultHubOffer: { hub, state: 'declined' } });
      logEvent('vault_hub_offer', { action: 'not_now' });
    },

    vaultAfterPairing() {
      return hubPairingStep().catch(() => 'stay' as const);
    },

    canEditProjectPins(projectId) {
      const project = get().settings.projects?.find((p) => p.id === projectId);
      return Boolean(project) && canEdit(projectPermissionFor(project!));
    },

    async setProjectVaultPins(projectId, paths) {
      if (!get().canEditProjectPins(projectId)) return false;
      const clean = [
        ...new Set(paths.map((p) => normalizeNotePath(p)).filter((p): p is string => Boolean(p))),
      ].slice(0, PROJECT_VAULT_PINS_MAX);
      // Local only, always: pins name the person's own notes, so they never
      // ride updateProject's server write (orgProjects.ts syncs name,
      // instructions and repoIds), whatever the project's sharing.
      await patchProjectLocal(projectId, { vaultPins: clean.length ? clean : undefined });
      logEvent('project_vault_pins', { count: clean.length });
      return true;
    },

    async pinVaultNoteToProject(path, projectId) {
      const s = get().settings;
      const id = projectId ?? s.activeProjectId ?? s.projects?.[0]?.id;
      const project = id ? s.projects?.find((p) => p.id === id) : undefined;
      if (!project || !get().canEditProjectPins(project.id)) return 'refused';
      const note = normalizeNotePath(path);
      if (!note) return 'refused';
      const pins = project.vaultPins ?? [];
      if (pins.includes(note)) return 'already';
      if (pins.length >= PROJECT_VAULT_PINS_MAX) return 'full';
      const ok = await get().setProjectVaultPins(project.id, [...pins, note]);
      return ok ? 'pinned' : 'refused';
    },

    async unpinVaultNote(projectId, path) {
      const project = get().settings.projects?.find((p) => p.id === projectId);
      if (!project?.vaultPins?.includes(path)) return;
      await get().setProjectVaultPins(
        projectId,
        project.vaultPins.filter((p) => p !== path),
      );
    },

    async vaultRenamePins(from, to) {
      const a = normalizeNotePath(from);
      const b = normalizeNotePath(to);
      if (a && b) await rewriteVaultPins(a, b);
    },

    async vaultPinStatus(paths) {
      const out: Record<string, 'ok' | 'missing' | 'unknown'> = {};
      const t = personalVault();
      await Promise.all(
        paths.map(async (p) => {
          if (!t) {
            out[p] = 'unknown';
            return;
          }
          try {
            out[p] = (await t.provider.stat(t.resourceId, p)) ? 'ok' : 'missing';
          } catch {
            out[p] = 'unknown';
          }
        }),
      );
      return out;
    },

    async vaultPinPrivacy(paths) {
      const out: Record<string, VaultVisibility> = {};
      if (!paths.length) return out;
      const privacy = await vaultPrivacyNow();
      await Promise.all(
        paths.map(async (p) => {
          let file: StoredFile | undefined;
          try {
            file = await personalRead(p);
          } catch {
            file = undefined;
          }
          out[p] = privacy.visibility(
            file ? noteFactsFromText(p, file.text, file.updatedAt) : { path: p },
          );
        }),
      );
      return out;
    },

    async vaultPickerNotes() {
      const facts = await personalNoteFacts();
      if (!facts) return [];
      return pickerNotes(facts, await vaultPrivacyNow());
    },

    composerSeat(conversationId, fallback) {
      const id = conversationId ?? get().activeId;
      return composerSeatFor((id ? get().conversations[id]?.source : undefined) ?? fallback);
    },

    async composerVaultExcerpt(path, conversationId) {
      const t = personalVault();
      if (!t) return { ok: false, reason: 'Your Vault is not ready on this device yet.' };
      let file: StoredFile | undefined;
      try {
        file = await t.provider.read(t.resourceId, path);
      } catch {
        return { ok: false, reason: 'That note could not be read right now.' };
      }
      if (!file) return { ok: false, reason: 'That note is not in your Vault any more.' };
      // Judged on the note's own text (its tags and marks), so a note the
      // index has not read yet is never taken for open.
      const visibility = (await vaultPrivacyNow()).visibility(
        noteFactsFromText(path, file.text, file.updatedAt),
      );
      if (visibility === 'hidden') {
        return { ok: false, reason: 'This note is kept out of every model.' };
      }
      return excerptForSeat(
        {
          path,
          title: noteTitle(path),
          text: file.text,
          updatedAt: file.updatedAt,
          localOnly: visibility === 'local-only',
        },
        get().composerSeat(conversationId),
      );
    },

    async composerVaultRead(path) {
      let file: StoredFile | undefined;
      try {
        file = await personalRead(path);
      } catch {
        return null;
      }
      if (!file) return null;
      const visibility = (await vaultPrivacyNow()).visibility(
        noteFactsFromText(path, file.text, file.updatedAt),
      );
      return { text: file.text, updatedAt: file.updatedAt, visibility };
    },

    takeComposerInsert(id) {
      if (get().composerInsert?.id === id) set({ composerInsert: undefined });
    },

    async askAboutVaultNote(path) {
      const s = get();
      const projectId = s.settings.activeProjectId ?? s.settings.projects?.[0]?.id;
      const open = s.activeId ? s.conversations[s.activeId] : undefined;
      // The chat open now when it is the active project's; otherwise a new
      // chat there, whose composer takes the excerpt.
      const conversationId =
        open && (!projectId || open.projectId === projectId) ? open.id : undefined;
      const result = await get().composerVaultExcerpt(path, conversationId);
      if (!result.ok) {
        get().showToast(result.reason);
        return;
      }
      if (conversationId) get().openConversation(conversationId);
      else get().startNewChat();
      set({
        view: 'chat',
        composerInsert: {
          id: newId(),
          ...(conversationId ? { conversationId } : {}),
          path,
        },
      });
      logEvent('vault_ask_about_note', { trimmed: result.excerpt.trimmed });
    },

    async vaultAgentRecent() {
      const facts = await personalNoteFacts();
      if (!facts) return [];
      return agentRecentNotes(
        facts,
        get().settings.vaultAgentWrites ?? [],
        await vaultPrivacyNow(),
      );
    },

    async noteAgentVaultWrite(path) {
      const note = normalizeNotePath(path);
      if (!note) return;
      const ring = get().settings.vaultAgentWrites ?? [];
      await get().saveSettings({ vaultAgentWrites: pushAgentRecent(ring, note) });
    },

    vaultPackOpener(conversationId) {
      const conv = get().conversations[conversationId];
      const t = personalVault();
      if (!conv || !t) return undefined;
      // An app chat's pack reads this device's own vault. An engine pack reads
      // the computer's vault root: this device opens it only when its vault
      // is that same vault (the hub, or the desktop's own folder).
      const engine = conv.source.kind === 'desktop' || conv.source.kind === 'desktop-chat';
      const same =
        !engine ||
        t.providerId === 'hub' ||
        (isDesktop() && t.providerId === 'files' && !get().settings.preferRemoteHub);
      if (!same) return undefined;
      return (path: string) => {
        void (async () => {
          if (get().vaultScope !== 'personal') await get().setVaultScope('personal');
          get().setView('vault');
          // When the sign-in sheet opened instead, nothing opens behind it.
          if (get().view !== 'vault') return;
          await get().vaultOpen(path);
        })();
      };
    },

    async saveHandoffToVault(conversationId, itemId) {
      const conv = get().conversations[conversationId];
      const item = conv?.thread.items.find((i) => i.id === itemId);
      if (!item || item.kind !== 'note' || !item.handoff) return undefined;
      if (item.handoff.savedPath) return item.handoff.savedPath;
      const t = personalVault();
      if (!t) {
        get().showToast('Your Vault is not ready on this device yet.');
        return undefined;
      }
      const readOnly = vaultReadOnlyReason(t.providerId);
      if (readOnly) {
        get().showToast(readOnly);
        return undefined;
      }
      const handoff = item.handoff;
      const text = handoffNoteText(handoff);
      for (let attempt = 1; attempt <= 50; attempt++) {
        const path = handoffNotePath(handoff.date, handoff.project, attempt);
        let saved: StoredFile | undefined;
        try {
          // A storage that does not enforce the guard is asked first, so a
          // note already there is never replaced.
          if (!t.provider.compareAndSwap && (await t.provider.stat(t.resourceId, path))) continue;
          const r = await putVaultNote(t, path, text, { ifAbsent: true });
          if (!r.ok) {
            if (r.conflict === 'exists') continue;
            throw new Error(r.conflict);
          }
          saved = r.file;
        } catch {
          get().showToast('Could not save to your Vault right now. Try again in a moment.');
          return undefined;
        }
        set((s) => {
          const c = s.conversations[conversationId];
          if (!c) return s;
          const items = c.thread.items.map((i) =>
            i.id === itemId && i.kind === 'note' && i.handoff
              ? { ...i, handoff: { ...i.handoff, savedPath: saved!.path } }
              : i,
          );
          return {
            conversations: {
              ...s.conversations,
              [conversationId]: { ...c, thread: { ...c.thread, items } },
            },
          };
        });
        void persistConversations(get());
        get().showToast(`Saved as ${saved.path}.`);
        logEvent('vault_handoff_saved');
        return saved.path;
      }
      get().showToast(
        'Could not find a free name in Handoffs. Rename an older handoff note first.',
      );
      return undefined;
    },

    async projectHandoff(projectId) {
      if (memoryOverride(get().settings) === false) return undefined;
      return readHandoff(handoffStorage, projectId);
    },

    async connectGdriveAccount() {
      const result = await connectGdrive();
      logEvent(result.ok ? 'gdrive_connected' : 'gdrive_connect_failed');
      return result;
    },

    async disconnectGdriveAccount() {
      await disconnectGdrive();
      logEvent('gdrive_disconnected');
    },

    openConversation(id) {
      const conv = get().conversations[id];
      if (!conv) return;
      // A chat opened from the Chats list, or from inside a project's detail
      // room, is a sub-page of that room: its top bar offers a way back there
      // (the iOS grammar), instead of the drawer menu. Reached any other way
      // (the panel's Chat, a fresh chat), the chat is a root and keeps the
      // menu, so the trail clears.
      const from = get().view;
      const viewTrail: ViewName[] = from === 'chats' || from === 'project' ? [from] : [];
      set({ activeId: id, view: 'chat', viewTrail, drawerOpen: false });
      if (!hasLiveDriver(id)) {
        // Reattach lazily (ensureDriver). A desktop thread reopens on its
        // saved read-only snapshot (B4): what was said stays on screen while
        // the journal is fetched, the first journal frame replaces it, and if
        // the computer is off or away the snapshot is simply what there is.
        // The resume skeleton (no snapshot) gives way on that first frame or
        // after a timeout, never on driver construction, since the journal
        // arrives over the stream later than the driver exists.
        if (conv.source.kind === 'desktop' && !building.has(id)) {
          snapshotIds.add(id);
          set((s) => ({
            resumingId: id,
            conversations: {
              ...s.conversations,
              [id]: { ...s.conversations[id]!, thread: snapshotThread(conv.thread) },
            },
          }));
          setTimeout(() => {
            if (get().resumingId === id) set({ resumingId: undefined });
          }, RESUME_TIMEOUT_MS);
        }
        ensureDriver(id);
      }
    },

    deleteConversation(id) {
      dropDriver(id);
      repoContextStale.delete(id);
      pendingSends.delete(id);
      set((s) => {
        const conversations = { ...s.conversations };
        delete conversations[id];
        return {
          conversations,
          order: s.order.filter((x) => x !== id),
          activeId: s.activeId === id ? undefined : s.activeId,
        };
      });
      void persistConversations(get());
      // A handoff this chat wrote goes with it (CTO J13).
      handoffWrittenAt.delete(id);
      void clearHandoffs(handoffStorage, { conversationId: id }).catch(() => {});
    },

    async clearConversations() {
      for (const id of [...get().order]) get().deleteConversation(id);
      // Recent is cleared with the chats (CX X4).
      if (get().settings.vaultRecent) {
        await get()
          .saveSettings({ vaultRecent: undefined })
          .catch(() => {});
      }
      await clearHandoffs(handoffStorage, { all: true }).catch(() => {});
      const s = get();
      const b = isDesktop() ? bridge() : undefined;
      if (b?.clearHandoffs) await b.clearHandoffs().catch(() => {});
      if (s.settings.daemon && s.hubRole !== 'member') {
        await Promise.resolve()
          .then(() => daemonClearHandoffs(s.settings.daemon!))
          .catch(() => false);
      }
      logEvent('conversations_cleared');
    },

    send(text, attachments) {
      const { activeId } = get();
      if (!activeId) return;
      // The guided setup's chat: a "not now", "let's set up", or "skip" is
      // about the walk (see interceptSetupMessage).
      if (!(attachments && attachments.length) && !get().conversations[activeId]?.thread.busy) {
        if (interceptSetupMessage(activeId, text)) return;
      }
      if (holdForHarborLite(activeId, text, attachments)) return;
      // Repositories changed since this driver was built: between turns,
      // rebuild it from the transcript (the parked-send path below) so the new
      // list and working folder apply to this message.
      if (repoContextStale.has(activeId)) {
        const c = get().conversations[activeId];
        if (c && !c.thread.busy && !c.thread.pendingApprovals.length && liveDriver(activeId)) {
          repoContextStale.delete(activeId);
          dropDriver(activeId);
        }
      }
      const driver = liveDriver(activeId);
      if (!driver) {
        // The driver is still building (a fast send after reopen) or its build
        // failed. Park the message on the chat, visibly, and make sure a build
        // is on its way; the attach delivers it. Never dropped (B3).
        if (!text.trim() && !(attachments && attachments.length)) return;
        get().sendWhenAttached(activeId, text, attachments);
        ensureDriver(activeId);
        return;
      }
      // Mid-run: hold the message and send it when the task ends (attachDriver
      // flushes on task-done). Attachments do not queue; they need a live turn.
      const conv = get().conversations[activeId];
      if (conv?.thread.busy && !(attachments && attachments.length)) {
        if (!text.trim()) return;
        set((s) => {
          const c = s.conversations[activeId];
          if (!c) return s;
          return {
            conversations: {
              ...s.conversations,
              [activeId]: { ...c, thread: { ...c.thread, queued: [...c.thread.queued, text] } },
            },
          };
        });
        return;
      }
      // Remember that this chat carried an image, so a later model switch can
      // disclose that earlier images do not cross over (the transcript is text).
      if (attachments?.some((a) => a.mime.startsWith('image/'))) {
        set((s) => {
          const c = s.conversations[activeId];
          if (!c || c.hadVisionInput) return s;
          return {
            conversations: { ...s.conversations, [activeId]: { ...c, hadVisionInput: true } },
          };
        });
      }
      deliver(activeId, driver, text, attachments);
      // The Claude pattern: ask for notices the first time you send something
      // you might walk away from. iOS prompts once; later calls just read it.
      if (isPhone()) void askForNotices();
    },

    unqueue(index) {
      const { activeId } = get();
      if (!activeId) return;
      set((s) => {
        const c = s.conversations[activeId];
        if (!c) return s;
        const queued = c.thread.queued.filter((_, i) => i !== index);
        return {
          conversations: {
            ...s.conversations,
            [activeId]: { ...c, thread: { ...c.thread, queued } },
          },
        };
      });
    },

    abort() {
      const { activeId } = get();
      if (activeId) drivers.get(activeId)?.abort();
    },

    answerApproval(approvalId, approve, always, opts) {
      const { activeId } = get();
      if (!activeId) return;
      drivers.get(activeId)?.answerApproval(approvalId, {
        approve,
        alwaysThisSession: always,
        ...(opts?.inProject ? { alwaysInProject: true } : {}),
        ...answerFiles(opts?.files),
      });
    },

    answerAllApprovals(approve) {
      const { activeId } = get();
      if (!activeId) return;
      const conv = get().conversations[activeId];
      const driver = drivers.get(activeId);
      if (!conv || !driver) return;
      for (const req of conv.thread.pendingApprovals) {
        driver.answerApproval(req.id, { approve });
      }
    },

    retryLast() {
      const { activeId } = get();
      if (!activeId) return;
      const conv = get().conversations[activeId];
      if (!conv || conv.thread.busy) return;
      const last = [...conv.thread.items].reverse().find((i) => i.kind === 'user');
      if (!last || last.kind !== 'user') return;
      get().send(last.text);
    },

    approvePlan() {
      const { activeId } = get();
      if (!activeId) return;
      const conv = get().conversations[activeId];
      if (!conv) return;
      set((s) => {
        const c = s.conversations[activeId];
        if (!c) return s;
        const items = c.thread.items.map((i) =>
          i.kind === 'plan' && i.status === 'proposed' ? { ...i, status: 'approved' as const } : i,
        );
        return {
          conversations: {
            ...s.conversations,
            [activeId]: { ...c, thread: { ...c.thread, items } },
          },
        };
      });
      // Out of plan mode and into accept-edits, then the go-ahead, the same
      // hand-off Claude Code makes when a plan is accepted. The line is the
      // reducer's own constant, so a replay reads the approval back (B7).
      void get().setPermissionMode('acceptEdits');
      get().send(PLAN_APPROVAL_LINE);
    },

    revisePlan() {
      const { activeId } = get();
      if (!activeId) return;
      set((s) => {
        const c = s.conversations[activeId];
        if (!c) return s;
        const items = c.thread.items.map((i) =>
          i.kind === 'plan' && i.status === 'proposed' ? { ...i, status: 'revising' as const } : i,
        );
        return {
          conversations: {
            ...s.conversations,
            [activeId]: { ...c, thread: { ...c.thread, items } },
          },
        };
      });
    },

    async trustProjectFolder(itemId) {
      const { activeId } = get();
      if (!activeId) return;
      const setTrustItem = (patch: { state?: 'trusted'; error?: string }) =>
        set((s) => {
          const c = s.conversations[activeId];
          if (!c) return s;
          const items = c.thread.items.map((i) =>
            i.kind === 'trust' && i.id === itemId ? { ...i, ...patch } : i,
          );
          return {
            conversations: {
              ...s.conversations,
              [activeId]: { ...c, thread: { ...c.thread, items } },
            },
          };
        });
      const driver = drivers.get(activeId);
      if (!driver?.trustFolder) {
        setTrustItem({
          error: 'This chat is not running on your computer, so there is nothing to trust here.',
        });
        return;
      }
      const result = await driver.trustFolder();
      if ('error' in result) setTrustItem({ error: result.error });
      else setTrustItem({ state: 'trusted', error: undefined });
    },

    answerWebSearch(allow, sheet) {
      // Only the card on screen takes an answer, so a second tap on a
      // private card as it slides away never saves a standing allow.
      const current = get().webSearchAsk;
      if (!answersSheet(current, sheet)) return;
      // A card after a private read (H) answers that one search only: a yes
      // is no standing allow, and a no keeps web search as it was.
      const remembered = remembersAnswer(current);
      set({ webSearchAsk: undefined });
      if (!remembered) {
        webSearchSheets.answer(allow);
        return;
      }
      webSearchPending = undefined;
      if (allow) void get().saveSettings({ webSearchConsent: 'allowed' });
      else webSearchDeclinedThisRun = true;
      webSearchSheets.answer(allow);
      // Routines on this computer follow the answer.
      if (allow) void get().refreshRoutines();
    },

    async setWebFetchMode(mode) {
      // The computer holds the real value, so the app's copy changes only
      // once the computer took it: the row never shows a choice not in force.
      const reached = await pushWebFetchMode(mode, get().settings);
      if (reached) await get().saveSettings({ webFetchMode: mode });
      return reached;
    },

    async setWebSearchAllowed(allowed) {
      webSearchDeclinedThisRun = false;
      await get().saveSettings({ webSearchConsent: allowed ? 'allowed' : 'declined' });
      // Routines on this computer follow the switch (founder, 2026-10-01).
      void get().refreshRoutines();
    },

    async trySampleProject() {
      const b = isDesktop() ? bridge() : undefined;
      if (!b?.createSample) {
        get().showToast('The sample needs the desktop app.');
        return;
      }
      // The sample is a coding chat: signed out, the sign-in sheet opens
      // before anything is copied to disk.
      if (get().needsAccountNow()) {
        get().openAccountGate('coding');
        return;
      }
      if (!get().sourceReady({ kind: 'desktop' })) {
        get().showToast('Pick a model for this computer first, then try the sample.');
        get().setView('stack');
        return;
      }
      const made = await b.createSample();
      if ('error' in made) {
        get().showToast(made.error);
        return;
      }
      // The prompt rides in on the sample's own chat, parked until its driver
      // attaches, so it can never land in whatever chat was open before when
      // no chat opens.
      await get().newConversation(
        { kind: 'desktop', cwd: made.path, repoName: SAMPLE_REPO_NAME },
        { firstMessage: { text: SAMPLE_PROMPT } },
      );
    },

    async restoreChangedFiles(itemId, direction, path) {
      const { activeId } = get();
      if (!activeId) return;
      const patchCard = (patch: { restoring?: boolean; error?: string }) =>
        set((s) => {
          const c = s.conversations[activeId];
          if (!c) return s;
          const items = c.thread.items.map((i) =>
            i.kind === 'changed' && i.id === itemId ? { ...i, ...patch } : i,
          );
          return {
            conversations: {
              ...s.conversations,
              [activeId]: { ...c, thread: { ...c.thread, items } },
            },
          };
        });
      const card = get().conversations[activeId]?.thread.items.find(
        (i): i is Extract<ThreadItem, { kind: 'changed' }> =>
          i.kind === 'changed' && i.id === itemId,
      );
      const driver = drivers.get(activeId);
      if (!card?.checkpointId || !driver?.restoreCheckpoint) {
        patchCard({
          error: 'This chat is not running on your computer, so there is nothing to undo here.',
        });
        return;
      }
      patchCard({ restoring: true, error: undefined });
      const result = await driver.restoreCheckpoint(card.checkpointId, direction, path);
      // Success folds through the engine's echo; a refusal says why here.
      if ('error' in result) patchCard({ restoring: false, error: result.error });
    },

    async rewindTo(itemId, opts) {
      const { activeId } = get();
      const conv = activeId ? get().conversations[activeId] : undefined;
      if (!activeId || !conv) return { error: REWIND_NOT_NOW };
      const guided = get().settings.guidedSetup?.conversationId === activeId;
      const index = conv.thread.items.findIndex((i) => i.id === itemId);
      const item = conv.thread.items[index];
      if (
        item?.kind !== 'user' ||
        !rewindableIds(conv.thread, conv.source, { guided }).includes(itemId)
      ) {
        return { error: REWIND_NOT_NOW };
      }
      // A coding chat: the engine on the person's computer rewinds, and its
      // marker cuts this thread (and every other device's) as it arrives.
      if (rewindsFiles(conv.source)) {
        const result = await rewindEngine(drivers.get(activeId), item.seq!, opts.files);
        return 'error' in result ? result : { text: item.text };
      }
      // A chat whose brain keeps its history in the app: cut the thread, then
      // rebuild the brain from what is left, the way a reopened chat's is.
      set((s) => {
        const c = s.conversations[activeId];
        if (!c) return s;
        return {
          conversations: {
            ...s.conversations,
            [activeId]: {
              ...c,
              thread: cutThread(c.thread, index),
              updatedAt: new Date().toISOString(),
            },
          },
        };
      });
      bumpDriverEpoch(activeId);
      dropDriver(activeId);
      ensureDriver(activeId);
      void persistConversations(get());
      return { text: item.text };
    },

    async giveMoreRoom(itemId) {
      const { activeId } = get();
      if (!activeId) return;
      const card = get().conversations[activeId]?.thread.items.find(
        (i) => i.kind === 'window-cut' && i.id === itemId,
      );
      if (!card || card.kind !== 'window-cut') return;
      // The logic is the security package's (securityOps.ts); here it only
      // lands on the card.
      await giveMoreRoomFor(drivers.get(activeId), card.provider, (patch) =>
        set((s) => {
          const c = s.conversations[activeId];
          if (!c) return s;
          const items = c.thread.items.map((i) =>
            i.kind === 'window-cut' && i.id === itemId ? { ...i, ...patch } : i,
          );
          return {
            conversations: {
              ...s.conversations,
              [activeId]: { ...c, thread: { ...c.thread, items } },
            },
          };
        }),
      );
    },

    dismissProjectTrust(itemId) {
      const { activeId } = get();
      if (!activeId) return;
      set((s) => {
        const c = s.conversations[activeId];
        if (!c) return s;
        const items = c.thread.items.map((i) =>
          i.kind === 'trust' && i.id === itemId ? { ...i, state: 'dismissed' as const } : i,
        );
        return {
          conversations: {
            ...s.conversations,
            [activeId]: { ...c, thread: { ...c.thread, items } },
          },
        };
      });
    },

    async setPermissionMode(mode, source = 'pill') {
      const from = get().settings.permissionMode ?? DEFAULT_PERMISSION_MODE;
      if (from !== mode) logEvent('permission_mode_changed', { from, to: mode, source });
      await get().saveSettings({ permissionMode: mode });
      const { activeId } = get();
      if (activeId) drivers.get(activeId)?.setMode?.(mode);
    },

    async setConversationRepos(id, repoIds) {
      const before = get().conversations[id];
      const changed = !before || (before.repoIds ?? []).join('\n') !== repoIds.join('\n');
      // An on-device model and the Stack take the list (and the Stack its
      // working folder) when their driver is built; the next send rebuilds it.
      // A desktop session stays in the folder it started in (the picker says
      // so); a cloud chat reads the list fresh each reply.
      if (
        changed &&
        before &&
        (before.source.kind === 'device' || before.source.kind === 'stack') &&
        drivers.has(id)
      ) {
        repoContextStale.add(id);
      }
      set((s) => {
        const c = s.conversations[id];
        if (!c) return s;
        return {
          conversations: {
            ...s.conversations,
            [id]: { ...c, repoIds, updatedAt: new Date().toISOString() },
          },
        };
      });
      await persistConversations(get());
    },

    async renameConversation(id, title) {
      const clean = title.trim().slice(0, 80);
      if (!clean) return;
      set((s) => {
        const c = s.conversations[id];
        if (!c) return s;
        return {
          conversations: {
            ...s.conversations,
            [id]: { ...c, title: clean, renamed: true, updatedAt: new Date().toISOString() },
          },
        };
      });
      await persistConversations(get());
    },

    async compactActive(focus) {
      const { activeId } = get();
      const driver = activeId ? drivers.get(activeId) : undefined;
      if (!activeId || !driver?.compact) {
        get().showToast('Compaction is for a repository session on your computer.');
        return;
      }
      const conv = get().conversations[activeId];
      if (conv?.thread.busy) {
        get().showToast('Let the current task finish, then compact.');
        return;
      }
      get().showToast('Compacting the conversation.');
      const result = await driver.compact(focus);
      const text =
        'error' in result
          ? result.error
          : `Compacted the history: ${result.before.toLocaleString()} to ${result.after.toLocaleString()} tokens.`;
      set((s) => {
        const c = s.conversations[activeId];
        if (!c) return s;
        const note: ThreadItem = { kind: 'note', id: newId(), text };
        return {
          conversations: {
            ...s.conversations,
            [activeId]: { ...c, thread: { ...c.thread, items: [...c.thread.items, note] } },
          },
        };
      });
    },

    async addMemory(text) {
      const line = text.trim();
      if (!line) return;
      const { activeId } = get();
      const conv = activeId ? get().conversations[activeId] : undefined;
      const projectId = conv?.projectId ?? get().settings.activeProjectId;
      const project = get().settings.projects?.find((p) => p.id === projectId);
      if (!project) {
        get().showToast('Open a chat in a project to save an instruction to it.');
        return;
      }
      const instructions = project.instructions?.trim()
        ? `${project.instructions.trimEnd()}\n- ${line}`
        : `- ${line}`;
      await get().updateProject(project.id, { instructions });
      if (activeId) drivers.get(activeId)?.setInstructions?.(instructions);
      set((s) => {
        if (!activeId) return s;
        const c = s.conversations[activeId];
        if (!c) return s;
        const note: ThreadItem = {
          kind: 'note',
          id: newId(),
          text: `Saved to ${project.name}'s instructions: ${line}`,
        };
        return {
          conversations: {
            ...s.conversations,
            [activeId]: { ...c, thread: { ...c.thread, items: [...c.thread.items, note] } },
          },
        };
      });
    },

    async listFiles(query) {
      const { activeId } = get();
      const driver = activeId ? drivers.get(activeId) : undefined;
      if (!driver?.listFiles) return [];
      return driver.listFiles(query);
    },

    addNote(text) {
      const { activeId } = get();
      if (!activeId) return;
      set((s) => {
        const c = s.conversations[activeId];
        if (!c) return s;
        const note: ThreadItem = { kind: 'note', id: newId(), text };
        return {
          conversations: {
            ...s.conversations,
            [activeId]: { ...c, thread: { ...c.thread, items: [...c.thread.items, note] } },
          },
        };
      });
    },

    activeIsAgent() {
      const { activeId } = get();
      const driver = activeId ? drivers.get(activeId) : undefined;
      return typeof driver?.setMode === 'function';
    },

    async openDesktopSession(info) {
      // Reached from the Chats list (or a project's detail room) like a saved
      // chat, so it becomes a sub-page of that room too (a way back, not the
      // drawer menu). Captured before the view changes below.
      const from = get().view;
      const backRoom: ViewName | undefined =
        from === 'chats' || from === 'project' ? from : undefined;
      // Already have a chat for it: just open that one (openConversation reads
      // the current view and sets the same back trail).
      const existing = get().order.find((id) => {
        const c = get().conversations[id];
        return c?.source.kind === 'desktop' && c.source.sessionId === info.id;
      });
      if (existing) {
        get().openConversation(existing);
        return;
      }
      const repoName = info.cwd.split(/[\\/]/).filter(Boolean).pop();
      const opened = await get().newConversation(
        { kind: 'desktop', sessionId: info.id, cwd: info.cwd, repoName },
        { title: info.title && !/^Session /.test(info.title) ? info.title : undefined },
      );
      // No chat opened (the sign-in sheet): the room stays as it was, trail
      // and all.
      if (opened && backRoom) set({ viewTrail: [backRoom] });
    },

    runCommand(command) {
      const { activeId } = get();
      if (!activeId) return;
      // Signed out, a coding chat's commands are behind the same door as the
      // agent: the sign-in sheet opens, never "this chat has no terminal".
      if (codingLockedNow(get().conversations[activeId])) {
        get().openAccountGate('coding');
        return;
      }
      const driver = drivers.get(activeId);
      if (!driver?.runCommand) {
        get().showToast(
          'This chat has no terminal. Open a repository on your computer to run commands.',
        );
        return;
      }
      // Output arrives as command-* events on the driver subscription; the
      // transcript reducer renders the card. Fire and forget. A hub may refuse
      // the command lane for this credential (P0-1: members do not get a raw
      // shell on a shared hub); its message is shown as is.
      void driver.runCommand(command).then((res) => {
        const r = res as unknown as string | { runId?: string } | { refused: string } | undefined;
        if (r && typeof r === 'object' && 'refused' in r) {
          get().showToast(r.refused);
          return;
        }
        const runId = typeof r === 'string' ? r : r?.runId;
        if (!runId) get().showToast('Could not reach your computer to run that. Try again.');
      });
    },

    async setTerminalControl(on) {
      const s = get();
      const desktopLocal = isDesktop() && Boolean(bridge()) && !s.settings.preferRemoteHub;
      const targetId = terminalTargetId({ desktopLocal, daemon: s.settings.daemon });
      if (!targetId) return;
      const map = { ...(s.settings.terminalControl ?? {}), [targetId]: on };
      await get().saveSettings({ terminalControl: map });
    },

    async setCodemagicAccess(on) {
      // A single device-local boolean: the Codemagic token lives on this device
      // and only ever runs here, so there is no per-target map (see
      // codemagicControl.ts).
      await get().saveSettings({ codemagicAccess: on });
    },

    // ------------------------------------------ wayfinding and agentic currents

    async setWayfinding(id, on) {
      const wayfinding = { ...(get().settings.wayfinding ?? {}), [id]: on };
      await get().saveSettings({ wayfinding });
      logEvent('wayfinding_toggle', { id, on });
    },

    async setPerplexityResearch(on) {
      await get().saveSettings({ perplexityResearch: on });
      logEvent('perplexity_research_toggle', { on });
    },

    async setAgenticCurrent(projectId, id, on, at) {
      const s = get();
      const project = s.settings.projects?.find((p) => p.id === projectId);
      if (!project) return;
      const prior = project.agenticCurrent ?? null;
      const next = nextActiveCurrent(prior, id, on);
      if (next === prior) return;
      const projects = (s.settings.projects ?? []).map((p) =>
        p.id === projectId ? { ...p, agenticCurrent: next } : p,
      );
      // Off leaves no trace: a current's bench entry is pulled from every stack
      // once NO project still selects it (the bench is global, shared across
      // projects), the same sweep a disconnected BYOM endpoint gets. Placements
      // are not kept across an off/on, on purpose: place it again in one tap.
      const stillUsed = prior && projects.some((p) => p.agenticCurrent === prior);
      const stacks =
        prior && !stillUsed
          ? purgeBenchId(s.settings.stacks, currentBenchId(prior))
          : s.settings.stacks;
      await get().saveSettings({ projects, stacks });
      const seq = (s.currentArrival?.seq ?? 0) + 1;
      const label = next ? currentInfo(next).label : prior ? currentInfo(prior).label : '';
      set({
        currentArrival: at ? { seq, x: at.x, y: at.y, ebb: next === null, label } : undefined,
      });
      logEvent(next ? 'current_on' : 'current_off', { id: next ?? prior ?? id, projectId });
      if (next) void get().refreshCurrents();
    },

    async connectCurrent(id, input) {
      const s = get();
      const info = currentInfo(id);
      const prior = s.settings.currentConnections?.[id] ?? {};
      const conn: CurrentConnection = { ...prior };
      if (info.kind === 'cli') {
        conn.command = input.command ?? prior.command;
      } else {
        const raw = (input.endpoint ?? prior.endpoint ?? '').trim();
        conn.endpoint =
          info.kind === 'hermes' ? normalizeHermesBaseUrl(raw) : raw.replace(/\/+$/, '');
        conn.model = input.model?.trim() || prior.model;
        // A fresh address forgets what the last one answered as.
        if (conn.endpoint !== prior.endpoint) {
          delete conn.via;
          delete conn.agentName;
        }
      }
      if (input.apiKey !== undefined) {
        const key = input.apiKey.trim();
        if (key) await secretSet(currentSecretKey(id), key);
        else await secretDelete(currentSecretKey(id));
      }
      await get().saveSettings({
        currentConnections: { ...(s.settings.currentConnections ?? {}), [id]: conn },
      });
      logEvent('current_connected', { id });
      await get().refreshCurrents();
      return get().currentProbes[id] === true;
    },

    async disconnectCurrent(id) {
      await secretDelete(currentSecretKey(id));
      const s = get();
      const currentConnections = { ...(s.settings.currentConnections ?? {}) };
      delete currentConnections[id];
      // A connection is device-global, so forgetting it clears that current
      // from every project that selected it and pulls its bench entry, so off
      // leaves no trace anywhere.
      const projects = (s.settings.projects ?? []).map((p) =>
        p.agenticCurrent === id ? { ...p, agenticCurrent: null } : p,
      );
      await get().saveSettings({
        currentConnections,
        projects,
        stacks: purgeBenchId(s.settings.stacks, currentBenchId(id)),
      });
      set({ currentProbes: { ...get().currentProbes, [id]: false } });
      logEvent('current_disconnected', { id });
    },

    async refreshCurrents() {
      // Currents are v2: an earlier build probes nothing at all.
      if (!featureOn('currents')) return;
      const s = get();
      // Nothing here may throw: a probe that fails reads as "did not answer".
      const host = await currentsHost(s.settings.daemon).catch(() => undefined);
      const probes: CurrentProbes = { ...get().currentProbes };
      // Probe every saved connection, not only the active one, so a row can
      // read Ready (saved and answering) while another current is on.
      const saved = Object.keys(s.settings.currentConnections ?? {}) as AgenticCurrentId[];
      await Promise.all(
        saved.map(async (id) => {
          const conn = s.settings.currentConnections?.[id];
          const key = (await secretGet(currentSecretKey(id)).catch(() => null)) ?? undefined;
          const result = await probeCurrent(id, conn, key, host).catch(() => ({
            answered: false as const,
          }));
          probes[id] = result.answered;
          // An endpoint current remembers which door answered and the agent's
          // name from its card, so the rooms can render it honestly.
          if (result.answered && conn && (result.via || result.agentName)) {
            const next: CurrentConnection = {
              ...conn,
              via: result.via ?? conn.via,
              agentName: result.agentName ?? conn.agentName,
            };
            if (next.via !== conn.via || next.agentName !== conn.agentName) {
              await get().saveSettings({
                currentConnections: { ...(get().settings.currentConnections ?? {}), [id]: next },
              });
            }
          }
        }),
      );
      set({ currentProbes: probes, currentsHost: host });
    },

    clearCurrentArrival() {
      set({ currentArrival: undefined });
    },

    // ---------------------------------------------------- harness currents

    async setHarnessCurrent(projectId, id, on, at) {
      const s = get();
      const project = s.settings.projects?.find((p) => p.id === projectId);
      if (!project) return;
      const prior = project.harnessCurrent ?? null;
      const next = nextActiveHarnessCurrent(prior, id, on);
      if (next === prior) return;
      // Per project and independent of the agentic group, so one of each may be
      // on. No bench sweep, because a harness current places no model on the
      // bench; off leaves no trace because the rooms read it only through
      // activeHarnessContribution of the active project.
      const projects = (s.settings.projects ?? []).map((p) =>
        p.id === projectId ? { ...p, harnessCurrent: next } : p,
      );
      await get().saveSettings({ projects });
      const seq = (s.currentArrival?.seq ?? 0) + 1;
      const label = next
        ? harnessCurrentInfo(next).label
        : prior
          ? harnessCurrentInfo(prior).label
          : '';
      set({
        currentArrival: at ? { seq, x: at.x, y: at.y, ebb: next === null, label } : undefined,
      });
      logEvent(next ? 'harness_current_on' : 'harness_current_off', {
        id: next ?? prior ?? id,
        projectId,
      });
      if (next) void get().refreshHarnessCurrents();
    },

    async connectHarnessCurrent(id, input) {
      const s = get();
      const prior = s.settings.harnessCurrentConnections?.[id] ?? {};
      const conn: HarnessCurrentConnection = { ...prior };
      const raw = (input.endpoint ?? prior.endpoint ?? '').trim();
      conn.endpoint = raw ? normalizeJevBaseUrl(raw) : undefined;
      conn.model = input.model?.trim() || prior.model;
      if (input.apiKey !== undefined) {
        const key = input.apiKey.trim();
        if (key) await secretSet(harnessCurrentSecretKey(id), key);
        else await secretDelete(harnessCurrentSecretKey(id));
      }
      await get().saveSettings({
        harnessCurrentConnections: { ...(s.settings.harnessCurrentConnections ?? {}), [id]: conn },
      });
      logEvent('harness_current_connected', { id });
      await get().refreshHarnessCurrents();
      return get().harnessCurrentProbes[id] === true;
    },

    async disconnectHarnessCurrent(id) {
      await secretDelete(harnessCurrentSecretKey(id));
      const s = get();
      const harnessCurrentConnections = { ...(s.settings.harnessCurrentConnections ?? {}) };
      delete harnessCurrentConnections[id];
      // Device-global connection, so forgetting it clears the selection from
      // every project that had it, so off leaves no trace anywhere.
      const projects = (s.settings.projects ?? []).map((p) =>
        p.harnessCurrent === id ? { ...p, harnessCurrent: null } : p,
      );
      await get().saveSettings({ harnessCurrentConnections, projects });
      set({ harnessCurrentProbes: { ...get().harnessCurrentProbes, [id]: false } });
      logEvent('harness_current_disconnected', { id });
    },

    async refreshHarnessCurrents() {
      const s = get();
      const probes: HarnessCurrentProbes = { ...get().harnessCurrentProbes };
      const saved = Object.keys(s.settings.harnessCurrentConnections ?? {}) as HarnessCurrentId[];
      await Promise.all(
        saved.map(async (id) => {
          const info = harnessCurrentInfo(id);
          const conn = s.settings.harnessCurrentConnections?.[id];
          const base = normalizeJevBaseUrl((conn?.endpoint || info.apiBase).trim());
          const key = (await secretGet(harnessCurrentSecretKey(id)).catch(() => null)) ?? undefined;
          // Jev answers GET /v1/models under its base, like an OpenAI-compatible
          // server, so the same probe applies. Never throws: false is Arriving.
          const answered = await probeOpenAiCompatible(`${base}/v1`, key).catch(() => false);
          probes[id] = answered;
        }),
      );
      set({ harnessCurrentProbes: probes });
    },

    async saveHub(target, opts) {
      const list = hubList(get().settings);
      const prior = list.find((d) => d.baseUrl === target.baseUrl);
      // Keep a name (and what it is, server or computer) already on file if
      // this save did not carry one.
      const merged: DaemonTarget = {
        ...target,
        name: target.name ?? prior?.name,
        kind: target.kind ?? prior?.kind,
      };
      const others = list.filter((d) => d.baseUrl !== target.baseUrl);
      // The credential goes to the secret store (APP-11); the settings blob
      // carries the hub without it (see persistSettings).
      await secretSet(hubSecretKey(target.baseUrl), target.token);
      // Pairing the same computer again: once the new credential is saved,
      // the old one is revoked there (best effort), so one phone is one row
      // on the computer. Only revoked: a server's provider keys and its model
      // stay, since the new credential manages them as the old one did (keys
      // on your server, 2026-10-09).
      if (prior?.token && prior.token !== target.token) void daemonForgetSelf(prior);
      // The hub's role for this credential: what pairing reported, else asked
      // now. An older hub answers nothing and keeps deciding per request.
      const role = opts?.role ?? (await readHubRole(merged));
      const hubRoles = { ...(get().settings.hubRoles ?? {}) };
      if (role) hubRoles[target.baseUrl] = role;
      else delete hubRoles[target.baseUrl];
      const hubBefore = get().settings.daemon?.baseUrl;
      await get().saveSettings({ daemon: merged, daemons: [...others, merged], hubRoles });
      // A pairing (or a pairing to another computer) settles where the
      // personal vault lives (CTO J9). Never blocks the pairing itself.
      if (hubBefore !== merged.baseUrl) void settleVaultForHub();
    },

    async setHubRole(baseUrl, role) {
      const hubRoles = { ...(get().settings.hubRoles ?? {}) };
      if (role) hubRoles[baseUrl] = role;
      else delete hubRoles[baseUrl];
      await get().saveSettings({ hubRoles });
    },

    async selectHub(baseUrl) {
      const hub = hubList(get().settings).find((d) => d.baseUrl === baseUrl);
      const hubBefore = get().settings.daemon?.baseUrl;
      if (hub) await get().saveSettings({ daemon: hub });
      if (hub && hubBefore !== hub.baseUrl) void settleVaultForHub();
    },

    async removeHub(baseUrl) {
      const s = get().settings;
      // Forgetting a computer revokes this device there too (best effort; a
      // computer that is off keeps the row until it is revoked on it), so its
      // Paired devices list never fills with rows nothing uses. A server's
      // provider keys are deleted first, while the credential still works
      // (keys on your server, 2026-10-09; serverKeysOps). The credential is
      // held here for that, so this device forgets the hub at once.
      const leaving = hubList(s).find((d) => d.baseUrl === baseUrl);
      const role = s.hubRoles?.[baseUrl];
      const daemons = hubList(s).filter((d) => d.baseUrl !== baseUrl);
      const daemon = s.daemon?.baseUrl === baseUrl ? daemons[0] : s.daemon;
      const hubRoles = { ...(s.hubRoles ?? {}) };
      delete hubRoles[baseUrl];
      await get().saveSettings({ daemons, daemon, hubRoles });
      // The credential leaves with the hub.
      await secretDelete(hubSecretKey(baseUrl));
      // The vault returns from the computer it pointed at (CTO J9).
      if (s.daemon?.baseUrl === baseUrl) void settleVaultForHub();
      return leaving?.token ? await leaveHub(leaving, role) : { kind: 'none' };
    },

    async renameHub(baseUrl, name) {
      const s = get().settings;
      const trimmed = name.trim() || undefined;
      const daemons = hubList(s).map((d) => (d.baseUrl === baseUrl ? { ...d, name: trimmed } : d));
      const daemon = s.daemon?.baseUrl === baseUrl ? { ...s.daemon, name: trimmed } : s.daemon;
      await get().saveSettings({ daemons, daemon });
    },

    async setPreferRemoteHub(on) {
      await get().saveSettings({ preferRemoteHub: on });
    },

    sendCommandStdin(runId, data) {
      const { activeId } = get();
      if (activeId) drivers.get(activeId)?.sendStdin?.(runId, data);
    },

    killCommand(runId) {
      const { activeId } = get();
      if (activeId) drivers.get(activeId)?.killCommand?.(runId);
    },

    canRunCommands() {
      const { activeId } = get();
      if (!activeId) return false;
      return typeof drivers.get(activeId)?.runCommand === 'function';
    },

    async saveSettings(patch) {
      const before = get().settings;
      let settings = { ...before, ...patch };
      // A preference that follows a signed-in person changed here (not a sync
      // applying the account's copy, which names its own times): stamp each
      // key it touched, and send it on once the person stops changing things.
      const ownPrefChange = !('prefsStamps' in patch) && preferencesChanged(before, settings);
      if (ownPrefChange) settings = stampOwnChange(before, settings, new Date().toISOString());
      set({ settings, hubRole: activeHubRole(settings) });
      setInsightsEnabled(settings.insightsOptIn ?? false);
      setActiveEffort(settings.effort ?? DEFAULT_EFFORT);
      setChainOfThought(settings.chainOfThought === true);
      setPromptCache(settings.promptCache === true);
      // New privacy rules apply to the next read, not a minute later.
      if ('vaultPrivacy' in patch) privacyCache = undefined;
      // The phone keeps its own copy of the notice switches, whichever way
      // they changed: here, or pulled from the account.
      if (noticePrefsChanged(before, settings)) void syncNoticePrefs(settings);
      // A pairing change relinks the hub vault before anything settles it.
      if ('daemon' in patch) await syncHubLink(settings.daemon).catch(() => false);
      // What the store holds now, not the copy from before the relink: a save
      // that landed during it is kept, never written over.
      await persistSettings(get().settings);
      if (ownPrefChange) schedulePrefsPush();
    },

    async addDeviceModel(id, name) {
      // G2: read the CURRENT deviceModels, never a stale render snapshot, so two
      // downloads finishing close together each keep their "on device" entry.
      const deviceModels = { ...get().settings.deviceModels, [id]: name };
      // A model can only be in one place: adopting it locally clears any stale
      // iCloud record from a previous download to the other target.
      const cloudModels = { ...(get().settings.cloudModels ?? {}) };
      delete cloudModels[id];
      await get().saveSettings({ deviceModels, cloudModels });
    },

    async addCloudModel(id, name) {
      // Mirror of addDeviceModel for the iCloud target: read fresh state, and
      // keep the id out of the device map so it never shows as both places.
      const cloudModels = { ...(get().settings.cloudModels ?? {}), [id]: name };
      const deviceModels = { ...get().settings.deviceModels };
      delete deviceModels[id];
      await get().saveSettings({ cloudModels, deviceModels });
    },

    async setCloudKey(key) {
      await secretSet(ANTHROPIC_KEY_KEY, key.trim());
      set({ cloudKeyPresent: true, cloudKeyNeedsFix: false });
      logEvent('cloud_key_added');
    },

    async clearCloudKey() {
      await secretDelete(ANTHROPIC_KEY_KEY);
      set({ cloudKeyPresent: false, cloudKeyNeedsFix: false });
    },

    async connectProvider(id, key, workspaceId) {
      await secretSet(providerSecretKey(id), key.trim());
      set((s) => ({
        connectedProviders: { ...s.connectedProviders, [id]: true },
        cloudKeyPresent: id === 'anthropic' ? true : s.cloudKeyPresent,
        cloudKeyNeedsFix: id === 'anthropic' ? false : s.cloudKeyNeedsFix,
        justConnected: id,
      }));
      if (id === 'anthropic') {
        await get().saveSettings({ anthropicWorkspaceId: workspaceId?.trim() || undefined });
        // On the desktop the engine holds its own copy of the key (its
        // credential store), so a connection here reaches the coding agent too.
        void bridge()?.setAnthropicKey(key.trim(), workspaceId?.trim() || undefined);
      }
      // A provider whose models load live gets a first set on the Bench now,
      // unless the person already chose some on this device.
      if (providerInfo(id)?.liveModels && !get().settings.providerModels?.[id]?.length) {
        const all = await fetchLiveModels(id, key.trim());
        if (all) await get().setProviderModels(id, pickLiveModels(id, all));
      }
      logEvent('provider_connected', { provider: id });
    },

    async setProviderModels(id, models) {
      applyLiveModels(id, models);
      const providerModels = { ...(get().settings.providerModels ?? {}) };
      if (models.length) providerModels[id] = models;
      else delete providerModels[id];
      await get().saveSettings({ providerModels });
    },

    async setAnthropicWorkspace(workspaceId) {
      const key = await secretGet(ANTHROPIC_KEY_KEY);
      if (!key) return 'invalid';
      const ws = workspaceId.trim() || undefined;
      const check = await validateProviderKey('anthropic', key, ws);
      if (check === 'invalid' || check === 'needs-workspace') return check;
      await get().saveSettings({ anthropicWorkspaceId: ws });
      void bridge()?.setAnthropicKey(key, ws);
      return check;
    },

    async disconnectProvider(id, onlyServers) {
      await secretDelete(providerSecretKey(id));
      set((s) => ({
        connectedProviders: { ...s.connectedProviders, [id]: false },
        cloudKeyPresent: id === 'anthropic' ? false : s.cloudKeyPresent,
        cloudKeyNeedsFix: id === 'anthropic' ? false : s.cloudKeyNeedsFix,
      }));
      if (id === 'anthropic') {
        await get().saveSettings({ anthropicWorkspaceId: undefined });
        void bridge()?.disconnect('anthropic');
      }
      // A live provider's picks leave with its key.
      if (providerInfo(id)?.liveModels) await get().setProviderModels(id, []);
      // And its models leave every status's stack (2026-10-09).
      const stacks = get().settings.stacks;
      if (stacks) await get().saveSettings({ stacks: sweepProviderRefs(stacks, id) });
      // And its key leaves every docked server that keeps one (keys on your
      // server, 2026-10-09; serverKeysOps), best effort.
      // Only the servers the question named when the caller says so: a key is
      // never deleted on a server the person was not told about.
      const servers =
        onlyServers ?? dockedServers(hubList(get().settings), get().settings.hubRoles);
      const onServers: KeyRemoval = servers.length
        ? await removeKeyFromServers(servers, id)
        : { removedFrom: [], modelClearedOn: [], notRemoved: [] };
      logEvent('provider_disconnected', { provider: id });
      return onServers;
    },

    async connectByom(input) {
      const conns = byomConnectionsFor({
        ...input,
        ownTailnetSuffix: hubTailnetSuffix(get().settings.daemon?.baseUrl),
      });
      // The key is optional: a self-hosted server may accept unauthenticated
      // requests. Store one only when given, so byomSecretKey stays absent for
      // keyless endpoints; each connection keeps its own copy, so every
      // reader and Disconnect work per connection as before.
      const key = input.apiKey?.trim();
      if (key) for (const c of conns) await secretSet(byomSecretKey(c.id), key);
      const byomModels = [...(get().settings.byomModels ?? []), ...conns];
      await get().saveSettings({ byomModels });
      if (conns.length) logEvent('byom_connected');
      return conns;
    },

    async disconnectByom(ids) {
      const gone = typeof ids === 'string' ? [ids] : [...ids];
      for (const id of gone) await secretDelete(byomSecretKey(id));
      const settings = get().settings;
      const byomModels = (settings.byomModels ?? []).filter((c) => !gone.includes(c.id));
      // Pull them out of EVERY status's stack: a disconnected endpoint must
      // not linger in any profile (byomOps' sweepByomRefs).
      const stacks = sweepByomRefs(settings.stacks, gone);
      await get().saveSettings({ byomModels, stacks });
      logEvent('byom_disconnected');
    },

    async setByomForwards(id, on) {
      const settings = get().settings;
      const all = settings.byomModels ?? [];
      const conn = all.find((c) => c.id === id);
      if (!conn) return;
      await get().saveSettings(
        markByomForwarding(
          all,
          settings.stacks,
          conn,
          on,
          hubTailnetSuffix(settings.daemon?.baseUrl),
        ),
      );
    },

    async setReasoning(ref, profile) {
      const s = get();
      const p = profile ?? activeProfile(s.connectivity, s.settings.profileOverride);
      const stack = stackForProfile(s.settings.stacks, p);
      const key = stackRefKey(ref);
      // A model promoted to Reasoning leaves the active specialists.
      const active = stack.active.filter((m) => stackRefKey(m.ref) !== key);
      await get().saveSettings({
        stacks: { ...s.settings.stacks, [p]: { ...stack, reasoning: ref, active } },
      });
      logEvent('stack_reasoning_set', { kind: ref.kind });
    },

    async placeSpecialist(ref, placement, profile) {
      const s = get();
      const p = profile ?? activeProfile(s.connectivity, s.settings.profileOverride);
      const stack = stackForProfile(s.settings.stacks, p);
      const key = stackRefKey(ref);
      const active = stack.active.filter((m) => stackRefKey(m.ref) !== key);
      active.push({ ref, placement });
      const saved = { ...stack.saved };
      delete saved[key];
      await get().saveSettings({
        stacks: { ...s.settings.stacks, [p]: { ...stack, active, saved } },
      });
      logEvent('stack_place', { category: placement.category });
    },

    async benchSpecialist(key, profile) {
      const s = get();
      const p = profile ?? activeProfile(s.connectivity, s.settings.profileOverride);
      const stack = stackForProfile(s.settings.stacks, p);
      const member = stack.active.find((m) => stackRefKey(m.ref) === key);
      const active = stack.active.filter((m) => stackRefKey(m.ref) !== key);
      const saved = { ...stack.saved };
      if (member) saved[key] = member.placement; // keep placement, trigger, persona
      await get().saveSettings({
        stacks: { ...s.settings.stacks, [p]: { ...stack, active, saved } },
      });
      logEvent('stack_bench');
    },

    async editPlacement(key, placement, profile) {
      const s = get();
      const p = profile ?? activeProfile(s.connectivity, s.settings.profileOverride);
      const stack = stackForProfile(s.settings.stacks, p);
      if (stack.active.some((m) => stackRefKey(m.ref) === key)) {
        const active = stack.active.map((m) =>
          stackRefKey(m.ref) === key ? { ...m, placement } : m,
        );
        await get().saveSettings({
          stacks: { ...s.settings.stacks, [p]: { ...stack, active } },
        });
      } else {
        await get().saveSettings({
          stacks: {
            ...s.settings.stacks,
            [p]: { ...stack, saved: { ...stack.saved, [key]: placement } },
          },
        });
      }
    },
  };
});

interface PersistedConversations {
  order: string[];
  conversations: Record<string, Conversation>;
}

// P2-12: coalesce the high-frequency streaming snapshots. A pending timer folds
// every text-delta in its window into a single write ~1.5s later; the task-start
// and task-done bookends still persist immediately.
let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persistConversationsSoon(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    void persistConversations(useApp.getState());
  }, 1500);
}

// The crew snapshot is cached whole (roster + recent runs) so the activity
// dashboards render away from home, before any live read. Runs are already
// capped at the source; store what the last live read returned.
async function persistRoutines(routines: RoutineView[], runs: RoutineRun[]): Promise<void> {
  await storeSetJson(ROUTINES_KEY, { routines, runs });
}

async function persistConversations(state: Pick<AppState, 'order' | 'conversations'>) {
  const conversations: Record<string, Conversation> = {};
  // The disk order is bounded so a very long history cannot grow storage
  // without limit; 200 is generous headroom over the ~50 a session accrues.
  const savedOrder = state.order.slice(0, 200);
  for (const id of savedOrder) {
    const conv = state.conversations[id];
    if (!conv) continue;
    // Why a parked message has not gone out is session state (the hub did
    // not answer just now); the message itself is what must survive.
    const { pendingFirstError: _session, ...saved } = conv;
    conversations[id] = {
      ...saved,
      // Desktop threads live in the engine journal; the phone keeps a bounded
      // read-only tail so a reopen with the computer off still shows the
      // conversation (B4). Everything else trims to the usual ceiling.
      thread:
        conv.source.kind === 'desktop' ? snapshotThread(conv.thread) : trimThread(conv.thread),
      ...(conv.source.kind === 'desktop' && conv.thread.items.length
        ? { lastItemCount: conv.thread.items.length }
        : {}),
    };
  }
  await storeSetJson(CONVERSATIONS_KEY, { order: savedOrder, conversations });
}

function trimThread(thread: Conversation['thread']): Conversation['thread'] {
  return { ...thread, items: thread.items.slice(-200), pendingApprovals: [] };
}
