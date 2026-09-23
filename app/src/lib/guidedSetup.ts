// Guided setup: Harbor Lite walks a new person through setting OpenShore up,
// in its first chat, one step at a time (founder, 2026-09-23). Each step is a
// short scripted message from the guide plus the buttons to do it: the button
// opens the page, and once the connection lands the app brings the person back
// to the chat and the guide moves on. They can skip any step, and they can ask
// anything in between; the model answers off script, knowing which step is
// current (guideContextLine). When every step is done or skipped, the guide
// invites questions about the app, which is what Harbor Lite is good for, and
// if Harbor came down it says how to switch to it.
//
// This file is the pure core: the steps, the order, the words, and the rules
// for what is current. The store owns the effects (appending messages, opening
// pages, coming back), and ChatScreen renders the buttons.

export type SetupStepId = 'harbor' | 'computer' | 'repo' | 'key';

/** Harbor first: it is a long download that carries on while the rest is set
 *  up. The repository step needs the computer, so it follows it. */
export const SETUP_ORDER: SetupStepId[] = ['harbor', 'computer', 'repo', 'key'];

/** What the app knows right now, read from the store. */
export interface SetupFacts {
  harborReady: boolean;
  /** A Harbor download is on its way (counts as handled for the walk). */
  harborDownloading: boolean;
  computer: boolean;
  repo: boolean;
  key: boolean;
}

/** The walk's own memory, kept on the device's settings. */
export interface GuidedSetupProgress {
  conversationId: string;
  /** The step the guide last introduced, if the walk is still going. */
  current?: SetupStepId;
  skipped: SetupStepId[];
  /** The step whose page the person was sent to; its completion brings them
   *  back to the chat. Cleared once they are back. */
  awaiting?: SetupStepId;
  finished?: boolean;
  /** The person said they would rather just chat for now. The step buttons
   *  go away and the guide stops raising setup until they ask to resume. */
  paused?: boolean;
  /** Harbor's "ready, here is how to switch" line has been said. */
  harborAnnounced?: boolean;
}

export interface SetupStepCopy {
  title: string;
  /** What it is, in a sentence. */
  what: string;
  /** Why it helps. */
  why: string;
  /** How it works: what the button does and what happens next. */
  how: string;
  /** The primary button. */
  action: string;
  /** Sent as the person's message by "Ask about this", so the guide
   *  answers it with the step in mind. */
  ask: string;
  /** Said when the step completes. */
  done: string;
}

export const HARBOR_SWITCH_HINT =
  'To use Harbor, tap the model name in the chat box below (next to the +) and pick Harbor. Or open the menu, go to Your stack, and place Harbor there so every chat starts with it.';

/** Said once, whenever Harbor finishes downloading during or after the walk. */
export const HARBOR_READY_MESSAGE = `Harbor is ready on your iPhone. ${HARBOR_SWITCH_HINT}`;

export const STEP_COPY: Record<SetupStepId, SetupStepCopy> = {
  harbor: {
    title: 'Get Harbor',
    what: 'Harbor is a coding model that runs right here on your iPhone.',
    why: 'I am a guide; Harbor does the real work. It reasons, searches the web, and writes real code, all on this phone, even in airplane mode.',
    how: 'Tap Get Harbor. It downloads straight from its source, about 1.9 GB, a couple of minutes on wifi, and keeps going in the background while we set up the rest. I will tell you when it is ready and how to switch to it.',
    action: 'Get Harbor',
    ask: 'Tell me more about Harbor before I download it.',
    done: 'Harbor is downloading in the background. I will tell you when it is ready.',
  },
  computer: {
    title: 'Connect your computer',
    what: 'Pair this phone with OpenShore on your own computer, over your private Tailscale network.',
    why: 'Your computer runs bigger models and works on your code. It does the heavy lifting, so your battery lasts, and a long answer keeps going even when you close the app.',
    how: 'Install Tailscale on both devices and sign in to the same account (free for personal use). On your computer, open OpenShore, then Desktop + phone, and tap Turn on to show a QR code. Tap Connect your computer here and scan it. I will bring you back here once you are connected.',
    action: 'Connect your computer',
    ask: 'Tell me more about connecting my computer.',
    done: 'Your computer is connected.',
  },
  repo: {
    title: 'Set up a repository',
    what: 'Connect GitHub or another platform, and pick a home repo for OpenShore to work in.',
    why: 'This is where building happens: OpenShore reads your code, edits it, runs its tests, and commits, always with your approval.',
    how: 'Tap Set up a repository, choose your platform, and connect it with your own token. Then set your home repo. Every edit shows you a diff first, and every command asks before it runs. I will bring you back here once it is connected.',
    action: 'Set up a repository',
    ask: 'Tell me more about setting up a repository.',
    done: 'Your repository is connected.',
  },
  key: {
    title: 'Connect your own key',
    what: 'Add an API key for Claude, OpenAI, or Gemini.',
    why: "For the hardest work, a frontier model on your own account goes further than anything on a phone, at your provider's price. Chat stays free either way.",
    how: "Create a key on your provider's site, then tap Add a key, paste it, and save. OpenShore checks it with the provider before it says connected, and the key never leaves this device. I will bring you back here once it is saved.",
    action: 'Add a key',
    ask: 'Tell me more about using my own key.',
    done: 'Your key is connected.',
  },
};

/** How the guide introduces a step: what it is, why it helps, how it works. */
export function stepIntro(id: SetupStepId): string {
  const c = STEP_COPY[id];
  const { n, of } = stepNumber(id);
  return `**Step ${n} of ${of}: ${c.title}.** ${c.what}\n\n**Why:** ${c.why}\n\n**How:** ${c.how}`;
}

/** Whether the step is already taken care of, so the walk passes it by. */
export function stepHandled(id: SetupStepId, facts: SetupFacts): boolean {
  switch (id) {
    case 'harbor':
      return facts.harborReady || facts.harborDownloading;
    case 'computer':
      return facts.computer;
    case 'repo':
      return facts.repo;
    case 'key':
      return facts.key;
  }
}

/** Whether the step can be done yet. On the phone, repositories live on the
 *  person's computer, so that step waits on the computer being connected. */
export function stepAvailable(id: SetupStepId, facts: SetupFacts): boolean {
  return id === 'repo' ? facts.computer : true;
}

/** The next step to bring up, or undefined when the walk is over. */
export function nextStep(
  progress: Pick<GuidedSetupProgress, 'skipped'>,
  facts: SetupFacts,
): SetupStepId | undefined {
  return SETUP_ORDER.find(
    (id) => !progress.skipped.includes(id) && !stepHandled(id, facts) && stepAvailable(id, facts),
  );
}

/** Step N of M, counted over the whole order so the numbers never jump. */
export function stepNumber(id: SetupStepId): { n: number; of: number } {
  return { n: SETUP_ORDER.indexOf(id) + 1, of: SETUP_ORDER.length };
}

/** The first message of the walk, right under the greeting. */
export function openingMessage(first: SetupStepId | undefined, facts: SetupFacts): string {
  if (!first) return finishMessage(facts);
  return `Let's get you set up. For each step I'll tell you what it is, why it helps, and how it works. Then you can connect it, skip it, or ask me more first. Skip anything you don't need; you can always come back to it. And if you'd rather just chat for now, say so. I'm happy to talk about anything.\n\n${stepIntro(first)}`;
}

/** The guide's message when the walk moves on: what just happened, then the
 *  next step or the wrap-up. */
export function advanceMessage(
  finished: SetupStepId | undefined,
  how: 'done' | 'skipped',
  next: SetupStepId | undefined,
  facts: SetupFacts,
): string {
  const lead = finished
    ? how === 'skipped'
      ? 'No problem, we can come back to that.'
      : finished === 'harbor' && facts.harborReady
        ? HARBOR_READY_MESSAGE
        : STEP_COPY[finished].done
    : '';
  const body = next ? stepIntro(next) : finishMessage(facts);
  return lead ? `${lead}\n\n${body}` : body;
}

/** The wrap-up: an invitation to ask about the app, and how to switch to
 *  Harbor when it is on the phone. */
export function finishMessage(facts: SetupFacts): string {
  const parts = [
    "That's the setup. You can pick up anything you skipped later in Settings, under Get started.",
    'Now ask me anything about OpenShore and how it works. That is what I am best at.',
  ];
  if (facts.harborReady) parts.push(`Harbor is ready. ${HARBOR_SWITCH_HINT}`);
  else if (facts.harborDownloading) {
    parts.push('Harbor is still downloading. I will tell you when it is ready.');
  }
  if (!facts.computer) {
    parts.push('Repositories come in once your computer is connected.');
  }
  return parts.join('\n\n');
}

/** Openers offered under the wrap-up, so the next question is one tap. */
export const ASK_ANYTHING = [
  'How does Your stack work?',
  'What is the Vault?',
  'What can My Crew do?',
  'How do Projects work?',
];

/** The first chat's first goal, above setup (founder, 2026-09-23). */
export const FIRST_CHAT_GOAL =
  'FIRST CHAT: your first goal is a pleasant, genuinely useful conversation that shows the person you are a capable chat companion. Setup is offered, never pushed.';

/** What a message in the walk's chat asks of the walk itself, read before it
 *  goes to the model:
 *  - pause: they would rather just chat ("not now", "I just want to chat").
 *    The walk steps back and the message still goes to the guide, who
 *    answers it knowing setup is off the table for now.
 *  - resume: they want to set up after all ("let's set up"). Only a short,
 *    plain request; the walk picks up with the current step.
 *  - skip: a bare "skip" or "next" skips the current step.
 *  Undefined means an ordinary message. */
export type SetupIntent = 'pause' | 'resume' | 'skip';

const SETUP_WORD = String.raw`set(?:ting)?[\s-]*(?:it\s+|things\s+|me\s+)?up|setup`;
const PAUSE = [
  new RegExp(
    String.raw`\b(?:don'?t|do not|doesn'?t|no|not)\b[^.?!]{0,30}\b(?:${SETUP_WORD})\b`,
    'i',
  ),
  new RegExp(
    String.raw`\b(?:skip|stop|pause|cancel|forget)\b[^.?!]{0,12}\b(?:${SETUP_WORD})\b`,
    'i',
  ),
  /\bjust (?:want to |wanna |like to )?(?:chat|talk)\b/i,
  /\b(?:rather|prefer to) (?:just )?(?:chat|talk)\b/i,
  /^\s*(?:not now|not right now|maybe later|later|no thanks)[\s.!]*$/i,
];
const RESUME = new RegExp(
  String.raw`^\s*(?:ok(?:ay)?,?\s*)?(?:let'?s|let us|i'?m ready to|ready to|i want to|resume|continue|start|back to)\s+(?:the\s+)?(?:${SETUP_WORD})(?:\s+now)?[\s.!]*$|^\s*set me up[\s.!]*$`,
  'i',
);
const SKIP = /^\s*(?:skip|skip (?:this|it|that)(?: one| step)?|next|next step|pass)[\s.!]*$/i;

export function setupIntent(text: string): SetupIntent | undefined {
  if (PAUSE.some((re) => re.test(text))) return 'pause';
  if (RESUME.test(text)) return 'resume';
  if (SKIP.test(text)) return 'skip';
  return undefined;
}

/** Said when the walk picks back up. */
export function resumeMessage(current: SetupStepId): string {
  return `Happy to. Here's where we left off.\n\n${stepIntro(current)}`;
}

/** One line for Harbor Lite's system prompt, so a question asked mid-walk is
 *  answered knowing where the person is. Short: the guide is a small model. */
export function guideContextLine(
  progress: GuidedSetupProgress | undefined,
  facts: SetupFacts,
): string | undefined {
  if (!progress) return undefined;
  const harbor = facts.harborReady
    ? ` Harbor is downloaded; if asked how to use it: ${HARBOR_SWITCH_HINT}`
    : '';
  if (progress.finished || !progress.current) {
    return `${FIRST_CHAT_GOAL} SETUP: finished.${harbor} Invite questions about the app.`;
  }
  if (progress.paused) {
    return `${FIRST_CHAT_GOAL} SETUP: paused. The person wants to just chat for now. Do not bring setup up again unless they ask; if they do, tell them to say "let's set up".${harbor}`;
  }
  const step = STEP_COPY[progress.current];
  const { n, of } = stepNumber(progress.current);
  return `${FIRST_CHAT_GOAL} SETUP: step ${n} of ${of}, "${step.title}". What it is: ${step.what} How it works: ${step.how} Its buttons ("${step.action}", "Ask about this", and "Skip for now") sit under your latest message. Answer setup questions from this. If they ask about something else, answer that fully and well, and mention the buttons at most briefly. If they say they want to just chat, drop setup and chat. Never invent other steps.`;
}
