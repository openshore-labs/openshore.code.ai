// Free, read-only chat with the paired desktop's local models over the daemon's
// stateless /chat endpoint (the free tier the C-suite approved, built as the CTO
// ruled). No session, no tools, no command lane: this driver only streams a
// completion, so the surface physically cannot read, edit, run, or commit. It
// keeps the turn history itself, since /chat is stateless, and re-sends it each
// turn. Streaming rides streamingFetch, past Capacitor's native-HTTP patch.
//
// Web search: the daemon only adds the instruction (search: true, sent only
// while the person has not declined it and the web is in reach); when the
// model asks with a SEARCH: line, the phone runs the search on its own Settings
// provider and sends the results back as the next turn, with search: false and
// an "answer now" line. The desktop never fetches anything for this chat. The
// rules (one search, the line never shown, the results kept as one line in
// history) are drivers/searchTurn.ts.
//
// Stop answers at once (CTO ruling 7): the turn closes with whatever streamed
// so far, kept in the chat and in the history this driver re-sends, and any
// late bytes are dropped.
//
// The vault pack (Vault M5, CTO J6) is built on the computer, never here: the
// body names the project (`vaultPack`) or says Memory is off (`memory: false`),
// the daemon renders the pack over its own vault for the model it serves, and
// streams the card before the first text. No note text ever leaves the phone
// for this chat, and none comes back but the card. When the card says its pack
// carried a local-only note (`localOnly`, the computer judged it), the reply
// is marked local-only, so a later switch to a seat that leaves the network
// gets `LOCAL_ONLY_STUB` in its place (I5).
import type {
  ApprovalAnswer,
  ChatContextPackEvent,
  ChatVaultFields,
  DriverEvent,
} from 'os-code/protocol';
import type { ChatContext, ChatDriver, DriverEventSink } from './types.js';
import { DriverEmitter, readChatContext, textFinal } from './types.js';
import type { DaemonTarget } from './remoteDriver.js';
import { streamingFetch } from '../lib/streamingFetch.js';
import { searchOffered } from '../lib/localSearch.js';
import { chainOfThoughtOn } from '../lib/chainOfThought.js';
import type { SeedTurn } from '../state/types.js';
import { emptyReplyMessage } from './deviceModel.js';
import { isAbortError, SLOW_START_LINE, warmingLine, watchFirstWord } from './providerClient.js';
import { SearchTurn } from './searchTurn.js';

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
  /** This send's pack carried a local-only note (the card said so). */
  private sendLocalOnly = false;
  /** The reply so far this send: only what reached the screen. */
  private answer = '';
  /** The turn is over (answered, stopped, failed); its ending was said once. */
  private closed = true;
  /** The one search this message may make (drivers/searchTurn.ts). */
  private search = new SearchTurn();
  /** The first request says "Warming up"; a later one is likely warm. */
  private warmed = false;
  private slowStart?: { word(): void; stop(): void };

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

  /** Every event leaves through here: nothing after the turn has ended. */
  private emit(event: DriverEvent): void {
    if (event.type === 'task-start') this.closed = false;
    else if (this.closed) return;
    this.emitter.emit(event);
  }

  private async run(text: string): Promise<void> {
    this.aborted = false;
    this.abortController = new AbortController();
    this.packCardShown = undefined;
    this.sendLocalOnly = false;
    this.answer = '';
    this.search.begin();
    this.emit({ type: 'task-start', input: text });
    this.history.push({ role: 'user', content: text });
    await this.turn(1);
  }

  /** End the turn once: the reply so far goes to history and the chat, the
   *  raw search results give way to one line, and the ending is said. */
  private finish(reason: 'complete' | 'aborted' | 'error', message?: string): void {
    if (this.closed) return;
    this.slowStart?.stop();
    this.search.settle(this.history);
    const kept = this.answer.trim();
    if (kept) this.history.push({ role: 'assistant', content: kept });
    this.emit(textFinal(kept, this.sendLocalOnly && Boolean(kept)));
    this.emit({ type: 'task-done', reason, message });
    this.closed = true;
  }

  private show(text: string): void {
    if (!text || this.aborted) return;
    this.slowStart?.stop();
    this.answer += text;
    this.emit({ type: 'text-delta', text });
  }

  /** One completion. The model may ask for a search on the first pass while
   *  the person has not declined it; the answer pass after the results is
   *  told the search is spent, and its search line (if any) is never shown. */
  private async turn(turn: number): Promise<void> {
    const offered = searchOffered();
    const mayAsk = this.search.mayAsk(offered);
    const name = this.model ?? 'your computer';
    this.emit({ type: 'turn-start', turn, model: name, providerKind: 'local' });
    if (!this.warmed && this.model) {
      this.warmed = true;
      this.emit({ type: 'status', message: warmingLine(this.model) });
    }
    this.slowStart?.stop();
    this.slowStart = watchFirstWord(() => {
      if (!this.closed && !this.answer) this.emit({ type: 'status', message: SLOW_START_LINE });
    });
    this.search.startPass();
    // The daemon adds the search instruction only while the model may ask;
    // otherwise this pass's own line (answer now, or no web) rides the
    // chat's context field.
    const context = [
      readChatContext(this.extraSystem),
      mayAsk ? undefined : this.search.note(offered),
    ]
      .filter(Boolean)
      .join('\n\n');
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
          context: context || undefined,
          search: mayAsk,
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
      if (this.aborted) return;
      if (!res.ok || !res.body) {
        const body = (await res.json?.().catch(() => ({}))) as { error?: string };
        this.finish('error', body?.error ?? `Your computer answered ${res.status}.`);
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
            this.show(this.search.push(ev.delta));
          } else if (ev.type === 'thinking' && ev.delta) {
            this.slowStart?.stop();
            if (chainOfThoughtOn()) this.emit({ type: 'thinking-delta', text: ev.delta });
          } else if (ev.type === 'context-pack') {
            const card = readPackCard(ev);
            if (card?.localOnly) this.sendLocalOnly = true;
            const key = card && JSON.stringify([card.seat, card.sources, card.withheld]);
            if (card && key !== this.packCardShown) {
              this.packCardShown = key;
              this.emit(card);
            }
          } else if (ev.type === 'error') {
            this.finish('error', ev.message);
            return;
          }
        }
      }
      if (this.aborted) return;
      const decision = this.search.decide(offered);
      if (decision.kind === 'search') {
        const results = await this.search.run(
          decision.query,
          this.researchOn,
          (e) => this.emit(e),
          this.abortController?.signal,
        );
        if (this.aborted) return;
        this.history.push({ role: 'user', content: results });
        await this.turn(turn + 1);
        return;
      }
      if (decision.kind === 'refused') {
        // A second search line (or one with no search to run) is never shown
        // and never run: the reply had no answer in it.
        this.finish('error', emptyReplyMessage(name));
        return;
      }
      this.show(decision.flush);
      this.finish('complete');
    } catch (err) {
      if (this.aborted || isAbortError(err)) {
        this.finish('aborted');
        return;
      }
      this.finish('error', err instanceof Error ? err.message : 'Could not reach your computer.');
    }
  }

  abort(): void {
    this.aborted = true;
    this.abortController?.abort();
    // Stop answers at once: the turn closes now with what streamed so far.
    this.finish('aborted');
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
    this.slowStart?.stop();
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
      ...(pack.packSize ? { packSize: pack.packSize } : {}),
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
    ...(raw.localOnly === true ? { localOnly: true as const } : {}),
  };
}
