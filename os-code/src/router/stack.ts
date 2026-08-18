// Stack resolution: turn the stack section of config into live providers.
// The design center: ONE mandatory reasoning orchestrator (local or cloud)
// that does everything itself unless an optional specialist is enabled.
import type { ModelRef, OscConfig } from '../config/schema.js';
import type { Provider } from '../providers/types.js';
import type { ProviderRegistry } from '../providers/registry.js';
import { SPECIALIST_ROLES, type SpecialistRole } from './roles.js';

export interface ResolvedRole {
  ref: ModelRef;
  provider: Provider;
}

export interface ResolvedStack {
  orchestrator: ResolvedRole;
  specialists: Partial<Record<Exclude<SpecialistRole, 'imageGen'>, ResolvedRole>>;
  /** Image generation resolves to the imageGen endpoint, not a chat provider. */
  imageGen: boolean;
  /** Notes about roles that could not resolve (doctor shows these). */
  notes: string[];
}

export class StackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StackError';
  }
}

export function resolveStack(config: OscConfig, registry: ProviderRegistry): ResolvedStack {
  const notes: string[] = [];
  const stackConfig = config.stack;

  if (!stackConfig.orchestrator) {
    throw new StackError(
      'No orchestrator is configured yet. Run osc init to set up your stack; it takes about two minutes.',
    );
  }
  if (!registry.has(stackConfig.orchestrator.provider)) {
    throw new StackError(
      `The orchestrator points at provider "${stackConfig.orchestrator.provider}", which is not in your providers config. Run osc doctor for the full picture.`,
    );
  }
  const orchestrator: ResolvedRole = {
    ref: stackConfig.orchestrator,
    provider: registry.get(stackConfig.orchestrator.provider),
  };

  const specialists: ResolvedStack['specialists'] = {};
  for (const role of SPECIALIST_ROLES) {
    if (role === 'imageGen') continue;
    const ref = stackConfig.specialists[role];
    if (!ref) continue;
    if (!registry.has(ref.provider)) {
      notes.push(
        `The ${role} specialist points at provider "${ref.provider}", which is not configured; the orchestrator will cover ${role} itself.`,
      );
      continue;
    }
    specialists[role] = { ref, provider: registry.get(ref.provider) };
  }

  const imageGen = Boolean(stackConfig.specialists.imageGen && registry.imageProvider());
  if (stackConfig.specialists.imageGen && !registry.imageProvider()) {
    notes.push(
      'The imageGen specialist is enabled but no imageGen endpoint is configured; image generation is off.',
    );
  }

  return { orchestrator, specialists, imageGen, notes };
}

/** One-line stack description for the status line and osc stack. */
export function describeStack(stack: ResolvedStack): string {
  const orch = `${stack.orchestrator.ref.model} (${stack.orchestrator.provider.kind})`;
  const specialists = Object.entries(stack.specialists).map(
    ([role, r]) => `${role}: ${r!.ref.model}`,
  );
  if (stack.imageGen) specialists.push('imageGen: local image server');
  return specialists.length ? `${orch} + ${specialists.join(', ')}` : `${orch}, solo`;
}
