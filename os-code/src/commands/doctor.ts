// osc doctor: the whole rig on one page. Every line is a link in the chain
// with a state, a plain sentence, and, when broken, the ONE action that
// fixes it, runnable as printed.
import { existsSync } from 'node:fs';
import { banner, t } from '../brand/theme.js';
import { loadConfig, loadVaultDir } from '../config/load.js';
import { ProviderRegistry } from '../providers/registry.js';
import { seatLeaves } from '../providers/types.js';
import { getAnthropicKey } from '../auth/claude.js';
import { isGithubConnected } from '../auth/github.js';
import { resolveStack, StackError } from '../router/stack.js';
import { budgetFor, detectHardware } from '../router/resourceBudget.js';
import { checkLinks } from '../connect/health.js';
import { searchProviderFor } from '../core/tools/search/index.js';
import { keyHome } from '../auth/keyHome.js';
import { listSessions } from '../daemon/session.js';
import { failLine, header, okLine, out, skipLine, warnLine } from './util.js';

export async function doctorCommand(): Promise<void> {
  out(banner('osc doctor'));

  let hardFails = 0;

  // Config.
  header('Config');
  let config;
  try {
    const loaded = loadConfig();
    config = loaded.config;
    okLine(
      loaded.sources.length
        ? `Loaded from ${loaded.sources.join(' then ')}.`
        : 'No config files yet; running on defaults. osc init writes one.',
    );
    for (const warning of loaded.warnings) warnLine(warning);
  } catch (err) {
    failLine((err as Error).message);
    process.exitCode = 1;
    return;
  }

  // Hardware.
  header('Hardware');
  const hardware = detectHardware();
  const budget = budgetFor(
    hardware,
    config.resourceBudget.vramProfile === 'auto' ? undefined : config.resourceBudget.vramProfile,
  );
  okLine(budget.summary);

  // Stack.
  header('Stack');
  const providers = new ProviderRegistry(config, getAnthropicKey);
  try {
    const stack = resolveStack(config, providers);
    // Where it runs, judged as a seat (seatLeaves), so a cloud tag on this
    // computer's Ollama reads cloud.
    const where = seatLeaves(stack.orchestrator.provider, stack.orchestrator.ref.model)
      ? 'cloud'
      : 'local';
    okLine(
      `Orchestrator: ${stack.orchestrator.ref.model} on ${stack.orchestrator.ref.provider} (${where}).`,
    );
    for (const [role, resolved] of Object.entries(stack.specialists)) {
      const health = await resolved!.provider.health();
      if (health.ok) okLine(`${role} specialist: ${resolved!.ref.model}.`);
      else warnLine(`${role} specialist (${resolved!.ref.model}): ${health.detail}`);
    }
    if (stack.imageGen) {
      const image = providers.imageProvider();
      if (image) {
        const health = await image.health();
        if (health.ok) okLine(`imageGen specialist: ${health.detail}`);
        else warnLine(`imageGen specialist: ${health.detail}`);
      }
    }
    for (const note of stack.notes) warnLine(note);
    if (!Object.keys(stack.specialists).length && !stack.imageGen) {
      skipLine(
        'No specialists enabled. The orchestrator does everything itself, which is a fully supported setup.',
      );
    }
  } catch (err) {
    if (err instanceof StackError) {
      failLine(err.message, 'osc init');
      hardFails++;
    } else throw err;
  }

  // Cloud account.
  header('Cloud (optional)');
  if (getAnthropicKey()) {
    const cloud = providers.all().find(([, p]) => p.kind === 'cloud');
    if (cloud) {
      const health = await cloud[1].health();
      if (health.ok) {
        const home = keyHome();
        okLine(`${health.detail} Keys stay in ${home.where}.`);
        if (home.caveat) out(t.muted(home.caveat));
      } else warnLine(health.detail, 'osc login');
    } else {
      warnLine(
        'An Anthropic key is stored but no anthropic provider is in your config. Add one to use it.',
        'osc login',
      );
    }
  } else {
    skipLine(
      'No Claude account connected. Local-only is a complete setup; osc login adds cloud escalation.',
    );
  }

  // GitHub.
  header('GitHub (optional)');
  if (isGithubConnected()) okLine('GitHub token present.');
  else skipLine('Not connected. osc auth github enables push and pull requests.');

  // Web search.
  header('Web search');
  const search = searchProviderFor(config.search);
  if (!config.egress.webEnabled) {
    warnLine(
      'Web access is switched off (egress.webEnabled). The agent works from local knowledge only.',
    );
  } else {
    okLine(`Backend: ${search.describe()}.`);
    if (config.egress.allowlist.length)
      okLine(`Egress allowlist active (${config.egress.allowlist.length} hosts).`);
  }

  // Connectivity links.
  header('Connectivity');
  const links = await checkLinks(config, providers);
  for (const link of links) {
    if (link.state === 'ok') okLine(`${link.label}: ${link.detail}`);
    else if (link.state === 'fail') {
      failLine(`${link.label}: ${link.detail}`, link.fix);
      if (link.id === 'ollama' || link.id === 'model') hardFails++;
    } else if (link.state === 'warn') warnLine(`${link.label}: ${link.detail}`, link.fix);
    else skipLine(`${link.label}: ${link.detail}${link.fix ? ` (${link.fix})` : ''}`);
  }

  // Vault. The folder every surface resolves to (machine config only), so a
  // person can check where the agent's notes land. An unusable vault.dir is
  // named under Config above.
  header('Vault');
  const vault = loadVaultDir();
  okLine(`The agent's vault: ${vault.dir}${existsSync(vault.dir) ? '' : ' (not created yet)'}.`);

  // Sessions.
  const sessions = listSessions();
  if (sessions.length) {
    header('Sessions');
    okLine(
      `${sessions.length} stored session${sessions.length === 1 ? '' : 's'}; osc attach reconnects to the latest.`,
    );
  }

  out();
  if (hardFails) {
    out(
      t.warn(
        `Something above needs attention before osc can run a task. Each ${t.danger('✗')} names its one-line fix.`,
      ),
    );
    process.exitCode = 1;
  } else {
    out(t.ok('Everything that matters is healthy. Open a repo and run osc.'));
  }
}
