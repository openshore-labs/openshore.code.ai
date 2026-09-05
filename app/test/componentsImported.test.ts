// UI-13: no dead components. Every file under src/components is imported by
// something in src (SourcePicker sat unimported for two reviews).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe('components are all imported somewhere', () => {
  it('every file in src/components has an importer in src', () => {
    const sources = walk(SRC).map((f) => ({ path: f, text: readFileSync(f, 'utf8') }));
    const orphans: string[] = [];
    for (const entry of readdirSync(join(SRC, 'components'))) {
      const base = entry.replace(/\.(tsx?|css)$/, '');
      const re = new RegExp(`from '(\\.\\.?/)*components/${base}\\.js'|from '\\./${base}\\.js'`);
      const used = sources.some((s) => !s.path.endsWith(`/components/${entry}`) && re.test(s.text));
      if (!used) orphans.push(relative(SRC, join(SRC, 'components', entry)));
    }
    expect(orphans, `dead components: ${orphans.join(', ')}`).toEqual([]);
  });
});
