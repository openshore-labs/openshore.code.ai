// No dead ends in chat (founder, 2026-09-25). A turn that stops on an error the
// brain cannot get past by itself (a key that needs a workspace id, a rejected
// key, no account usage, an unreachable host) must still leave the person a way
// to keep talking. The stopped card always carries a next move: continue this
// same chat on another brain that can answer here, fix the connection, or pick
// a model. This module is the pure part: which stops are failures, which
// brain to continue on, and whether the message points at Cloud Connections.
import type { ConversationSource } from '../state/types.js';

/** A stop the person asked for, or a step they declined, is not a failure. */
export function isFailedStop(message: string): boolean {
  return !/stopped at your request|declined|was declined/i.test(message);
}

/** True when the stop's fix lives under Cloud Connections (a missing workspace
 *  id, a rejected or missing key), so the card can open it in one tap. */
export function pointsAtConnections(message: string): boolean {
  return /(cloud )?connections/i.test(message);
}

/** A stop that says the brain's own setup is wrong (the key needs a workspace
 *  id, or was rejected). Trying the same brain again cannot answer. */
export function isSetupFailure(message: string): boolean {
  return /workspace it acts in|rejected the API key|API key under Cloud Connections/i.test(message);
}

export interface RescueSignals {
  /** Harbor Lite can run here (the phone). It may still need its download. */
  harborLiteHost: boolean;
  harborLite: { modelId: string; modelName: string };
  /** The Stack can answer (its seats are ready). */
  stackReady: boolean;
}

/** The brain to continue a failed chat on: never the one that just failed,
 *  local first (Harbor Lite on the phone, which needs no account and works
 *  offline), then the Stack. Undefined when nothing else here can answer; the
 *  card then offers the model picker instead, so there is still a way on. */
export function rescueSource(
  current: ConversationSource,
  signals: RescueSignals,
): ConversationSource | undefined {
  const onHarborLite = current.kind === 'device' && current.modelId === signals.harborLite.modelId;
  if (signals.harborLiteHost && !onHarborLite) {
    return { kind: 'device', ...signals.harborLite };
  }
  if (signals.stackReady && current.kind !== 'stack') return { kind: 'stack' };
  return undefined;
}
