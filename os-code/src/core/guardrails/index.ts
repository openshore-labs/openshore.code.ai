// Guardrails. Hard stops for the ways an agent loop goes wrong: too many
// steps, the same action over and over, or blowing a wall-clock, token, or
// dollar budget. When a rail trips, the loop halts and hands control back with
// a plain explanation. A runShell loop cannot be left running unattended.
import { createHash } from 'node:crypto';

export interface GuardrailConfig {
  maxSteps: number;
  /** Identical (tool, args) calls tolerated before the loop is stopped. */
  maxRepeats: number;
  wallClockSeconds: number;
  maxTokens: number;
  /** USD ceiling for cloud spend in one task. Local work costs zero. */
  maxDollars: number;
}

export const DEFAULT_GUARDRAILS: GuardrailConfig = {
  maxSteps: 40,
  maxRepeats: 3,
  wallClockSeconds: 900,
  maxTokens: 400_000,
  maxDollars: 2.0,
};

export interface GuardrailViolation {
  rail: 'steps' | 'repeat' | 'wall-clock' | 'tokens' | 'dollars';
  message: string;
}

export class Guardrails {
  private steps = 0;
  private tokens = 0;
  private dollars = 0;
  private startedAt = Date.now();
  private callCounts = new Map<string, number>();

  constructor(
    private readonly config: GuardrailConfig = DEFAULT_GUARDRAILS,
    private readonly hardStepCeiling?: number,
  ) {}

  /** Reset the per-task counters (a new user turn starts a new task). Every
   *  rail is per task, tokens and dollars included: a long session must never
   *  become unable to start its next task (P0-2). */
  startTask(): void {
    this.steps = 0;
    this.tokens = 0;
    this.dollars = 0;
    this.startedAt = Date.now();
    this.callCounts.clear();
  }

  noteStep(): void {
    this.steps += 1;
  }

  noteTokens(count: number): void {
    this.tokens += count;
  }

  noteDollars(amount: number): void {
    this.dollars += amount;
  }

  /** Record a tool call; returns how many times this exact call has happened. */
  noteToolCall(toolName: string, args: unknown): number {
    const key = createHash('sha256')
      .update(toolName)
      .update(JSON.stringify(args ?? {}))
      .digest('hex');
    const n = (this.callCounts.get(key) ?? 0) + 1;
    this.callCounts.set(key, n);
    return n;
  }

  get spentTokens(): number {
    return this.tokens;
  }

  get spentDollars(): number {
    return this.dollars;
  }

  /** Check every rail. Returns the first violation, or null when clear. */
  check(lastCall?: {
    toolName: string;
    args: unknown;
    repeats: number;
  }): GuardrailViolation | null {
    // noteStep runs before the check, so the ceiling is exclusive here: step
    // number `ceiling` still runs and the one after it trips (ENG-12).
    const ceiling = Math.min(this.config.maxSteps, this.hardStepCeiling ?? Infinity);
    if (this.steps > ceiling) {
      return {
        rail: 'steps',
        message: `Stopped at the step limit (${ceiling} steps). Say "continue" to keep going, or raise guardrails.maxSteps.`,
      };
    }
    if (lastCall && lastCall.repeats > this.config.maxRepeats) {
      return {
        rail: 'repeat',
        message: `Stopped: ${lastCall.toolName} was called ${lastCall.repeats} times with identical arguments. The model is looping, so control is back with you.`,
      };
    }
    const elapsed = (Date.now() - this.startedAt) / 1000;
    if (elapsed > this.config.wallClockSeconds) {
      return {
        rail: 'wall-clock',
        message: `Stopped after ${Math.round(elapsed)}s (limit ${this.config.wallClockSeconds}s). Say "continue" to resume where it left off.`,
      };
    }
    if (this.tokens > this.config.maxTokens) {
      return {
        rail: 'tokens',
        message: `Stopped: this task used ${this.tokens.toLocaleString()} tokens (limit ${this.config.maxTokens.toLocaleString()}).`,
      };
    }
    if (this.dollars > this.config.maxDollars) {
      return {
        rail: 'dollars',
        message: `Stopped: cloud spend reached $${this.dollars.toFixed(2)} (limit $${this.config.maxDollars.toFixed(2)}). Nothing more will be spent without you.`,
      };
    }
    return null;
  }
}
