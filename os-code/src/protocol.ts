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
  StopReason,
} from './core/agent/types.js';

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
export type { CapabilityCategory, SpecialistRole } from './router/roles.js';

// Stack Health: pure payload types only. The aggregator that fills them in
// (insights/stackHealth.ts) touches the filesystem and is NOT imported here.
export type {
  StackHealth,
  StackHealthBucket,
  StackHealthCrewMember,
  StackHealthRange,
  StackHealthSealFact,
  SavingsBasis,
} from './insights/stackHealthTypes.js';

/** Wire shapes the daemon serves that are not agent events. */
export interface DaemonSessionInfo {
  id: string;
  cwd: string;
  title?: string;
  busy?: boolean;
  updatedAt?: string;
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
