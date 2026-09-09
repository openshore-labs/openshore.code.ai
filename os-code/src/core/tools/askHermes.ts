// askHermes: hand a self-contained task to the person's Hermes Agent box and
// bring its answer back. Hermes runs its own tools on its own computer; this
// tool never claims otherwise, and the description says so to the model.
//
// The handle is injected per session (ctx.currents.hermes) only when the Hermes
// current is on and connected, so registering the tool is safe: with no handle
// it degrades to "not connected here". Every call is risk 'network' and rides
// the egress policy like the web tools: a Hermes box on the tailnet is a local
// host to the policy, which is the point of the product.
//
// Session continuity: one Hermes session per OpenShore session, carried in the
// X-Hermes-Session-Id header the Hermes API server understands, so the box's
// memory of this conversation accumulates instead of starting over per call.
import { z } from 'zod';
import { capContent, type ToolDef } from './index.js';
import { CURRENTS_LIMITS } from '../../currents/model.js';

const schema = z.object({
  task: z
    .string()
    .min(1)
    .max(CURRENTS_LIMITS.askChars)
    .describe(
      'The complete, self-contained request for Hermes, including any context it needs. Hermes remembers this session, so a follow-up can refer to earlier asks.',
    ),
});

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  error?: { message?: string };
}

function contentText(c: ChatCompletion): string {
  const m = c.choices?.[0]?.message?.content;
  if (typeof m === 'string') return m;
  if (Array.isArray(m)) return m.map((p) => p.text ?? '').join('');
  return '';
}

export const askHermesTool: ToolDef<typeof schema> = {
  name: 'askHermes',
  description:
    "Hand a self-contained task to the person's Hermes Agent, an always-on agent on their own computer with its own memory, skills, and tools, and return its answer. Use it for work that benefits from what Hermes remembers or can do on its machine. Hermes acts on its own computer under its own rules; your approvals do not reach it, so say plainly when a result came from Hermes.",
  schema,
  risk: 'network',
  async preview(args) {
    return { summary: `Ask Hermes: ${args.task.slice(0, 80)}` };
  },
  async execute(args, ctx) {
    const h = ctx.currents?.hermes;
    if (!h) {
      return {
        ok: false,
        content:
          'Hermes Agent is not connected on this session. Ask the person to turn on the Hermes Agent current in Settings and connect their Hermes box, then try again.',
      };
    }
    const decision = ctx.egress.check(h.baseUrl, 'cloud-api');
    if (!decision.allowed) {
      return {
        ok: false,
        content: `Hermes is not reachable under the egress policy: ${decision.reason}`,
      };
    }
    const sessionKey = ctx.sessionId ? `oscode-${ctx.sessionId}` : undefined;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (h.apiKey) headers.authorization = `Bearer ${h.apiKey}`;
    if (sessionKey) headers['x-hermes-session-id'] = sessionKey;
    try {
      const res = await fetch(`${h.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: h.model || 'hermes',
          messages: [{ role: 'user', content: args.task }],
          stream: false,
        }),
        signal: ctx.signal,
      });
      if (!res.ok) {
        return {
          ok: false,
          content: `Hermes answered ${res.status}. Check the box is up and the address ends in /v1.`,
        };
      }
      const data = (await res.json()) as ChatCompletion;
      if (data.error?.message) return { ok: false, content: `Hermes error: ${data.error.message}` };
      const text = contentText(data).trim();
      if (!text) return { ok: false, content: 'Hermes returned an empty answer.' };
      return { ok: true, content: `Hermes answered:\n\n${capContent(text)}` };
    } catch (err) {
      if (ctx.signal?.aborted) return { ok: false, content: 'Stopped.' };
      return { ok: false, content: `Could not reach Hermes: ${(err as Error).message}` };
    }
  },
};
