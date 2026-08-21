// A one-word time-of-day greeting for the chat splash. Local device clock,
// no network, no account needed. Matches the casual register of "Evening,
// how are things?" without borrowing anyone else's copy.
export function timeGreeting(hour = new Date().getHours()): string {
  if (hour < 5) return 'Late night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
