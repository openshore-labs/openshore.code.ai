// Let the agent drive Codemagic: trigger a build, read its status, and read the
// failure (redacted). This is the engine side of App Launch. The person's BYO
// Codemagic token is injected per session (ctx.codemagic), delivered ONLY to
// this local, on-device engine and never to a remote hub, the same stance the
// project secrets take. The tool self-degrades to "not connected here" when no
// token was delivered, so registering it is safe.
//
// One tool, one gate: every call is risk 'cloud-spend', so the client's
// Codemagic Access switch is the sole thing that green-lights it (a build costs
// build minutes, and reads ride the same switch for one clear consent). Build
// logs pass through the shared redact-then-extract safety before any text is
// returned, so the model only ever sees a redacted, truncated excerpt.
import { z } from 'zod';
import type { ToolDef } from './index.js';
import {
  type BuildArtifact,
  logArtifacts,
  normalizeStatus,
  isTerminal,
  safeLogExcerpt,
} from '../codemagic/safety.js';

const CODEMAGIC_BASE = 'https://api.codemagic.io';

const schema = z.object({
  action: z
    .enum(['trigger', 'status', 'logs'])
    .describe(
      "'trigger' starts a build (returns its buildId), 'status' reads a build's current state, 'logs' returns the redacted failure excerpt of a build.",
    ),
  buildId: z
    .string()
    .optional()
    .describe('The build to read. Required for status and logs; it is the id trigger returns.'),
  branch: z
    .string()
    .optional()
    .describe('Override the branch for a trigger. Defaults to the saved launch target branch.'),
});

function authHeaders(token: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-auth-token': token };
}

async function triggerBuild(
  token: string,
  input: { appId: string; workflowId: string; branch: string },
): Promise<string> {
  const res = await fetch(`${CODEMAGIC_BASE}/builds`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Codemagic could not start the build (${res.status}).`);
  const data = (await res.json()) as { buildId?: string };
  if (!data.buildId) throw new Error('Codemagic did not return a build id.');
  return data.buildId;
}

async function getBuild(
  token: string,
  buildId: string,
): Promise<{ status: ReturnType<typeof normalizeStatus>; artefacts: BuildArtifact[] }> {
  const res = await fetch(`${CODEMAGIC_BASE}/builds/${encodeURIComponent(buildId)}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Codemagic build lookup failed (${res.status}).`);
  const data = (await res.json()) as { build?: { status?: string; artefacts?: BuildArtifact[] } };
  return { status: normalizeStatus(data.build?.status), artefacts: data.build?.artefacts ?? [] };
}

async function fetchLogText(token: string, artifact: BuildArtifact): Promise<string> {
  let url = artifact.url;
  // A bare secureFilename (not an http URL) needs a minted temporary URL.
  if (url && !/^https?:/.test(url)) {
    const res = await fetch(`${CODEMAGIC_BASE}/artifacts/${encodeURIComponent(url)}/public-url`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    if (res.ok) url = ((await res.json()) as { url?: string }).url;
  }
  if (!url) throw new Error('That log has no reachable URL.');
  const res = await fetch(url, { headers: { 'x-auth-token': token } });
  if (!res.ok) throw new Error(`Could not download the log (${res.status}).`);
  return res.text();
}

/** Fetch a build's logs and return a redacted, extracted excerpt (safety first). */
async function buildLogExcerpt(token: string, artefacts: BuildArtifact[]): Promise<string> {
  const logs = logArtifacts(artefacts);
  if (!logs.length) return 'No log artifacts were published for this build.';
  const texts: string[] = [];
  for (const a of logs.slice(0, 3)) {
    try {
      texts.push(safeLogExcerpt(await fetchLogText(token, a)));
    } catch {
      // Skip a log we cannot read; others may still help.
    }
  }
  return texts.filter(Boolean).join('\n\n---\n\n') || 'The published logs could not be read.';
}

export const codemagicTool: ToolDef<typeof schema> = {
  name: 'codemagic',
  description:
    'Drive an App Launch build on Codemagic: trigger a build, check its status, and read the redacted failure log so you can fix the repo and build again until it is green. Use the saved launch target; you can override the branch on a trigger. Poll status until it reaches a terminal state (finished, failed, canceled, timeout).',
  schema,
  risk: 'cloud-spend',
  async preview(args) {
    if (args.action === 'trigger') {
      return { summary: `Codemagic: trigger a build${args.branch ? ` on ${args.branch}` : ''}` };
    }
    return { summary: `Codemagic: ${args.action}${args.buildId ? ` ${args.buildId}` : ''}` };
  },
  async execute(args, ctx) {
    const cm = ctx.codemagic;
    if (!cm?.token) {
      return {
        ok: false,
        content:
          'Codemagic is not connected on this session. Ask the person to connect Codemagic and turn on Codemagic Access in App Launch, then try again.',
      };
    }
    try {
      if (args.action === 'trigger') {
        const target = cm.target;
        if (!target?.appId || !target?.workflowId) {
          return {
            ok: false,
            content:
              'No launch target is set. Ask the person to set the app id, workflow, and branch in App Launch first.',
          };
        }
        const branch = args.branch?.trim() || target.branch;
        const buildId = await triggerBuild(cm.token, {
          appId: target.appId,
          workflowId: target.workflowId,
          branch,
        });
        return {
          ok: true,
          content: `Build started on ${branch}. buildId: ${buildId}. Poll it with action "status" until it reaches a terminal state, then read "logs" if it failed.`,
        };
      }
      if (!args.buildId) {
        return { ok: false, content: `action "${args.action}" needs a buildId (from trigger).` };
      }
      if (args.action === 'status') {
        const info = await getBuild(cm.token, args.buildId);
        const done = isTerminal(info.status);
        const tail =
          info.status === 'failed'
            ? ' It failed. Read "logs" for the redacted failure, fix the cause, then trigger again.'
            : info.status === 'finished'
              ? ' It is green. Tell the person where it landed (TestFlight, App Store, or Google Play, per the workflow).'
              : done
                ? ''
                : ' Still running. Poll again shortly.';
        return { ok: true, content: `Build ${args.buildId} status: ${info.status}.${tail}` };
      }
      // logs
      const info = await getBuild(cm.token, args.buildId);
      const excerpt = await buildLogExcerpt(cm.token, info.artefacts);
      return {
        ok: true,
        content: `Redacted failure excerpt for build ${args.buildId} (secrets already stripped):\n\n${excerpt}`,
      };
    } catch (err) {
      return { ok: false, content: `Codemagic call failed: ${(err as Error).message}` };
    }
  },
};
