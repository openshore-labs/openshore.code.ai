// Documents in the composer. A PDF, a Word, Excel or PowerPoint file, an
// OpenDocument file or an RTF is read on this device and folds into the chat
// as its text, named after the file, so any model can read it, a small local
// one included. Nothing is uploaded to read it: the Office and OpenDocument
// formats are zip archives of XML, opened here with the platform's own
// DecompressionStream, and a PDF is read by pdf.js (lib/pdfText.ts, loaded on
// the first PDF). Any other file (a zip, an audio file, a binary) is attached
// by name, type and size, so a model knows it is there and never sees bytes it
// cannot read.

/** The kinds of document read as text. */
export type DocumentKind = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'odt' | 'ods' | 'odp' | 'rtf';

/** What reading a document gave: its text, and how much of it there was. */
export interface DocumentText {
  text: string;
  /** Pages for a PDF, slides for a deck, sheets for a workbook. */
  parts?: { count: number; noun: 'page' | 'slide' | 'sheet' };
  /** True when the text was cut at DOCUMENT_TEXT_MAX. */
  truncated: boolean;
}

/** The most text one document adds to a message. Past it the text is cut and
 *  the cut said, so a 400-page manual never floods a small model's window. */
export const DOCUMENT_TEXT_MAX = 200_000;

/** The largest document read on the device. */
export const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

const KIND_BY_EXT: Record<string, DocumentKind> = {
  pdf: 'pdf',
  docx: 'docx',
  docm: 'docx',
  dotx: 'docx',
  xlsx: 'xlsx',
  xlsm: 'xlsx',
  pptx: 'pptx',
  pptm: 'pptx',
  odt: 'odt',
  ods: 'ods',
  odp: 'odp',
  rtf: 'rtf',
};

const KIND_BY_MIME: Record<string, DocumentKind> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
};

/** The plain name of each kind, for the chip and the model's note. */
export const KIND_LABEL: Record<DocumentKind, string> = {
  pdf: 'PDF',
  docx: 'Word document',
  xlsx: 'Excel workbook',
  pptx: 'PowerPoint deck',
  odt: 'OpenDocument text',
  ods: 'OpenDocument spreadsheet',
  odp: 'OpenDocument presentation',
  rtf: 'Rich text',
};

/** Which document is this, by MIME first and then the extension (the iOS
 *  Files picker sometimes hands over a blank type). Undefined for anything
 *  that is not a document read here. */
export function documentKind(file: { type?: string; name?: string }): DocumentKind | undefined {
  const byMime = file.type ? KIND_BY_MIME[file.type.toLowerCase()] : undefined;
  if (byMime) return byMime;
  const ext = /\.([a-z0-9]+)$/i.exec(file.name ?? '')?.[1]?.toLowerCase();
  return ext ? KIND_BY_EXT[ext] : undefined;
}

/** Cut text at DOCUMENT_TEXT_MAX and tidy its blank runs. */
export function capText(raw: string, parts?: DocumentText['parts']): DocumentText {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const truncated = text.length > DOCUMENT_TEXT_MAX;
  return { text: truncated ? text.slice(0, DOCUMENT_TEXT_MAX) : text, parts, truncated };
}

/** The text a document adds to the message: what it is, then its text in a
 *  fence no line of it can close. */
export function documentBlock(name: string, kind: DocumentKind, doc: DocumentText): string {
  const facts = [KIND_LABEL[kind]];
  if (doc.parts) facts.push(countLabel(doc.parts.count, doc.parts.noun));
  const longest = Math.max(2, ...Array.from(doc.text.matchAll(/`+/g), (m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  const cut = doc.truncated
    ? `\n(Only the first ${DOCUMENT_TEXT_MAX.toLocaleString('en-US')} characters are included.)`
    : '';
  return `${name} (${facts.join(', ')}):\n${fence}\n${doc.text}\n${fence}${cut}`;
}

/** A file read neither as text nor as a document: named, with its type and
 *  size, so the model knows it is there and says so rather than guessing. */
export function fileNoteBlock(file: { name: string; type?: string; size: number }): string {
  const type = file.type || 'unknown type';
  return (
    `Attached file: ${file.name} (${type}, ${sizeLabel(file.size)}). ` +
    'Its contents could not be read as text on this device, so only its name, type and size are included.'
  );
}

export function countLabel(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
