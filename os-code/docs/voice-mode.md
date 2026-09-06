# Voice mode

A spoken conversation over the same chat you code in, native and offline, with a
premium voice you pick. It is the founder's ask (2026-09-06): "a voice mode like
in Claude, but because it is coding and text based, keep the natural breaks where
a decision or a picker comes up. Leave voice, show the picker, and reopen after
you choose. All of it still lives in the chat as text."

Two things ship together and stay separate:

- **Dictation** (already built, 2026-08-25): the composer mic, push to talk,
  transcribes into the text field. Unchanged.
- **Voice mode** (this build): a full-screen surface you talk to. It listens,
  sends what you say down the normal chat path, speaks the reply, and steps aside
  at the right moments.

## Native and offline, both directions

Voice mode never needs a connection for the voice itself.

- **Listening** reuses the on-device dictation plugin `oscode-speech`
  (SFSpeechRecognizer, `requiresOnDeviceRecognition`), so mic audio stays on the
  phone. On desktop and web it uses the Web Speech API.
- **Speaking** is a new plugin `oscode-tts` (AVSpeechSynthesizer), synthesized on
  the phone, so a reply is spoken with no connection and no audio leaves the
  device. On desktop and web it uses the Web Speech API's `speechSynthesis`.

The model behind the conversation is whatever the chat already uses (an on-device
model is fully offline; a cloud model needs the network for the model, not for the
voice).

### Why not Claude's own voice stack

Claude's voice mode streams to a cloud text-to-speech service with a small curated
set of voices. That is online only, and synthesizing a chosen human voice would
also sit against our own ethics layer's Tier 2 (a real person's voice is gated).
Native system voices avoid both: they are on-device, free, premium (Apple ships
downloadable enhanced and premium neural voices), and generic, so no likeness is
synthesized. A bundled cross-platform neural engine is a clean later seam (the TTS
backend is one interface), not a day-one need.

## Voices

The picker lists the device's installed system voices, best quality first, the way
Claude's picker works but sourced locally. Premium voices download once in the
system settings, then work offline. The chosen voice id and a normalized speaking
rate (0..1, 0.5 natural, one slider that reads the same on both backends) are
device-local settings. Reached from Settings > Voice and from the voice name in
the overlay.

## The natural breaks

Voice mode watches the live thread and, at each pause, consults one policy table
(`app/src/lib/voice/voiceBreaks.ts`, `VOICE_BREAK_POLICY`). The founder's call
(2026-09-06): keep the conversation flowing where it is safe, hand back to the
screen where a choice needs eyes or authorizes something.

| Pause                        | Where it is answered                          |
| ---------------------------- | --------------------------------------------- |
| Clarifying question          | Voice (read out, spoken answer)               |
| Plan proposal                | Voice ("start building" / "change something") |
| Tool / terminal approval     | Screen (exit voice, tap, reopen)              |
| Cloud-spend approval         | Screen (exit voice, tap, reopen)              |
| Stopped turn (retry / model) | Screen (no auto-reopen)                       |

- A **voice** break is read aloud; the spoken answer is matched to an offered
  option (or a plan intent) and sent, else sent as free text. Clarify answers fold
  back into the framing exactly as a typed answer does.
- A **screen** break closes voice, brings up the card (the approval sheet is
  already on screen), and reopens voice once the decision is answered. Reopen is
  keyed on the pending approval clearing. A plan revision and a stopped-turn
  recovery deliberately hand you to the composer without an auto-reopen, since you
  are choosing to work on screen; the voice button reopens it when you want it.

Approvals that resolve silently (Terminal Control on, or a permission mode covers
them) never surface, so voice never narrates a pause that did not happen: the
break is read from the store's `pendingApprovals`, which only holds approvals that
actually surfaced.

## Access inherits the chat

Voice mode gets exactly the access the chat already has (founder, 2026-09-06: "if
access is turned on for the chat, voice control gets the same access"). There is
no separate voice preset or capability toggle. Voice is always available for chat
and dictation, offline; its ability to drive your machine lights up precisely when
the chat's does (Terminal Control on, a paired computer docked), because a
voice-triggered action flows through the very same `send` and approval path a typed
one does.

## The chat is the history

Voice is an input and output layer only. Every spoken turn, yours and the model's,
goes through the same `send()` and driver seam as typing, so it lands in the
transcript as ordinary text. Close voice and the whole conversation is there to
read and continue by hand.

## The turn loop

`app/src/hooks/useVoiceMode.ts` is the wiring; the decisions are the pure, tested
modules under `app/src/lib/voice/`.

- Listen (`Listener`, `stt.ts`) until an utterance finalizes (the backend's final
  result, or a short silence after the last partial), then `send` it.
- Speak the reply as it streams: the store reduces `text-delta` into the trailing
  assistant bubble; the loop reads new complete sentences off it
  (`nextSentenceEnd`), cleans each of markdown (`toSpeakable`, which names a code
  block rather than reading it), and speaks them in order (`Speaker`, `tts.ts`).
- At a pause, `detectVoiceBreak` classifies it and the loop either reads it and
  listens for the answer, or announces it and hands back to the screen.

Listen and speak are mutually exclusive (no echo cancellation is assumed): the mic
is off while a reply is spoken. Tapping the orb interrupts a reply to talk, or
sends what you have said so far. True always-open barge-in is a later refinement.

## Files

- Native: `app/plugins/oscode-tts/` (Package.swift, the AVSpeechSynthesizer Swift
  plugin), registered in `app/package.json` (linked into the iOS build by
  `cap sync ios`, like `oscode-media`).
- JS contract: `app/src/lib/ttsPlugin.ts` (mirrors `speechPlugin.ts`, web mock).
- Pure core (tested in `app/test/voice.test.ts`): `spoken.ts` (speech shaping),
  `voiceBreaks.ts` (the break policy), `tts.ts` and `stt.ts` (backend helpers plus
  `Speaker` / `Listener`).
- Hook: `app/src/hooks/useVoiceMode.ts`. UI: `app/src/components/VoiceMode.tsx`
  (the overlay) and `VoicePicker.tsx` (the voice list, reused in Settings).
- Wiring: a voice button in `Composer.tsx`; the overlay, break-to-screen, and
  reopen in `ChatScreen.tsx`; the settings in `SettingsScreen.tsx`
  (`voiceReplies`, `voiceId`, `voiceRate` on `AppSettings`).

## Needs a device (unverifiable in a web session)

The decision logic is unit tested, but the native speech path, like dictation
itself, is only provable on hardware. On TestFlight: open voice mode in a chat,
speak a request, confirm the reply is spoken in the chosen voice and appears in the
transcript as text; ask something that triggers a clarifying question and answer it
by voice; trigger a tool or cloud-spend approval and confirm voice closes, the
sheet shows, and voice reopens after you tap; change the voice in the picker and
hear the sample; confirm it all works with the network off for an on-device model.
Also confirm `cap sync ios` links the `oscode-tts` plugin.
