// Transcript search, kept free of Ink so it is trivially testable. The type
// import is erased at compile time, so this module pulls in no React runtime.
import type { TranscriptItem } from './transcript.js';

/** Plain text of a transcript item, for /find. */
export function itemText(item: TranscriptItem): string {
  switch (item.kind) {
    case 'user':
    case 'assistant':
    case 'status':
    case 'note':
      return item.text;
    case 'tool':
      return `${item.name} ${item.summary} ${item.detail ?? ''}`;
    case 'done':
      return item.message ?? '';
    case 'banner':
      return '';
  }
}

/** Case-insensitive substring search across finished transcript items. */
export function searchTranscript(items: TranscriptItem[], query: string, limit = 20): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: string[] = [];
  for (const item of items) {
    for (const line of itemText(item).split('\n')) {
      if (line.toLowerCase().includes(needle)) hits.push(`  ${line.trim().slice(0, 100)}`);
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}
