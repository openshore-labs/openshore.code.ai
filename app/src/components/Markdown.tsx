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
  const [copied, setCopied] = useState(false);

  const code = extractText(children).replace(/\n$/, '');
  const lang = langFrom(children);
  const runnable = canRun && looksRunnable(code, lang);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Best effort: a WebView without clipboard access simply does nothing.
    }
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
            {copied ? 'Copied' : 'Copy'}
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
