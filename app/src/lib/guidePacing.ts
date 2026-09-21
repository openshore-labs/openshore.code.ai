// One-step pacing for a guide chat (tenet 4): the goal, the plan in one line,
// and step one, then advance on the person's reply. A seeded turn is also the
// model's history, so hiding steps two onward from the screen hides them from
// the model too. Pacing is therefore only honest where the answering model
// already holds the remaining steps: Harbor Light recites three walkthroughs
// verbatim from its system prompt (harborMini.ts). Everywhere else the full
// plan stays visible, and when no model can answer at all, the plan is the
// whole guide and a plain note says so.
import type { SetupGuide, SetupGuideId } from './setupGuides.js';
import { guideOpening } from './setupGuides.js';

/** The guides Harbor Light carries verbatim (guideStepsCompact in its prompt),
 *  so it can give step two without inventing it. guidePacing.test.ts pins this
 *  list against the prompt source. */
export const GUIDES_PACED_BY_HARBOR_LIGHT: readonly SetupGuideId[] = [
  'get-harbor',
  'get-harbor-master',
  'connect-cloud-key',
  'pick-a-model',
];

/** The honest second seed when nothing can answer: no pretending. */
export const NO_BRAIN_GUIDE_NOTE =
  'No model can answer here yet, so nothing will pretend to. Follow the steps above at your own pace. When a model is set up, tap the model pill under the message box and pick it, and this chat can take it from there.';

function stepBody(s: SetupGuide['steps'][number]): string {
  return typeof s === 'string' ? s : `${s.text}\n\n\`\`\`\n${s.paste}\n\`\`\``;
}

/** Goal, the plan in one line, step one in full, and the ask that advances. */
export function guideOpeningPaced(g: SetupGuide): string {
  const n = g.steps.length;
  const first = g.steps[0];
  if (!first) return guideOpening(g);
  return [
    `Let's get this done: ${g.goal}`,
    '',
    `The plan, in one line: ${n} step${n === 1 ? '' : 's'}. One at a time, and you can ask anything in between.`,
    '',
    `Step 1 of ${n}: ${stepBody(first)}`,
    '',
    n > 1
      ? 'Tell me when it is done, or where it stopped, and I will give you step 2.'
      : `How you know it worked: ${g.done}`,
  ].join('\n');
}

/** The opening to seed for a guide on a given brain. */
export function pacedOpeningFor(g: SetupGuide, brain: { harborLight: boolean }): string {
  if (brain.harborLight && GUIDES_PACED_BY_HARBOR_LIGHT.includes(g.id)) {
    return guideOpeningPaced(g);
  }
  return guideOpening(g);
}
