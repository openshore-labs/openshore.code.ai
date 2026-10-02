// Slack Water's floor (components/SlackWater.tsx, docs/slack-water.md): one
// picture of the app as it is on screen, so the onboarding ripple can bend the
// app's own words and buttons the way a pond bends what lies under it. A page
// cannot read its own pixels, so the picture comes from the shell: WebKit's
// snapshot on iOS (ShellViewController in ios/App/App/SceneDelegate.swift),
// the window's capturePage on the desktop. The plain web has neither and gets
// undefined, and the water falls back to moving the room's blocks instead.
// The picture stays in memory for that one transition; nothing saves or
// sends it.
import { registerPlugin } from '@capacitor/core';
import { bridge } from './electronBridge.js';
import { isDesktop, isPhone } from './platform.js';

interface OscodeSnapshotContract {
  capture(): Promise<{ dataUrl: string }>;
}

const OscodeSnapshot = registerPlugin<OscodeSnapshotContract>('OscodeSnapshot');

/** The screen as a decoded image, or undefined when this shell cannot picture
 *  it or does not answer within `waitMs`. */
export async function captureScreen(waitMs: number): Promise<HTMLImageElement | undefined> {
  const take = async (): Promise<string | undefined> => {
    if (isDesktop()) return (await bridge()?.snapshot?.()) ?? undefined;
    if (isPhone()) return (await OscodeSnapshot.capture()).dataUrl;
    return undefined;
  };
  const late = new Promise<undefined>((resolve) => window.setTimeout(resolve, waitMs));
  try {
    const url = await Promise.race([take(), late]);
    if (!url) return undefined;
    const img = new Image();
    img.src = url;
    const decoded = await Promise.race([img.decode().then(() => true), late.then(() => false)]);
    return decoded ? img : undefined;
  } catch {
    return undefined;
  }
}
