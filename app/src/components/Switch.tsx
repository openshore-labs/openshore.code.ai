// A real switch, the iOS shape: a track that tints and a knob that slides on
// transform. Answers the finger with a tick. Never a pill that says "On".

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The accessible name, since the visible label sits in the row. */
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch press-fb${checked ? ' on' : ''}`}
      onClick={() => {
        onChange(!checked);
      }}
    >
      <span className="switch-knob" aria-hidden="true" />
    </button>
  );
}
