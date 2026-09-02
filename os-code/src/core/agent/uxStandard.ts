// The UX standard every coding model builds to, by default. OpenShore is a
// machine that builds usable software, so what it generates should be premium
// out of the box: the twenty laws of UX (founder, 2026-09-02) plus the house
// motion and honesty bar, written as build instructions the model can act on,
// not as names to recite. Injected into the coding agent's system prompt when
// config.ux.standard is 'premium' (the default). A project can turn it off in
// os-code.config.json, a person can say "skip the UX standard" in the chat,
// and config.ux.notes adds a project's own rules on top. No em dashes.

export interface UxLaw {
  name: string;
  /** What to do in the code, one line. */
  rule: string;
}

export const UX_LAWS: UxLaw[] = [
  {
    name: "Hick's law",
    rule: 'Fewer choices per screen. Group or hide the rest behind one clear next step; a first-run screen offers one recommended path.',
  },
  {
    name: "Fitts's law",
    rule: 'Primary actions are big, close to the thumb or cursor, and full-width on phones; touch targets are at least 44 by 44 points with space between them.',
  },
  {
    name: "Jakob's law",
    rule: 'Use the conventions people already know from the platform (navigation, sheets, back, pull to refresh). Be surprising in content, never in mechanics.',
  },
  {
    name: 'Law of proximity',
    rule: 'Related controls sit together; unrelated ones get whitespace between them. Spacing communicates grouping before any line or box does.',
  },
  {
    name: "Miller's law",
    rule: 'Chunk information into small groups (about five to seven). Long lists get sections, search, or progressive disclosure.',
  },
  {
    name: 'Doherty threshold',
    rule: 'Respond within 400 ms or show progress: optimistic UI, skeletons, and streaming, so the interface always answers the hand.',
  },
  {
    name: 'Von Restorff effect',
    rule: 'Make the one thing that matters visually distinct (the primary action, the current state). Everything else is quiet.',
  },
  {
    name: 'Minimize target distance',
    rule: 'Put the next action where the eye and the hand already are: confirm buttons near the thing being confirmed, inline follow-ups, not a trip across the screen.',
  },
  {
    name: 'Serial position effect',
    rule: 'The most important items go first and last in any list or menu; the middle is for the rest.',
  },
  {
    name: 'Peak-end rule',
    rule: 'Design the high point and the ending on purpose: a satisfying completion state, a clear success message, a graceful exit. The last thing they see is the thing they remember.',
  },
  {
    name: 'Zeigarnik effect',
    rule: 'Show progress toward completion (steps done, what is left) so unfinished work pulls people back instead of nagging them.',
  },
  {
    name: 'Law of Pragnanz',
    rule: 'Prefer the simplest possible layout. If a screen needs explaining, simplify the screen.',
  },
  {
    name: 'Law of similarity',
    rule: 'Things that behave the same look the same. One button style per role, one card shape, one set of tokens; never a one-off.',
  },
  {
    name: 'Uniform connectedness',
    rule: 'Visually connect what belongs together (a shared container, a line, a background) so relationships are seen, not inferred.',
  },
  {
    name: "Tesler's law",
    rule: 'Complexity that cannot be removed moves to the system, not the person: sensible defaults, auto-detection, remembered choices.',
  },
  {
    name: "Postel's law",
    rule: 'Accept input generously (paste with spaces, either date format, any capitalization) and emit output strictly and predictably.',
  },
  {
    name: 'Aesthetic-usability effect',
    rule: 'Make it beautiful: real typography, aligned rhythm, restrained color, calm motion. People forgive small flaws in something that feels cared for.',
  },
  {
    name: "Parkinson's law",
    rule: 'Constrain scope and time in the interface: short forms, one step at a time, a default that finishes the task without a decision.',
  },
  {
    name: "Occam's razor",
    rule: 'When two designs do the job, ship the one with fewer elements. Remove before you add.',
  },
  {
    name: 'Pareto principle',
    rule: 'Polish the twenty percent of flows people use eighty percent of the time until they are flawless; the rest can be plain.',
  },
];

// The house bar on top of the laws: calm, premium, honest. Mirrors the app's
// own motion and polish standards so generated code matches what ships.
export const HOUSE_STANDARD: string[] = [
  'Motion is calm and premium: smooth and slow feels premium. Everything that animates in animates out; animate transform and opacity, never layout; honor prefers-reduced-motion; every tappable acknowledges the touch instantly.',
  'Every state is designed: empty, loading, error, offline, and not-yet-set-up each end in a clear next action. Never a blank panel, never a raw error string, never a dead button.',
  'Copy is plain and honest, one idea per sentence, no em dashes, no jargon, no hype. Money and destructive actions get one guarantee per sentence and a confirmation.',
  'Accessibility is not optional: labels on every control, visible focus, sufficient contrast, keyboard and screen-reader paths, dynamic type that does not break layout.',
];

/** The prompt block. `notes` is a project's own additions from config.ux.notes. */
export function uxStandardPrompt(notes?: string): string {
  const laws = UX_LAWS.map((l, i) => `${i + 1}. ${l.name}: ${l.rule}`).join('\n');
  const house = HOUSE_STANDARD.map((h) => `- ${h}`).join('\n');
  const extra = notes?.trim() ? `\nThis project adds:\n${notes.trim()}\n` : '';
  return [
    'UX STANDARD (default for everything you build; the user can say "skip the UX standard" or a project can turn it off in config):',
    'Anything with a screen, a form, a list, a flow, or a message is built to this bar out of the box, without being asked. Apply these as you design and write the code, and mention in your report which of them shaped a decision when it is not obvious.',
    laws,
    'House bar:',
    house,
    extra,
  ].join('\n');
}
