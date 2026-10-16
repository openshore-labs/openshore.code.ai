// No em dash in what a person reads, a model's reply included. Every seat is
// told never to use one, and a small one does anyway, so a reply's prose is
// mended where it is shown: the dash and the spaces around it become a comma.
// Code (a fence or an inline span) is left exactly as the model wrote it.
// The dash is built from its code point, since the source may not spell it.
const DASH = String.fromCharCode(0x2014);
const DASH_RUN = new RegExp(`[ \\t]*${DASH}+[ \\t]*`, 'g');

function mendProse(text: string): string {
  return text
    .replace(DASH_RUN, ', ')
    .replace(/, ([,.;:!?)])/g, '$1')
    .replace(/^, /gm, '')
    .replace(/ ,/g, ',')
    .replace(/, $/gm, '');
}

/** The reply with every em dash outside code read as a comma. */
export function mendEmDashes(text: string): string {
  if (!text.includes(DASH)) return text;
  let inFence = false;
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      // Odd pieces sit between backticks: inline code, kept as written.
      return line
        .split(/(`+[^`]*`+)/)
        .map((piece, i) => (i % 2 === 1 ? piece : mendProse(piece)))
        .join('');
    })
    .join('\n');
}
