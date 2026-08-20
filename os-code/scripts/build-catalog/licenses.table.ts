// The SPDX license allow-list. FAIL CLOSED: a model's license id/name/url come
// ONLY from this table. If a model's declared license id is not here, the
// model does not clear the curated storefront gate and is dropped. The builder
// NEVER synthesizes a license from a source tag, and NEVER writes a human note
// here (notes come from the editorial overlay only). Tuning one row is one
// edit, the same data-table shape as PRICES in src/auth/usage.ts.
export type Commercial = 'ok' | 'non-commercial' | 'gated';

export interface LicenseRow {
  /** Canonical id, matched case-insensitively against a model's declared id. */
  id: string;
  name: string;
  url?: string;
  /** The honest, machine-known commercial posture. Drives the client filter
   *  facet (commercial-ok / non-commercial / gated). This is a flag, not prose:
   *  the human note is editorial and lives in the overlay. */
  commercial: Commercial;
}

// Only ids on this list clear the gate. Add a row to admit a license; there is
// no fallback and no tag-sniffing path, on purpose.
export const LICENSE_TABLE: LicenseRow[] = [
  {
    id: 'Apache-2.0',
    name: 'Apache License 2.0',
    url: 'https://www.apache.org/licenses/LICENSE-2.0',
    commercial: 'ok',
  },
  { id: 'MIT', name: 'MIT License', url: 'https://opensource.org/license/mit', commercial: 'ok' },
  {
    id: 'BSD-3-Clause',
    name: 'BSD 3-Clause License',
    url: 'https://opensource.org/license/bsd-3-clause',
    commercial: 'ok',
  },
  {
    id: 'Llama-3.1-Community',
    name: 'Llama 3.1 Community License',
    url: 'https://www.llama.com/llama3_1/license/',
    // Free for most, with a named-user threshold. That caveat is gated, not open.
    commercial: 'gated',
  },
  {
    id: 'Llama-3.2-Community',
    name: 'Llama 3.2 Community License',
    url: 'https://www.llama.com/llama3_2/license/',
    commercial: 'gated',
  },
  {
    id: 'Gemma',
    name: 'Gemma Terms of Use',
    url: 'https://ai.google.dev/gemma/terms',
    commercial: 'gated',
  },
  {
    id: 'CC-BY-4.0',
    name: 'Creative Commons Attribution 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    commercial: 'ok',
  },
  {
    id: 'CC-BY-NC-4.0',
    name: 'Creative Commons Attribution NonCommercial 4.0',
    url: 'https://creativecommons.org/licenses/by-nc/4.0/',
    commercial: 'non-commercial',
  },
];

/** Look up a declared license id in the allow-list. Case-insensitive on the id.
 *  Returns undefined when the id is missing or unmapped, which fails the gate. */
export function resolveLicense(id: string | undefined): LicenseRow | undefined {
  if (!id) return undefined;
  const want = id.trim().toLowerCase();
  return LICENSE_TABLE.find((row) => row.id.toLowerCase() === want);
}
