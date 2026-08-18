// Structured search/replace blocks, the primary edit format. Local models
// hold this shape far more reliably than exact old_string/new_string JSON, and
// the shape gives the matcher real surrounding context to anchor on.
//
//   <<<<<<< SEARCH
//   ...lines as they are in the file...
//   =======
//   ...lines as they should be...
//   >>>>>>> REPLACE

export interface EditBlock {
  search: string;
  replace: string;
}

const OPEN = /^<{5,9}\s*SEARCH\s*$/;
const MID = /^={5,9}\s*$/;
const CLOSE = /^>{5,9}\s*REPLACE\s*$/;

export interface ParseResult {
  blocks: EditBlock[];
  /** Human-readable problems, empty when the parse is clean. */
  problems: string[];
}

/** Parse every well-formed block out of model output (fences tolerated). */
export function parseEditBlocks(text: string): ParseResult {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: EditBlock[] = [];
  const problems: string[] = [];

  let state: 'outside' | 'search' | 'replace' = 'outside';
  let search: string[] = [];
  let replace: string[] = [];

  for (const raw of lines) {
    // Strip code-fence lines; models love wrapping the blocks in ``` fences.
    const line = raw;
    if (/^```/.test(line.trim())) continue;

    if (state === 'outside') {
      if (OPEN.test(line.trim())) {
        state = 'search';
        search = [];
        replace = [];
      }
      continue;
    }
    if (state === 'search') {
      if (MID.test(line.trim())) {
        state = 'replace';
      } else if (OPEN.test(line.trim())) {
        problems.push('Found a new SEARCH marker before the previous block closed.');
        search = [];
      } else {
        search.push(line);
      }
      continue;
    }
    // state === 'replace'
    if (CLOSE.test(line.trim())) {
      if (search.length === 0 && replace.length === 0) {
        problems.push('An edit block was empty on both sides.');
      } else {
        blocks.push({ search: search.join('\n'), replace: replace.join('\n') });
      }
      state = 'outside';
    } else if (OPEN.test(line.trim())) {
      problems.push('A block was missing its REPLACE marker.');
      state = 'search';
      search = [];
      replace = [];
    } else {
      replace.push(line);
    }
  }
  if (state !== 'outside') {
    problems.push('The final edit block never closed with >>>>>>> REPLACE.');
  }
  return { blocks, problems };
}

/** The format description embedded in the editFile tool's docs. */
export const EDIT_FORMAT_DOC = [
  'Describe each change as a search/replace block:',
  '<<<<<<< SEARCH',
  '(the exact lines currently in the file, including 2 or 3 unchanged lines around the change so the location is unambiguous)',
  '=======',
  '(the replacement lines)',
  '>>>>>>> REPLACE',
  'Repeat a block per change. Copy the SEARCH side from the file verbatim.',
].join('\n');
