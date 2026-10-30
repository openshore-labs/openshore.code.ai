// Documents in the composer: a PDF, Office and OpenDocument files and RTF are
// read on the device and fold in as their text; any other file goes by name.
// The screenshot that asked for it: a cover letter PDF turned away with "is
// not a text file".
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DOCUMENT_TEXT_MAX,
  capText,
  documentBlock,
  documentKind,
  fileNoteBlock,
} from '../src/lib/documentText';
import { readOfficeText, readZip, rtfToText } from '../src/lib/officeText';
import { pageItemsToText, readPdf } from '../src/lib/pdfText';

/** A minimal zip writer: each entry stored or deflated, a central directory,
 *  and the end record. CRCs are left zero; the reader never checks them. */
async function zip(files: Record<string, string>, deflate = true): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, body] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const raw = enc.encode(body);
    const data = deflate
      ? new Uint8Array(
          await new Response(
            new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw')),
          ).arrayBuffer(),
        )
      : raw;
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, deflate ? 8 : 0, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, deflate ? 8 : 0, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const dirSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe('documentKind', () => {
  it('names each document by MIME, then by extension when the type is blank', () => {
    expect(documentKind({ type: 'application/pdf', name: 'x' })).toBe('pdf');
    expect(documentKind({ type: '', name: 'Jack_Cover_Letter.PDF' })).toBe('pdf');
    expect(documentKind({ type: '', name: 'resume.docx' })).toBe('docx');
    expect(documentKind({ type: 'application/octet-stream', name: 'budget.xlsx' })).toBe('xlsx');
    expect(documentKind({ type: '', name: 'deck.pptx' })).toBe('pptx');
    expect(documentKind({ type: '', name: 'notes.odt' })).toBe('odt');
    expect(documentKind({ type: 'text/rtf', name: 'a' })).toBe('rtf');
    expect(documentKind({ type: 'application/zip', name: 'code.zip' })).toBeUndefined();
    expect(documentKind({ type: 'text/plain', name: 'notes.txt' })).toBeUndefined();
  });
});

describe('readZip', () => {
  it('reads stored and deflated entries', async () => {
    for (const deflate of [false, true]) {
      const z = readZip(await zip({ 'a.txt': 'hello', 'dir/b.xml': '<x>é</x>' }, deflate));
      expect(z.names).toEqual(['a.txt', 'dir/b.xml']);
      expect(await z.text('dir/b.xml')).toBe('<x>é</x>');
    }
  });

  it('turns away something that is not a zip', () => {
    expect(() => readZip(new TextEncoder().encode('%PDF-1.4 not a zip at all, sorry'))).toThrow();
  });
});

describe('readOfficeText', () => {
  it('reads a Word document a paragraph per line, with tabs, breaks and entities', async () => {
    const xml =
      '<?xml version="1.0"?><w:document><w:body>' +
      '<w:p><w:r><w:t>Dear Hiring Team,</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">I am </w:t></w:r><w:r><w:t>excited &amp; ready.</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Name</w:t><w:tab/><w:t>Jack</w:t><w:br/><w:t>Line two</w:t></w:r></w:p>' +
      '</w:body></w:document>';
    const doc = await readOfficeText(await zip({ 'word/document.xml': xml }), 'docx');
    expect(doc.text).toBe('Dear Hiring Team,\nI am excited & ready.\nName\tJack\nLine two');
    expect(doc.truncated).toBe(false);
  });

  it('reads a deck slide by slide, in number order', async () => {
    const slide = (t: string) =>
      `<p:sld><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p><a:p><a:r><a:t>more</a:t></a:r></a:p></p:txBody></p:sld>`;
    const doc = await readOfficeText(
      await zip({
        'ppt/slides/slide10.xml': slide('Ten'),
        'ppt/slides/slide2.xml': slide('Two'),
        'ppt/slides/slide1.xml': slide('One'),
        'ppt/slides/_rels/slide1.xml.rels': '<x/>',
      }),
      'pptx',
    );
    expect(doc.parts).toEqual({ count: 3, noun: 'slide' });
    expect(doc.text).toBe('Slide 1\nOne\nmore\n\nSlide 2\nTwo\nmore\n\nSlide 3\nTen\nmore');
  });

  it('reads a workbook sheet by sheet, cells in their columns', async () => {
    const doc = await readOfficeText(
      await zip({
        'xl/workbook.xml':
          '<workbook><sheets><sheet name="Budget &amp; plan" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels':
          '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>',
        'xl/sharedStrings.xml':
          '<sst><si><t>Item</t></si><si><r><t>Co</t></r><r><t>st</t></r></si></sst>',
        'xl/worksheets/sheet1.xml':
          '<worksheet><sheetData>' +
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
          '<row r="2"><c r="A2" t="inlineStr"><is><t>Rent</t></is></c><c r="C2"><v>1200</v></c></row>' +
          '<row r="3"><c r="B3" t="b"><v>1</v></c></row>' +
          '</sheetData></worksheet>',
      }),
      'xlsx',
    );
    expect(doc.parts).toEqual({ count: 1, noun: 'sheet' });
    expect(doc.text).toBe('Sheet: Budget & plan\nItem\t\tCost\nRent\t\t1200\n\tTRUE');
  });

  it('reads OpenDocument text, spaces and tables kept', async () => {
    const xml =
      '<office:document-content><office:automatic-styles><style:style/></office:automatic-styles>' +
      '<office:body><office:text>' +
      '<text:h>Title</text:h><text:p>a<text:s text:c="3"/>b<text:tab/>c</text:p>' +
      '<table:table><table:table-row><table:table-cell><text:p>x</text:p></table:table-cell>' +
      '<table:table-cell><text:p>y</text:p></table:table-cell></table:table-row></table:table>' +
      '</office:text></office:body></office:document-content>';
    const doc = await readOfficeText(await zip({ 'content.xml': xml }), 'odt');
    expect(doc.text).toContain('Title\na   b\tc');
    expect(doc.text).toContain('x\n\ty');
  });

  it('reads RTF without its font table or control words', async () => {
    const rtf =
      '{\\rtf1\\ansi{\\fonttbl{\\f0 Helvetica;}}{\\colortbl;\\red0\\green0\\blue0;}' +
      "{\\*\\generator Word;}\\f0 Dear team,\\par I\\rquote m caf\\'e9 \\u8217? ready\\emdash now.\\par}";
    expect(rtfToText(rtf).trim()).toBe('Dear team,\nI’m café ’ ready - now.');
    const doc = await readOfficeText(new TextEncoder().encode(rtf), 'rtf');
    expect(doc.text).toContain('Dear team,');
  });

  it('rejects a damaged document rather than pasting bytes', async () => {
    await expect(readOfficeText(new Uint8Array([1, 2, 3]), 'docx')).rejects.toThrow();
    await expect(readOfficeText(await zip({ 'x.xml': '<x/>' }), 'docx')).rejects.toThrow();
  });
});

describe('the text a document adds', () => {
  it('cuts past the limit and says so', () => {
    const doc = capText('a'.repeat(DOCUMENT_TEXT_MAX + 10));
    expect(doc.truncated).toBe(true);
    expect(doc.text.length).toBe(DOCUMENT_TEXT_MAX);
    expect(documentBlock('big.pdf', 'pdf', doc)).toMatch(/Only the first 200,000 characters/);
  });

  it('names the file and fences its text in a fence the text cannot close', () => {
    const block = documentBlock('a.docx', 'docx', capText('see ```code``` here'));
    expect(block.startsWith('a.docx (Word document):\n````\n')).toBe(true);
    expect(block.endsWith('\n````')).toBe(true);
    const pdf = documentBlock('c.pdf', 'pdf', capText('hi', { count: 2, noun: 'page' }));
    expect(pdf.startsWith('c.pdf (PDF, 2 pages):')).toBe(true);
  });

  it('names any other file by name, type and size, never its bytes', () => {
    const note = fileNoteBlock({ name: 'code.zip', type: 'application/zip', size: 2_400_000 });
    expect(note).toBe(
      'Attached file: code.zip (application/zip, 2.3 MB). Its contents could not be read as text on this device, so only its name, type and size are included.',
    );
  });
});

describe('readPdf', () => {
  it('joins a page by the line ends pdf.js marks', () => {
    expect(
      pageItemsToText([
        { str: 'Dear', hasEOL: false },
        { str: ' team,', hasEOL: true },
        { str: 'Thanks.', hasEOL: false },
      ]),
    ).toBe('Dear team,\nThanks.');
  });

  it('reads a real PDF on the device, a page at a time', async () => {
    const bytes = new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'cover-letter.pdf')));
    const { doc, scans } = await readPdf(bytes, 'cover-letter.pdf', { drawScans: false });
    expect(scans).toEqual([]);
    expect(doc.parts).toEqual({ count: 2, noun: 'page' });
    expect(doc.text).toContain('Page 1\nDear Hiring Team,');
    expect(doc.text).toContain('Page 2\nSincerely, Jack');
  });

  it('turns away a file that is not a PDF', async () => {
    await expect(
      readPdf(new TextEncoder().encode('not a pdf'), 'x.pdf', { drawScans: false }),
    ).rejects.toThrow();
  });
});
