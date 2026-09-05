// An idle deadline for provider streams (DAE-3). The wall-clock rail only runs
// between turns, so a stalled server (Ollama loading a large model, a half-open
// tailnet socket) used to hang a task until someone hit Stop, while the
// daemon's own SSE keepalives made everything look alive. The guard aborts the
// fetch when no bytes have arrived for a window; every chunk resets it. It is
// combined with the caller's own signal by hand rather than AbortSignal.any so
// it runs on every Node 20.
import { ProviderError } from './types.js';

export const DEFAULT_STREAM_IDLE_MS = 120_000;

let override: number | undefined;

/** Test seam: shorten (or restore) the idle window. */
export function _setStreamIdleMs(ms: number | undefined): void {
  override = ms;
}

export function streamIdleMs(): number {
  return override ?? DEFAULT_STREAM_IDLE_MS;
}

export interface IdleGuard {
  /** Hand this to fetch: it aborts on the caller's signal OR on idleness. */
  signal: AbortSignal;
  /** Call on every chunk to push the deadline out. */
  touch(): void;
  /** Disarm; call once the stream ends however it ends. */
  stop(): void;
  /** True once the guard, not the caller, aborted the stream. */
  readonly idled: boolean;
  readonly idleMs: number;
}

export function idleGuard(signal?: AbortSignal, idleMs = streamIdleMs()): IdleGuard {
  const controller = new AbortController();
  let idled = false;
  let timer: NodeJS.Timeout | undefined;
  const arm = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      idled = true;
      controller.abort();
    }, idleMs);
  };
  const onOuter = (): void => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', onOuter, { once: true });
  arm();
  return {
    signal: controller.signal,
    touch: arm,
    stop: () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      signal?.removeEventListener('abort', onOuter);
    },
    get idled() {
      return idled;
    },
    idleMs,
  };
}

/** The error a stalled stream surfaces: names the window and the endpoint. */
export function idleError(providerId: string, label: string, idleMs: number): ProviderError {
  const seconds = Math.max(1, Math.round(idleMs / 1000));
  return new ProviderError(
    providerId,
    `No bytes for ${seconds}s from ${label}. The stream stalled: the model server may still be loading, or the connection dropped. Try again, or check the server.`,
  );
}
