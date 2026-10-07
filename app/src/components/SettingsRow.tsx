// The settings ledger: a serif group head over one inset card, rows divided
// by hairlines. A row is a label, an optional sub (it wraps, so a sentence is
// never cut off), an optional value on the right, and either a chevron (it
// opens a sheet) or a trailing control (a switch, a segmented control). A
// danger row asks first, so it carries no chevron: it opens a question, not a
// place. Type carries the hierarchy; there are no icons on purpose. Groups
// arrive staggered on the house tokens.
import type { CSSProperties, ReactNode } from 'react';

export function SettingsGroup({
  id,
  title,
  badge,
  intro,
  index,
  hidden,
  children,
}: {
  /** An anchor another room can land on (the profile's links). */
  id?: string;
  title?: string;
  /** A short uppercase pill after the title (BETA), in the neutral pill style:
   *  not teal (local) and not amber (spend), the word does the work. */
  badge?: string;
  /** One plain sentence under the head, for a group that needs a promise
   *  stated before its rows (what beta means here). */
  intro?: string;
  /** Position on the screen, for the entrance stagger. */
  index: number;
  /** Left out of this build (a group whose rows have nowhere to go). */
  hidden?: boolean;
  children: ReactNode;
}) {
  if (hidden) return null;
  return (
    <section id={id} className="settings-group" style={{ '--i': index } as CSSProperties}>
      {title ? (
        <h2 className="settings-group-head">
          {title}
          {badge ? <span className="pill settings-group-badge">{badge}</span> : null}
        </h2>
      ) : null}
      {intro ? <p className="settings-group-intro">{intro}</p> : null}
      <div className="settings-card">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  sub,
  subTruncate,
  value,
  trailing,
  onClick,
  danger,
  disabled,
}: {
  label: string;
  sub?: ReactNode;
  /** Hold the sub to one line with an ellipsis. Only for a single value
   *  (an email address), never a sentence: a sentence always wraps. */
  subTruncate?: boolean;
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
        {sub ? (
          <span className={`settings-row-sub${subTruncate ? ' truncate' : ''}`}>{sub}</span>
        ) : null}
      </span>
      {value !== undefined ? <span className="settings-row-value">{value}</span> : null}
      {trailing ??
        (onClick && !danger ? <span className="disclosure-chevron" aria-hidden="true" /> : null)}
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
