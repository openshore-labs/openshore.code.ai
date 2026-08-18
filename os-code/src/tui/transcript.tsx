// Transcript rendering: every finished item is immutable and cheap, so the
// stream never repaints what is already on screen (Ink's Static handles the
// scrollback). Colors and glyphs come from the brand theme only.
import React from 'react';
import { Box, Text } from 'ink';
import { GLYPHS, TOKENS } from '../brand/theme.js';

export type TranscriptItem =
  | { kind: 'banner'; lines: string[]; tagline: string }
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | {
      kind: 'tool';
      name: string;
      summary: string;
      state: 'ok' | 'fail' | 'denied';
      durationMs?: number;
      detail?: string;
    }
  | { kind: 'status'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'done'; ok: boolean; message?: string };

const DETAIL_LINE_CAP = 18;

export function TranscriptItemView({ item }: { item: TranscriptItem }): React.ReactElement {
  switch (item.kind) {
    case 'banner':
      return (
        <Box flexDirection="column" marginBottom={1}>
          {item.lines.map((line, i) => (
            <Text key={i} color={TOKENS.local}>
              {line}
            </Text>
          ))}
          <Text color={TOKENS.muted}>{item.tagline}</Text>
        </Box>
      );
    case 'user':
      return (
        <Box marginTop={1}>
          <Text color={TOKENS.local} bold>
            {'you '}
            {GLYPHS.arrow}{' '}
          </Text>
          <Text color={TOKENS.text}>{item.text}</Text>
        </Box>
      );
    case 'assistant':
      return (
        <Box marginTop={1} flexDirection="column">
          <Text color={TOKENS.text}>{item.text}</Text>
        </Box>
      );
    case 'tool': {
      const glyph =
        item.state === 'ok' ? GLYPHS.ok : item.state === 'denied' ? GLYPHS.skip : GLYPHS.fail;
      const color =
        item.state === 'ok' ? TOKENS.ok : item.state === 'denied' ? TOKENS.muted : TOKENS.danger;
      const duration =
        item.durationMs !== undefined ? ` ${(item.durationMs / 1000).toFixed(1)}s` : '';
      return (
        <Box flexDirection="column">
          <Text>
            <Text color={TOKENS.muted}>{GLYPHS.bullet} </Text>
            <Text color={TOKENS.local}>{item.name}</Text>
            <Text color={TOKENS.muted}>
              {' '}
              {item.summary}
              {duration}{' '}
            </Text>
            <Text color={color}>{glyph}</Text>
          </Text>
          {item.detail ? <DetailBlock detail={item.detail} /> : null}
        </Box>
      );
    }
    case 'status':
      return (
        <Text color={TOKENS.muted}>
          {GLYPHS.arrow} {item.text}
        </Text>
      );
    case 'note':
      return (
        <Text color={TOKENS.warn}>
          {GLYPHS.bullet} {item.text}
        </Text>
      );
    case 'done':
      return item.message ? (
        <Box marginTop={1}>
          <Text color={item.ok ? TOKENS.muted : TOKENS.warn}>{item.message}</Text>
        </Box>
      ) : (
        <Text> </Text>
      );
  }
}

export function DetailBlock({ detail }: { detail: string }): React.ReactElement {
  const lines = detail.split('\n');
  const shown = lines.slice(0, DETAIL_LINE_CAP);
  const hidden = lines.length - shown.length;
  return (
    <Box flexDirection="column" marginLeft={2}>
      {shown.map((line, i) => (
        <Text key={i} color={diffColor(line)}>
          {line || ' '}
        </Text>
      ))}
      {hidden > 0 ? <Text color={TOKENS.muted}>... {hidden} more lines</Text> : null}
    </Box>
  );
}

function diffColor(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return TOKENS.ok;
  if (line.startsWith('-') && !line.startsWith('---')) return TOKENS.danger;
  if (line.startsWith('@@')) return TOKENS.link;
  return TOKENS.muted;
}
