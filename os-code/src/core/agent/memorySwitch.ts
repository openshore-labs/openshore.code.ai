// The Memory switch's one precedence rule (Vault v1, 1.5; CTO F6), shared by
// the engine's bootstrap and the app through os-code/protocol. Pure on
// purpose: projectMemory.ts imports node:path, and the protocol surface must
// stay free of Node built-ins, so the helper lives here and projectMemory.ts
// re-exports it.

/**
 * Whether project memory is on for a session. `configEnabled` is the effective
 * config's `memory.enabled` (a project's `false` already applied); `override`
 * is the app's Memory switch for this session. The override can only turn
 * memory off: `false` wins, while `true` or undefined leaves config in charge,
 * so a project that turned memory off stays off whatever the app says.
 */
export function memoryEnabled(configEnabled: boolean | undefined, override?: boolean): boolean {
  if (override === false) return false;
  return configEnabled !== false;
}
