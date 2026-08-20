// The app store (zustand): conversations, navigation, settings, toasts.
// Drivers live OUTSIDE React state (they hold sockets and native handles);
// the store holds only renderable data. Desktop-backed conversations rebuild
// their transcript by replaying the engine's journal, so the phone and the
// desktop can both close and reopen with nothing lost.
import { create } from 'zustand';
import type { DriverEvent } from 'os-code/protocol';
import {
  emptyThread,
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
  type RepoState,
} from '../lib/repos.js';
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
  rpc as supabaseRpc,
  select as supabaseSelect,
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
import { clearSession, freshSession, loadStoredSession, saveSession } from '../lib/authSession.js';
import {
  autoProfile,
  effectiveProfile,
  type Connectivity,
  type ProfileId,
} from '../lib/profiles.js';
import { PROVIDERS, providerSecretKey } from '../lib/providers.js';
import { CloudClaudeDriver, DEFAULT_CLAUDE_MODEL } from '../drivers/cloudClaudeDriver.js';
import { OnDeviceDriver } from '../drivers/onDeviceDriver.js';
import { MockDriver } from '../drivers/mockDriver.js';
import { StackDriver } from '../drivers/stackDriver.js';
import {
  HARBOR_GREETING,
  HARBOR_MODEL_ID,
  HARBOR_MODEL_NAME,
  HARBOR_MODEL_URL,
} from '../lib/harbor.js';
import { loadInsights, logEvent, logOnce, setInsightsEnabled } from '../lib/insights.js';
import {
  emptyStack,
  refKey as stackRefKey,
  type AppStack,
  type Placement,
  type StackModelRef,
} from '../lib/stack.js';
import { bridge } from '../lib/electronBridge.js';
import { Llama } from '../lib/llamaPlugin.js';
import {
  isDesktop,
  openExternal,
  platform,
  sealExistingKeys,
  secretDelete,
  secretGet,
  secretSet,
  storeGetJson,
  storeSetJson,
} from '../lib/platform.js';

export type ViewName =
  | 'chat'
  | 'marketplace'
  | 'stack'
  | 'stackhealth'
  | 'connections'
  | 'repos'
  | 'projects'
  | 'crew'
  | 'admin'
  | 'launch'
  | 'pair'
  | 'settings'
  | 'onboarding';

export interface AppSettings {
  onboarded: boolean;
  daemon?: DaemonTarget;
  claudeModel: string;
  /** Downloaded on-device models: catalog id -> friendly name. */
  deviceModels: Record<string, string>;
  /** Whether the built-in guide (Harbor) has been downloaded to this device. */
  harborReady?: boolean;
  /** Whether the Marketplace intro walkthrough has been shown. */
  libraryIntroSeen?: boolean;
  /** The user's stack: Reasoning LLM anchor, active specialists, bench metadata. */
  stack?: AppStack;
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
}

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

// Drivers are module state, keyed by conversation id.
const drivers = new Map<string, ChatDriver>();
const unsubscribers = new Map<string, () => void>();

export function driverFor(conversationId: string): ChatDriver | undefined {
  return drivers.get(conversationId);
}

interface AppState {
  ready: boolean;
  view: ViewName;
  drawerOpen: boolean;
  conversations: Record<string, Conversation>;
  order: string[];
  activeId?: string;
  settings: AppSettings;
  /** Phone-side Claude key presence (the key itself never sits in state). */
  cloudKeyPresent: boolean;
  /** Which cloud providers are connected (keys live in the Keychain). */
  connectedProviders: Record<string, boolean>;
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
  /** The org's billing entitlement (Stripe webhook is the writer), when known. */
  entitlement?: Entitlement;
  /** Live progress while Harbor downloads for the first time. */
  harborDownload?: HarborDownload;
  /** When true, the Marketplace intro walkthrough is showing over the library. */
  libraryIntro?: boolean;
  /** Live reach signals that drive the active connectivity profile. */
  connectivity: Connectivity;
  toast?: string;

  init(): Promise<void>;
  setView(view: ViewName): void;
  setDrawer(open: boolean): void;
  showToast(message: string): void;

  newConversation(source: ConversationSource, opts?: { ephemeral?: boolean }): Promise<string>;
  /** Open a fresh, empty chat (the source picker decides who answers). A
   *  project is auto-created on first save, so this never dead-ends. */
  startNewChat(): void;
  /** A throwaway chat with the stack for a quick lookup. Not saved. */
  quickChat(): Promise<string>;
  /** Send text once the active conversation's driver has attached. */
  sendWhenAttached(conversationId: string, text: string): void;
  /** Create a project and make it active. */
  createProject(name: string): Promise<string>;
  setActiveProject(id: string): void;
  updateProject(
    id: string,
    patch: Partial<Pick<Project, 'name' | 'instructions' | 'repoIds'>>,
  ): Promise<void>;
  /** Remove a project; its chats stay but drop back to no project. */
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
  /** Finish a magic-link sign-in from the callback URL the app was opened with. */
  completeAuthCallback(url: string): Promise<boolean>;
  /** Sign out and forget the session. */
  signOutAccount(): Promise<void>;
  /** Re-read the signed-in user's server role into serverRole. */
  refreshOrgRole(): Promise<void>;
  /** Re-read the org's billing entitlement from the server. */
  refreshEntitlement(): Promise<void>;
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

  // Repositories.
  /** Connect a repo platform (GitHub, etc.) by token, stored in the Keychain. */
  connectRepoPlatform(id: string, token: string): Promise<void>;
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
  /** Download the Harbor guide model if it is not here yet. Returns success. */
  ensureHarbor(): Promise<boolean>;
  /** Cancel an in-progress Harbor download (returning users can skip it). */
  cancelHarbor(): void;
  /** First-run: start Harbor's download and open the LLM Library intro. */
  beginHarborWithIntro(): void;
  /** Close the Library intro and return to setup; download keeps going. */
  endLibraryIntro(): void;
  /** Open a fresh chat with Harbor, downloading it first if needed. */
  startGuide(): Promise<string | undefined>;
  openConversation(id: string): void;
  deleteConversation(id: string): void;
  send(text: string): void;
  abort(): void;
  answerApproval(approvalId: string, approve: boolean, always?: boolean): void;

  saveSettings(patch: Partial<AppSettings>): Promise<void>;
  setCloudKey(key: string): Promise<void>;
  clearCloudKey(): Promise<void>;
  /** Connect a cloud provider by API key (Keychain), surfacing its models. */
  connectProvider(id: string, key: string): Promise<void>;
  /** Disconnect a cloud provider and forget its key. */
  disconnectProvider(id: string): Promise<void>;

  /** Re-check home reachability + internet, updating the connectivity signals. */
  refreshConnectivity(): Promise<void>;
  /** Manually step down to a more restrictive profile, or clear (auto). */
  setProfileOverride(profile?: ProfileId): Promise<void>;

  // Stack management (the app-side Reasoning LLM + specialists + bench).
  /** Set the Reasoning LLM anchor (from the bench or a cloud model). */
  setReasoning(ref: StackModelRef): Promise<void>;
  /** Move a bench model into the active stack under a category placement. */
  placeSpecialist(ref: StackModelRef, placement: Placement): Promise<void>;
  /** Move an active specialist back to the bench, keeping its metadata. */
  benchSpecialist(key: string): Promise<void>;
  /** Edit a model's category / trigger / persona, active or benched. */
  editPlacement(key: string, placement: Placement): Promise<void>;
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

/** The signed-in member's role in a commercial org, if any. */
export function selfMember(account?: Account): OrgMember | undefined {
  if (!account || account.type !== 'commercial') return undefined;
  return account.org?.members.find((m) => m.email === account.selfEmail);
}

export const useApp = create<AppState>((set, get) => {
  function attachDriver(conversationId: string, driver: ChatDriver): void {
    drivers.get(conversationId)?.dispose();
    unsubscribers.get(conversationId)?.();
    drivers.set(conversationId, driver);
    const off = driver.subscribe((event: DriverEvent, seq: number) => {
      set((state) => {
        const conv = state.conversations[conversationId];
        if (!conv) return state;
        const thread = reduceEvent(conv.thread, event, seq);
        const title = conv.title === 'New chat' ? (titleFrom(thread) ?? conv.title) : conv.title;
        const next: Conversation = {
          ...conv,
          thread,
          title,
          updatedAt: new Date().toISOString(),
        };
        return { conversations: { ...state.conversations, [conversationId]: next } };
      });
      // Persist quiet-moment snapshots for phone-local conversations.
      if (event.type === 'task-done') void persistConversations(get());
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
    });
    unsubscribers.set(conversationId, off);
  }

  async function buildDriver(conv: Conversation): Promise<ChatDriver> {
    const { settings } = get();
    switch (conv.source.kind) {
      case 'desktop': {
        if (isDesktop() && bridge()) {
          let sessionId = conv.source.sessionId;
          if (!sessionId) {
            const created = await bridge()!.createSession(conv.source.cwd);
            sessionId = created.id;
            conv.source.sessionId = sessionId;
          } else {
            await bridge()!.resumeSession(sessionId);
          }
          return new ElectronDriver(sessionId);
        }
        if (!settings.daemon) {
          throw new Error('Connect to your desktop first (Menu, then Desktop connection).');
        }
        let sessionId = conv.source.sessionId;
        if (!sessionId) {
          sessionId = await daemonCreateSession(settings.daemon, conv.source.cwd);
          conv.source.sessionId = sessionId;
        }
        // Replay from zero so the transcript rebuilds exactly.
        return new RemoteDriver(sessionId, settings.daemon, 0);
      }
      case 'device':
        return new OnDeviceDriver(conv.source.modelId, conv.source.modelName);
      case 'cloud': {
        const key = await secretGet(ANTHROPIC_KEY_KEY);
        if (!key) throw new Error('Add your Claude API key under Connections first.');
        return new CloudClaudeDriver(key, conv.source.model);
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
        return new StackDriver(s.settings.stack ?? emptyStack(), profile, {
          projectName: project?.name,
          projectInstructions: project?.instructions,
          crew,
        });
      }
      case 'mock':
        return new MockDriver();
    }
  }

  // Quick (ephemeral) chats are never persisted and must not pile up in memory.
  // Drop every ephemeral conversation except the one we are keeping (if any).
  function pruneEphemeral(exceptId?: string): void {
    const { conversations, order } = get();
    const stale = order.filter((id) => conversations[id]?.ephemeral && id !== exceptId);
    for (const id of stale) get().deleteConversation(id);
  }

  // Where a magic-link sign-in returns to. Each shell has its own origin the
  // token must land on (Uki's "auth callbacks stay on the app's own origin").
  function authRedirectTo(): string {
    switch (platform()) {
      case 'ios':
        return 'oscode://auth-callback';
      case 'electron':
        return 'http://127.0.0.1:4817/auth-callback';
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
  // find their active membership, then read the org and its roster.
  async function pullOrgFromServer(session: Session): Promise<Org | undefined> {
    const mine = await supabaseSelect<{ org_id: string }>(
      'org_members',
      session.accessToken,
      `select=org_id&user_id=eq.${session.user.id}&status=eq.active&limit=1`,
    );
    const orgId = mine[0]?.org_id;
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
    return serverToLocalOrg(srv, members, new Date().toISOString());
  }

  // Make the org multi-device: an owner who set it up locally pushes it on first
  // sign-in; everyone else (second device, or an invited member) pulls the
  // server's copy so the roster and role match everywhere.
  async function reconcileOrg(session: Session): Promise<void> {
    if (!authConfigured()) return;
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
      if (pulled) {
        await get().saveSettings({
          account: { type: 'commercial', org: pulled, selfEmail: session.user.email },
        });
      }
    } catch {
      // Offline or transient: keep the local org as-is.
    }
  }

  // Best-effort write-through for an admin edit. No-ops (staying local-only)
  // until the org has been synced to the server and someone is signed in.
  async function orgWrite(
    fn: (session: Session, serverOrgId: string) => Promise<void>,
  ): Promise<void> {
    const session = get().authSession;
    const serverId = get().settings.account?.org?.serverId;
    if (!session || !serverId || !authConfigured()) return;
    try {
      const fresh = await freshSession(session);
      if (fresh !== session) set({ authSession: fresh });
      await fn(fresh, serverId);
    } catch (err) {
      get().showToast(err instanceof Error ? err.message : 'Could not sync to your account.');
    }
  }

  // verified email, claim any invited org seat, and read the server role.
  async function onSignedIn(session: Session): Promise<void> {
    await saveSession(session);
    set({ authSession: session });
    const account = get().settings.account;
    if (account && session.user.email && account.selfEmail !== session.user.email) {
      await get().saveSettings({ account: { ...account, selfEmail: session.user.email } });
    }
    try {
      await supabaseRpc('claim_membership', session.accessToken);
    } catch {
      // No invited seat, or offline: role stays whatever the server says next.
    }
    await reconcileOrg(session);
    await get().refreshOrgRole();
    void get().refreshEntitlement();
    logEvent('auth_sign_in');
  }

  return {
    ready: false,
    view: 'chat',
    drawerOpen: false,
    conversations: {},
    order: [],
    settings: { onboarded: false, claudeModel: DEFAULT_CLAUDE_MODEL, deviceModels: {} },
    cloudKeyPresent: false,
    connectedProviders: {},
    codemagicConnected: false,
    connectedRepoPlatforms: {},
    authConfigured: authConfigured(),
    connectivity: { homeReachable: false, online: true },

    async init() {
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
        // Ephemeral quick chats never persist; drop any that leaked in.
        if (row.ephemeral) continue;
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
          let changed = false;
          const kept = Object.fromEntries(
            Object.entries(settings.deviceModels).filter(([id]) => present.has(id)),
          );
          if (Object.keys(kept).length !== Object.keys(settings.deviceModels).length) {
            settings.deviceModels = kept;
            changed = true;
          }
          const harborHere = present.has(HARBOR_MODEL_ID);
          if (Boolean(settings.harborReady) !== harborHere) {
            settings.harborReady = harborHere;
            changed = true;
          }
          if (changed) await storeSetJson(SETTINGS_KEY, settings);
        } catch {
          // Native side unreachable: keep the labels as they are.
        }
      }
      let settingsDirty = false;

      // A stable device id, generated once, for rescue-branch names and sync.
      if (!settings.deviceId) {
        settings.deviceId = `dev_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
        settingsDirty = true;
      }

      // Bucket migration: a saved chat with no project would vanish from every
      // list once any project exists. Assign orphans to the active (or first)
      // project, creating a default if the user has none yet.
      const orphanIds = Object.keys(conversations).filter(
        (id) => !conversations[id]!.ephemeral && !conversations[id]!.projectId,
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

      if (settingsDirty) await storeSetJson(SETTINGS_KEY, settings);

      set({
        settings,
        conversations,
        order: persisted.order.filter((id) => conversations[id]),
        cloudKeyPresent,
        connectedProviders,
        codemagicConnected,
        connectedRepoPlatforms,
        ready: true,
        view: settings.onboarded ? 'chat' : 'onboarding',
      });
      logEvent('app_open', { onboarded: settings.onboarded });

      // Upgrade any pre-encryption data to sealed-at-rest, in the background.
      void sealExistingKeys([SETTINGS_KEY, CONVERSATIONS_KEY, ANTHROPIC_KEY_KEY]);

      // Finish a web sign-in, or restore a stored one. On web a magic-link or
      // email-confirmation redirect lands on our own origin with the tokens in
      // the URL hash; complete it, then strip them from the address bar so they
      // are not left in history. (Native handles its callback via the oscode://
      // deep link in useAuthDeepLink.) Otherwise restore the last session.
      if (authConfigured()) {
        void (async () => {
          const href = typeof window !== 'undefined' ? window.location.href : '';
          const hasCallback = platform() === 'web' && /access_token=|auth-callback/.test(href);
          if (hasCallback && (await get().completeAuthCallback(href))) {
            get().showToast('Signed in.');
            window.history.replaceState(null, document.title, window.location.pathname);
            return;
          }
          const stored = await loadStoredSession();
          if (stored) {
            set({ authSession: stored });
            await reconcileOrg(stored);
            await get().refreshOrgRole();
            void get().refreshEntitlement();
          }
        })();
      }

      // Watch the connection so the profile status is always live.
      void get().refreshConnectivity();
      if (typeof window !== 'undefined') {
        window.addEventListener('online', () => void get().refreshConnectivity());
        window.addEventListener('offline', () => void get().refreshConnectivity());
        setInterval(() => void get().refreshConnectivity(), 20000);
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

    async setProfileOverride(profile) {
      await get().saveSettings({ profileOverride: profile });
      logEvent('profile_override', { profile: profile ?? 'auto' });
    },

    setView(view) {
      set({ view, drawerOpen: false });
    },

    setDrawer(open) {
      set({ drawerOpen: open });
    },

    showToast(message) {
      set({ toast: message });
      setTimeout(() => set((s) => (s.toast === message ? { toast: undefined } : s)), 3200);
    },

    async newConversation(source, opts) {
      logEvent('source_chosen', { kind: source.kind });
      const id = newId();
      const ephemeral = opts?.ephemeral ?? false;
      // Saved chats belong to the active project (or the first one). If none
      // exists yet, make a default so a saved chat is never orphaned from every
      // bucket. Quick chats stay project-less on purpose.
      const s0 = get().settings;
      let projectId = ephemeral ? undefined : (s0.activeProjectId ?? s0.projects?.[0]?.id);
      if (!ephemeral && !projectId) projectId = await get().createProject('My work');
      const conv: Conversation = {
        id,
        title: 'New chat',
        source,
        projectId,
        ephemeral,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        thread: emptyThread(),
      };
      set((s) => ({
        conversations: { ...s.conversations, [id]: conv },
        order: [id, ...s.order],
        activeId: id,
        view: 'chat',
        drawerOpen: false,
      }));
      // Any earlier quick chat is now off-screen; do not let it linger.
      pruneEphemeral(id);
      try {
        const driver = await buildDriver(conv);
        attachDriver(id, driver);
      } catch (err) {
        get().showToast(err instanceof Error ? err.message : String(err));
      }
      void persistConversations(get());
      return id;
    },

    startNewChat() {
      // Any lingering quick chat goes; the greeting + source picker take over.
      pruneEphemeral();
      set({ activeId: undefined, view: 'chat', drawerOpen: false });
    },

    async quickChat() {
      logEvent('quick_chat');
      return get().newConversation({ kind: 'stack' }, { ephemeral: true });
    },

    sendWhenAttached(conversationId, text) {
      // Drivers attach asynchronously after a conversation is created. Poll
      // briefly for this one, then deliver, instead of guessing a fixed delay.
      let tries = 0;
      const trySend = () => {
        const driver = drivers.get(conversationId);
        if (driver) {
          driver.send(text);
          return;
        }
        if (tries++ > 100) {
          get().showToast('This chat did not connect. Try sending again.');
          return;
        }
        setTimeout(trySend, 50);
      };
      trySend();
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

    async updateProject(id, patch) {
      const projects = (get().settings.projects ?? []).map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      );
      await get().saveSettings({ projects });
    },

    async deleteProject(id) {
      const projects = (get().settings.projects ?? []).filter((p) => p.id !== id);
      const activeProjectId =
        get().settings.activeProjectId === id ? undefined : get().settings.activeProjectId;
      await get().saveSettings({ projects, activeProjectId });
      // Chats that lived in the project stay, but drop their now-dead link.
      set((s) => {
        const conversations = { ...s.conversations };
        let touched = false;
        for (const [cid, conv] of Object.entries(conversations)) {
          if (conv.projectId === id) {
            conversations[cid] = { ...conv, projectId: undefined };
            touched = true;
          }
        }
        return touched ? { conversations } : s;
      });
      void persistConversations(get());
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
      const session = get().authSession;
      if (session) await reconcileOrg(session);
    },

    async setSeatCount(seatCount) {
      const account = get().settings.account;
      if (!account?.org || !isOrgAdmin(account)) return;
      const seats = Math.max(1, Math.floor(seatCount));
      const tier = tierForSeats(seats);
      const org: Org = {
        ...account.org,
        seatCount: seats,
        tierId: tier.id,
        priceYear: tier.priceYear,
      };
      await get().saveSettings({ account: { ...account, org } });
      logEvent('org_seats_set', { tier: tier.id });
      void orgWrite((s, orgId) =>
        supabaseUpdate('orgs', s.accessToken, `id=eq.${orgId}`, {
          seat_count: seats,
          tier_id: tier.id,
          price_year: tier.priceYear,
        }).then(() => undefined),
      );
    },

    async addMember(email, displayName) {
      const account = get().settings.account;
      if (!account?.org || !isOrgAdmin(account)) return;
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
      const session = await supabaseSignUp(email.trim(), password);
      if (session) {
        await onSignedIn(session);
        return { needsConfirmation: false };
      }
      return { needsConfirmation: true };
    },

    async sendMagicLink(email) {
      await signInWithOtp(email.trim(), authRedirectTo());
    },

    async completeAuthCallback(url) {
      const parsed = parseAuthCallback(url);
      if (!parsed) return false;
      // Fill the user id/email the callback URL does not carry.
      const user = await getUser(parsed.accessToken);
      const session: Session = { ...parsed, user: user ?? parsed.user };
      await onSignedIn(session);
      return true;
    },

    async signOutAccount() {
      const session = get().authSession;
      if (session) await supabaseSignOut(session.accessToken);
      await clearSession();
      set({ authSession: undefined, serverRole: undefined, entitlement: undefined });
      logEvent('auth_sign_out');
    },

    async refreshOrgRole() {
      const session = get().authSession;
      const account = get().settings.account;
      if (!session || !authConfigured()) return;
      try {
        const fresh = await freshSession(session);
        if (fresh !== session) set({ authSession: fresh });
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
      const session = get().authSession;
      const serverId = get().settings.account?.org?.serverId;
      if (!session || !serverId || !authConfigured()) return;
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

    async manageBilling() {
      const session = get().authSession;
      const serverId = get().settings.account?.org?.serverId;
      if (!authConfigured() || !session || !serverId) {
        // Not signed in / org not synced yet: still send them to the web page.
        openExternal(BILLING_URL);
        return;
      }
      // A subscribed org gets the Stripe customer portal; otherwise the web
      // purchase page. Either way it opens in the system browser.
      if (get().entitlement) {
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

    async connectRepoPlatform(id, token) {
      await secretSet(repoSecretKey(id), token.trim());
      set((s) => ({ connectedRepoPlatforms: { ...s.connectedRepoPlatforms, [id]: true } }));
      logEvent('repo_platform_connected', { platform: id });
    },

    async disconnectRepoPlatform(id) {
      await secretDelete(repoSecretKey(id));
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
      const s = get().settings;
      const daemon = s.daemon;
      const home = s.repo?.homeRepo;
      const outbox = s.repo?.outbox ?? [];
      if (!daemon) {
        get().showToast('Connect your desktop to sync your buffered work.');
        return;
      }
      if (!home?.homePath) {
        get().showToast('Set your home repo location on the desktop first.');
        return;
      }
      const pending = pendingForRepo(outbox, home.id);
      if (!pending.length) return;
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
          const v = await daemonVerifyCommit(
            daemon,
            home.homePath,
            current.resultCommit,
            current.branch,
          );
          current = confirm(current, { refExists: v.exists, treeMatches: v.onBranch });
          patch(current.id, current);
        }

        // A conflict or failure halts this repo's batch: later items were
        // composed assuming the earlier ones landed.
        if (stopsBatch(current)) break;
      }

      // Confirmed items are already in the home repo, so clearing their buffered
      // copy loses nothing. Everything not confirmed (pending, conflict, failed)
      // stays, so no unsynced work is ever deleted.
      const kept = items.filter((i) => i.state !== 'confirmed');
      const cleared = items.length - kept.length;
      await get().saveSettings({ repo: { ...s.repo!, outbox: kept } });
      logEvent('outbox_sync', { pending: pending.length, cleared });
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
        id: `o${Date.now().toString(36).padStart(9, '0')}${(convSeq++).toString(36)}`,
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
        set({ harborDownload: undefined });
        return true;
      } catch (err) {
        // If the user cancelled, harborDownload was already cleared; leave it
        // cleared rather than flashing a failure.
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

    beginHarborWithIntro() {
      logEvent('library_intro_open');
      // Kick the download in the background, then walk the Library intro over
      // the marketplace. ensureHarbor manages harborDownload / harborReady.
      void get().ensureHarbor();
      set({ libraryIntro: true, view: 'marketplace', drawerOpen: false });
    },

    endLibraryIntro() {
      logEvent('library_intro_done');
      // Back to the setup page; Harbor keeps downloading in the background.
      // Leave onboarded alone so a mid-setup relaunch still lands on setup.
      set({ libraryIntro: false, view: 'onboarding' });
      void get().saveSettings({ libraryIntroSeen: true });
    },

    async startGuide() {
      if (!get().settings.harborReady) {
        const ok = await get().ensureHarbor();
        if (!ok) return undefined;
      }
      logEvent('harbor_started');
      const id = await get().newConversation({
        kind: 'device',
        modelId: HARBOR_MODEL_ID,
        modelName: HARBOR_MODEL_NAME,
      });
      // Seed Harbor's greeting directly (not model-generated) so first launch
      // is a warm, instant, reliable hello with zero wait.
      set((s) => {
        const conv = s.conversations[id];
        if (!conv) return s;
        const greeting = {
          kind: 'assistant' as const,
          id: `${id}-hello`,
          text: HARBOR_GREETING,
          streaming: false,
        };
        const next: Conversation = {
          ...conv,
          title: HARBOR_MODEL_NAME,
          thread: { ...conv.thread, items: [greeting] },
        };
        return { conversations: { ...s.conversations, [id]: next } };
      });
      void persistConversations(get());
      return id;
    },

    openConversation(id) {
      const conv = get().conversations[id];
      if (!conv) return;
      set({ activeId: id, view: 'chat', drawerOpen: false });
      // Leaving a quick chat for a saved one: drop the quick chat.
      pruneEphemeral(id);
      if (!drivers.has(id)) {
        // Reattach lazily; desktop threads replay their journal into the UI.
        if (conv.source.kind === 'desktop') {
          set((s) => ({
            conversations: {
              ...s.conversations,
              [id]: { ...s.conversations[id]!, thread: emptyThread() },
            },
          }));
        }
        void buildDriver(conv)
          .then((driver) => attachDriver(id, driver))
          .catch((err) => get().showToast(err instanceof Error ? err.message : String(err)));
      }
    },

    deleteConversation(id) {
      drivers.get(id)?.dispose();
      drivers.delete(id);
      unsubscribers.get(id)?.();
      unsubscribers.delete(id);
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

    send(text) {
      const { activeId } = get();
      if (!activeId) return;
      const driver = drivers.get(activeId);
      if (!driver) {
        get().showToast('This chat is not connected yet. Give it a second, or reopen it.');
        return;
      }
      driver.send(text);
    },

    abort() {
      const { activeId } = get();
      if (activeId) drivers.get(activeId)?.abort();
    },

    answerApproval(approvalId, approve, always) {
      const { activeId } = get();
      if (!activeId) return;
      drivers.get(activeId)?.answerApproval(approvalId, { approve, alwaysThisSession: always });
    },

    async saveSettings(patch) {
      const settings = { ...get().settings, ...patch };
      set({ settings });
      setInsightsEnabled(settings.insightsOptIn ?? false);
      await storeSetJson(SETTINGS_KEY, settings);
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

    async connectProvider(id, key) {
      await secretSet(providerSecretKey(id), key.trim());
      set((s) => ({
        connectedProviders: { ...s.connectedProviders, [id]: true },
        cloudKeyPresent: id === 'anthropic' ? true : s.cloudKeyPresent,
      }));
      logEvent('provider_connected', { provider: id });
    },

    async disconnectProvider(id) {
      await secretDelete(providerSecretKey(id));
      set((s) => ({
        connectedProviders: { ...s.connectedProviders, [id]: false },
        cloudKeyPresent: id === 'anthropic' ? false : s.cloudKeyPresent,
      }));
      logEvent('provider_disconnected', { provider: id });
    },

    async setReasoning(ref) {
      const stack = get().settings.stack ?? emptyStack();
      const key = stackRefKey(ref);
      // A model promoted to Reasoning leaves the active specialists.
      const active = stack.active.filter((m) => stackRefKey(m.ref) !== key);
      await get().saveSettings({ stack: { ...stack, reasoning: ref, active } });
      logEvent('stack_reasoning_set', { kind: ref.kind });
    },

    async placeSpecialist(ref, placement) {
      const stack = get().settings.stack ?? emptyStack();
      const key = stackRefKey(ref);
      const active = stack.active.filter((m) => stackRefKey(m.ref) !== key);
      active.push({ ref, placement });
      const saved = { ...stack.saved };
      delete saved[key];
      await get().saveSettings({ stack: { ...stack, active, saved } });
      logEvent('stack_place', { category: placement.category });
    },

    async benchSpecialist(key) {
      const stack = get().settings.stack ?? emptyStack();
      const member = stack.active.find((m) => stackRefKey(m.ref) === key);
      const active = stack.active.filter((m) => stackRefKey(m.ref) !== key);
      const saved = { ...stack.saved };
      if (member) saved[key] = member.placement; // keep placement, trigger, persona
      await get().saveSettings({ stack: { ...stack, active, saved } });
      logEvent('stack_bench');
    },

    async editPlacement(key, placement) {
      const stack = get().settings.stack ?? emptyStack();
      if (stack.active.some((m) => stackRefKey(m.ref) === key)) {
        const active = stack.active.map((m) =>
          stackRefKey(m.ref) === key ? { ...m, placement } : m,
        );
        await get().saveSettings({ stack: { ...stack, active } });
      } else {
        await get().saveSettings({
          stack: { ...stack, saved: { ...stack.saved, [key]: placement } },
        });
      }
    },
  };
});

interface PersistedConversations {
  order: string[];
  conversations: Record<string, Conversation>;
}

async function persistConversations(state: Pick<AppState, 'order' | 'conversations'>) {
  const conversations: Record<string, Conversation> = {};
  // Quick chats are ephemeral by design: they never touch the disk.
  const savedOrder = state.order.filter((id) => !state.conversations[id]?.ephemeral).slice(0, 50);
  for (const id of savedOrder) {
    const conv = state.conversations[id];
    if (!conv) continue;
    conversations[id] = {
      ...conv,
      // Desktop threads live in the engine journal; store metadata only.
      thread: conv.source.kind === 'desktop' ? emptyThread() : trimThread(conv.thread),
    };
  }
  await storeSetJson(CONVERSATIONS_KEY, { order: savedOrder, conversations });
}

function trimThread(thread: Conversation['thread']): Conversation['thread'] {
  return { ...thread, items: thread.items.slice(-200), pendingApprovals: [] };
}
