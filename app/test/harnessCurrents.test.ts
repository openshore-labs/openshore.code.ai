// Harness Currents, the pure core and the guards. A second, independent group
// above Agentic Currents: it layers a cheap decision method (Jev) into the
// harness. The founder's promises, held in code: one on at a time WITHIN the
// harness group, coexisting with an agentic current (one of each may be on);
// the two-part gate (toggle AND probe); a harness current fills no room slot
// (it is not a model or an agent); and with none on the rooms carry no trace.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  HARNESS_CURRENTS,
  HARNESS_CURRENT_IDS,
  HARNESS_CURRENTS_BETA_LINE,
  activeHarnessContribution,
  activeHarnessCurrent,
  activeHarnessId,
  contributionForHarness,
  harnessCurrentConfigured,
  harnessCurrentInfo,
  harnessCurrentSecretKey,
  harnessCurrentState,
  harnessCurrentStateLine,
  harnessCurrentsHandle,
  nextActiveHarnessCurrent,
  projectHarnessSettings,
} from '../src/lib/harnessCurrents.js';
import { SETUP_GUIDES } from '../src/lib/setupGuides.js';

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe('the harness-current roster', () => {
  it('is Jev today, and every id resolves', () => {
    expect(HARNESS_CURRENTS.map((c) => c.id)).toEqual(HARNESS_CURRENT_IDS);
    expect(HARNESS_CURRENTS.map((c) => c.id)).toEqual(['jev']);
    expect(harnessCurrentInfo('jev').label).toBe('Jev');
  });

  it('every current names a real guide, and the beta line is honest', () => {
    for (const c of HARNESS_CURRENTS) expect(SETUP_GUIDES[c.guide]).toBeTruthy();
    expect(HARNESS_CURRENTS_BETA_LINE).toMatch(/imperfect addition/i);
    expect(HARNESS_CURRENTS_BETA_LINE).toMatch(/Off leaves no trace/);
    expect(HARNESS_CURRENTS_BETA_LINE).toMatch(/paid seat/);
  });

  it('the secret key is its own seam, not the BYOM/agentic one', () => {
    expect(harnessCurrentSecretKey('jev')).toBe('oscode.secret.harness.jev');
  });
});

describe('one at a time within the group, coexisting with agentic', () => {
  it('turning a harness current on or off is a scalar swap', () => {
    expect(nextActiveHarnessCurrent(null, 'jev', true)).toBe('jev');
    expect(nextActiveHarnessCurrent('jev', 'jev', false)).toBeNull();
    // A second harness current (none exists yet) would replace, not stack.
  });

  it('activeHarnessCurrent reads only the harness scalar, never the agentic one', () => {
    expect(activeHarnessCurrent({})).toBeNull();
    expect(activeHarnessCurrent({ harnessCurrent: 'jev' })).toBe('jev');
    // An unknown id is ignored.
    expect(activeHarnessCurrent({ harnessCurrent: 'hermes' as never })).toBeNull();
  });

  it('the two groups are independent: a harness current on does not read the agentic field', () => {
    // Settings carrying BOTH an agentic current and a harness current: the
    // harness core sees only its own, so both can be on at once.
    const both = {
      harnessCurrent: 'jev' as const,
      harnessCurrentConnections: { jev: { endpoint: 'https://api.typesafe.ai' } },
      // an agentic field present alongside must not change the harness answer
      agenticCurrent: 'hermes',
    };
    expect(activeHarnessCurrent(both)).toBe('jev');
    expect(activeHarnessContribution(both)?.label).toBe('Jev');
  });
});

describe('per-project selection (connect once, select per project)', () => {
  const connections = { jev: { endpoint: 'https://api.typesafe.ai' } };

  it('reads the selection from the project, with the device-local connections', () => {
    const view = projectHarnessSettings({ harnessCurrent: 'jev' }, connections);
    expect(view.harnessCurrent).toBe('jev');
    expect(view.harnessCurrentConnections).toBe(connections);
    expect(activeHarnessCurrent(view)).toBe('jev');
  });

  it('two projects can differ while sharing the one connection', () => {
    const a = projectHarnessSettings({ harnessCurrent: 'jev' }, connections);
    const b = projectHarnessSettings({ harnessCurrent: null }, connections);
    expect(activeHarnessContribution(a)?.label).toBe('Jev');
    expect(activeHarnessContribution(b)).toBeUndefined();
  });

  it('a project with no selection is off even when a connection exists', () => {
    expect(activeHarnessCurrent(projectHarnessSettings(undefined, connections))).toBeNull();
  });
});

describe('the two-part gate', () => {
  const saved = { harnessCurrentConnections: { jev: { endpoint: 'https://api.typesafe.ai' } } };

  it('on needs the toggle AND a probe', () => {
    expect(harnessCurrentState('jev', { ...saved, harnessCurrent: 'jev' }, { jev: true })).toBe(
      'on',
    );
    expect(harnessCurrentState('jev', { ...saved, harnessCurrent: 'jev' }, { jev: false })).toBe(
      'arriving',
    );
    expect(harnessCurrentState('jev', { ...saved, harnessCurrent: 'jev' }, {})).toBe('arriving');
  });

  it('ready when saved and answering but the toggle is off; off when nothing saved', () => {
    expect(harnessCurrentState('jev', saved, { jev: true })).toBe('ready');
    expect(harnessCurrentState('jev', {}, {})).toBe('off');
  });

  it('configured is a saved connection object', () => {
    expect(harnessCurrentConfigured('jev', saved)).toBe(true);
    expect(harnessCurrentConfigured('jev', {})).toBe(false);
  });

  it('the state line speaks to each state honestly', () => {
    expect(
      harnessCurrentStateLine('jev', { ...saved, harnessCurrent: 'jev' }, { jev: true }),
    ).toMatch(/^On\. Steering your seats/);
    expect(harnessCurrentStateLine('jev', { harnessCurrent: 'jev' }, {})).toMatch(
      /^Arriving\..*key/,
    );
    expect(harnessCurrentStateLine('jev', saved, { jev: true })).toMatch(/^Ready/);
  });
});

describe('the contribution and off-leaves-no-trace', () => {
  it('a harness current shows a header pill and its jobs, and fills no room slot', () => {
    const c = contributionForHarness('jev');
    expect(c.header.label).toBe('Jev');
    expect(c.jobs.length).toBeGreaterThan(0);
    // It is not a model or an agent, so there is deliberately no bench/crew/vault.
    expect(c).not.toHaveProperty('bench');
    expect(c).not.toHaveProperty('crew');
    expect(c).not.toHaveProperty('vault');
  });

  it('with none on there is no contribution', () => {
    expect(activeHarnessContribution({})).toBeUndefined();
    // Saved but toggle off still yields nothing.
    expect(
      activeHarnessContribution({
        harnessCurrentConnections: { jev: { endpoint: 'https://api.typesafe.ai' } },
      }),
    ).toBeUndefined();
  });
});

describe('the handle the engine gets', () => {
  it('reads the active id back from a handle, for a room that holds only it', () => {
    expect(activeHarnessId(undefined)).toBeUndefined();
    expect(activeHarnessId({})).toBeUndefined();
    expect(activeHarnessId({ jev: { baseUrl: 'https://api.typesafe.ai' } })).toBe('jev');
  });

  it('builds a jev handle from the active connection, defaulting the base', () => {
    expect(harnessCurrentsHandle({}, 'k')).toBeUndefined();
    expect(harnessCurrentsHandle({ harnessCurrent: 'jev' }, 'k')).toEqual({
      jev: { baseUrl: 'https://api.typesafe.ai', apiKey: 'k', model: undefined },
    });
    expect(
      harnessCurrentsHandle(
        {
          harnessCurrent: 'jev',
          harnessCurrentConnections: {
            jev: { endpoint: 'https://eu.typesafe.ai/v1', model: 'jev-1.13.0' },
          },
        },
        'k',
      ),
    ).toEqual({ jev: { baseUrl: 'https://eu.typesafe.ai', apiKey: 'k', model: 'jev-1.13.0' } });
  });
});

describe('no room names a harness current itself', () => {
  it('the proper nouns live only in the core, the settings, and the guides', () => {
    const ALLOWED = new Set([
      'lib/harnessCurrents.ts',
      'lib/setupGuides.ts',
      'components/ProjectCurrents.tsx',
      'components/HarnessCurrentConnectSheet.tsx',
    ]);
    const names = /\b(Jev|Harness Currents)\b/;
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const rel = relative(SRC, file);
      if (ALLOWED.has(rel)) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)) return;
          if (names.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 80)}`);
        });
    }
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });
});
