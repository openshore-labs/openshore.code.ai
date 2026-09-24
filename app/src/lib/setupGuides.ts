// Guided setup chats. Every place the app would otherwise say "enter a key" or
// "set this up" gets a Walk me through it button that opens a chat with the
// guide, seeded with the steps below, exactly the way a person works with a
// coding agent: a goal, the plan, one step at a time, ask anything in between.
// The steps are written here, not model-generated, so they are right even on a
// small model; the model's job is to answer questions and adapt. No em dashes.
export type SetupGuideId =
  | 'get-harbor'
  | 'get-harbor-master'
  | 'connect-cloud-key'
  | 'pair-computer'
  | 'install-ollama'
  | 'pick-a-model'
  | 'open-a-repo'
  | 'install-tailscale'
  | 'connect-codemagic'
  | 'set-up-crew'
  | 'connect-hermes'
  | 'cli-pairing'
  | 'connect-a2a'
  | 'connect-jev';

export interface SetupGuide {
  id: SetupGuideId;
  title: string;
  /** What the person is trying to do, in their words. */
  goal: string;
  /** Ordered steps, one action each. A step that needs something pasted (a
   *  command, a query) carries it as `paste`, rendered as a copy block. */
  steps: Array<string | { text: string; paste: string }>;
  /** A closing line: how they know it worked. */
  done: string;
}

export const SETUP_GUIDES: Record<SetupGuideId, SetupGuide> = {
  'get-harbor': {
    id: 'get-harbor',
    title: 'Get Harbor',
    goal: 'Add Harbor, a coding model that runs on my phone and can help me build for real.',
    steps: [
      'Open Settings and find the Harbor section. Harbor Lite, the built-in guide, is already there. Harbor is the coder that runs alongside it.',
      'On the Harbor row, tap Install. It downloads straight from the source, about 1.9 GB, roughly a couple of minutes on wifi. You can keep chatting while it lands.',
      'When it finishes, the row shows Uninstall and Harbor becomes your Reasoning model automatically. Start a new chat to talk to it.',
    ],
    done: 'Harbor writes and explains code, reasons, and can search the web. For heavier repository work, add a cloud key or dock to your computer.',
  },
  'get-harbor-master': {
    id: 'get-harbor-master',
    title: 'Get DeepBlue',
    goal: 'Add DeepBlue, the most capable out-of-the-box model, running on my own computer.',
    steps: [
      'On your computer, open OpenShore. If nothing is set up yet, the chat opens on a card that says Set up DeepBlue: tap it and you are done. Otherwise open Settings and find the Harbor section.',
      'On the DeepBlue row, tap Install. It picks the size that fits your computer and pulls it through Ollama, straight from the Ollama library. Keep using the app while it lands.',
      'When it finishes, the row reads Installed and DeepBlue is your Reasoning model on that computer. To reach it from this phone, pair the two under Desktop + phone; it then appears as My computer.',
    ],
    done: 'DeepBlue plans and edits your repositories on your computer. For the hardest steps, a cloud key on your own account is one tap away, and it always asks before it spends.',
  },
  'connect-cloud-key': {
    id: 'connect-cloud-key',
    title: 'Connect your own API key',
    goal: 'Use Claude, OpenAI, or Gemini on my own key.',
    steps: [
      'Pick the provider you already pay for. If you have none, Claude is the strongest for coding; the console link on the Cloud Connections screen opens it inside the app.',
      'Sign in on the provider page and create a new API key. Copy it. It usually starts with sk- (Claude keys start with sk-ant-).',
      'Back in OpenShore, open Cloud Connections, tap Connect next to that provider, paste the key, and tap Save. The app checks the key with the provider before it says connected.',
      'Open Stack and place the provider model where you want it: as your Reasoning LLM, or as a specialist for one kind of task.',
    ],
    done: 'The provider shows connected, and it appears in the model menu. Your API key never leaves this device.',
  },
  'pair-computer': {
    id: 'pair-computer',
    title: 'Connect your computer',
    goal: 'Run my model on my own computer and reach it from this phone.',
    steps: [
      'On both this phone and your computer, install Tailscale and sign in to the same account. It is free for personal use. Ask me if you want the Tailscale steps.',
      'On your computer, open OpenShore, then Desktop + phone, and tap Turn on. It shows a QR code.',
      'On this phone, open Desktop + phone and tap Scan the QR on your computer. Point the camera at the QR. It fills in the address and pairing token and connects.',
      'If the camera is not available, type the address (it looks like http://100.x.y.z:4816) and the pairing token shown under the QR, then tap Connect.',
    ],
    done: 'The screen says connected. In the model menu, My computer is now a choice, for chat and for coding on your repositories.',
  },
  'install-ollama': {
    id: 'install-ollama',
    title: 'Install Ollama',
    goal: 'Run local models on my computer.',
    steps: [
      {
        text: 'On your computer, install Ollama. On Linux, paste this in a terminal (macOS and Windows use the installer from ollama.com):',
        paste: 'curl -fsSL https://ollama.com/install.sh | sh',
      },
      {
        text: 'Check that it is running. Paste this and you should see a (possibly empty) list, not an error:',
        paste: 'ollama list',
      },
      'Back in OpenShore on that computer, open Stack. It now sees Ollama and offers DeepBlue, sized to your computer. Tap Install.',
    ],
    done: 'Stack shows a model with a teal local pill, and the empty chat answers.',
  },
  'pick-a-model': {
    id: 'pick-a-model',
    title: 'Pick a model',
    goal: 'Get a model running so I can chat and build.',
    steps: [
      'Decide where it runs. On this phone: Harbor, a coding model that runs fully on the device, offline. On your computer: DeepBlue, through Ollama, the most capable of the built-in models.',
      'On this phone, open Settings, find the Harbor section, and tap Install on the Harbor row. On your computer, open Stack and install DeepBlue, sized to your computer. Weights download straight from their source, never through OpenShore.',
      'When it finishes, it becomes your Reasoning LLM. Open Stack to see it, and to add specialists or a cloud model on your own API key.',
    ],
    done: 'The model menu shows Stack, and a first message gets a real answer.',
  },
  'open-a-repo': {
    id: 'open-a-repo',
    title: 'Open a repository',
    goal: 'Point OpenShore at my code so it can read, edit, and run it.',
    steps: [
      'Make sure a model is set up first (Stack). The agent needs a brain before it can open a repository.',
      'On your computer, open Repositories and tap Open a local folder, or paste a clone URL. On this phone, connect your computer first; the code lives there.',
      'A coding chat opens on that folder. Ask for something small and real, like: explain this project and run its tests.',
      'Every command asks before it runs. Edits go through and show their diff in the chat, or choose Ask first in Settings, under Approvals, to check each one. You stay in control.',
    ],
    done: 'The chat header names your repository, and the agent reads files, makes changes you can see as diffs, and asks before any command.',
  },
  'install-tailscale': {
    id: 'install-tailscale',
    title: 'Install Tailscale',
    goal: 'Give my phone and my computer a private network to talk over.',
    steps: [
      'Install Tailscale on your computer from tailscale.com and sign in (Google, Apple, GitHub, or Microsoft accounts all work).',
      'Install the Tailscale app on this phone from the App Store and sign in with the same account.',
      'Turn Tailscale on in the phone app. Both devices now share a private network, no port forwarding, no public exposure.',
    ],
    done: 'The Tailscale app on the phone lists your computer. Now pair them under Desktop + phone.',
  },
  'connect-codemagic': {
    id: 'connect-codemagic',
    title: 'Connect Codemagic',
    goal: 'Ship a build to the App Store or Google Play from inside OpenShore.',
    steps: [
      'Create a free Codemagic account at codemagic.io and add your app repository there.',
      'In Codemagic, open Teams, then Personal account, then Integrations, and create an API key (Codemagic calls it an API token). Copy it.',
      'Back in OpenShore, open Launch with Codemagic, paste the API key, and save. Then enter the app id and workflow id Codemagic shows for your app.',
      'Tap Start a build. Progress and the build log stream in here, and a failure is explained in plain words.',
    ],
    done: 'A build reaches TestFlight or Google Play and OpenShore shows it as delivered.',
  },
  'set-up-crew': {
    id: 'set-up-crew',
    title: 'Set up your crew',
    goal: 'Have a crew member work on a schedule on my own computer, so results are waiting when I come back.',
    steps: [
      'Routines run on your main computer, on your own models, while it is on. You set one up while connected to that computer, then watch and steer it from anywhere.',
      'If you have not paired yet, open Desktop + phone and pair this device. Tailscale must be on for both, the same connection the big models use.',
      'Make sure the work lives on your computer: open Repositories and clone the repository you want the crew to work in, if it is not there already.',
      'Open My Crew, then Crew command, and set up the Morning review routine. It reads what changed overnight and leaves a checklist, read-only, so it never needs an approval.',
      'Away from home you can always watch your crew and read its results here. To change or run a routine, reconnect to your computer over Tailscale first.',
    ],
    done: 'A routine shows in Crew command with its next run time, and its first report lands in your vault.',
  },
  'connect-hermes': {
    id: 'connect-hermes',
    title: 'Connect Hermes Agent',
    goal: 'Run Hermes Agent on a computer I own and reach it from OpenShore, so it shows up on my bench, in my crew, and in my vault.',
    steps: [
      'Agentic Currents are a beta. Hermes runs its own tools on its own computer under its own rules; OpenShore shows you what it remembers and lets your models hand it work, and off leaves no trace.',
      {
        text: 'On the computer that will run Hermes (a Mac mini or a small Linux box works), install it with the official installer and run the setup wizard:',
        paste: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash && hermes setup',
      },
      {
        text: 'Turn on its API server so OpenShore can talk to it. This serves an OpenAI-compatible endpoint on that computer:',
        paste: 'hermes api-server',
      },
      'Put both computers on the same Tailscale network, the same private link your paired computer uses. Never expose the Hermes port to the public internet.',
      'Back in OpenShore, open Settings, then Agentic Currents, and turn on Hermes Agent. Enter the address, which ends in /v1, for example http://mini.tail1234.ts.net:8642/v1, and the API key if you set one.',
      'Hermes now sits on your bench in Stack, as a member in Crew command, and its memory and skills read in the Vault when you are docked to the computer that holds its home folder.',
    ],
    done: 'The Hermes Agent row reads On, a faint water-line frames every screen, and Hermes appears on your bench.',
  },
  'cli-pairing': {
    id: 'cli-pairing',
    title: 'Pair a coding CLI',
    goal: 'Use Claude Code or Codex on my paired computer as a specialist my stack can hand a coding task to.',
    steps: [
      'Agentic Currents are a beta. Your own engine stays the default; a paired CLI is one more specialist to hand work to, and off leaves no trace.',
      {
        text: 'On the computer OpenShore is paired with, install the CLI you already use. For Claude Code:',
        paste: 'npm install -g @anthropic-ai/claude-code',
      },
      {
        text: 'Or for Codex:',
        paste: 'npm install -g @openai/codex',
      },
      'Sign in to it once in a terminal on that computer, the way its own docs say, so it can run headless later.',
      'In OpenShore, open Settings, then Agentic Currents, and turn on CLI Pairing. Pick the CLI. OpenShore checks that it is really on the computer before it offers it.',
      'Ask for something small in a coding chat, like: hand this to Claude Code and review the diff. The run shows as a command you approve, and the diff comes back for review.',
    ],
    done: 'The CLI Pairing row reads On, and a coding chat can hand a task to the CLI with a command you approve.',
  },
  'connect-a2a': {
    id: 'connect-a2a',
    title: 'Connect an agent over A2A',
    goal: 'Reach an agent I run, over the open agent-to-agent protocol, so my stack can hand it work.',
    steps: [
      'Agentic Currents are a beta. A2A is the generic door: any agent that publishes an agent card connects here, Hermes and Vellum included when they expose one. Off leaves no trace.',
      'Find the base address of the agent. It publishes its card at /.well-known/agent-card.json under that address, and its own docs say how to turn A2A on.',
      'Put it on your Tailscale network if it runs on a computer you own. Never expose an agent port to the public internet.',
      'In OpenShore, open Settings, then Agentic Currents, and turn on A2A. Paste the address and the API key if it needs one. OpenShore reads the card and shows the name of the agent.',
      'In a chat, ask for something the agent is good at. Your model hands it over with the askAgent tool and says plainly when an answer came from it.',
    ],
    done: 'The A2A row reads On and names the agent from its card, and a chat can hand it a task.',
  },
  'connect-jev': {
    id: 'connect-jev',
    title: 'Turn on Jev',
    goal: 'Layer Jev, a cheap decision model, into the harness so it steers which of my seats answers and skips steps that do not need a model.',
    steps: [
      'Harness Currents are a beta. Jev does not answer for a seat; it makes the small decisions around your seats. It is a cloud call that costs a little per turn, so it only ever runs when a paid seat is in play, never against a free local model.',
      'Get a TypeSafe API key from your TypeSafe account, the same way you would copy an API key for any cloud model.',
      'In OpenShore, open Settings, then Harness Currents, and turn on Jev. The address is filled in for you; paste your API key.',
      'Now when a turn would spend on a paid seat, Jev first checks whether a cheaper local seat can carry it, routes the turn to the seat placed for that kind of work, and, when there is no check to run, judges whether the result satisfies the task. Each decision shows as a card in the chat.',
    ],
    done: 'The Jev row reads On, a faint water-line frames every screen, and a pill names it beside the reach pill.',
  },
};

/** The bare numbered steps for a guide, on their own lines, for splicing into a
 *  small model's grounding so it can recite an activation walkthrough verbatim
 *  rather than reason it out. A step with something to paste keeps that on the
 *  next line so the model can lift it into a copy block. */
export function guideStepsCompact(id: SetupGuideId): string {
  return SETUP_GUIDES[id].steps
    .map((s, i) => (typeof s === 'string' ? `${i + 1}. ${s}` : `${i + 1}. ${s.text}\n${s.paste}`))
    .join('\n');
}

/** The seeded first message of a guide chat: goal, plan, then step one, so the
 *  person can act immediately and ask anything between steps. */
export function guideOpening(g: SetupGuide): string {
  // Anything to paste is its own fenced block, one per step, nothing else in
  // it, so the chat renders it with a one-tap Copy.
  const plan = g.steps
    .map((s, i) =>
      typeof s === 'string'
        ? `${i + 1}. ${s}`
        : `${i + 1}. ${s.text}\n\n\`\`\`\n${s.paste}\n\`\`\``,
    )
    .join('\n');
  return [
    `Let's get this done: ${g.goal}`,
    '',
    'Here is the plan, one step at a time. Ask me anything along the way.',
    '',
    plan,
    '',
    `How you know it worked: ${g.done}`,
    '',
    'Start with step 1 and tell me when it is done, or where it stopped.',
  ].join('\n');
}
