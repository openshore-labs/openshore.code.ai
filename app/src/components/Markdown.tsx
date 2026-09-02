// Assistant prose rendering: markdown with GFM tables and in-palette code
// highlighting, exactly the reading experience the best chat apps set. Fenced
// code blocks carry a Copy control, and a Run control when the chat is
// desktop-backed and the block looks like a shell command, so a suggested
// command goes to the connected terminal with one tap (the chat-to-terminal
// bridge) instead of a copy into a separate SSH app.
import { isValidElement, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useApp } from '../state/store.js';
import { hapticTick } from '../lib/haptics.js';
import { copyText } from '../lib/clipboard.js';

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (isValidElement(node)) {
    return extractText((node.props as { children?: ReactNode }).children);
  }
  return '';
}

function langFrom(node: ReactNode): string {
  if (isValidElement(node)) {
    const cls = (node.props as { className?: string }).className ?? '';
    const match = /language-(\w+)/.exec(cls);
    if (match) return match[1].toLowerCase();
  }
  return '';
}

const SHELL_LANGS = new Set(['bash', 'sh', 'zsh', 'shell', 'console', 'shellsession']);

function looksRunnable(code: string, lang: string): boolean {
  if (SHELL_LANGS.has(lang)) return true;
  // An unlabeled single-line block is very likely a command.
  return lang === '' && code.trim().length > 0 && !code.trim().includes('\n');
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const runCommand = useApp((s) => s.runCommand);
  const canRun = useApp((s) => s.canRunCommands());
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');

  const code = extractText(children).replace(/\n$/, '');
  const lang = langFrom(children);
  const runnable = canRun && looksRunnable(code, lang);

  // Copy is the whole point of a block the person has to paste elsewhere, so
  // it says what happened either way: the async clipboard first, a textarea
  // fallback for a WebView that lacks it, and an honest "Copy failed" rather
  // than a silent nothing.
  const copy = async (): Promise<void> => {
    hapticTick();
    const ok = await copyText(code);
    setCopied(ok ? 'done' : 'failed');
    setTimeout(() => setCopied('idle'), 1400);
  };

  return (
    <div className="md-code">
      <div className="md-code-bar">
        {lang ? <span className="md-code-lang">{lang}</span> : <span />}
        <span className="md-code-actions">
          {runnable ? (
            <button
              type="button"
              className="md-code-run press-fb"
              onClick={() => {
                hapticTick();
                runCommand(code);
              }}
            >
              Run
            </button>
          ) : null}
          <button type="button" className="md-code-copy press-fb" onClick={copy}>
            {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy'}
          </button>
        </span>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{ pre: ({ children }) => <CodeBlock>{children}</CodeBlock> }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
