// A pick whose license sets conditions on commercial use (MedGemma's HAI-DEF
// terms, the SAM License, Stability's Community License) is downloaded only
// after the person accepts those terms themselves, at Get, in the app and in
// the CLI alike (founder, 2026-10-13). OpenShore never hosts the weights: the
// person takes them from the publisher under the publisher's license, and the
// tap says so before anything moves. Nothing about the tap is stored or sent.
// Pure, so the app reads it through os-code/protocol.
import type { CatalogModel } from './schema.js';

/** Whether Get must ask the person to accept the license first. */
export function needsTermsAccepted(model: Pick<CatalogModel, 'license'>): boolean {
  return Boolean(model.license.conditions) || model.license.commercial === 'gated';
}

/** The sheet's title and the CLI's question. */
export function termsQuestion(model: Pick<CatalogModel, 'name' | 'license'>): string {
  return `Accept the ${model.license.name} for ${model.name}?`;
}

/** What the person agrees to, said once and plainly. */
export function termsLines(model: Pick<CatalogModel, 'name' | 'license'>): string[] {
  const lines: string[] = [];
  if (model.license.conditions) lines.push(model.license.conditions);
  lines.push(
    `${model.name} comes straight from its publisher, under its publisher's license. Getting it means you accept that license yourself.`,
  );
  return lines;
}

/** The accept button's words. */
export const TERMS_ACCEPT = 'Accept and get';
