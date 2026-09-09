// askAgent: the generic door. Send one task to any agent that speaks A2A
// (the Linux Foundation's Agent-to-Agent protocol) and return what it said.
// The A2A current is the seam under the named currents: a Hermes or Vellum
// install that exposes an agent card connects through this same tool.
//
// Minimal, tolerant client: read the agent card, POST a JSON-RPC message/send
// with one text part, and pull text out of whichever shape comes back (a Task
// with artifacts, a Task with a status message, or a bare Message). Nothing
// streams and nothing is persisted; a follow-up carries the contextId the
// agent returned so a conversation can continue.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { capContent, type ToolDef } from './index.js';
import { CURRENTS_LIMITS } from '../../currents/model.js';

const schema = z.object({
  task: z
    .string()
    .min(1)
    .max(CURRENTS_LIMITS.askChars)
    .describe('The complete, self-contained request for the connected agent.'),
  contextId: z
    .string()
    .optional()
    .describe('The contextId a previous answer returned, to continue that conversation.'),
});

export interface AgentCard {
  name?: string;
  description?: string;
  url?: string;
  version?: string;
  skills?: Array<{ id?: string; name?: string; description?: string }>;
}

const CARD_PATHS = ['/.well-known/agent-card.json', '/.well-known/agent.json'];

/** Read an A2A agent card from its well-known locations. */
export async function fetchAgentCard(
  agentUrl: string,
  opts: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<AgentCard | undefined> {
  const headers: Record<string, string> = {};
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
  for (const path of CARD_PATHS) {
    try {
      const res = await fetch(`${agentUrl}${path}`, { headers, signal: opts.signal });
      if (!res.ok) continue;
      const card = (await res.json()) as AgentCard;
      if (card && typeof card === 'object') return card;
    } catch {
      // try the next location
    }
  }
  return undefined;
}

interface Part {
  kind?: string;
  type?: string;
  text?: string;
}
interface A2aMessage {
  role?: string;
  parts?: Part[];
  contextId?: string;
}
interface A2aResult {
  id?: string;
  contextId?: string;
  kind?: string;
  status?: { state?: string; message?: A2aMessage };
  artifacts?: Array<{ parts?: Part[] }>;
  parts?: Part[];
  history?: A2aMessage[];
}
interface Rpc {
  result?: A2aResult;
  error?: { message?: string; code?: number };
}

/** Pull the answer text out of an A2A result, whichever shape it took. */
export function a2aText(result: A2aResult | undefined): string {
  if (!result) return '';
  const fromParts = (parts?: Part[]) =>
    (parts ?? [])
      .filter((p) => (p.kind ?? p.type) === 'text' && typeof p.text === 'string')
      .map((p) => p.text as string)
      .join('\n');
  const artifacts = (result.artifacts ?? []).map((a) => fromParts(a.parts)).filter(Boolean);
  if (artifacts.length) return artifacts.join('\n\n');
  const status = fromParts(result.status?.message?.parts);
  if (status) return status;
  const direct = fromParts(result.parts);
  if (direct) return direct;
  const last = [...(result.history ?? [])].reverse().find((m) => m.role === 'agent');
  return fromParts(last?.parts);
}

export const askAgentTool: ToolDef<typeof schema> = {
  name: 'askAgent',
  description:
    'Send a self-contained task to the agent the person connected over A2A (the agent-to-agent protocol) and return its answer. That agent runs on its own computer under its own rules; your approvals do not reach it, so say plainly when a result came from it. Pass back the contextId it returned to continue a conversation.',
  schema,
  risk: 'network',
  async preview(args) {
    return { summary: `Ask the connected agent: ${args.task.slice(0, 80)}` };
  },
  async execute(args, ctx) {
    const a = ctx.currents?.a2a;
    if (!a) {
      return {
        ok: false,
        content:
          'No A2A agent is connected on this session. Ask the person to turn on the A2A current in Settings and connect an agent, then try again.',
      };
    }
    const decision = ctx.egress.check(a.agentUrl, 'cloud-api');
    if (!decision.allowed) {
      return {
        ok: false,
        content: `The agent is not reachable under the egress policy: ${decision.reason}`,
      };
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (a.apiKey) headers.authorization = `Bearer ${a.apiKey}`;
    try {
      const card = await fetchAgentCard(a.agentUrl, { apiKey: a.apiKey, signal: ctx.signal });
      const endpoint = card?.url && /^https?:/.test(card.url) ? card.url : a.agentUrl;
      const message: A2aMessage & { messageId: string; kind: string } = {
        kind: 'message',
        role: 'user',
        messageId: randomUUID(),
        parts: [{ kind: 'text', text: args.task }],
        ...(args.contextId ? { contextId: args.contextId } : {}),
      };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: randomUUID(),
          method: 'message/send',
          params: { message },
        }),
        signal: ctx.signal,
      });
      if (!res.ok) {
        return {
          ok: false,
          content: `The agent answered ${res.status}. Check its address and that it is running.`,
        };
      }
      const rpc = (await res.json()) as Rpc;
      if (rpc.error?.message) return { ok: false, content: `Agent error: ${rpc.error.message}` };
      const text = a2aText(rpc.result).trim();
      const who = card?.name ? card.name : 'The agent';
      const contextId = rpc.result?.contextId ?? rpc.result?.status?.message?.contextId;
      if (!text) {
        return {
          ok: false,
          content: `${who} returned no text${rpc.result?.status?.state ? ` (state: ${rpc.result.status.state})` : ''}.`,
        };
      }
      return {
        ok: true,
        content: `${who} answered${contextId ? ` (contextId: ${contextId})` : ''}:\n\n${capContent(text)}`,
      };
    } catch (err) {
      if (ctx.signal?.aborted) return { ok: false, content: 'Stopped.' };
      return { ok: false, content: `Could not reach the agent: ${(err as Error).message}` };
    }
  },
};
