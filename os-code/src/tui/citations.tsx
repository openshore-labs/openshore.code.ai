// Citations panel: when an answer leaned on the web, the sources are right
// there, numbered, the way Claude Code surfaces them. Honesty as a feature.
import React from 'react';
import { Box, Text } from 'ink';
import { TOKENS } from '../brand/theme.js';
import type { Citation } from '../core/tools/index.js';

export function CitationsPanel({
  citations,
}: {
  citations: Citation[];
}): React.ReactElement | null {
  if (!citations.length) return null;
  const unique: Citation[] = [];
  const seen = new Set<string>();
  for (const c of citations) {
    if (!seen.has(c.url)) {
      seen.add(c.url);
      unique.push(c);
    }
  }
  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor={TOKENS.muted}
      paddingX={1}
    >
      <Text color={TOKENS.muted} bold>
        sources
      </Text>
      {unique.slice(0, 8).map((c, i) => (
        <Text key={c.url}>
          <Text color={TOKENS.muted}>{i + 1}. </Text>
          <Text color={TOKENS.text}>{c.title.slice(0, 60)}</Text>
          <Text color={TOKENS.link}> {c.url}</Text>
        </Text>
      ))}
    </Box>
  );
}
