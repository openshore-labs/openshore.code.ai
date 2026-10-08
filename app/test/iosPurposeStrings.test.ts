// The iPhone's permission prompts (privacy review, 2026-10-08, ios-server-3).
// iOS shows each purpose string from Info.plist the first time the app asks
// for the camera, the microphone, speech recognition, the photo library, or
// the local network, so each is a privacy claim the person reads, and App
// Review (5.1.1) asks it to describe every use. The camera string once said
// "only to scan the pairing QR code" while the composer's Camera tile took
// photos for a chat. Every string is pinned here, and each one is checked
// against the code that makes it true, so a new use or a new prompt fails
// until its words are. The Photos and Files tiles reach the camera too: on
// iOS a file input that takes video (or any file) offers Take Photo or
// Video, and recording one asks for the microphone, so the camera and
// microphone strings name that use as well (sign-off, 2026-10-08).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

const plist = read('ios', 'App', 'App', 'Info.plist');
const composer = read('src', 'components', 'Composer.tsx');
const qrScanner = read('src', 'components', 'QrScanner.tsx');
const chatScreen = read('src', 'screens', 'ChatScreen.tsx');
const mediaPlugin = read(
  'plugins',
  'oscode-media',
  'ios',
  'Sources',
  'OscodeMediaPlugin',
  'OscodeMediaPlugin.swift',
);
const speechPlugin = read(
  'plugins',
  'oscode-speech',
  'ios',
  'Sources',
  'OscodeSpeechPlugin',
  'OscodeSpeechPlugin.swift',
);

/** Every purpose string in Info.plist, by key. */
function purposeStrings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of plist.matchAll(
    /<key>(NS\w+UsageDescription)<\/key>\s*<string>([^<]*)<\/string>/g,
  )) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

const PINNED: Record<string, string> = {
  NSLocalNetworkUsageDescription:
    'OpenShore connects to your own computer, and to any model server you connect, over your local network or Tailscale.',
  NSCameraUsageDescription:
    'OpenShore uses the camera when you scan the pairing QR code shown on your computer, or take a photo or video to attach to a chat.',
  NSMicrophoneUsageDescription:
    'OpenShore uses the microphone to turn your speech into text when you dictate a message or talk in voice mode. When you record a video for a chat, its sound is never sent.',
  NSPhotoLibraryUsageDescription:
    'OpenShore reads photos, screenshots, and screen recordings you attach so a model can review them. A video is turned into still frames on your device first, and the video itself is never sent.',
  NSSpeechRecognitionUsageDescription:
    'OpenShore turns your speech into text on this device, so you can dictate a message or talk in voice mode. The audio never leaves this device.',
};

describe("the iPhone's purpose strings", () => {
  it('are exactly the pinned words, and a new one is pinned before it ships', () => {
    expect(purposeStrings()).toEqual(PINNED);
  });

  it('the camera string names every use, and never says only while a photo can be taken', () => {
    const camera = purposeStrings().NSCameraUsageDescription!;
    // The composer's Camera tile opens the system camera for a chat photo.
    expect(composer).toMatch(/capture="environment"/);
    expect(camera).not.toMatch(/\bonly\b/i);
    // Its Photos tile takes video, so iOS offers Take Photo or Video there.
    expect(composer).toMatch(/accept="image\/\*,video\/\*"/);
    expect(camera).toMatch(/take a photo or video to attach to a chat/);
    // The pairing scanner opens the camera itself.
    expect(qrScanner).toMatch(/getUserMedia\(\{\s*video:/);
    expect(camera).toMatch(/scan the pairing QR code/);
  });

  it('the microphone and speech strings name dictation and voice mode, both of which listen', () => {
    const { NSMicrophoneUsageDescription: mic, NSSpeechRecognitionUsageDescription: speech } =
      purposeStrings();
    expect(composer).toMatch(/'Dictate'/);
    expect(chatScreen).toMatch(/<VoiceMode\b/);
    for (const line of [mic!, speech!]) {
      expect(line).toMatch(/dictate a message/);
      expect(line).toMatch(/voice mode/);
      expect(line).not.toMatch(/\bonly\b/i);
    }
  });

  it('the microphone string names a video you record for a chat, and its sound is never sent', () => {
    const mic = purposeStrings().NSMicrophoneUsageDescription!;
    // Recording a video from the Photos or Files tile asks for the microphone.
    expect(composer).toMatch(/accept="image\/\*,video\/\*"/);
    expect(mic).toMatch(/When you record a video for a chat, its sound is never sent\./);
    // What is sent is still frames: the plugin answers JPEG stills and drops
    // its working copy, and the composer attaches only the frames.
    expect(mediaPlugin).toMatch(/"frames": frames,/);
    expect(mediaPlugin).toMatch(/removeItem\(at: tempURL\)/);
    expect(composer).toMatch(/setAttachments\(\(prev\) => \[\.\.\.prev, \.\.\.built\.frames\]\)/);
  });

  it('the audio stays on the device only while the plugin forces on-device recognition', () => {
    const speech = purposeStrings().NSSpeechRecognitionUsageDescription!;
    expect(speechPlugin).toMatch(/req\.requiresOnDeviceRecognition = true/);
    expect(speech).toMatch(/never leaves this device/);
    // An iPad runs this build too, so the string never says phone.
    expect(plist).toMatch(/UISupportedInterfaceOrientations~ipad/);
    for (const line of Object.values(purposeStrings())) {
      expect(line, line).not.toMatch(/\b(phone|iPhone|daemon)\b/i);
    }
  });

  it('a video goes as still frames, never itself, as the photos string says', () => {
    expect(composer).toMatch(/buildVideoAttachment\(file,/);
    expect(composer).toMatch(/setAttachments\(\(prev\) => \[\.\.\.prev, \.\.\.built\.frames\]\)/);
    expect(purposeStrings().NSPhotoLibraryUsageDescription).toMatch(
      /the video itself is never sent/,
    );
  });
});
