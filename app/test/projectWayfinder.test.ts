// Project Wayfinder, a project's agents, and its chat filling its fields
// (founder, 2026-10-27). Pure rules here; the engine half is
// os-code/test/projectEnv.test.ts.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentInProject, agentSelectionPatch } from '../src/lib/projectAgents.js';
import {
  mergeEnvText,
  projectActionKeyFromClass,
  projectActionPlan,
  projectActionsAsked,
  projectActionsContract,
  type ProjectSetupView,
} from '../src/lib/projectActions.js';
import { chatDoc, projectDoc, projectFromDoc } from '../src/lib/docSync.js';
import type { CrewAgent, Project } from '../src/state/types.js';

const src = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');

const agent = (id: string, projectIds: string[] = []): CrewAgent => ({
  id,
  name: id.toUpperCase(),
  persona: 'p',
  activityLevel: 'request',
  projectIds,
  createdAt: '2026-10-27T00:00:00Z',
});

describe("a project's agents", () => {
  it('every agent from Agents is in a project until it is left out', () => {
    expect(agentInProject(agent('a'), 'p1')).toBe(true);
    expect(agentInProject(agent('a'), 'p1', { excludedAgentIds: ['a'] })).toBe(false);
    expect(agentInProject(agent('b', ['p2']), 'p1')).toBe(false);
    expect(agentInProject(agent('c', ['p1']), 'p1')).toBe(true);
  });

  it('a selection leaves out what is unticked and brings in a ticked agent scoped elsewhere', () => {
    const agents = [agent('a'), agent('b', ['p2']), agent('c', ['p1'])];
    const { excludedAgentIds, agents: next } = agentSelectionPatch(
      agents,
      'p1',
      new Set(['b', 'c']),
    );
    expect(excludedAgentIds).toEqual(['a']);
    expect(next.find((x) => x.id === 'b')!.projectIds).toEqual(['p2', 'p1']);
    expect(next.find((x) => x.id === 'a')!.projectIds).toEqual([]);
  });
});

const setup: ProjectSetupView = {
  name: 'Tide app',
  instructions: 'Keep it calm.',
  network: 'search',
  setupScript: 'npm ci',
  envNames: ['API_URL', 'SERVICE_TOKEN'],
  agents: ['Reviewer'],
};

describe('the chat in a project fills its fields', () => {
  it('opens only when a person asks about the setup, never on a search result', () => {
    expect(projectActionsAsked(['what is the tide today?'])).toBe(false);
    expect(projectActionsAsked(['help me write the instructions for this project'])).toBe(true);
    expect(projectActionsAsked(['Search results for "x":\n[1] environment variables'])).toBe(false);
  });

  it('tells a local seat the fields and the project as it stands, variable names only', () => {
    const c = projectActionsContract(false, ['set up the environment variables'], setup)!;
    expect(c).toContain('openshore-project:<field>');
    expect(c).toContain('Add to project');
    expect(c).toContain('API_URL, SERVICE_TOKEN');
    expect(c).toContain('network: search');
  });

  it('a seat that leaves this network, or a chat outside a project, is never told', () => {
    expect(projectActionsContract(true, ['set up the instructions'], setup)).toBeUndefined();
    expect(projectActionsContract(false, ['set up the instructions'], undefined)).toBeUndefined();
  });

  it('reads a field from its fence', () => {
    expect(projectActionKeyFromClass('language-openshore-project:setupScript')).toBe('setupScript');
    expect(projectActionKeyFromClass('language-openshore-project:nope')).toBeUndefined();
    expect(projectActionKeyFromClass('language-bash')).toBeUndefined();
  });

  it('plans each field, and refuses a value the field does not take', () => {
    expect(projectActionPlan('network', ' None ')).toEqual({
      kind: 'patch',
      patch: { network: 'none' },
    });
    expect(projectActionPlan('network', 'full')).toEqual({
      kind: 'patch',
      patch: { network: undefined },
    });
    expect(projectActionPlan('network', 'sometimes')).toBeUndefined();
    expect(projectActionPlan('name', 'two\nlines')).toBeUndefined();
    expect(projectActionPlan('env', 'not a variable')).toBeUndefined();
    expect(projectActionPlan('agent', 'Scout\nFinds sources and checks them.')).toEqual({
      kind: 'agent',
      name: 'Scout',
      persona: 'Finds sources and checks them.',
    });
    expect(projectActionPlan('agent', 'Scout')).toBeUndefined();
  });

  it('proposed variables join the kept ones, replacing a name in place', () => {
    expect(mergeEnvText('# keep\nA=1\nB=2', 'B=3\nC=4')).toBe('# keep\nA=1\nB=3\nC=4');
    expect(mergeEnvText('', 'A=1')).toBe('A=1');
  });
});

describe('Project Wayfinder travels between devices, its variables never', () => {
  const p: Project = {
    id: 'p1',
    name: 'Tide',
    repoIds: [],
    network: 'none',
    setupScript: 'npm ci',
    excludedAgentIds: ['a'],
    vaultPins: ['Ideas.md'],
    createdAt: '2026-10-27T00:00:00Z',
  };

  it('carries network access, the setup script and the agent selection', () => {
    const back = projectFromDoc(projectDoc(p), 'p1');
    expect(back).toMatchObject({ network: 'none', setupScript: 'npm ci', excludedAgentIds: ['a'] });
    expect(back?.vaultPins).toBeUndefined();
  });

  it('the variables are kept sealed per project, never on the project itself', () => {
    expect(projectDoc(p)).not.toMatch(/env/i);
    const env = src('lib/projectEnv.ts');
    expect(env).toContain('secretSet');
    expect(env).toContain('oscode.projectEnv.');
    expect(chatDoc).toBeTypeOf('function');
  });
});

describe('Project Wayfinder is wired, not decoration', () => {
  const store = src('state/store.ts');

  it('a coding session gets the network, the setup script and the variables, on either machine', () => {
    expect(store).toMatch(/network: sessionOpts\.network/);
    expect(store).toMatch(/setupScript: sessionOpts\.setupScript/);
    expect(store).toMatch(/projectEnv: sessionOpts\.projectEnv/);
    expect(src('../electron/main.ts')).toContain('projectEnv: cleanProjectEnv(o.projectEnv)');
  });

  it('every chat brief carries the network line, and network none closes search', () => {
    expect(store).toContain('projectNetworkNote(project?.network)');
    expect(store).toContain('webClosedFor(conv)');
    expect(src('drivers/stackDriver.ts')).toContain("this.context.network !== 'none'");
  });

  it('no pins ride a session or a pack any more', () => {
    expect(store).not.toMatch(/vaultPins: \[\.\.\.project\.vaultPins\]/);
    expect(store).toContain('projectPins: () => []');
  });

  it('the New project sheet asks for a name only, and opens the room', () => {
    const projects = src('screens/ProjectsScreen.tsx');
    expect(projects).not.toContain('What are you trying to achieve?');
    expect(projects).toMatch(
      /const id = await createProject\(name\);[\s\S]{0,120}openProject\(id\)/,
    );
  });
});

describe('Runs on names the machine, never its address (Creative Studio, 2026-10-30)', async () => {
  const { whereName } = await import('../src/components/ProjectRunsOn.js');
  const docked = (target: Record<string, unknown>) =>
    whereName({
      kind: 'docked',
      target: { baseUrl: 'http://100.108.1.2:4777', token: 't', ...target },
    } as never);

  it('an unnamed machine reads by its kind', () => {
    expect(docked({})).toBe('your computer');
    expect(docked({ kind: 'server' })).toBe('your server');
    expect(docked({ kind: 'server', place: 'rented' })).toBe('your server');
  });

  it('a named one keeps its name', () => {
    expect(docked({ name: 'studio' })).toBe('studio');
  });
});

describe('a revived session gets its variables back (CX and CTO, 2026-10-30)', () => {
  const store = src('state/store.ts');

  it('reads the variables for a resumed session too, and hands them back on either machine', () => {
    expect(store).toContain(
      'const projectEnv = project ? await projectEnvFor(project.id) : undefined;',
    );
    expect(store).toMatch(
      /resumeSession\(sessionId\);[\s\S]{0,200}setProjectEnv\?\.\(sessionId, projectEnv\)/,
    );
    expect(store).toMatch(
      /else if \(projectEnv\) \{[\s\S]{0,200}daemonSetProjectEnv\(target, sessionId, projectEnv\)/,
    );
  });

  it('the engine reads them live, so a hand-back reaches the agent’s commands', () => {
    const boot = readFileSync(
      join(process.cwd(), '..', 'os-code', 'src', 'core', 'agent', 'bootstrap.ts'),
      'utf8',
    );
    expect(boot).toMatch(
      /defineProperty\(toolContext, 'projectEnv', \{\s*get: \(\) => driver\.projectEnv/,
    );
    const serve = readFileSync(
      join(process.cwd(), '..', 'os-code', 'src', 'daemon', 'serve.ts'),
      'utf8',
    );
    expect(serve).toContain('driver.projectEnv = cleanProjectEnv(body.projectEnv);');
  });
});
