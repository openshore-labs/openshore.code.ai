// Free, read-only chat with the paired desktop's local models over the daemon's
// stateless /chat endpoint (the free tier the C-suite approved, built as the CTO
// ruled). No session, no tools, no command lane: this driver only streams a
// completion, so the surface physically cannot read, edit, run, or commit. It
// keeps the turn history itself, since /chat is stateless, and re-sends it each
// turn. Streaming rides streamingFetch, past Capacitor's native-HTTP patch.
//
// Web search: the daemon only adds the instruction (search: true); when the
// model asks with a SEARCH: line, the phone runs the search on its own Settings
// provider and sends the results back as the next turn. The desktop never
// fetches anything for this chat.
//
// The vault pack (Vault M5, CTO J6) is built on the computer, never here: the
// body names the project (`vaultPack`) or says Memory is off (`memory: false`),
// the daemon renders the pack over its own vault for the model it serves, and
// streams the card before the first text. No note text ever leaves the phone
// for this chat, and none comes back but the card.
import {
  SearchLineFilter,
  type ApprovalAnswer,
  type ChatContextPackEvent,
  type ChatVaultFields,
} from 'os-code/protocol';
import type { ChatContext, ChatDriver, DriverEventSink } from './types.js';
import { DriverEmitter, readChatContext } from './types.js';
import type { DaemonTarget } from './remoteDriver.js';
import { streamingFetch } from '../lib/streamingFetch.js';
import { searchForModel } from '../lib/localSearch.js';
import { chainOfThoughtOn } from '../lib/chainOfThought.js';
import type { SeedTurn } from '../state/types.js';

type Msg = { role: 'user' | 'assistant'; content: string };

export class DesktopChatDriver implements ChatDriver {
  readonly kind = 'desktop-chat' as const;
  private emitter = new DriverEmitter();
  private history: Msg[] = [];
  private abortController?: AbortController;
  private aborted = false;
  /** What the last context-pack card said this send, so a search's second
   *  pass does not show the same card twice. */
  private packCardShown?: string;

  constructor(
    private readonly target: DaemonTarget,
    private readonly model?: string,
    seed?: SeedTurn[],
    /** The project's standing instructions and the chat's repo context (and
     *  the guided setup's step), read on every reply and sent as /chat's own
     *  capped context field. A daemon that predates it ignores the field. */
    private readonly extraSystem?: ChatContext,
    /** Research (default off): search on the connected Perplexity key. */
    private readonly researchOn = false,
    /** The /chat vault fields (CTO J6): the project the daemon builds the pack
     *  for, or Memory off. None sends neither, so the daemon builds none. */
    private readonly vault: ChatVaultFields = {},
  ) {
    if (seed) this.history = seed.map((t) => ({ role: t.role, content: t.text }));
  }

  subscribe(sink: DriverEventSink): () => void {
    return this.emitter.subscribe(sink);
  }

  send(text: string): void {
    void this.run(text);
  }

  private async run(text: string): Promise<void> {
    this.aborted = false;
    this.abortController = new AbortController();
    this.packCardShown = undefined;
    this.emitter.emit({ type: 'task-start', input: text });
    this.history.push({ role: 'user', content: text });
    await this.turn(1, true);
  }

  /** One completion. `searchable` lets it ask for a search once; the answer
   *  pass after the results runs with it off, so a model cannot loop. */
  private async turn(turn: number, searchable: boolean): Promise<void> {
    this.emitter.emit({
      type: 'turn-start',
      turn,
      model: this.model ?? 'your computer',
      providerKind: 'local',
    });
    const filter = new SearchLineFilter(searchable);
    let answer = '';
    try {
      const res = await streamingFetch(`${this.target.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.target.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messages: this.history,
          model: this.model,
          context: readChatContext(this.extraSystem),
          search: true,
          // Chain of Thought: the desktop asks its model to think (or not) and
          // streams the thinking as its own frames. A daemon that predates the
          // field ignores it and streams text only.
          chainOfThought: chainOfThoughtOn(),
          // The daemon's pack (J6): the project it is built for, or Memory
          // off. Never a note body. An older daemon ignores both.
          ...vaultBodyFields(this.vault),
        }),
        signal: this.abortController?.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json?.().catch(() => ({}))) as { error?: string };
        this.emitter.emit({
          type: 'task-done',
          reason: 'error',
          message: body?.error ?? `Your computer answered ${res.status}.`,
        });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done || this.aborted) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          let ev: { type?: string; delta?: string; message?: string } & Record<string, unknown>;
          try {
            ev = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (ev.type === 'text' && ev.delta) {
            answer += ev.delta;
            const shown = filter.push(ev.delta);
            if (shown) this.emitter.emit({ type: 'text-delta', text: shown });
          } else if (ev.type === 'thinking' && ev.delta && chainOfThoughtOn()) {
            this.emitter.emit({ type: 'thinking-delta', text: ev.delta });
          } else if (ev.type === 'context-pack') {
            const card = readPackCard(ev);
            const key = card && JSON.stringify([card.seat, card.sources, card.withheld]);
            if (card && key !== this.packCardShown) {
              this.packCardShown = key;
              this.emitter.emit(card);
            }
          } else if (ev.type === 'error') {
            this.emitter.emit({ type: 'task-done', reason: 'error', message: ev.message });
            return;
          }
        }
      }
      const { query, flush } = filter.end();
      if (this.aborted) {
        const kept = query ? '' : answer;
        if (kept.trim()) this.history.push({ role: 'assistant', content: kept });
        this.emitter.emit({ type: 'text-final', text: kept });
        this.emitter.emit({ type: 'task-done', reason: 'aborted', message: 'Stopped.' });
        return;
      }
      if (query) {
        const results = await searchForModel(query, this.researchOn, (e) => this.emitter.emit(e));
        if (this.aborted) {
          this.emitter.emit({ type: 'task-done', reason: 'aborted', message: 'Stopped.' });
          return;
        }
        this.history.push({ role: 'user', content: results });
        await this.turn(turn + 1, false);
        return;
      }
      if (flush) this.emitter.emit({ type: 'text-delta', text: flush });
      this.history.push({ role: 'assistant', content: answer });
      this.emitter.emit({ type: 'text-final', text: answer });
      this.emitter.emit({ type: 'task-done', reason: 'complete' });
    } catch (err) {
      if (this.aborted) {
        this.emitter.emit({ type: 'task-done', reason: 'aborted', message: 'Stopped.' });
        return;
      }
      this.emitter.emit({
        type: 'task-done',
        reason: 'error',
        message: err instanceof Error ? err.message : 'Could not reach your computer.',
      });
    }
  }

  abort(): void {
    this.aborted = true;
    this.abortController?.abort();
  }

  recordLine(turn: SeedTurn): void {
    this.history.push({ role: turn.role, content: turn.text });
  }

  answerApproval(_approvalId: string, _answer: ApprovalAnswer): void {
    // Read-only chat has no tool approvals; nothing to answer.
  }

  dispose(): void {
    this.aborted = true;
    this.abortController?.abort();
    this.emitter.clear();
  }
}

/** The /chat body's vault fields, only those that are set. */
export function vaultBodyFields(vault: ChatVaultFields): ChatVaultFields {
  if (vault.memory === false) return { memory: false };
  const pack = vault.vaultPack;
  if (!pack) return {};
  return {
    vaultPack: {
      ...(pack.cwd ? { cwd: pack.cwd } : {}),
      ...(pack.projectName ? { projectName: pack.projectName } : {}),
    },
  };
}

const PACK_LAYERS: readonly string[] = ['pin', 'current-state', 'handoff', 'search', 'link', 'map'];

/** A streamed context-pack line as the card event, or undefined when it is
 *  not one (a malformed line is dropped, never shown half). */
export function readPackCard(raw: Record<string, unknown>): ChatContextPackEvent | undefined {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const seat = raw.seat === 'local' || raw.seat === 'cloud' ? raw.seat : undefined;
  const mode = raw.mode === 'current-state' || raw.mode === 'full' ? raw.mode : undefined;
  const tokens = num(raw.tokens);
  const budgetTokens = num(raw.budgetTokens);
  const withheld = num(raw.withheld) ?? 0;
  if (!seat || !mode || tokens === undefined || budgetTokens === undefined) return undefined;
  const sources = Array.isArray(raw.sources)
    ? raw.sources.filter(
        (x): x is ChatContextPackEvent['sources'][number] =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as { path?: unknown }).path === 'string' &&
          typeof (x as { title?: unknown }).title === 'string' &&
          PACK_LAYERS.includes((x as { layer?: unknown }).layer as string),
      )
    : [];
  return {
    type: 'context-pack',
    seat,
    mode,
    tokens,
    budgetTokens,
    sources,
    withheld,
    cold: raw.cold === true,
  };
}
