// osc stack: view and edit the stack. The orchestrator is the one required
// role; specialists are enable/disable, one line each.
import { readFileSync, writeFileSync } from 'node:fs';
import { t } from '../brand/theme.js';
import { globalConfigPath, loadConfig, saveGlobalConfig } from '../config/load.js';
import { WINDOW_MAX, WINDOW_MIN, placeOrchestrator } from '../auth/providerKeys.js';
import { isLocalUrl } from '../core/security/egress.js';
import {
  CAPABILITIES,
  ROLE_CATEGORY,
  SPECIALIST_ROLES,
  type SpecialistRole,
} from '../router/roles.js';
import { header, okLine, out, warnLine } from './util.js';

export async function stackShowCommand(): Promise<void> {
  const { config } = loadConfig();
  header('Your stack');
  if (!config.stack.orchestrator) {
    warnLine('No orchestrator yet. Run osc init; it takes about two minutes.');
    return;
  }
  const orch = config.stack.orchestrator;
  okLine(`orchestrator  ${orch.model}  (${orch.provider})  ${t.muted('runs the show; mandatory')}`);
  for (const role of SPECIALIST_ROLES) {
    if (role === 'imageGen') {
      if (config.stack.specialists.imageGen) {
        okLine(`imageGen      local image server  ${t.muted(CAPABILITIES['image-gen'].plain)}`);
      }
      continue;
    }
    const ref = config.stack.specialists[role];
    if (ref) {
      okLine(
        `${role.padEnd(13)} ${ref.model}  (${ref.provider})  ${t.muted(CAPABILITIES[ROLE_CATEGORY[role]].plain)}`,
      );
    }
  }
  const enabled = Object.keys(config.stack.specialists).length;
  if (!enabled) {
    out(
      t.muted(
        '  No specialists enabled; the orchestrator does everything itself. That is a complete setup.',
      ),
    );
  }
  out();
  out(
    t.muted(
      'Change it: osc stack use <model> · osc stack enable <role> <model> · osc stack disable <role>',
    ),
  );
  out(
    t.muted(
      `Roles: ${SPECIALIST_ROLES.filter((r) => r !== 'imageGen').join(', ')} (osc market finds good candidates per role)`,
    ),
  );
}

export async function stackUseCommand(
  model: string,
  provider?: string,
  options: { context?: string } = {},
): Promise<void> {
  const { config } = loadConfig();
  const providerId = provider ?? config.stack.orchestrator?.provider ?? 'ollama';
  const endpoint = Object.hasOwn(config.providers, providerId)
    ? config.providers[providerId]
    : undefined;
  if (!endpoint) {
    warnLine(
      `No provider "${providerId}" in your config. Configured: ${Object.keys(config.providers).join(', ')}.`,
    );
    process.exitCode = 1;
    return;
  }
  // The window a provider off this network lists for the model (keys on your
  // server, 2026-10-09): placed the way the app places it, so a keyed
  // frontier model is not budgeted at the 8192 guess.
  if (options.context !== undefined) {
    const tokens = /^\d+$/.test(options.context.trim()) ? Number(options.context) : NaN;
    if (!(tokens >= WINDOW_MIN && tokens <= WINDOW_MAX)) {
      warnLine(
        `--context is the model's window in whole tokens, from ${WINDOW_MIN} to ${WINDOW_MAX}, like 131072.`,
      );
      process.exitCode = 1;
      return;
    }
    try {
      const placed = placeOrchestrator({ provider: providerId, model, contextTokens: tokens });
      okLine(`The orchestrator is now ${model} on ${providerId}.`);
      if (placed.contextTokens === undefined) {
        out(
          t.muted(
            endpoint.kind === 'anthropic'
              ? "OpenShore knows Claude's window, so --context is not kept for it."
              : 'A model on this network is budgeted against the window its server serves, so --context is not kept for it.',
          ),
        );
      }
    } catch (err) {
      warnLine((err as Error).message);
      process.exitCode = 1;
    }
    return;
  }
  saveGlobalConfig({ stack: { orchestrator: { provider: providerId, model } } });
  okLine(`The orchestrator is now ${model} on ${providerId}.`);
  // A provider off this network with no window kept for the model: the
  // window is guessed from its name, which for an id with no size in it is
  // small, and so is its seat.
  if (
    endpoint.kind === 'openai-compatible' &&
    !isLocalUrl(endpoint.baseUrl) &&
    !(endpoint.contextWindows && Object.hasOwn(endpoint.contextWindows, model))
  ) {
    out(
      t.muted(
        "OpenShore guesses this model's window from its name until you give the one its provider lists. Run this again with --context <tokens>.",
      ),
    );
  }
}

export async function stackEnableCommand(
  role: string,
  model: string,
  provider?: string,
): Promise<void> {
  if (!SPECIALIST_ROLES.includes(role as SpecialistRole) || role === 'imageGen') {
    warnLine(
      `"${role}" is not a specialist role. Use one of: ${SPECIALIST_ROLES.filter((r) => r !== 'imageGen').join(', ')}.`,
    );
    process.exitCode = 1;
    return;
  }
  const { config } = loadConfig();
  const providerId = provider ?? 'ollama';
  if (!config.providers[providerId]) {
    warnLine(`No provider "${providerId}" in your config.`);
    process.exitCode = 1;
    return;
  }
  saveGlobalConfig({ stack: { specialists: { [role]: { provider: providerId, model } } } });
  okLine(
    `${role} specialist enabled: ${model}. The orchestrator delegates ${CAPABILITIES[ROLE_CATEGORY[role as Exclude<SpecialistRole, 'imageGen'>]].plain} work to it.`,
  );
}

export async function stackDisableCommand(role: string): Promise<void> {
  // Deep merge cannot delete a key, so edit the global file directly.
  const path = globalConfigPath();
  let raw: Record<string, any>;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    warnLine('No global config yet; nothing to disable.');
    return;
  }
  if (!raw.stack?.specialists?.[role]) {
    warnLine(`The ${role} specialist is not enabled.`);
    return;
  }
  delete raw.stack.specialists[role];
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
  okLine(`${role} specialist disabled. The orchestrator covers that itself now, quietly.`);
}
