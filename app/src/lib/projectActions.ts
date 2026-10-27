// The chat in a project sets the project up (founder, 2026-10-27): "All of
// the components in the project setup can be interacted with by the chat
// within the project. You can work with it to create all of the fields and it
// will enter into the fields for you." The way app actions do it
// (lib/appActions.ts): a model proposes one field's exact value in a fenced
// block tagged `openshore-project:<field>`, the chat shows it as a card with
// Add to project and Copy, and the tap writes it into the field. The model
// never changes the project itself, which matters most for a setup script and
// variables, since those run on the person's machine: a page the model read
// can never put a command there without the person's tap.
//
// The same two gates as app actions. Local seats only: the contract rides
// only into a seat whose requests stay on this network (judged by address),
// so a cloud provider is never told about the app's controls (the
// maintainer's privacy line). And only once a person's turn in this chat asks
// about the project's setup, so a chat that never does is never handed it.
// The card reads the same gate (components/MessageList.tsx).
import { PROJECT_NETWORKS, isProjectNetwork, parseEnvText } from 'os-code/protocol';
import type { Project } from '../state/types.js';
import {
  PROJECT_ACTION_FENCE,
  PROJECT_ACTION_KEYS,
  isProjectActionKey,
  projectActionsAsked,
  type ProjectActionKey,
} from './projectFence.js';

export {
  PROJECT_ACTION_FENCE,
  isProjectActionKey,
  projectActionKeyFromClass,
  projectActionsAsked,
  type ProjectActionKey,
} from './projectFence.js';

export interface ProjectActionSpec {
  /** What the card calls the field. */
  label: string;
  /** One line for the model: the field, and what a good value is. */
  forModel: string;
  /** The value as the field keeps it, or undefined when the value is not one
   *  the field takes (the card then offers Copy only). */
  check(value: string): string | undefined;
}

const NAME_MAX = 80;

export const PROJECT_ACTIONS = {
  name: {
    label: 'Project name',
    forModel: `name: the project's name, a few words, at most ${NAME_MAX} characters.`,
    check: (v: string) => {
      const t = v.trim();
      return t && t.length <= NAME_MAX && !t.includes('\n') ? t : undefined;
    },
  },
  instructions: {
    label: 'Instructions',
    forModel:
      "instructions: Project Wayfinder's instructions, the context and rules every chat in this project follows, written in full.",
    check: (v: string) => (v.trim() ? v.trim() : undefined),
  },
  network: {
    label: 'Network access',
    forModel: `network: how much of the web models here reach, exactly one of ${PROJECT_NETWORKS.join(', ')} (search means search only, none means no web search or pages).`,
    check: (v: string) => {
      const t = v.trim().toLowerCase();
      return isProjectNetwork(t) ? t : undefined;
    },
  },
  env: {
    label: 'Environment variables',
    forModel:
      'env: environment variables for coding sessions, one NAME=value a line. They are added to the ones already kept; write a placeholder for a secret the person fills in themselves.',
    check: (v: string) => {
      const { env } = parseEnvText(v);
      return Object.keys(env).length ? v.trim() : undefined;
    },
  },
  setupScript: {
    label: 'Setup script',
    forModel:
      'setupScript: a shell script a coding session runs once when it opens, on the machine this project runs on (installing dependencies, for example). Keep it short and safe to run twice.',
    check: (v: string) => (v.trim() ? v.trim() : undefined),
  },
  agent: {
    label: 'New agent',
    forModel:
      'agent: an agent made for this project alone. Its name on the first line, then who it is and how it works on the lines after.',
    check: (v: string) => {
      const [first, ...rest] = v.trim().split('\n');
      return first?.trim() && rest.join('\n').trim() ? v.trim() : undefined;
    },
  },
} satisfies Record<ProjectActionKey, ProjectActionSpec>;

/** What the model may read of the project as it stands: never a variable's
 *  value, only its name. */
export interface ProjectSetupView {
  name: string;
  instructions?: string;
  network?: Project['network'];
  setupScript?: string;
  envNames: string[];
  agents: string[];
}

/** The contract for a seat in a project's chat, or undefined for a seat that
 *  leaves this network, a chat outside a project, or one that has not asked. */
export function projectActionsContract(
  leavesNetwork: boolean,
  userTurns: readonly string[],
  project: ProjectSetupView | undefined,
): string | undefined {
  if (leavesNetwork || !project || !projectActionsAsked(userTurns)) return undefined;
  return [
    `You run on hardware this person controls, in their OpenShore project "${project.name}", and they are setting the project up with you. To fill in a field, put its whole value alone in a fenced block tagged \`${PROJECT_ACTION_FENCE}:<field>\`, one block per field, for example:`,
    '```' + PROJECT_ACTION_FENCE + ':instructions',
    '<the full instructions you wrote for them>',
    '```',
    'The app shows each block with an Add to project button; nothing changes until they tap it. Never claim you changed the project. For anything else, just answer.',
    'Fields:',
    ...PROJECT_ACTION_KEYS.map((k) => `- ${PROJECT_ACTIONS[k].forModel}`),
    'The project now:',
    `- name: ${project.name}`,
    `- instructions: ${project.instructions?.trim() ? project.instructions.trim() : '(none)'}`,
    `- network: ${project.network ?? 'full'}`,
    `- setupScript: ${project.setupScript?.trim() ? project.setupScript.trim() : '(none)'}`,
    `- env: ${project.envNames.length ? project.envNames.join(', ') : '(none)'} (names only)`,
    `- agents: ${project.agents.length ? project.agents.join(', ') : '(none)'}`,
  ].join('\n');
}

/** `.env` text with `incoming` laid over `kept`: a name in both takes the
 *  new value in the kept line's place, a new name is added at the end, and
 *  comments and other lines stay as the person wrote them. */
export function mergeEnvText(kept: string, incoming: string): string {
  const add = parseEnvText(incoming).env;
  const seen = new Set<string>();
  const lines = kept.split(/\r?\n/).map((line) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m && m[1]! in add) {
      seen.add(m[1]!);
      return `${m[1]}=${add[m[1]!]}`;
    }
    return line;
  });
  const fresh = Object.entries(add)
    .filter(([n]) => !seen.has(n))
    .map(([n, v]) => `${n}=${v}`);
  const body = lines.join('\n').replace(/\n+$/, '');
  return [body, ...fresh].filter((x) => x !== '').join('\n');
}

/** What a tapped proposal does to the project, or undefined for a value the
 *  field does not take. */
export type ProjectActionPlan =
  | {
      kind: 'patch';
      patch: Partial<Pick<Project, 'name' | 'instructions' | 'network' | 'setupScript'>>;
    }
  | { kind: 'env'; text: string }
  | { kind: 'agent'; name: string; persona: string };

export function projectActionPlan(key: string, value: string): ProjectActionPlan | undefined {
  if (!isProjectActionKey(key)) return undefined;
  const v = PROJECT_ACTIONS[key].check(value);
  if (v === undefined) return undefined;
  switch (key) {
    case 'name':
      return { kind: 'patch', patch: { name: v } };
    case 'instructions':
      return { kind: 'patch', patch: { instructions: v } };
    case 'network':
      return {
        kind: 'patch',
        patch: { network: v === 'full' ? undefined : (v as Project['network']) },
      };
    case 'setupScript':
      return { kind: 'patch', patch: { setupScript: v } };
    case 'env':
      return { kind: 'env', text: v };
    case 'agent': {
      const [first, ...rest] = v.split('\n');
      return { kind: 'agent', name: first!.trim(), persona: rest.join('\n').trim() };
    }
  }
}
