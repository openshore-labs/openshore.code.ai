// Founder, 2026-09-25: after downloading Harbor there was no way to pick it.
// A finished download sets a ready flag (not a deviceModels entry), so the
// model sheet listed it nowhere but inside the Stack. Now, on a phone, the
// top row is the model on this phone: Harbor once it is ready, replacing
// Harbor Lite there; Harbor Lite (with Harbor's progress under it) before.
// Harbor is also listed under Local models.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sheet = readFileSync(join(process.cwd(), 'src', 'components/ModelSheet.tsx'), 'utf8');

describe('Harbor in the model sheet', () => {
  it('puts the phone model row first, above Connect your computer', () => {
    const phoneRow = sheet.indexOf('isPhone() && (settings.harborReady');
    const connect = sheet.indexOf('main="Connect your computer"');
    expect(phoneRow).toBeGreaterThan(-1);
    expect(phoneRow).toBeLessThan(connect);
  });

  it('shows Harbor once ready, and Harbor Lite only until then', () => {
    expect(sheet).toMatch(
      /settings\.harborReady \? \([\s\S]*?pick\(harborSource\)[\s\S]*?\) : \([\s\S]*?pick\(harborLiteSource\)/,
    );
  });

  it('shows the download under Harbor Lite while Harbor comes down', () => {
    expect(sheet).toMatch(/harborComing && harborDownload \?/);
    expect(sheet).toContain('harborDownload.label');
  });

  it('lists a ready Harbor under Local models', () => {
    expect(sheet).toMatch(/settings\.harborReady && !settings\.deviceModels\[HARBOR_MODEL_ID\]/);
  });
});
