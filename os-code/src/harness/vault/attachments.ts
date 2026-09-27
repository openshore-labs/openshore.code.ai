// Attachments (Vault M6, CTO K11): which vault files are attachments the Vault
// reads (png, jpg, jpeg, gif, webp, avif, svg, pdf), their type, and how an
// embed or a markdown link finds one (exact path, source-relative, the
// `attachmentFolderPath` setting, then Obsidian's basename order).
//
// Wave 0 stub: the signatures are the contract; stream A2 builds the bodies.
// Pure and import-free past the vault core.

import type { AttachmentFolderSetting, AttachmentMime, VaultPathIndex } from './types.js';

/** The largest attachment `readBytes` hands over, in bytes (K11). The
 *  daemon's `/vault/files` route and every provider share it. */
export const VAULT_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

function notBuilt(name: string): never {
  throw new Error(`not built: ${name} (Vault M6, stream A2)`);
}

/** Whether `path` names an attachment the Vault reads: an allowed extension,
 *  no dot segment, no backslash, not rooted. */
export function isAttachmentPath(_path: string): boolean {
  return notBuilt('isAttachmentPath');
}

/** The type an attachment path names by its extension, or undefined. */
export function attachmentMime(_path: string): AttachmentMime | undefined {
  return notBuilt('attachmentMime');
}

/** Whether the first bytes match the type (the rasters and PDF are checked by
 *  magic bytes; SVG by a text sniff). */
export function bytesMatchMime(_bytes: Uint8Array, _mime: AttachmentMime): boolean {
  return notBuilt('bytesMatchMime');
}

/** The attachment `target` (as written in `source`) names, or undefined.
 *  `attachments` holds the vault's attachment paths. */
export function resolveAttachment(
  _target: string,
  _source: string,
  _attachments: readonly string[] | VaultPathIndex,
  _setting?: AttachmentFolderSetting,
): string | undefined {
  return notBuilt('resolveAttachment');
}
