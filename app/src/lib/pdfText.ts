// A PDF, read on this device by pdf.js. Loaded on the first PDF the person
// attaches (the composer imports this module lazily), never at launch.
//
// pdf.js runs on the main thread here: its worker module is imported, which
// hands pdf.js its message handler directly, so no Worker is spawned from a
// file:// page (the desktop) or the WebView (the phone), and nothing is
// fetched. No fonts or character maps are asked for, so a PDF read here never
// leaves the device.
import { capText, type DocumentText } from './documentText.js';
import { IMAGE_MAX_DIM, nextAttachmentSeq, type Attachment } from './attachments.js';

/** The most pages a scanned PDF is drawn into for an image-reading model. */
export const PDF_SCAN_PAGES = 10;

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type PDFDocumentProxy = Awaited<ReturnType<PdfJs['getDocument']>['promise']>;
let loading: Promise<PdfJs> | undefined;

function pdfjs(): Promise<PdfJs> {
  loading ??= (async () => {
    // @ts-expect-error The worker module ships no types; importing it is all
    // that is needed (it sets globalThis.pdfjsWorker).
    await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
    return import('pdfjs-dist/legacy/build/pdf.mjs');
  })();
  return loading;
}

/** One line of a page's text items, joined the way the page lays them out. */
interface TextItemLike {
  str: string;
  hasEOL?: boolean;
}

/** A page's text items to text: pdf.js marks each line end. */
export function pageItemsToText(items: readonly TextItemLike[]): string {
  let out = '';
  for (const item of items) {
    out += item.str;
    if (item.hasEOL) out += '\n';
  }
  return out;
}

export interface PdfRead {
  doc: DocumentText;
  /** The pages drawn as images, only when the PDF has no text layer (a scan)
   *  and the caller asked for them. */
  scans: Attachment[];
}

/** Read a PDF to text. A PDF with no text at all (a scanned page) is drawn
 *  into page images instead, when `drawScans` is set, so an image-reading
 *  model can read it. Rejects on a damaged or locked PDF. */
export async function readPdf(
  bytes: Uint8Array,
  name: string,
  opts: { drawScans: boolean },
): Promise<PdfRead> {
  const lib = await pdfjs();
  // Nothing that would fetch: no font or map addresses, no worker fetch, no
  // WebAssembly decoders (text needs none of them).
  const task = lib.getDocument({
    data: bytes,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    useWasm: false,
    stopAtErrors: false,
  });
  const pdf = await task.promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      pages.push(pageItemsToText(content.items as TextItemLike[]).trim());
      page.cleanup();
    }
    const parts = { count: pdf.numPages, noun: 'page' as const };
    const joined =
      pdf.numPages > 1 ? pages.map((t, i) => `Page ${i + 1}\n${t}`).join('\n\n') : (pages[0] ?? '');
    const hasText = pages.some((t) => t.length > 0);
    const scans = !hasText && opts.drawScans ? await drawPages(pdf, name) : [];
    return { doc: capText(hasText ? joined : '', parts), scans };
  } finally {
    void task.destroy();
  }
}

async function drawPages(pdf: PDFDocumentProxy, name: string): Promise<Attachment[]> {
  const out: Attachment[] = [];
  const count = Math.min(pdf.numPages, PDF_SCAN_PAGES);
  const base = name.replace(/\.pdf$/i, '');
  for (let n = 1; n <= count; n += 1) {
    const page = await pdf.getPage(n);
    const plain = page.getViewport({ scale: 1 });
    const scale = Math.min(2, IMAGE_MAX_DIM / Math.max(plain.width, plain.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No canvas.');
    // pdf.js paints the page's own white background before drawing it.
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    page.cleanup();
    out.push({
      id: `att-${nextAttachmentSeq()}-${base}-p${n}`,
      name: `${base} · page ${n} of ${count}`,
      mime: 'image/jpeg',
      dataUrl: canvas.toDataURL('image/jpeg', 0.85),
      isImage: true,
    });
  }
  return out;
}
