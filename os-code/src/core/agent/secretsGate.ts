// The one place that decides whether a session may hold the project's secrets.
// The rule the whole feature rests on: secrets reach the model ONLY when the
// orchestrator is a local, on-device model. A cloud orchestrator gets nothing
// (the secrets are dropped here, before they can reach a prompt), and any
// session that does hold secrets runs under egress lockdown so no tool can send
// them off the device. Pure and tested, so the gate cannot quietly drift.
// No em dashes anywhere in this file (repo policy is total here).

export interface SecretsGate {
  /** The secrets to give the session, or undefined to withhold them. */
  projectSecrets?: string;
  /** When true, drop every tool that could send data off the device. */
  egressLockdown: boolean;
}

/** Decide the session's secrets posture from the orchestrator's kind and the
 *  (optional) secrets the person enabled. Local plus non-empty secrets is the
 *  only case that carries them; everything else withholds and does not lock
 *  down. */
export function gateProjectSecrets(
  orchestratorKind: 'local' | 'cloud',
  secrets: string | undefined,
): SecretsGate {
  const active = Boolean(secrets?.trim()) && orchestratorKind === 'local';
  return {
    projectSecrets: active ? secrets : undefined,
    egressLockdown: active,
  };
}
