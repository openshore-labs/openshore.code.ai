// osc attach-image: drop an image into the vision inbox. The next session
// turn can analyze it (analyzeImage tool); the watched inbox at
// ~/.os-code/inbox/ does the same for files that arrive over scp.
import { t } from '../brand/theme.js';
import { attachImage, inboxDir, listInbox } from '../context/vision/ingest.js';
import { okLine, out, warnLine } from './util.js';

export async function attachImageCommand(path?: string): Promise<void> {
  if (!path) {
    const images = listInbox();
    if (!images.length) {
      out(
        t.muted(
          `The inbox (${inboxDir()}) is empty. osc attach-image <path> adds a screenshot; anything copied into the folder works too.`,
        ),
      );
      return;
    }
    out(t.text(`In the inbox (newest first):`));
    for (const image of images.slice(0, 10)) {
      out(
        `  ${t.text(image.name)} ${t.muted(image.addedAt.toISOString().slice(0, 16).replace('T', ' '))}`,
      );
    }
    return;
  }
  try {
    const image = attachImage(path);
    okLine(`${image.name} is in the inbox.`);
    out(
      t.muted(
        `  In a session, ask about it: "look at ${image.path} and tell me what broke". The vision specialist reads it (enable one with osc market if you have not).`,
      ),
    );
  } catch (err) {
    warnLine((err as Error).message);
    process.exitCode = 1;
  }
}
