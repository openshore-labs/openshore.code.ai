// Cloud usage tracking. Local inference is free and stays free; every
// metered call is counted, priced, and surfaced so the status line can warn
// BEFORE quota is spent, never after.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { oscHome } from '../config/load.js';

interface PriceRule {
  pattern: RegExp;
  inPerM: number;
  outPerM: number;
}

// USD per million tokens. Kept as data so a pricing change is one edit.
const PRICES: PriceRule[] = [
  { pattern: /claude.*opus/i, inPerM: 15, outPerM: 75 },
  { pattern: /claude.*sonnet/i, inPerM: 3, outPerM: 15 },
  { pattern: /claude.*haiku/i, inPerM: 0.8, outPerM: 4 },
];
const DEFAULT_CLOUD: Omit<PriceRule, 'pattern'> = { inPerM: 3, outPerM: 15 };

export function priceFor(model: string): { inPerM: number; outPerM: number } {
  const rule = PRICES.find((p) => p.pattern.test(model));
  return rule ?? DEFAULT_CLOUD;
}

export interface UsageTotals {
  promptTokens: number;
  completionTokens: number;
  dollars: number;
  cloudCalls: number;
}

const ZERO: UsageTotals = { promptTokens: 0, completionTokens: 0, dollars: 0, cloudCalls: 0 };

export class UsageTracker {
  readonly session: UsageTotals = { ...ZERO };

  private get path(): string {
    return join(oscHome(), 'usage.json');
  }

  /** Record a metered call; returns the dollars it cost. */
  noteCloud(model: string, promptTokens: number, completionTokens: number): number {
    const price = priceFor(model);
    const dollars = (promptTokens * price.inPerM + completionTokens * price.outPerM) / 1_000_000;
    this.session.promptTokens += promptTokens;
    this.session.completionTokens += completionTokens;
    this.session.dollars += dollars;
    this.session.cloudCalls += 1;
    this.persist(promptTokens, completionTokens, dollars);
    return dollars;
  }

  /** Rough per-call estimate for the confirm-before-spend prompt. */
  estimate(model: string, promptTokensGuess: number, completionGuess = 1500): number {
    const price = priceFor(model);
    return (promptTokensGuess * price.inPerM + completionGuess * price.outPerM) / 1_000_000;
  }

  allTime(): UsageTotals {
    try {
      return { ...ZERO, ...JSON.parse(readFileSync(this.path, 'utf8')) };
    } catch {
      return { ...ZERO };
    }
  }

  private persist(promptTokens: number, completionTokens: number, dollars: number): void {
    try {
      const totals = this.allTime();
      totals.promptTokens += promptTokens;
      totals.completionTokens += completionTokens;
      totals.dollars += dollars;
      totals.cloudCalls += 1;
      mkdirSync(oscHome(), { recursive: true });
      writeFileSync(this.path, JSON.stringify(totals, null, 2));
    } catch {
      // Losing a usage line must never take down a task.
    }
  }
}
