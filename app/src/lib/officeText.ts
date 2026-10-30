// Reading an Office, OpenDocument or RTF document to text, split from
// lib/documentText.ts so the composer loads it on the first document, never
// at launch (CTO, 2026-10-30, the launch budget). The formats are zip archives
// of XML, opened here with the platform's own DecompressionStream; nothing is
// uploaded to read them.
import { capText, type DocumentKind, type DocumentText } from './documentText.js';

/** Read a document (not a PDF, which lib/pdfText.ts reads) to text. Rejects
 *  when the file is damaged or not what its name says. */
export async function readOfficeText(
  bytes: Uint8Array,
  kind: Exclude<DocumentKind, 'pdf'>,
): Promise<DocumentText> {
  if (kind === 'rtf') return capText(rtfToText(new TextDecoder('latin1').decode(bytes)));
  const zip = readZip(bytes);
  switch (kind) {
    case 'docx':
      return capText(wordXmlToText(await zip.text('word/document.xml')));
    case 'pptx': {
      const slides = zip.names
        .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => numberIn(a) - numberIn(b));
      const out: string[] = [];
      for (const [i, name] of slides.entries()) {
        const body = drawingXmlToText(await zip.text(name));
        out.push(`Slide ${i + 1}\n${body}`.trimEnd());
      }
      return capText(out.join('\n\n'), { count: slides.length, noun: 'slide' });
    }
    case 'xlsx':
      return xlsxToText(zip);
    case 'odt':
    case 'ods':
    case 'odp':
      return capText(odfXmlToText(await zip.text('content.xml')));
  }
}

function numberIn(name: string): number {
  return Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);
}

// ---------------------------------------------------------------------------
// A small zip reader: the central directory, then each entry stored or
// deflated. Enough for Office and OpenDocument files, which use nothing else.

interface ZipEntry {
  method: number;
  compressedSize: number;
  localOffset: number;
}

export interface ZipReader {
  names: string[];
  text(name: string): Promise<string>;
}

export function readZip(bytes: Uint8Array): ZipReader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end of central directory record sits in the last 64 KB plus 22 bytes.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip archive.');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const entries = new Map<string, ZipEntry>();
  const utf8 = new TextDecoder();
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('Damaged zip directory.');
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = utf8.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    entries.set(name, { method, compressedSize, localOffset });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: [...entries.keys()],
    async text(name) {
      const entry = entries.get(name);
      if (!entry) throw new Error(`Missing ${name}.`);
      const lo = entry.localOffset;
      if (view.getUint32(lo, true) !== 0x04034b50) throw new Error('Damaged zip entry.');
      const start = lo + 30 + view.getUint16(lo + 26, true) + view.getUint16(lo + 28, true);
      const raw = bytes.subarray(start, start + entry.compressedSize);
      if (entry.method === 0) return utf8.decode(raw);
      if (entry.method !== 8) throw new Error('Unsupported zip compression.');
      return utf8.decode(await inflateRaw(raw));
    },
  };
}

async function inflateRaw(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([raw as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------------------------------------------------------------------------
// XML to text. The formats are regular enough that a tag scan reads them;
// nothing here builds a DOM, so it runs the same in a worker or a test.

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
    if (ent[0] === '#') {
      const code =
        ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : Number(ent.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[ent.toLowerCase()] ?? whole;
  });
}

/** Walk the tags in order, letting `onTag` turn a tag into text (a break, a
 *  tab) and keeping the character data inside the text runs `keepIn` names. */
function scanXml(
  xml: string,
  keepIn: RegExp,
  onTag: (tag: string, closing: boolean) => string,
): string {
  const out: string[] = [];
  let inText = false;
  const re = /<(\/?)([A-Za-z0-9_:.-]+)[^>]*?(\/?)>|([^<]+)/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[4] !== undefined) {
      if (inText) out.push(decodeXml(m[4]));
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2];
    const selfClosing = m[3] === '/';
    if (keepIn.test(tag)) inText = !closing && !selfClosing;
    out.push(onTag(tag, closing));
  }
  return out.join('');
}

/** Word's body: a paragraph per line, tabs and breaks kept. */
export function wordXmlToText(xml: string): string {
  return scanXml(xml, /^w:(t|delText)$/, (tag, closing) => {
    if (tag === 'w:p' && closing) return '\n';
    if (tag === 'w:tab' && !closing) return '\t';
    if ((tag === 'w:br' || tag === 'w:cr') && !closing) return '\n';
    if (tag === 'w:tc' && closing) return '\t';
    return '';
  });
}

/** A slide's (or a chart's) DrawingML text: a paragraph per line. */
export function drawingXmlToText(xml: string): string {
  return scanXml(xml, /^a:t$/, (tag, closing) => {
    if (tag === 'a:p' && closing) return '\n';
    if (tag === 'a:br' && !closing) return '\n';
    return '';
  });
}

/** OpenDocument's content.xml: paragraphs and headings per line, table cells
 *  by tab, rows by line, spaces and tabs kept. */
export function odfXmlToText(xml: string): string {
  const body = xml.replace(/^[\s\S]*?<office:body[^>]*>/, '');
  const out: string[] = [];
  const re = /<(\/?)([A-Za-z0-9_:.-]+)([^>]*?)(\/?)>|([^<]+)/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (m[5] !== undefined) {
      out.push(decodeXml(m[5]));
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2];
    if (closing && (tag === 'text:p' || tag === 'text:h' || tag === 'table:table-row')) {
      out.push('\n');
    } else if (closing && tag === 'table:table-cell') {
      out.push('\t');
    } else if (!closing && tag === 'text:tab') {
      out.push('\t');
    } else if (!closing && tag === 'text:line-break') {
      out.push('\n');
    } else if (!closing && tag === 'text:s') {
      const n = Number(/text:c="(\d+)"/.exec(m[3])?.[1] ?? 1);
      out.push(' '.repeat(Math.min(n, 64)));
    }
  }
  // A cell run ends each row with a tab; drop it.
  return out.join('').replace(/\t+\n/g, '\n');
}

/** A workbook: each sheet by name, then its rows, cells by tab. */
async function xlsxToText(zip: ZipReader): Promise<DocumentText> {
  const shared: string[] = [];
  if (zip.names.includes('xl/sharedStrings.xml')) {
    const xml = await zip.text('xl/sharedStrings.xml');
    for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(
        Array.from(si[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g), (t) => decodeXml(t[1])).join(
          '',
        ),
      );
    }
  }
  // Sheet names, in workbook order, mapped to their files through the rels.
  const workbook = zip.names.includes('xl/workbook.xml') ? await zip.text('xl/workbook.xml') : '';
  const rels = zip.names.includes('xl/_rels/workbook.xml.rels')
    ? await zip.text('xl/_rels/workbook.xml.rels')
    : '';
  const target = new Map<string, string>();
  for (const r of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(r[0])?.[1];
    const to = /\bTarget="([^"]+)"/.exec(r[0])?.[1];
    if (id && to) target.set(id, to.replace(/^\/?(xl\/)?/, 'xl/'));
  }
  const sheets: { name: string; file: string }[] = [];
  for (const s of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeXml(/\bname="([^"]*)"/.exec(s[0])?.[1] ?? '');
    const rid = /\br:id="([^"]+)"/.exec(s[0])?.[1];
    const file = rid ? target.get(rid) : undefined;
    if (file && zip.names.includes(file)) sheets.push({ name, file });
  }
  if (!sheets.length) {
    for (const file of zip.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))) {
      sheets.push({ name: `Sheet ${numberIn(file)}`, file });
    }
  }
  const out: string[] = [];
  for (const sheet of sheets) {
    const xml = await zip.text(sheet.file);
    const rows: string[] = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const inner = c[2] ?? '';
        const col = columnIndex(/\br="([A-Z]+)\d+"/.exec(attrs)?.[1]);
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let value = '';
        if (type === 's' && v !== undefined) value = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') {
          value = Array.from(inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g), (t) =>
            decodeXml(t[1]),
          ).join('');
        } else if (type === 'b' && v !== undefined) value = v === '1' ? 'TRUE' : 'FALSE';
        else if (v !== undefined) value = decodeXml(v);
        const at = col ?? cells.length;
        while (cells.length < at) cells.push('');
        cells[at] = value.replace(/[\t\n]+/g, ' ');
      }
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.length) rows.push(cells.join('\t'));
    }
    out.push(`Sheet: ${sheet.name}\n${rows.join('\n')}`.trimEnd());
  }
  return capText(out.join('\n\n'), { count: sheets.length, noun: 'sheet' });
}

function columnIndex(letters: string | undefined): number | undefined {
  if (!letters) return undefined;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ---------------------------------------------------------------------------

// RTF's typographic control words. A long dash reads as a spaced hyphen.
const RTF_CHAR: Record<string, string> = {
  lquote: '\u2018',
  rquote: '\u2019',
  ldblquote: '\u201c',
  rdblquote: '\u201d',
  bullet: '\u2022',
  endash: '\u2013',
  emdash: ' - ',
};

/** RTF to text: control words dropped, groups that hold no body text (fonts,
 *  colours, styles, pictures) skipped, escapes decoded. */
export function rtfToText(rtf: string): string {
  const out: string[] = [];
  const skipDepth: number[] = [];
  let depth = 0;
  let uc = 1;
  let skipChars = 0;
  const SKIP =
    /^(fonttbl|colortbl|stylesheet|info|pict|object|header|footer|headerl|headerr|footerl|footerr|themedata|colorschememapping|latentstyles|datastore|xmlnstbl|listtable|listoverridetable|rsidtbl|generator|mmathPr)$/;
  const skipping = () => skipDepth.length > 0;
  const re = /\\([a-z]+)(-?\d+)? ?|\\'([0-9a-f]{2})|\\([^a-z])|([{}])|([^\\{}\r\n]+)|[\r\n]/gi;
  for (let m = re.exec(rtf); m; m = re.exec(rtf)) {
    const [, word, num, hex, sym, brace, text] = m;
    if (brace === '{') {
      depth += 1;
      continue;
    }
    if (brace === '}') {
      if (skipDepth[skipDepth.length - 1] === depth) skipDepth.pop();
      depth -= 1;
      continue;
    }
    if (skipChars > 0 && (hex !== undefined || text !== undefined)) {
      if (hex !== undefined) {
        skipChars -= 1;
        continue;
      }
      const drop = Math.min(skipChars, text!.length);
      skipChars -= drop;
      const rest = text!.slice(drop);
      if (rest && !skipping()) out.push(rest);
      continue;
    }
    if (word !== undefined) {
      if (SKIP.test(word)) {
        if (skipDepth[skipDepth.length - 1] !== depth) skipDepth.push(depth);
        continue;
      }
      if (skipping()) continue;
      if (word === 'par' || word === 'line' || word === 'row') out.push('\n');
      else if (word === 'tab' || word === 'cell') out.push('\t');
      else if (RTF_CHAR[word]) out.push(RTF_CHAR[word]);
      else if (word === 'uc') uc = Number(num ?? 1);
      else if (word === 'u' && num !== undefined) {
        const code = Number(num);
        out.push(String.fromCharCode(code < 0 ? code + 65536 : code));
        skipChars = uc;
      }
      continue;
    }
    if (sym !== undefined) {
      if (sym === '*') {
        if (skipDepth[skipDepth.length - 1] !== depth) skipDepth.push(depth);
      } else if (!skipping() && '\\{}'.includes(sym)) out.push(sym);
      else if (!skipping() && sym === '~') out.push(' ');
      continue;
    }
    if (skipping()) continue;
    if (hex !== undefined)
      out.push(new TextDecoder('windows-1252').decode(Uint8Array.of(parseInt(hex, 16))));
    else if (text !== undefined) out.push(text);
  }
  return out.join('');
}
