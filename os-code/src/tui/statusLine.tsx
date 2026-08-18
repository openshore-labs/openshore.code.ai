// The status line: active model and role, local vs cloud, context used,
// session cloud cost, and what the agent is doing right now. One line,
// always current, readable on a phone.
import React from 'react';
import { Text } from 'ink';
import { GLYPHS, TOKENS } from '../brand/theme.js';

export interface StatusProps {
  model: string;
  kind: 'local' | 'cloud';
  contextPercent: number;
  dollars: number;
  busy: boolean;
  spinnerFrame: number;
  stepNote?: string;
  /** True between turn start and first token: the model is loading or thinking. */
  loading?: boolean;
  /** Seconds since the current turn started, for the load ticker. */
  loadElapsedSec?: number;
}

// Below this, a slow first token is just normal latency; do not cry "loading".
const LOAD_HINT_AFTER_SEC = 0.8;

/**
 * What the busy tail says. A local model that has not produced a token in a
 * while is almost always loading weights into VRAM, so name that (with the
 * elapsed seconds) instead of a silent spinner. GPU load time is surfaced,
 * never a mystery hang.
 */
export function busyNote(
  props: Pick<StatusProps, 'loading' | 'loadElapsedSec' | 'stepNote' | 'kind' | 'model'>,
): string {
  const elapsed = props.loadElapsedSec ?? 0;
  if (props.loading && elapsed >= LOAD_HINT_AFTER_SEC) {
    const verb = props.kind === 'local' ? 'warming up' : 'reaching';
    return `${verb} ${props.model}, ${elapsed.toFixed(0)}s`;
  }
  return props.stepNote ?? 'working';
}

export function StatusLine(props: StatusProps): React.ReactElement {
  const dot = props.kind === 'local' ? GLYPHS.localDot : GLYPHS.cloudDot;
  const dotColor = props.kind === 'local' ? TOKENS.local : TOKENS.cloud;
  const spinner = props.busy ? GLYPHS.spinner[props.spinnerFrame % GLYPHS.spinner.length] : '';
  const note = busyNote(props);
  const noteColor =
    props.loading && (props.loadElapsedSec ?? 0) >= LOAD_HINT_AFTER_SEC ? dotColor : TOKENS.local;
  return (
    <Text>
      <Text color={dotColor}>
        {dot} {props.model}
      </Text>
      <Text color={TOKENS.muted}> {props.kind}</Text>
      <Text color={TOKENS.muted}>
        {' '}
        {'·'} ctx {props.contextPercent}%
      </Text>
      <Text color={props.dollars > 0 ? TOKENS.cloud : TOKENS.muted}>
        {' '}
        {'·'} ${props.dollars.toFixed(2)}
      </Text>
      {props.busy ? (
        <Text color={noteColor}>
          {' '}
          {spinner} {note}
        </Text>
      ) : (
        <Text color={TOKENS.muted}> {'·'} /help for commands</Text>
      )}
    </Text>
  );
}
