// An idle deadline for provider streams (DAE-3). The wall-clock rail only runs
// between turns, so a stalled server (Ollama loading a large model, a half-open
// tailnet socket) used to hang a task until someone hit Stop, while the
// daemon's own SSE keepalives made everything look alive. The guard aborts the
// fetch when no bytes have arrived for a window; every chunk resets it. It is
// combined with the caller's own signal by hand rather than AbortSignal.any so
// it runs on every Node 20.
//
// Two windows, not one. Waiting for the FIRST byte is prefill: a cold local
// model loading into memory and reading a large agent-loop prompt on a modest
// box (a small GPU, or CPU only) can legitimately take minutes before it emits
// a single token, and killing it then is the harness failing exactly the
// hardware OpenShore exists to serve. Once tokens are flowing, a long gap
// really is a stall. So the first-byte window is generous and the inter-token
// window is tight; the person can raise either in config.
import { ProviderError } from './types.js';

export const DEFAULT_STREAM_IDLE_MS = 120_000;
export const DEFAULT_STREAM_FIRST_BYTE_MS = 300_000;

let idleOverride: number | undefined;
let firstByteOverride: number | undefined;

/** Test seam: shorten (or restore) the inter-token window. */
export function _setStreamIdleMs(ms: number | undefined): void {
  idleOverride = ms;
}

/** Test seam: shorten (or restore) the first-byte window. */
export function _setStreamFirstByteMs(ms: number | undefined): void {
  firstByteOverride = ms;
}

/** Apply the config's stream windows once at startup (bootstrap, eval). Values
 *  are seconds; undefined leaves the default in place. */
export function configureStreamIdle(opts: {
  idleSeconds?: number;
  firstByteSeconds?: number;
}): void {
  if (opts.idleSeconds !== undefined) idleOverride = opts.idleSeconds * 1000;
  if (opts.firstByteSeconds !== undefined) firstByteOverride = opts.firstByteSeconds * 1000;
}

export function streamIdleMs(): number {
  return idleOverride ?? DEFAULT_STREAM_IDLE_MS;
}

export function streamFirstByteMs(): number {
  // The first-byte window is never shorter than the inter-token one: prefill is
  // strictly the harder wait, so a config that only raises the inter-token
  // window still lifts the floor for the first token.
  return Math.max(firstByteOverride ?? DEFAULT_STREAM_FIRST_BYTE_MS, streamIdleMs());
}

export interface IdleGuard {
  /** Hand this to fetch: it aborts on the caller's signal OR on idleness. */
  signal: AbortSignal;
  /** Call on every chunk to push the deadline out (and mark the first byte). */
  touch(): void;
  /** Disarm; call once the stream ends however it ends. */
  stop(): void;
  /** True once the guard, not the caller, aborted the stream. */
  readonly idled: boolean;
  /** The window (ms) that fired, for the error message. Before firing, the
   *  inter-token window; if it fires waiting for the first byte, the first-byte
   *  window, so the message names the wait that actually timed out. */
  readonly idleMs: number;
}

export function idleGuard(
  signal?: AbortSignal,
  idleMs = streamIdleMs(),
  firstByteMs = streamFirstByteMs(),
): IdleGuard {
  const controller = new AbortController();
  let idled = false;
  let sawFirstByte = false;
  let firedMs = idleMs;
  let timer: NodeJS.Timeout | undefined;
  const arm = (): void => {
    if (timer) clearTimeout(timer);
    const windowMs = sawFirstByte ? idleMs : firstByteMs;
    timer = setTimeout(() => {
      idled = true;
      firedMs = windowMs;
      controller.abort();
    }, windowMs);
  };
  const onOuter = (): void => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', onOuter, { once: true });
  arm();
  return {
    signal: controller.signal,
    touch: () => {
      sawFirstByte = true;
      arm();
    },
    stop: () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      signal?.removeEventListener('abort', onOuter);
    },
    get idled() {
      return idled;
    },
    get idleMs() {
      return firedMs;
    },
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
