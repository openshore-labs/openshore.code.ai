// One roster of the repositories you can attach to a project or a chat, drawn
// from the Repositories section rather than invented here. It merges every
// place a repo can already live in OpenShore into a single, stable list the
// pickers render: the home repo (the anchor the whole system works through),
// gitOS code repos (Repositories, stored on the provider you chose), and the
// desktop / daemon working copies reachable while you are docked. As the
// Repositories section grows (listing a connected platform's repos, more gitOS
// backends), add sources here and every picker inherits them for free.
import { PROVIDER_ROSTER, type GitosResource, type StorageProviderId } from './gitos/providers.js';
import type { HomeRepo } from './repos.js';

/** A repository the user can attach. `id` is the stable value stored in a
 *  project's or chat's repoIds; `origin` is a short, human line about where it
 *  comes from, shown under the name in the picker. */
export interface AvailableRepo {
  id: string;
  name: string;
  origin: string;
}

/** The raw material the roster is built from. Each field is optional so a
 *  caller can pass only what it has (the phone with no desktop, say). */
export interface RepoInventory {
  gitosResources?: GitosResource[];
  homeRepo?: HomeRepo;
  workspaces?: Array<{ cwd: string; name: string }>;
}

// One honest line about where a gitOS repo's bytes live, borrowed from the
// provider roster so the wording never drifts from the Repositories section.
function providerOrigin(id: StorageProviderId): string {
  const hit = PROVIDER_ROSTER.find((p) => p.id === id);
  return hit ? hit.label : 'gitOS';
}

// Where the home repo lives, in a short pill-friendly phrase.
const HOME_ORIGIN: Record<string, string> = {
  home: 'Home repo, your system',
  github: 'Home repo, GitHub',
  gitlab: 'Home repo, GitLab',
  bitbucket: 'Home repo, Bitbucket',
};

/** Build the attach roster from whatever repositories exist right now. Deduped
 *  by id, home repo first (it is the anchor), then gitOS repos, then desktop
 *  working copies. */
export function availableRepos(inv: RepoInventory): AvailableRepo[] {
  const out: AvailableRepo[] = [];
  const seen = new Set<string>();
  const push = (r: AvailableRepo) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    out.push(r);
  };

  if (inv.homeRepo) {
    push({
      id: `home:${inv.homeRepo.id}`,
      name: inv.homeRepo.label,
      origin: HOME_ORIGIN[inv.homeRepo.kind] ?? 'Home repo',
    });
  }

  for (const r of inv.gitosResources ?? []) {
    if (r.kind !== 'repo') continue;
    push({ id: `gitos:${r.id}`, name: r.name, origin: providerOrigin(r.providerId) });
  }

  for (const ws of inv.workspaces ?? []) {
    push({ id: `desktop:${ws.cwd}`, name: ws.name, origin: 'On your desktop' });
  }

  return out;
}

/** A display label for one attached repo id, tolerant of a repo that is not
 *  reachable right now (desktop undocked, provider signed out): fall back to a
 *  readable tail of the id so an attached repo never renders as a raw path. */
export function repoRefLabel(id: string, list: AvailableRepo[]): string {
  const hit = list.find((r) => r.id === id);
  if (hit) return hit.name;
  const body = id.replace(/^(home|gitos|desktop):/, '');
  const tail = body.split('/').filter(Boolean).pop();
  return tail || body || id;
}

/** The repos a chat actually runs on: its own override when it has set one,
 *  otherwise the project's repos it inherits by default. An empty override
 *  array is a real choice ("no repos here"), distinct from undefined
 *  ("follow the project"). */
export function resolveChatRepoIds(
  chatRepoIds: string[] | undefined,
  projectRepoIds: string[] | undefined,
): string[] {
  return chatRepoIds ?? projectRepoIds ?? [];
}
