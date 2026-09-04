// Guided setup chats. Every place the app would otherwise say "enter a key" or
// "set this up" gets a Walk me through it button that opens a chat with the
// guide, seeded with the steps below, exactly the way a person works with a
// coding agent: a goal, the plan, one step at a time, ask anything in between.
// The steps are written here, not model-generated, so they are right even on a
// small model; the model's job is to answer questions and adapt. No em dashes.
export type SetupGuideId =
  | 'get-harbor'
  | 'connect-cloud-key'
  | 'pair-computer'
  | 'install-ollama'
  | 'pick-a-model'
  | 'open-a-repo'
  | 'install-tailscale'
  | 'connect-codemagic';

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
    goal: 'Add Harbor, a stronger on-device model that can help me build for real.',
    steps: [
      'Open Settings and find the Harbor section. Harbor Light, the built-in guide, is already there. Harbor is its bigger sibling.',
      'On the Harbor row, tap Install. It downloads straight from the source, about 1.1 GB, roughly a couple of minutes on wifi. You can keep chatting while it lands.',
      'When it finishes, the row shows Uninstall and Harbor becomes your Reasoning model automatically. Start a new chat to talk to it.',
    ],
    done: 'Harbor answers with real reasoning and can search the web. For heavier work, add a cloud key or a bigger pocket model.',
  },
  'connect-cloud-key': {
    id: 'connect-cloud-key',
    title: 'Connect your own key',
    goal: 'Use Claude, OpenAI, or Gemini on my own key.',
    steps: [
      'Pick the provider you already pay for. If you have none, Claude is the strongest for coding; the console link on the Cloud Connections screen opens it inside the app.',
      'Sign in on the provider page and create a new API key. Copy it. It usually starts with sk- (Claude keys start with sk-ant-).',
      'Back in OpenShore, open Cloud Connections, tap Connect next to that provider, paste the key, and tap Save. The app checks the key with the provider before it says connected.',
      'Open Your stack and place the provider model where you want it: as your Reasoning LLM, or as a specialist for one kind of task.',
    ],
    done: 'The provider shows connected, and it appears in the model menu. Your key never leaves this device.',
  },
  'pair-computer': {
    id: 'pair-computer',
    title: 'Connect your computer',
    goal: 'Run my model on my own computer and reach it from this phone.',
    steps: [
      'On both this phone and your computer, install Tailscale and sign in to the same account. It is free for personal use. Ask me if you want the Tailscale steps.',
      'On your computer, open OpenShore, then Desktop + phone, and tap Turn on. It shows a QR code.',
      'On this phone, open Desktop + phone and tap Scan the QR on your computer. Point the camera at the QR. It fills in the address and token and connects.',
      'If the camera is not available, type the address (it looks like http://100.x.y.z:4816) and the token shown under the QR, then tap Connect.',
    ],
    done: 'The screen says connected. In the model menu, My computer is now a choice, for chat and for coding on your repos.',
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
      'Back in OpenShore on that computer, open Your stack. It now sees Ollama and offers the starter model, or open the Marketplace to pick a bundle.',
    ],
    done: 'Your stack shows a model with a green local pill, and the empty chat answers.',
  },
  'pick-a-model': {
    id: 'pick-a-model',
    title: 'Pick a model',
    goal: 'Get a model running so I can chat and build.',
    steps: [
      'Decide where it runs. On this phone: the Pocket bundle in the Marketplace runs fully on the device, offline. On your computer: Ollama runs bigger models, and a bundle fills your whole stack in one tap.',
      'Open the Marketplace, choose a bundle that fits your machine (each shows its total download size), and tap Install. Weights download straight from their source, never through OpenShore.',
      'When it finishes, the bundle sets your stack for you: the Reasoning LLM and any specialists. Open Your stack to see it.',
    ],
    done: 'The model menu shows your stack, and a first message gets a real answer.',
  },
  'open-a-repo': {
    id: 'open-a-repo',
    title: 'Open a repository',
    goal: 'Point OpenShore at my code so it can read, edit, and run it.',
    steps: [
      'Make sure a model is set up first (Your stack). The agent needs a brain before it can open a repo.',
      'On your computer, open Repositories and tap Open a local folder, or paste a clone URL. On this phone, connect your computer first; the code lives there.',
      'A coding chat opens on that folder. Ask for something small and real, like: explain this project and run its tests.',
      'Every edit shows you a diff to approve, and every command asks before it runs. You stay in control.',
    ],
    done: 'The chat header names your repo, and the agent reads files and proposes changes with approvals.',
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
      'In Codemagic, open Teams, then Personal account, then Integrations, and create an API token. Copy it.',
      'Back in OpenShore, open Launch, paste the token, and save. Then enter the app id and workflow id Codemagic shows for your app.',
      'Tap Start a build. Progress and the build log stream in here, and a failure is explained in plain words.',
    ],
    done: 'A build reaches TestFlight or Google Play and OpenShore shows it as delivered.',
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
