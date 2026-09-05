// The app store (zustand): conversations, navigation, settings, toasts.
// Drivers live OUTSIDE React state (they hold sockets and native handles);
// the store holds only renderable data. Desktop-backed conversations rebuild
// their transcript by replaying the engine's journal, so the phone and the
// desktop can both close and reopen with nothing lost.
import { create } from 'zustand';
import type { DriverEvent, ReconcileResult } from 'os-code/protocol';
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
} from './types.js';
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
import { reduceEvent, titleFrom } from './transcript.js';
import type { ChatDriver } from '../drivers/types.js';
import { ElectronDriver } from '../drivers/electronDriver.js';
import {
  RemoteDriver,
  daemonApplyOutbox,
  daemonCreateSession,
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
  getUser,
  insert as supabaseInsert,
  invokeFunction as supabaseInvoke,
  isConfigured as authConfigured,
  parseAuthCallback,
  authCallbackType,
  rpc as supabaseRpc,
  select as supabaseSelect,
  sendPasswordReset as supabaseSendPasswordReset,
  resendConfirmation as supabaseResendConfirmation,
  updatePassword as supabaseUpdatePassword,
  signInWithOtp,
  signInWithPassword,
  signOut as supabaseSignOut,
  signUp as supabaseSignUp,
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
  iapAvailable,
  purchase as iapPurchase,
  restore as iapRestore,
  PERSONAL_YEARLY_PRODUCT_ID,
} from '../lib/iap.js';
import {
  AuthExpiredError,
  clearSession,
  freshSession,
  loadStoredSession,
  saveSession,
} from '../lib/authSession.js';
import { beatDesktopSession, registerPushForDaemon } from '../lib/push.js';
import {
  autoProfile,
  effectiveProfile,
  PROFILE_ORDER,
  type Connectivity,
  type ProfileId,
} from '../lib/profiles.js';
import { PROVIDERS, providerInfo, providerSecretKey } from '../lib/providers.js';
import { CloudClaudeDriver, DEFAULT_CLAUDE_MODEL } from '../drivers/cloudClaudeDriver.js';
import { CloudOpenAiDriver } from '../drivers/cloudOpenAiDriver.js';
import { DEFAULT_EFFORT, setActiveEffort, type Effort } from '../lib/effort.js';
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
import type { Attachment } from '../lib/attachments.js';
import { OnDeviceDriver } from '../drivers/onDeviceDriver.js';
import { MockDriver } from '../drivers/mockDriver.js';
import { StackDriver } from '../drivers/stackDriver.js';
import { DesktopChatDriver } from '../drivers/desktopChatDriver.js';
import { guardDriver } from '../drivers/guardedDriver.js';
import {
  HARBOR_MINI_GREETING,
  HARBOR_MINI_MODEL_ID,
  HARBOR_MINI_MODEL_NAME,
  HARBOR_MINI_MODEL_URL,
} from '../lib/harborMini.js';
import {
  HARBOR_GREETING,
  HARBOR_MODEL_ID,
  HARBOR_MODEL_NAME,
  HARBOR_MODEL_URL,
  isHarbor,
} from '../lib/harbor.js';
import { SEARCH_SECRET_KEY, type SearchBackend } from '../lib/webSearch.js';
import { loadInsights, logEvent, logOnce, setInsightsEnabled } from '../lib/insights.js';
import {
  routinesClient,
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
  type ReadinessSignals,
  type AppStack,
  type ProfileStacks,
  type Placement,
  type StackModelRef,
} from '../lib/stack.js';
import { byomSecretKey, type ByomConnection } from '../lib/byom.js';
import {
  createOrgProject,
  deleteOrgProject,
  listOrgProjects,
  mergeSharedProjects,
  revokeOrgProjectAccess,
  setOrgProjectAccess,
  updateOrgProject,
} from '../lib/orgProjects.js';
import { SETUP_GUIDES, guideOpening, type SetupGuideId } from '../lib/setupGuides.js';
import {
  providerFor,
  probeReady,
  connectGdrive,
  disconnectGdrive,
  setOrgVaultAuth,
  resetOrgVault,
  type GitosResource,
  type StorageProvider,
  type StorageProviderId,
  type StoredFileMeta,
} from '../lib/gitos/index.js';
import {
  connectRepoOAuth as runRepoOAuthConnect,
  disconnectRepoOAuth,
} from '../lib/gitos/repoOAuth.js';
import { normalizeNotePath } from '../lib/vault.js';
import { projectWorkspaces, reconcileToast, summarizeReconcile } from '../lib/repoReconcile.js';
import { readProjectSecrets, writeProjectSecrets } from '../lib/projectSecrets.js';
import { bridge, type DesktopStatus } from '../lib/electronBridge.js';
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

// Which locked surface triggered the Personal upgrade sheet. Free is chat only;
// the coding agent and the Marketplace need the Personal unlock.
export type PaywallReason = 'coding' | 'marketplace';

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
  /** Whether the small built-in guide (Harbor Light) has been downloaded to this device. */
  harborMiniReady?: boolean;
  /** Whether the preferred guide (Harbor) has been downloaded to this device. */
  harborReady?: boolean;
  /** Web search backend for Harbor, when the user has brought their own key.
   *  Undefined means the zero-config DuckDuckGo default. */
  searchBackend?: SearchBackend;
  /** Whether the Marketplace intro walkthrough has been shown. */
  libraryIntroSeen?: boolean;
  /** Daemon base URLs this device has registered for completion push, so a grant
   *  is minted once per daemon rather than on every desktop session. Device-local
   *  bookkeeping, not synced. */
  pushRegisteredDaemons?: string[];
  /** The user's stack: Reasoning LLM anchor, active specialists, bench metadata.
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
  /** My Crew: user-authored agents with personas and call rules. */
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
  /** Appearance: follow the system (default), or pin light or dark. Device
   *  local by nature (a per-device viewing preference). */
  theme?: 'system' | 'light' | 'dark';
  /** Reasoning effort for new turns, the same idea Claude exposes. Defaults to
   *  'high'. Chosen from the top of the model sheet. */
  effort?: Effort;
  /** How tool approvals are handled for the coding agent. Defaults to
   *  'acceptEdits'. Chosen from the composer's mode pill. */
  permissionMode?: PermissionMode;
  /** The workspace an identity-linked Anthropic key acts in, sent as the
   *  anthropic-workspace-id header. Blank for a workspace-scoped key. */
  anthropicWorkspaceId?: string;
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
  /** Codemagic Access: whether the model may drive Codemagic builds on its own
   *  (trigger, read the failure, fix, rebuild until green) using this device's
   *  Codemagic token. Off by default; missing means Off, the opt-in default. A
   *  single device-local boolean (not per target like Terminal Control): the
   *  token lives in this device's Keychain and only ever executes on this
   *  device, never on a remote hub. Never synced. See codemagicControl.ts. */
  codemagicAccess?: boolean;
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
}

/** What a hub says this device's pairing credential may do. */
export type HubRole = 'admin' | 'member';

/** Progress of the one-time Harbor download, surfaced to onboarding + chat. */
export interface HarborDownload {
  percent: number;
  label: string;
  indeterminate?: boolean;
  failed?: boolean;
}

// Web billing lives on the marketing site (purchase never happens in-app, per
// Apple 3.1.1). Admins are sent here to buy seats or manage a subscription.
const BILLING_URL = 'https://openshore.ai/os-code/';

const SETTINGS_KEY = 'oscode.settings.v1';
const CONVERSATIONS_KEY = 'oscode.conversations.v1';
const ANTHROPIC_KEY_KEY = 'oscode.secret.anthropic';

// The one personal vault every account starts with, on the Local provider
// until the user moves it to iCloud (or another provider) from the vault's
// storage sheet.
const VAULT_RESOURCE_ID = 'vault.personal';

/** Which storage provider holds the personal vault right now. */
function vaultProviderId(settings: AppSettings): StorageProviderId {
  return settings.gitosResources?.find((r) => r.id === VAULT_RESOURCE_ID)?.providerId ?? 'local';
}

// Drivers are module state, keyed by conversation id.
const drivers = new Map<string, ChatDriver>();

// Beta switch: all Personal pay gates are OFF. While this is false, the coding
// agent, the Marketplace, and everything else Personal normally gates are free
// for every signed-in (or signed-out) user, and the paywall never opens. The
// whole gate is routed through personalUnlockedNow(), so this one flag covers
// every call site. Flip to true to re-enable the $20 Personal gate; nothing else
// needs to change. (Commercial team-seat billing is a separate gate,
// growthGatedByBilling, and is not affected by this.)
const PAY_GATES_ENABLED = false;

// Throttle for the foreground entitlement re-check, so returning to the app many
// times in a row never hammers the entitlement read.
let lastEntitlementForegroundAt = 0;

// The email the app most recently sent an auth link to (magic link, reset,
// confirmation). completeAuthCallback only accepts a callback for that account,
// which is the CSRF/state binding a custom oscode:// scheme cannot get from a
// browser origin. Persisted sealed and device-local with a short TTL (APP-6),
// because the link usually launches the app cold from Mail, and a binding held
// only in memory would be gone exactly when it is needed. Cleared once a
// callback is accepted, and on sign-out.
const PENDING_AUTH_KEY = 'oscode.auth.pending.v1';
const PENDING_AUTH_TTL_MS = 15 * 60_000;
interface PendingAuth {
  email: string;
  at: number;
}
async function readPendingAuth(): Promise<string | undefined> {
  const row = await storeGetJson<PendingAuth>(PENDING_AUTH_KEY);
  if (!row?.email) return undefined;
  if (Date.now() - row.at > PENDING_AUTH_TTL_MS) {
    await storeDelete(PENDING_AUTH_KEY);
    return undefined;
  }
  return row.email;
}
async function writePendingAuth(email: string): Promise<void> {
  await storeSetJson(PENDING_AUTH_KEY, { email: email.trim().toLowerCase(), at: Date.now() });
}
async function clearPendingAuth(): Promise<void> {
  await storeDelete(PENDING_AUTH_KEY);
}
// A callback that arrived with no request on record waits here for the
// person's yes on the confirm sheet (AuthConfirmSheet). Memory only: a link
// nobody confirmed should not survive a relaunch.
let pendingCallback: { session: Session; recovery: boolean } | undefined;

// An Apple purchase the server has not yet linked (UI-10): Apple finished the
// transaction, the link call failed (offline, a 401), so the signed receipt is
// kept sealed on the device and retried on the next foreground or Restore.
const PENDING_APPLE_LINK_KEY = 'oscode.iap.pendingLink.v1';

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
// Guards against two interleaved outbox syncs (a double "Sync now" tap): the
// second returns immediately rather than racing the first's snapshot save.
let outboxSyncing = false;
// Serialize repo reconcile passes: the boot check and a reconnect can otherwise
// fire at once and push the same clones twice.
let reconcilingRepos = false;
// Note bodies keyed by `${resourceId}::${path}`, so backlink derivation
// (vaultReadAll on every note open) re-reads only files whose updatedAt moved.
// Self-invalidating: a mismatched updatedAt misses; a distinct resource id
// (personal vs a specific org vault) never collides.
const vaultBodyCache = new Map<string, { updatedAt: string; text: string }>();

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
  /** False when nothing on this device can run a routine (no paired desktop). */
  available: boolean;
  where?: 'desktop' | 'daemon';
  error?: string;
}

export function emptyRoutinesState(): RoutinesState {
  return { routines: [], runs: [], loaded: false, available: false };
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
  conversations: Record<string, Conversation>;
  order: string[];
  activeId?: string;
  settings: AppSettings;
  /** Phone-side Claude key presence (the key itself never sits in state). */
  cloudKeyPresent: boolean;
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
  /** Which repo platforms are connected (tokens live in the Keychain). */
  connectedRepoPlatforms: Record<string, boolean>;
  /** The signed-in Supabase session, when accounts are configured + signed in. */
  authSession?: Session;
  /** Whether this build has sign-in configured at all. */
  authConfigured: boolean;
  /** The server-verified org role for the signed-in user, when known. */
  serverRole?: 'admin' | 'member';
  /** True after a password-reset link signs the user in, so the UI prompts them
   *  to set a new password before doing anything else. Cleared once they do. */
  passwordRecovery?: boolean;
  /** A sign-in link arrived that nothing here asked for; the confirm sheet
   *  shows the account it is for and waits for a yes (APP-6). */
  authConfirm?: { email: string; recovery: boolean };
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
  /** The signed-in individual's Personal entitlement (Stripe or Apple IAP is the
   *  writer), when known. Independent of any org: a Personal buyer has this even
   *  with no org. The unified paid-access resolver (personalUnlocked) treats an
   *  individual OR org entitlement as unlocking. */
  userEntitlement?: Entitlement;
  /** Live progress while Harbor Light downloads for the first time. */
  harborMiniDownload?: HarborDownload;
  /** Live progress while Harbor downloads for the first time. */
  harborDownload?: HarborDownload;
  /** Whether a custom search key (Brave/Tavily) is set; keeps the key itself
   *  out of state, same pattern as codemagicConnected. */
  searchKeyConfigured: boolean;
  /** The active vault's file list, loaded through the gitOS seam. */
  vaultFiles: StoredFileMeta[];
  /** The open vault note, when one is open. `fresh` marks a just-created note
   *  so the editor opens in write mode without treating every empty-bodied
   *  saved note as fresh. */
  vaultNote?: { path: string; text: string; updatedAt: string; fresh?: boolean };
  /** The last vault storage failure, cleared on any success. 'load' means the
   *  file list could not be read (show an offline state, not the first-run
   *  empty state); 'save' means a write failed and the draft was stashed for
   *  replay. Undefined when the vault is healthy. */
  vaultError?: 'load' | 'save';
  /** True when a live single-writer lease on the personal vault is held by
   *  another device, so this one shows read-only. Cloud folder syncs (iCloud,
   *  Drive) have no Git-aware locking, so the lease bounds the concurrent-edit
   *  clobber window (the conflict-copy write is the durable backstop). */
  vaultLeaseHeldByOther?: boolean;
  /** Which vault the Vault screen is showing: the personal one (on the chosen
   *  storage provider) or the shared team vault (org tier, Supabase-backed).
   *  Team is only reachable when signed in as an active member of an org. */
  vaultScope: 'personal' | 'team';
  /** When true, the Marketplace intro walkthrough is showing over the library. */
  libraryIntro?: boolean;
  /** Live reach signals that drive the active connectivity profile. */
  connectivity: Connectivity;
  /** Project repos whose local commits diverged from the remote and need a
   *  manual merge before they can sync. Set by reconcileProjectRepos; surfaced
   *  in the Vault so pending work is never silently stuck on the device. */
  repoSyncConflicts?: ReconcileResult[];
  toast?: string;
  /** When set, the Personal upgrade sheet is showing, and which locked surface
   *  triggered it. Free is chat only; coding and the Marketplace need Personal. */
  paywall?: PaywallReason;
  /** A desktop chat whose journal is still being replayed after reopen, so
   *  the screen shows a skeleton instead of the empty-state greeting. */
  resumingId?: string;

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
  /** Show the Personal upgrade sheet for a locked surface. */
  openPaywall(reason: PaywallReason): void;
  closePaywall(): void;
  /** Whether the signed-in person has the Personal unlock, by EITHER rail (an
   *  individual Personal subscription OR an entitled commercial org). Free
   *  (signed out or no entitlement) is chat only. */
  personalUnlockedNow(): boolean;
  /** Whether a chat source can produce a real answer on this device right now
   *  (a downloaded on-device model, a paired computer, or a stored cloud key).
   *  The empty-state composer checks this before starting a chat, so a first
   *  message is never sent into a brain that cannot answer. */
  sourceReady(source: ConversationSource): boolean;
  /** Re-read the desktop engine's status (Electron only; no-op elsewhere). */
  refreshDesktopStatus(): Promise<void>;
  /** Buy Personal: Apple In-App Purchase on iOS, Stripe web checkout elsewhere.
   *  Resolves once the purchase flow has been handed off (IAP sheet shown, or
   *  the browser opened); entitlement lands via refreshEntitlement. */
  buyPersonal(): Promise<void>;
  /** Restore a prior Apple purchase (iOS only; required by Apple 3.1.1). */
  restorePurchases(): Promise<void>;

  newConversation(
    source: ConversationSource,
    opts?: {
      /** Pre-written turns the chat opens with (a guide's plan). They render
       *  immediately and seed the model's history, so it knows what was said. */
      seedItems?: ThreadItem[];
      title?: string;
      /** The repositories the chat starts with; the project's when omitted. */
      repoIds?: string[];
    },
  ): Promise<string>;
  /** Replace the repositories a chat works with (the header picker). */
  setConversationRepos(id: string, repoIds: string[]): Promise<void>;
  /** Open a chat with a setup guide: the goal, the plan, and step one, seeded
   *  and ready, on whatever brain can answer here (this computer's engine, a
   *  cloud key, or Harbor Light on the phone). The Walk me through it button. */
  startGuideChat(guideId: SetupGuideId): Promise<void>;
  /** Switch the model of the OPEN conversation, Claude-style: keep the thread,
   *  reseed the new brain with the transcript, and let the next turn run on it.
   *  Falls back to a fresh chat when there is nothing to carry or the target is
   *  not a chat brain. */
  switchModel(source: ConversationSource): Promise<void>;
  /** Open a fresh, empty chat (the source picker decides who answers). A
   *  project is auto-created on first save, so this never dead-ends. */
  startNewChat(): void;
  /** Send text once the active conversation's driver has attached. */
  sendWhenAttached(conversationId: string, text: string, attachments?: Attachment[]): void;
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
  /** Open the command center (a sub-page of My Crew) and refresh. */
  openCrewCommand(): void;
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
  /** Sign in with email + password. */
  signIn(email: string, password: string): Promise<void>;
  /** Create an account with email + password. Returns whether email
   *  confirmation is required before the account can sign in. */
  signUpAccount(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  /** Send a magic-link email that returns to the app's deep-link origin. */
  sendMagicLink(email: string): Promise<void>;
  /** Email a password-reset link that returns to the app to set a new password. */
  sendPasswordReset(email: string): Promise<void>;
  /** Resend the sign-up confirmation email (lost or expired link). */
  resendConfirmation(email: string): Promise<void>;
  /** Set a new password for the signed-in user and clear the recovery prompt. */
  updateMyPassword(password: string): Promise<void>;
  /** Finish a magic-link sign-in from the callback URL the app was opened with.
   *  Returns true once signed in. False when the link was refused, or when it
   *  is waiting on the confirm sheet (authConfirm) because nothing asked. */
  completeAuthCallback(url: string): Promise<boolean>;
  /** The confirm sheet's yes: sign in with the link that arrived unasked. */
  confirmAuthCallback(): Promise<void>;
  /** The confirm sheet's no: drop the link. */
  dismissAuthCallback(): void;
  /** Adopt the server org waiting in orgJoin on this device. */
  joinOrg(): Promise<void>;
  /** Decline it on this device (remembered until sign-out). */
  declineOrg(): Promise<void>;
  /** Sign out and forget the session. */
  signOutAccount(): Promise<void>;
  /** Re-read the signed-in user's server role into serverRole. */
  refreshOrgRole(): Promise<void>;
  /** Re-read the org's billing entitlement from the server. */
  refreshEntitlement(): Promise<void>;
  /** Re-check entitlement when the app returns to the foreground, so a purchase
   *  completed in the browser lands without the user hunting for a refresh.
   *  Fires only when signed in and not already unlocked, and is self-throttled. */
  reconcileEntitlementOnForeground(): Promise<void>;
  /** Handle the checkout-return deep link: refresh entitlement now (unthrottled)
   *  and reflect the result, so a Stripe payer is unlocked the moment they land
   *  back in the app. */
  onCheckoutReturn(): Promise<void>;
  /** Open web billing: the Stripe customer portal if subscribed, else the
   *  purchase page. Always in the system browser (Apple 3.1.1); seats are
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

  // My Crew: user-authored agents.
  /** Create a crew agent and return its id. */
  createCrewAgent(input: Omit<CrewAgent, 'id' | 'createdAt'>): Promise<string>;
  updateCrewAgent(id: string, patch: Partial<Omit<CrewAgent, 'id' | 'createdAt'>>): Promise<void>;
  deleteCrewAgent(id: string): Promise<void>;
  /** Download the Harbor Light guide model if it is not here yet. Returns success. */
  ensureHarborMini(): Promise<boolean>;
  /** Cancel an in-progress Harbor Light download (returning users can skip it). */
  cancelHarborMini(): void;
  /** Download the Harbor guide model if it is not here yet. Returns success. */
  ensureHarbor(): Promise<boolean>;
  /** Cancel an in-progress Harbor download. */
  cancelHarbor(): void;
  /** Remove Harbor's weights from this device and drop its ready flag. Harbor
   *  is a real download (about 1.1 GB), so it is uninstallable; Harbor Light is
   *  bundled with the app and has no counterpart here. */
  removeHarbor(): Promise<void>;
  /** First-run: start Harbor Light's download and open the LLM Library intro. */
  beginHarborMiniWithIntro(): void;
  /** First-run: start Harbor's download and open the LLM Library intro. */
  beginHarborWithIntro(): void;
  /** Close the Library intro and return to setup; download keeps going. */
  endLibraryIntro(): void;
  /** Open a fresh chat with a guide, downloading it first if needed. Defaults
   *  to Harbor, the preferred pick. */
  startGuide(modelId?: string): Promise<string | undefined>;
  /** Bring your own Brave or Tavily key for Harbor's web search. */
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
  /** Open a note into vaultNote. A missing path opens as a fresh empty note. */
  vaultOpen(path: string): Promise<void>;
  /** Create a note: write an empty file so it persists immediately (a fresh
   *  note no longer evaporates on back-out), then open it in write mode. If it
   *  already exists, just opens it. */
  vaultCreate(path: string): Promise<void>;
  /** Close the open note (back to the tree). */
  vaultCloseNote(): void;
  /** Write a note body and refresh the file list. */
  vaultSave(path: string, text: string): Promise<void>;
  /** Delete a note and refresh; closes it if it was open. */
  vaultDelete(path: string): Promise<void>;
  /** Every note body, for backlink derivation. */
  vaultReadAll(): Promise<Array<{ path: string; text: string }>>;
  /** Take or renew the personal vault's single-writer lease, and record whether
   *  another device holds it live (which puts the screen read-only). No-op for
   *  the team vault (the server resolves concurrency). */
  vaultAcquireLease(): Promise<void>;
  /** Release the personal vault lease this device holds. */
  vaultReleaseLease(): Promise<void>;
  /** Move the personal vault to a different storage provider (e.g. iCloud):
   *  copy every note across, then repoint the resource. Returns false when the
   *  target is not usable right now. */
  vaultMoveTo(providerId: StorageProviderId): Promise<boolean>;
  /** Run the Google Drive OAuth connect flow. Never throws. */
  connectGdriveAccount(): Promise<{ ok: boolean; error?: string }>;
  /** Revoke and forget the connected Google account. */
  disconnectGdriveAccount(): Promise<void>;
  /** Drop back to the zero-config DuckDuckGo default. */
  clearSearchBackend(): Promise<void>;
  openConversation(id: string): void;
  deleteConversation(id: string): void;
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
    opts?: { inProject?: boolean },
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
  /** Set the permission mode for new sessions and the live one. */
  setPermissionMode(mode: PermissionMode): Promise<void>;
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
  /** Save a hub (upsert by base URL) and make it the active one. The role the
   *  hub reported at pairing rides along; when absent it is read from the hub. */
  saveHub(target: DaemonTarget, opts?: { role?: HubRole }): Promise<void>;
  /** Record what a hub says this device's credential may do. */
  setHubRole(baseUrl: string, role: HubRole | undefined): Promise<void>;
  /** Switch the active hub to a saved one by base URL. */
  selectHub(baseUrl: string): Promise<void>;
  /** Forget a saved hub; if it was active, fall back to another or none. */
  removeHub(baseUrl: string): Promise<void>;
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
  /** Disconnect a cloud provider and forget its key. */
  disconnectProvider(id: string): Promise<void>;

  /** Re-check home reachability + internet, updating the connectivity signals. */
  refreshConnectivity(): Promise<void>;
  /** Push each project repo's unpushed local commits to its remote, so a
   *  project's notes and code never linger only on this device. Runs on app
   *  open and on reconnect; desktop only (that is where the clones live). */
  reconcileProjectRepos(trigger: 'open' | 'reconnect'): Promise<void>;
  /** Manually step down to a more restrictive profile, or clear (auto). */
  setProfileOverride(profile?: ProfileId): Promise<void>;

  // Stack management (the app-side Reasoning LLM + specialists + bench).
  /** Connect a bring-your-own-model endpoint. Returns the new connection. */
  connectByom(input: {
    label: string;
    baseUrl: string;
    model: string;
    apiKey?: string;
  }): Promise<ByomConnection>;
  /** Disconnect a BYOM endpoint: delete its key and pull it from the stack. */
  disconnectByom(id: string): Promise<void>;
  /** Set the Reasoning LLM anchor (from the bench or a cloud model) for a
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

/** The device StackModelRef for the flagship guide (Harbor). Harbor Light has
 *  its own harborRef() in stack.js; this is its bigger sibling. */
function harborFullRef(): StackModelRef {
  return { kind: 'device', modelId: HARBOR_MODEL_ID, modelName: HARBOR_MODEL_NAME };
}

/**
 * Decide whether a freshly downloaded guide should become the stack's Reasoning
 * anchor, so "My Stack" chat can start right away. Promote when there is no
 * anchor yet, or the current anchor is a built-in guide that is not actually on
 * this device. The preferred guide (Harbor) also upgrades a ready Harbor Light;
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

// Only these statuses grant paid access; every other status (past_due, unpaid,
// canceled, incomplete, incomplete_expired, paused) is revoked. past_due counts
// as revoked (strict, money-safe); widen this set for a grace window.
const ENTITLED_STATUSES = new Set(['active', 'trialing']);

/**
 * Whether an org's billing entitlement grants paid access right now: an active
 * or trialing subscription whose paid period has not lapsed. The webhook-written
 * org_entitlements.status is the single authoritative source (client-read-only);
 * orgs.tier_id is display only and nothing gates on it. Used identically in the
 * app, marketing, and daemon.
 */
export function isEntitled(e?: { status: string; validUntil?: string | null }): boolean {
  return (
    !!e &&
    ENTITLED_STATUSES.has(e.status) &&
    (!e.validUntil || new Date(e.validUntil).getTime() > Date.now())
  );
}

/**
 * Whether the signed-in person has full-app (paid) access right now, by EITHER
 * rail: an individual Personal entitlement (Stripe or Apple IAP) OR an entitled
 * commercial org. One identity anchor (the Supabase user); either entitlement
 * unlocks. This is the resolver the coding/marketplace gate consumes; team-seat
 * growth still keys off the org entitlement specifically (growthGatedByBilling).
 */
export function personalUnlocked(
  userEntitlement?: { status: string; validUntil?: string | null },
  orgEntitlement?: { status: string; validUntil?: string | null },
): boolean {
  return isEntitled(userEntitlement) || isEntitled(orgEntitlement);
}

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

export const useApp = create<AppState>((set, get) => {
  /** Detach and release a conversation's driver, if any. */
  function dropDriver(conversationId: string): void {
    drivers.get(conversationId)?.dispose();
    drivers.delete(conversationId);
    unsubscribers.get(conversationId)?.();
    unsubscribers.delete(conversationId);
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
          [conversationId]: { ...c, pendingFirstMessage: undefined },
        },
      };
    });
    driver.send(text, attachments);
    void persistConversations(get());
  }

  function attachDriver(conversationId: string, driver: ChatDriver): void {
    dropDriver(conversationId);
    drivers.set(conversationId, driver);
    // APP-13: events fold into ONE state update per tick. A journal replay
    // hands over hundreds of events synchronously, which used to be hundreds
    // of renders; live streaming delivers one event per task, so batching
    // costs it nothing. The side effects below run after the fold, in order.
    const pending: Array<{ event: DriverEvent; seq: number }> = [];
    let scheduled = false;
    const flush = () => {
      scheduled = false;
      const batch = pending.splice(0);
      if (!batch.length) return;
      set((state) => {
        const conv = state.conversations[conversationId];
        if (!conv) return state;
        let thread = conv.thread;
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
        return { conversations: { ...state.conversations, [conversationId]: next } };
      });
      let celebrated = false;
      for (const { event } of batch) {
        if (event.type === 'task-done' && event.reason === 'complete' && !celebrated) {
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
          drivers.get(conversationId)?.send(head!);
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
      pending.push({ event, seq });
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    });
    unsubscribers.set(conversationId, off);
    flushPendingFirstMessage(conversationId, driver);
  }

  /** APP-5: the daemon's session id is state, written through `set` and
   *  persisted at once, so a kill before the first message never orphans a
   *  session on the hub. */
  async function bindSessionId(conversationId: string, sessionId: string): Promise<void> {
    set((state) => {
      const c = state.conversations[conversationId];
      if (!c || c.source.kind !== 'desktop') return state;
      return {
        conversations: {
          ...state.conversations,
          [conversationId]: { ...c, source: { ...c.source, sessionId } },
        },
      };
    });
    await persistConversations(get());
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
  async function buildDriver(conv: Conversation, seed?: SeedTurn[]): Promise<ChatDriver> {
    return guardDriver(await buildUnguardedDriver(conv, seed));
  }

  async function buildUnguardedDriver(conv: Conversation, seed?: SeedTurn[]): Promise<ChatDriver> {
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
        if (settings.codemagicAccess) {
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
          codemagicToken,
          codemagicTarget,
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
                  ? 'No model is set up on this computer yet. Open Your stack and pick one.'
                  : msg,
              );
            }
            sessionId = created.id;
            await bindSessionId(conv.id, sessionId);
          } else {
            // G1: resume returns the journal so the driver can replay it AFTER
            // it has subscribed (IPC does not buffer a pushed replay).
            const resumed = await bridge()!.resumeSession(sessionId);
            if ('journal' in resumed) journal = resumed.journal;
          }
          return new ElectronDriver(sessionId, journal);
        }
        if (!settings.daemon) {
          throw new Error('Connect to your desktop first (Menu, then Desktop connection).');
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
            permissionMode: sessionOpts.permissionMode,
            humanize: sessionOpts.humanize,
          });
          await bindSessionId(conv.id, sessionId);
        }
        // Opening a desktop session is the walk-away-able moment: the run
        // continues on the daemon while the phone is closed. Register for
        // completion push now (contextual, not at launch), once per daemon.
        void ensureDesktopPush();
        // Refresh what this hub says the credential may do, so the composer's
        // terminal affordance tracks the role the hub enforces (P0-1).
        void refreshHubRole(settings.daemon);
        // Replay from zero so the transcript rebuilds exactly.
        return new RemoteDriver(sessionId, settings.daemon, 0);
      }
      case 'desktop-chat': {
        // Free, read-only chat with the paired desktop's local models over the
        // daemon's stateless /chat endpoint. No session is created, so this can
        // never become the paid agent. Needs a paired daemon.
        if (!settings.daemon) {
          throw new Error('Connect to your desktop first (Menu, then Desktop connection).');
        }
        return new DesktopChatDriver(settings.daemon, conv.source.model, seed);
      }
      case 'device':
        return new OnDeviceDriver(conv.source.modelId, conv.source.modelName, seed);
      case 'cloud': {
        // Claude runs on the Anthropic SDK; every other connected provider runs
        // on the shared OpenAI-compatible chat driver, so a user can chat with
        // any model their provider offers, not only Claude. Held in a const so
        // the narrowing survives the awaits below.
        const source = conv.source;
        if (source.provider === 'anthropic') {
          const key = await secretGet(ANTHROPIC_KEY_KEY);
          if (!key) throw new Error('Add your Claude API key under Connections first.');
          return new CloudClaudeDriver(
            key,
            source.model,
            seed,
            settings.anthropicWorkspaceId,
            repoContextLine(conv.repoIds ?? []),
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
          repoContextLine(conv.repoIds ?? []),
          contextWindow,
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
        return new StackDriver(
          stackForProfile(s.settings.stacks, profile),
          profile,
          {
            projectName: project?.name,
            projectInstructions:
              [project?.instructions?.trim(), repoContextLine(conv.repoIds ?? [])]
                .filter(Boolean)
                .join('\n\n') || undefined,
            crew,
            humanize: s.settings.humanizeWriting !== false,
            // Codemagic Access on and connected: offer the codemagic tool so the
            // model can drive App Launch builds on the phone (Anthropic path).
            codemagicAccess: s.settings.codemagicAccess === true && s.codemagicConnected,
          },
          seed,
        );
      }
      case 'mock':
        return new MockDriver();
    }
  }

  // Where a magic-link sign-in returns to. Each shell has its own origin the
  // token must land on (Uki's "auth callbacks stay on the app's own origin").
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
      if (fresh !== session) set({ authSession: fresh });
      return fresh;
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        await forgetSession();
        get().showToast('Your sign-in expired. Sign in again.');
        logEvent('auth_expired');
        return undefined;
      }
      throw err;
    }
  }

  async function accessToken(): Promise<string | undefined> {
    return (await freshAuth())?.accessToken;
  }

  // Forget the session on this device: the stored copy, the pending auth
  // binding, the team vault, the org's shared projects, and (APP-7) a
  // server-backed org's roster and the signed-in identity, so local admin
  // authority cannot outlive the sign-in. The org's name and server id stay,
  // so the next sign-in by a member pulls the same org without asking again.
  async function forgetSession(): Promise<void> {
    await clearSession();
    await clearPendingAuth();
    pendingCallback = undefined;
    // Best-effort: signing out of the account also severs any connected
    // Google Drive access, so a shared or handed-off device does not keep
    // standing storage access behind. A revoke failure (offline) must
    // never block sign-out itself.
    await disconnectGdrive().catch(() => {});
    // Sever the team vault too: drop its on-screen state and the provider's
    // base-rev cache, and fall back to the personal scope, so a handed-off
    // device never shows the previous org's note titles or open note to the
    // next person who signs in.
    resetOrgVault();
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
    if (Object.keys(patch).length) await get().saveSettings(patch);
    set({
      authSession: undefined,
      serverRole: undefined,
      entitlement: undefined,
      userEntitlement: undefined,
      passwordRecovery: undefined,
      authConfirm: undefined,
      orgJoin: undefined,
      vaultScope: 'personal',
      vaultFiles: [],
      vaultNote: undefined,
    });
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

  /** UI-10: link an Apple receipt the server has not seen yet. Returns true
   *  once the pending receipt is linked (or there was none to link). */
  async function retryPendingAppleLink(): Promise<boolean> {
    const pending = await storeGetJson<{ jws: string; at: string }>(PENDING_APPLE_LINK_KEY);
    if (!pending?.jws) return false;
    const token = await accessToken();
    if (!token) return false;
    try {
      await supabaseInvoke('link-apple-purchase', token, { jws: pending.jws });
      await storeDelete(PENDING_APPLE_LINK_KEY);
      return true;
    } catch {
      return false;
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
  // server id. Returns undefined for team when no signed-in org is present, so
  // the actions no-op instead of throwing.
  function vaultTarget(): { provider: StorageProvider; resourceId: string } | undefined {
    const st = get();
    if (st.vaultScope === 'team') {
      const orgId = st.settings.account?.org?.serverId;
      const provider = providerFor('org');
      if (!orgId || !provider) return undefined;
      return { provider, resourceId: orgId };
    }
    const provider = providerFor(vaultProviderId(st.settings));
    if (!provider) return undefined;
    return { provider, resourceId: VAULT_RESOURCE_ID };
  }

  // Durable draft rescue for the vault. When a provider write fails (offline
  // cloud vault, expired token), the typed text is stashed to the sealed local
  // store keyed by resource+path, and replayed the next time a write or a list
  // succeeds against that resource. This is what makes a cloud-backed vault
  // safe to type into offline: nothing typed is lost to an unhandled rejection.
  const VAULT_PENDING_KEY = 'oscode.vault.pending';
  type VaultPending = Record<
    string,
    { resourceId: string; path: string; text: string; at: string }
  >;
  async function loadVaultPending(): Promise<VaultPending> {
    return (await storeGetJson<VaultPending>(VAULT_PENDING_KEY)) ?? {};
  }
  async function saveVaultPending(p: VaultPending): Promise<void> {
    if (Object.keys(p).length === 0) await storeDelete(VAULT_PENDING_KEY);
    else await storeSetJson(VAULT_PENDING_KEY, p);
  }
  async function stashVaultDraft(resourceId: string, path: string, text: string): Promise<void> {
    const p = await loadVaultPending();
    p[`${resourceId}::${path}`] = { resourceId, path, text, at: new Date().toISOString() };
    await saveVaultPending(p);
  }
  async function replayVaultPending(target: {
    provider: StorageProvider;
    resourceId: string;
  }): Promise<void> {
    const p = await loadVaultPending();
    let changed = false;
    for (const [key, item] of Object.entries(p)) {
      if (item.resourceId !== target.resourceId) continue;
      try {
        await target.provider.write(item.resourceId, item.path, item.text);
        delete p[key];
        changed = true;
      } catch {
        // Still failing; keep the stash for the next attempt.
      }
    }
    if (changed) await saveVaultPending(p);
  }

  // verified email, claim any invited org seat, and read the server role.
  async function onSignedIn(session: Session): Promise<void> {
    await saveSession(session);
    // A fresh session always starts on the personal vault, with no team-vault
    // state or base-rev cache carried over from a prior account on this device.
    resetOrgVault();
    set({ authSession: session, vaultScope: 'personal', vaultFiles: [], vaultNote: undefined });
    const account = get().settings.account;
    if (account && session.user.email && account.selfEmail !== session.user.email) {
      await get().saveSettings({ account: { ...account, selfEmail: session.user.email } });
    }
    try {
      await supabaseRpc('claim_membership', session.accessToken);
    } catch {
      // No invited seat, or offline: role stays whatever the server says next.
    }
    await reconcileOrg();
    await get().refreshOrgRole();
    void get().refreshEntitlement();
    void get().syncOrgProjects();
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
    connectedProviders: {},
    arrivedBack: false,
    codemagicConnected: false,
    searchKeyConfigured: false,
    vaultFiles: [],
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

      // Wire the team vault (org tier) to the signed-in session: a fresh-token
      // getter and a readiness predicate, so the Supabase-backed provider can
      // authenticate without importing the store (which would be a cycle).
      setOrgVaultAuth(
        async () => {
          try {
            return await accessToken();
          } catch {
            return undefined;
          }
        },
        () => get().teamVaultAvailable(),
      );

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
      const persisted = (await storeGetJson<PersistedConversations>(CONVERSATIONS_KEY)) ?? {
        order: [],
        conversations: {},
      };
      const conversations: Record<string, Conversation> = {};
      for (const id of persisted.order) {
        const row = persisted.conversations[id];
        if (!row) continue;
        // Quick chats were retired (2026-09-02); a row from that era is dropped.
        if ((row as { ephemeral?: boolean }).ephemeral) continue;
        conversations[id] = {
          ...row,
          // Desktop threads rebuild from the journal on open; local ones load as saved.
          thread: row.source.kind === 'desktop' ? emptyThread() : (row.thread ?? emptyThread()),
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
          const harborHere = present.has(HARBOR_MODEL_ID);
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
      // first." This is exactly the case a fresh stack (seeded with Harbor Light)
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
      // being silently re-adopted on the next launch.
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

      // A stored session is a local, encrypted-at-rest read (no network round
      // trip), so it is cheap to check before deciding the first view: a
      // signed-in device skips onboarding and lands straight on chat, same as
      // an already-onboarded one. A fresh sign-in completed via the web
      // magic-link callback (below) is a separate case that only ever applies
      // once the app is already open, so it does not need to gate this.
      const stored: Session | undefined = authConfigured() ? await loadStoredSession() : undefined;

      set({
        settings,
        conversations,
        order: persisted.order.filter((id) => conversations[id]),
        cloudKeyPresent,
        connectedProviders,
        codemagicConnected,
        searchKeyConfigured,
        connectedRepoPlatforms,
        ready: true,
        authSession: stored ?? get().authSession,
        hubRole: activeHubRole(settings),
        dataLocked: locked || undefined,
        // A locked device is not a new one: never route it into onboarding,
        // whose writes could not land anyway.
        view: settings.onboarded || stored || locked ? 'chat' : 'onboarding',
      });
      logEvent('app_open', { onboarded: settings.onboarded });
      if (locked) {
        get().showToast(
          'Could not unlock your data on this machine. Nothing was changed. Restart the app, or check your system keychain.',
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
          const hasCallback = platform() === 'web' && /access_token=|auth-callback/.test(href);
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
            await reconcileOrg();
            await get().refreshOrgRole();
            void get().syncOrgProjects();
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
      }

      // On every app open, check for local project work that never reached the
      // remote and push it, so nothing important is stranded on this device.
      void get().reconcileProjectRepos('open');

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
      const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
      let homeReachable = false;
      const daemon = get().settings.daemon;
      if (daemon && online) {
        try {
          const res = await Promise.race([
            daemonHealth(daemon),
            new Promise<{ ok: boolean }>((r) => setTimeout(() => r({ ok: false }), 3000)),
          ]);
          homeReachable = Boolean(res.ok);
        } catch {
          homeReachable = false;
        }
      }
      const prev = get().connectivity;
      if (prev.online !== online || prev.homeReachable !== homeReachable) {
        set({ connectivity: { online, homeReachable } });
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
        const results = await bridge()!.reconcileRepos(roots);
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
      // Free is chat only: the Marketplace needs Personal. Intercept the
      // navigation and show the upgrade sheet instead of the locked screen.
      if (view === 'marketplace' && !get().personalUnlockedNow()) {
        get().openPaywall('marketplace');
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
      set({ view: prev, viewTrail: viewTrail.slice(0, -1), drawerOpen: false, arrivedBack: true });
    },

    setDrawer(open) {
      set({ drawerOpen: open });
    },

    openPaywall(reason) {
      logEvent('paywall_shown', { reason });
      set({ paywall: reason, drawerOpen: false });
    },
    closePaywall() {
      set({ paywall: undefined });
    },

    personalUnlockedNow() {
      // Beta: gates off, everyone is treated as unlocked (see PAY_GATES_ENABLED).
      if (!PAY_GATES_ENABLED) return true;
      return personalUnlocked(get().userEntitlement, get().entitlement);
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
        case 'desktop-chat':
          // The desktop app's engine refuses to start a session until a model
          // (orchestrator) is configured, so "ready" here means that, not just
          // "we are on a desktop". A phone is ready when a computer is paired.
          if (isDesktop()) return Boolean(s.desktopStatus?.stack.configured);
          return Boolean(st.daemon);
        case 'mock':
          return true;
      }
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

    async buyPersonal() {
      // Buying requires an account to attach the entitlement to.
      if (!authConfigured() || !get().authSession) {
        get().showToast('Sign in first to unlock Personal.');
        return;
      }
      // iOS: Apple In-App Purchase (Apple 3.1.1). Never open web checkout in the
      // app. The signed StoreKit transaction is verified server-side; the client
      // claim is only a hint.
      if (iapAvailable()) {
        let result;
        try {
          result = await iapPurchase(PERSONAL_YEARLY_PRODUCT_ID);
        } catch (err) {
          get().showToast(err instanceof Error ? err.message : 'Could not complete the purchase.');
          return;
        }
        if (result.state !== 'purchased' || !result.jws) return;
        // Apple has charged and finished the transaction by now. If the link
        // to the server fails here (offline, a dead session), the receipt is
        // kept and retried on the next foreground or Restore (UI-10); the copy
        // names that path instead of a raw error.
        try {
          const token = await accessToken();
          if (!token) throw new Error('signed out');
          await supabaseInvoke('link-apple-purchase', token, { jws: result.jws });
        } catch {
          await storeSetJson(PENDING_APPLE_LINK_KEY, {
            jws: result.jws,
            at: new Date().toISOString(),
          });
          get().showToast(
            'Apple confirmed your purchase. OpenShore could not reach its server to unlock it. Tap Restore purchases when you are back online.',
          );
          return;
        }
        await get().refreshEntitlement();
        if (get().personalUnlockedNow()) {
          set({ paywall: undefined });
          get().showToast("You're Personal. The agent and Marketplace are unlocked.");
        }
        return;
      }
      // Web/desktop: Personal is an Apple subscription, so there is no purchase
      // here. Point the user to buy it in the app on their iPhone, then unlock
      // this computer with "I bought it" (restorePurchases refreshes the
      // entitlement). Commercial team plans still use Stripe, via manageBilling.
      get().showToast('Buy Personal in the OS Code app on your iPhone, then refresh here.');
    },

    async restorePurchases() {
      if (!authConfigured() || !get().authSession) {
        get().showToast('Sign in first, then restore.');
        return;
      }
      // A receipt from a purchase the server never saw goes first (UI-10).
      await retryPendingAppleLink();
      const session = await freshAuth();
      if (!session) return;
      if (!iapAvailable()) {
        // Not an Apple device: a web/desktop buyer's entitlement is already on
        // the account, so a refresh is the "restore".
        await get().refreshEntitlement();
        get().showToast(
          get().personalUnlockedNow() ? 'Personal restored.' : 'No Personal subscription found.',
        );
        return;
      }
      try {
        const { transactions } = await iapRestore(PERSONAL_YEARLY_PRODUCT_ID);
        for (const t of transactions) {
          if (t.jws)
            await supabaseInvoke('link-apple-purchase', session.accessToken, { jws: t.jws });
        }
        await get().refreshEntitlement();
        if (get().personalUnlockedNow()) {
          set({ paywall: undefined });
          get().showToast('Personal restored.');
        } else {
          get().showToast('No purchases to restore.');
        }
      } catch (err) {
        get().showToast(err instanceof Error ? err.message : 'Could not restore purchases.');
      }
    },

    showToast(message) {
      set({ toast: message });
      setTimeout(() => set((s) => (s.toast === message ? { toast: undefined } : s)), 3200);
    },

    async newConversation(source, opts) {
      // Free is chat only. The coding AGENT is a 'desktop' repo session (it reads
      // the repo, writes edits, runs tools) and that is the paid surface; chat
      // with local models ('device' Harbor/Ollama) and with a connected stack
      // ('stack') stays free. Central choke point so every coding entry (Repos,
      // Launch) is gated one way. Returns the current conversation id (or empty)
      // so callers that navigate on the result do not dead-end.
      const coding = source.kind === 'desktop';
      if (coding && !get().personalUnlockedNow()) {
        get().openPaywall('coding');
        return get().activeId ?? '';
      }
      logEvent('source_chosen', { kind: source.kind });
      const id = newId();
      // Every chat belongs to the active project (or the first one). If none
      // exists yet, make a default so a chat is never orphaned from every bucket.
      const s0 = get().settings;
      let projectId = s0.activeProjectId ?? s0.projects?.[0]?.id;
      if (!projectId) projectId = await get().createProject('My work');
      const seedItems = opts?.seedItems ?? [];
      // The chat's repositories: what the caller picked, else the project's.
      const project = get().settings.projects?.find((p) => p.id === projectId);
      const repoIds = opts?.repoIds ?? project?.repoIds ?? [];
      const conv: Conversation = {
        id,
        title: opts?.title ?? 'New chat',
        source,
        projectId,
        repoIds,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        thread: { ...emptyThread(), items: seedItems },
      };
      set((s) => ({
        conversations: { ...s.conversations, [id]: conv },
        order: [id, ...s.order],
        activeId: id,
        view: 'chat',
        drawerOpen: false,
      }));
      try {
        const driver = await buildDriver(
          conv,
          seedItems.length ? seedFromTranscript(seedItems) : undefined,
        );
        attachDriver(id, driver);
      } catch (err) {
        get().showToast(err instanceof Error ? err.message : String(err));
      }
      void persistConversations(get());
      return id;
    },

    async switchModel(source) {
      const { activeId } = get();
      const conv = activeId ? get().conversations[activeId] : undefined;
      // Only chat brains carry a thread forward. A repo agent ('desktop') or the
      // demo ('mock') is a different mode; with nothing to carry, or no open
      // chat, just open a fresh chat with the chosen brain.
      const seedable =
        source.kind === 'stack' || source.kind === 'cloud' || source.kind === 'device';
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
      const seed = seedFromTranscript(conv.thread.items);
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
        get().showToast(err instanceof Error ? err.message : String(err));
        return;
      }
      // attachDriver disposes the old driver and keeps the thread, so the
      // visible history is untouched; the new driver starts with the seeded
      // transcript so the next turn has full context.
      attachDriver(activeId, driver);
      // Disclose when a private on-device chat's history is about to cross to a
      // network brain, and when earlier images will not carry over. No request
      // fires until the next send, so these notes land before anything leaves.
      const crossedToNetwork = conv.source.kind === 'device' && source.kind !== 'device';
      let text = `Now using ${sourceLabel(source)}.`;
      if (crossedToNetwork) {
        text += " Your next message sends this chat's history to it for context.";
      }
      if (conv.hadVisionInput) {
        text += ' Images from earlier in this chat are not carried across the switch.';
      }
      set((s) => {
        const c = s.conversations[activeId];
        if (!c) return s;
        const note: ThreadItem = { kind: 'note', id: newId(), text };
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
    },

    startNewChat() {
      set({ activeId: undefined, view: 'chat', viewTrail: [], drawerOpen: false });
    },

    sendWhenAttached(conversationId, text, attachments) {
      const driver = drivers.get(conversationId);
      if (driver) {
        driver.send(text, attachments);
        return;
      }
      // APP-10: the driver attaches asynchronously (a session still opening on
      // the hub), or its build failed and the next open rebuilds it. Hold the
      // message on the chat, persisted, and let the attach deliver it. No
      // timer, so a slow open or a relaunch mid-open never drops the first
      // message.
      pendingSends.set(conversationId, attachments);
      set((state) => {
        const c = state.conversations[conversationId];
        if (!c) return state;
        return {
          conversations: {
            ...state.conversations,
            [conversationId]: { ...c, pendingFirstMessage: text },
          },
        };
      });
      void persistConversations(get());
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
      // A sub-page of My Crew: setView pushes Crew onto the trail, so the top
      // bar offers a way back to the roster.
      get().setView('crewcommand');
      logEvent('crew_command_open');
      void get().refreshRoutines();
    },

    async refreshRoutines() {
      const client = routinesClient(get().settings);
      if (!client) {
        set((s) => ({
          routines: { ...s.routines, routines: [], runs: [], loaded: true, available: false },
        }));
        return;
      }
      try {
        const snap = await client.list();
        set({
          routines: {
            routines: snap.routines,
            runs: snap.runs,
            loaded: true,
            available: true,
            where: client.where,
            error: undefined,
          },
        });
      } catch (err) {
        set((s) => ({
          routines: {
            ...s.routines,
            loaded: true,
            available: true,
            where: client.where,
            error: err instanceof Error ? err.message : String(err),
          },
        }));
      }
    },

    async createRoutine(input) {
      const client = routinesClient(get().settings);
      if (!client) {
        get().showToast('Pair your desktop first. Routines run on your computer.');
        return undefined;
      }
      try {
        const routine = await client.create(input);
        logEvent('routine_created', { access: input.access ?? 'read-only' });
        await get().refreshRoutines();
        return routine;
      } catch (err) {
        get().showToast(err instanceof Error ? err.message : String(err));
        return undefined;
      }
    },

    async updateRoutine(id, patch) {
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
      if (input.type === 'personal') {
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

    async signIn(email, password) {
      const session = await signInWithPassword(email.trim(), password);
      await onSignedIn(session);
    },

    async signUpAccount(email, password) {
      // Pass the app's own deep-link origin so the confirmation link returns
      // into the app, not onto a generic dashboard page.
      const session = await supabaseSignUp(email.trim(), password, authRedirectTo());
      if (session) {
        await onSignedIn(session);
        return { needsConfirmation: false };
      }
      // The confirmation link will come back as a callback; bind it to this
      // address so only this account can complete it.
      await writePendingAuth(email);
      return { needsConfirmation: true };
    },

    async sendMagicLink(email) {
      await signInWithOtp(email.trim(), authRedirectTo());
      // Remember who we sent the link to, so the callback only signs in that
      // person (see completeAuthCallback). A custom-scheme link has no
      // browser-enforced origin, so this binding is the CSRF guard.
      await writePendingAuth(email);
    },

    async sendPasswordReset(email) {
      await supabaseSendPasswordReset(email.trim(), authRedirectTo());
      await writePendingAuth(email);
    },

    async resendConfirmation(email) {
      await supabaseResendConfirmation(email.trim(), authRedirectTo());
      await writePendingAuth(email);
    },

    async updateMyPassword(password) {
      const token = await accessToken();
      if (!token) {
        get().showToast('Sign in first.');
        return;
      }
      await supabaseUpdatePassword(token, password);
      set({ passwordRecovery: false });
      get().showToast('Password updated.');
    },

    async completeAuthCallback(url) {
      const parsed = parseAuthCallback(url);
      if (!parsed) return false;
      // A password-reset link signs the user in with a recovery session; flag it
      // so the UI prompts for a new password instead of dropping them in as if
      // nothing else is needed.
      const recovery = authCallbackType(url) === 'recovery';
      // Fill the user id/email the callback URL does not carry. The token is
      // validated server-side here: a forged or expired token yields no user
      // and the callback is refused, never a half-signed-in session.
      const user = await getUser(parsed.accessToken);
      if (!user) {
        get().showToast('That sign-in link is not valid anymore. Request a new one.');
        return false;
      }
      const email = (user.email ?? '').toLowerCase();
      // Someone else is signed in here: a link must never switch accounts
      // underneath them.
      const current = get().authSession?.user.email;
      if (current && email && current.toLowerCase() !== email) {
        get().showToast(
          `You are signed in as ${current}. Sign out first to use a link for ${user.email}.`,
        );
        return false;
      }
      const session: Session = { ...parsed, user };
      // Bind the callback to the email this app asked for. Anything on the
      // machine can open an oscode:// link, so a link for a different account
      // (login CSRF) is refused rather than silently switching accounts. The
      // binding is persisted (APP-6), so it holds across the cold start a link
      // from Mail usually is.
      const pending = await readPendingAuth();
      if (pending) {
        if (email && email !== pending) {
          get().showToast('That link is for a different account. Request a new one from here.');
          return false;
        }
        await clearPendingAuth();
        await onSignedIn(session);
        if (recovery) set({ passwordRecovery: true });
        return true;
      }
      // Nothing here asked for this link. Show who it is for and wait for a
      // yes (AuthConfirmSheet) instead of signing in on arrival.
      pendingCallback = { session, recovery };
      set({ authConfirm: { email: user.email ?? '', recovery } });
      return false;
    },

    async confirmAuthCallback() {
      const waiting = pendingCallback;
      pendingCallback = undefined;
      set({ authConfirm: undefined });
      if (!waiting) return;
      await onSignedIn(waiting.session);
      if (waiting.recovery) set({ passwordRecovery: true });
      get().showToast('Signed in.');
    },

    dismissAuthCallback() {
      pendingCallback = undefined;
      set({ authConfirm: undefined });
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
      const session = get().authSession;
      if (session) await supabaseSignOut(session.accessToken);
      await forgetSession();
      logEvent('auth_sign_out');
    },

    async refreshOrgRole() {
      const account = get().settings.account;
      try {
        const fresh = await freshAuth();
        if (!fresh) return;
        const rows = await supabaseSelect<{ role: 'admin' | 'member'; status: string }>(
          'org_members',
          fresh.accessToken,
          `select=role,status&user_id=eq.${fresh.user.id}&status=eq.active`,
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
      let session: Session | undefined;
      try {
        session = await freshAuth();
      } catch {
        // Offline: keep whatever entitlement we last knew.
        return;
      }
      if (!session) return;
      const serverId = get().settings.account?.org?.serverId;
      // Individual (Personal) entitlement: readable whenever signed in, with no
      // org. This is the path a solo Personal buyer needs; the old code gated
      // the whole method on an org serverId and so never read it.
      try {
        const rows = await supabaseSelect<{
          tier_id: string;
          status: Entitlement['status'];
          valid_until: string | null;
        }>(
          'user_entitlements',
          session.accessToken,
          `select=tier_id,status,valid_until&user_id=eq.${session.user.id}`,
        );
        const row = rows[0];
        set({
          userEntitlement: row
            ? { tierId: row.tier_id, status: row.status, validUntil: row.valid_until ?? undefined }
            : undefined,
        });
      } catch {
        // Offline or transient: keep whatever we last knew.
      }
      // Org entitlement: only when the account is a synced commercial org. Gates
      // team-seat growth (growthGatedByBilling), unchanged.
      if (!serverId) {
        set({ entitlement: undefined });
        return;
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
      }
    },

    async reconcileEntitlementOnForeground() {
      const s = get();
      if (!authConfigured() || !s.authSession) return;
      // A purchase Apple confirmed while the server was out of reach is linked
      // first, whatever the gate says (UI-10).
      if (await retryPendingAppleLink()) {
        await get().refreshEntitlement();
        set({ paywall: undefined });
        get().showToast('Your purchase is linked. Personal is unlocked.');
        return;
      }
      // Already unlocked: nothing to reconcile.
      if (s.personalUnlockedNow()) return;
      const now = Date.now();
      if (now - lastEntitlementForegroundAt < 30000) return;
      lastEntitlementForegroundAt = now;
      await get().refreshEntitlement();
      if (get().personalUnlockedNow()) {
        set({ paywall: undefined });
        get().showToast('Personal is unlocked. Welcome.');
      }
    },

    async onCheckoutReturn() {
      if (!authConfigured() || !get().authSession) return;
      await get().refreshEntitlement();
      if (get().personalUnlockedNow()) {
        set({ paywall: undefined });
        get().showToast('Personal is unlocked. Welcome.');
      } else {
        get().showToast('Payment received. Your unlock will appear shortly.');
      }
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
      // A subscribed individual OR org gets the Stripe customer portal; otherwise
      // the web purchase page. An individual Personal sub (userEntitlement, no
      // org) opens the portal with no orgId; a commercial org opens it with its
      // serverId. Either way it opens in the system browser. (An Apple-purchased
      // Personal sub is managed in iOS Settings, not here; the caller keeps this
      // off iOS.)
      const orgEntitled = !!get().entitlement && !!serverId;
      const userEntitled = !!get().userEntitlement;
      if (userEntitled || orgEntitled) {
        try {
          const { url } = await supabaseInvoke<{ url: string }>(
            'stripe-portal',
            session.accessToken,
            orgEntitled ? { orgId: serverId } : {},
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
      const prompt = [
        `Launch my ${target.platform} app with Codemagic, from branch ${target.branch}.`,
        'Trigger a build and watch it. If it fails, read the log, find the single root cause, and tell me the exact fix.',
        'You can retry directly for a transient failure or a build-target change. For a code fix, tell me exactly what to change (I can apply it, or hand it to my desktop), then build again once I confirm.',
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

    async disconnectRepoPlatform(id) {
      // Clear both credential shapes: the pasted token and any OAuth tokens and
      // their bookkeeping, so remove is total whichever way it was connected.
      // The action id is a plain string; a non-repo id no-ops in both stores.
      await disconnectRepoOAuth(id as RepoPlatform);
      await secretDelete(repoSecretKey(id));
      // The cached repo list came from this token; it leaves with it (APP-12).
      if (id === 'github') await clearRepoCache();
      set((s) => ({ connectedRepoPlatforms: { ...s.connectedRepoPlatforms, [id]: false } }));
      logEvent('repo_platform_disconnected', { platform: id });
    },

    async setHomeRepo(home) {
      // The home repo is a shared, admin-owned location (like the stack).
      if (!isOrgAdmin(get().settings.account)) {
        get().showToast('Only an admin sets the home repo.');
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
        get().showToast('Connect your desktop to sync your buffered work.');
        return;
      }
      if (!home?.homePath) {
        get().showToast('Set the home repo path first, in Repositories.');
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
      const id = `a${Date.now().toString(36)}${(convSeq++).toString(36)}`;
      const agent: CrewAgent = { ...input, id, createdAt: new Date().toISOString() };
      const crew = [...(get().settings.crew ?? []), agent];
      await get().saveSettings({ crew });
      logEvent('crew_create', { activityLevel: input.activityLevel });
      return id;
    },

    async updateCrewAgent(id, patch) {
      const crew = (get().settings.crew ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a));
      await get().saveSettings({ crew });
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
              ? `${Math.round((completed / total) * 100)}% of ${(total / 1e9).toFixed(1)} GB`
              : 'Downloading',
            indeterminate: !total,
          },
        });
      });
      try {
        await Llama.downloadModel({ id: HARBOR_MINI_MODEL_ID, url: HARBOR_MINI_MODEL_URL });
        set({ harborMiniDownload: { percent: 100, label: 'Verifying', indeterminate: true } });
        await get().saveSettings({ harborMiniReady: true });
        logEvent('harbor_mini_ready');
        // Make Harbor Light the Reasoning anchor when the stack has none or its
        // anchor is a guide that is not on the device, so My Stack chat works
        // right away. Never demotes a ready Harbor.
        const miniProfile = activeProfile(get().connectivity, get().settings.profileOverride);
        const miniTarget = reasoningPromotion(
          stackForProfile(get().settings.stacks, miniProfile),
          harborRef(),
          {
            harborReady: Boolean(get().settings.harborReady),
            harborMiniReady: true,
            preferred: false,
          },
        );
        if (miniTarget) await get().setReasoning(miniTarget, miniProfile);
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
              ? `${Math.round((completed / total) * 100)}% of ${(total / 1e9).toFixed(1)} GB`
              : 'Downloading',
            indeterminate: !total,
          },
        });
      });
      try {
        await Llama.downloadModel({ id: HARBOR_MODEL_ID, url: HARBOR_MODEL_URL });
        set({ harborDownload: { percent: 100, label: 'Verifying', indeterminate: true } });
        await get().saveSettings({ harborReady: true });
        logEvent('harbor_ready');
        // Make Harbor the Reasoning anchor when the stack has none, its anchor
        // is a guide not on the device, or the anchor is Harbor Light (Harbor is
        // the preferred pick). So My Stack chat works right away. Never
        // overrides a cloud, BYOM, or user-chosen device model.
        const harborProfile = activeProfile(get().connectivity, get().settings.profileOverride);
        const harborTarget = reasoningPromotion(
          stackForProfile(get().settings.stacks, harborProfile),
          harborFullRef(),
          {
            harborReady: true,
            harborMiniReady: Boolean(get().settings.harborMiniReady),
            preferred: true,
          },
        );
        if (harborTarget) await get().setReasoning(harborTarget, harborProfile);
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
      // present (Harbor Light is bundled, so it always is), so "My Stack" chat
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

    beginHarborMiniWithIntro() {
      logEvent('library_intro_open', { model: HARBOR_MINI_MODEL_ID });
      // Kick the download in the background, then walk the Library intro over
      // the marketplace. ensureHarborMini manages harborMiniDownload / harborMiniReady.
      void get().ensureHarborMini();
      set({ libraryIntro: true, view: 'marketplace', viewTrail: [], drawerOpen: false });
    },

    beginHarborWithIntro() {
      logEvent('library_intro_open', { model: HARBOR_MODEL_ID });
      void get().ensureHarbor();
      set({ libraryIntro: true, view: 'marketplace', viewTrail: [], drawerOpen: false });
    },

    endLibraryIntro() {
      logEvent('library_intro_done');
      // Back to the setup page; Harbor keeps downloading in the background.
      // Leave onboarded alone so a mid-setup relaunch still lands on setup.
      set({ libraryIntro: false, view: 'onboarding' });
      void get().saveSettings({ libraryIntroSeen: true });
    },

    async startGuideChat(guideId) {
      const guide = SETUP_GUIDES[guideId];
      const s = get();
      // Whatever brain can answer here, best first: this computer's engine on
      // desktop, a connected Claude key anywhere, else Harbor Light on the phone
      // (downloaded on the spot if needed). Never a brain that cannot answer.
      let source: ConversationSource | undefined;
      if (isDesktop() && s.sourceReady({ kind: 'desktop' })) source = { kind: 'desktop' };
      else if (s.cloudKeyPresent)
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
      if (!source) {
        get().showToast('Set up a model first (Your stack), then the guide can chat with you.');
        get().setView('stack');
        return;
      }
      logEvent('guide_chat', { guide: guideId });
      const opening: ThreadItem = {
        kind: 'assistant',
        id: `${newId()}-guide`,
        text: guideOpening(guide),
        streaming: false,
      };
      await get().newConversation(source, { seedItems: [opening], title: guide.title });
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
      const st = get();
      return Boolean(
        authConfigured() && st.authSession && st.serverRole && st.settings.account?.org?.serverId,
      );
    },

    async setVaultScope(scope) {
      if (scope === get().vaultScope) return;
      if (scope === 'team' && !get().teamVaultAvailable()) return;
      set({ vaultScope: scope, vaultNote: undefined, vaultFiles: [] });
      logEvent('vault_scope', { scope });
      await get().vaultRefresh();
    },

    async vaultRefresh() {
      // The personal vault is one gitOS resource, auto-registered on first
      // open, on the Local provider. The team vault is server-side and needs no
      // local resource row. More vaults and providers arrive through the same
      // registry when their wiring lands.
      if (get().vaultScope === 'personal') {
        const resources = get().settings.gitosResources ?? [];
        if (!resources.some((r) => r.id === VAULT_RESOURCE_ID)) {
          const vault: GitosResource = {
            id: VAULT_RESOURCE_ID,
            name: 'Vault',
            kind: 'vault',
            providerId: 'local',
            createdAt: new Date().toISOString(),
          };
          await get().saveSettings({ gitosResources: [...resources, vault] });
          logEvent('vault_created');
        }
      }
      const target = vaultTarget();
      if (!target) {
        set({ vaultFiles: [], vaultError: undefined });
        return;
      }
      try {
        const files = await target.provider.list(target.resourceId);
        set({ vaultFiles: files, vaultError: undefined });
        // The list came back, so the provider is reachable: flush any drafts
        // stranded by an earlier offline write.
        await replayVaultPending(target);
      } catch {
        // Keep the last-known file list so the screen can show an offline
        // state rather than the first-run "empty vault" greeting over notes
        // that really exist.
        set({ vaultError: 'load' });
        get().showToast('Could not reach your vault storage. Showing the last loaded notes.');
      }
    },

    async vaultOpen(path) {
      const normalized = normalizeNotePath(path);
      if (!normalized) return;
      const target = vaultTarget();
      if (!target) return;
      // Resolve to an existing note case-insensitively: opening "note" when
      // "Note.md" already exists must open the existing note, not fork a second
      // divergent one (storage keys are case-sensitive, resolution is not).
      const listed = get().vaultFiles.find(
        (f) => f.path.toLowerCase() === normalized.toLowerCase(),
      );
      const openPath = listed?.path ?? normalized;
      const known = Boolean(listed);
      // UI-2: a note whose bytes are evicted from this device (iCloud's
      // placeholder) is still a note. Never open an empty editor over it,
      // which a keystroke would then save back as empty over the cloud copy.
      if (listed?.evicted) {
        get().showToast('Still downloading this note from your vault storage. Try again shortly.');
        return;
      }
      let existing;
      try {
        existing = await target.provider.read(target.resourceId, openPath);
      } catch {
        get().showToast('Could not open that note. Check your vault storage connection.');
        return;
      }
      if (!existing && known) {
        // The file is listed in the vault but its bytes are not here yet (for
        // example iCloud has not finished downloading it). Never fabricate an
        // empty note over it, which a keystroke would then save back as empty.
        get().showToast('Still downloading this note from your vault storage. Try again shortly.');
        return;
      }
      set({
        vaultNote: existing ?? { path: openPath, text: '', updatedAt: new Date().toISOString() },
      });
      logEvent('vault_note_open', { fresh: !existing });
    },

    async vaultCreate(path) {
      const normalized = normalizeNotePath(path);
      if (!normalized) return;
      const target = vaultTarget();
      if (!target) return;
      // An existing note (evicted from this device or not, UI-2) opens; it is
      // never overwritten with an empty body.
      const existing = get().vaultFiles.find(
        (f) => f.path.toLowerCase() === normalized.toLowerCase(),
      );
      if (existing) {
        await get().vaultOpen(existing.path);
        return;
      }
      try {
        const saved = await target.provider.write(target.resourceId, normalized, '');
        set({
          vaultFiles: await target.provider.list(target.resourceId),
          vaultNote: {
            path: normalized,
            text: saved.text,
            updatedAt: saved.updatedAt,
            fresh: true,
          },
          vaultError: undefined,
        });
        logEvent('vault_note_create');
      } catch {
        // Offline: still open the editor so the user can write, and stash the
        // empty note so the create is not lost.
        await stashVaultDraft(target.resourceId, normalized, '');
        set({
          vaultNote: {
            path: normalized,
            text: '',
            updatedAt: new Date().toISOString(),
            fresh: true,
          },
          vaultError: 'save',
        });
        get().showToast('Working offline. This note saves when your storage reconnects.');
      }
    },

    vaultCloseNote() {
      set({ vaultNote: undefined });
    },

    async vaultSave(path, text) {
      const target = vaultTarget();
      if (!target) return;
      try {
        const saved = await target.provider.write(target.resourceId, path, text);
        // Keep the body cache current so the next backlink pass does not re-read
        // the note we just wrote.
        vaultBodyCache.set(`${target.resourceId}::${saved.path}`, {
          updatedAt: saved.updatedAt,
          text: saved.text,
        });
        set({
          vaultFiles: await target.provider.list(target.resourceId),
          vaultNote:
            get().vaultNote?.path === path
              ? { path, text: saved.text, updatedAt: saved.updatedAt }
              : get().vaultNote,
          vaultError: undefined,
        });
        // A successful write means the provider is back; flush the backlog.
        await replayVaultPending(target);
        logEvent('vault_note_save');
      } catch {
        // Never drop typed text on a failed write. Stash it durably and tell
        // the user; it replays on the next successful write or list.
        await stashVaultDraft(target.resourceId, path, text);
        set({ vaultError: 'save' });
        get().showToast(
          'Could not save to your vault. Your text is kept and saves when the connection returns.',
        );
        logEvent('vault_note_save_failed');
      }
    },

    async vaultDelete(path) {
      const target = vaultTarget();
      if (!target) return;
      try {
        await target.provider.remove(target.resourceId, path);
        vaultBodyCache.delete(`${target.resourceId}::${path}`);
        // Drop any stashed draft for a note the user just deleted, so it cannot
        // resurrect on the next replay.
        const pending = await loadVaultPending();
        if (pending[`${target.resourceId}::${path}`]) {
          delete pending[`${target.resourceId}::${path}`];
          await saveVaultPending(pending);
        }
        set({
          vaultFiles: await target.provider.list(target.resourceId),
          vaultNote: get().vaultNote?.path === path ? undefined : get().vaultNote,
          vaultError: undefined,
        });
        logEvent('vault_note_delete');
      } catch {
        set({ vaultError: 'save' });
        get().showToast('Could not delete that note. Check your vault storage connection.');
      }
    },

    async vaultReadAll() {
      const target = vaultTarget();
      if (!target) return [];
      const files = await target.provider.list(target.resourceId);
      // Read only the files that changed since we last saw them. Backlinks
      // re-run this on every note open, so without a cache a 300-note Drive
      // vault was 300+ serial reads per open (R-8). The cache key carries the
      // resource id and the read is skipped when the file's updatedAt matches.
      const out: Array<{ path: string; text: string }> = [];
      for (const f of files) {
        const key = `${target.resourceId}::${f.path}`;
        const cached = vaultBodyCache.get(key);
        if (cached && cached.updatedAt === f.updatedAt) {
          out.push({ path: f.path, text: cached.text });
          continue;
        }
        const note = await target.provider.read(target.resourceId, f.path);
        if (note) {
          vaultBodyCache.set(key, { updatedAt: note.updatedAt, text: note.text });
          out.push({ path: note.path, text: note.text });
        }
      }
      return out;
    },

    async vaultAcquireLease() {
      // Only the personal vault leases; the team vault's server resolves
      // concurrency, so acquiring there is unnecessary.
      if (get().vaultScope !== 'personal') {
        set({ vaultLeaseHeldByOther: false });
        return;
      }
      const target = vaultTarget();
      if (!target) return;
      const deviceId = get().settings.deviceId ?? 'dev_unknown';
      try {
        const lease = await target.provider.acquireLease(target.resourceId, deviceId, 90_000);
        const heldByOther =
          lease.holder !== deviceId && new Date(lease.expiresAt).getTime() > Date.now();
        set({ vaultLeaseHeldByOther: heldByOther });
      } catch {
        // A lease read/write failure must not block editing; leave state as is.
      }
    },

    async vaultReleaseLease() {
      if (get().vaultScope !== 'personal') return;
      const target = vaultTarget();
      const deviceId = get().settings.deviceId ?? 'dev_unknown';
      if (target) {
        try {
          await target.provider.releaseLease(target.resourceId, deviceId);
        } catch {
          // Best-effort; the lease's TTL reclaims it regardless.
        }
      }
      set({ vaultLeaseHeldByOther: false });
    },

    async vaultMoveTo(providerId) {
      // Moving is about where the PERSONAL vault's bytes live. The team vault is
      // a separate shared resource, never a move target, so reject it outright
      // and read the source through the personal provider (not the active
      // scope's), so a move initiated while viewing the team vault is still safe.
      if (providerId === 'org') return false;
      const from = vaultProviderId(get().settings);
      if (providerId === from) return true;
      const target = providerFor(providerId);
      const source = providerFor(from);
      if (!target || !source || !(await probeReady(providerId))) return false;
      // Copy every note across before repointing, so a mid-move failure leaves
      // the source vault intact. The source bytes are left in place as a
      // safety copy; a later cleanup pass can reclaim them.
      const files = await source.list(VAULT_RESOURCE_ID);
      const notes: Array<{ path: string; text: string }> = [];
      for (const f of files) {
        const note = await source.read(VAULT_RESOURCE_ID, f.path);
        if (note) notes.push({ path: note.path, text: note.text });
      }
      for (const note of notes) {
        // Do not blindly overwrite a note already at the target path: another
        // device may have written a newer version there. When the target's copy
        // is newer, land the source copy under a conflict name instead, so the
        // move cannot regress newer work (COR-9).
        const targetMeta = await target.stat(VAULT_RESOURCE_ID, note.path).catch(() => undefined);
        const sourceMeta = files.find((f) => f.path === note.path);
        const targetIsNewer =
          targetMeta && sourceMeta ? targetMeta.updatedAt > sourceMeta.updatedAt : false;
        if (targetIsNewer) {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const dot = note.path.lastIndexOf('.');
          const base = dot === -1 ? note.path : note.path.slice(0, dot);
          const ext = dot === -1 ? '' : note.path.slice(dot);
          await target.write(VAULT_RESOURCE_ID, `${base} (from ${from} ${stamp})${ext}`, note.text);
        } else {
          await target.write(VAULT_RESOURCE_ID, note.path, note.text);
        }
      }
      const resources = (get().settings.gitosResources ?? []).map((r) =>
        r.id === VAULT_RESOURCE_ID ? { ...r, providerId } : r,
      );
      await get().saveSettings({ gitosResources: resources });
      set({ vaultFiles: await target.list(VAULT_RESOURCE_ID) });
      logEvent('vault_moved', { to: providerId });
      return true;
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
      if (!drivers.has(id)) {
        // Reattach lazily. Desktop threads replay their journal into the UI, so
        // they reset the thread and rebuild from the daemon with no seed. Chat
        // brains (device/cloud/stack) live only in a module-level driver map
        // that is empty after a reload, so a reopened chat MUST reseed the new
        // driver from the persisted transcript, or the model has no memory of a
        // conversation the user is looking at in full.
        if (conv.source.kind === 'desktop') {
          set((s) => ({
            resumingId: id,
            conversations: {
              ...s.conversations,
              [id]: { ...s.conversations[id]!, thread: emptyThread() },
            },
          }));
          void buildDriver(conv)
            .then((driver) => attachDriver(id, driver))
            .catch((err) => get().showToast(err instanceof Error ? err.message : String(err)))
            .finally(() => {
              if (get().resumingId === id) set({ resumingId: undefined });
            });
        } else {
          const seed = seedFromTranscript(conv.thread.items);
          void buildDriver(conv, seed)
            .then((driver) => attachDriver(id, driver))
            .catch((err) => get().showToast(err instanceof Error ? err.message : String(err)));
        }
      }
    },

    deleteConversation(id) {
      dropDriver(id);
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
    },

    send(text, attachments) {
      const { activeId } = get();
      if (!activeId) return;
      const driver = drivers.get(activeId);
      if (!driver) {
        get().showToast('This chat is not connected yet. Give it a second, or reopen it.');
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
      driver.send(text, attachments);
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
      // hand-off Claude Code makes when a plan is accepted.
      void get().setPermissionMode('acceptEdits');
      get().send('The plan is approved. Proceed with it.');
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

    async setPermissionMode(mode) {
      await get().saveSettings({ permissionMode: mode });
      const { activeId } = get();
      if (activeId) drivers.get(activeId)?.setMode?.(mode);
    },

    async setConversationRepos(id, repoIds) {
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
        get().showToast('Compaction is for a desktop repo session.');
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
      await get().newConversation(
        { kind: 'desktop', sessionId: info.id, cwd: info.cwd, repoName },
        { title: info.title && !/^Session /.test(info.title) ? info.title : undefined },
      );
      if (backRoom) set({ viewTrail: [backRoom] });
    },

    runCommand(command) {
      const { activeId } = get();
      if (!activeId) return;
      const driver = drivers.get(activeId);
      if (!driver?.runCommand) {
        get().showToast('This chat has no terminal. Open a desktop repo to run commands.');
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
        if (!runId) get().showToast('Could not reach the desktop to run that. Try again.');
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

    async saveHub(target, opts) {
      const list = hubList(get().settings);
      const prior = list.find((d) => d.baseUrl === target.baseUrl);
      // Keep a name already on file if this save did not carry one.
      const merged: DaemonTarget = { ...target, name: target.name ?? prior?.name };
      const others = list.filter((d) => d.baseUrl !== target.baseUrl);
      // The credential goes to the secret store (APP-11); the settings blob
      // carries the hub without it (see persistSettings).
      await secretSet(hubSecretKey(target.baseUrl), target.token);
      // The hub's role for this credential: what pairing reported, else asked
      // now. An older hub answers nothing and keeps deciding per request.
      const role = opts?.role ?? (await readHubRole(merged));
      const hubRoles = { ...(get().settings.hubRoles ?? {}) };
      if (role) hubRoles[target.baseUrl] = role;
      else delete hubRoles[target.baseUrl];
      await get().saveSettings({ daemon: merged, daemons: [...others, merged], hubRoles });
    },

    async setHubRole(baseUrl, role) {
      const hubRoles = { ...(get().settings.hubRoles ?? {}) };
      if (role) hubRoles[baseUrl] = role;
      else delete hubRoles[baseUrl];
      await get().saveSettings({ hubRoles });
    },

    async selectHub(baseUrl) {
      const hub = hubList(get().settings).find((d) => d.baseUrl === baseUrl);
      if (hub) await get().saveSettings({ daemon: hub });
    },

    async removeHub(baseUrl) {
      const s = get().settings;
      const daemons = hubList(s).filter((d) => d.baseUrl !== baseUrl);
      const daemon = s.daemon?.baseUrl === baseUrl ? daemons[0] : s.daemon;
      const hubRoles = { ...(s.hubRoles ?? {}) };
      delete hubRoles[baseUrl];
      await get().saveSettings({ daemons, daemon, hubRoles });
      // The credential leaves with the hub.
      await secretDelete(hubSecretKey(baseUrl));
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
      const settings = { ...get().settings, ...patch };
      set({ settings, hubRole: activeHubRole(settings) });
      setInsightsEnabled(settings.insightsOptIn ?? false);
      setActiveEffort(settings.effort ?? DEFAULT_EFFORT);
      await persistSettings(settings);
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
      set({ cloudKeyPresent: true });
      logEvent('cloud_key_added');
    },

    async clearCloudKey() {
      await secretDelete(ANTHROPIC_KEY_KEY);
      set({ cloudKeyPresent: false });
    },

    async connectProvider(id, key, workspaceId) {
      await secretSet(providerSecretKey(id), key.trim());
      set((s) => ({
        connectedProviders: { ...s.connectedProviders, [id]: true },
        cloudKeyPresent: id === 'anthropic' ? true : s.cloudKeyPresent,
        justConnected: id,
      }));
      if (id === 'anthropic') {
        await get().saveSettings({ anthropicWorkspaceId: workspaceId?.trim() || undefined });
        // On the desktop the engine holds its own copy of the key (its
        // credential store), so a connection here reaches the coding agent too.
        void bridge()?.setAnthropicKey(key.trim(), workspaceId?.trim() || undefined);
      }
      logEvent('provider_connected', { provider: id });
    },

    async disconnectProvider(id) {
      await secretDelete(providerSecretKey(id));
      set((s) => ({
        connectedProviders: { ...s.connectedProviders, [id]: false },
        cloudKeyPresent: id === 'anthropic' ? false : s.cloudKeyPresent,
      }));
      if (id === 'anthropic') {
        await get().saveSettings({ anthropicWorkspaceId: undefined });
        void bridge()?.disconnect('anthropic');
      }
      logEvent('provider_disconnected', { provider: id });
    },

    async connectByom(input) {
      const id = `byom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const conn: ByomConnection = {
        id,
        label: input.label.trim(),
        baseUrl: input.baseUrl,
        model: input.model.trim(),
      };
      // The key is optional: a self-hosted server may accept unauthenticated
      // requests. Store one only when given, so byomSecretKey stays absent for
      // keyless endpoints.
      if (input.apiKey && input.apiKey.trim()) {
        await secretSet(byomSecretKey(id), input.apiKey.trim());
      }
      const byomModels = [...(get().settings.byomModels ?? []), conn];
      await get().saveSettings({ byomModels });
      logEvent('byom_connected');
      return conn;
    },

    async disconnectByom(id) {
      await secretDelete(byomSecretKey(id));
      const settings = get().settings;
      const byomModels = (settings.byomModels ?? []).filter((c) => c.id !== id);
      const key = `byom:${id}`;
      // Pull it out of EVERY status's stack: a disconnected endpoint must not
      // linger in any profile. Drop it from the active specialists and the
      // saved-placement map, and if it was a Reasoning anchor fall back to the
      // built-in guide so no status is left with a dangling anchor.
      const stacks: ProfileStacks = { ...settings.stacks };
      for (const p of PROFILE_ORDER) {
        const st = stacks[p];
        if (!st) continue;
        const active = st.active.filter((m) => stackRefKey(m.ref) !== key);
        const saved = { ...st.saved };
        delete saved[key];
        const reasoning =
          st.reasoning && stackRefKey(st.reasoning) === key ? harborRef() : st.reasoning;
        stacks[p] = { ...st, active, saved, reasoning };
      }
      await get().saveSettings({ byomModels, stacks });
      logEvent('byom_disconnected');
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

async function persistConversations(state: Pick<AppState, 'order' | 'conversations'>) {
  const conversations: Record<string, Conversation> = {};
  // The disk order is bounded so a very long history cannot grow storage
  // without limit; 200 is generous headroom over the ~50 a session accrues.
  const savedOrder = state.order.slice(0, 200);
  for (const id of savedOrder) {
    const conv = state.conversations[id];
    if (!conv) continue;
    conversations[id] = {
      ...conv,
      // Desktop threads live in the engine journal; store metadata only.
      thread: conv.source.kind === 'desktop' ? emptyThread() : trimThread(conv.thread),
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
