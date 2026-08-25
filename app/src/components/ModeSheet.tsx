// The permission-mode picker, the same three Claude Code shows: Auto, Accept
// edits, Plan. Opened from the composer's mode pill. Governs how the coding
// agent's tool approvals are handled; inert for plain chat.
import { useApp } from '../state/store.js';
import {
  PERMISSION_MODES,
  permissionModeLabel,
  permissionModeDescription,
  DEFAULT_PERMISSION_MODE,
  type PermissionMode,
} from '../lib/permissionMode.js';

function ModeIcon({ mode }: { mode: PermissionMode }) {
  const common = {
    className: 'mode-icon',
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (mode === 'auto') {
    return (
      <svg {...common}>
        <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
      </svg>
    );
  }
  if (mode === 'acceptEdits') {
    return (
      <svg {...common}>
        <path d="m9 8-4 4 4 4" />
        <path d="m15 8 4 4-4 4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M6 3h9l3 3v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M8.5 9h7M8.5 13h7M8.5 17h4" />
    </svg>
  );
}

export function ModeSheet({ onClose }: { onClose: () => void }) {
  const { settings, saveSettings } = useApp();
  const mode = settings.permissionMode ?? DEFAULT_PERMISSION_MODE;

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet mode-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mode-head">
          <button className="mode-close press-fb" aria-label="Close" onClick={onClose}>
            {'×'}
          </button>
          <h2>Select mode</h2>
        </div>
        <div className="mode-list">
          {PERMISSION_MODES.map((m) => (
            <button
              key={m}
              className={`mode-row press-fb${m === mode ? ' active' : ''}`}
              onClick={() => {
                void saveSettings({ permissionMode: m });
                onClose();
              }}
            >
              <span className={`mode-row-icon mode-${m}`}>
                <ModeIcon mode={m} />
              </span>
              <span className="mode-row-text">
                <span className="mode-row-title">{permissionModeLabel(m)}</span>
                <span className="mode-row-desc">{permissionModeDescription(m)}</span>
              </span>
              {m === mode ? (
                <span className="mode-row-check" aria-hidden="true">
                  {'✓'}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
