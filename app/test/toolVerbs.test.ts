import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { humanizeToolName, toolActionLabel } from '../src/lib/toolVerbs.js';

describe('toolActionLabel', () => {
  it('maps the known tools to plain verbs', () => {
    expect(toolActionLabel('runShell')).toBe('Run a command');
    expect(toolActionLabel('editFile')).toBe('Edit a file');
    expect(toolActionLabel('writeFile')).toBe('Edit a file');
    expect(toolActionLabel('readFile')).toBe('Read a file');
    expect(toolActionLabel('gitCommit')).toBe('Commit changes');
  });

  it('humanizes an unknown tool into sentence case', () => {
    expect(toolActionLabel('deployPreviewSite')).toBe('Deploy preview site');
    expect(toolActionLabel('fetch_remote-data')).toBe('Fetch remote data');
    expect(humanizeToolName('openURLInBrowser')).toBe('Open URL in browser');
    expect(humanizeToolName('')).toBe('Use a tool');
  });

  it('the approval sheet never prints a raw tool name', () => {
    const src = readFileSync(
      new URL('../src/components/ApprovalSheet.tsx', import.meta.url),
      'utf8',
    );
    expect(src).not.toMatch(/Approve \$\{request\.toolName\}/);
    expect(src).toMatch(/toolActionLabel\(request\.toolName\)/);
  });
});
