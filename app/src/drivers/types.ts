// The one driver contract every conversation brain implements: the desktop
// engine over IPC, the desktop daemon over SSE from the phone, a model running
// on the phone itself, cloud Claude, and the demo. They all emit the engine's
// DriverEvent protocol, so the chat UI has exactly one rendering path.
import { LOCAL_ONLY_STUB } from 'os-code/protocol';
import type { ApprovalAnswer, DriverEvent, ModelClass, PermissionMode } from 'os-code/protocol';
import type { Attachment } from '../lib/attachments.js';
import type { SeedTurn } from '../state/types.js';

export type DriverEventSink = (event: DriverEvent, seq: number) => void;

export interface ChatDriver {
  readonly kind: 'desktop' | 'desktop-chat' | 'device' | 'cloud' | 'mock' | 'stack';
  /**
   * Set on a driver returned by guardDriver: the driver underneath the ethics
   * wrapper. Present for diagnostics and for a test asking whether this is the
   * same underlying driver or a rebuilt one. It is NOT a way to send around the
   * guard, and nothing in the app uses it to send.
   */
  readonly wrapped?: ChatDriver;
  /** Attachments are optional and only used by vision-capable drivers (cloud
   *  Claude today). Drivers that cannot use them ignore the argument, so a
   *  plain `send(text)` implementation still satisfies the contract. */
  send(text: string, attachments?: Attachment[]): void;
  abort(): void;
  answerApproval(approvalId: string, answer: ApprovalAnswer): void;
  /** Subscribe to the event stream; returns an unsubscribe function. */
  subscribe(sink: DriverEventSink): () => void;
  /** Release sockets, native handles, timers. */
  dispose(): void;
  /**
   * A line the app itself wrote into the chat, outside any turn: the guided
   * setup's scripted messages, or a message the walk answered itself. Chat
   * brains that keep their own history append it, so what the model knows
   * matches what is on screen. Engine sessions keep their own journal and omit
   * it. Never called mid-turn (the walk waits for a reply to end).
   */
  recordLine?(turn: SeedTurn): void;
  /**
   * The person's controls over a live engine session (Claude Code parity;
   * engine-backed drivers only). setMode switches the permission mode for the
   * rest of the session; setInstructions replaces the project's standing
   * instructions; compact folds the history now (an optional focus keeps what
   * matters); listFiles ranks repo paths for an @ mention. Chat brains omit
   * them, so the composer hides the affordances there.
   */
  setMode?(mode: PermissionMode): void;
  setInstructions?(text?: string): void;
  compact?(focus?: string): Promise<{ before: number; after: number } | { error: string }>;
  listFiles?(query: string): Promise<string[]>;
  /**
   * Project trust (engine-backed drivers only): trust this session's folder on
   * the computer it runs on, so the folder's own os-code.config.json applies
   * from the next session there. On a shared hub only the owner may.
   */
  trustFolder?(): Promise<{ ok: true; folder: string } | { error: string }>;
  /**
   * The truncation card's action (engine-backed drivers only, C1, CTO 5):
   * serve this provider's models a larger window on the computer the session
   * runs on, from the next message, in every chat. On a shared hub only the
   * owner may, since it spends the computer's memory.
   */
  giveMoreRoom?(provider: string): Promise<{ ok: true; provider: string } | { error: string }>;
  /**
   * Undo (engine-backed drivers only): put back the files a task changed, or
   * one of them, or redo them. The engine checkpoints every task on the
   * computer it runs on, so this works the same from the desktop and a
   * paired phone, and the result echoes to every device watching.
   */
  restoreCheckpoint?(
    id: string,
    direction: 'undo' | 'redo',
    path?: string,
  ): Promise<{ ok: true; paths: string[] } | { error: string }>;
  /**
   * The chat-to-terminal bridge (desktop-backed drivers only). Run a command
   * the user asked for on the connected machine; output streams back as
   * command-* events on the same subscription. Returns the runId, or undefined
   * if this driver has no terminal. sendStdin/killCommand drive a live run.
   */
  runCommand?(command: string): Promise<RunCommandResult>;
  sendStdin?(runId: string, data: string): void;
  killCommand?(runId: string): void;
  /**
   * Phase 2 interactive PTY terminal (desktop-backed drivers only). openTerminal
   * ensures a real terminal on the connected machine and returns its id and
   * size, or an unavailable marker when the machine has no PTY support.
   * terminalStream replays the ring buffer from a byte offset and then streams
   * live raw bytes (with the running end offset, for resume) until the signal
   * aborts. The rest drive a live terminal. Non-desktop drivers omit these, so
   * the terminal entry point stays hidden for them.
   */
  openTerminal?(opts: { cols: number; rows: number }): Promise<TerminalOpen>;
  terminalStream?(
    termId: string,
    sinceOffset: number,
    onChunk: (bytes: Uint8Array, endOffset: number) => void,
    signal: AbortSignal,
    onExit?: (info: TerminalExit) => void,
  ): Promise<void>;
  /** Fire-and-forget on hosts that cannot answer; a hub answers with whether
   *  the bytes landed, and in particular whether the shell has exited. */
  terminalStdin?(termId: string, data: string): void | Promise<TerminalWrite>;
  terminalResize?(termId: string, cols: number, rows: number): void;
  terminalKill?(termId: string): void;
}

/** The slice of a driver the terminal view drives. A session's driver is one;
 *  so is the plain home shell's host, which has no session behind it. */
export type TerminalHost = Pick<
  ChatDriver,
  'openTerminal' | 'terminalStream' | 'terminalStdin' | 'terminalResize' | 'terminalKill'
>;

/** The result of opening a terminal: its id and starting size, or a clean
 *  "no PTY on this machine" marker the UI shows instead of a blank panel. */
export type TerminalOpen =
  { termId: string; cols: number; rows: number } | { unavailable: true; error: string };

/** The shell's final frame: its exit code and the byte offset it ended at. */
export interface TerminalExit {
  exit: number;
  offset: number;
}

/** What became of a stdin write. `exited` is the daemon's 409: the shell is
 *  over, which is different from a terminal that does not exist. */
export type TerminalWrite = { ok: true } | { ok: false; exited: boolean; error: string };

/** Starting a command on the connected machine: the run to follow, the hub's
 *  own refusal (P0-1, a member device on a shared hub), or undefined when
 *  this host has no terminal or did not answer. */
export type RunCommandResult = { runId: string } | { refused: string } | undefined;

/** What a shared hub lets this device do. Absent on a hub that predates roles. */
export type HubRole = 'admin' | 'member';

/** The phone's line to a paired computer, as the chat banner reads it:
 *  `reconnecting` while a dropped stream is actually being reattached,
 *  `away` once that has clearly failed, `live` once the hub answers again. */
export type HubLinkState = 'live' | 'reconnecting' | 'away';

/** The one sentence for a hub that did not answer a request in time. Lives
 *  here (never mocked) so the store can say it whether the failure surfaced in
 *  the driver or in the session create before the driver existed. */
export const HUB_NO_ANSWER =
  'Your computer did not answer in 10 seconds. Is it on and on the same network?';

/** A chat's extra system context: fixed, or read fresh on every reply (the
 *  guided setup's step moves while the chat is open). */
export type ChatContext = string | (() => string | undefined);

export function readChatContext(context: ChatContext | undefined): string | undefined {
  const text = typeof context === 'function' ? context() : context;
  return text?.trim() || undefined;
}

/** The seat a vault pack is rendered for (Vault M5, CTO J1, J2, J4): its
 *  class (`deriveModelClass`), the window it is served, and whether its
 *  requests leave this network (judged by address, `hostIsLocal`). Built by
 *  `packSeatFor` (lib/vaultSeat.ts); null there means the seat gets no pack. */
export interface PackSeat {
  modelClass: ModelClass;
  servedTokens: number;
  leavesNetwork: boolean;
}

/**
 * The app's vault context pack for one conversation (Vault M5, CTO J1), the
 * exact engine pack (`planContextPack` and `buildContextPack` from
 * os-code/protocol). Built by `createAppVaultPack` (lib/vaultPackSource.ts).
 * A driver calls `prepare` once per send, after `task-start`, then `render`
 * for each seat that answers, emitting the event right after `turn-start`
 * and placing the text as the LAST system part (J16).
 */
export interface AppVaultPack {
  /** Gather the index, bodies and Current State for this send, within the
   *  cold budget (`VAULT_PACK_COLD_MS`). Never throws; a failure leaves the
   *  next render with Current State alone, or nothing. */
  prepare(task: string, signal?: AbortSignal): Promise<void>;
  /** Render for one seat, cached on `[mode, budget, class, leaves,
   *  preparedStamp]`. `text` is absent for no pack; `event` is the
   *  `context-pack` card, absent when it would repeat the last one.
   *  `localOnly` is set when the text carries a note that stays on this
   *  computer (only ever on a seat that does not leave the network), so the
   *  reply it grounds is marked like one after a local-only read (I5). */
  render(seat: PackSeat): { text?: string; event?: DriverEvent; localOnly?: true };
}

/**
 * The local-only mark on a reply (Vault M5, CTO J10, I5 in the transcript):
 * an additive field on `text-final`, set by an app driver when the reply
 * followed a local-only read (a vault tool read, or a pack that carried a
 * local-only note). The store copies it onto the assistant item, and a switch
 * seeds it on, so a seat that leaves the network gets `LOCAL_ONLY_STUB` in
 * its place and a handoff drops the turn. The engine's own event type does
 * not name it; old readers ignore it.
 */
export interface LocalOnlyMark {
  localOnly?: true;
}

/** A `text-final` event, marked when the reply followed a local-only read. */
export function textFinal(text: string, localOnly?: boolean): DriverEvent {
  const event: Extract<DriverEvent, { type: 'text-final' }> & LocalOnlyMark = {
    type: 'text-final',
    text,
    ...(localOnly ? { localOnly: true as const } : {}),
  };
  return event;
}

/** Whether a `text-final` event carries the local-only mark. */
export function isLocalOnlyFinal(event: DriverEvent): boolean {
  return event.type === 'text-final' && (event as LocalOnlyMark).localOnly === true;
}

/**
 * The local-only mark for an engine session's replies (Vault M5, I5). The
 * engine builds the pack on the computer and says on its `context-pack` card
 * (`localOnly`) when the pack carried a note that stays there. This marks
 * every `text-final` after such a card, until the next `task-start`, so the
 * transcript and a later switch treat the reply like one after a local-only
 * read. A later card in the same task never clears it (an escalation's cloud
 * card follows turns the local seat already wrote). One per event stream.
 */
export class PackLocalOnlyMarker {
  private carried = false;

  mark(event: DriverEvent): DriverEvent {
    if (event.type === 'task-start') this.carried = false;
    else if (event.type === 'context-pack' && (event as LocalOnlyMark).localOnly === true)
      this.carried = true;
    // A tool on the engine read a local-only note: what the model says next
    // may quote it, the engine's own I5 rule (loop.ts, seed.ts).
    else if (event.type === 'tool-end' && event.result.localOnly === true) this.carried = true;
    else if (event.type === 'text-final' && this.carried && !isLocalOnlyFinal(event))
      return { ...event, localOnly: true } as DriverEvent;
    return event;
  }
}

/** A seed turn's text as a seat sees it: a local-only turn is the stub on a
 *  seat that leaves the network, whole on one that does not (I5). */
export function seedText(turn: SeedTurn, leavesNetwork: boolean): string {
  return turn.localOnly && leavesNetwork ? LOCAL_ONLY_STUB : turn.text;
}

/** The trailing options every chat driver constructor takes (CTO J1). The
 *  store passes none with Memory off or `settings.vaultContext === 'off'`. */
export interface DriverVaultOptions {
  vaultPack?: AppVaultPack;
}

/** Shared helper: a tiny fan-out emitter drivers can compose. */
export class DriverEmitter {
  private sinks = new Set<DriverEventSink>();
  private seq = 0;

  emit(event: DriverEvent): void {
    const seq = ++this.seq;
    for (const sink of this.sinks) sink(event, seq);
  }

  subscribe(sink: DriverEventSink): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  clear(): void {
    this.sinks.clear();
  }
}
