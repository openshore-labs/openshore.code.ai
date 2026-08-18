// The eval harness: does a given local model actually hold up as an OS Code
// orchestrator? Three practical probes (tool-call formatting, edit-block
// discipline, instruction following), scored 0..1, written to
// ~/.os-code/eval/. A profile scoring 0.8+ is "blessed", which is the flag
// the catalog surfaces.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { oscHome } from '../config/load.js';
import type { Provider } from '../providers/types.js';
import { ToolRegistry } from '../core/tools/index.js';
import { readFileTool } from '../core/tools/readFile.js';
import { grepTool } from '../core/tools/grep.js';
import { extractTextCalls, textProtocolInstructions } from '../core/tools/parser.js';
import { parseEditBlocks } from '../core/edit/searchReplace.js';
import { applyEditBlocks } from '../core/edit/apply.js';

export interface EvalScore {
  task: string;
  score: number;
  detail: string;
}

export interface EvalReport {
  model: string;
  provider: string;
  ranAt: string;
  scores: EvalScore[];
  average: number;
  blessed: boolean;
}

const EDIT_SAMPLE = [
  'export function add(a, b) {',
  '  return a + b;',
  '}',
  '',
  'export function subtract(a, b) {',
  '  return a + b;',
  '}',
].join('\n');

async function completeText(provider: Provider, model: string, system: string, user: string): Promise<string> {
  let out = '';
  for await (const event of provider.chat({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.1,
    maxTokens: 1200,
  })) {
    if (event.type === 'text') out += event.delta;
  }
  return out;
}

export async function runEval(
  provider: Provider,
  model: string,
  onProgress?: (message: string) => void,
): Promise<EvalReport> {
  const scores: EvalScore[] = [];
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(grepTool);

  // Task 1: tool-call formatting through the text bridge (3 trials).
  onProgress?.('Probing tool-call formatting...');
  let valid = 0;
  const trials = 3;
  for (let i = 0; i < trials; i++) {
    const reply = await completeText(
      provider,
      model,
      `You are a coding agent.\n${textProtocolInstructions(registry)}`,
      `Read the file src/config${i}.json using the readFile tool.`,
    );
    const extraction = extractTextCalls(reply, registry);
    if (extraction.calls.length === 1 && extraction.calls[0]!.name === 'readFile') valid++;
  }
  scores.push({
    task: 'tool-call formatting',
    score: valid / trials,
    detail: `${valid}/${trials} replies were a single valid readFile call`,
  });

  // Task 2: edit-block discipline.
  onProgress?.('Probing edit-block discipline...');
  const editReply = await completeText(
    provider,
    model,
    'You produce code edits ONLY as search/replace blocks:\n<<<<<<< SEARCH\n(exact current lines)\n=======\n(replacement lines)\n>>>>>>> REPLACE\nNo other output.',
    `This file has a bug: subtract() adds instead of subtracting. Produce the edit block that fixes it.\n\n${EDIT_SAMPLE}`,
  );
  const parsed = parseEditBlocks(editReply);
  let editScore = 0;
  let editDetail = 'no valid edit block found';
  if (parsed.blocks.length) {
    const applied = applyEditBlocks(EDIT_SAMPLE, parsed.blocks);
    if (applied.ok && applied.content.includes('a - b')) {
      editScore = 1;
      editDetail = 'edit applied cleanly and fixed the bug';
    } else if (applied.ok) {
      editScore = 0.5;
      editDetail = 'edit applied but did not fix the bug';
    } else {
      editScore = 0.25;
      editDetail = `block parsed but did not apply: ${applied.failures[0]?.reason ?? 'unknown'}`;
    }
  }
  scores.push({ task: 'edit blocks', score: editScore, detail: editDetail });

  // Task 3: instruction following (exact output).
  onProgress?.('Probing instruction following...');
  const exact = await completeText(
    provider,
    model,
    'Follow instructions exactly. Output nothing beyond what is asked.',
    'Reply with exactly: OSC-READY',
  );
  const followed = exact.trim() === 'OSC-READY';
  scores.push({
    task: 'instruction following',
    score: followed ? 1 : exact.includes('OSC-READY') ? 0.5 : 0,
    detail: followed ? 'exact' : `got: ${exact.trim().slice(0, 60) || '(empty)'}`,
  });

  const average = scores.reduce((a, s) => a + s.score, 0) / scores.length;
  const report: EvalReport = {
    model,
    provider: provider.id,
    ranAt: new Date().toISOString(),
    scores,
    average,
    blessed: average >= 0.8,
  };

  const dir = join(oscHome(), 'eval');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${model.replace(/[^A-Za-z0-9._-]/g, '_')}.json`), JSON.stringify(report, null, 2));
  return report;
}
