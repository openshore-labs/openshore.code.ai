// The client-side Codemagic tool: the phone equivalent of the engine's
// codemagic tool, so a model chatting on the phone can drive App Launch builds
// with the same three actions (trigger, status, logs). The handler runs here on
// the device, using the on-device REST client (token in the Keychain), so the
// token never leaves the phone. Build logs pass through the same shared
// redact-then-extract safety before any text reaches the model.
//
// StackDriver offers this tool only when Codemagic Access is on (and Codemagic
// is connected), so the switch is the sole gate, matching the engine side. No em
// dashes anywhere.
import { storeGetJson } from './platform.js';
import { triggerBuild, getBuild, buildLogExcerpt, isTerminal } from './codemagic.js';
import type { LaunchTarget } from '../state/types.js';

export const CODEMAGIC_TOOL_NAME = 'codemagic';

/** The tool as offered to an Anthropic model (JSON-schema input). Kept in step
 *  with the engine tool's schema so the model drives both the same way. */
export const codemagicToolSpec = {
  name: CODEMAGIC_TOOL_NAME,
  description:
    'Drive an App Launch build on Codemagic: trigger a build, check its status, and read the redacted failure log so you can tell the person exactly what to fix and build again until it is green. Use the saved launch target; you can override the branch on a trigger. Poll status until it reaches a terminal state (finished, failed, canceled, timeout), then report where it landed (TestFlight, App Store, or Google Play).',
  input_schema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['trigger', 'status', 'logs'],
        description:
          "'trigger' starts a build (returns its buildId), 'status' reads a build's current state, 'logs' returns the redacted failure excerpt of a build.",
      },
      buildId: {
        type: 'string',
        description: 'The build to read. Required for status and logs; the id trigger returns.',
      },
      branch: {
        type: 'string',
        description:
          'Override the branch for a trigger. Defaults to the saved launch target branch.',
      },
    },
    required: ['action'],
  },
};

export interface CodemagicToolInput {
  action: 'trigger' | 'status' | 'logs';
  buildId?: string;
  branch?: string;
}

/** The same tool in OpenAI / BYOM function-calling shape, so the model drives
 *  every network backend the same way (built-in OpenAI-compatible providers and
 *  a bring-your-own-model endpoint both speak this). */
export const codemagicOpenAiTool = {
  type: 'function' as const,
  function: {
    name: CODEMAGIC_TOOL_NAME,
    description: codemagicToolSpec.description,
    parameters: codemagicToolSpec.input_schema,
  },
};

/** Parse a tool call's arguments (a JSON string from the model) into a valid
 *  input, or null when it is malformed or names an action we do not offer. The
 *  loop turns null into a short correction the model can act on. */
export function parseCodemagicArgs(argString: string | undefined): CodemagicToolInput | null {
  try {
    const o = JSON.parse(argString || '{}') as Record<string, unknown>;
    if (o.action === 'trigger' || o.action === 'status' || o.action === 'logs') {
      return {
        action: o.action,
        buildId: typeof o.buildId === 'string' ? o.buildId : undefined,
        branch: typeof o.branch === 'string' ? o.branch : undefined,
      };
    }
  } catch {
    // fall through to null
  }
  return null;
}

/** One accumulating tool call as OpenAI streams it in fragments. */
export interface ToolCallAccum {
  id: string;
  name: string;
  args: string;
}

/** Merge a streamed `delta.tool_calls` array into the accumulator, keyed by the
 *  index OpenAI assigns each call, so fragments across chunks join up. */
export function mergeToolCallDeltas(
  acc: Map<number, ToolCallAccum>,
  deltas:
    | Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>
    | undefined,
): void {
  for (const d of deltas ?? []) {
    const idx = d.index ?? 0;
    const cur = acc.get(idx) ?? { id: '', name: '', args: '' };
    if (d.id) cur.id = d.id;
    if (d.function?.name) cur.name = d.function.name;
    if (typeof d.function?.arguments === 'string') cur.args += d.function.arguments;
    acc.set(idx, cur);
  }
}

/** Finalize the accumulator into an ordered list of complete tool calls. */
export function finalizeToolCalls(acc: Map<number, ToolCallAccum>): ToolCallAccum[] {
  return [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

async function savedTarget(): Promise<LaunchTarget | undefined> {
  const settings = await storeGetJson<{ launch?: { target?: LaunchTarget } }>('oscode.settings.v1');
  return settings?.launch?.target;
}

/** Execute one Codemagic action and return the observation the model reads.
 *  Mirrors the engine tool so the two surfaces behave identically. Never throws;
 *  a failure comes back as text the model can act on. */
export async function runCodemagicTool(input: CodemagicToolInput): Promise<string> {
  try {
    if (input.action === 'trigger') {
      const target = await savedTarget();
      if (!target?.appId || !target?.workflowId) {
        return 'No launch target is set. Ask the person to set the app id, workflow, and branch in App Launch first.';
      }
      const branch = input.branch?.trim() || target.branch;
      const buildId = await triggerBuild({
        appId: target.appId,
        workflowId: target.workflowId,
        branch,
      });
      return `Build started on ${branch}. buildId: ${buildId}. Poll it with action "status" until it reaches a terminal state, then read "logs" if it failed.`;
    }
    if (!input.buildId) {
      return `action "${input.action}" needs a buildId (from trigger).`;
    }
    if (input.action === 'status') {
      const info = await getBuild(input.buildId);
      const done = isTerminal(info.status);
      const tail =
        info.status === 'failed'
          ? ' It failed. Read "logs" for the redacted failure, tell the person the fix, then trigger again once they have applied it.'
          : info.status === 'finished'
            ? ' It is green. Tell the person where it landed (TestFlight, App Store, or Google Play, per the workflow).'
            : done
              ? ''
              : ' Still running. Poll again shortly.';
      return `Build ${input.buildId} status: ${info.status}.${tail}`;
    }
    // logs
    const info = await getBuild(input.buildId);
    const excerpt = await buildLogExcerpt(info);
    return `Redacted failure excerpt for build ${input.buildId} (secrets already stripped):\n\n${excerpt}`;
  } catch (err) {
    return `Codemagic call failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** The system-prompt line that tells a phone model it can drive Codemagic, added
 *  only when Codemagic Access is on. Names the loop and the honest limit: the
 *  phone cannot edit the repo, so code fixes are described for the person (or
 *  handed to a paired desktop), while build-target retries it can do itself. */
export function codemagicSystemNote(): string {
  return [
    'You can drive App Launch builds with the codemagic tool (trigger, status, logs).',
    'Flow: trigger a build, poll status until it reaches a terminal state, and if it failed read logs, find the single root cause, and tell the person the exact fix.',
    'You are on the phone, so you cannot edit the repo here: describe the code fix for the person (or their paired desktop) to apply, then trigger again once they confirm. You may retry directly for a transient failure or a build-target change.',
    'When it goes green, tell the person plainly where it landed (TestFlight, the App Store, or Google Play, per the workflow).',
  ].join(' ');
}
