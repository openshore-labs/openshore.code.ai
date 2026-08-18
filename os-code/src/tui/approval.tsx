// The approval prompt. Reversible, keyboard-only, and honest: the exact
// command or diff is right there. Cloud spend gets its own distinct look
// (amber) so spending money never resembles writing a file.
import React from 'react';
import { Box, Text, useInput } from 'ink';
import { TOKENS } from '../brand/theme.js';
import type { ApprovalAnswer, ApprovalRequest } from '../core/agent/types.js';
import { DetailBlock } from './transcript.js';

export interface ApprovalProps {
  request: ApprovalRequest;
  onAnswer: (answer: ApprovalAnswer) => void;
}

export function ApprovalPrompt({ request, onAnswer }: ApprovalProps): React.ReactElement {
  useInput((input, key) => {
    const ch = input.toLowerCase();
    if (ch === 'y' || key.return) onAnswer({ approve: true });
    else if (ch === 'a') onAnswer({ approve: true, alwaysThisSession: true });
    else if (ch === 'n' || key.escape) onAnswer({ approve: false });
  });

  const isCloud = request.kind === 'cloud-spend';
  const borderColor = isCloud
    ? TOKENS.cloud
    : request.risk === 'shell'
      ? TOKENS.warn
      : TOKENS.local;
  const title = isCloud ? 'cloud spend' : `approve ${request.toolName}`;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
      marginTop={1}
    >
      <Text color={borderColor} bold>
        {title}
      </Text>
      <Text color={TOKENS.text}>{request.summary}</Text>
      {request.detail ? <DetailBlock detail={request.detail} /> : null}
      <Text color={TOKENS.muted}>
        [y] yes once {'·'} [a] yes for this session {'·'} [n] no
      </Text>
    </Box>
  );
}
