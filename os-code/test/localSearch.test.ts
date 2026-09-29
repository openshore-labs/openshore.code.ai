// Web search for local models: the one-line request and the stream filter that
// keeps it off the screen.
import { describe, expect, it } from 'vitest';
import {
  SEARCHED_NOTE,
  SEARCH_PREFIX,
  SEARCH_PROTOCOL_NOTE,
  SearchLineFilter,
  parseSearchLine,
} from '../src/harness/localSearch.js';

function stream(filter: SearchLineFilter, deltas: string[]): string {
  return deltas.map((d) => filter.push(d)).join('');
}

describe('parseSearchLine', () => {
  it('reads the query from a search line', () => {
    expect(parseSearchLine('SEARCH: jimi hendrix')).toBe('jimi hendrix');
    expect(parseSearchLine('  search:   latest node release \n')).toBe('latest node release');
  });

  it('strips quotes a model copies from the instruction', () => {
    expect(parseSearchLine('SEARCH: "who won the 2026 world cup"')).toBe(
      'who won the 2026 world cup',
    );
  });

  it('takes only the first line, dropping anything a model invents after it', () => {
    expect(parseSearchLine('SEARCH: tides today\n1. Tide tables say...')).toBe('tides today');
  });

  it('ignores a normal reply and an empty query', () => {
    expect(parseSearchLine('Sure, here is the answer.')).toBeUndefined();
    expect(parseSearchLine('I would search for this.')).toBeUndefined();
    expect(parseSearchLine('SEARCH:')).toBeUndefined();
    expect(parseSearchLine('SEARCH: ""')).toBeUndefined();
  });

  it('caps a runaway query', () => {
    expect(parseSearchLine(`SEARCH: ${'a'.repeat(500)}`)!.length).toBe(200);
  });
});

describe('SearchLineFilter', () => {
  it('never shows a search line, even split across deltas', () => {
    const f = new SearchLineFilter();
    expect(stream(f, ['SE', 'AR', 'CH: jimi ', 'hendrix'])).toBe('');
    expect(f.end()).toEqual({ query: 'jimi hendrix', flush: '' });
  });

  it('lets a normal reply through after at most the prefix length', () => {
    const f = new SearchLineFilter();
    expect(f.push('S')).toBe('');
    expect(f.push('ure, ')).toBe('Sure, ');
    expect(f.push('here it is.')).toBe('here it is.');
    expect(f.end()).toEqual({ flush: '' });
  });

  it('flushes a short reply that only looked like a search line', () => {
    const f = new SearchLineFilter();
    expect(stream(f, ['Se'])).toBe('');
    expect(f.end()).toEqual({ flush: 'Se' });
  });

  it('flushes a bare prefix with no query', () => {
    const f = new SearchLineFilter();
    expect(stream(f, ['SEARCH:'])).toBe('');
    expect(f.end()).toEqual({ flush: 'SEARCH:' });
  });

  it('passes everything through when off', () => {
    const f = new SearchLineFilter(false);
    expect(stream(f, ['SEARCH: x'])).toBe('SEARCH: x');
    expect(f.end()).toEqual({ flush: '' });
  });

  it('the instruction names the prefix the parser reads', () => {
    expect(SEARCH_PROTOCOL_NOTE).toContain('SEARCH: your search query');
  });

  // The answer pass after a search (app drivers, build 2026-09-29 A4): the
  // model is told its one search is spent, and the line never names the
  // prefix, so it cannot read as an invitation to ask again.
  it('the after-search note tells the model to answer now', () => {
    expect(SEARCHED_NOTE).toMatch(/already searched/i);
    expect(SEARCHED_NOTE).toMatch(/do not ask to search again/i);
    expect(SEARCHED_NOTE).not.toContain(SEARCH_PREFIX);
  });
});
