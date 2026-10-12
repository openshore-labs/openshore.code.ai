// What leaves this device is code, not memory (v1 Phase 2). Every host that
// appears in the app, the desktop shell, or the engine must be on the list
// Settings shows, or marked as a link the person opens themselves, with a
// reason. A new call to a new service fails here until someone writes down,
// in plain words, what it sends and when. The phone half of the review's
// egress test is exactly this: a static manifest over every host.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as manifest from '../src/lib/egressManifest.js';
import {
  EGRESS,
  LINK_ONLY_HOSTS,
  PRIVATE_PAGE_LINE,
  PRIVATE_SEARCH_LINE,
  RECIPIENT_ORDER,
  ROUTINES_SEARCH_LINE,
  STAYS_ON_DEVICE,
  egressByRecipient,
} from '../src/lib/egressManifest.js';
import { GUIDE_CARDS } from '../src/lib/guideCards.js';
import { HARBOR_MINI_PERSONA } from '../src/lib/harborMini.js';
import { APP_KNOWLEDGE } from '../src/lib/guideKnowledge.js';
import { VAULT_CARRY_CAVEAT, VAULT_PRIVATE_OFF_CLOUD } from '../src/lib/vaultCopy.js';
import { PROVIDERS } from '../src/lib/providers.js';
import { allSourceHosts } from 'os-code/protocol';

const ROOTS = [
  join(process.cwd(), 'src'),
  join(process.cwd(), 'electron'),
  join(process.cwd(), '..', 'os-code', 'src'),
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'node_modules') walk(full, out);
    } else if (/\.(ts|tsx|cjs|mjs)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function hostsInSource(): Map<string, string> {
  const found = new Map<string, string>();
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/https?:\/\/([a-zA-Z0-9.-]+\.[a-z]{2,})/g)) {
        const host = m[1]!.toLowerCase();
        if (!found.has(host)) found.set(host, relative(join(process.cwd(), '..'), file));
      }
    }
  }
  return found;
}

describe('what leaves this device', () => {
  const listed = new Set(EGRESS.flatMap((e) => e.hosts));

  it('lists every host the code can reach, or says why it is only a link', () => {
    const unlisted: string[] = [];
    for (const [host, file] of hostsInSource()) {
      if (listed.has(host) || host in LINK_ONLY_HOSTS) continue;
      unlisted.push(`${host} (first seen in ${file})`);
    }
    expect(unlisted, 'add each to src/lib/egressManifest.ts with what it sends and when').toEqual(
      [],
    );
  });

  it('never lists a host as both something sent and a mere link', () => {
    for (const host of listed) expect(host in LINK_ONLY_HOSTS, host).toBe(false);
  });

  // Bring your own keys (2026-10-09): every provider in Cloud Connections is
  // on the cloud-models entry, by its host and in its words, and its key
  // page is either a host the list already names or a link said to be one.
  it('names every provider Cloud Connections offers, its host, and its key page', () => {
    const cloud = EGRESS.find((e) => e.id === 'cloud-models')!;
    for (const p of PROVIDERS) {
      if (p.openaiBaseUrl) expect(cloud.hosts, p.id).toContain(new URL(p.openaiBaseUrl).host);
      const page = new URL(p.apiKeyUrl).host;
      expect(listed.has(page) || page in LINK_ONLY_HOSTS, p.id).toBe(true);
      if (p.more && !listed.has(page))
        expect(LINK_ONLY_HOSTS[page], p.id).toBe('where to get a key');
    }
    expect(cloud.hosts).toContain('api.anthropic.com');
    for (const p of PROVIDERS.filter((x) => x.liveModels)) {
      expect(cloud.what, p.id).toContain(p.name);
    }
    // Both forwarders say they forward; no provider is called private or fast.
    expect(cloud.what).toContain("OpenRouter (which forwards it to the model's own provider)");
    expect(cloud.what).toContain(
      'Hugging Face (which forwards it to one of the providers it lists for the model)',
    );
    expect(cloud.what.replace(VAULT_PRIVATE_OFF_CLOUD, '')).not.toMatch(
      /\b(private|fast|faster|secure)\b/i,
    );
    // Every key check, said once for all of them: the key goes to its
    // provider, the control ask with a made-up key goes to every one but
    // Anthropic (validateProviderKey), and a provider whose models load live
    // is asked for its list too.
    expect(cloud.what).toContain(
      'Saving a key sends it to its provider, which answers whether it works. To every provider but Anthropic, the same request then goes once more with a made-up key in place of yours, so one that answers anyone is not taken for a yes. For a provider whose models load from it, connecting and Choose models also ask it for the list of models it offers.',
    );
  });

  it('says for every entry who gets what, and when, starting with OpenShore', () => {
    for (const e of EGRESS) {
      expect(RECIPIENT_ORDER as readonly string[]).toContain(e.recipient);
      expect(e.what.length).toBeGreaterThan(20);
      expect(e.when.length).toBeGreaterThan(10);
    }
    expect(egressByRecipient()[0]!.recipient).toBe('OpenShore (us)');
    expect(STAYS_ON_DEVICE.length).toBeGreaterThan(2);
  });

  it('says what the four privacy calls changed, and still names what leaves', () => {
    const by = (id: string) => EGRESS.find((e) => e.id === id)!;
    // Web search asks once (founder, 2026-10-02), and the list says so.
    expect(by('search').when).toMatch(/after you allow it once/);
    expect(by('search').when).not.toMatch(/on by default/);
    expect(by('search').start).toBe('off');
    expect(by('guardrail').what).toMatch(/never the name of a person/);
    expect(by('updates').what).toMatch(/Nothing downloads until you click Update/);
    expect(by('repo-signin').what).toMatch(/passes through our server/);
    expect(by('repo-signin').what).toMatch(/keeps no copy/);
  });

  // Founder, 2026-10-01: a routine follows the one web search switch and only
  // searches, so the search entry and the Settings row say so in one sentence,
  // and claim no per-routine switch that is not built.
  it('says Crew routines follow the search switch, in the list and under the Settings row', () => {
    const search = EGRESS.find((e) => e.id === 'search')!;
    expect(ROUTINES_SEARCH_LINE).toMatch(/follow this switch.*only search.*never open pages/);
    expect(search.when).toContain(ROUTINES_SEARCH_LINE);
    // The switch lives in its own group (CMO, 2026-10-07).
    expect(search.when).toContain('Settings, Web search');
    expect(search.when).not.toMatch(/turn it on for that routine/i);
    const settings = readFileSync(
      join(process.cwd(), 'src', 'screens', 'SettingsScreen.tsx'),
      'utf8',
    );
    const row = settings.slice(settings.indexOf('label="Let models search the web"'));
    expect(row.slice(0, row.indexOf('trailing='))).toContain('${ROUTINES_SEARCH_LINE}');
  });

  // CX and CMO, 2026-10-08 (E): a plan never carries a picture, so with
  // nothing set for Image reading its image step runs on the Reasoning model
  // from the text, and the founder's 2026-10-07 exception is gone. No line
  // names it, and the cloud-models entry says when a cloud model answers (D).
  it("names no plan's image step that goes to a cloud model without asking", () => {
    expect('PLAN_IMAGE_STEP_LINE' in manifest).toBe(false);
    const cloud = EGRESS.find((e) => e.id === 'cloud-models')!;
    // Bring your own keys (2026-10-09): saving any provider's key checks it
    // with that provider, and every provider whose models load live is asked
    // for its list, so the when says so for all of them, not two by name.
    expect(cloud.when).toBe(
      'Only when you pick a cloud model or place one in your Stack, and only on the turns it answers. On your computer, the coding agent asks first in each task. Also when you save a provider key, and for one whose models load from it, when you open Choose models. A key kept on your computer or a server you dock, added there with osc key add or turned on here, is used there only by coding sessions on the model you place, and they ask first in each task.',
    );
    // Every way the exception was worded on a surface (the list's own line,
    // the Connections lead, Privacy plainly, the guides and Harbor Lite's
    // knowledge), any case.
    const retired = [
      /\bone exception\b/i,
      /a plan's image step goes to/i,
      /image step in a plan goes to/i,
      /a plan's image step while nothing/i,
      /takes a plan's image step/i,
    ];
    const hits: string[] = [];
    for (const root of [join(process.cwd(), 'src'), join(process.cwd(), 'electron')]) {
      for (const file of walk(root)) {
        // Copy, not comments; JSX text wraps, and an apostrophe is an entity.
        const text = readFileSync(file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
          .replace(/&apos;/g, "'")
          .replace(/\s+/g, ' ');
        for (const line of retired)
          if (line.test(text)) hits.push(`${relative(process.cwd(), file)} ${line}`);
      }
    }
    for (const e of EGRESS)
      for (const line of retired)
        if (line.test(e.what) || line.test(e.when)) hits.push(`${e.id} ${line}`);
    expect(hits).toEqual([]);
  });

  // The private-notes promise is the one vaultCopy words, OpenShore as the
  // subject and the person's own reach a plain second sentence (CX and CMO,
  // 2026-10-08, A).
  it('makes the private-notes promise in the vaultCopy words', () => {
    const cloud = EGRESS.find((e) => e.id === 'cloud-models')!;
    expect(cloud.what).toMatch(/^Your chat, and the notes and files it draws on, to Anthropic/);
    expect(cloud.what).toContain(
      'on your own key. OpenShore never sends private notes to a cloud model. A command you run or allow, or a change you allow, can still carry their words to one. An amber pill',
    );
    expect(cloud.what).toContain(VAULT_PRIVATE_OFF_CLOUD);
    // Whole sentences, never a trailing clause.
    // Bring your own keys, Part 2 (2026-10-09): either format, the list read
    // at connect, and the mark that makes a gateway on your network cloud.
    expect(EGRESS.find((e) => e.id === 'own-model')!.what).toBe(
      'Your chat, and the notes and files it draws on, to a model server you connect yourself (one you run, or one you name with its address and key), in the OpenAI or the Anthropic format. Connecting asks that address for its list of models, with your key if you gave one. A model at an address on your own network counts as local, so private notes may go to it, unless you mark that address as passing requests on to a cloud provider. Marked, or anywhere else, OpenShore never sends it private notes. A command you run or allow, or a change you allow, can still carry their words to a cloud model.',
    );
    expect(EGRESS.find((e) => e.id === 'own-model')!.what.endsWith(VAULT_CARRY_CAVEAT)).toBe(true);
    // A model you connect can sit in a Stack slot too, so its entry says when
    // the way the cloud-models one does (D, sign-off), never "only that turn".
    expect(EGRESS.find((e) => e.id === 'own-model')!.when).toBe(
      'Only when you connect one and pick it or place it in your Stack, and only on the turns it answers. Also when you tap Load models while connecting one.',
    );
    for (const e of EGRESS)
      expect(`${e.what} ${e.when}`, e.id).not.toMatch(/, unless you run or allow/);
    // The marking it promises is the one the chat and Chats read.
    expect(cloud.what).not.toMatch(/marks every turn/);
    expect(cloud.what).toMatch(/amber pill or dot marks a chat whose latest turn went to one/);
    // A local model's answer reaches a cloud model that reads the same chat
    // later: on a turn routed to it, or as a plan's step (sign-off).
    expect(STAYS_ON_DEVICE[0]).toMatch(
      /unless a cloud model in the same chat reads it later, on its own turn or as a step in a plan/,
    );
  });

  // CX and CMO, 2026-10-08 (H): once a chat on a seat that stays holds a
  // private note's text, a search a model writes and a page the agent opens
  // ask every time, so the two entries say so where they say when.
  it('says a search and a page ask every time once a chat holds a private note', () => {
    const by = (id: string) => EGRESS.find((e) => e.id === id)!;
    expect(PRIVATE_SEARCH_LINE).toBe(
      'Once a local model in a chat has read a private note, or its project pins one, each search it writes shows its words and asks first.',
    );
    expect(PRIVATE_PAGE_LINE).toBe(
      'Once a local model in a chat has read a private note, or its project pins one, every page it opens asks first, even on Always.',
    );
    expect(by('search').when).toContain(
      `the coding agent searches only once you allow it. ${PRIVATE_SEARCH_LINE} ${ROUTINES_SEARCH_LINE}`,
    );
    expect(by('web-pages').when).toContain(
      `A page on your own network always asks. ${PRIVATE_PAGE_LINE} Crew routines never open pages.`,
    );
  });

  it('is the list Settings shows, first under Privacy', () => {
    const settings = readFileSync(
      join(process.cwd(), 'src', 'screens', 'SettingsScreen.tsx'),
      'utf8',
    );
    const privacy = settings.slice(settings.indexOf('<SettingsGroup title="Privacy"'));
    expect(privacy.indexOf('<WhatLeavesSheet />')).toBeGreaterThan(-1);
    expect(privacy.indexOf('<WhatLeavesSheet />')).toBeLessThan(privacy.indexOf('<InfoSheet'));
    // The old claim was false (search words, update checks and the catalog
    // all leave); it is gone.
    expect(settings).not.toMatch(/nothing leaves it|no IP address, ever\. There is one/);
  });

  // Privacy review, 2026-10-08: an Ollama cloud tag is served by the Ollama on
  // the computer but answers on ollama.com, on every turn, with no download.
  it('lists an Ollama cloud model you place, and the downloads entry claims no more', () => {
    const by = (id: string) => EGRESS.find((e) => e.id === id)!;
    const tag = by('ollama-cloud');
    expect(tag.recipient).toBe('Your cloud providers');
    expect(tag.what).toMatch(/ollama\.com/);
    expect(tag.what).toMatch(/files the coding agent reads/);
    expect(tag.when).toBe(
      'Only when you pick or place one, and then on every turn it answers. On your computer, the coding agent asks first in each task.',
    );
    // The what says the same "pick or place" as the when, and names the
    // Ollama server, which may sit elsewhere on the network (C, sign-off).
    expect(tag.what).toContain("when a model you pick or place is one of Ollama's cloud models");
    expect(tag.what).toMatch(/Your Ollama server passes each turn on\.$/);
    expect(tag.what).not.toMatch(/Ollama on your computer/);
    // A cloud tag placed as a specialist answers a delegated step with no pill
    // of its own, so the entry claims none.
    expect(tag.what).not.toMatch(/pill/);
    expect(by('weights').what).not.toMatch(/Nothing about you rides along\.$/);
    expect(by('weights').what).toMatch(/Ollama account/);
  });

  it('names every host a library download may start at (the model library, 2026-10-12)', () => {
    const by = (id: string) => EGRESS.find((e) => e.id === id)!;
    for (const host of allSourceHosts()) expect(by('weights').hosts, host).toContain(host);
    expect(by('media-servers').what).toMatch(/asks first/);
  });
});

// Copy never claims more privacy than the list shows (finding 10). The guides
// answer "does anything leave my phone?" in their own words, so their words
// are held to the list too: no "only X sends anything", no "nothing leaves",
// no "everything stays", and no promise that building needs no account.
describe('the guides claim no more than the list', () => {
  const OVERCLAIMS = [
    /\bonly\b[^.]*\bsends? anything\b/i,
    /nothing (?:ever )?leaves (?:the|this|your) (?:device|phone|computer)/i,
    /keeps? everything on (?:the|this|your) device/i,
    /nothing routes through us/i,
    /building (?:need|needs|works?)[^.]*(?:no account|signed out)/i,
    /chatting and building/i,
    // A model placed in a Stack chat's slot answers there with no card of
    // its own (founder, 2026-09-25), so no copy promises every cloud call
    // waits on a card.
    /nothing spends without your approval/i,
    /spend always asks/i,
    /marks every turn/i,
    /runs only when you choose it\./i,
    /only on a turn you send to (?:one|it)\./i,
    /asking before each (?:one|image)/i,
    // A key is sent with every request to its provider, so it is stored
    // only here, never "stays" here (2026-10-01 #9; egress-claims-3).
    /\b(?:API key|keys?) stays? on (?:this|your|the) device/i,
    // A key the person turns on for a docked server is kept there too
    // (keys on your server, 2026-10-09), so "sent only to its provider"
    // never ends a sentence without that exception.
    /\bsent only to (?:the |that |its |their )(?:own )?providers?(?: they belong to)?\./i,
  ];
  const sources: Array<[string, string]> = [
    ...GUIDE_CARDS.map((c): [string, string] => [`guide card ${c.id}`, c.text]),
    ['Harbor Lite persona', HARBOR_MINI_PERSONA],
    ['app knowledge', APP_KNOWLEDGE],
    ...[
      'screens/ConnectionsScreen.tsx',
      'screens/SettingsScreen.tsx',
      'components/StackManager.tsx',
      'lib/setupGuides.ts',
      'lib/guidedSetup.ts',
    ].map((f): [string, string] => [f, readFileSync(join(process.cwd(), 'src', f), 'utf8')]),
  ];

  it('says a key is stored only here and sent only to its provider or address', () => {
    const src = (f: string) => readFileSync(join(process.cwd(), 'src', f), 'utf8');
    // Keys on your server (2026-10-09): the one exception, said where the
    // promise is made, and in What stays on this device.
    expect(src('screens/ConnectionsScreen.tsx').replace(/\s+/g, ' ')).toContain(
      'Keys are stored only on this device and sent only to their provider, except a key you turn on for your server, which goes to it once and is kept there.',
    );
    expect(STAYS_ON_DEVICE).toContain(
      'Your API keys: in the Keychain on iPhone and iPad; on a computer, encrypted under a key in its keychain. Each is sent only to its own provider, and to a server you dock only when you turn it on for that server, which then keeps it too.',
    );
    expect(src('components/StackManager.tsx').replace(/\s+/g, ' ')).toContain(
      'The API key is stored only on this device and sent only to that address',
    );
    // Harbor Lite answers "where are my keys?" from this line.
    expect(APP_KNOWLEDGE).toContain(
      'API keys and secrets are stored only on the device and sent only to the provider they belong to, except a key you turn on for your docked server in Cloud Connections, which is kept there too.',
    );
  });

  // CX and CMO, 2026-10-08 (E): the sentence that held the founder's
  // 2026-10-07 exception now says only when a cloud model runs.
  it('says a cloud model runs only when you pick it or place it', () => {
    const src = (f: string) =>
      readFileSync(join(process.cwd(), 'src', f), 'utf8')
        .replace(/&apos;/g, "'")
        .replace(/\s+/g, ' ');
    expect(src('screens/ConnectionsScreen.tsx')).toContain(
      'Connect a provider with your own API key. Its models wait on your bench until you place them, and a cloud model runs only when you pick it or place it. Keys are stored only on this device and sent only to their provider, except a key you turn on for your server, which goes to it once and is kept there.',
    );
    expect(src('screens/SettingsScreen.tsx')).toContain(
      'Cloud models run on your own keys or accounts (an Ollama cloud model on your Ollama account), and only when you pick one or place it in your Stack. A few things do leave this device',
    );
  });

  it('says nothing about leaving the device that the list does not back', () => {
    const found: string[] = [];
    for (const [where, text] of sources) {
      for (const claim of OVERCLAIMS) {
        const hit = text.match(claim);
        if (hit) found.push(`${where}: ${hit[0]}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('sends the privacy question to the list itself', () => {
    const privacy = GUIDE_CARDS.find((c) => c.id === 'privacy')!;
    expect(privacy.text).toMatch(/What leaves this device/);
    // The entries it names are on the list.
    const ids = EGRESS.map((e) => e.id);
    for (const id of ['cloud-models', 'search', 'updates', 'catalog', 'account'])
      expect(ids).toContain(id);
  });
});

describe('what leaves, by release tier', () => {
  it('a Personal build lists only what it can do', () => {
    const personal = egressByRecipient(1).flatMap((g) => g.entries.map((e) => e.id));
    for (const later of ['team', 'decisions', 'codemagic', 'agents']) {
      expect(personal, later).not.toContain(later);
    }
    for (const v1 of ['account', 'guardrail', 'catalog', 'updates', 'search', 'cloud-models']) {
      expect(personal, v1).toContain(v1);
    }
    const all = egressByRecipient(4).flatMap((g) => g.entries.map((e) => e.id));
    expect(all).toEqual(expect.arrayContaining(['team', 'decisions', 'codemagic', 'agents']));
  });

  it("a teams build's entry names the organization and the addresses you invite (privacy review, 2026-10-08)", () => {
    // pushOrgToServer writes the org's name, seats and plan, and an
    // org_members row (email and role) for each person invited.
    const team = EGRESS.find((e) => e.id === 'team')!;
    expect(team.feature).toBe('teams');
    expect(team.what).toMatch(/^Your organization \(its name, seats, and plan\)/);
    expect(team.what).toContain('the email addresses you invite and their roles');
    expect(team.when).toMatch(/set up an organization or invite someone/);
    const store = readFileSync(join(process.cwd(), 'src', 'state', 'store.ts'), 'utf8');
    expect(store).toMatch(/supabaseInsert<ServerOrg>\('orgs'/);
    expect(store).toMatch(/supabaseInsert<ServerMember>\('org_members'/);
  });
});
