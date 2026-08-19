// Opt-in, on-device activity log for the test run. This is NOT telemetry: it
// is off by default, stored only on this device, and nothing is ever sent
// anywhere automatically. A tester can turn it on, then review and hand the
// log back manually. That is the whole contract, and it is what keeps the
// "no phone-home, ever" promise true while still letting the first test run
// learn where people succeed or stall.
import { storeGetJson, storeSetJson } from './platform.js';

export interface InsightEvent {
  name: string;
  at: number;
  props?: Record<string, string | number | boolean>;
}

const KEY = 'oscode.insights.v1';

let enabled = false;
let loaded = false;
let events: InsightEvent[] = [];
let once = new Set<string>();

/** Load persisted events and set the opt-in flag. Call once at startup. */
export async function loadInsights(optIn: boolean): Promise<void> {
  enabled = optIn;
  const data = await storeGetJson<{ events: InsightEvent[]; once: string[] }>(KEY);
  events = data?.events ?? [];
  once = new Set(data?.once ?? []);
  loaded = true;
}

export function setInsightsEnabled(optIn: boolean): void {
  enabled = optIn;
}

function persist(): void {
  void storeSetJson(KEY, { events, once: [...once] });
}

/** Record an event. No-op unless the tester opted in. */
export function logEvent(name: string, props?: InsightEvent['props']): void {
  if (!enabled || !loaded) return;
  events.push({ name, at: Date.now(), props });
  if (events.length > 500) events = events.slice(-500);
  persist();
}

/** Record a funnel milestone only the first time it ever happens. */
export function logOnce(name: string, props?: InsightEvent['props']): void {
  if (!enabled || !loaded || once.has(name)) return;
  once.add(name);
  logEvent(name, props);
}

export function insightsCount(): number {
  return events.length;
}

export async function clearInsights(): Promise<void> {
  events = [];
  once = new Set();
  await storeSetJson(KEY, { events: [], once: [] });
}

/** The log as plain text, for a tester to review and hand back. */
export function insightsAsText(): string {
  if (!events.length) return 'No activity recorded yet.';
  return events
    .map(
      (e) =>
        `${new Date(e.at).toISOString()}  ${e.name}${e.props ? `  ${JSON.stringify(e.props)}` : ''}`,
    )
    .join('\n');
}
