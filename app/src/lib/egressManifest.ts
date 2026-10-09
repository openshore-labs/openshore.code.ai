// What leaves this device (v1 Phase 2, docs/v1-direction-review.md "What
// leaves this device"): one list, in plain words, of everything OpenShore
// sends off this device, who receives it, and when. Settings renders it (a
// row under Privacy, grouped by recipient, OpenShore first); the egress test
// (app/test/egressManifest.test.ts) reads the same list and fails on any host
// in the source that is not on it, so the list cannot fall behind the code.
//
// Every entry is true of the code today. The v1 review's four privacy calls
// are made (founder, 2026-09-27, DECISIONS): web search asks once (on by
// default for a day, 2026-10-01, then asks once again from 2026-10-02 on the
// CTO's recommendation), desktop updates ask before downloading, the guardrail
// record never uploads a named person, and the repository sign-in exchange
// keeps no copy of the token.

import { featureOn, type ReleaseTier, type TieredFeature, RELEASE_TIER } from './focus.js';
import type { Platform } from './platform.js';
import { PAY_GATES_ENABLED } from './payGate.js';
import { followsList } from './profile.js';
import { VAULT_CARRY_CAVEAT, VAULT_PRIVATE_OFF_CLOUD } from './vaultCopy.js';

export interface EgressEntry {
  id: string;
  /** Who receives it. Entries render grouped by this, in RECIPIENT_ORDER. */
  recipient: string;
  /** What is sent, in plain words. */
  what: string;
  /** When it happens. */
  when: string;
  /** 'on' happens by default, 'off' only after the person turns it on,
   *  'tap' only on the person's own tap. */
  start: 'on' | 'off' | 'tap';
  /** The hosts this entry covers, for the egress test. `env:NAME` names a
   *  host set at build time. */
  hosts: string[];
  /** The later-tier feature this belongs to (docs/release-tiers.md); a build
   *  without it leaves the entry off the list, since it cannot happen there. */
  feature?: TieredFeature;
  /** The platforms it can happen on, when not all of them. The iPhone and
   *  iPad list leaves out what they never contact (the Stripe rail), so the
   *  list there names no other way to pay (App Store 3.1.1; CTO, 2026-09-30). */
  platforms?: readonly Platform[];
  /** Only happens in a build with the pay gates on, so a build without them
   *  leaves it off the list (first submission, 2026-10-01). */
  paid?: true;
}

/** Crew routines follow the web search switch, and only search (founder,
 *  2026-10-01, replacing CTO 3's "never"): the one sentence the search entry
 *  and the Settings row both carry. Nothing else a routine does reaches the web. */
export const ROUTINES_SEARCH_LINE =
  'Crew routines follow this switch while your computer is on, and only search; they never open pages.';

/** Once a chat on a seat that stays holds a private note's text (a read, a
 *  marked turn, or a private pin), every search a model writes shows its
 *  words and asks first, every time, past a standing allow (CX and CMO,
 *  2026-10-08, H). The search entry carries it. */
export const PRIVATE_SEARCH_LINE =
  'Once a local model in a chat has read a private note, or its project pins one, each search it writes shows its words and asks first.';

/** The same rule for a page the coding agent opens: it asks every time, past
 *  Opening web pages: Always and Bypass (H). The web pages entry carries it. */
export const PRIVATE_PAGE_LINE =
  'Once a local model in a chat has read a private note, or its project pins one, every page it opens asks first, even on Always.';

/** Recipients in the order the list shows them: OpenShore first. */
export const RECIPIENT_ORDER = [
  'OpenShore (us)',
  'Payments',
  'GitHub',
  'Web search',
  'Your cloud providers',
  'Model downloads',
  'Services you connect',
] as const;

export const EGRESS: EgressEntry[] = [
  {
    id: 'account',
    recipient: 'OpenShore (us)',
    what: 'Your email and password to sign in, then what your account needs to work: its sign-in renewed, and its plan.',
    when: 'Only once you sign in, and then each time the app opens while you are signed in. Chatting needs no account; building, Projects, Vault, Crew, Terminal, and pairing do.',
    start: 'off',
    hosts: ['env:VITE_SUPABASE_URL'],
  },
  {
    id: 'preferences',
    recipient: 'OpenShore (us)',
    // Named from the one list the signed-in card and the profile read
    // (settingsReach.ts through profile.ts), so the three cannot drift.
    what: `Your app preferences, so they follow you to your other devices: ${followsList()}. Never your chats, prompts, projects, keys, or addresses.`,
    when: 'Only while you are signed in: when you change one, and when the app opens.',
    start: 'on',
    hosts: ['env:VITE_SUPABASE_URL'],
  },
  {
    id: 'guardrail',
    recipient: 'OpenShore (us)',
    what: 'When the guardrail blocks a request: its category, the time, a one-way hash of the request, and which model path it took. Never your prompt, and never the name of a person the request was about; that stays in the copy on this device.',
    when: 'Only while you are signed in. Signed out, the record stays on this device.',
    start: 'on',
    hosts: ['env:VITE_SUPABASE_URL'],
  },
  {
    id: 'push',
    recipient: 'OpenShore (us)',
    what: 'A notification token for your iPhone, and for each notification only a session id, its kind, and a number, relayed to Apple. Never the words of a chat.',
    when: 'Only after you allow notifications on your iPhone.',
    start: 'off',
    hosts: ['env:VITE_SUPABASE_URL'],
  },
  {
    id: 'team',
    recipient: 'OpenShore (us)',
    what: 'Your organization (its name, seats, and plan), the email addresses you invite and their roles, notes you put in a team vault, and team project settings, so your team can read them.',
    when: 'Only when you set up an organization or invite someone, and in a team vault or a team project.',
    start: 'off',
    hosts: ['env:VITE_SUPABASE_URL'],
    feature: 'teams',
  },
  {
    id: 'repo-signin',
    recipient: 'OpenShore (us)',
    what: 'Connecting GitHub, GitLab, or Bitbucket: the sign-in exchange passes through our server, so the access token passes through it when you connect and each time it is refreshed. Our server keeps no copy and writes none of it to a log.',
    when: 'Only when you connect one.',
    start: 'tap',
    hosts: ['env:VITE_SUPABASE_URL', 'github.com', 'gitlab.com', 'bitbucket.org'],
  },
  {
    id: 'purchase',
    recipient: 'OpenShore (us)',
    what: 'Your App Store receipt, to link a purchase to your account.',
    when: 'Only when you buy or restore a purchase.',
    start: 'tap',
    hosts: ['env:VITE_SUPABASE_URL'],
    platforms: ['ios'],
    paid: true,
  },
  {
    id: 'purchase-web',
    recipient: 'OpenShore (us)',
    what: 'Your sign-in, asking our server to start an OpenShore Plus checkout or open your subscription. Our server makes the Stripe page for your account and answers its address; your card never touches OpenShore.',
    when: 'Only on the desktop or the web, when you tap Get Plus or Manage subscription.',
    start: 'tap',
    hosts: ['env:VITE_SUPABASE_URL'],
    platforms: ['electron', 'web'],
    paid: true,
  },
  {
    id: 'stripe',
    recipient: 'Payments',
    what: 'Stripe Checkout and the Stripe billing page open in your own browser, where you give Stripe your email and card. Stripe tells our server that you paid and until when, and nothing about your chats or work.',
    when: 'Only on the desktop or the web, after you tap Get Plus or Manage subscription.',
    start: 'tap',
    hosts: ['checkout.stripe.com', 'billing.stripe.com'],
    platforms: ['electron', 'web'],
    paid: true,
  },
  {
    id: 'account-deletion',
    recipient: 'OpenShore (us)',
    what: 'Your sign-in, asking our server to delete your account. It erases the account, cancels a plan you pay us for on the web, and keeps only a one-way hash of your email if an operator had ended the account for abuse, plus any record under a legal hold until the hold ends. Apple subscriptions are cancelled with Apple.',
    when: 'Only when you tap Delete account and confirm.',
    start: 'tap',
    hosts: ['env:VITE_SUPABASE_URL'],
  },
  {
    id: 'catalog',
    recipient: 'OpenShore (us)',
    what: 'A request for the model list. Nothing about you rides along; the server sees your network address, as any website does.',
    when: 'When you open Stack or the Marketplace, at most once a day.',
    start: 'on',
    hosts: ['openshore.ai'],
  },
  {
    id: 'updates',
    recipient: 'GitHub',
    what: 'A check for a newer version (your version and network address). Nothing downloads until you click Update in the bar that says a new version is out.',
    when: 'At launch, then every 30 minutes, on the desktop app.',
    start: 'on',
    hosts: ['api.github.com', 'github.com'],
  },
  {
    id: 'repos',
    recipient: 'GitHub',
    what: 'Your repositories on your own access: listing, cloning, pulling, and pushing them.',
    when: 'When you connect a repository service and work with a repository.',
    start: 'tap',
    hosts: ['api.github.com', 'github.com', 'gitlab.com', 'api.bitbucket.org', 'bitbucket.org'],
  },
  {
    id: 'search',
    recipient: 'Web search',
    what: 'The words of a web search, and the network address any web request carries. Harbor Lite sends your question itself (up to 200 characters); other models write search words from your chat. DuckDuckGo by default, with no key and no account. Never the rest of your chat, never your files.',
    when: `When a model decides to search the web, after you allow it once. A chat asks the first time; the coding agent searches only once you allow it. ${PRIVATE_SEARCH_LINE} ${ROUTINES_SEARCH_LINE} You can turn it off in Settings, Web search.`,
    start: 'off',
    hosts: ['html.duckduckgo.com', 'duckduckgo.com'],
  },
  {
    id: 'web-pages',
    recipient: 'Web search',
    what: 'A request for a web page the coding agent opens on your computer, to that site, with the network address any web request carries.',
    when: `When the coding agent opens a page: it asks first unless you set Opening web pages to Always in Settings, Approvals, and never opens one if you set it to Never. A page on your own network always asks. ${PRIVATE_PAGE_LINE} Crew routines never open pages.`,
    start: 'tap',
    hosts: [],
    platforms: ['electron'],
  },
  {
    id: 'search-keys',
    recipient: 'Web search',
    what: 'The same search words, to Brave, Tavily, or Perplexity instead.',
    when: "Only when you add that service's key, or turn Research on for Perplexity.",
    start: 'off',
    hosts: ['api.search.brave.com', 'api.tavily.com', 'api.perplexity.ai'],
  },
  {
    id: 'cloud-models',
    recipient: 'Your cloud providers',
    what: `Your chat, and the notes and files it draws on, to Anthropic, OpenAI, Google, Moonshot, Perplexity, Venice, OpenRouter (which forwards it to the model's own provider), or a provider whose key you add with osc key add (Groq, Together AI, DeepSeek, Mistral, xAI, Cerebras, Hugging Face, Nebius, Novita AI, MiniMax, NVIDIA, or one you give the address of), on your own key. ${VAULT_PRIVATE_OFF_CLOUD} An amber pill or dot marks a chat whose latest turn went to one. Connecting Venice or OpenRouter, or choosing its models, also asks it for the list of models it offers.`,
    when: 'Only when you pick a cloud model or place one in your Stack, and only on the turns it answers. On your computer, the coding agent asks first in each task. For Venice or OpenRouter, also when you connect its key or open Choose models. A key you add with osc key add, on your computer or a server you dock, is used there only by coding sessions on the model you place, and they ask first in each task.',
    start: 'off',
    hosts: [
      'api.anthropic.com',
      'api.openai.com',
      'generativelanguage.googleapis.com',
      'api.moonshot.ai',
      'api.perplexity.ai',
      'api.venice.ai',
      'openrouter.ai',
      // The named providers of 2026-10-09, which osc key add knows
      // (os-code/src/auth/providerKeys.ts, KNOWN_PROVIDERS).
      'api.groq.com',
      'api.together.ai',
      'api.deepseek.com',
      'api.mistral.ai',
      'api.x.ai',
      'api.cerebras.ai',
      'router.huggingface.co',
      'api.tokenfactory.nebius.com',
      'api.novita.ai',
      'api.minimax.io',
      'integrate.api.nvidia.com',
    ],
  },
  {
    id: 'own-model',
    recipient: 'Your cloud providers',
    what: `Your chat, and the notes and files it draws on, to a model server you connect yourself (one you run, or one you name with its address and key). Private notes go only to one on your own network. ${VAULT_CARRY_CAVEAT}`,
    // A model you connect can be placed in a Stack slot too, and then it
    // answers on every turn routed to it, as a placed cloud model does (D).
    when: 'Only when you connect one and pick it or place it in your Stack, and only on the turns it answers.',
    start: 'off',
    hosts: [],
  },
  {
    // Privacy review, 2026-10-08: a cloud tag is served by the Ollama on your
    // computer, but every request for it goes on to ollama.com (seatLeaves).
    id: 'ollama-cloud',
    recipient: 'Your cloud providers',
    what: "Your chat, and the files the coding agent reads for it, to ollama.com through your own Ollama account, when a model you pick or place is one of Ollama's cloud models (its tag says cloud, like kimi-k3:cloud). Your Ollama server passes each turn on.",
    when: 'Only when you pick or place one, and then on every turn it answers. On your computer, the coding agent asks first in each task.',
    start: 'off',
    hosts: [],
  },
  {
    id: 'your-computer',
    recipient: 'Services you connect',
    what: 'Your chats, sessions, and approvals, to your own computer running OpenShore, over your private Tailscale network. Nothing goes through us.',
    when: 'Only after you pair this device with your computer.',
    start: 'off',
    hosts: [],
  },
  {
    id: 'speech',
    recipient: 'Services you connect',
    what: "What you say into the mic, to the speech service built into the desktop app or your browser (Google's, in Chrome and Electron). On iPhone and iPad, speech is turned into text on the device and never sent.",
    when: 'Only when you tap the mic on the desktop or the web.',
    start: 'tap',
    hosts: [],
    platforms: ['electron', 'web'],
  },
  {
    id: 'weights',
    recipient: 'Model downloads',
    what: 'A request for the model you picked (and the Ollama installer, on first run). For a model that runs on your computer, nothing about you rides along. An Ollama cloud model (a :cloud tag) works only under your Ollama account, which Ollama itself signs in with.',
    when: 'Only when you tap to download a model or set up Ollama.',
    start: 'tap',
    hosts: ['ollama.com', 'huggingface.co'],
  },
  {
    id: 'decisions',
    recipient: 'Services you connect',
    what: 'The task and its result, to the decision service you turned on for a project, for a quick call on which model answers.',
    when: 'Only on a project where you turned one on, with a paid model.',
    start: 'off',
    hosts: ['api.typesafe.ai'],
    feature: 'currents',
  },
  {
    id: 'gdrive',
    recipient: 'Services you connect',
    what: 'The files OpenShore itself keeps in your Google Drive, and nothing else there.',
    when: 'Only when you connect Google Drive for Repositories.',
    start: 'off',
    hosts: [
      'www.googleapis.com',
      'oauth2.googleapis.com',
      'accounts.google.com',
      'drive.google.com',
    ],
  },
  {
    id: 'codemagic',
    recipient: 'Services you connect',
    what: 'A build request for your app, on your own Codemagic token.',
    when: 'Only when you launch a build.',
    start: 'tap',
    hosts: ['api.codemagic.io', 'codemagic.io'],
    feature: 'launch',
  },
  {
    id: 'agents',
    recipient: 'Services you connect',
    what: 'Work you hand to an agent you connected, at the address you gave it. Its connection is checked each time the app opens.',
    when: 'Only after you connect one.',
    start: 'off',
    hosts: [],
    feature: 'currents',
  },
];

/** Hosts that appear in the source only as links the person opens in their
 *  own browser, placeholders, or documentation, never fetched by the app. Each
 *  says why, so a new host cannot hide here by accident. */
export const LINK_ONLY_HOSTS: Record<string, string> = {
  'tailscale.com': "download and help links; Tailscale's own app talks to its servers, not ours",
  'play.google.com': 'store link',
  'apps.apple.com': 'store link',
  'platform.openai.com': 'where to get a key',
  'console.anthropic.com': 'where to get a key',
  'aistudio.google.com': 'where to get a key',
  'platform.kimi.ai': 'where to get a key',
  'venice.ai': 'where to get a key',
  'id.atlassian.com': 'where to make a Bitbucket app password',
  'hermes-agent.nousresearch.com': 'documentation link',
  'www.perplexity.ai': 'link',
  'typesafe.ai': 'link',
  'docs.codemagic.io': 'documentation link',
  'developer.mozilla.org': 'documentation link',
  'en.wikipedia.org': "the humanizer's source, a dated snapshot, never fetched",
  'cv.iptc.org': 'an image metadata vocabulary name, not a request',
  'example.com': 'placeholder',
  'mini.tail1234.ts.net': 'placeholder',
  'your-computer.ts.net': 'placeholder',
  'your-agent.ts.net': 'placeholder',
};

/** What stays on this device, for the list's other half. */
export const STAYS_ON_DEVICE: string[] = [
  'Everything you send a local model, and everything it answers, unless a cloud model in the same chat reads it later, on its own turn or as a step in a plan (a web search sends only its words, listed above).',
  'Your chats, projects, settings, and session journals, sealed at rest.',
  'Your API keys: in the Keychain on iPhone and iPad; on a computer, encrypted under a key in its keychain. Each is sent only to its own provider.',
  'Your Vault notes and your code, as plain files you own.',
  'Undo snapshots of your files, in a folder on this computer.',
  'Which folders you trust and the commands you allow.',
];

/** The entries this build can do on this platform, grouped by recipient,
 *  OpenShore first. With no platform given, every platform's entries. */
export function egressByRecipient(
  tier: ReleaseTier = RELEASE_TIER,
  on?: Platform,
  payGates: boolean = PAY_GATES_ENABLED,
): Array<{ recipient: string; entries: EgressEntry[] }> {
  return RECIPIENT_ORDER.map((recipient) => ({
    recipient,
    entries: EGRESS.filter(
      (e) =>
        e.recipient === recipient &&
        (!e.feature || featureOn(e.feature, tier)) &&
        (!e.paid || payGates) &&
        (!on || !e.platforms || e.platforms.includes(on)),
    ),
  })).filter((g) => g.entries.length > 0);
}
