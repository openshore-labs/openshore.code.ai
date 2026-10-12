// A note's properties (its YAML frontmatter), shown as a quiet strip above the
// body in reading mode (Vault M3, tech review H2). Closed by default, and absent when
// the note has none. Read-only: the editor keeps editing the whole raw text,
// so nothing here ever writes YAML back, and the bytes stay as written.
//
// Tags show as chips, wikilinks inside a value are tappable like the body's,
// and a list reads inline. A block the core could not read (invalid YAML, a
// duplicate key, or over 64 KB) says so, and shows the block as written.
import { Fragment, useState, type ReactNode } from 'react';
import { scanInlineLinks, type FmValue, type Frontmatter } from 'os-code/protocol';
import { vaultHref, wikilinkDestination, wikilinkLabel } from '../lib/remarkWikilinks.js';
import { ChevronGlyph } from './SheetGlyphs.js';

type Props = {
  fm: Frontmatter;
  paths: readonly string[];
  sourcePath?: string;
  onOpenNote: (path: string, isNew: boolean) => void;
};

/** Whether the strip shows at all: a block that is there and either has
 *  properties or could not be read. */
export function hasProperties(fm: Frontmatter): boolean {
  if (fm.state === 'none') return false;
  if (fm.state === 'ok') return fm.props.length > 0;
  return true;
}

/** A tags value's tags, as chips show them: a list, or a comma or space
 *  separated string, each without its leading "#". */
export function tagsOf(v: FmValue): string[] {
  const items = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/) : [];
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string' && typeof item !== 'number') continue;
    const tag = String(item).replace(/^#+/, '').trim();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

export function VaultProperties({ fm, paths, sourcePath, onOpenNote }: Props) {
  const [open, setOpen] = useState(false);
  // Mount the body on the first open and keep it, so the reveal plays both
  // ways on grid rows (the ThinkingBlock pattern), never a snap mount. The
  // first open lands a frame after the mount so the rows have a closed state
  // to grow from.
  const [everOpen, setEverOpen] = useState(false);
  if (!hasProperties(fm)) return null;
  const unreadable = fm.state !== 'ok';

  const toggle = () => {
    if (!everOpen) {
      setEverOpen(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
      return;
    }
    setOpen((o) => !o);
  };

  const link = (target: string, label: string, key: string | number): ReactNode => {
    const dest = wikilinkDestination(target, paths, sourcePath);
    if (!dest) return <Fragment key={key}>{label}</Fragment>;
    return (
      <a
        key={key}
        href={vaultHref(dest)}
        className={`wikilink${dest.isNew ? ' unresolved' : ''}`}
        onClick={(e) => {
          e.preventDefault();
          onOpenNote(dest.path, dest.isNew);
        }}
      >
        {label}
      </a>
    );
  };

  // A string value, with its wikilinks made tappable.
  const text = (s: string): ReactNode => {
    const links = scanInlineLinks(s).filter((l) => l.kind === 'wiki' && !l.embed);
    if (links.length === 0) return s;
    const out: ReactNode[] = [];
    let at = 0;
    links.forEach((l, i) => {
      if (l.start > at) out.push(s.slice(at, l.start));
      out.push(link(l.target, wikilinkLabel(l), i));
      at = l.end;
    });
    if (at < s.length) out.push(s.slice(at));
    return out;
  };

  const value = (v: FmValue): ReactNode => {
    if (v === null) return <span className="vault-props-empty">Empty</span>;
    if (typeof v === 'string') return text(v);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) {
      if (v.length === 0) return <span className="vault-props-empty">Empty</span>;
      return v.map((item, i) => (
        <Fragment key={i}>
          {i > 0 ? ', ' : null}
          {value(item)}
        </Fragment>
      ));
    }
    const entries = Object.keys(v);
    if (entries.length === 0) return <span className="vault-props-empty">Empty</span>;
    return entries.map((k, i) => (
      <Fragment key={k}>
        {i > 0 ? '; ' : null}
        <span className="vault-props-subkey">{k}:</span> {value(v[k]!)}
      </Fragment>
    ));
  };

  const isTagKey = (key: string) => /^tags?$/i.test(key);
  const count = fm.props.length;
  const label = unreadable
    ? 'Properties could not be read'
    : `${count} ${count === 1 ? 'property' : 'properties'}`;

  return (
    <div className={`vault-props${open ? ' open' : ''}${unreadable ? ' unreadable' : ''}`}>
      <button
        type="button"
        className="vault-props-head press-fb press-fb--row"
        onClick={toggle}
        aria-expanded={open}
      >
        <span className="vault-props-label">{label}</span>
        <span className="vault-props-chevron" aria-hidden="true">
          <ChevronGlyph dir="down" size={12} />
        </span>
      </button>
      {everOpen ? (
        <div className={`reveal${open ? ' open' : ''}`} aria-hidden={!open}>
          <div className="reveal-inner">
            {unreadable ? (
              <pre className="vault-props-raw">{fm.raw}</pre>
            ) : (
              <dl className="vault-props-list">
                {fm.props.map((p) => (
                  <div className="vault-props-row" key={p.key}>
                    <dt className="vault-props-key">{p.key}</dt>
                    <dd className="vault-props-value">
                      {isTagKey(p.key) && tagsOf(p.value).length > 0
                        ? tagsOf(p.value).map((t) => (
                            <span className="vault-props-chip" key={t}>
                              #{t}
                            </span>
                          ))
                        : value(p.value)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
