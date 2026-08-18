// The phone's SSE wire format: frames in, protocol events out.
import { describe, expect, it } from 'vitest';
import { parseSseFrame } from '../src/drivers/remoteDriver.js';

describe('SSE frame parsing', () => {
  it('parses id and data into a sequenced event', () => {
    const parsed = parseSseFrame('id: 42\ndata: {"type":"text-delta","text":"hello"}');
    expect(parsed).toEqual({ seq: 42, event: { type: 'text-delta', text: 'hello' } });
  });

  it('ignores keepalive comments and malformed frames', () => {
    expect(parseSseFrame(':ka')).toBeNull();
    expect(parseSseFrame('data: not-json')).toBeNull();
    expect(parseSseFrame('')).toBeNull();
  });

  it('survives a missing id (seq 0)', () => {
    const parsed = parseSseFrame('data: {"type":"task-done","reason":"complete"}');
    expect(parsed?.seq).toBe(0);
    expect(parsed?.event.type).toBe('task-done');
  });
});
