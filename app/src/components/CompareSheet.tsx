// Side-by-side compare for 2 or 3 models. A fixed left label column, one column
// per model. The winning cell in each row gets a faint teal wash (never bold
// text), so the eye lands on the stronger option without shouting. Star rows
// reuse the same track as the cards.
import type { CatalogModel, CapabilityCategory } from 'os-code/protocol';
import { CAPABILITIES } from 'os-code/protocol';
import { useSheetExit } from '../hooks/useSheetExit.js';
import { Stars } from './Stars.js';
import { fitFor, licenseLabel, osCodeFit, starIn, type FitLabel } from './marketplace.js';

const FIT_RANK: Record<FitLabel, number> = { fits: 0, tight: 1, 'too-big': 2 };
const FIT_TEXT: Record<FitLabel, string> = {
  fits: 'Runs here',
  tight: 'Tight fit',
  'too-big': 'Too big',
};

export function CompareSheet({
  models,
  memoryGB,
  onClose,
}: {
  models: CatalogModel[];
  memoryGB: number;
  onClose: () => void;
}) {
  const { closing, dismiss } = useSheetExit(onClose);
  // The union of capabilities any selected model targets, in taxonomy order.
  const order = Object.keys(CAPABILITIES) as CapabilityCategory[];
  const caps = order.filter((c) => models.some((m) => m.categories.includes(c)));

  const fitValue = (m: CatalogModel) => FIT_RANK[fitFor(m.sizeGB, memoryGB)];

  // Index of the winning column for a row, or -1 for a tie / no winner.
  const winner = (values: (number | undefined)[], prefer: 'high' | 'low'): number => {
    let best = -1;
    let bestVal: number | undefined;
    let tie = false;
    values.forEach((v, i) => {
      if (v === undefined) return;
      if (bestVal === undefined || (prefer === 'high' ? v > bestVal : v < bestVal)) {
        bestVal = v;
        best = i;
        tie = false;
      } else if (v === bestVal) {
        tie = true;
      }
    });
    return tie ? -1 : best;
  };

  const fitWin = winner(models.map(fitValue), 'low');
  const sizeWin = winner(
    models.map((m) => m.sizeGB),
    'low',
  );
  const commercialWin = winner(
    models.map((m) => (licenseLabel(m).includes('commercial OK') ? 1 : 0)),
    'high',
  );
  const osFitWin = winner(
    models.map((m) => osCodeFit(m)),
    'high',
  );

  const cols = `minmax(96px, 1.1fr) repeat(${models.length}, minmax(0, 1fr))`;

  return (
    <div className={`sheet-scrim${closing ? ' closing' : ''}`} onClick={dismiss}>
      <div
        className={`sheet compare-sheet${closing ? ' closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Compare</h2>
        <div className="sheet-sub">
          Stars come from benchmarks. Fit is for your selected machine.
        </div>

        <div className="compare-scroll">
          <div className="compare-grid" style={{ gridTemplateColumns: cols }}>
            <div className="compare-corner" />
            {models.map((m) => (
              <div key={m.id} className="compare-head">
                {m.name}
              </div>
            ))}

            <div className="compare-label">OpenShore fit</div>
            {models.map((m, i) => (
              <div key={m.id} className={`compare-cell${i === osFitWin ? ' win' : ''}`}>
                {osCodeFit(m) !== undefined ? (
                  <Stars value={osCodeFit(m)!} size={12} fill="var(--wave)" />
                ) : (
                  <span className="compare-dash">not rated</span>
                )}
              </div>
            ))}

            {caps.map((cap) => {
              const vals = models.map((m) => starIn(m, cap));
              const win = winner(vals, 'high');
              return (
                <CapRow
                  key={cap}
                  label={CAPABILITIES[cap].plain}
                  models={models}
                  vals={vals}
                  win={win}
                />
              );
            })}

            <div className="compare-label">Size</div>
            {models.map((m, i) => (
              <div key={m.id} className={`compare-cell${i === sizeWin ? ' win' : ''}`}>
                {m.sizeGB} GB
              </div>
            ))}

            <div className="compare-label">License</div>
            {models.map((m, i) => (
              <div key={m.id} className={`compare-cell quiet${i === commercialWin ? ' win' : ''}`}>
                {licenseLabel(m)}
              </div>
            ))}

            <div className="compare-label">Fit</div>
            {models.map((m, i) => (
              <div key={m.id} className={`compare-cell${i === fitWin ? ' win' : ''}`}>
                {FIT_TEXT[fitFor(m.sizeGB, memoryGB)]}
              </div>
            ))}
          </div>
        </div>

        <div className="sheet-actions">
          <button className="btn ghost press-fb" onClick={dismiss}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function CapRow({
  label,
  models,
  vals,
  win,
}: {
  label: string;
  models: CatalogModel[];
  vals: (number | undefined)[];
  win: number;
}) {
  return (
    <>
      <div className="compare-label">{label}</div>
      {models.map((m, i) => (
        <div key={m.id} className={`compare-cell${i === win ? ' win' : ''}`}>
          {vals[i] !== undefined ? (
            <Stars value={vals[i]!} size={12} />
          ) : (
            <span className="compare-dash">not targeted</span>
          )}
        </div>
      ))}
    </>
  );
}
