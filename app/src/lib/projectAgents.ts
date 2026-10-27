// A project's agents (founder, 2026-10-27): every agent from Agents is in a
// project unless the project leaves it out, the way a new project starts with
// the whole roster; an agent scoped to some projects (or made for one) is in
// only those. One rule, read by the project room's Agents sheet and by the
// chat that hands the roster to its model.
import type { CrewAgent, Project } from '../state/types.js';

/** Whether `agent` works in the project `projectId`. A chat with no project
 *  takes the agents scoped to every project. */
export function agentInProject(
  agent: Pick<CrewAgent, 'id' | 'projectIds'>,
  projectId: string | undefined | null,
  project?: Pick<Project, 'excludedAgentIds'>,
): boolean {
  if (project?.excludedAgentIds?.includes(agent.id)) return false;
  return (
    agent.projectIds.length === 0 || (projectId != null && agent.projectIds.includes(projectId))
  );
}

/** The changes for a project's Agents selection: the project's own exclusion
 *  list, and the agents whose scope gains this project (one scoped elsewhere
 *  that the person ticked here). */
export function agentSelectionPatch(
  agents: readonly CrewAgent[],
  projectId: string,
  selected: ReadonlySet<string>,
): { excludedAgentIds: string[]; agents: CrewAgent[] } {
  const excludedAgentIds: string[] = [];
  const next = agents.map((a) => {
    if (!selected.has(a.id)) {
      // Made for this project alone: deselecting it leaves it unused here.
      excludedAgentIds.push(a.id);
      return a;
    }
    if (a.projectIds.length && !a.projectIds.includes(projectId)) {
      return { ...a, projectIds: [...a.projectIds, projectId] };
    }
    return a;
  });
  return { excludedAgentIds, agents: next };
}
