// Transcript rendering: every finished item is immutable and cheap, so the
// stream never repaints what is already on screen (Ink's Static handles the
// scrollback). Colors and glyphs come from the brand theme only.
import React from 'react';
import { Box, Text } from 'ink';
import { GLYPHS, TOKENS } from '../brand/theme.js';
import { tokenizeCodeLine, type TokenKind } from './syntax.js';

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
        <DiffLine key={i} line={line} />
      ))}
      {hidden > 0 ? <Text color={TOKENS.muted}>... {hidden} more lines</Text> : null}
    </Box>
  );
}

type LineType = 'add' | 'del' | 'hunk' | 'context' | 'meta';

function classifyLine(line: string): LineType {
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'context';
}

// Diff semantics own the base color (added green, removed red). Within a line,
// syntax gives the eye handholds: strings warm, keywords teal, comments dim.
// On context lines syntax leads (it is the code being read); on +/- lines the
// diff color leads and only comments soften, so the change stays obvious.
function segColor(lineType: LineType, kind: TokenKind): string {
  const base =
    lineType === 'add'
      ? TOKENS.ok
      : lineType === 'del'
        ? TOKENS.danger
        : lineType === 'hunk'
          ? TOKENS.link
          : TOKENS.muted;
  if (kind === 'comment') return TOKENS.muted;
  if (kind === 'string') return lineType === 'context' ? TOKENS.cloud : base;
  if (kind === 'keyword') return lineType === 'context' ? TOKENS.link : base;
  return base;
}

/** One diff line, diff-colored and lightly syntax-tinted. */
export function DiffLine({ line }: { line: string }): React.ReactElement {
  const lineType = classifyLine(line);
  if (line === '') return <Text> </Text>;
  if (lineType === 'hunk' || lineType === 'meta') {
    return <Text color={lineType === 'hunk' ? TOKENS.link : TOKENS.muted}>{line}</Text>;
  }
  // Keep the leading +/- sign in the pure diff color, tint only the code after.
  const sign = lineType === 'add' || lineType === 'del' ? line[0]! : '';
  const body = sign ? line.slice(1) : line;
  const tokens = tokenizeCodeLine(body);
  return (
    <Text>
      {sign ? <Text color={lineType === 'add' ? TOKENS.ok : TOKENS.danger}>{sign}</Text> : null}
      {tokens.map((tok, i) => (
        <Text key={i} color={segColor(lineType, tok.kind)}>
          {tok.text}
        </Text>
      ))}
    </Text>
  );
}
