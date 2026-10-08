// Settings, Writing: your writing voice (lib/writingVoice.ts). An open field
// for the person's own words on how a model should write for them, with a way
// above it to shape one in a chat: a new chat opens with the opening of the
// prompt in the composer, the person finishes it, and a local model hands the
// result back with an Add to Settings button (lib/appActions.ts).
import { useEffect, useState } from 'react';
import { useApp } from '../state/store.js';
import { WRITING_VOICE_MAX, WRITING_VOICE_SUB, cleanWritingVoice } from '../lib/writingVoice.js';

export function WritingVoiceField() {
  const saved = useApp((s) => s.settings.writingVoice) ?? '';
  const saveSettings = useApp((s) => s.saveSettings);
  const showToast = useApp((s) => s.showToast);
  const startWritingVoiceChat = useApp((s) => s.startWritingVoiceChat);
  const [draft, setDraft] = useState(saved);
  const [editing, setEditing] = useState(false);
  // A voice that lands from a chat while this screen is open shows at once,
  // unless the person is mid-edit.
  useEffect(() => {
    if (!editing) setDraft(saved);
  }, [saved, editing]);

  const dirty = (cleanWritingVoice(draft) ?? '') !== (cleanWritingVoice(saved) ?? '');
  const save = async (): Promise<void> => {
    const voice = cleanWritingVoice(draft);
    await saveSettings({ writingVoice: voice });
    setEditing(false);
    showToast(voice ? 'Writing voice saved.' : 'Writing voice cleared.');
  };

  return (
    <div className="settings-block writing-voice">
      <div className="settings-row-text">
        <span className="settings-row-label">Your writing voice</span>
        <span className="settings-row-sub">{WRITING_VOICE_SUB}</span>
      </div>
      <button
        type="button"
        className="writing-voice-shape press-fb"
        onClick={() => startWritingVoiceChat()}
      >
        <span className="writing-voice-shape-text">
          <span className="writing-voice-shape-title">Shape it in a chat</span>
          <span className="writing-voice-shape-sub">
            Describe the style you want. A model on your own device can add the result here for you.
          </span>
        </span>
        <span className="disclosure-chevron" aria-hidden="true" />
      </button>
      {/* The row above names the field, so it carries no second label. */}
      <div className="field">
        <textarea
          id="writing-voice"
          aria-label="Your writing voice"
          rows={4}
          maxLength={WRITING_VOICE_MAX}
          placeholder="e.g. Warm and direct. Short sentences, plain words, no jargon. Sound like a friend explaining over coffee."
          value={draft}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            if (!dirty) setEditing(false);
          }}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>
      {dirty ? (
        <div className="sheet-actions">
          <button type="button" className="btn primary press-fb" onClick={() => void save()}>
            Save
          </button>
          <button
            type="button"
            className="btn quiet press-fb"
            onClick={() => {
              setDraft(saved);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
      ) : saved ? (
        <div className="sheet-actions">
          <button
            type="button"
            className="btn quiet press-fb"
            onClick={() => {
              setDraft('');
              void saveSettings({ writingVoice: undefined }).then(() =>
                showToast('Writing voice cleared.'),
              );
            }}
          >
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}
