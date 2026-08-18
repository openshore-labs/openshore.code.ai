// The OS Code TUI. One Ink app over any SessionDriver, local or remote:
// streaming transcript (finished lines are static so nothing repaints), a
// live status line, tool spinners, approval prompts, citations, and slash
// commands. Keyboard-only; it feels the same over SSH from a phone.
import React, { useEffect, useRef, useState } from 'react';
import { Box, Static, Text, useApp } from 'ink';
import { GLYPHS, TAGLINE, TOKENS, WORDMARK, WORDMARK_COMPACT } from '../brand/theme.js';
import type { ApprovalRequest } from '../core/agent/types.js';
import type { Citation } from '../core/tools/index.js';
import type { DriverEvent, SessionDriver } from '../daemon/session.js';
import { TranscriptItemView, type TranscriptItem } from './transcript.js';
import { StatusLine } from './statusLine.js';
import { ApprovalPrompt } from './approval.js';
import { CitationsPanel } from './citations.js';
import { InputBox } from './input.js';
import { runSlash, type SlashContext } from './slash.js';
import { nextRevealLength } from './smoothing.js';
import { searchTranscript } from './transcriptSearch.js';

export interface AppProps {
  driver: SessionDriver;
  initialPrompt?: string;
  stackDescription: string;
  setWebEnabled?: (on: boolean) => void;
  webEnabled?: () => boolean;
}

interface RunningTool {
  id: string;
  name: string;
  args: string;
  startedAt: number;
}

let itemSeq = 0;
function keyed(item: TranscriptItem): TranscriptItem & { key: number } {
  return { ...item, key: itemSeq++ };
}

export function App(props: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [finished, setFinished] = useState<Array<TranscriptItem & { key: number }>>(() => [
    keyed({
      kind: 'banner',
      lines: (process.stdout.columns ?? 80) >= 54 ? WORDMARK : WORDMARK_COMPACT,
      tagline: `${TAGLINE}  ${GLYPHS.bullet} workspace ${props.driver.cwd}`,
    }),
  ]);
  const [streamText, setStreamText] = useState('');
  // targetRef holds the full text streamed so far; shownLenRef is how much the
  // smoother has revealed. The reveal timer walks shown toward target so bursty
  // local token streams read as calm typing (see tui/smoothing.ts).
  const targetRef = useRef('');
  const shownLenRef = useRef(0);
  const [runningTools, setRunningTools] = useState<RunningTool[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [busy, setBusy] = useState(false);
  const [dollars, setDollars] = useState(0);
  const [contextPercent, setContextPercent] = useState(0);
  const [model, setModel] = useState(props.driver.describeModel());
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [stepNote, setStepNote] = useState<string | undefined>();
  // Model-load / first-token tracking: loading is true from turn start until
  // the first token or tool call, so the status line can surface warmup time.
  const [loading, setLoading] = useState(false);
  const turnStartRef = useRef(0);

  const push = (item: TranscriptItem) => setFinished((prev) => [...prev, keyed(item)]);

  const resetStream = () => {
    targetRef.current = '';
    shownLenRef.current = 0;
    setStreamText('');
  };
  const markFirstToken = () => setLoading(false);

  // Spinner heartbeat, only while working.
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setSpinnerFrame((f) => f + 1), 90);
    return () => clearInterval(timer);
  }, [busy]);

  // Reveal timer: a smooth ~40fps cadence that drains the stream backlog.
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      const nextLen = nextRevealLength(shownLenRef.current, targetRef.current.length);
      if (nextLen !== shownLenRef.current) {
        shownLenRef.current = nextLen;
        setStreamText(targetRef.current.slice(0, nextLen));
      }
    }, 24);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    const unsubscribe = props.driver.subscribe((event: DriverEvent) => {
      switch (event.type) {
        case 'task-start':
          setBusy(true);
          setCitations([]);
          setStepNote('thinking');
          break;
        case 'turn-start':
          setModel({ model: event.model, kind: event.providerKind });
          setStepNote('thinking');
          turnStartRef.current = Date.now();
          setLoading(true);
          break;
        case 'text-delta':
          markFirstToken();
          targetRef.current += event.text;
          break;
        case 'thinking-delta':
          markFirstToken();
          setStepNote('reasoning');
          break;
        case 'text-final':
          markFirstToken();
          resetStream();
          if (event.text) push({ kind: 'assistant', text: event.text });
          break;
        case 'tool-start':
          markFirstToken();
          resetStream();
          setStepNote(event.call.name);
          setRunningTools((prev) => [
            ...prev,
            {
              id: event.call.id,
              name: event.call.name,
              args: JSON.stringify(event.call.args).slice(0, 60),
              startedAt: Date.now(),
            },
          ]);
          break;
        case 'tool-end':
          setRunningTools((prev) => prev.filter((t) => t.id !== event.call.id));
          push({
            kind: 'tool',
            name: event.call.name,
            summary: summarizeResult(event.call.args, event.result.content),
            state: event.result.ok ? 'ok' : 'fail',
            durationMs: event.durationMs,
            detail: event.result.diffText,
          });
          break;
        case 'tool-denied':
          setRunningTools((prev) => prev.filter((t) => t.id !== event.call.id));
          push({ kind: 'tool', name: event.call.name, summary: event.reason, state: 'denied' });
          break;
        case 'citations':
          setCitations((prev) => [...prev, ...event.citations]);
          break;
        case 'status':
          push({ kind: 'status', text: event.message });
          break;
        case 'note':
          push({ kind: 'note', text: event.message });
          break;
        case 'usage':
          setDollars((d) => d + event.dollars);
          setContextPercent(event.contextPercent);
          break;
        case 'model-switch':
          setModel({ model: event.model, kind: event.providerKind });
          push({ kind: 'note', text: `Switched to ${event.model} (${event.reason}).` });
          break;
        case 'task-done':
          setBusy(false);
          setLoading(false);
          setStepNote(undefined);
          setRunningTools([]);
          if (targetRef.current.trim()) {
            push({ kind: 'assistant', text: targetRef.current.trim() });
          }
          resetStream();
          if (event.reason !== 'complete') {
            push({ kind: 'done', ok: false, message: event.message ?? `stopped: ${event.reason}` });
          }
          break;
        case 'approval-request':
          setApprovals((prev) => [...prev, event.request]);
          break;
        case 'approval-resolved':
          setApprovals((prev) => prev.filter((a) => a.id !== event.id));
          break;
      }
    });
    return unsubscribe;
  }, [props.driver]);

  // Kick off an initial prompt (osc run "do the thing").
  useEffect(() => {
    if (props.initialPrompt) {
      push({ kind: 'user', text: props.initialPrompt });
      props.driver.send(props.initialPrompt);
    }
  }, []);

  const slashContext: SlashContext = {
    driver: props.driver,
    dollars,
    stackDescription: props.stackDescription,
    print: (text) => push({ kind: 'status', text }),
    clear: () => setFinished([]),
    exit: () => exit(),
    setWebEnabled: props.setWebEnabled,
    webEnabled: props.webEnabled,
    find: (query) => {
      const matches = searchTranscript(finished, query);
      push({
        kind: 'status',
        text: matches.length
          ? `Found "${query}" in ${matches.length} line${matches.length === 1 ? '' : 's'}:\n${matches.join('\n')}`
          : `No transcript line contains "${query}".`,
      });
    },
  };

  const onSubmit = (text: string) => {
    if (text.startsWith('/')) {
      if (runSlash(text, slashContext)) return;
      push({ kind: 'status', text: `No command ${text.split(' ')[0]}. Try /help.` });
      return;
    }
    push({ kind: 'user', text });
    props.driver.send(text);
  };

  const activeApproval = approvals[0];

  return (
    <Box flexDirection="column">
      <Static items={finished}>
        {(item) => <TranscriptItemView key={item.key} item={item} />}
      </Static>
      {streamText ? (
        <Box marginTop={1}>
          <Text color={TOKENS.text}>{streamText}</Text>
        </Box>
      ) : null}
      {runningTools.map((tool) => (
        <Text key={tool.id}>
          <Text color={TOKENS.local}>
            {GLYPHS.spinner[spinnerFrame % GLYPHS.spinner.length]} {tool.name}
          </Text>
          <Text color={TOKENS.muted}>
            {' '}
            {tool.args} {((Date.now() - tool.startedAt) / 1000).toFixed(0)}s
          </Text>
        </Text>
      ))}
      {!busy && citations.length > 0 ? <CitationsPanel citations={citations} /> : null}
      {activeApproval ? (
        <ApprovalPrompt
          request={activeApproval}
          onAnswer={(answer) => props.driver.answerApproval(activeApproval.id, answer)}
        />
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <StatusLine
          model={model.model}
          kind={model.kind}
          contextPercent={contextPercent}
          dollars={dollars}
          busy={busy}
          spinnerFrame={spinnerFrame}
          stepNote={stepNote}
          loading={loading}
          loadElapsedSec={loading ? (Date.now() - turnStartRef.current) / 1000 : 0}
        />
        {!activeApproval ? (
          <InputBox
            busy={busy}
            onSubmit={onSubmit}
            onAbort={() => props.driver.abort()}
            onExit={() => exit()}
          />
        ) : null}
      </Box>
    </Box>
  );
}

function summarizeResult(args: Record<string, unknown>, content: string): string {
  const path = typeof args.path === 'string' ? args.path : undefined;
  const firstLine = content.split('\n')[0] ?? '';
  if (path) return `${path} ${GLYPHS.bullet} ${firstLine.slice(0, 60)}`;
  return firstLine.slice(0, 80);
}
