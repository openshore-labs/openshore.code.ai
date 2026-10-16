import { describe, expect, it } from 'vitest';
import { mendEmDashes } from '../src/lib/replyDashes.js';

// Built from its code point: the source may not spell the dash.
const D = String.fromCharCode(0x2014);

describe('a reply reads its em dashes as commas', () => {
  it('mends the dash a small seat wrote anyway', () => {
    expect(mendEmDashes(`efficiently and effectively${D}supporting operations`)).toBe(
      'efficiently and effectively, supporting operations',
    );
    expect(mendEmDashes(`the role ${D} broadly ${D} covers IT`)).toBe(
      'the role, broadly, covers IT',
    );
  });

  it('leaves no stray comma at a line edge or before punctuation', () => {
    expect(mendEmDashes(`${D} a list item`)).toBe('a list item');
    expect(mendEmDashes(`ends here ${D}`)).toBe('ends here');
    expect(mendEmDashes(`wait ${D}.`)).toBe('wait.');
  });

  it('keeps code exactly as written', () => {
    const fence = ['```ts', `const s = 'a${D}b';`, '```'].join('\n');
    expect(mendEmDashes(fence)).toBe(fence);
    expect(mendEmDashes(`use \`a${D}b\` here ${D} then go`)).toBe(`use \`a${D}b\` here, then go`);
  });

  it('passes a reply with no dash through untouched', () => {
    const text = 'Plain words, a - hyphen, and an en – dash.';
    expect(mendEmDashes(text)).toBe(text);
  });
});
