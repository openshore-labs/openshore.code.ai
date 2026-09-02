// Prefab stacks come from the catalog's presets, which are published on the
// live feed and rebuilt on a schedule, so they refresh and reassess on their
// own as models change. These are pure helpers over a preset and the catalog:
// the id list, the resolved models, and the summed size. The install itself
// (pull each model, set the orchestrator and specialists) is a UI concern and
// lives in the screen, because it drives the engine bridge.
import type { Catalog, CatalogModel, CatalogPreset } from 'os-code/protocol';

/** Catalog ids a preset installs, orchestrator first, then its specialists. */
export function presetMemberIds(preset: CatalogPreset): string[] {
  const specialists = Object.values(preset.stack.specialists ?? {}).filter(
    (v): v is string => Boolean(v),
  );
  return [preset.stack.orchestrator, ...specialists];
}

/** Specialist role -> catalog id for a preset, for enableSpecialist. */
export function presetSpecialists(preset: CatalogPreset): Array<[string, string]> {
  return Object.entries(preset.stack.specialists ?? {}).filter(
    (e): e is [string, string] => Boolean(e[1]),
  );
}

export function presetModels(preset: CatalogPreset, catalog: Catalog): CatalogModel[] {
  const byId = new Map(catalog.models.map((m) => [m.id, m]));
  return presetMemberIds(preset)
    .map((id) => byId.get(id))
    .filter((m): m is CatalogModel => Boolean(m));
}

/** Total download in GB, or undefined when a member is missing from the catalog
 *  (so the UI says "size unknown" rather than a wrong number). */
export function presetTotalGB(preset: CatalogPreset, catalog: Catalog): number | undefined {
  const models = presetModels(preset, catalog);
  if (models.length !== presetMemberIds(preset).length) return undefined;
  const total = models.reduce((sum, m) => sum + (m.sizeGB ?? 0), 0);
  return Math.round(total * 10) / 10;
}
