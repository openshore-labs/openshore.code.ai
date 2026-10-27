// Lessons, the store's side (founder, 2026-10-27; the pure core is
// os-code/src/harness/lessons.ts, the sealed store lib/lessons.ts). One watch
// per chat in a project that has Lessons on, armed only when the person sends
// a message on this device, so a replayed journal never counts again. While
// armed it keeps the task's events; at task-done it scores the lessons that
// rode, and after a setback proposes at most one lesson: the person's own
// correction as it stands, or one line from a model on their own network
// (the chat's machine's free chat, which only ever runs a local model). The
// proposal is a card in the chat; only the person's tap keeps it.
import {
  alreadyKept,
  distilPrompt,
  hasSetback,
  lessonBudgetChars,
  lessonFromCorrection,
  lessonSource,
  lessonsToRide,
  parseDistilled,
  scoreLessons,
  signalsFrom,
  taskWentWell,
  type Lesson,
} from 'os-code/protocol';
import type { DriverEvent } from 'os-code/protocol';
import type { FreeChatTransport } from '../drivers/desktopChatDriver.js';
import type { Project } from './types.js';

/** How long the one question may take before the proposal is let go. */
const DISTIL_TIMEOUT_MS = 90_000;

export interface LessonDeps {
  /** The chat's project when it has Lessons on, else undefined. */
  project(conversationId: string): Project | undefined;
  /** A project's kept lessons, as the store holds them now. */
  lessons(projectId: string): Lesson[];
  /** Keep a project's lessons (scores moved). */
  setLessons(projectId: string, lessons: Lesson[]): Promise<void>;
  /** Put a proposal card in the chat. */
  propose(
    conversationId: string,
    proposal: { projectId: string; text: string; source: string },
  ): void;
  /** A model on the person's own network to ask, or undefined (then only a
   *  correction makes a lesson). */
  distiller(conversationId: string): FreeChatTransport | undefined;
  /** Today, YYYY-MM-DD, for a lesson's source line. */
  today(): string;
}

interface Watch {
  projectId: string;
  input: string;
  events: DriverEvent[];
  rode: string[];
  answer: string;
}

export interface LessonWatch {
  /** The person sent `text` in this chat on this device. */
  arm(conversationId: string, text: string): void;
  /** One event from the chat's driver. */
  event(conversationId: string, event: DriverEvent): void;
  /** Settles in tests: the last finish under way. */
  settled(): Promise<void>;
}

export function createLessonWatch(deps: LessonDeps): LessonWatch {
  const watching = new Map<string, Watch>();
  let last: Promise<void> = Promise.resolve();

  const finish = async (conversationId: string, w: Watch): Promise<void> => {
    const signals = signalsFrom([{ type: 'task-start', input: w.input }, ...w.events]);
    // The lessons that rode this task move by how it went.
    if (w.rode.length) {
      const kept = deps.lessons(w.projectId);
      await deps.setLessons(w.projectId, scoreLessons(kept, w.rode, taskWentWell(signals)));
    }
    if (!hasSetback(signals)) return;
    const kept = deps.lessons(w.projectId).map((l) => l.text);
    let text: string | undefined;
    const correction = signals.find((s) => s.kind === 'correction');
    if (correction) text = lessonFromCorrection(correction.detail);
    else {
      const transport = deps.distiller(conversationId);
      if (transport) {
        const prompt = distilPrompt({ task: w.input, signals, kept, answer: w.answer });
        text = parseDistilled(await ask(transport, prompt));
      }
    }
    if (!text || alreadyKept(text, kept)) return;
    deps.propose(conversationId, {
      projectId: w.projectId,
      text,
      source: lessonSource(signals, deps.today()),
    });
  };

  return {
    arm(conversationId, text) {
      const project = deps.project(conversationId);
      if (!project) {
        watching.delete(conversationId);
        return;
      }
      const rode = lessonsToRide(deps.lessons(project.id), lessonBudgetChars(undefined)).map(
        (l) => l.id,
      );
      watching.set(conversationId, {
        projectId: project.id,
        input: text,
        events: [],
        rode,
        answer: '',
      });
    },
    event(conversationId, event) {
      const w = watching.get(conversationId);
      if (!w) return;
      // The driver's own task-start repeats the armed text; the arm keeps it.
      if (event.type === 'task-start') return;
      if (event.type === 'text-final') w.answer = event.text;
      w.events.push(event);
      if (event.type === 'task-done') {
        watching.delete(conversationId);
        last = finish(conversationId, w).catch(() => {});
      }
    },
    settled: () => last,
  };
}

/** One question to a model on the person's own network: its answer's text,
 *  or '' when it refused, failed or took too long. */
async function ask(transport: FreeChatTransport, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISTIL_TIMEOUT_MS);
  let text = '';
  try {
    for await (const frame of transport.stream(
      { messages: [{ role: 'user', content: prompt }], search: false, chainOfThought: false },
      controller.signal,
    )) {
      if (frame.type === 'error') return '';
      if (frame.type === 'text' && typeof frame.delta === 'string') text += frame.delta;
    }
    return text;
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}
