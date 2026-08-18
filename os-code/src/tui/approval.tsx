// The approval prompt. Reversible, keyboard-only, and honest: the exact
// command or diff is right there. Cloud spend gets its own distinct look
// (amber) so spending money never resembles writing a file.
import React, { useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { TOKENS } from '../brand/theme.js';
import type { ApprovalAnswer, ApprovalRequest } from '../core/agent/types.js';
import { DetailBlock } from './transcript.js';

export interface ApprovalProps {
  request: ApprovalRequest;
  onAnswer: (answer: ApprovalAnswer) => void;
}

type Choice = 'y' | 'a' | 'n';

export function ApprovalPrompt({ request, onAnswer }: ApprovalProps): React.ReactElement {
  // A brief pressed-state flash on the chosen key before the answer resolves,
  // so a keystroke feels acknowledged rather than swallowed. The ref guards
  // against a second key landing during the flash.
  const [pressed, setPressed] = useState<Choice | null>(null);
  const answered = useRef(false);

  const choose = (choice: Choice, answer: ApprovalAnswer) => {
    if (answered.current) return;
    answered.current = true;
    setPressed(choice);
    setTimeout(() => onAnswer(answer), 90);
  };

  useInput((input, key) => {
    const ch = input.toLowerCase();
    if (ch === 'y' || key.return) choose('y', { approve: true });
    else if (ch === 'a') choose('a', { approve: true, alwaysThisSession: true });
    else if (ch === 'n' || key.escape) choose('n', { approve: false });
  });

  const isCloud = request.kind === 'cloud-spend';
  const borderColor = isCloud
    ? TOKENS.cloud
    : request.risk === 'shell'
      ? TOKENS.warn
      : TOKENS.local;
  const title = isCloud ? 'cloud spend' : `approve ${request.toolName}`;

  const key = (choice: Choice, label: string, color: string) => (
    <Text
      color={pressed === choice ? TOKENS.text : color}
      bold={pressed === choice}
      inverse={pressed === choice}
    >
      {label}
    </Text>
  );

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
      <Text>
        {key('y', '[y] yes once', TOKENS.muted)}
        <Text color={TOKENS.muted}> {'·'} </Text>
        {key('a', '[a] yes for this session', TOKENS.muted)}
        <Text color={TOKENS.muted}> {'·'} </Text>
        {key('n', '[n] no', TOKENS.muted)}
      </Text>
    </Box>
  );
}
