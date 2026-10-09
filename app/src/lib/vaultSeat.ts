// Which app seat gets a vault pack, and sized how (Vault M5, CTO J2, J4). Pure.
// Locality is judged by address with the one shared judge (`hostIsLocal` from
// os-code/protocol), never by a label, so the BYOM reach pill and what a seat
// may read never disagree.
import { deriveModelClass, hostIsLocal, isOllamaCloudTag, tailnetSuffixOf } from 'os-code/protocol';
import { DEVICE_CONTEXT_TOKENS } from '../drivers/deviceModel.js';
import type { PackSeat } from '../drivers/types.js';
import { BYOM_DEFAULT_CONTEXT_TOKENS, byomHost } from './byom.js';
import { CLAUDE_MODELS } from './claudeModels.js';
import { isCurrentBenchId } from './currents.js';
import type { StackModelRef } from './stack.js';

/** The window an OpenAI-compatible cloud model is assumed to serve when its
 *  provider's catalog does not say (CTO J4). */
export const CLOUD_DEFAULT_CONTEXT_TOKENS = 128_000;

/** A Claude model's window when its id is not in the catalog. */
export const CLAUDE_DEFAULT_CONTEXT_TOKENS = 200_000;

/** A Claude model's real window, from the one catalog (the driver's
 *  `contextWindowFor` reads this too, so the meter and the pack agree). */
export function claudeContextTokens(model: string): number {
  return CLAUDE_MODELS.find((m) => m.id === model)?.contextWindow ?? CLAUDE_DEFAULT_CONTEXT_TOKENS;
}

/** What `packSeatFor` reads besides the ref. */
export interface PackSeatContext {
  /** This device's own tailnet, from the paired hub's address
   *  (`hubTailnetSuffix(settings.daemon?.baseUrl)`); null when unpaired or
   *  the hub is not a `*.ts.net` name, so every `*.ts.net` BYOM reads cloud. */
  ownTailnetSuffix: string | null;
  /** A cloud OpenAI-compatible provider's window for a model
   *  (`info.models[].contextTokens`); undefined falls back to 128000. */
  cloudContextTokens?: (provider: string, model: string) => number | undefined;
  /** A BYOM connection's own `contextTokens`; undefined falls back to
   *  `BYOM_DEFAULT_CONTEXT_TOKENS` (8192). */
  byomContextTokens?: (id: string) => number | undefined;
  /** Whether a BYOM connection is marked as passing requests on to a cloud
   *  provider, read from the connection itself beside the ref's own copy of
   *  the mark. Stricter only: either one makes the seat leave. */
  byomForwardsToCloud?: (id: string) => boolean | undefined;
}

/** The tailnet suffix of the paired hub's base URL ("mac.tail1234.ts.net"
 *  gives "tail1234.ts.net"), or null when there is none or it is not a
 *  MagicDNS name. */
export function hubTailnetSuffix(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null;
  try {
    return tailnetSuffixOf(new URL(baseUrl).hostname);
  } catch {
    return null;
  }
}

/**
 * The seat a pack is rendered for, or null for no pack. Rules (J2, J4):
 * device seats are local, served `DEVICE_CONTEXT_TOKENS`; cloud seats leave,
 * class `large`, Claude served `contextWindowFor(model)`, OpenAI-compatible
 * providers their listed window else 128000; BYOM leaves unless
 * `hostIsLocal(host, { ownTailnetSuffix })`, its model is no Ollama cloud
 * tag (`isOllamaCloudTag`), and neither the ref nor its connection is marked
 * as passing requests on to a cloud provider (`forwardsToCloud`), class by
 * name and size with kind local, served its `contextTokens` else 8192. An
 * Agentic Current bench ref (`isCurrentBenchId`) gets null.
 */
export function packSeatFor(ref: StackModelRef, ctx: PackSeatContext): PackSeat | null {
  switch (ref.kind) {
    case 'device':
      // A pocket model runs on this device: nothing it reads leaves.
      return {
        modelClass: deviceClass(ref.modelId, ref.modelName),
        servedTokens: DEVICE_CONTEXT_TOKENS,
        leavesNetwork: false,
      };
    case 'cloud':
      return {
        modelClass: deriveModelClass({ model: ref.model, kind: 'cloud' }),
        servedTokens:
          ref.provider === 'anthropic'
            ? claudeContextTokens(ref.model)
            : (positive(ctx.cloudContextTokens?.(ref.provider, ref.model)) ??
              CLOUD_DEFAULT_CONTEXT_TOKENS),
        leavesNetwork: true,
      };
    case 'byom': {
      // An Agentic Current rides a BYOM-shaped bench entry; no pack rides a
      // current in v1 (plan "Out of v1").
      if (isCurrentBenchId(ref.id)) return null;
      // By address, and never an Ollama cloud tag: its Ollama passes every
      // request on to ollama.com, so it leaves wherever that Ollama runs. A
      // gateway the person marked as passing requests on leaves the same way
      // (2026-10-09), so a private note never reaches it.
      const host = byomHost(ref.baseUrl);
      const forwards = ref.forwardsToCloud === true || ctx.byomForwardsToCloud?.(ref.id) === true;
      const local =
        host !== undefined &&
        hostIsLocal(host, { ownTailnetSuffix: ctx.ownTailnetSuffix }) &&
        !isOllamaCloudTag(ref.model) &&
        !forwards;
      return {
        modelClass: deriveModelClass({ model: ref.model, kind: 'local' }),
        servedTokens: positive(ctx.byomContextTokens?.(ref.id)) ?? BYOM_DEFAULT_CONTEXT_TOKENS,
        leavesNetwork: !local,
      };
    }
  }
}

/** A device model's class: by the size its id names, else its display name,
 *  else the conservative default (`small`). */
function deviceClass(modelId: string, modelName: string): PackSeat['modelClass'] {
  const byId = deriveModelClass({ model: modelId, kind: 'local' });
  return byId === 'small' ? deriveModelClass({ model: modelName, kind: 'local' }) : byId;
}

function positive(n: number | undefined): number | undefined {
  return n !== undefined && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}
