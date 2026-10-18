// Pasting a screenshot into the composer on the iPhone: WebKit never offers
// Paste for an image in a text field, so the shell's web view does, while the
// composer is focused, and hands the images to the composer as files.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pastedImageFile } from '../src/lib/nativePaste';

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

describe('pastedImageFile', () => {
  it('turns a pasted JPEG into a named image file the composer takes', async () => {
    const file = pastedImageFile('data:image/jpeg;base64,/9j/AAEC')!;
    expect(file.type).toBe('image/jpeg');
    expect(file.name).toMatch(/^Pasted image \d+\.jpg$/);
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([0xff, 0xd8, 0xff, 0, 1, 2]);
    const next = pastedImageFile('data:image/png;base64,iVBO')!;
    expect(next.name).toMatch(/\.png$/);
    expect(next.name).not.toBe(file.name);
  });

  it('turns away anything that is not a base64 data URL', () => {
    expect(pastedImageFile('https://example.invalid/a.png')).toBeUndefined();
  });
});

describe('the iOS shell pastes images into the composer', () => {
  const shell = read('ios', 'App', 'App', 'SceneDelegate.swift');

  it('builds its own web view, offering Paste for images only while the composer is focused', () => {
    expect(shell).toMatch(/override func webView\(with frame: CGRect.*\n\s*return ShellWebView\(/);
    expect(shell).toMatch(/composerFocused && board\.hasImages && !board\.hasStrings/);
    expect(shell).toMatch(/override func paste\(_ sender: Any\?\)[\s\S]*?super\.paste\(sender\)/);
    expect(shell).toMatch(/registerPluginInstance\(OscodePastePlugin\(\)\)/);
  });

  it('the composer says when it is the target and takes what arrives as files', () => {
    const composer = read('src', 'components', 'Composer.tsx');
    expect(composer).toMatch(/setPasteTarget\(focused\)/);
    expect(composer).toMatch(/onPastedImages\(\(files\) =>[\s\S]*?addFilesRef\.current\(files\)/);
  });
});
