// B5 (chat review A): the + was dead on a local model. The whole tray was
// refused when the brain could not read images, text files included, and the
// refusal named one cloud vendor in a local-first product. Now only images
// (and video, which becomes images) are gated by visionSupported; text files
// and the tray itself always work; the copy is vendor-neutral.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IMAGE_UNSUPPORTED, VIDEO_UNSUPPORTED } from '../src/components/Composer.js';

const composer = readFileSync(join(process.cwd(), 'src/components/Composer.tsx'), 'utf8');

describe('attach on every brain (B5)', () => {
  it('names no vendor when a model cannot read images', () => {
    for (const line of [IMAGE_UNSUPPORTED, VIDEO_UNSUPPORTED]) {
      expect(line).not.toMatch(/Claude|OpenAI|Gemini|Anthropic/);
      expect(line).toMatch(/your Stack/);
      expect(line).toMatch(/cloud model that reads images/);
    }
    expect(composer).not.toMatch(/Switch to Claude/);
  });

  it('the + opens the tray or the file picker whatever the brain', () => {
    const start = composer.indexOf('const addTap = ');
    const body = composer.slice(start, composer.indexOf('};', start));
    expect(body).not.toMatch(/if \(!visionSupported\)/);
    expect(body).toMatch(/setTray\(true\)/);
  });

  it('the + is never muted; only an image is refused', () => {
    expect(composer).not.toMatch(/composer-add press-fb\$\{visionSupported \? '' : ' muted'\}/);
    // Images and video still ask the gate at drop time and at send time.
    expect(composer).toMatch(/images\.length[\s\S]{0,80}!visionSupported/);
    expect(composer).toMatch(/const outgoing = visionSupported \? attachments/);
  });
});
