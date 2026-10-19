// When a chat or a note last moved, in a few words, for the head of a line.
// Its own module so a room that shows a time (the Vault's agent notes) does
// not load the Chats screen and everything it imports.

/** "Just now", "12m ago", "2h ago", "Yesterday", "Mon", "Sep 1". Every
 *  caller sets it at the head of a line or a " · " part, so a word starts
 *  with a capital, the way "Yesterday" does beside it: a locale's lowercase
 *  weekday or month ("lun.", "sept.") too. A number leads as it is. */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = new Date(t);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (t >= startOfToday - 86_400_000) return 'Yesterday';
  if (t >= startOfToday - 6 * 86_400_000)
    return lineStart(d.toLocaleDateString(undefined, { weekday: 'short' }));
  return lineStart(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
}

/** A value at the head of a line, its first letter a capital. */
export function lineStart(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}
