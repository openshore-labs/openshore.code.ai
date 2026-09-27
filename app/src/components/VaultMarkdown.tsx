// Vault reading mode: the chat renderer's markdown treatment, plus Obsidian's
// own syntax (Vault M3, CTO H2; Vault M6 6.5 and 6.6, CTO K10 and K11, CX X12
// to X14). The frontmatter is found by the shared core and shown by
// VaultProperties; the renderer only ever sees `text.slice(fm.end)`, so the
// core and the renderer can never disagree about where frontmatter ends (no
// remark-frontmatter, and YAML is never read as a heading).
//
// Two hand-written remark plugins do the Obsidian part, both on mdast nodes so
// code is never touched: lib/remarkWikilinks.ts makes `[[links]]` and embeds
// (`![[Note]]`, `![[img.png]]`, `![](img.png)`), and lib/remarkObsidian.ts
// makes callouts, `==highlights==`, block anchors, heading indexes and task
// lines. `%%comments%%` are masked before the parse (same length, line breaks
// kept), so they never reach the page or the accessibility tree.
//
// Sanitized by construction: never rehype-raw, so raw HTML stays inert; the
// url transform lets `vault:` through and keeps the default for the rest; an
// image never takes its `src` from the note (the attachment component loads a
// blob URL the registry made); and no `id` attribute is ever built from note
// text, so scroll-to walks `data-heading-index` and `data-block` instead.
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components, type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import {
  maskComments,
  noteTitle,
  readFrontmatter,
  resolveMarkdownLink,
  scanNote,
  type CalloutFamily,
} from 'os-code/protocol';
import { remarkWikilinks } from '../lib/remarkWikilinks.js';
import { remarkObsidian } from '../lib/remarkObsidian.js';
import { pathIndexOf } from '../lib/vault.js';
import { vaultReaderCopy } from '../lib/vaultCopy.js';
import { hapticTick } from '../lib/haptics.js';
import { durationMs, prefersReducedMotion } from '../lib/motion.js';
import { CodeBlock } from './CodeBlock.js';
import { Icon } from './Icon.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { VaultProperties } from './VaultProperties.js';
import { VaultEmbed, VaultEmbedChip } from './vault/VaultEmbed.js';
import {
  VaultAttachment,
  VaultImageSheet,
  type VaultMedia,
  type ZoomedImage,
} from './vault/VaultAttachment.js';

export type { VaultMedia } from './vault/VaultAttachment.js';

// react-markdown 10 strips any href whose protocol is not in its allowlist,
// which drops our vault: wikilinks (they would render with an empty href and
// never navigate). Allow vault: through, and keep the default transform for
// every other protocol so javascript: and other hostile schemes stay blocked.
export const vaultUrlTransform = (url: string): string =>
  url.startsWith('vault:') ? url : defaultUrlTransform(url);

/** Split a vault: href into its path part and its `#subpath`. */
function hrefParts(href: string): { path: string; sub?: string } {
  const raw = href.slice('vault:'.length);
  const hash = raw.indexOf('#');
  if (hash < 0) return { path: raw };
  return { path: raw.slice(0, hash), sub: raw.slice(hash + 1) };
}

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** The note path a vault: href names. A hand-written or pasted link can carry
 *  a broken percent-escape ("vault:%E0%A4%A"), which decodeURIComponent throws
 *  on during render (ui-9); the raw text is used instead, so the link still
 *  names something and the note still renders. */
export function vaultHrefPath(href: string): string {
  return safeDecode(hrefParts(href).path.replace(/\?new$/, ''));
}

/** The heading or `^block` a vault: href scrolls to, if any. */
export function vaultHrefSubpath(href: string): string | undefined {
  const sub = hrefParts(href).sub;
  return sub ? safeDecode(sub) : undefined;
}

/** Scroll to a heading or a block once the note shows (CX X12). `key` makes
 *  the same target fire again (a second tap on the same link). */
export interface VaultAnchor {
  subpath: string;
  key: number;
}

type Props = {
  text: string;
  paths: readonly string[];
  /** The note being read, so relative links and `[[#Heading]]` resolve from
   *  it. Optional: without it, links resolve from the vault root. */
  sourcePath?: string;
  /** A tap on a link; `subpath` is its `#Heading` or `#^block`, if any. */
  onOpenNote: (path: string, isNew: boolean, subpath?: string) => void;
  /** Scroll here once rendered. Pass it once the note's text is loaded. */
  anchor?: VaultAnchor;
  /** A one-line notice for the app's toast: a missing scroll target, a PDF
   *  that would not open. */
  onNotice?: (message: string) => void;
  /** Reads a note's text for `![[Note]]` (the store's `vaultReadBody`).
   *  Without it an embed is a link chip. Keep it stable across renders. */
  readEmbed?: (path: string) => Promise<string | undefined>;
  /** Attachment bytes for images and PDFs. Without it they show as chips. */
  media?: VaultMedia;
  /** A tick on a task line: its zero-based line in the whole note
   *  (frontmatter counted) and the state the person asked for. The box flips
   *  at once; answer `false` (or throw) and it flips back to the file's
   *  truth. Without it, boxes show and do not tick. */
  onToggleTask?: (line: number, checked: boolean) => void | boolean | Promise<void | boolean>;
  /** Boxes are shown `aria-disabled` (a lease, Your computer away, Drive). */
  tasksReadOnly?: boolean;
  /** A tap on a `#tag`: the room searches `tag:x` (CX X2). Without it a tag
   *  shows as plain styled text. */
  onTag?: (tag: string) => void;
  /** How deep inside note embeds this reader sits (0 for the note). */
  depth?: number;
};

/** A note, read. Anything in the body that still trips the renderer falls
 *  back to the plain text inside this block, never a blank app (0.10). */
export function VaultMarkdown(props: Props) {
  return (
    <ErrorBoundary
      resetKey={props.text}
      fallback={() => (
        <div className="vault-md">
          <p className="hint">
            This note could not be shown formatted, so here it is as plain text.
          </p>
          <pre className="vault-raw">{props.text}</pre>
        </div>
      )}
    >
      <VaultMarkdownBody {...props} />
    </ErrorBoundary>
  );
}

// ------------------------------------------------------------------ context

interface Reader {
  paths: readonly string[];
  sourcePath?: string;
  depth: number;
  open: (path: string, isNew: boolean, subpath?: string) => void;
  onNotice?: (message: string) => void;
  readEmbed?: (path: string) => Promise<string | undefined>;
  media?: VaultMedia;
  onToggleTask?: Props['onToggleTask'];
  tasksReadOnly?: boolean;
  onTag?: (tag: string) => void;
  zoom?: (image: ZoomedImage) => void;
}

const ReaderContext = createContext<Reader>({
  paths: [],
  depth: 0,
  open: () => {},
});

type ElementProps = Record<string, unknown> & { children?: ReactNode };

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

// ----------------------------------------------------------------- callouts

const FAMILIES: readonly CalloutFamily[] = ['neutral', 'positive', 'caution', 'danger'];

const CalloutContext = createContext<{
  family: CalloutFamily;
  foldable: boolean;
  open: boolean;
  bodyId: string;
  toggle: () => void;
}>({ family: 'neutral', foldable: false, open: true, bodyId: '', toggle: () => {} });

function CalloutGlyph({ family }: { family: CalloutFamily }) {
  const mark =
    family === 'positive'
      ? 'M7.5 12.3l3 3 6-6.6'
      : family === 'caution'
        ? 'M12 6.75v6.3M12 16.8v.45'
        : family === 'danger'
          ? 'M8.7 8.7l6.6 6.6M15.3 8.7l-6.6 6.6'
          : 'M12 10.95v6M12 7.2v.45';
  return (
    <Icon className="vault-callout-glyph" size={16}>
      <circle cx="12" cy="12" r="9.5" />
      <path d={mark} />
    </Icon>
  );
}

function Callout(props: ElementProps) {
  const raw = str(props['data-family']) as CalloutFamily | undefined;
  const family = raw && FAMILIES.includes(raw) ? raw : 'neutral';
  const fold = str(props['data-fold']);
  const foldable = fold === '-' || fold === '+';
  const [open, setOpen] = useState(fold !== '-');
  const bodyId = useId();
  return (
    <CalloutContext.Provider
      value={{ family, foldable, open, bodyId, toggle: () => setOpen((o) => !o) }}
    >
      <div className={`vault-callout vault-callout--${family}`}>{props.children}</div>
    </CalloutContext.Provider>
  );
}

function CalloutTitle({ children }: ElementProps) {
  const c = useContext(CalloutContext);
  if (!c.foldable) {
    return (
      <div className="vault-callout-title">
        <CalloutGlyph family={c.family} />
        <span className="vault-callout-title-text">{children}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="vault-callout-title vault-callout-toggle press-fb"
      aria-expanded={c.open}
      aria-controls={c.bodyId}
      onClick={c.toggle}
    >
      <CalloutGlyph family={c.family} />
      <span className="vault-callout-title-text">{children}</span>
      <Icon className="vault-callout-chevron" size={14}>
        <path d="M9 6l6 6-6 6" />
      </Icon>
    </button>
  );
}

function CalloutBody({ children }: ElementProps) {
  const c = useContext(CalloutContext);
  // Folded, the body is hidden, not unmounted, so a reopen fades it back in
  // (opacity and transform on --dur-3) and the layout change is not tweened.
  return (
    <div id={c.bodyId} className="vault-callout-body" hidden={c.foldable && !c.open}>
      {children}
    </div>
  );
}

// -------------------------------------------------------------------- tasks

function TaskLine(props: ElementProps) {
  const reader = useContext(ReaderContext);
  const line = Number(props['data-line']);
  const checked = str(props['data-checked']) === 'true';
  // The person's tick shows at once; the file's truth replaces it when the
  // text comes back (a new `checked`), or at once on a refusal.
  const [pending, setPending] = useState<boolean | null>(null);
  useEffect(() => setPending(null), [checked]);
  const shown = pending ?? checked;
  const disabled = !reader.onToggleTask || Boolean(reader.tasksReadOnly);
  const onChange = (e: ChangeEvent<HTMLInputElement>): void => {
    if (disabled || !reader.onToggleTask || !Number.isFinite(line)) return;
    const next = e.target.checked;
    setPending(next);
    hapticTick();
    let answer: ReturnType<NonNullable<Props['onToggleTask']>>;
    try {
      answer = reader.onToggleTask(line, next);
    } catch {
      answer = false;
    }
    void Promise.resolve(answer).then(
      (ok) => {
        if (ok === false) setPending(null);
      },
      () => setPending(null),
    );
  };
  return (
    <label className={`vault-task press-fb press-fb--row${shown ? ' vault-task--done' : ''}`}>
      <input
        type="checkbox"
        className="vault-task-box"
        checked={shown}
        aria-disabled={disabled || undefined}
        onChange={onChange}
      />
      <span className="vault-task-text">{props.children}</span>
    </label>
  );
}

// --------------------------------------------------------------------- tags

/** A `#tag` in the text: a small tap that searches `tag:x` (CX X2). */
function Tag(props: ElementProps) {
  const reader = useContext(ReaderContext);
  const tag = str(props['data-tag']) ?? '';
  if (!reader.onTag || !tag) return <span className="vault-tag">{props.children}</span>;
  const onTag = reader.onTag;
  return (
    <button type="button" className="vault-tag press-fb" onClick={() => onTag(tag)}>
      {props.children}
    </button>
  );
}

// ------------------------------------------------------------------- embeds

function Embed(props: ElementProps) {
  const reader = useContext(ReaderContext);
  const kind = str(props['data-kind']);
  const path = str(props['data-path']);
  const sub = str(props['data-sub']);
  const title = str(props['data-title']) ?? '';
  const name = str(props['data-name']) ?? '';
  const openIt = () => {
    if (path) reader.open(path, false, sub);
  };
  switch (kind) {
    case 'note':
      return path ? (
        <VaultEmbed
          path={path}
          subpath={sub}
          title={title}
          readBody={reader.readEmbed}
          onOpen={openIt}
          renderBody={(text) => (
            <VaultMarkdown
              text={text}
              paths={reader.paths}
              sourcePath={path}
              onOpenNote={reader.open}
              onNotice={reader.onNotice}
              media={reader.media}
              onTag={reader.onTag}
              depth={reader.depth + 1}
            />
          )}
        />
      ) : null;
    case 'nested':
      return <VaultEmbedChip title={title} onOpen={openIt} />;
    case 'missing':
      return (
        <span className="vault-chip vault-chip--missing">
          <span className="vault-chip-text">
            <span className="vault-chip-name">{vaultReaderCopy.embedMissing(title)}</span>
          </span>
        </span>
      );
    case 'image':
    case 'pdf': {
      const width = Number(props['data-width']);
      return (
        <VaultAttachment
          kind={kind}
          path={path}
          name={name}
          alt={str(props['data-alt'])}
          width={Number.isFinite(width) && width > 0 ? width : undefined}
          media={reader.media}
          onNotice={reader.onNotice}
          onZoom={reader.zoom}
        />
      );
    }
    case 'remote': {
      // Never fetched: a teammate's or a clone's note must not beacon. The
      // link opens outside the app like any other web link.
      const url = str(props['data-url']) ?? '';
      if (!/^https?:\/\//i.test(url)) return null;
      return (
        <a
          className="vault-chip vault-chip--link press-fb"
          href={url}
          target="_blank"
          rel="noreferrer noopener"
        >
          <span className="vault-chip-text">
            <span className="vault-chip-name">{str(props['data-alt']) ?? url}</span>
          </span>
        </a>
      );
    }
    default:
      return (
        <span className="vault-chip">
          <span className="vault-chip-text">
            <span className="vault-chip-name">{name}</span>
            <span className="vault-chip-sub">{vaultReaderCopy.otherFile}</span>
          </span>
        </span>
      );
  }
}

// -------------------------------------------------------------------- links

function Anchor({ href, children }: { href?: string; children?: ReactNode }) {
  const reader = useContext(ReaderContext);
  if (href?.startsWith('vault:')) {
    const isNew = hrefParts(href).path.endsWith('?new');
    const path = vaultHrefPath(href);
    const sub = vaultHrefSubpath(href);
    return (
      <a
        href={href}
        className={`wikilink${isNew ? ' unresolved' : ''}`}
        onClick={(e) => {
          e.preventDefault();
          reader.open(path, isNew, sub);
        }}
      >
        {children}
      </a>
    );
  }
  // A markdown link to a note in this vault opens it here.
  const hash = href?.indexOf('#') ?? -1;
  const dest = href && hash >= 0 ? href.slice(0, hash) : href;
  const sub = href && hash >= 0 ? safeDecode(href.slice(hash + 1)) : undefined;
  const note = dest
    ? resolveMarkdownLink(dest, reader.sourcePath ?? '', pathIndexOf(reader.paths))
    : undefined;
  if (note) {
    return (
      <a
        href={href}
        className="wikilink"
        onClick={(e) => {
          e.preventDefault();
          reader.open(note, false, sub || undefined);
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

// Custom element names the plugins emit (`vault-callout` and the rest) reach
// these by name; react-markdown's type lists only HTML tags.
const COMPONENTS = {
  a: ({ href, children }) => <Anchor href={href}>{children}</Anchor>,
  pre: ({ children }) => <CodeBlock canRun={false}>{children}</CodeBlock>,
  // Every image the note names became a `vault-embed`; anything left (an
  // `![alt][ref]` reference) shows its alt text and never loads.
  img: ({ alt }) => (alt ? <span className="vault-chip">{alt}</span> : null),
  'vault-callout': Callout,
  'vault-callout-title': CalloutTitle,
  'vault-callout-body': CalloutBody,
  'vault-task': TaskLine,
  'vault-embed': Embed,
  'vault-tag': Tag,
} as Components;

// --------------------------------------------------------------- scroll-to

const fold = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** The element a subpath names in this reader, outside any embed. */
function findTarget(root: HTMLElement, subpath: string): HTMLElement | undefined {
  const inEmbed = (el: Element) => el.closest('.vault-embed') !== null;
  if (subpath.startsWith('^')) {
    const id = subpath.slice(1);
    const blocks = [...root.querySelectorAll<HTMLElement>('[data-block]')];
    return blocks.find((el) => el.dataset.block === id && !inEmbed(el));
  }
  const want = fold(subpath.split('#').filter(Boolean).pop() ?? subpath);
  const heads = [...root.querySelectorAll<HTMLElement>('[data-heading-index]')];
  return heads.find((el) => !inEmbed(el) && fold(el.textContent ?? '') === want);
}

function landOn(el: HTMLElement): void {
  el.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus?.({ preventScroll: true });
  el.classList.add('vault-landed');
  setTimeout(() => el.classList.remove('vault-landed'), durationMs('--dur-6', 420) + 40);
}

// --------------------------------------------------------------------- body

function VaultMarkdownBody({
  text,
  paths,
  sourcePath,
  onOpenNote,
  anchor,
  onNotice,
  readEmbed,
  media,
  onToggleTask,
  tasksReadOnly,
  onTag,
  depth = 0,
}: Props) {
  // An embedded body (depth 1) is already cut below its frontmatter.
  const fm = useMemo(() => (depth > 0 ? null : readFrontmatter(text)), [text, depth]);
  const start = fm && fm.end > 0 ? fm.end : 0;
  // Comments go before the parse; a note with none never pays for it.
  const body = useMemo(() => {
    const shown = text.includes('%%') ? maskComments(text) : text;
    return start > 0 ? shown.slice(start) : shown;
  }, [text, start]);
  const lineOffset = useMemo(() => {
    let n = 0;
    for (let i = 0; i < start; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
  }, [text, start]);
  const blockIds = useMemo(
    () =>
      body.includes('^') ? scanNote(body).blockIds.map((b) => ({ id: b.id, line: b.line })) : [],
    [body],
  );
  const attachments = useMemo(() => media?.attachments.map((a) => a.path), [media?.attachments]);
  const plugins = useMemo<Options['remarkPlugins']>(
    () => [
      remarkGfm,
      [
        remarkWikilinks,
        { paths, sourcePath, attachments, attachmentFolder: media?.attachmentFolder, depth },
      ],
      [remarkObsidian, { blockIds, lineOffset }],
    ],
    [paths, sourcePath, attachments, media?.attachmentFolder, depth, blockIds, lineOffset],
  );
  const [zoomed, setZoomed] = useState<ZoomedImage | null>(null);
  const reader = useMemo<Reader>(
    () => ({
      zoom: setZoomed,
      paths,
      sourcePath,
      depth,
      open: onOpenNote,
      onNotice,
      readEmbed,
      media,
      onToggleTask,
      tasksReadOnly,
      onTag,
    }),
    [
      paths,
      sourcePath,
      depth,
      onOpenNote,
      onNotice,
      readEmbed,
      media,
      onToggleTask,
      tasksReadOnly,
      onTag,
    ],
  );

  const root = useRef<HTMLDivElement>(null);
  const landed = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!anchor || landed.current === anchor.key || !root.current) return;
    landed.current = anchor.key;
    const el = findTarget(root.current, anchor.subpath);
    if (el) landOn(el);
    else {
      const note = sourcePath ? noteTitle(sourcePath) : '';
      onNotice?.(vaultReaderCopy.anchorMissing(anchor.subpath, note));
    }
  }, [anchor, text, sourcePath, onNotice]);

  return (
    <div ref={root} className="md vault-md">
      {fm ? (
        <VaultProperties fm={fm} paths={paths} sourcePath={sourcePath} onOpenNote={onOpenNote} />
      ) : null}
      <ReaderContext.Provider value={reader}>
        <ReactMarkdown
          remarkPlugins={plugins}
          rehypePlugins={[rehypeHighlight]}
          urlTransform={vaultUrlTransform}
          components={COMPONENTS}
        >
          {body}
        </ReactMarkdown>
      </ReaderContext.Provider>
      <VaultImageSheet image={zoomed} onClose={() => setZoomed(null)} />
    </div>
  );
}
