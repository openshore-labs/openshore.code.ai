// A real switch, the iOS shape: off is an outlined track, on fills with the
// accent (D21, 2026-10-07), and the knob slides on transform. Answers the
// finger with a tick. Never a pill that says "On".

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The accessible name, since the visible label sits in the row. */
  label: string;
  /** Not available yet (e.g. a key it depends on is not connected). Reads dim
   *  and does not answer the finger. */
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      className={`switch press-fb${checked ? ' on' : ''}`}
      onClick={() => {
        if (disabled) return;
        onChange(!checked);
      }}
    >
      <span className="switch-knob" aria-hidden="true" />
    </button>
  );
}
