// osc market: browse and install from the curated catalog. Plain language
// first ("great at code", "can read screenshots"), benchmark detail one
// keystroke away, everything filtered against what this machine can run.
// Weights pull straight from the source; the license shows before anything
// downloads.
import { t, GLYPHS } from '../brand/theme.js';
import { loadConfig, saveGlobalConfig } from '../config/load.js';
import type { OscConfig } from '../config/schema.js';
import { EgressPolicy } from '../core/security/egress.js';
import { budgetFor, detectHardware } from '../router/resourceBudget.js';
import { findModel, loadCatalog, rateModels } from '../market/catalog.js';
import { installModel, licenseNotice } from '../market/install.js';
import { CAPABILITIES } from '../router/roles.js';
import { confirm, fmtBytes, header, okLine, out, progressBar, warnLine } from './util.js';

/** The base URL of the first local (openai-compatible) provider, for pulls. */
function ollamaBaseUrl(config: OscConfig): string {
  for (const endpoint of Object.values(config.providers)) {
    if (endpoint.kind === 'openai-compatible') return endpoint.baseUrl;
  }
  return 'http://localhost:11434';
}

export async function marketBrowseCommand(): Promise<void> {
  const { config } = loadConfig();
  const { catalog, source, note } = await loadCatalog(config, new EgressPolicy(config.egress));
  const budget = budgetFor(detectHardware());
  if (note) out(t.muted(note));

  header(`The catalog (${catalog.models.length} models, ${source})`);
  out(t.muted(`  Your machine: ${budget.summary}`));
  out();
  for (const { model, fit } of rateModels(catalog, budget)) {
    const fitMark =
      fit === 'fits'
        ? t.ok('fits')
        : fit === 'tight'
          ? t.warn('tight fit')
          : t.danger(`needs more VRAM`);
    const blessed = model.blessed ? t.local(` ${GLYPHS.ok} blessed`) : '';
    const plain = model.categories.map((c) => CAPABILITIES[c].plain).join(', ');
    out(`  ${t.bold(model.id.padEnd(20))} ${t.text(model.tagline)}`);
    out(
      `  ${''.padEnd(20)} ${t.muted(`${plain} ${GLYPHS.bullet} ${model.sizeGB} GB ${GLYPHS.bullet} ${model.license.id} ${GLYPHS.bullet}`)} ${fitMark}${blessed}`,
    );
  }
  out();
  out(
    t.muted(
      `  osc market install <id> pulls one ${GLYPHS.bullet} osc market details <id> shows the benchmark detail ${GLYPHS.bullet} osc market presets lists starter stacks`,
    ),
  );
}

export async function marketDetailsCommand(id: string): Promise<void> {
  const { config } = loadConfig();
  const { catalog } = await loadCatalog(config, new EgressPolicy(config.egress));
  const model = findModel(catalog, id);
  if (!model) {
    warnLine(`Nothing in the catalog called "${id}". osc market lists everything.`);
    process.exitCode = 1;
    return;
  }
  header(model.name);
  out(`  ${t.text(model.tagline)}`);
  out(`  ${t.muted('curator note:')} ${t.text(model.curation.note)}`);
  out(
    `  ${t.muted('size:')} ${model.sizeGB} GB (${model.quantization}) ${t.muted('context:')} ${model.contextTokens.toLocaleString()} tokens`,
  );
  out(
    `  ${t.muted('orchestrator capable:')} ${model.orchestratorCapable ? 'yes' : 'no, specialist only'}`,
  );
  out(
    `  ${t.muted('categories:')} ${model.categories.map((c) => `${CAPABILITIES[c].plain} (${CAPABILITIES[c].benchmarks.join(', ')})`).join('; ')}`,
  );
  if (model.benchmarks) {
    out(
      `  ${t.muted('benchmarks:')} ${Object.entries(model.benchmarks)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')}`,
    );
  }
  out(
    `  ${t.muted('license:')} ${model.license.name}${model.license.note ? `. ${model.license.note}` : ''}`,
  );
  out(`  ${t.muted('pull:')} ${t.local(model.source.pullCommand)}`);
}

export async function marketInstallCommand(id: string): Promise<void> {
  const { config } = loadConfig();
  const { catalog } = await loadCatalog(config, new EgressPolicy(config.egress));
  const model = findModel(catalog, id);
  if (!model) {
    warnLine(`Nothing in the catalog called "${id}". osc market lists everything.`);
    process.exitCode = 1;
    return;
  }
  const budget = budgetFor(detectHardware());
  header(`Install ${model.name} (${model.sizeGB} GB)`);
  out(t.muted(licenseNotice(model)));
  const fit = rateModels({ ...catalog, models: [model] }, budget)[0]!.fit;
  if (fit === 'too-big') {
    warnLine(
      `Honest warning: this machine has room for about ${budget.maxModelGB} GB and this model wants ~${Math.ceil(model.sizeGB * 1.2)} GB. It may not load, or may crawl.`,
    );
  } else if (fit === 'tight') {
    warnLine('Tight fit: it will run, with slower responses when context gets long.');
  }
  if (!(await confirm('Pull it now?', fit !== 'too-big'))) {
    out(t.muted('Nothing downloaded.'));
    return;
  }
  const result = await installModel(
    model,
    (p) => {
      if (p.percent !== undefined) {
        const size =
          p.total && p.completed !== undefined
            ? `${fmtBytes(p.completed)}/${fmtBytes(p.total)}`
            : p.line;
        process.stdout.write(
          `\r  ${progressBar(p.percent, 22)}  ${t.muted(String(size).slice(0, 30).padEnd(30))}`,
        );
      } else {
        process.stdout.write(`\r  ${t.muted(p.line.slice(0, 54).padEnd(54))}`);
      }
    },
    { baseUrl: ollamaBaseUrl(config) },
  );
  process.stdout.write('\n');
  if (result.ok) {
    okLine(result.detail);
    out(
      t.muted(
        `  Wire it in: osc stack use ${model.source.ref} (orchestrator) or osc stack enable <role> ${model.source.ref}`,
      ),
    );
  } else {
    warnLine(result.detail);
    process.exitCode = 1;
  }
}

export async function marketPresetsCommand(apply?: string): Promise<void> {
  const { config } = loadConfig();
  const { catalog } = await loadCatalog(config, new EgressPolicy(config.egress));
  if (!apply) {
    header('Starter stacks');
    for (const preset of catalog.presets) {
      out(`  ${t.bold(preset.id.padEnd(14))} ${t.text(preset.name)}. ${t.muted(preset.tagline)}`);
    }
    out();
    out(
      t.muted(
        '  osc market presets --apply <id> writes one into your config (osc init walks the same choice with downloads).',
      ),
    );
    return;
  }
  const preset = catalog.presets.find((p) => p.id === apply);
  if (!preset) {
    warnLine(`No preset "${apply}".`);
    process.exitCode = 1;
    return;
  }
  const orchestrator = findModel(catalog, preset.stack.orchestrator);
  const specialists: Record<string, { provider: string; model: string }> = {};
  for (const [role, id] of Object.entries(preset.stack.specialists)) {
    if (!id) continue;
    const entry = findModel(catalog, id);
    if (entry) specialists[role] = { provider: 'ollama', model: entry.source.ref };
  }
  saveGlobalConfig({
    stack: {
      orchestrator: {
        provider: 'ollama',
        model: orchestrator?.source.ref ?? preset.stack.orchestrator,
      },
      specialists,
    },
  });
  okLine(
    `Stack set to "${preset.name}". Models that are not pulled yet: osc doctor will name them with the pull command.`,
  );
}
