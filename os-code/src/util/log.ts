// Tiny hand-rolled logger. Writes to ~/.os-code/logs/osc.log, never to the
// user's transcript. Secrets are scrubbed before anything is written.
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { redactSecrets } from '../core/security/redaction.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let minLevel: LogLevel = (process.env.OSC_LOG_LEVEL as LogLevel) || 'info';
let logDir = join(homedir(), '.os-code', 'logs');
let ready = false;

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export function setLogDir(dir: string): void {
  logDir = dir;
  ready = false;
}

function line(level: LogLevel, scope: string, msg: string, extra?: unknown): string {
  const at = new Date().toISOString();
  const detail = extra === undefined ? '' : ` ${safeJson(extra)}`;
  return `${at} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}${detail}\n`;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function write(level: LogLevel, scope: string, msg: string, extra?: unknown): void {
  if (LEVELS[level] < LEVELS[minLevel]) return;
  try {
    if (!ready) {
      mkdirSync(logDir, { recursive: true });
      ready = true;
    }
    appendFileSync(join(logDir, 'osc.log'), redactSecrets(line(level, scope, msg, extra)));
  } catch {
    // Logging must never take the app down.
  }
}

export function logger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => write('debug', scope, msg, extra),
    info: (msg: string, extra?: unknown) => write('info', scope, msg, extra),
    warn: (msg: string, extra?: unknown) => write('warn', scope, msg, extra),
    error: (msg: string, extra?: unknown) => write('error', scope, msg, extra),
  };
}

export type Logger = ReturnType<typeof logger>;
