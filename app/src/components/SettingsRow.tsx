// The settings ledger: a serif group head over one inset card, rows divided
// by hairlines. A row is a label, an optional one-line sub, an optional value
// on the right, and either a chevron (it opens a sheet) or a trailing control
// (a switch, a segmented control). Type carries the hierarchy; there are no
// icons on purpose. Groups arrive staggered on the house tokens.
import type { CSSProperties, ReactNode } from 'react';

export function SettingsGroup({
  title,
  index,
  children,
}: {
  title?: string;
  /** Position on the screen, for the entrance stagger. */
  index: number;
  children: ReactNode;
}) {
  return (
    <section className="settings-group" style={{ '--i': index } as CSSProperties}>
      {title ? <h2 className="settings-group-head">{title}</h2> : null}
      <div className="settings-card">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  sub,
  subWrap,
  value,
  trailing,
  onClick,
  danger,
  disabled,
}: {
  label: string;
  sub?: ReactNode;
  /** Let the sub wrap to two lines instead of truncating on one. For a full
   *  sentence byline, where the whole line matters. */
  subWrap?: boolean;
  /** A short value on the right (the current choice, a count). */
  value?: ReactNode;
  /** A control on the right instead of a chevron. */
  trailing?: ReactNode;
  /** Present when the row opens something; the row becomes a button. */
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const body = (
    <>
      <span className="settings-row-text">
        <span className="settings-row-label">{label}</span>
        {sub ? <span className={`settings-row-sub${subWrap ? ' wrap' : ''}`}>{sub}</span> : null}
      </span>
      {value !== undefined ? <span className="settings-row-value">{value}</span> : null}
      {trailing ?? (onClick ? <span className="disclosure-chevron" aria-hidden="true" /> : null)}
    </>
  );
  const cls = `settings-row${danger ? ' danger' : ''}`;
  if (onClick) {
    return (
      <button
        type="button"
        className={`${cls} press-fb press-fb--row`}
        onClick={onClick}
        disabled={disabled}
      >
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}
