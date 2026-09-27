// The v1 focus flag (docs/v1-direction-review.md, "Hide flag"; the hide list
// and its votes are there). One build-time switch that hides the extras a
// first-time person does not need yet, so the app opens as a chat on a folder
// with a model beside it: Crew and its routines, the Marketplace, Stack
// Health, Launch, the Terminal room, the Vault room, Admin, and both Currents
// groups. Code stays intact; unhiding is a founder call.
//
// It SHIPS OFF: with VITE_V1_FOCUS unset, nothing is hidden anywhere and the
// app is exactly what it was. A build turns it on with VITE_V1_FOCUS=on. One
// gate, read by the Sidebar, the room list, navigation, and the Currents
// views, so a hidden room has no door left open (app/test/focus.test.ts).

/** Rooms the focus flag hides. */
export const FOCUS_HIDDEN_ROOMS: ReadonlySet<string> = new Set([
  'crew',
  'marketplace',
  'stackhealth',
  'launch',
  'terminalroom',
  'vault',
  'admin',
]);

/** Whether a build asked for focus. */
export function focusRequested(env: { VITE_V1_FOCUS?: string } | undefined): boolean {
  return env?.VITE_V1_FOCUS === 'on';
}

/** The flag for this build. Off unless VITE_V1_FOCUS=on. */
export const V1_FOCUS: boolean = focusRequested(
  (import.meta as { env?: { VITE_V1_FOCUS?: string } }).env,
);

/** Whether a room is hidden in this build. */
export function hiddenInFocus(view: string, on: boolean = V1_FOCUS): boolean {
  return on && FOCUS_HIDDEN_ROOMS.has(view);
}

/** A room list with the hidden rooms taken out (all of it when focus is off). */
export function visibleRooms<T extends { view: string }>(rooms: T[], on: boolean = V1_FOCUS): T[] {
  return on ? rooms.filter((r) => !FOCUS_HIDDEN_ROOMS.has(r.view)) : rooms;
}
