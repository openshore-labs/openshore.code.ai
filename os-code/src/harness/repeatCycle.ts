// The premium harness, tech review 6: alternating-repeat detection, on for every seat.
//
// The loop already answers an exact repeat from the record when nothing that
// could change the workspace ran since (loop.ts `noteRepeat`). A period-2
// cycle slips past that: A, B, A, B, where B is a command or a write that
// succeeds each time, so every A looks like a fresh question after it. The
// deep eval's small seats did this (a check command, then a read of the same
// file, then the check again) until the step rail stopped them. The same two
// calls with the same arguments, over and over, make no progress: breaking
// the cycle saves minutes on a slow box and cannot cost a task that is moving.
//
// The watch sees every call's key (tool name and arguments) in order. The
// fourth call of A, B, A, B is a hit, and each further call that keeps the
// cycle going is another; any call that breaks the pattern clears the count.
// The loop puts the hits on its existing ladder: the first is answered from
// the record ('stale'), the second makes the next turn answer-only.
//
// Pure and synchronous (tenet 5): no files, no network, no Node built-ins.

/**
 * Tools whose answer moves between two identical calls: `readProcess` reads
 * the output of a program the agent started, which keeps printing. The same
 * call again is a fresh question, so the loop never answers one from the
 * record, and it joins the cycle watch by the output it showed: a cycle
 * through it breaks only once that output stops changing.
 */
export const VOLATILE_TOOLS: ReadonlySet<string> = new Set(['readProcess']);

/** Which detector answered a call from the record: the same call again with
 *  nothing changed since ('exact'), or two calls taking turns ('alternating'). */
export type RepeatPattern = 'exact' | 'alternating';

/** Watches a task's calls for a period-2 cycle. */
export class AlternatingRepeats {
  private recent: string[] = [];
  private hits = 0;

  /**
   * Record one call by its key and say whether it continues a cycle: 0 when
   * it does not, else how many calls in a row have (1 on the fourth call of
   * A, B, A, B, 2 on the fifth, and so on). A call that breaks the pattern
   * clears the count.
   */
  note(key: string): number {
    this.recent.push(key);
    if (this.recent.length > 4) this.recent.shift();
    if (this.recent.length === 4) {
      const [a, b, c, d] = this.recent;
      if (a === c && b === d && a !== b) {
        this.hits += 1;
        return this.hits;
      }
    }
    this.hits = 0;
    return 0;
  }

  /** Forget everything: a task's start, a fresh attempt, a verify retry. */
  clear(): void {
    this.recent = [];
    this.hits = 0;
  }
}
