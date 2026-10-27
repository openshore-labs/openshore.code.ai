// Lessons (founder, 2026-10-27; the harness plan's step 8, brought forward):
// a project's harness adapts to the project the way a careful colleague would,
// by keeping a few short, concrete lessons from what actually happened, never
// by rewriting itself. The loop:
//
// 1. Watch outcomes, not opinions: a check that failed, an approval or a tool
//    the person turned down, a task that ended in an error or a Stop, a
//    correction in the person's own words.
// 2. At the end of a task with a setback, ask a model on the person's own
//    network one question, "is there one durable lesson here?", or take a
//    correction as the lesson itself.
// 3. The person approves every lesson. Nothing becomes standing context
//    without a tap, so text the agent read (a page, a commit message) can
//    never plant one.
// 4. Each lesson keeps a score from the tasks it rode into; one that keeps
//    riding into setbacks is marked as maybe out of date, for the person to
//    keep or remove. Only the best few ride, sized to the seat.
// 5. `osc eval` measures with and without them (tenet 2): copy says
//    "remembers what worked", never "trains itself".
//
// Pure and Node-free (tenet 5), through os-code/protocol: the app runs the
// loop for every chat; the engine reads the approved lessons in its brief.

/** One thing that happened in a task, as the harness can verify it. */
export type LessonSignal =
  | { kind: 'check-failed'; detail: string }
  | { kind: 'denied'; detail: string }
  | { kind: 'tool-failed'; detail: string }
  | { kind: 'ended'; detail: 'error' | 'aborted' | 'guardrail' }
  | { kind: 'correction'; detail: string };

/** A lesson the person approved for a project. */
export interface Lesson {
  id: string;
  /** One line, the way the person kept it. */
  text: string;
  /** What it came from, in plain words ("a check failed 3 times, 2026-10-27"). */
  source: string;
  createdAt: string;
  /** Tasks it rode into that ended well, and ones that met a setback. */
  good: number;
  bad: number;
}

/** The longest lesson kept, in characters. */
export const LESSON_MAX_CHARS = 200;
/** The most lessons a project keeps. */
export const LESSONS_MAX = 40;

// ---- 1. outcomes ---------------------------------------------------------------

/** A person's turn that corrects the model: a plain "no", a "don't", a "we
 *  use", an "actually", a "wrong". Their own words are the lesson's best
 *  source, since nobody else wrote them. */
const CORRECTION =
  /^(no[,.!]?\s|nope\b|don'?t\b|do not\b|stop\b|wrong\b|that'?s (wrong|not right|not what)|actually[,\s]|instead[,\s])|\b(we (use|don'?t use|never|always|prefer)|i (said|told you|asked for)|always use|never use|use \S+ (instead|not)|not \S+[,]? (but|use))\b/i;

/** Whether a person's turn reads as a correction. */
export function isCorrection(text: string): boolean {
  const t = text.trim();
  return t.length >= 6 && t.length <= 400 && CORRECTION.test(t);
}

/** The signals one task left, from its events in order. Takes plain shapes so
 *  the app's and the engine's events both fit. */
export function signalsFrom(
  events: ReadonlyArray<
    | { type: 'task-start'; input: string }
    | { type: 'verify'; passed: boolean; summary: string }
    | { type: 'tool-denied'; call: { name: string }; reason: string }
    | { type: 'approval-resolved'; approved: boolean }
    | { type: 'tool-end'; call: { name: string }; result: { ok: boolean } }
    | { type: 'task-done'; reason: string }
    | { type: string }
  >,
): LessonSignal[] {
  const out: LessonSignal[] = [];
  for (const e of events) {
    if (e.type === 'task-start' && 'input' in e && isCorrection(e.input)) {
      out.push({ kind: 'correction', detail: e.input.trim() });
    } else if (e.type === 'verify' && 'passed' in e && !e.passed) {
      out.push({ kind: 'check-failed', detail: e.summary });
    } else if (e.type === 'tool-denied' && 'call' in e && 'reason' in e) {
      out.push({ kind: 'denied', detail: `${e.call.name}: ${e.reason}` });
    } else if (e.type === 'approval-resolved' && 'approved' in e && !e.approved) {
      out.push({ kind: 'denied', detail: 'an approval was turned down' });
    } else if (e.type === 'tool-end' && 'result' in e && !e.result.ok) {
      out.push({ kind: 'tool-failed', detail: e.call.name });
    } else if (
      e.type === 'task-done' &&
      'reason' in e &&
      (e.reason === 'error' || e.reason === 'aborted' || e.reason === 'guardrail')
    ) {
      out.push({ kind: 'ended', detail: e.reason });
    }
  }
  return out;
}

/** A task worth asking about: a correction, a check that failed, something
 *  turned down, or two tool failures. One failed read is ordinary work. */
export function hasSetback(signals: readonly LessonSignal[]): boolean {
  const tools = signals.filter((s) => s.kind === 'tool-failed').length;
  return (
    tools >= 2 ||
    signals.some(
      (s) =>
        s.kind === 'correction' ||
        s.kind === 'check-failed' ||
        s.kind === 'denied' ||
        (s.kind === 'ended' && s.detail === 'error'),
    )
  );
}

/** Whether a task ended well, for the score of the lessons it carried. */
export function taskWentWell(signals: readonly LessonSignal[]): boolean {
  return !hasSetback(signals) && !signals.some((s) => s.kind === 'ended');
}

/** Where a lesson came from, in a few plain words. */
export function lessonSource(signals: readonly LessonSignal[], date: string): string {
  const checks = signals.filter((s) => s.kind === 'check-failed').length;
  if (signals.some((s) => s.kind === 'correction')) return `your correction, ${date}`;
  if (checks) return `a check that failed ${checks === 1 ? 'once' : `${checks} times`}, ${date}`;
  if (signals.some((s) => s.kind === 'denied')) return `a step you turned down, ${date}`;
  return `a task that ran into trouble, ${date}`;
}

// ---- 2. one question -------------------------------------------------------------

/** The one question a model on the person's own network is asked at the end
 *  of a task with a setback. The answer is one line or NONE. */
export function distilPrompt(input: {
  task: string;
  signals: readonly LessonSignal[];
  /** The lessons the project already keeps, so it does not repeat one. */
  kept: readonly string[];
  /** The last of the model's own answer, for what it ended up doing. */
  answer?: string;
}): string {
  const happened = input.signals
    .slice(0, 8)
    .map((s) => `- ${s.kind}: ${s.detail.slice(0, 200)}`)
    .join('\n');
  return [
    'You are reviewing one finished task in a software project, to keep a lesson for next time.',
    `The task: ${input.task.slice(0, 600)}`,
    `What went wrong or was corrected:\n${happened}`,
    input.answer ? `How the task ended: ${input.answer.slice(-600)}` : '',
    input.kept.length
      ? `Lessons already kept (do not repeat one):\n${input.kept.map((k) => `- ${k}`).join('\n')}`
      : '',
    `Is there one durable, specific lesson about THIS project that would have avoided it next time (a command to use, a file that matters, a preference the person stated)? If so, answer with exactly one line: "LESSON: <the lesson, under ${LESSON_MAX_CHARS} characters, an instruction a model can follow>". If not, or it was a one-off, answer exactly "NONE".`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The lesson in a model's answer to the question, or undefined. */
export function parseDistilled(answer: string): string | undefined {
  const m = /LESSON:\s*(.+)/i.exec(answer);
  if (!m) return undefined;
  return cleanLesson(m[1]!.replace(/^["'`]+|["'`]+$/g, ''));
}

// ---- 3. what may be kept -----------------------------------------------------------

/** Text a lesson must never carry: an address, an instruction to drop the
 *  rules, a secret, or a shell pipeline that fetches and runs. A lesson is
 *  standing context on every turn, the one place a planted line would last. */
const UNSAFE =
  /(https?:\/\/|www\.|ignore (all|any|the|previous|prior)|disregard|system prompt|jailbreak|exfiltrat|api[_ ]?key|password|secret|token\s*[=:]|curl\s|wget\s|\|\s*(sh|bash)\b|rm\s+-rf|base64)/i;

/** A lesson as it may be kept: one line, plain, under the cap, nothing unsafe.
 *  Undefined when nothing safe is left. */
export function cleanLesson(text: string): string | undefined {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line.length < 8 || /^none\b/i.test(line) || UNSAFE.test(line)) return undefined;
  return line.length > LESSON_MAX_CHARS
    ? `${line.slice(0, LESSON_MAX_CHARS - 1).trimEnd()}.`
    : line;
}

/** A correction, as a lesson in the person's own words. */
export function lessonFromCorrection(text: string): string | undefined {
  return cleanLesson(text.replace(/^(no|nope)[,.!]?\s+/i, ''));
}

/** Whether `text` says the same as a lesson already kept. */
export function alreadyKept(text: string, kept: readonly string[]): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const n = norm(text);
  return kept.some((k) => {
    const m = norm(k);
    return m === n || (n.length > 20 && (m.includes(n) || n.includes(m)));
  });
}

// ---- 4. scores and what rides ----------------------------------------------------

/** The lessons after a task they rode into: each one's score moves by how the
 *  task went. */
export function scoreLessons(
  lessons: readonly Lesson[],
  rode: readonly string[],
  wentWell: boolean,
): Lesson[] {
  return lessons.map((l) =>
    rode.includes(l.id)
      ? { ...l, good: l.good + (wentWell ? 1 : 0), bad: l.bad + (wentWell ? 0 : 1) }
      : l,
  );
}

/** A lesson that keeps riding into setbacks: maybe out of date, for the
 *  person to keep or remove (never removed on its own). */
export function lessonDoubtful(l: Pick<Lesson, 'good' | 'bad'>): boolean {
  return l.bad >= 3 && l.bad >= l.good + 3;
}

/** The lessons that ride a turn: the doubtful ones left out, the rest by
 *  score then age, as many as fit `maxChars` (a small seat gets a few). */
export function lessonsToRide(lessons: readonly Lesson[], maxChars: number): Lesson[] {
  const ranked = lessons
    .filter((l) => !lessonDoubtful(l))
    .slice()
    .sort((a, b) => b.good - b.bad - (a.good - a.bad) || b.createdAt.localeCompare(a.createdAt));
  const out: Lesson[] = [];
  let used = 0;
  for (const l of ranked) {
    if (used + l.text.length + 3 > maxChars) break;
    out.push(l);
    used += l.text.length + 3;
  }
  return out;
}

/** The brief's lessons block, or undefined with none. */
export function lessonsBlock(lessons: readonly Pick<Lesson, 'text'>[]): string | undefined {
  if (!lessons.length) return undefined;
  return [
    'Lessons this project kept from earlier work (the person approved each; follow them unless the person says otherwise):',
    ...lessons.map((l) => `- ${l.text}`),
  ].join('\n');
}

/** Room for lessons by window: about a twentieth of what a seat is served,
 *  between 300 and 1,500 characters. */
export function lessonBudgetChars(windowTokens: number | undefined): number {
  const tokens = windowTokens && windowTokens > 0 ? windowTokens : 4096;
  return Math.max(300, Math.min(1500, Math.round((tokens / 20) * 4)));
}
