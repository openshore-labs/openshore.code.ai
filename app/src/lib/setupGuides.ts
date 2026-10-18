// Guided setup chats. Every place the app would otherwise say "enter a key" or
// "set this up" gets a Walk me through it button that opens a chat with the
// guide, seeded with the steps below, exactly the way a person works with a
// coding agent: a goal, the plan, one step at a time, ask anything in between.
// The steps are written here, not model-generated, so they are right even on a
// small model; the model's job is to answer questions and adapt. No em dashes.
import { ROUTINE_NOTES_PLACE, VAULT_PRIVATE_OFF_MARKED } from './vaultCopy.js';
import { thisDeviceNoun } from './deviceNoun.js';
import { BYOM_FORWARDS_NAME } from './byom.js';
import {
  LOCAL_IMAGE_READER,
  SMALL_IMAGE_READER,
  aboutGB,
  listWords,
  otherCloudReaders,
} from './imageReading.js';
import { SHIPS_CURRENTS, SHIPS_LAUNCH, featureOn, type TieredFeature } from './focus.js';

export type SetupGuideId =
  | 'get-harbor'
  | 'get-harbor-master'
  | 'connect-cloud-key'
  | 'connect-own-gateway'
  | 'pair-computer'
  | 'install-ollama'
  | 'image-reader-local'
  | 'image-reader-cloud'
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
  /** The later tier this guide belongs to, if any (lib/focus.ts). */
  feature?: TieredFeature;
}

const ALL_SETUP_GUIDES: Partial<Record<SetupGuideId, SetupGuide>> = {
  'get-harbor': {
    id: 'get-harbor',
    title: 'Get Harbor',
    goal: `Add Harbor, a coding model that runs on ${thisDeviceNoun()} and can help me build for real.`,
    steps: [
      'Open Settings and find the Harbor section. Harbor Lite, the built-in guide, is already there. Harbor is the coder that runs alongside it.',
      'On the Harbor row, tap Install. It downloads straight from the source, about 3.5 GB, roughly a few minutes on wifi. You can keep chatting while it lands.',
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
      `When it finishes, the row reads Installed and DeepBlue is your Reasoning model on that computer. To reach it from ${thisDeviceNoun()}, dock the two under Computer; it then appears as Your computer.`,
    ],
    done: "DeepBlue plans and edits your repositories on your computer. For the hardest steps, a cloud key on your own account is one tap away, and on your computer it asks before a cloud model's first step in each task.",
  },
  'connect-cloud-key': {
    id: 'connect-cloud-key',
    title: 'Add an API key',
    goal: 'Use Claude, OpenAI, or Gemini on my own key.',
    steps: [
      'Pick the provider you already pay for. If you have none, Claude is the strongest for coding; the console link on the Cloud Connections screen opens it inside the app.',
      'Sign in on the provider page and create a new API key. Copy it. How a key starts depends on the provider; where it says, the key field shows it (Claude keys start with sk-ant-).',
      'Back in OpenShore, open Cloud Connections and tap that provider (Groq, Mistral, DeepSeek and the rest are under More providers), paste the key, and tap Save. The app checks the key with the provider where it can, and says so when it could not.',
      'Open Stack and place the provider model where you want it: as your Reasoning model, or as a specialist for one kind of task.',
    ],
    done: 'The provider shows connected, and it appears in the model menu. Your API key is stored only on this device and sent only to that provider, unless you turn it on for a server you dock, which then keeps it too.',
  },
  // Bring your own keys, Part 4 (2026-10-09): Bedrock, Azure and
  // Vertex sign in their own way, so they come through a gateway the person
  // runs, never one of ours. LiteLLM's proxy listens on 0.0.0.0, port 4000,
  // by default, which on a rented server is the open internet, so the start
  // command binds it to the machine's Tailscale address (docking's own rule:
  // the tailnet only, never a public bind), and the master key is a long
  // random one. A placeholder left in --host fails to start rather than
  // falling back to every network. Checked against LiteLLM 1.104.2's own
  // source (its CLI's --host and --port defaults, the proxy extra,
  // general_settings.master_key, the sk- prefix, x-api-key, /v1/models and
  // /v1/messages).
  'connect-own-gateway': {
    id: 'connect-own-gateway',
    title: 'Use Bedrock, Azure, or Vertex',
    goal: 'Use models on Amazon Bedrock, Azure, or Google Vertex AI with my own keys, through a gateway I run myself.',
    steps: [
      "These three sign in their own way, so OpenShore reaches them through LiteLLM, a free gateway you run on your computer or your server with your own provider keys. OpenShore runs nothing here and never sees those keys. LiteLLM's quick start, at https://docs.litellm.ai/docs/proxy/quick_start, has the full steps.",
      {
        text: 'On your computer or your server, install the LiteLLM proxy:',
        paste: "pip install 'litellm[proxy]'",
      },
      {
        text: 'Make a long random master key, so no one can guess it. This prints one that starts with sk-, as LiteLLM asks. Keep it for the next step and for OpenShore, and use it for this gateway only:',
        paste: 'echo "sk-$(openssl rand -hex 24)"',
      },
      {
        text: 'Write a config.yaml with your models and that key. This one lists one Bedrock model; add an entry for each model you want, named for its provider (bedrock/, azure/, or vertex_ai/ before the model), and put your key in place of sk-your-master-key. Your provider credentials go where the quick start says, on that machine:',
        paste:
          'model_list:\n  - model_name: claude-haiku\n    litellm_params:\n      model: bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0\ngeneral_settings:\n  master_key: sk-your-master-key',
      },
      {
        text: `Find the machine's Tailscale address, on the private network docking uses (it starts with 100.; on a Mac the Tailscale app shows it). Put ${thisDeviceNoun()} on the same Tailscale network too:`,
        paste: 'tailscale ip -4',
      },
      {
        text: 'Start the gateway on that address only, with it in place of 100.x.y.z. Left out, --host is every network the machine joins, and on a rented server that is the open internet. Leave it running (on a server, inside tmux, so it outlives your SSH session):',
        paste: 'litellm --config config.yaml --host 100.x.y.z',
      },
      `In OpenShore on ${thisDeviceNoun()}, open Stack and tap Connect a model under Bench. Name it, and give the address with the machine's address in place of 100.x.y.z: \`http://100.x.y.z:4000/v1\`. Pick either format (LiteLLM answers both), and turn on ${BYOM_FORWARDS_NAME}. For the API key, paste your master key. It is the gateway's admin key; if you run LiteLLM with its database, a virtual key limited to these models is the better one to paste.`,
      'Tap Load models, make sure the models from your config are ticked, and tap Connect. They land on your bench, ready to place.',
    ],
    done: `The models sit on your bench with an amber Cloud chip: with ${BYOM_FORWARDS_NAME} on, the gateway counts as cloud. ${VAULT_PRIVATE_OFF_MARKED}`,
  },
  'pair-computer': {
    id: 'pair-computer',
    title: 'Connect your computer',
    goal: `Run my model on my own computer and reach it from ${thisDeviceNoun()}.`,
    steps: [
      `On both ${thisDeviceNoun()} and your computer, install Tailscale and sign in to the same account. It is free for personal use. Ask me if you want the Tailscale steps.`,
      'On your computer, open OpenShore, then Computer. The QR is there (if it says Off, tap Turn on).',
      `On ${thisDeviceNoun()}, open Computer and tap Scan the QR on your computer. Point the camera at the QR and it connects by itself. Or point the Camera app at it and tap the link.`,
      'If the camera is not available, type the address (it looks like http://100.x.y.z:4816) and the code shown under the QR (Show the code), then tap Dock.',
    ],
    done: 'The screen says connected. In the model menu, Your computer is now a choice, for chat and for coding on your repositories.',
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
  // The two doors a Stack chat offers when nothing can read images (maintainer,
  // 2026-10-07). The model names, sizes and pull commands come from the
  // catalog through imageReading.ts. On the phone only Harbor reads images
  // (stack.ts visionCapable), so this local reader runs on the computer and
  // the phone reaches it as a model you connect (byom.ts): an Ollama address
  // on the tailnet is local, so plain http is allowed.
  'image-reader-local': {
    id: 'image-reader-local',
    title: 'Source a local model',
    goal: 'Read images with a model on my own computer, so pictures stay on my network.',
    steps: [
      {
        text: `This reader runs on your computer through Ollama, and ${thisDeviceNoun()} reaches it over Tailscale. (On ${thisDeviceNoun()} itself, Harbor reads images.) If Ollama is not on your computer yet, install it. On Linux, paste this in a terminal (macOS and Windows use the installer from ollama.com):`,
        paste: 'curl -fsSL https://ollama.com/install.sh | sh',
      },
      {
        text: `On your computer, pull ${LOCAL_IMAGE_READER.name}, ${aboutGB(LOCAL_IMAGE_READER)}, the image reader we suggest:`,
        paste: LOCAL_IMAGE_READER.pull,
      },
      {
        text: `Short on room? Pull ${SMALL_IMAGE_READER.name} instead, ${aboutGB(SMALL_IMAGE_READER)}. It is not as sharp, but it fits almost anywhere:`,
        paste: SMALL_IMAGE_READER.pull,
      },
      // Ollama's own way to listen on the network, per system, so the
      // setting holds and the server keeps the models it pulled (a hand-run
      // `ollama serve` on Linux reads another folder than the service).
      // 0.0.0.0 is every network the computer joins, and Ollama has no
      // password (privacy review, 2026-10-08), so the step says so before the
      // person sets it, and the last two steps take it away again.
      {
        text: `Ollama answers only on your computer at first. To let ${thisDeviceNoun()} reach it, have it listen on your network. Ollama has no password, so once this is set it answers anyone on every network this computer joins, not only your home one, until you remove the setting (the last two steps say how). On a laptop, keep to networks you trust, or remove the setting before you join one you do not. On Windows, quit Ollama from the taskbar, search Settings for environment variables, add OLLAMA_HOST with the value 0.0.0.0 to your account, and open Ollama again. On a Mac, paste this in Terminal, then quit Ollama from the menu bar and open it again (after the Mac restarts, paste it once more):`,
        paste: 'launchctl setenv OLLAMA_HOST "0.0.0.0"',
      },
      {
        text: 'On Linux, run sudo systemctl edit ollama, add these two lines in the space at the top, and save. Then run sudo systemctl daemon-reload and sudo systemctl restart ollama:',
        paste: '[Service]\nEnvironment="OLLAMA_HOST=0.0.0.0"',
      },
      `Make sure ${thisDeviceNoun()} and your computer are on the same Tailscale network, the one docking uses, and find your computer's Tailscale address in the Tailscale app (it starts with 100.). Ollama now answers on every network this computer joins, with no password, so never forward port 11434 to the internet.`,
      `In OpenShore on ${thisDeviceNoun()}, open Stack and tap Connect a model under Bench. Name: ${LOCAL_IMAGE_READER.name}. Address: \`http://100.x.y.z:11434/v1\`, with your computer's Tailscale address in place of 100.x.y.z. Leave the API key blank and tap Load models. Make sure ${LOCAL_IMAGE_READER.ref} (or ${SMALL_IMAGE_READER.ref}) is ticked, and tap Connect.`,
      'Still in Stack, tap Local under Image reading, choose it, and tap Save.',
      {
        text: `Later, whenever you want Ollama off your networks again, remove the setting (${thisDeviceNoun()} then cannot reach it). On Windows, quit Ollama from the taskbar, search Settings for environment variables, delete OLLAMA_HOST from your account, and open Ollama again. On a Mac, paste this in Terminal, then quit Ollama from the menu bar and open it again:`,
        paste: 'launchctl unsetenv OLLAMA_HOST',
      },
      'On Linux, to remove it later, run sudo systemctl edit ollama, delete the two lines you added, and save. Then run sudo systemctl daemon-reload and sudo systemctl restart ollama.',
    ],
    done: 'The Local row under Image reading names it. The next picture goes to it without asking, and stays on your own network.',
  },
  'image-reader-cloud': {
    id: 'image-reader-cloud',
    title: 'Connect a cloud model',
    goal: 'Read images with a cloud model on my own API key.',
    steps: [
      `Pick a provider. Claude reads images out of the box, and ${listWords(otherCloudReaders())} read them too. If you have none yet, Claude is a good start.`,
      "Open Cloud Connections and tap that provider. In its sheet, Get a key opens the provider's page: sign in, create a new API key, and copy it (Claude keys start with sk-ant-).",
      'Paste the key and tap Save. The app checks the key with the provider before it says connected. If Claude asks for a Workspace ID, the sheet says where to find it.',
      'Now a picture in a Stack chat goes to it on your key, and the chat asks before each one. To skip the asking, open Stack, tap Cloud under Image reading, choose a model that reads images, and tap Save.',
    ],
    done: 'Send the picture again. The chat names the model and asks first, or, once a model is set under Image reading, Cloud, sends it straight there.',
  },
  'pick-a-model': {
    id: 'pick-a-model',
    title: 'Pick a model',
    goal: 'Get a model running so I can chat and build.',
    steps: [
      `Decide where it runs. On ${thisDeviceNoun()}: Harbor, a coding model that runs fully on the device, offline. On your computer: DeepBlue, through Ollama, the most capable of the built-in models.`,
      `On ${thisDeviceNoun()}, open Settings, find the Harbor section, and tap Install on the Harbor row. On your computer, open Stack and install DeepBlue, sized to your computer. Weights download straight from their source, never through OpenShore.`,
      'When it finishes, it becomes your Reasoning model. Open Stack to see it, and to add specialists or a cloud model on your own API key.',
    ],
    done: 'The model menu shows Stack, and a first message gets a real answer.',
  },
  'open-a-repo': {
    id: 'open-a-repo',
    title: 'Open a repository',
    goal: 'Point OpenShore at my code so it can read, edit, and run it.',
    steps: [
      'Make sure a model is set up first (Stack). The agent needs a brain before it can open a repository.',
      `On your computer, open Repositories and tap Open a local folder, or paste a clone URL. On ${thisDeviceNoun()}, connect your computer first; the code lives there.`,
      'A coding chat opens on that folder. Ask for something small and real, like: explain this project and run its tests.',
      'Every command asks before it runs. Edits go through and show their diff in the chat, or choose Ask first in Settings, under Approvals, to check each one. You stay in control.',
    ],
    done: 'The chat header names your repository, and the agent reads files, makes changes you can see as diffs, and asks before any command.',
  },
  'install-tailscale': {
    id: 'install-tailscale',
    title: 'Install Tailscale',
    goal: `Give ${thisDeviceNoun()} and my computer a private network to talk over.`,
    steps: [
      'Install Tailscale on your computer from tailscale.com and sign in (Google, Apple, GitHub, or Microsoft accounts all work).',
      `Install the Tailscale app on ${thisDeviceNoun()} from the App Store and sign in with the same account.`,
      'Turn it on in the Tailscale app. Both devices now share a private network, no port forwarding, no public exposure.',
    ],
    done: `The Tailscale app on ${thisDeviceNoun()} lists your computer. Now dock them under Computer.`,
  },
  'set-up-crew': {
    id: 'set-up-crew',
    title: 'Set up your crew',
    goal: 'Have a crew member work on a schedule on my own computer, so results are waiting when I come back.',
    steps: [
      'Routines run on your computer, on your own models, while it is on. You set one up while connected to that computer.',
      'If you have not docked yet, open Computer and dock this device. Tailscale must be on for both, the same connection the big models use.',
      'Make sure the work lives on your computer: open Repositories and clone the repository you want the crew to work in, if it is not there already.',
      'Open Crew, then Crew command, and set up the Morning review routine. It reads what changed overnight and leaves a checklist, read-only, so it never needs an approval.',
      'Away from home you can always watch your crew and read its results here. To change or run a routine, reconnect to your computer over Tailscale first.',
    ],
    done: `A routine shows in Crew command with its next run time, and its first report lands as a note in ${ROUTINE_NOTES_PLACE}.`,
  },
  // A later tier's guides, tagged with their feature and left out of a build
  // without it (SETUP_GUIDES below). They also sit behind their SHIPS_ gate,
  // which folds to false in a Personal build's bundle, so their words are not
  // in that build at all (app/test/tierBundle.test.ts).
  ...(SHIPS_LAUNCH
    ? {
        'connect-codemagic': {
          id: 'connect-codemagic',
          feature: 'launch',
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
      }
    : {}),
  ...(SHIPS_CURRENTS
    ? {
        'connect-hermes': {
          id: 'connect-hermes',
          feature: 'currents',
          title: 'Connect Hermes Agent',
          goal: 'Run Hermes Agent on a computer I own and reach it from OpenShore, so it shows up on my bench, in my crew, and in my vault.',
          steps: [
            'Agentic Currents are a beta. Hermes runs its own tools on its own computer under its own rules; OpenShore shows you what it remembers and lets your models hand it work, and off leaves no trace.',
            {
              text: 'On the computer that will run Hermes (a Mac mini or a small Linux box works), install it with the official installer and run the setup wizard:',
              paste:
                'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash && hermes setup',
            },
            {
              text: 'Turn on its API server so OpenShore can talk to it. This serves an OpenAI-compatible endpoint on that computer:',
              paste: 'hermes api-server',
            },
            'Put both computers on the same Tailscale network, the same private link your paired computer uses. Never expose the Hermes port to the public internet.',
            'Back in OpenShore, open the project page, then its Agentic Currents, and turn on Hermes Agent. Enter the address, which ends in /v1, for example http://mini.tail1234.ts.net:8642/v1, and the API key if you set one.',
            'Hermes now sits on your bench in Stack, as a member in Crew command, and its memory and skills read in the Vault when you are docked to the computer that holds its home folder.',
          ],
          done: 'The Hermes Agent row reads On, a faint water-line frames every screen, and Hermes appears on your bench.',
        },
        'cli-pairing': {
          id: 'cli-pairing',
          feature: 'currents',
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
            'In OpenShore, open the project page, then its Agentic Currents, and turn on CLI Pairing. Pick the CLI. OpenShore checks that it is really on the computer before it offers it.',
            'Ask for something small in a coding chat, like: hand this to Claude Code and review the diff. The run shows as a command you approve, and the diff comes back for review.',
          ],
          done: 'The CLI Pairing row reads On, and a coding chat can hand a task to the CLI with a command you approve.',
        },
        'connect-a2a': {
          id: 'connect-a2a',
          feature: 'currents',
          title: 'Connect an agent over A2A',
          goal: 'Reach an agent I run, over the open agent-to-agent protocol, so my stack can hand it work.',
          steps: [
            'Agentic Currents are a beta. A2A is the generic door: any agent that publishes an agent card connects here, Hermes and Vellum included when they expose one. Off leaves no trace.',
            'Find the base address of the agent. It publishes its card at /.well-known/agent-card.json under that address, and its own docs say how to turn A2A on.',
            'Put it on your Tailscale network if it runs on a computer you own. Never expose an agent port to the public internet.',
            'In OpenShore, open the project page, then its Agentic Currents, and turn on A2A. Paste the address and the API key if it needs one. OpenShore reads the card and shows the name of the agent.',
            'In a chat, ask for something the agent is good at. Your model hands it over with the askAgent tool and says plainly when an answer came from it.',
          ],
          done: 'The A2A row reads On and names the agent from its card, and a chat can hand it a task.',
        },
        'connect-jev': {
          id: 'connect-jev',
          feature: 'currents',
          title: 'Turn on Jev',
          goal: 'Layer Jev, a cheap decision model, into the harness so it steers which of my seats answers and skips steps that do not need a model.',
          steps: [
            'Harness Currents are a beta. Jev does not answer for a seat; it makes the small decisions around your seats. It is a cloud call that costs a little per turn, so it only ever runs when a paid seat is in play, never against a free local model.',
            'Get a TypeSafe API key from your TypeSafe account, the same way you would copy an API key for any cloud model.',
            'In OpenShore, open the project page, then its Harness Currents, and turn on Jev. The address is filled in for you; paste your API key.',
            'Now when a turn would spend on a paid seat, Jev first checks whether a cheaper local seat can carry it, routes the turn to the seat placed for that kind of work, and, when there is no check to run, judges whether the result satisfies the task. Each decision shows as a card in the chat.',
          ],
          done: 'The Jev row reads On, a faint water-line frames every screen, and a pill names it beside the reach pill.',
        },
      }
    : {}),
};

/** The guides this build carries: a later tier's stay out of an earlier
 *  build (docs/release-tiers.md), the way GUIDE_CARDS leaves out its cards. */
export const SETUP_GUIDES: Partial<Record<SetupGuideId, SetupGuide>> = Object.fromEntries(
  Object.entries(ALL_SETUP_GUIDES).filter(([, g]) => !g.feature || featureOn(g.feature)),
);

/** The bare numbered steps for a guide, on their own lines, for splicing into a
 *  small model's grounding so it can recite an activation walkthrough verbatim
 *  rather than reason it out. A step with something to paste keeps that on the
 *  next line so the model can lift it into a copy block. */
export function guideStepsCompact(id: SetupGuideId): string {
  return (SETUP_GUIDES[id]?.steps ?? [])
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
