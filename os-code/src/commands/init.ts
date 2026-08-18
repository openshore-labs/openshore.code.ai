// osc init: the accessibility centerpiece. Nothing to a working agent in a
// few minutes: detect the machine, guide the Ollama install if needed, offer
// plain-language preset stacks that FIT this hardware, pull the starter
// model, write the config. Autodetect over ask; one choice, done.
import { banner, t } from '../brand/theme.js';
import { loadConfig, saveGlobalConfig } from '../config/load.js';
import { budgetFor, detectHardware, fitsBudget } from '../router/resourceBudget.js';
import { loadCatalog, findModel } from '../market/catalog.js';
import { installModel, licenseNotice } from '../market/install.js';
import { EgressPolicy } from '../core/security/egress.js';
import type { Catalog, CatalogPreset } from '../market/schema.js';
import { ask, confirm, header, okLine, out, pick, warnLine } from './util.js';

const OLLAMA_URL = 'http://localhost:11434';

async function ollamaUp(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function installedModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return [];
    const body = (await res.json()) as { models?: Array<{ name: string }> };
    return (body.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

export async function initCommand(): Promise<void> {
  out(banner());
  out();
  out(
    t.text(
      'Welcome. This takes about two minutes: look at your machine, pick a stack, pull a model.',
    ),
  );

  // 1. Hardware, detected, never asked.
  header('Your machine');
  const hardware = detectHardware();
  const budget = budgetFor(hardware);
  okLine(budget.summary);

  // 2. Ollama.
  header('Local model server');
  let up = await ollamaUp();
  if (up) {
    okLine('Ollama is running.');
  } else {
    warnLine('Ollama is not running. It is the engine that hosts your local models.');
    out(t.text('  Install and start it with one command in another terminal:'));
    out(t.local('    curl -fsSL https://ollama.com/install.sh | sh'));
    out(t.muted('  (Already installed? Start it with: ollama serve)'));
    for (;;) {
      await ask('Press Enter here when it is up (or type skip to configure without it):').then(
        (answer) => {
          if (answer.toLowerCase() === 'skip') up = false;
        },
      );
      if (await ollamaUp()) {
        up = true;
        okLine('There it is. Ollama is running.');
        break;
      }
      const retry = await confirm('Still not seeing it. Check again?', true);
      if (!retry) break;
    }
  }

  const already = up ? await installedModels() : [];
  if (already.length) {
    okLine(
      `Models already on this machine: ${already.slice(0, 6).join(', ')}${already.length > 6 ? ', ...' : ''}`,
    );
  }

  // 3. The stack: presets in plain language, filtered to the hardware.
  const { catalog, note } = await loadCatalog(loadConfig().config, new EgressPolicy());
  if (note) out(t.muted(`  ${note}`));

  const presets = [...catalog.presets].sort((a, b) => a.minVramGB - b.minVramGB);
  const effectiveVram = hardware.totalVramGB || Math.floor(hardware.systemRamGB / 2);
  const fitting = presets.filter((p) => p.minVramGB <= effectiveVram);
  const recommended = fitting[fitting.length - 1] ?? presets[0]!;

  const options = presets.map((preset) => {
    const orchestrator = findModel(catalog, preset.stack.orchestrator);
    const fits = preset.minVramGB <= effectiveVram;
    return {
      label: preset.name,
      detail: `${preset.tagline}${orchestrator ? ` Main model: ${orchestrator.name} (${orchestrator.sizeGB} GB).` : ''}`,
      disabled: fits
        ? undefined
        : `needs ~${preset.minVramGB} GB of VRAM, this machine has ${effectiveVram}`,
      recommended: preset.id === recommended.id,
    };
  });
  options.push({
    label: 'Use a model I already have',
    detail: already.length
      ? 'Point the stack at one of the models above, no download.'
      : 'Type any Ollama model name to use as the orchestrator.',
    disabled: undefined,
    recommended: false,
  });

  const choice = await pick(
    'Pick your starting stack (one choice, done)',
    options,
    presets.indexOf(recommended),
  );

  let orchestratorModel: string;
  const specialists: Record<string, { provider: string; model: string }> = {};

  if (choice === presets.length) {
    // Existing model path.
    if (already.length) {
      const idx = await pick(
        'Which model runs the show?',
        already.map((m) => ({ label: m })),
      );
      orchestratorModel = already[idx]!;
    } else {
      orchestratorModel = await ask('Model name (e.g. qwen2.5-coder:7b):');
    }
  } else {
    const preset = presets[choice]!;
    const resolved = resolvePreset(catalog, preset);
    orchestratorModel = resolved.orchestrator;
    Object.assign(specialists, resolved.specialists);

    // 4. Pull what is missing, license first, straight from the source.
    if (up) {
      for (const ref of resolved.toPull) {
        if (already.some((m) => m === ref || m.startsWith(`${ref}:`) || `${m}` === `${ref}:latest`))
          continue;
        const model = catalog.models.find((m) => m.source.ref === ref);
        if (model) {
          header(`Pulling ${model.name} (${model.sizeGB} GB)`);
          out(t.muted(licenseNotice(model)));
          const fit = fitsBudget(model.sizeGB, budget);
          if (fit === 'tight')
            warnLine('This one is a tight fit; expect slower responses when context runs long.');
          if (!(await confirm('Pull it now?', true))) continue;
          let lastLine = '';
          const result = await installModel(model, ({ line }) => {
            if (line !== lastLine) {
              process.stdout.write(`\r  ${t.muted(line.slice(0, 70).padEnd(70))}`);
              lastLine = line;
            }
          });
          process.stdout.write('\n');
          if (result.ok) okLine(result.detail);
          else warnLine(result.detail);
        }
      }
    } else {
      warnLine('Skipping downloads since Ollama is not up; the config will be ready when it is.');
    }
  }

  // 5. Write the config. An empty file is valid; this one is minimal and real.
  const path = saveGlobalConfig({
    providers: { ollama: { kind: 'openai-compatible', baseUrl: OLLAMA_URL } },
    stack: {
      orchestrator: { provider: 'ollama', model: orchestratorModel },
      specialists,
    },
    resourceBudget: { vramProfile: budget.profile },
  });

  header('Done');
  okLine(
    `Stack: ${orchestratorModel}${Object.keys(specialists).length ? ` + ${Object.keys(specialists).join(', ')}` : ', solo'}`,
  );
  okLine(`Config written to ${path}`);
  out();
  out(t.text('Open any repo and start:'));
  out(t.local('  cd ~/your-project && osc'));
  out();
  out(
    t.muted(
      'Later, when you want more: osc login connects Claude for the hardest tasks. osc pair puts this on your phone. osc market browses more models. Specialists stay optional.',
    ),
  );
}

function resolvePreset(
  catalog: Catalog,
  preset: CatalogPreset,
): {
  orchestrator: string;
  specialists: Record<string, { provider: string; model: string }>;
  toPull: string[];
} {
  const toPull: string[] = [];
  const orchestratorEntry = findModel(catalog, preset.stack.orchestrator);
  const orchestrator = orchestratorEntry?.source.ref ?? preset.stack.orchestrator;
  if (orchestratorEntry) toPull.push(orchestratorEntry.source.ref);
  const specialists: Record<string, { provider: string; model: string }> = {};
  for (const [role, id] of Object.entries(preset.stack.specialists)) {
    if (!id) continue;
    const entry = findModel(catalog, id);
    if (entry) {
      specialists[role] = { provider: 'ollama', model: entry.source.ref };
      toPull.push(entry.source.ref);
    }
  }
  return { orchestrator, specialists, toPull };
}
