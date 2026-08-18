// Library surface: everything a programmatic consumer (tests, integrations,
// future GUIs) needs, re-exported from one place. The CLI lives in bin/osc.
export { ConfigSchema, type OscConfig } from './config/schema.js';
export { loadConfig, saveGlobalConfig, oscHome } from './config/load.js';
export { bootstrapSession } from './core/agent/bootstrap.js';
export { AgentSession } from './core/agent/loop.js';
export type { AgentEvent, ApprovalRequest, Approver } from './core/agent/types.js';
export { ToolRegistry } from './core/tools/index.js';
export { buildToolRegistry, buildToolContext } from './core/agent/registry.js';
export {
  extractTextCalls,
  parseJsonLoose,
  repairJson,
  validateNativeCall,
} from './core/tools/parser.js';
export { parseEditBlocks } from './core/edit/searchReplace.js';
export { applyEditBlocks } from './core/edit/apply.js';
export { unifiedDiff } from './core/edit/diff.js';
export { OpenAICompatibleProvider } from './providers/openaiCompatible.js';
export { AnthropicProvider } from './providers/anthropic.js';
export { ProviderRegistry } from './providers/registry.js';
export type { ChatEvent, ChatMessage, ChatRequest, Provider } from './providers/types.js';
export { Router } from './router/router.js';
export { resolveStack, describeStack } from './router/stack.js';
export { CAPABILITIES } from './router/roles.js';
export { detectHardware, budgetFor, fitsBudget } from './router/resourceBudget.js';
export { PermissionEngine } from './core/permissions/index.js';
export { Guardrails } from './core/guardrails/index.js';
export { EgressPolicy } from './core/security/egress.js';
export { Jail } from './core/security/jail.js';
export { redactSecrets } from './core/security/redaction.js';
export { startDaemon } from './daemon/serve.js';
export { LocalDriver } from './daemon/session.js';
export { RemoteDriver } from './daemon/attach.js';
export { CatalogSchema } from './market/schema.js';
export { loadCatalog } from './market/catalog.js';
export { runEval } from './eval/harness.js';
export { CONNECTORS } from './server/connectorMap.js';
export { TOKENS, banner } from './brand/theme.js';
