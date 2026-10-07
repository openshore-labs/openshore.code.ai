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
  /** This is the desktop app: Harbor and pairing a computer are the phone's
   *  steps, so the desktop offers only the repository and the API key. */
  desktop?: boolean;
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
  /** The fork after Harbor (founder, 2026-09-25): once Harbor is offered, the
   *  guide asks whether to start chatting or keep setting up, so setup is
   *  never a gate. 'asking' while the two buttons wait for a tap; 'chat' pauses
   *  the walk (it picks up on "Pick up setup"), 'setup' carries on. */
  nextChoice?: 'asking' | NextChoice;
  /** The break after the walk's opening (founder, 2026-10-01): two buttons,
   *  chat now or set up now, before step one is introduced. 'asking' while
   *  they wait for a tap; 'chat' says where setup waits and carries the person
   *  to the main chat page; 'setup' introduces the first step. */
  startChoice?: 'asking' | NextChoice;
  /** "Help me get set up" in any chat (founder, 2026-10-01): the walk moves to
   *  that chat as a list of what is not set up yet. 'asking' while the list's
   *  buttons wait under `menuItemId`; 'step' while a step picked from it is
   *  current. A step that completes or is skipped brings the list back. */
  menu?: 'asking' | 'step';
  /** The list message whose buttons are live. */
  menuItemId?: string;
}

/** The two ways on from the fork after Harbor. */
export type NextChoice = 'chat' | 'setup';

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
    what: 'Harbor is a coding model, Qwen3 4B Instruct, that runs right here on your iPhone.',
    why: "I'm a guide. Harbor does the real work: it writes and explains code right on this phone, even in airplane mode, and searches the web when you're online.",
    how: "Tap Get Harbor. It downloads straight from its source, about 2.5 GB, a few minutes on wifi. It keeps going in the background while we set up the rest, and I'll tell you when it's ready and how to switch to it.",
    action: 'Get Harbor',
    ask: 'Tell me more about Harbor before I download it.',
    done: 'Harbor is downloading in the background. I will tell you when it is ready.',
  },
  computer: {
    title: 'Connect your computer',
    what: 'Pair this phone with OpenShore on your own computer, over your private Tailscale network.',
    why: 'Your computer runs bigger models and works on your code. It does the heavy lifting, so your battery lasts, and a long answer keeps going even when you close the app.',
    how: 'Install Tailscale on both devices and sign in to the same account (free for personal use). On your computer, open OpenShore, then Pairing. The QR is there (if it says Off, tap Turn on). Tap Connect your computer here and scan it. I will bring you back here once you are connected.',
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
    how: "Create an API key on your provider's site, then tap Add an API key, paste it, and save. OpenShore checks it with the provider before it says connected, and the API key is stored only on this device and sent only to that provider. I will bring you back here once it is saved.",
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
  const body = next ? stepIntro(next) : finishMessage(facts);
  return `${editChoiceLead(mode)}

${body}`;
}

/** What was chosen for edits, in a line. */
export function editChoiceLead(mode: PermissionMode | undefined): string {
  return mode === 'default'
    ? 'Ask first it is. OpenShore will check with you before each edit.'
    : mode === 'acceptEdits'
      ? 'Edits will flow, and each diff shows in the chat. Commands still ask.'
      : 'No problem. Edits flow for now and each diff shows in the chat. Change it any time in Settings, under Approvals.';
}

/** The fork's two buttons, in the order they show: chatting first, since
 *  nothing in setup is required (founder, 2026-09-25). */
export const NEXT_CHOICES: readonly { choice: NextChoice; label: string }[] = [
  { choice: 'chat', label: 'Start chatting' },
  { choice: 'setup', label: 'Keep setting up' },
];

/** Steps still ahead after Harbor, for the fork's question: not done, not
 *  skipped. The repository counts even before the computer is connected, since
 *  it comes right after it. */
export function stepsAhead(
  progress: Pick<GuidedSetupProgress, 'skipped'>,
  facts: SetupFacts,
): SetupStepId[] {
  return SETUP_ORDER.filter(
    (id) => id !== 'harbor' && !progress.skipped.includes(id) && !stepHandled(id, facts),
  );
}

/** "connect your computer, set up a repository, and connect your own API key". */
function stepList(ids: readonly SetupStepId[]): string {
  return joinNames(
    ids.map((id) => {
      const t = STEP_COPY[id].title;
      return t.charAt(0).toLowerCase() + t.slice(1);
    }),
  );
}

/** The fork's question, under what just happened with Harbor. */
export function nextChoiceQuestion(ahead: readonly SetupStepId[]): string {
  const count = COUNT_WORDS[ahead.length] ?? String(ahead.length);
  const steps = ahead.length === 1 ? 'one more step' : `${count} more steps`;
  return `Want to start chatting now, or keep setting up? There ${ahead.length === 1 ? 'is' : 'are'} ${steps}: ${stepList(ahead)}. Setup waits for you either way.`;
}

/** Said when the Harbor step ends (downloading, ready, or skipped) and there
 *  is still setup ahead: the step's own line, then the fork. The walk holds
 *  here until a button is tapped. */
export function harborForkMessage(
  how: 'done' | 'skipped',
  progress: Pick<GuidedSetupProgress, 'skipped'>,
  facts: SetupFacts,
): string {
  const lead =
    how === 'skipped'
      ? 'No problem, we can come back to Harbor.'
      : facts.harborReady
        ? HARBOR_READY_MESSAGE
        : STEP_COPY.harbor.done;
  return `${lead}

${nextChoiceQuestion(stepsAhead(progress, facts))}`;
}

/** Said once the fork is answered. Chatting: an open invitation, and where
 *  setup waits. Setting up: straight into the next step (or the wrap-up). */
export function nextChoiceMessage(
  choice: NextChoice,
  next: SetupStepId | undefined,
  facts: SetupFacts,
): string {
  if (choice === 'chat') {
    const invite = "Let's chat. Ask me anything, about OpenShore or anything else.";
    return next
      ? `${invite} Setup is here whenever you want it: tap Pick up setup under my first message, or say "let's set up".`
      : invite;
  }
  return next ? `On we go.\n\n${stepIntro(next)}` : finishMessage(facts);
}

/** Whether the walk still has something for the person to do: a step, or
 *  the edit choice waiting on a tap. */
export function walkActive(p: GuidedSetupProgress): boolean {
  return (
    Boolean(p.current && !p.finished) ||
    p.editChoice === 'asking' ||
    p.nextChoice === 'asking' ||
    p.startChoice === 'asking' ||
    p.menu === 'asking'
  );
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
  return id === 'repo' ? facts.computer || Boolean(facts.desktop) : true;
}

/** The steps this device offers: all four on the phone, the repository and
 *  the API key on the desktop (it is the computer, and Harbor is the phone's
 *  model). */
export function setupSteps(facts: Pick<SetupFacts, 'desktop'>): SetupStepId[] {
  return facts.desktop ? SETUP_ORDER.filter((id) => id === 'repo' || id === 'key') : SETUP_ORDER;
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

/** The walk's opening: the intro alone when there is a step to take, and the
 *  break's two buttons follow it (START_CHOICES); step one waits for "set up". */
export function openingMessage(first: SetupStepId | undefined, facts: SetupFacts): string {
  if (!first) return finishMessage(facts);
  return SETUP_INTRO;
}

/** The break's two buttons, in the order they show (Creative Studio): Just
 *  chat first and full size, so skipping setup is never small or hidden;
 *  Start setup filled, since it answers the question the intro asked. */
export const START_CHOICES: readonly { choice: NextChoice; label: string }[] = [
  { choice: 'chat', label: 'Just chat' },
  { choice: 'setup', label: 'Start setup' },
];

/** Said when the person picks chatting at the break, just before the walk's
 *  chat gives way to the main chat page (founder's words, 2026-10-01). It
 *  names the phrase that brings the list back from any chat. */
export const SETUP_LATER_LINE =
  'Sounds good. Whenever you want to get set up, I can guide you through it. Just say "help me get set up" in any chat.';

/** Said when the person picks setting up at the break: step one. */
export function startSetupMessage(first: SetupStepId | undefined, facts: SetupFacts): string {
  return first ? stepIntro(first) : finishMessage(facts);
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
  String.raw`^\s*(?:ok(?:ay)?,?\s*)?(?:let'?s|let us|i'?m ready to|ready to|i want to|resume|continue|keep|start|back to)\s+(?:the\s+)?(?:${SETUP_WORD})(?:\s+now)?[\s.!]*$|^\s*set me up[\s.!]*$`,
  'i',
);
const SKIP = /^\s*(?:skip|skip (?:this|it|that)(?: one| step)?|next|next step|pass)[\s.!]*$/i;

export function setupIntent(text: string): SetupIntent | undefined {
  if (PAUSE.some((re) => re.test(text))) return 'pause';
  if (RESUME.test(text)) return 'resume';
  if (SKIP.test(text)) return 'skip';
  return undefined;
}

/** "Help me get set up" (founder, 2026-10-01): asked in any chat, read before
 *  the message goes to a model. A plain request only, so "do not help me set
 *  up" or a question that mentions setup in passing stays ordinary talk. */
const HELP_SETUP = new RegExp(
  String.raw`^\s*(?:(?:hey|hi|ok(?:ay)?|so)[,!]?\s+)?(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:(?:help|walk|guide)\s+me\s+(?:to\s+)?(?:get\s+|through\s+(?:the\s+|my\s+)?|with\s+(?:the\s+|my\s+)?)?(?:${SETUP_WORD})|get\s+me\s+set[\s-]*up|set\s+me\s+up)(?:\s+(?:please|now))?[\s.!?]*$`,
  'i',
);

export function setupHelpIntent(text: string): boolean {
  return HELP_SETUP.test(text);
}

/** How a step reads in the list's "already done" sentence. */
const DONE_NAME: Record<SetupStepId, string> = {
  harbor: 'Harbor',
  computer: 'your computer',
  repo: 'a repository',
  key: 'your API key',
};

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/** What the list offers as buttons: this device's steps that are not set up,
 *  not skipped since the list was asked for, and can be done now. */
export function menuSteps(
  progress: Pick<GuidedSetupProgress, 'skipped'>,
  facts: SetupFacts,
): SetupStepId[] {
  return setupSteps(facts).filter(
    (id) => !progress.skipped.includes(id) && !stepHandled(id, facts) && stepAvailable(id, facts),
  );
}

/** What just happened, when the list comes back after a step. */
export interface MenuReturn {
  step: SetupStepId;
  how: 'done' | 'skipped';
  /** Said instead of the step's own line (the edit choice's answer). */
  lead?: string;
}

/** The list message (Creative Studio, 2026-10-01): what is already set up,
 *  then what is left as buttons under it. When it comes back after a step,
 *  what just happened leads and stands alone above the buttons. */
export function setupMenuMessage(
  progress: Pick<GuidedSetupProgress, 'skipped'>,
  facts: SetupFacts,
  back?: MenuReturn,
): string {
  const steps = setupSteps(facts);
  const done = steps.filter((id) => stepHandled(id, facts));
  const ahead = menuSteps(progress, facts);
  const doneNames = joinNames(
    done.map((id) =>
      id === 'harbor' && !facts.harborReady ? 'Harbor (still downloading)' : DONE_NAME[id],
    ),
  );
  const lead = back
    ? back.lead
      ? back.lead
      : back.how === 'skipped'
        ? 'No problem, that one can wait.'
        : back.step === 'harbor' && facts.harborReady
          ? HARBOR_READY_MESSAGE
          : STEP_COPY[back.step].done
    : undefined;
  // The repository waits on the computer (phone): said once, under the list.
  const repoWaits =
    !facts.desktop &&
    !facts.repo &&
    !stepAvailable('repo', facts) &&
    !progress.skipped.includes('repo');
  if (ahead.length) {
    const parts = lead
      ? [`${lead} Here's what's left.`]
      : [
          done.length
            ? `Happy to. Already set up: ${doneNames}. Pick what's next and I'll walk you through it.`
            : "Happy to. Nothing is set up yet, and none of it is required. Pick a place to start and I'll walk you through it.",
        ];
    if (repoWaits) parts.push(MENU_REPO_LATER);
    return parts.join('\n\n');
  }
  const waiting = steps.filter((id) => !stepHandled(id, facts));
  const close = !waiting.length
    ? `You're all set: ${doneNames}. Nothing is left to connect, so ask me anything.`
    : waiting.length === 1 && repoWaits
      ? MENU_REPO_LATER
      : MENU_REST_WAITS;
  return lead ? `${lead}\n\n${close}` : close;
}

/** Said under the list when the repository has to wait for the computer. */
export const MENU_REPO_LATER =
  "A repository comes after your computer, since that's where OpenShore works on your code.";
/** Said when everything left was skipped since the list was asked for. */
export const MENU_REST_WAITS =
  'The rest can wait. Say "help me get set up" any time and I\'ll show you what\'s left.';

/** How a step picked from the list is introduced: no "Step N of M", since the
 *  list is not an order. */
export function menuStepIntro(id: SetupStepId): string {
  const c = STEP_COPY[id];
  return `**${c.title}.** ${c.what}\n\n**Why:** ${c.why}\n\n**How:** ${c.how}`;
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
  if (progress.menu === 'asking' && !progress.paused) {
    const ahead = menuSteps(progress, facts).map((id) => `"${STEP_COPY[id].title}"`);
    return `SETUP: the person asked for help getting set up. A list of what is not set up yet sits under the latest setup message as buttons (${joinNames(ahead)}); tapping one walks them through it. Never choose for them, and never invent other steps. Answer anything they ask fully and well.`;
  }
  if (progress.startChoice === 'asking' && !progress.paused) {
    return `${audience === 'guide' ? `${FIRST_CHAT_GOAL} ` : ''}SETUP: the person has just read the setup intro. Two buttons sit under it: "Just chat" (setup waits, and they can say "help me get set up" in any chat later) and "Start setup" (the first step). Never choose for them. If they ask something, answer it fully and well.`;
  }
  if (audience === 'other') {
    if (progress.paused || !walkActive(progress)) return undefined;
    if (progress.nextChoice === 'asking') {
      return `SETUP: this chat is walking the person through setting up OpenShore. Harbor is taken care of, and they are choosing what to do next. Two buttons sit under the latest setup message: "Start chatting" (setup waits) and "Keep setting up" (${stepList(stepsAhead(progress, facts))}). Never choose for them. Answer anything they ask fully and well.`;
    }
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
  if (progress.nextChoice === 'asking' && !progress.paused) {
    return `${FIRST_CHAT_GOAL} SETUP: Harbor is taken care of, and the person is choosing what to do next. Two buttons sit under your latest message: "Start chatting" (setup waits until they want it) and "Keep setting up" (${stepList(stepsAhead(progress, facts))}). Never choose for them. If they ask something, answer it fully and well.${harbor}`;
  }
  if (progress.editChoice === 'asking' && !progress.paused) {
    return `${FIRST_CHAT_GOAL} SETUP: the repository is connected, and the person is choosing how edits are handled. Two buttons sit under your latest message: "Ask me first" (check before each edit) and "Let edits flow" (edits go through, each diff shows in the chat). Commands ask either way. Explain the difference if asked; never choose for them.${harbor}`;
  }
  if (progress.finished || !progress.current) {
    return `${FIRST_CHAT_GOAL} SETUP: finished.${harbor} Invite questions about the app.`;
  }
  if (progress.paused) {
    return `${FIRST_CHAT_GOAL} SETUP: paused. The person wants to just chat for now. Do not bring setup up again unless they ask; if they do, tell them to say "help me get set up".${harbor}`;
  }
  const step = STEP_COPY[progress.current];
  const { n, of } = stepNumber(progress.current);
  return `${FIRST_CHAT_GOAL} SETUP: step ${n} of ${of}, "${step.title}". What it is: ${step.what} How it works: ${step.how} Its buttons ("${step.action}", "Ask about this", and "Skip for now") sit under your latest message. Answer setup questions from this. If they ask about something else, answer that fully and well, and mention the buttons at most briefly. If they say they want to just chat, drop setup and chat. Never invent other steps.`;
}
