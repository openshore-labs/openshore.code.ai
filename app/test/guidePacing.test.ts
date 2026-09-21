// One-step pacing (tenet 4): a guide chat opens with the goal, the plan in one
// line, and step one, and advances on the person's reply. Pacing is only
// honest where the answering model actually holds the remaining steps, which
// today is Harbor Lite with its three scripted walkthroughs; everywhere else
// the full plan stays visible so nothing is invented.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETUP_GUIDES } from '../src/lib/setupGuides.js';
import {
  GUIDES_PACED_BY_HARBOR_LIGHT,
  NO_BRAIN_GUIDE_NOTE,
  guideOpeningPaced,
  pacedOpeningFor,
} from '../src/lib/guidePacing.js';

describe('guideOpeningPaced', () => {
  it('seeds the goal, a one-line plan, and step one only', () => {
    const g = SETUP_GUIDES['get-harbor'];
    const text = guideOpeningPaced(g);
    expect(text).toContain(g.goal);
    expect(text).toMatch(/The plan, in one line: 3 steps\./);
    expect(text).toContain('Step 1 of 3');
    const step1 = g.steps[0];
    const step2 = g.steps[1];
    expect(text).toContain(typeof step1 === 'string' ? step1 : step1.text);
    expect(text).not.toContain(typeof step2 === 'string' ? step2 : step2.text);
    expect(text).toMatch(/step 2/);
  });

  it('keeps a paste on step one as its own fenced block', () => {
    const text = guideOpeningPaced(SETUP_GUIDES['install-ollama']);
    expect(text).toContain('```\ncurl -fsSL https://ollama.com/install.sh | sh\n```');
    expect(text).not.toContain('ollama list');
  });
});

describe('where pacing is honest', () => {
  it('names exactly the guides Harbor Lite recites verbatim', () => {
    const mini = readFileSync(join(process.cwd(), 'src/lib/harborMini.ts'), 'utf8');
    for (const id of GUIDES_PACED_BY_HARBOR_LIGHT) {
      expect(mini).toContain(`guideStepsCompact('${id}')`);
    }
    // Every scripted guide in the prompt is paced, none is missed.
    const scripted = [...mini.matchAll(/guideStepsCompact\('([a-z-]+)'\)/g)].map((m) => m[1]);
    expect([...scripted].sort()).toEqual([...GUIDES_PACED_BY_HARBOR_LIGHT].sort());
  });

  it('pacedOpeningFor paces only a scripted guide on Harbor Lite', () => {
    const g = SETUP_GUIDES['get-harbor'];
    expect(pacedOpeningFor(g, { harborLight: true })).toBe(guideOpeningPaced(g));
    expect(pacedOpeningFor(g, { harborLight: false })).not.toBe(guideOpeningPaced(g));
    const other = SETUP_GUIDES['pair-computer'];
    expect(pacedOpeningFor(other, { harborLight: true })).not.toContain('Step 1 of');
  });

  it('the no-brain note is honest and points at the model pill', () => {
    expect(NO_BRAIN_GUIDE_NOTE).toMatch(/No model can answer here yet/);
    expect(NO_BRAIN_GUIDE_NOTE).toMatch(/model pill/);
  });
});

describe('startGuideChat opens with no brain', () => {
  const store = readFileSync(join(process.cwd(), 'src/state/store.ts'), 'utf8');
  it('no longer dead-ends on "Set up a model first"', () => {
    expect(store).not.toContain('Set up a model first (Your stack)');
    expect(store).toContain('NO_BRAIN_GUIDE_NOTE');
    expect(store).toContain('pacedOpeningFor(');
  });
  it('reports a guide download in the file unit, never 0.1 GB for 105 MB', () => {
    expect(store).not.toMatch(/\(total \/ 1e9\)\.toFixed\(1\)\} GB/);
    expect(store).toMatch(/formatBytes\(total\)/);
  });
});
