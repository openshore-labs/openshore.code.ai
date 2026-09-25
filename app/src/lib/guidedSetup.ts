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

import type { PermissionMode } from './permissionMode.js';

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
  /** The one choice the repository step ends on (CX, 2026-09-24, after
   *  Zed's "trust projects" row): how edits are handled. 'asking' while the
   *  two buttons wait for a tap; then the mode picked, or 'later'. */
  editChoice?: 'asking' | 'later' | PermissionMode;
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
  'To use Harbor, tap the model name in the chat box below (next to the +) and pick Harbor. Or open the menu, go to Stack, and place Harbor there so every chat starts with it.';

/** Said once, whenever Harbor finishes downloading during or after the walk. */
export const HARBOR_READY_MESSAGE = `Harbor is ready on your iPhone. ${HARBOR_SWITCH_HINT}`;

export const STEP_COPY: Record<SetupStepId, SetupStepCopy> = {
  harbor: {
    title: 'Get Harbor',
    what: 'Harbor is a coding model, Qwen 2.5 Coder 3B, that runs right here on your iPhone.',
    why: "I'm a guide. Harbor does the real work: it reasons, writes real code on this phone, even in airplane mode, and searches the web when you're online.",
    how: "Tap Get Harbor. It downloads straight from its source, about 1.9 GB, a couple of minutes on wifi. It keeps going in the background while we set up the rest, and I'll tell you when it's ready and how to switch to it.",
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
    what: 'Connect GitHub or another platform, and pick a home repository for OpenShore to work in.',
    why: 'This is where building happens: OpenShore reads your code, edits it, runs its tests, and commits.',
    how: "Tap Set up a repository, choose your platform, and connect it with your own access token. Then set your home repository. Commands always ask before they run. Once you're connected, you'll choose how edits are handled, and you can change that any time. I will bring you back here once it is connected.",
    action: 'Set up a repository',
    ask: 'Tell me more about setting up a repository.',
    done: 'Your repository is connected.',
  },
  key: {
    title: 'Connect your own API key',
    what: 'Add an API key for Claude, OpenAI, or Gemini.',
    why: "For the hardest work, a frontier model on your own account goes further than anything on a phone, at your provider's price. Chat stays free either way.",
    how: "Create an API key on your provider's site, then tap Add an API key, paste it, and save. OpenShore checks it with the provider before it says connected, and the API key never leaves this device. I will bring you back here once it is saved.",
    action: 'Add an API key',
    ask: 'Tell me more about using my own API key.',
    done: 'Your API key is connected.',
  },
};

/** The choice the repository step ends on (CX ruling, 2026-09-24). Zed asks
 *  up front whether to trust every project; OpenShore asks one narrower
 *  question at the moment it starts to matter, once there is code to edit.
 *  Commands ask either way. Neither button is preselected; Plan and Bypass
 *  stay in the composer's mode pill for people who already know them. */
export const EDIT_CHOICES: readonly { mode: PermissionMode; label: string }[] = [
  { mode: 'default', label: 'Ask me first' },
  { mode: 'acceptEdits', label: 'Let edits flow' },
];

export const EDIT_CHOICE_QUESTION =
  'If it has a CLAUDE.md, AGENTS.md, or OSCODE.md, OpenShore follows it, so there is nothing to import. One choice before we go on: should OpenShore ask before each edit, or let edits go through and show you each diff in the chat? Commands ask either way, and you can change this any time in Settings, under Approvals.';

/** Said when the repository connects: the step's done line, then the one
 *  choice. The walk holds here until a button is tapped. */
export function repoConnectedMessage(): string {
  return `${STEP_COPY.repo.done}

${EDIT_CHOICE_QUESTION}`;
}

/** Said once the edit choice is made (or put off): what was chosen, then the
 *  next step or the wrap-up. */
export function editChoiceMessage(
  mode: PermissionMode | undefined,
  next: SetupStepId | undefined,
  facts: SetupFacts,
): string {
  const lead =
    mode === 'default'
      ? 'Ask first it is. OpenShore will check with you before each edit.'
      : mode === 'acceptEdits'
        ? 'Edits will flow, and each diff shows in the chat. Commands still ask.'
        : 'No problem. Edits flow for now and each diff shows in the chat. Change it any time in Settings, under Approvals.';
  const body = next ? stepIntro(next) : finishMessage(facts);
  return `${lead}

${body}`;
}

/** Whether the walk still has something for the person to do: a step, or
 *  the edit choice waiting on a tap. */
export function walkActive(p: GuidedSetupProgress): boolean {
  return Boolean(p.current && !p.finished) || p.editChoice === 'asking';
}

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
/** The line that opens the walk, before the first step (Creative Studio, "Tide
 *  Letter", 2026-09-24). */
const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
export const SETUP_INTRO = `Let's get you set up. There are ${COUNT_WORDS[SETUP_ORDER.length] ?? SETUP_ORDER.length} short steps. For each one I'll say what it is, why it helps, and how it works. Then you can connect it, skip it, or ask me first. Nothing here is required, and you can come back to any of it. If you'd rather just chat, say so.`;

export function openingMessage(first: SetupStepId | undefined, facts: SetupFacts): string {
  if (!first) return finishMessage(facts);
  return `${SETUP_INTRO}\n\n${stepIntro(first)}`;
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
    "That's the setup. Anything you skipped waits on the Set up OpenShore page, from the button under my first message.",
    'Now ask me anything about OpenShore, how it works, or the best setup for your equipment. I can look simple questions up on the web too.',
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
  'How does Stack work?',
  'What is the Vault?',
  'What can Crew do?',
  'How do Projects work?',
  'Can I use Claude Code or Codex here?',
];

/** The first chat's first goal, above setup (founder, 2026-09-23). */
export const FIRST_CHAT_GOAL =
  'FIRST CHAT: your first goal is a pleasant, genuinely useful conversation that shows the person you are a capable chat companion. Setting up is offered, never pushed.';

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
 *  answered knowing where the person is. Short: the guide is a small model.
 *  Any other model switched into the walk's chat (Harbor, a Stack seat, a
 *  cloud model) gets the 'other' line: only while a step or the edit choice is
 *  live, without the first-chat persona, so a coding seat is never told its
 *  job is a pleasant chat once setup is done or set aside. */
export function guideContextLine(
  progress: GuidedSetupProgress | undefined,
  facts: SetupFacts,
  audience: 'guide' | 'other' = 'guide',
): string | undefined {
  if (!progress) return undefined;
  if (audience === 'other') {
    if (progress.paused || !walkActive(progress)) return undefined;
    if (progress.editChoice === 'asking') {
      return 'SETUP: this chat is walking the person through setting up OpenShore. The repository is connected, and they are choosing how edits are handled. Two buttons sit under the latest setup message: "Ask me first" (check before each edit) and "Let edits flow" (edits go through, each diff shows in the chat). Commands ask either way. Explain the difference if asked; never choose for them.';
    }
    const step = STEP_COPY[progress.current!];
    const { n, of } = stepNumber(progress.current!);
    return `SETUP: this chat is walking the person through setting up OpenShore, now on step ${n} of ${of}, "${step.title}". What it is: ${step.what} How it works: ${step.how} Its buttons ("${step.action}", "Ask about this", and "Skip for now") sit under the latest setup message. If they ask what is next, this step is. Answer anything else fully and well. Never invent other steps.`;
  }
  const harbor = facts.harborReady
    ? ` Harbor is downloaded; if asked how to use it: ${HARBOR_SWITCH_HINT}`
    : '';
  if (progress.editChoice === 'asking' && !progress.paused) {
    return `${FIRST_CHAT_GOAL} SETUP: the repository is connected, and the person is choosing how edits are handled. Two buttons sit under your latest message: "Ask me first" (check before each edit) and "Let edits flow" (edits go through, each diff shows in the chat). Commands ask either way. Explain the difference if asked; never choose for them.${harbor}`;
  }
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
