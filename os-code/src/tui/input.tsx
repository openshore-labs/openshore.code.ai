// The input box: hand-rolled so it behaves over SSH from a phone. History
// with up/down, a live slash-command hint line, Esc to stop a run, Ctrl+C
// (twice) to leave.
import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { GLYPHS, TOKENS, colorEnabled } from '../brand/theme.js';
import { SLASH_COMMANDS } from './slash.js';

export interface InputProps {
  busy: boolean;
  onSubmit: (text: string) => void;
  onAbort: () => void;
  onExit: () => void;
}

export function InputBox({ busy, onSubmit, onAbort, onExit }: InputProps): React.ReactElement {
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [, setHistoryIndex] = useState(-1);
  const [exitArmed, setExitArmed] = useState(false);
  const [cursorOn, setCursorOn] = useState(true);

  // A gentle blinking cursor at the classic ~530ms rhythm. While the agent is
  // busy the prompt holds a steady cursor (nothing to type into yet), so the
  // blink only marks a live, waiting prompt.
  useEffect(() => {
    if (busy || !colorEnabled()) {
      setCursorOn(true);
      return;
    }
    const timer = setInterval(() => setCursorOn((on) => !on), 530);
    return () => clearInterval(timer);
  }, [busy]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (exitArmed || (!busy && value === '')) onExit();
      else {
        setExitArmed(true);
        setTimeout(() => setExitArmed(false), 1500);
        if (busy) onAbort();
        setValue('');
      }
      return;
    }
    setExitArmed(false);
    if (key.escape) {
      if (busy) onAbort();
      else setValue('');
      return;
    }
    if (key.return) {
      const text = value.trim();
      if (!text) return;
      setHistory((h) => [...h, text]);
      setHistoryIndex(-1);
      setValue('');
      onSubmit(text);
      return;
    }
    if (key.upArrow) {
      setHistoryIndex((i) => {
        const next = i === -1 ? history.length - 1 : Math.max(0, i - 1);
        setValue(history[next] ?? '');
        return next;
      });
      return;
    }
    if (key.downArrow) {
      setHistoryIndex((i) => {
        const next = i === -1 ? -1 : i + 1;
        if (next >= history.length || next === -1) {
          setValue('');
          return -1;
        }
        setValue(history[next] ?? '');
        return next;
      });
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setValue((v) => v + input);
    }
  });

  const slashMatches =
    value.startsWith('/') && !value.includes(' ')
      ? SLASH_COMMANDS.filter((c) => c.name.startsWith(value)).slice(0, 5)
      : [];

  return (
    <Box flexDirection="column">
      {slashMatches.length > 0 ? (
        <Box flexDirection="column" marginLeft={2}>
          {slashMatches.map((c) => (
            <Text key={c.name}>
              <Text color={TOKENS.local}>{c.name}</Text>
              <Text color={TOKENS.muted}> {c.description}</Text>
            </Text>
          ))}
        </Box>
      ) : null}
      <Box>
        <Text color={TOKENS.local} bold>
          {GLYPHS.arrow}{' '}
        </Text>
        <Text color={TOKENS.text}>{value}</Text>
        <Text color={TOKENS.local}>{cursorOn ? '█' : '▏'}</Text>
        {busy ? <Text color={TOKENS.muted}> (Esc stops the run)</Text> : null}
        {exitArmed ? <Text color={TOKENS.warn}> press Ctrl+C again to quit</Text> : null}
      </Box>
    </Box>
  );
}
