// The approval sheet names what the agent wants to do in plain words, never a
// raw tool name ("Approve runShell" at a trust moment reads like a stack
// trace). Known tools get a verb phrase; anything else is humanized from its
// camelCase name so a new tool still reads as a sentence.

import { AGENTIC_CURRENTS } from './currents.js';

const TOOL_VERBS: Record<string, string> = {
  runShell: 'Run a command',
  readTerminal: 'Read the terminal',
  editFile: 'Edit a file',
  writeFile: 'Edit a file',
  readFile: 'Read a file',
  glob: 'Find files',
  grep: 'Search the code',
  searchRepo: 'Search the repository',
  gitCommit: 'Commit changes',
  gitDiff: 'Look at the changes',
  gitLog: 'Read the history',
  gitStatus: 'Check the repository',
  webFetch: 'Open a web page',
  webSearch: 'Search the web',
  vaultRead: 'Read a note',
  vaultWrite: 'Write a note',
  vaultList: 'List your notes',
  todoWrite: 'Update the task list',
  delegate: 'Hand off a step',
  askAgent: 'Ask another agent',
  cliAgent: 'Hand off to a CLI agent',
  analyzeImage: 'Read an image',
  generateImage: 'Make an image',
  codemagic: 'Start a build',
};

/** "someToolName" or "some_tool-name" to "Some tool name". */
export function humanizeToolName(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase()));
  if (!words.length) return 'Use a tool';
  const first = words[0]!;
  words[0] = first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(' ');
}

/** The plain verb phrase for a tool the agent asks to use. A current's own
 *  tool (askHermes) reads "Ask" plus the name from its roster, never a name
 *  spelled here (CLAUDE.md: no room names a current). */
export function toolActionLabel(toolName: string): string {
  const known = TOOL_VERBS[toolName];
  if (known) return known;
  const ask = /^ask([A-Z]\w*)$/.exec(toolName);
  if (ask) {
    const id = ask[1]!.toLowerCase();
    const current = AGENTIC_CURRENTS.find((c) => c.id === id);
    if (current) return `Ask ${current.label}`;
  }
  return humanizeToolName(toolName);
}
