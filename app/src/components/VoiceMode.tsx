// The voice-mode surface: a calm full-screen overlay you talk to while you code.
// It listens, sends what you say down the normal chat path, speaks the reply, and
// steps aside at the right moments (a plan or a clarifying question it reads and
// takes by voice; authorizing your machine, spending, or picking from a list it
// hands back to the chat, then reopens). All of it still lands in the transcript
// as text, so the chat is the history.
//
// The orb breathes with the turn: listening, thinking, speaking. Tapping it
// interrupts a reply to talk, or sends what you have said. The whole surface is
// presence-aware (it animates out, never snaps), honors reduced motion, and marks
// its open and close with a haptic, per the house motion standard.
import { useEffect, useState } from 'react';
import { useApp } from '../state/store.js';
import { useExitPresence } from '../hooks/useExitPresence.js';
import { doorExitMs } from '../lib/motion.js';
import { hapticApproval } from '../lib/haptics.js';
import { useVoiceMode, type VoicePhase } from '../hooks/useVoiceMode.js';
import type { VoiceBreak } from '../lib/voice/voiceBreaks.js';
import { listVoices, pickDefaultVoice } from '../lib/voice/tts.js';
import { VoicePicker } from './VoicePicker.js';
import { CloseGlyph } from './SheetGlyphs.js';

const PHASE_LABEL: Record<VoicePhase, string> = {
  idle: '',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  suspended: 'One moment',
};

function tapHint(phase: VoicePhase): string {
  if (phase === 'speaking') return 'Tap to interrupt';
  if (phase === 'listening') return 'Tap to send';
  return '';
}

export function VoiceMode({
  open,
  onClose,
  conversationId,
  send,
  approvePlan,
  revisePlan,
  onBreakToScreen,
}: {
  open: boolean;
  onClose: () => void;
  conversationId: string | undefined;
  send: (text: string) => void;
  approvePlan: () => void;
  revisePlan: () => void;
  onBreakToScreen: (brk: VoiceBreak) => void;
}) {
  const { mounted, closing } = useExitPresence(open, doorExitMs());
  const settings = useApp((s) => s.settings);
  const saveSettings = useApp((s) => s.saveSettings);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [voiceName, setVoiceName] = useState<string>('');

  const rate = settings.voiceRate ?? 0.5;
  const speakReplies = settings.voiceReplies !== false;

  const { state, interrupt } = useVoiceMode({
    active: open,
    conversationId,
    send,
    approvePlan,
    revisePlan,
    onBreakToScreen,
    voiceId: settings.voiceId,
    rate,
    speakReplies,
  });

  // Mark the open, and pick a default voice the first time if none is chosen, so
  // the picker always shows a selection and the first reply has a voice.
  useEffect(() => {
    if (!open) return;
    hapticApproval();
    let live = true;
    void listVoices().then((voices) => {
      if (!live) return;
      let id = settings.voiceId;
      if (!id) {
        const def = pickDefaultVoice(
          voices,
          typeof navigator !== 'undefined' ? navigator.language : 'en',
        );
        if (def) {
          id = def.id;
          void saveSettings({ voiceId: def.id });
        }
      }
      setVoiceName(voices.find((v) => v.id === id)?.name ?? '');
    });
    return () => {
      live = false;
    };
    // Only re-run on open; a live voice change updates voiceName via the picker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!mounted) return null;

  const phase = state.phase;

  return (
    <div
      className={`voice-scrim${closing ? ' closing' : ''}`}
      role="dialog"
      aria-label="Voice mode"
    >
      <div className={`voice-panel${closing ? ' closing' : ''}`}>
        <div className="voice-top">
          <button
            type="button"
            className="voice-voice-btn press-fb"
            onClick={() => setPickerOpen(true)}
          >
            {voiceName ? `Voice: ${voiceName}` : 'Choose a voice'}
          </button>
          <button
            type="button"
            className="icon-btn press-fb"
            onClick={onClose}
            aria-label="Close voice mode"
          >
            <CloseGlyph />
          </button>
        </div>

        <div className="voice-stage">
          <button
            type="button"
            className={`voice-orb press-fb voice-orb-${phase}`}
            onClick={interrupt}
            aria-label={PHASE_LABEL[phase] || 'Voice'}
          >
            <span className="voice-orb-core" aria-hidden="true" />
            <span className="voice-orb-ring" aria-hidden="true" />
          </button>
          <div className="voice-phase" aria-live="polite">
            {PHASE_LABEL[phase]}
          </div>
          <p className="voice-caption" aria-live="polite">
            {state.error === 'microphone'
              ? 'Microphone access is off. Turn it on in Settings to talk.'
              : state.error === 'unsupported'
                ? 'Voice input needs the native app. Type in the chat for now.'
                : state.caption}
          </p>
          <div className="voice-hint">{tapHint(phase)}</div>
        </div>

        <p className="voice-foot hint">Everything you say lands in the chat as text.</p>
      </div>

      <VoicePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        selectedId={settings.voiceId}
        rate={rate}
        onSelect={(id) => {
          void saveSettings({ voiceId: id });
          void listVoices().then((voices) =>
            setVoiceName(voices.find((v) => v.id === id)?.name ?? ''),
          );
        }}
      />
    </div>
  );
}
