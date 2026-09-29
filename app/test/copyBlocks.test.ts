// Tenet 9: anything the person must paste arrives as a fenced code block with
// a one-tap Copy. Both halves are pinned here: every model prompt carries the
// rule (a prompt that drops it would quietly regress to inline commands), the
// chat renderer keeps its Copy control, and a guide step with a paste renders
// as its own fenced block.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETUP_GUIDES, guideOpening } from '../src/lib/setupGuides.js';

const RULE = 'fenced code block';
const PROMPT_FILES = [
  'src/drivers/stackDriver.ts',
  'src/drivers/cloudClaudeDriver.ts',
  'src/drivers/onDeviceDriver.ts',
  'src/lib/harbor.ts',
  'src/lib/harborMini.ts',
  // The free chat's system line (the daemon's /chat and the desktop's IPC).
  '../os-code/src/daemon/freeChat.ts',
  '../os-code/src/core/agent/loop.ts',
];

describe('copy blocks for anything pasted', () => {
  it('every model prompt carries the copy-block rule', () => {
    for (const f of PROMPT_FILES) {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      expect(src, f).toContain(RULE);
    }
  });

  it('the chat renderer gives every fenced block a Copy control', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/Markdown.tsx'), 'utf8');
    // The block itself moved to components/CodeBlock.tsx (Vault M6 wave 0).
    const block = readFileSync(join(process.cwd(), 'src/components/CodeBlock.tsx'), 'utf8');
    expect(block).toContain('copyText(');
    expect(block).toContain("'Copy'");
    expect(block).toContain("'Copy failed'");
    expect(src).toMatch(/pre:\s*\(\{ children \}\) => <CodeBlock>/);
  });

  it('a guide step with something to paste renders it as its own fenced block', () => {
    const text = guideOpening(SETUP_GUIDES['install-ollama']);
    expect(text).toContain('```\ncurl -fsSL https://ollama.com/install.sh | sh\n```');
    expect(text).toContain('```\nollama list\n```');
    // Never inline: the command must not appear outside a fence.
    expect(text.replace(/```[\s\S]*?```/g, '')).not.toContain('ollama list');
  });
});
