// What leaves this device (v1 Phase 2, docs/v1-direction-review.md "What
// leaves this device"): one list, in plain words, of everything OpenShore
// sends off this device, who receives it, and when. Settings renders it (a
// row under Privacy, grouped by recipient, OpenShore first); the egress test
// (app/test/egressManifest.test.ts) reads the same list and fails on any host
// in the source that is not on it, so the list cannot fall behind the code.
//
// Every entry is true of the code today. The v1 review's four privacy calls
// are made (founder, 2026-09-27, DECISIONS), with one since changed: web
// search asked once, and is on by default since 2026-10-01 (founder,
// DECISIONS). Desktop updates ask before downloading, the guardrail record
// never uploads a named person, and the repository sign-in exchange keeps no copy of the token.

import { featureOn, type ReleaseTier, type TieredFeature, RELEASE_TIER } from './focus.js';
import type { Platform } from './platform.js';

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
}

/** Recipients in the order the list shows them: OpenShore first. */
/** Crew routines follow the web search switch, and only search (founder,
 *  2026-10-01, replacing CTO 3's "never"): the one sentence the search entry
 *  and the Settings row both carry. Nothing else a routine does reaches the web. */
export const ROUTINES_SEARCH_LINE =
  'Crew routines follow this switch while your computer is on, and only search; they never open pages.';

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
    what: 'Your email and password to sign in, then your plan, your organization, and team projects.',
    when: 'Only when you sign in. Chatting needs no account; building, Projects, Vault, Crew, Terminal, pairing, and buying OpenShore Plus do.',
    start: 'tap',
    hosts: ['env:VITE_SUPABASE_URL'],
  },
  {
    id: 'preferences',
    recipient: 'OpenShore (us)',
    what: 'Your app preferences, so they follow you to your other devices: theme, effort, reasoning, humanized writing, notices, and voice. Never your chats, prompts, projects, keys, or addresses.',
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
    what: 'Notes you put in a team vault, and team project settings, so your team can read them.',
    when: 'Only in a team vault or a team project.',
    start: 'off',
    hosts: ['env:VITE_SUPABASE_URL'],
    feature: 'teams',
  },
  {
    id: 'repo-signin',
    recipient: 'OpenShore (us)',
    what: 'Connecting GitHub, GitLab, or Bitbucket: the sign-in exchange passes through our server, so the access token passes through it once on its way to you. Our server keeps no copy and writes none of it to a log.',
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
  },
  {
    id: 'purchase-web',
    recipient: 'OpenShore (us)',
    what: 'Your sign-in, asking our server to start an OpenShore Plus checkout or open your subscription. Our server makes the Stripe page for your account and answers its address; your card never touches OpenShore.',
    when: 'Only on the desktop or the web, when you tap Get Plus or Manage subscription.',
    start: 'tap',
    hosts: ['env:VITE_SUPABASE_URL'],
    platforms: ['electron', 'web'],
  },
  {
    id: 'stripe',
    recipient: 'Payments',
    what: 'Stripe Checkout and the Stripe billing page open in your own browser, where you give Stripe your email and card. Stripe tells our server that you paid and until when, and nothing about your chats or work.',
    when: 'Only on the desktop or the web, after you tap Get Plus or Manage subscription.',
    start: 'tap',
    hosts: ['checkout.stripe.com', 'billing.stripe.com'],
    platforms: ['electron', 'web'],
  },
  {
    id: 'account-deletion',
    recipient: 'OpenShore (us)',
    what: 'Your sign-in, asking our server to delete your account. It erases the account, cancels a plan you pay us for on the web, and keeps only a one-way hash of your email if the guardrail ever warned the account. Apple subscriptions are cancelled with Apple.',
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
    what: 'The words of a web search, which a model writes from your chat. DuckDuckGo by default, with no key and no account.',
    when: `When a model decides to search the web, on by default so a model can answer with current facts. ${ROUTINES_SEARCH_LINE} You can turn it off in Settings, Harbor.`,
    start: 'on',
    hosts: ['html.duckduckgo.com', 'duckduckgo.com'],
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
    what: 'Your chat, to Anthropic, OpenAI, Google, Moonshot, or Perplexity, on your own key. The amber pill marks every turn that goes.',
    when: 'Only when you pick a cloud model, and only that turn.',
    start: 'off',
    hosts: [
      'api.anthropic.com',
      'api.openai.com',
      'generativelanguage.googleapis.com',
      'api.moonshot.ai',
      'api.perplexity.ai',
    ],
  },
  {
    id: 'weights',
    recipient: 'Model downloads',
    what: 'A request for the model you picked (and the Ollama installer, on first run). Nothing about you rides along.',
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
  'Everything you send a local model, and everything it answers.',
  'Your chats, projects, settings, and session journals, sealed at rest.',
  "Your API keys, in this device's secure store.",
  'Undo snapshots of your files, in a folder on this computer.',
  'Which folders you trust and the commands you allow.',
];

/** The entries this build can do on this platform, grouped by recipient,
 *  OpenShore first. With no platform given, every platform's entries. */
export function egressByRecipient(
  tier: ReleaseTier = RELEASE_TIER,
  on?: Platform,
): Array<{ recipient: string; entries: EgressEntry[] }> {
  return RECIPIENT_ORDER.map((recipient) => ({
    recipient,
    entries: EGRESS.filter(
      (e) =>
        e.recipient === recipient &&
        (!e.feature || featureOn(e.feature, tier)) &&
        (!on || !e.platforms || e.platforms.includes(on)),
    ),
  })).filter((g) => g.entries.length > 0);
}
