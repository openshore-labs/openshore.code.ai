// YAML scalars written by hand (Vault M7, CTO L10). The vault core serializes
// no YAML with a library (H2), so the few values OpenShore writes into a
// note's frontmatter (a Crew run note's block, the provenance lines) go
// through this one helper. Moved here from routines/runNote.ts so the pure
// provenance merge shares it. Pure and import-free (harnessPurity).

/** A YAML double-quoted scalar holding exactly `value`. JSON escapes the
 *  quote, the backslash, and the C0 controls; the characters YAML refuses
 *  unescaped, or reads as a line break, are escaped here too. */
export function yamlString(value: string): string {
  return JSON.stringify(value).replace(
    /[\u007f-\u009f\u2028\u2029\ufeff\ufffe\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
