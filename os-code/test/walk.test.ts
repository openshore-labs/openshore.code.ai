// The workspace walker skips VCS metadata and build output, and nothing else
// that a person might ask about (a CI workflow lives under .github).
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkFiles } from '../src/core/tools/walk.js';

describe('walkFiles (ENG-5)', () => {
  it('lists .github but never .git', () => {
    const root = mkdtempSync(join(tmpdir(), 'osc-walk-'));
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
    mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'dep', 'index.js'), '');
    writeFileSync(join(root, 'README.md'), '# hi\n');
    const files = [...walkFiles(root)].sort();
    expect(files).toContain(join('.github', 'workflows', 'ci.yml'));
    expect(files).toContain('README.md');
    expect(files).not.toContain(join('.git', 'HEAD'));
    expect(files.some((f) => f.startsWith('node_modules'))).toBe(false);
  });
});
