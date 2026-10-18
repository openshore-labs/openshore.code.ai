// Pasting a picture into the composer on the iPhone and the iPad. WebKit
// offers Paste in a text field only when the clipboard holds text, so a
// copied screenshot never reached the page's paste event. The shell's web
// view (ShellWebView in ios/App/App/SceneDelegate.swift) offers Paste while
// the composer says it is focused and the clipboard holds only images, and
// hands each one over as a JPEG data URL; the composer folds them in as files,
// through the same path a picked photo takes. The desktop and the web paste
// images through the page's own paste event and need none of this.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isPhone } from './platform.js';

interface OscodePasteContract {
  setTarget(opts: { on: boolean }): Promise<void>;
  addListener(
    event: 'images',
    fn: (data: { dataUrls: string[] }) => void,
  ): Promise<PluginListenerHandle>;
}

const OscodePaste = registerPlugin<OscodePasteContract>('OscodePaste');

/** Tell the shell whether the composer is the field a pasted image goes to. */
export function setPasteTarget(on: boolean): void {
  if (!isPhone()) return;
  void OscodePaste.setTarget({ on }).catch(() => undefined);
}

let pasteSeq = 0;

/** A pasted image's data URL as a File the composer takes like any other. */
export function pastedImageFile(dataUrl: string): File | undefined {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return undefined;
  const bin = atob(match[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const ext = match[1] === 'image/png' ? 'png' : 'jpg';
  pasteSeq += 1;
  return new File([bytes], `Pasted image ${pasteSeq}.${ext}`, { type: match[1] });
}

/** Listen for images pasted through the shell. Returns the unsubscribe. */
export function onPastedImages(fn: (files: File[]) => void): () => void {
  if (!isPhone()) return () => undefined;
  let handle: PluginListenerHandle | undefined;
  let gone = false;
  void OscodePaste.addListener('images', ({ dataUrls }) => {
    const files = (dataUrls ?? []).map(pastedImageFile).filter((f): f is File => Boolean(f));
    if (files.length) fn(files);
  })
    .then((h) => {
      if (gone) void h.remove();
      else handle = h;
    })
    .catch(() => undefined);
  return () => {
    gone = true;
    void handle?.remove();
  };
}
