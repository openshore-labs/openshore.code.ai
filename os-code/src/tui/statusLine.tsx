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
}

export function StatusLine(props: StatusProps): React.ReactElement {
  const dot = props.kind === 'local' ? GLYPHS.localDot : GLYPHS.cloudDot;
  const dotColor = props.kind === 'local' ? TOKENS.local : TOKENS.cloud;
  const spinner = props.busy ? GLYPHS.spinner[props.spinnerFrame % GLYPHS.spinner.length] : '';
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
        <Text color={TOKENS.local}>
          {' '}
          {spinner} {props.stepNote ?? 'working'}
        </Text>
      ) : (
        <Text color={TOKENS.muted}> {'·'} /help for commands</Text>
      )}
    </Text>
  );
}
