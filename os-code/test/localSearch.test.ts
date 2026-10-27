// Web search for local models: the one-line request and the stream filter that
// keeps it off the screen.
import { describe, expect, it } from 'vitest';
import {
  SEARCHED_NOTE,
  SEARCH_PREFIX,
  SEARCH_PROTOCOL_NOTE,
  SearchLineFilter,
  parseSearchLine,
  searchFirstQuery,
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

describe('searchFirstQuery (search first, the Perplexity way, founder 2026-10-27)', () => {
  it('searches anything factual, question or not, cleaned to a query', () => {
    expect(searchFirstQuery('Who won the 2022 World Cup?')).toBe('Who won the 2022 World Cup');
    expect(searchFirstQuery('Can you tell me how tides work?')).toBe('how tides work');
    expect(searchFirstQuery('look up the best time to visit Lisbon')).toBe(
      'the best time to visit Lisbon',
    );
    expect(searchFirstQuery('I heard the Great Wall is visible from space')).toBe(
      'I heard the Great Wall is visible from space',
    );
    expect(searchFirstQuery('bitcoin price')).toBe('bitcoin price');
    expect(searchFirstQuery('Write a short essay on the causes of World War I')).toBe(
      'Write a short essay on the causes of World War I',
    );
  });

  it('searches a short follow-up with the message before it', () => {
    const before = 'Who won the 2022 World Cup?';
    expect(searchFirstQuery('and in 2018?', before)).toBe('Who won the 2022 World Cup and in 2018');
    expect(searchFirstQuery('why?', before)).toBe('Who won the 2022 World Cup why');
    expect(searchFirstQuery('and tomorrow?')).toBeUndefined();
    expect(searchFirstQuery('why?')).toBeUndefined();
  });

  it('leaves small talk and arithmetic to the model', () => {
    for (const m of ['hello', 'thanks!', 'how are you?', 'got it', '2 + 2?']) {
      expect(searchFirstQuery(m)).toBeUndefined();
    }
  });

  it('leaves coding to the model, where it is strongest', () => {
    for (const m of [
      'write a function that reverses a string',
      'why does `const x = () => 1;` fail?',
      'fix the bug in my react component',
      'I get a traceback when I run the script',
      'def add(a, b): return a + b',
    ]) {
      expect(searchFirstQuery(m)).toBeUndefined();
    }
  });

  it('leaves edits of given text and questions about the chat to the model', () => {
    for (const m of [
      'Summarize this article for me',
      'rewrite this paragraph to be shorter',
      'what did you mean by your last answer?',
    ]) {
      expect(searchFirstQuery(m)).toBeUndefined();
    }
  });

  it('searches pasted material by its first line', () => {
    const q = searchFirstQuery(`Is this claim true?\n${'word '.repeat(200)}`);
    expect(q).toBe('Is this claim true');
  });
});
