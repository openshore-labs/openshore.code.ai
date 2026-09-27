// The vault fixture for eval v2's vault tasks (Vault M4, 4.8, CTO I14). About
// two hundred plain markdown notes, generated the same way every time, so a
// with-pack and a without-pack run face the exact same vault on any machine:
//
// - a convention note, the one place the release-branch prefix is written;
// - a hub note for the Atlas project that links to a decision by wikilink,
//   and a decision note whose title shares no word with the task, so the way
//   to it is the link;
// - an older crew-run note (an agent's nightly log) that contradicts both, the
//   stale answer the graders reject;
// - filler across folders, with tags, frontmatter, and links among itself, so
//   retrieval has a real haystack to search.
//
// Pure data: no clock, no randomness, no I/O. The runner writes the map into
// the eval workspace's vault folder.

/** The value the convention note sets, and the older one the crew note gives. */
export const VAULT_CONVENTION = { right: 'rel-kestrel/', stale: 'release/' } as const;

/** The retry limit the decision sets, the stale crew note's value, and what
 *  the workspace starts with (neither, so a no-op run cannot pass). */
export const VAULT_DECISION = { right: 7, stale: 3, start: 5 } as const;

/** Paths of the notes the tasks turn on, so tests and reports can name them. */
export const VAULT_FIXTURE_PATHS = {
  convention: 'Conventions/Branch names.md',
  hub: 'Projects/Atlas/Atlas hub.md',
  decision: 'Decisions/2026/Backoff ruling, March.md',
  stale: 'Crew/nightly-sync/2026-02-11.md',
} as const;

/** How many notes the fixture holds, exactly. */
export const VAULT_FIXTURE_NOTE_COUNT = 200;

const TOPICS = [
  'garden',
  'reading',
  'travel',
  'budget',
  'recipes',
  'fitness',
  'music',
  'onboarding',
  'design review',
  'hiring',
  'offsite',
  'podcast',
  'invoices',
  'backups',
  'house',
  'language study',
];

const FOLDERS = ['Areas', 'Reading', 'Daily', 'Meetings', 'Projects/Harbor', 'Projects/Lumen'];

const TAGS = ['idea', 'todo', 'reference', 'log', 'someday', 'people', 'draft'];

const SENTENCES = [
  'Picked this up again after a slow week.',
  'Worth another pass once the list settles.',
  'Nothing urgent here, just keeping the thread.',
  'A few loose ends to tie off before Friday.',
  'Talked it over and the plan still holds.',
  'Left a question for later in the margin.',
  'Most of this is context for the next session.',
  'Copied the useful part from an older page.',
  'The short version is at the top, detail below.',
  'Marked the parts that need a second look.',
  'This one grew out of a conversation at lunch.',
];

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function fillerFolder(i: number): string {
  return FOLDERS[(i * 7) % FOLDERS.length]!;
}

// A filler note's name, which is its file name and its heading, so a bare
// `[[name]]` link resolves to it. Daily notes are named by date, a day apart
// through 2026, the way a journal folder reads.
function fillerTitle(i: number): string {
  if (fillerFolder(i) === 'Daily') {
    return new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
  }
  const topic = TOPICS[i % TOPICS.length]!;
  return `${topic.charAt(0).toUpperCase()}${topic.slice(1)} notes ${pad(i, 3)}`;
}

function fillerPath(i: number): string {
  return `${fillerFolder(i)}/${fillerTitle(i)}.md`;
}

function fillerNote(i: number, count: number): string {
  const tagA = TAGS[i % TAGS.length]!;
  const tagB = TAGS[(i * 3 + 1) % TAGS.length]!;
  const tags = tagA === tagB ? [tagA] : [tagA, tagB];
  // Two links forward and one back, wrapping, so every filler note has
  // outgoing links and backlinks. Links use the bare title, as a person would.
  const linkA = (i + 1) % count;
  const linkB = (i + 17) % count;
  const linkBack = (i + count - 5) % count;
  const lines = [
    '---',
    `tags: [${tags.join(', ')}]`,
    `created: 2026-${pad((i % 12) + 1, 2)}-${pad((i % 27) + 1, 2)}`,
    '---',
    '',
    `# ${fillerTitle(i)}`,
    '',
    SENTENCES[i % SENTENCES.length]!,
    SENTENCES[(i * 5 + 2) % SENTENCES.length]!,
    '',
    `See [[${fillerTitle(linkA)}]] and [[${fillerTitle(linkB)}]]; it started in [[${fillerTitle(linkBack)}]].`,
    '',
    `#${tagA}`,
    '',
  ];
  return lines.join('\n');
}

function conventionNote(): string {
  return [
    '---',
    'tags: [convention, git]',
    'created: 2026-05-04',
    '---',
    '',
    '# Branch names',
    '',
    'How we name branches in this project, agreed at the May planning session.',
    '',
    `- Release work goes on a branch named with the prefix \`${VAULT_CONVENTION.right}\`, then the version.`,
    '- Feature work uses the ticket number and a short slug.',
    '- Never commit straight to main.',
    '',
    'This replaces anything older; ask before changing it.',
    '',
  ].join('\n');
}

function hubNote(): string {
  return [
    '---',
    'tags: [project, atlas]',
    'created: 2026-01-20',
    '---',
    '',
    '# Atlas hub',
    '',
    'The Atlas sync client: what it is, where things live, what was decided.',
    '',
    '## Decisions',
    '',
    '- How many times the sync client retries before giving up: [[Backoff ruling, March]]',
    `- Branching: [[Branch names]]`,
    '',
    '## Related',
    '',
    `- [[${fillerTitle(3)}]]`,
    `- [[${fillerTitle(40)}]]`,
    '',
  ].join('\n');
}

function decisionNote(): string {
  return [
    '---',
    'tags: [decision, atlas]',
    'created: 2026-03-18',
    'status: decided',
    '---',
    '',
    '# Backoff ruling, March',
    '',
    'Back to [[Atlas hub]].',
    '',
    `Decided: MAX_RETRIES is ${VAULT_DECISION.right}. The base delay stays at 250 ms, doubling each time.`,
    '',
    'Supersedes the value in the February nightly logs, which predates the outage review.',
    '',
  ].join('\n');
}

function staleNote(): string {
  return [
    '---',
    'type: crew-run',
    'routine: nightly-sync',
    'project: atlas',
    'started: 2026-02-11T02:00:00Z',
    'state: done',
    'tags: [crew]',
    '---',
    '',
    '# nightly-sync, 2026-02-11',
    '',
    `Checked the Atlas sync client. MAX_RETRIES is ${VAULT_DECISION.stale}.`,
    `Release branches use the \`${VAULT_CONVENTION.stale}\` prefix.`,
    '',
  ].join('\n');
}

/** The whole fixture as a map of vault-relative path to note text. The same
 *  call gives the same bytes every time. */
export function buildVaultFixture(): Record<string, string> {
  const notes: Record<string, string> = {
    [VAULT_FIXTURE_PATHS.convention]: conventionNote(),
    [VAULT_FIXTURE_PATHS.hub]: hubNote(),
    [VAULT_FIXTURE_PATHS.decision]: decisionNote(),
    [VAULT_FIXTURE_PATHS.stale]: staleNote(),
  };
  const fillerCount = VAULT_FIXTURE_NOTE_COUNT - Object.keys(notes).length;
  for (let i = 0; i < fillerCount; i += 1) {
    notes[fillerPath(i)] = fillerNote(i, fillerCount);
  }
  return notes;
}
