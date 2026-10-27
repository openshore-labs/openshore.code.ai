// The small half of lib/projectActions.ts that a chat needs at launch: the
// fence a project proposal is tagged with, the fields' names, and whether a
// person's turns asked about the project's setup. The specs, the contract
// and the apply plan load only once a project proposal shows (launch budget,
// scripts/tier-bundle.mjs).

/** The fence language a project proposal is tagged with. */
export const PROJECT_ACTION_FENCE = 'openshore-project';

/** Every field a project's chat may propose, in contract order. */
export const PROJECT_ACTION_KEYS = [
  'name',
  'instructions',
  'network',
  'env',
  'setupScript',
  'agent',
] as const;

export type ProjectActionKey = (typeof PROJECT_ACTION_KEYS)[number];

export function isProjectActionKey(key: string): key is ProjectActionKey {
  return (PROJECT_ACTION_KEYS as readonly string[]).includes(key);
}

/** A person's turn that asks about the project's setup. */
const ASKS =
  /\b(project (wayfinder|setup|set up|name|instructions|agents?)|wayfinder|instructions|environment|env vars?|variables?|setup script|set ?up script|network access|rename (this|the) project|agents? for this project)\b/i;

/** A turn the host wrote into history (a search's results, or why there
 *  were none), never the person's words, so it never opens the gate. */
const HOST_TURN =
  /^(Search results for "|\(searched the web for "|No results for "|Search failed:|Web search is off|Not run:)/;

/** Whether a person's turns in this chat asked about the project's setup. */
export function projectActionsAsked(userTurns: readonly string[]): boolean {
  return userTurns.some((t) => !HOST_TURN.test(t) && ASKS.test(t));
}

/** The field a code element's class names, when it is a project fence. */
export function projectActionKeyFromClass(
  className: string | undefined,
): ProjectActionKey | undefined {
  const m = /(?:^|\s)language-openshore-project:([A-Za-z]+)/.exec(className ?? '');
  return m && isProjectActionKey(m[1]!) ? m[1] : undefined;
}

/** The contract a project's chat hands its seat: given whether the seat
 *  leaves this network and the person's turns so far, the lines that let it
 *  propose the project's fields, or undefined (lib/projectActions.ts). */
export type ProjectContract = (
  leavesNetwork: boolean,
  userTurns: readonly string[],
) => string | undefined;
