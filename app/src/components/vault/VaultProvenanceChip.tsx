// The provenance chip on a note's meta line (Vault M7 7.2; CTO L9; CX Y11,
// Y16, R4). It says which model wrote the note and where that model ran:
// teal (`--local`) for a seat on this computer, amber (`--cloud`) for a cloud
// seat, judged by address at write time and recorded as `oscode-where`. The
// word Local or Cloud is always on the chip too, so the color is never the
// only signal. Once the person marks it reviewed the chip keeps its tint as an
// outline instead of a fill.
//
// Presentational: the screen reads the note's provenance (`readProvenance`)
// and opens "About this note" from `onOpen`. Nothing renders unless the note
// names both the model and where it ran; nothing is inferred.
import type { NoteProvenance } from 'os-code/protocol';
import { vaultProvChipLabel, vaultProvChipText } from '../../lib/vaultCopy.js';

/** The chip's facts, or undefined when the note carries too little to show
 *  one honestly (no model, or no place it ran). */
export function provChipFacts(p: NoteProvenance | undefined):
  | {
      model: string;
      where: 'local' | 'cloud';
      edit: boolean;
      reviewed: boolean;
    }
  | undefined {
  if (!p || !p.model || (p.where !== 'local' && p.where !== 'cloud')) return undefined;
  return {
    model: p.model,
    where: p.where,
    edit: p.source === 'agent-edit',
    reviewed: Boolean(p.reviewed),
  };
}

export function VaultProvenanceChip({
  provenance,
  onOpen,
}: {
  provenance: NoteProvenance | undefined;
  /** Opens "About this note". */
  onOpen: () => void;
}) {
  const facts = provChipFacts(provenance);
  if (!facts) return null;
  const cls = [
    'vault-prov-chip',
    'press-fb',
    facts.where === 'local' ? 'vault-prov-local' : 'vault-prov-cloud',
    facts.reviewed ? 'vault-prov-reviewed' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={cls}
      aria-label={vaultProvChipLabel(facts)}
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      <span className="vault-prov-dot" aria-hidden="true" />
      {vaultProvChipText(facts)}
    </button>
  );
}
