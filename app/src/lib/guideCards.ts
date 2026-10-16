// Harbor Lite's fact cards: every part of the app a person can see, what it
// does, why it exists, and how to use it, one small card each. The guide
// harness (guideHarness.ts) hands the model only the few cards a question
// needs, so this list can be as complete as the app is without costing the
// window. Every card was checked against the screen that renders it
// (2026-09-24); when a screen changes, change its card in the same commit. The
// eval (guideEval.ts, test/guideEval.test.ts) pins which card answers which
// question. No em dashes, no backend internals. A current's name comes from its
// roster (currents.ts, harnessCurrents.ts), never spelled here.
import type { GuideCard } from './guideHarness.js';
import { guideStepsCompact } from './setupGuides.js';
import { LOCAL_IMAGE_READER, SMALL_IMAGE_READER, aboutGB } from './imageReading.js';
import { thisDeviceNoun } from './deviceNoun.js';
import { AGENTIC_CURRENTS, AGENTIC_CURRENTS_TITLE } from './currents.js';
import { HARNESS_CURRENTS, HARNESS_CURRENTS_TITLE } from './harnessCurrents.js';
import { ROUTINE_NOTES_PLACE, VAULT_PRIVATE_OFF_MARKED, vaultGuideText } from './vaultCopy.js';
import { BYOM_FORWARDS_NAME } from './byom.js';
import {
  SHIPS_ADMIN,
  SHIPS_CURRENTS,
  SHIPS_LAUNCH,
  SHIPS_STACKHEALTH,
  SHIPS_TEAMS,
  featureOn,
} from './focus.js';

// Release tiers (docs/release-tiers.md): a card about a later tier's feature
// carries `feature` and is left out of a build without it, and the cards that
// list rooms or settings name only what this build has. The flags are the
// build-time SHIPS_ gates, and each later card also sits behind its gate, so
// a Personal build's bundle does not carry those words at all
// (app/test/tierBundle.test.ts).
const launchOn = SHIPS_LAUNCH;
const currentsOn = SHIPS_CURRENTS;
const stackHealthOn = SHIPS_STACKHEALTH;
const adminOn = SHIPS_ADMIN;
const teamsOn = SHIPS_TEAMS;

function listOf(names: readonly string[]): string {
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`
    : (names[0] ?? '');
}

const agenticNames = AGENTIC_CURRENTS.map((c) => c.label);
const harnessNames = HARNESS_CURRENTS.map((c) => c.label);

const ALL_GUIDE_CARDS: readonly GuideCard[] = [
  // ---------------------------------------------------------- the big picture
  {
    id: 'overview',
    title: 'What OpenShore is',
    // Opens on the App Store's first caption, the line the setup page's
    // headline says too (D23, 2026-10-07).
    text: 'Your models. Your keys. OpenShore is a local-first coding assistant for your computer (Mac, Windows, or Linux) and your iPhone. You build a stack of models you own; local models are the default and the cloud is an opt-in choice on your own key. Once set up it works like a coding agent: say the goal, it proposes a plan, you pick, it does the work and asks before anything risky.',
    keywords: [
      'what is openshore',
      'how does openshore work',
      'overview',
      'purpose',
      'local-first',
      'coding assistant',
      'platforms',
      'windows',
      'linux',
    ],
  },
  {
    id: 'three-models',
    title: 'The three built-in models',
    text: 'Three models come out of the box. Harbor Lite is the tiny guide built into the iPhone app. Harbor is a coding model that runs on the iPhone. DeepBlue is the most capable, a real coding agent on your own computer. Paired, the phone reaches DeepBlue as Your computer.',
    keywords: ['built-in models', 'three models', 'difference', 'compare', 'out of the box'],
  },
  {
    id: 'setup-page',
    title: 'Set up OpenShore',
    where: "The Set up OpenShore button under Harbor Lite's first message",
    text: 'The page for every optional next step. On the phone: Get Harbor, Connect your computer, Set up a repository, Add an API key. On your computer: Build your stack, Open a repository, Add an API key. In a new person\'s first chat Harbor Lite walks these steps with buttons under each message, and after Harbor it asks whether to start chatting or keep setting up, so setup never stands in the way; tap Keep setting up or say "let\'s set up" to pick it back up. There is no Get started group in Settings.',
    keywords: [
      'set up',
      'setup',
      'get started',
      'set up openshore',
      'onboarding',
      'next steps',
      'skipped',
      'first steps',
      'keep setting up',
    ],
  },
  {
    id: 'walk-me-through',
    title: 'Walk me through it',
    text: `Screens that set something up carry a Walk me through it (or Guide me) button that opens a chat with a step-by-step guide: the goal, a numbered plan, then one step at a time, with questions welcome between steps. It is on ${listOf(
      [
        'Cloud Connections',
        'Computer on the phone',
        'Repositories before you connect',
        'Terminal',
        'Crew command',
        ...(launchOn ? ['Launch with Codemagic'] : []),
        ...(currentsOn ? ["each current's connect sheet"] : []),
      ],
    )}.`,
    keywords: [
      'walk me through',
      'guide me',
      'tutorial',
      'step by step',
      'walkthrough',
      'instructions',
      'help me set up',
    ],
  },
  {
    id: 'menu',
    title: 'The Menu',
    where: 'Phone: the Menu button at top left, or swipe from the edge. Computer: the sidebar',
    text: `Every room sits in one list: ${[
      'Chats',
      'Projects',
      'Terminal',
      'Repositories',
      'Stack',
      'Vault',
      'Crew',
      'Cloud Connections',
      'Computer',
      'Local Library',
      ...(stackHealthOn ? ['Stack Health'] : []),
      ...(launchOn ? ['Launch with Codemagic'] : []),
    ].join(
      ', ',
    )}. On a phone not yet connected to a computer, Terminal sits after Vault until it is. Your recent chats sit under them, with View all. Settings stays at the bottom.${adminOn ? ' Company admins also see Admin.' : ''} A Sign in row shows when you are signed out.`,
    keywords: ['menu', 'sidebar', 'navigation', 'drawer', 'where is', 'find', 'rooms', 'hamburger'],
  },

  // ---------------------------------------------------------- the three models
  {
    id: 'harbor-lite',
    title: 'Harbor Lite',
    where: 'Built into the iPhone app; its row is in Menu, Settings, Harbor, marked Built in',
    text: 'Harbor Lite is the tiny guide (about 105 MB) that ships inside the iPhone app: here from first launch, offline, no account, and it cannot be removed. It explains the app, helps with setup, works out the best setup for your equipment, and looks simple questions up on the web when you are online. It does not write real code or run commands; for that it hands off to Harbor or DeepBlue.',
    keywords: [
      'harbor lite',
      'guide',
      'built in',
      'good for',
      'can you do',
      'what can you',
      'your limits',
      'who are you',
      'show me around',
    ],
  },
  {
    id: 'harbor',
    title: 'Harbor',
    where:
      'Menu, Settings, Harbor, Harbor on the phone, or Get Harbor on the Set up OpenShore page',
    text: `Harbor is a coding model (Qwen3 4B Instruct, about 2.5 GB, for a phone with 6 GB of memory) that runs fully on the iPhone, private and even in airplane mode. It writes and explains code in chat and can search the web; it does not edit files or run commands yet. How to get it:\n${guideStepsCompact('get-harbor')}`,
    keywords: [
      'harbor',
      'get harbor',
      'phone coder',
      'coding model',
      'download harbor',
      'install harbor',
      'code on my phone',
      'switch to harbor',
    ],
  },
  {
    id: 'deepblue',
    title: 'DeepBlue',
    where:
      'OpenShore on your computer: Menu, Settings, Harbor, DeepBlue, or the first-run card, or Stack, Get DeepBlue',
    text: `DeepBlue is the most capable built-in model: a real coding agent that plans and edits your repositories on your own computer, running through Ollama and sized to your computer (Qwen 2.5 Coder 32B, 14B, 7B, or 3B). Once installed it is your Reasoning model, and a paired phone reaches it as Your computer. How:\n${guideStepsCompact('get-harbor-master')}`,
    keywords: [
      'deepblue',
      'deep blue',
      'desktop model',
      'computer model',
      'coding agent',
      'ollama',
      'install on computer',
      'biggest model',
      'most capable',
    ],
  },

  // ---------------------------------------------------------- chat
  {
    id: 'chat-home',
    title: 'Chat',
    text: 'The main screen. The header shows the chat title (tap to rename), the repositories pill, spend so far, a context bar, Terminal on a computer chat, the New chat pen, and the connection pill once your computer is connected. Type in the chat box and tap send.',
    keywords: ['chat', 'home', 'new chat', 'rename chat', 'context bar', 'main screen'],
  },
  {
    id: 'composer',
    title: 'The chat box',
    text: 'At the bottom of every chat: + to attach, the model pill, the mode pill and a Terminal pill on computer chats, the dictation mic, and one round button: voice mode while the box is empty, send once you type. While a reply runs you can type to queue the next message, or tap the square to stop. Shift+Tab cycles the mode.',
    keywords: ['chat box', 'composer', 'send', 'stop', 'queue', 'buttons', 'keyboard shortcuts'],
  },
  {
    id: 'model-picker',
    title: 'Select model',
    where: 'Tap the model pill in the chat box, next to the +',
    text: 'Picks who answers: Stack, your pinned favorites, This computer on the desktop or Your computer on the phone (or Connect your computer), Cloud models, and Local models, plus Effort. Swipe a model left or tap its star to pin it. This is where you switch to Harbor once it is downloaded.',
    keywords: [
      'switch model',
      'switch',
      'different model',
      'pick model',
      'change model',
      'select model',
      'model pill',
      'my stack',
      'favorite',
      'pin',
      'local llms',
      'cloud providers',
    ],
  },
  {
    id: 'effort',
    title: 'Effort',
    where: 'Select model, Effort',
    text: 'Sets how hard the model thinks before answering: High (the default), Medium, or Low. Lower is faster.',
    keywords: ['effort', 'thinking', 'reasoning effort', 'faster', 'speed', 'thorough'],
  },
  {
    id: 'modes',
    title: 'Modes',
    where: 'The mode pill in the chat box, or Shift+Tab',
    text: 'Sets what the coding agent may do without asking. Ask first asks before every edit and command. Accept edits (the starting mode) lets file edits through but asks for commands. Plan is read-only and proposes a plan first. Bypass runs everything without asking, though cloud spend still asks. Plain chat models have no tools, so the mode does nothing there.',
    keywords: [
      'mode',
      'modes',
      'accept edits',
      'plan mode',
      'bypass',
      'default mode',
      'permission',
      'permissions',
      'auto approve',
    ],
  },
  {
    id: 'plan-first',
    title: 'Plan first',
    text: 'In Plan mode the agent writes its plan and stops. Tap Start building to go ahead, or Change something to adjust it with the plan still in view. It may also ask clarifying questions with tappable options. Nothing changes in your code until you approve.',
    keywords: ['plan first', 'start building', 'change something', 'approve plan', 'proposal'],
  },
  {
    id: 'approvals',
    title: 'Approvals',
    text: 'When the agent wants to edit, run a command, or spend on a cloud model, a sheet asks first, with a diff when there is one: Approve once, Always allow this in the project, Approve for this session, or No, skip it. Spend and writes to your vault always ask, so neither offers a standing allow.',
    keywords: ['approve', 'approval', 'allow', 'deny', 'confirm', 'asks first', 'diff', 'spend'],
  },
  {
    id: 'attachments',
    title: 'Attach',
    where: 'The + at the left of the chat box',
    text: 'Opens Camera, Photos, and Files (drag and drop on a computer). Videos are read as frames. A chat with one model sends images only if that model reads them. In a Stack chat, a model set for Image reading gets images right away; otherwise the chat asks before an image goes out, and when nothing can read it, the chat says so and offers two ways to set one up.',
    keywords: [
      'attach',
      'photo',
      'image',
      'screenshot',
      'camera',
      'file',
      'video',
      'upload',
      'picture',
    ],
  },
  {
    id: 'dictation',
    title: 'Dictate',
    where: 'The mic icon in the chat box',
    text: 'Turns your speech into text in the chat box without sending it. Tap again to stop, then send.',
    keywords: ['mic', 'microphone', 'dictate', 'dictation', 'speech to text', 'voice typing'],
  },
  {
    id: 'voice-mode',
    title: 'Voice mode',
    where:
      'The round button beside the mic, while the chat box is empty; voice choices in Menu, Settings, Voice mode',
    text: 'A full-screen spoken conversation: it listens, sends what you said, and speaks the reply. Tap to interrupt or send. Approvals, spending, and pick lists come back to the screen, and everything lands in the chat as text. Settings, Voice mode picks the voice, speaking speed, and whether replies are read aloud.',
    keywords: [
      'voice',
      'voice mode',
      'talk',
      'speak',
      'hands free',
      'read aloud',
      'spoken',
      'speaking speed',
    ],
  },
  {
    id: 'slash-commands',
    title: 'Slash commands',
    text: 'Type / in the chat box: /help, /clear, /model, /cost, /mode, and /rename; agent chats add /compact (fold history to save room) and /init (write an OSCODE.md for the repository).',
    keywords: ['slash', 'commands', 'shortcut', 'compact', 'cost', 'init'],
  },
  {
    id: 'reach-pill',
    title: 'The connection pill',
    where: 'Top right of a chat, once your computer is connected',
    text: "Shows your reach once your computer is connected. Docked (a green dot): your own computer is reachable, so its models, cloud models, and this device's models all work. Offshore (a plain dot): online, but your computer is out of reach, so cloud models and this device's models work. Offline (a hollow ring): only the models on this device. In an open chat on a phone it shows just its dot. Before a computer is connected it shows only when you are offline. Tap it to follow the connection automatically or step down by hand; before a computer is connected, Choose Offline under the status switch in Stack does the same.",
    keywords: ['offshore', 'docked', 'pill', 'top right', 'connection', 'status', 'green', 'reach'],
  },
  {
    id: 'chats',
    title: 'Chats',
    where: 'Menu, Chats',
    text: "The active project's chats, and any chat whose project was deleted, newest first, with search. Tap to open, swipe left to delete, hold to rename. Sessions running on your paired computer show here too, so you can pick them up from the phone.",
    keywords: [
      'chats',
      'history',
      'old chats',
      'search chats',
      'delete chat',
      'past conversations',
      'resume',
    ],
  },

  // ---------------------------------------------------------- the stack
  {
    id: 'stack',
    title: 'Stack',
    where: 'Menu, Stack',
    text: 'The models that answer for you. One is the Reasoning model: it plans each task and sends it to the specialist whose job fits, or does it itself. You can keep a separate stack for each connection status (Offshore and Offline, and Docked once your computer is connected); the one for your current status is used automatically. It exists so you can mix models you own, each doing what it does best.',
    keywords: [
      'stack',
      'your stack',
      'reasoning model',
      'reasoning llm',
      'orchestrator',
      'runs the show',
      'routing',
      'which model answers',
      'status stack',
    ],
  },
  {
    id: 'specialists',
    title: 'Specialists',
    where: 'Menu, Stack, Specialists',
    text: 'Models placed by job under the Reasoning model: Coding, Writing, Analysis, Image reading, Image creation, Retrieval, Fast, or Custom. Image reading has an on-device slot and a cloud slot. Add one from the Bench with Add to stack and pick its category.',
    keywords: [
      'specialist',
      'specialists',
      'coding',
      'writing',
      'analysis',
      'vision',
      'image reading',
      'retrieval',
      'category',
      'roles',
    ],
  },
  {
    // A maintainer's two doors (2026-10-07), in the words the chat's card and
    // its guides use; the local pick comes from the catalog. The Local slot
    // reads first and the Cloud slot takes a failed picture only after a
    // card (K), and a plan's image step runs on the Reasoning model from the
    // text, since a plan never carries a picture (E; UX and copy review, 2026-10-08).
    id: 'image-reading',
    title: 'Reading images',
    where: 'Menu, Stack, Image reading',
    text: `A picture in a Stack chat goes to the model set under Image reading, without asking. With both set, the Local model reads first, and the Cloud model takes a picture the Local one failed on only after you approve. With none set, another model that can read it (your Reasoning model, or a cloud model you connected) gets it after you approve. A plan never carries a picture, so with none set its image step goes to your Reasoning model, which works from the text. When nothing can read images, the chat says so and offers two ways: Source a local model (${LOCAL_IMAGE_READER.name}, ${aboutGB(LOCAL_IMAGE_READER)}, on your computer through Ollama, or ${SMALL_IMAGE_READER.name}, ${aboutGB(SMALL_IMAGE_READER)}, for a computer with little room; a model on ${thisDeviceNoun()} cannot read images yet), or Connect a cloud model on your own API key (Claude reads images out of the box). Each opens a step-by-step guide.`,
    keywords: [
      'read images',
      'read image',
      'reads images',
      'read pictures',
      'read my screenshots',
      'image model',
      'vision model',
      'image reader',
      'cannot read images',
      'source a local model',
      'connect a cloud model',
      'llava',
      'moondream',
    ],
  },
  {
    id: 'bench',
    title: 'The Bench',
    where: 'Menu, Stack, Bench',
    text: 'Models you download or connect wait on the Bench until you place them. Teal is local and private, amber is cloud. Tap Add to stack, choose a category, and optionally a trigger, a persona, and effort.',
    keywords: [
      'bench',
      'place',
      'placement',
      'add to stack',
      'unplaced',
      'where did my model go',
      'teal',
    ],
  },
  {
    id: 'byom',
    title: 'Connect your own model',
    where: 'Menu, Stack, the Connect a model + pill',
    // The door is the Stack's form away from the desktop only: the desktop's
    // Stack has no address form, so the card says where it is.
    text: `Away from the desktop (on a phone, an iPad or the web), Connect a model in Stack uses a model you run or hold a key for: on your computer, your own server, a gateway, or another service with your key, at any address, in the OpenAI or the Anthropic format. It asks for a name, the address, the format, and an optional API key, then loads the models the address lists so you tick the ones you want (or type one, when it lists none). Each lands on your Bench, and calls go straight from your device to it. A model on your own network counts as local; for a gateway, turn on ${BYOM_FORWARDS_NAME} and it counts as cloud. ${VAULT_PRIVATE_OFF_MARKED}`,
    keywords: [
      'byom',
      'bring your own model',
      'own server',
      'self hosted',
      'custom endpoint',
      'openai compatible',
      'anthropic compatible',
      'any address',
      'fine tune',
      'lm studio',
    ],
  },
  {
    // Bring your own keys, Part 4 (2026-10-09): the three that sign in their
    // own way come through a gateway the person runs (setupGuides.ts).
    id: 'own-gateway',
    title: 'Bedrock, Azure, and Vertex',
    where: 'Menu, Stack, How connecting works, Use Bedrock, Azure, or Vertex',
    text: `Amazon Bedrock, Azure, and Google Vertex AI sign in their own way, so they come through LiteLLM, a free gateway you run yourself on your computer or your server with your own provider keys. OpenShore runs no gateway and never sees those keys. Start LiteLLM with a config that lists your models and a long random master key of your own, on the machine's Tailscale address only (its --host), never on every network: on a rented server that would be the open internet. Then, on a phone, an iPad or the web, in Stack tap Connect a model, give its address (port 4000), paste the master key, and turn on ${BYOM_FORWARDS_NAME}, so it counts as cloud. ${VAULT_PRIVATE_OFF_MARKED} On those devices, Stack, How connecting works opens the full steps.`,
    keywords: [
      'bedrock',
      'aws',
      'amazon bedrock',
      'azure',
      'azure openai',
      'vertex',
      'vertex ai',
      'google cloud',
      'litellm',
      'gateway',
      'own gateway',
      'proxy',
    ],
  },
  {
    id: 'stack-desktop',
    title: 'Stack on your computer',
    where: 'Menu, Stack, in OpenShore on your computer',
    text: 'Shows the Reasoning model with a Change button and the specialist roles, chosen from models installed through Ollama. Start with a prefab stack fills it in one tap and shows the size and any graphics memory it needs; with no models, the picker offers Get DeepBlue.',
    keywords: [
      'desktop stack',
      'computer stack',
      'prefab stack',
      'ollama models',
      'installed models',
      'enable specialist',
    ],
  },
  {
    id: 'first-seat',
    title: 'First Seat',
    text: 'On an empty chat when nothing can answer yet, one card sets you up: on your computer, one tap installs DeepBlue sized to it. More ways to start offers Connect your computer, Add an API key, and Open Stack.',
    keywords: ['first run', 'no model', 'first seat', 'nothing answers', 'one tap', 'empty chat'],
  },
  {
    id: 'library',
    title: 'Local Library',
    where: 'Menu, Local Library',
    text: 'A curated catalog of more models, each rated for how well it fits this device, downloaded straight from its public source to run locally; OpenShore never rehosts weights. On a computer a model installs through Ollama; on a phone it downloads to the phone, or to your iCloud when it is too big to fit. A downloaded model lands on the Bench until you place it in the stack.',
    keywords: [
      'local library',
      'library',
      'marketplace',
      'more models',
      'other models',
      'download models',
      'new model',
      'catalog',
      'store',
      'bundles',
    ],
  },
  ...(stackHealthOn
    ? ([
        {
          id: 'stack-health',
          feature: 'stackhealth',
          title: 'Stack Health',
          where: 'Menu, Stack Health',
          text: 'An honest read of how your stack is used, worked out on your own computer, by day, week, or month: how much ran locally versus in the cloud, what the cloud cost, energy and carbon estimates, and leaner swaps.',
          keywords: [
            'stack health',
            'usage',
            'stats',
            'how much spent',
            'local vs cloud',
            'carbon',
            'energy',
            'dashboard',
          ],
        },
      ] satisfies GuideCard[])
    : []),

  // ---------------------------------------------------------- connections
  {
    id: 'cloud-connections',
    title: 'Cloud Connections',
    where: 'Menu, Cloud Connections',
    text: `Add cloud models on your own API key: Claude (which also needs its Workspace id), OpenAI, Gemini, Kimi (Moonshot), and Perplexity. More providers holds Groq, Together AI, DeepSeek, Mistral, xAI, Cerebras, Hugging Face, Nebius Token Factory, Novita AI, MiniMax, and NVIDIA, whose models load from the provider once your key is in. Away from the desktop (on a phone, an iPad or the web), any other provider connects by its address in the Stack, under Connect a model, in the OpenAI or the Anthropic format. Each connected provider puts its models on your Bench. Your server is set up here too: a Linux server you rent docks like your computer, and once docked you can keep a provider's key on it for its coding sessions and choose its model. API keys are stored only on your device and sent only to their provider, except a key you turn on for your server, which is kept there too. A cloud model runs, and spends, only when you pick it or place it. How:\n${guideStepsCompact('connect-cloud-key')}`,
    keywords: [
      'cloud',
      'api key',
      'key',
      'claude',
      'anthropic',
      'openai',
      'gpt',
      'gemini',
      'kimi',
      'perplexity',
      'groq',
      'together',
      'deepseek',
      'mistral',
      'xai',
      'grok',
      'cerebras',
      'hugging face',
      'nebius',
      'novita',
      'minimax',
      'nvidia',
      'more providers',
      'own key',
      'cloud connections',
      'paid model',
      'strongest',
    ],
  },
  {
    id: 'pair-phone',
    title: 'Dock to your computer or a server',
    where: 'Phone: Menu, Computer',
    text: `Docks the phone to OpenShore on your computer, or on a Linux server you rent, so that machine does the heavy lifting, your battery lasts, and a long answer keeps going when you close the app. It runs over your own private Tailscale network (free for personal use), so nothing is opened to the internet. A server is set up with one command, from Computer or Cloud Connections. How, for a computer:\n${guideStepsCompact('pair-computer')}`,
    keywords: [
      'pair',
      'pairing',
      'dock',
      'docking',
      'server',
      'vps',
      'rent a server',
      'connect my computer',
      'connect computer',
      'tailscale',
      'qr',
      'qr code',
      'my computer',
      'why tailscale',
      'private network',
      'hub',
    ],
  },
  {
    id: 'pair-desktop',
    title: 'Computer, on the desktop',
    where: 'On your computer: Menu, Computer',
    text: 'Tap Turn on to open the phone connection over Tailscale; it shows a QR code and a one-time code good for five minutes. Docked devices are listed and each can be revoked on its own.',
    keywords: ['turn on', 'show qr', 'pairing code', 'revoke', 'paired devices', 'desktop + phone'],
  },
  {
    id: 'repositories',
    title: 'Repositories',
    where: 'Menu, Repositories, and the repositories pill at the top of a chat',
    text: `Connect GitHub, GitLab, or Bitbucket (one tap, or an access token). With your computer connected you can clone from a URL or open a local folder. In a chat, the repositories pill picks which code that chat works on, with its branch. OpenShore reads, edits, tests, and commits, shows you every change, and asks before it runs a command unless you have allowed it. How:\n${guideStepsCompact('open-a-repo')}`,
    keywords: [
      'repository',
      'repositories',
      'repo',
      'repos',
      'no repos',
      'github',
      'gitlab',
      'bitbucket',
      'git',
      'clone',
      'my code',
      'branch',
    ],
  },
  {
    id: 'terminal',
    title: 'Terminal',
    where: 'Menu, Terminal; the switch is in Menu, Settings, Terminal',
    text: 'A real terminal on your computer, following your coding session or in your home folder. Terminal Control off (the default) means you run commands; on means the model runs them and reads the output. In a computer chat, the Terminal pill runs your next message as a command.',
    keywords: [
      'terminal',
      'shell',
      'command line',
      'terminal control',
      'run command',
      'bash',
      'console',
    ],
  },
  ...(launchOn
    ? ([
        {
          id: 'launch',
          feature: 'launch',
          title: 'Launch with Codemagic',
          where: 'Menu, Launch with Codemagic',
          text: `Ships your app to the App Store or Google Play through Codemagic on your own account: add a Codemagic API key and a launch target, then build. On a failed build the model can read the log. How:\n${guideStepsCompact('connect-codemagic')}`,
          keywords: [
            'launch',
            'codemagic',
            'app store',
            'google play',
            'ship',
            'testflight',
            'release',
            'deploy',
            'publish app',
          ],
        },
      ] satisfies GuideCard[])
    : []),

  // ---------------------------------------------------------- projects and knowledge
  {
    id: 'projects',
    title: 'Projects',
    where: 'Menu, Projects',
    text: `A project keeps its chats, repositories, and instructions together, so every chat in it starts with the same context. Its room shows the repositories and instructions, ${currentsOn ? 'its currents, ' : ''}the pinned notes, the chats, and New chat. The options button at the top right makes it active, renames it, opens What it has learned once it has a repository, or deletes it.`,
    keywords: ['project', 'projects', 'standing instructions', 'organize', 'folder', 'new project'],
  },
  {
    id: 'project-notes',
    title: 'What it has learned',
    where: 'A project room, or Vault, Coding projects',
    text: 'Read-only notes the agent keeps in the project: Current State, Progress, Decisions, Action Items, and Skills, so the next session picks up where the last one left off.',
    keywords: [
      'learned',
      'project memory',
      'progress',
      'decisions',
      'action items',
      'current state',
    ],
  },
  {
    id: 'vault',
    title: 'Vault',
    where: 'Menu, Vault',
    // From the Vault's one copy map, so the card says what each storage does
    // and only that (0.19).
    text: vaultGuideText(),
    keywords: [
      'vault',
      'notes',
      'note',
      'knowledge base',
      'obsidian',
      'markdown',
      'wikilinks',
      'second brain',
      'icloud',
      'google drive',
    ],
  },
  {
    id: 'my-crew',
    title: 'Crew',
    where: 'Menu, Crew',
    text: "Your own roster of agents, each with a name, a persona, a rule for when it is called, and an activity level (Reviews the work, Joins on its own, or When you ask). Tap New crew member to add one. Tap a member's card to edit it; Delete is at the foot of its editor, or swipe the card left.",
    keywords: [
      'crew',
      'my crew',
      'agents',
      'reviewer',
      'persona',
      'team',
      'helpers',
      'custom agent',
    ],
  },
  {
    id: 'advisors',
    title: 'The advisor team',
    where: 'Menu, Crew, Add the advisor team',
    text: 'One tap adds eight advisors: Technical Advisor (reviews the work), Marketing, Finance, and Creative Studio (join when a decision needs them), and Research, Coordinator, Sounding Board, and Strategy (answer when asked). They advise; you decide.',
    keywords: [
      'advisor',
      'advisors',
      'advisor team',
      'technical advisor',
      'marketing',
      'finance',
      'strategy',
      'sounding board',
    ],
  },
  {
    id: 'routines',
    title: 'Routines',
    where: 'Menu, Crew, Crew command',
    text: `A routine gives a crew member a task, a workspace, days, and a time. It runs on your own computer while your computer is on, and leaves a dated note in ${ROUTINE_NOTES_PLACE}. Access is Read-only or May edit files, and commands still wait for your approval. There is a Morning review preset and Run now.`,
    keywords: [
      'routine',
      'routines',
      'schedule',
      'every morning',
      'every day',
      'recurring',
      'automate',
      'crew command',
      'morning review',
      'while i sleep',
    ],
  },
  ...(currentsOn
    ? ([
        {
          id: 'agentic-currents',
          feature: 'currents',
          title: AGENTIC_CURRENTS_TITLE,
          where: 'Menu, Projects, a project (editors only)',
          text: `${AGENTIC_CURRENTS_TITLE} (beta) hand agent work in a project to an outside agent: ${listOf(agenticNames)}. They are off by default and one is on at a time per project. Turn one on and the rooms you already use gain rows for it; turn it off and every trace is gone. Connecting one is done once per device from its Set up link.`,
          keywords: [
            'agentic currents',
            'currents',
            'current',
            'other agents',
            'outside agent',
            'external agent',
            'beta',
            ...agenticNames.map((n) => n.toLowerCase()),
          ],
        },
      ] satisfies GuideCard[])
    : []),
  ...(currentsOn
    ? ([
        {
          id: 'harness-currents',
          feature: 'currents',
          title: HARNESS_CURRENTS_TITLE,
          where: 'Menu, Projects, a project (editors only)',
          text: `${HARNESS_CURRENTS_TITLE} (beta) layer a cheap decision method into how answers are made in a project. ${listOf(harnessNames)} picks which of your models answers a turn, skips steps that need no model, and checks results, each decision shown as an amber card. It only spends on a paid or cloud seat. One on at a time per project.`,
          keywords: [
            'harness currents',
            'decision',
            'save money',
            'cheaper',
            'cost saving',
            ...harnessNames.map((n) => n.toLowerCase()),
          ],
        },
      ] satisfies GuideCard[])
    : []),

  // ---------------------------------------------------------- settings
  // Every group in the screen's order, Privacy under Account (D16, 2026-10-07).
  // test/settingsOrder.test.ts reads SettingsScreen and holds this list to it.
  {
    id: 'settings',
    title: 'Settings',
    where: 'Menu, Settings',
    text: `Groups: ${listOf([
      'Account',
      'Privacy',
      'Ethical boundaries',
      'This device',
      'Approvals',
      'Terminal',
      ...(launchOn ? ['Launch with Codemagic'] : []),
      ...(stackHealthOn ? ['Stack Health'] : []),
      'Web search',
      'Harbor',
      'Reasoning',
      'Writing',
      'Voice mode',
      'Greeting',
      'Notifications (iPhone)',
      'Wayfinding',
      'Chats',
    ])}. Set up steps are not here; they are on the Set up OpenShore page.`,
    keywords: ['settings', 'preferences', 'options', 'configure', 'toggles'],
  },
  {
    id: 'settings-greeting',
    title: 'The chat greeting',
    where: 'Menu, Settings, Greeting',
    text: 'The greeting on an empty chat is a little game: tap it for the next card, hold it to reveal the answer. Settings, Greeting picks the deck: Languages (the default; hold to see which language), Popsicle Jokes, Trivia Night, Sports Almanac, Sunday Crossword, Word of the Day, or Fortune Cookie. A new pick shows on your next new chat.',
    keywords: [
      'greeting',
      'splash',
      'easter egg',
      'jokes',
      'trivia',
      'crossword',
      'word of the day',
      'fortune',
    ],
  },
  {
    id: 'settings-harbor',
    title: 'Harbor settings and web search',
    where: 'Menu, Settings, Web search and Harbor',
    text: 'Web search holds the switch that lets models search and the search service every local model uses: DuckDuckGo needs no API key, or add your own Brave Search or Tavily API key. Harbor installs or removes the built-in models (Harbor on the phone, DeepBlue on your computer; Harbor Lite is Built in).',
    keywords: [
      'web search',
      'duckduckgo',
      'brave',
      'tavily',
      'search key',
      'search provider',
      'uninstall harbor',
    ],
  },
  {
    id: 'wayfinding',
    title: 'Wayfinding',
    where: 'Menu, Settings, Wayfinding',
    text: "How the agent finds its way, on by default. Memory: the agent keeps notes on each coding project inside that project's own repository. Research (off by default) runs web research through Perplexity once a Perplexity API key is connected.",
    keywords: [
      'wayfinding',
      'memory',
      'skills',
      'browser',
      'research',
      'deep research',
      'remember',
    ],
  },
  {
    id: 'humanize',
    title: 'Humanize Writing',
    where: 'Menu, Settings, Writing',
    text: 'On by default: keeps text a model writes for you plain and specific, free of chatbot tells. Turn it off in Settings, Writing.',
    keywords: [
      'humanize',
      'humanize writing',
      'sounds like ai',
      'writing style',
      'tone',
      'chatbot',
    ],
  },
  {
    id: 'writing-voice',
    title: 'Your writing voice',
    where: 'Menu, Settings, Writing',
    text: 'Your own words for how models write for you, alone or with Humanize Writing. Type it in Settings, Writing, or tap Shape it in a chat: describe the style, and a model on your device can add the result to Settings when you tap.',
    keywords: [
      'writing voice',
      'my voice',
      'my style',
      'write like me',
      'custom voice',
      'custom writing',
      'writing prompt',
    ],
  },
  {
    id: 'chain-of-thought',
    title: 'Chain of Thought',
    where: 'Menu, Settings, Reasoning',
    text: 'Off by default. Turn it on to see how a model reasons: its thinking streams above the answer while it works, then folds to one line you can tap open.',
    keywords: [
      'chain of thought',
      'show reasoning',
      'see thinking',
      'show thinking',
      'thought process',
      'why did it answer',
    ],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    where: 'Menu, Settings, Notifications (iPhone)',
    text: 'Downloads tells you when a model finishes downloading while you are away; Replies tells you when a reply is ready or a chat needs your approval. If they are off in iOS, turn them on in iOS Settings, OpenShore, Notifications.',
    keywords: ['notifications', 'notices', 'alerts', 'push', 'notify me'],
  },
  {
    id: 'this-device',
    title: 'This device',
    where: 'Menu, Settings, This device',
    text: 'Appearance (System, Light, Dark), an on-device activity log you can copy or clear, and Store tokens and secrets, an encrypted per-project note only a local model can use (off by default).',
    keywords: [
      'appearance',
      'dark mode',
      'light mode',
      'theme',
      'activity log',
      'store secrets',
      'tokens',
    ],
  },
  {
    id: 'account',
    title: 'Account',
    where: 'Menu, Settings, Account, or the Sign in row',
    // There is nothing to buy: OpenShore is free and open source.
    text: `Chatting needs no account. Signing in is free and opens building, Projects, Vault, Crew, and docking, and takes your theme and a few preferences to your other devices. Chats are not synced between devices; your phone reaches your computer's chats once docked.${teamsOn ? ' After creating one you choose personal or business; a business adds a company, admins, and a shared stack managed from Admin.' : ''}`,
    keywords: [
      'account',
      'sign in',
      'login',
      'sign up',
      'create account',
      'business',
      'company',
      'admin',
      'sync',
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy',
    where: 'Menu, Settings, Privacy and Ethical boundaries',
    text: 'Local models keep your words on your device, unless a cloud model in the same chat reads them later, on its own turn or as a step in a plan. Cloud models run on your own API keys, and an amber pill or dot marks a chat whose latest turn went to one. Chats, projects, and API keys are encrypted on the device; with Settings, Chats, Save chats as files on (the default), each chat is also a plain markdown file in OpenShore/Chats on the device. What does leave is short and listed under Settings, Privacy, What leaves this device: a cloud model you chose, a web search you allowed, update checks, the model list, and your account while signed in.',
    keywords: [
      'privacy',
      'private',
      'keys',
      'secrets',
      'data',
      'telemetry',
      'tracking',
      'leave my phone',
      'safe',
      'secure',
      'encrypted',
    ],
  },
  {
    id: 'offline',
    title: 'Working offline',
    text: 'With no connection, on-device models (Harbor Lite, Harbor) still answer; your computer and cloud models wait for a connection, and a banner says so. Web search needs a connection.',
    keywords: [
      'offline',
      'no internet',
      'without internet',
      'airplane mode',
      'no signal',
      'no wifi',
    ],
  },
  {
    id: 'clear-conversations',
    title: 'Clear chats',
    where: 'Menu, Settings, Clear chats',
    text: 'Removes every chat from this device after you confirm. It cannot be undone; sessions on your computer stay there.',
    keywords: ['clear', 'delete all', 'wipe', 'reset', 'erase history'],
  },
];

/** The cards this build's guide may use: a later tier's cards stay out of an
 *  earlier build (docs/release-tiers.md). */
export const GUIDE_CARDS: readonly GuideCard[] = ALL_GUIDE_CARDS.filter(
  (card) => !card.feature || featureOn(card.feature),
);
