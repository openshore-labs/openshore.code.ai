// The empty chat's landing greeting rolls in on the swell once per session
// (Creative Studio brand sweep, 2026-09-24); later landings and language taps
// keep the crossfade, and a settled line is plain text.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SwellText } from '../src/components/SwellText.js';
import { LANDING_PACE, inkDurationMs, takeLandingSwell } from '../src/lib/introWalk.js';

describe('the landing greeting swell', () => {
  it('plays once per session', () => {
    expect(takeLandingSwell()).toBe(true);
    expect(takeLandingSwell()).toBe(false);
  });

  it('splits the line into nowrap words of stamped characters, read whole by assistive tech', () => {
    const html = renderToStaticMarkup(
      createElement(SwellText, { text: 'Good morning.', pace: LANDING_PACE }),
    );
    expect(html).toContain('class="ink-swell" aria-label="Good morning."');
    expect(html.match(/class="iw"/g)).toHaveLength(2);
    expect(html.match(/class="ic"/g)).toHaveLength('Goodmorning.'.length);
    expect(html).toContain('--d:30ms');
  });

  it('lands a short greeting in a little over a second', () => {
    const ms = inkDurationMs('Good morning, Captain.', LANDING_PACE);
    expect(ms).toBeGreaterThan(900);
    expect(ms).toBeLessThan(1800);
  });
});
