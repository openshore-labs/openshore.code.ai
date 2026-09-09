// Agentic Currents and Wayfinding, the pure core and the guards that hold the
// founder's promise: one current at a time everywhere, the two-part gate
// (toggle AND probe), every current fills every contribution slot (the
// mirrored pattern), and with none on the rooms carry no trace of any.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  AGENTIC_CURRENTS,
  AGENTIC_CURRENT_IDS,
  AGENTIC_CURRENTS_BETA_LINE,
  CONTRIBUTION_SLOTS,
  WAYFINDING,
  WAYFINDING_IDS,
  activeContribution,
  activeCurrent,
  contributionFor,
  currentBenchId,
  currentBenchRefs,
  currentConfigured,
  currentInfo,
  currentSecretKey,
  currentState,
  currentStateLine,
  currentsHandles,
  isCurrentBenchId,
  nextActiveCurrent,
  slotNone,
  wayfindingOn,
} from '../src/lib/currents.js';
import {
  hermesJobs,
  probeAgentCard,
  probeCurrent,
  probeOpenAiCompatible,
} from '../src/lib/currentsProbe.js';
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

function fakeFetch(handler: (url: string) => { status: number; body?: unknown }) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const r = handler(url);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('wayfinding', () => {
  it('is on by default and off only when the person turned it off', () => {
    for (const id of WAYFINDING_IDS) {
      expect(wayfindingOn({}, id)).toBe(true);
      expect(wayfindingOn({ wayfinding: { [id]: false } }, id)).toBe(false);
      expect(WAYFINDING[id].label.length).toBeGreaterThan(0);
    }
  });
});

describe('the roster', () => {
  it('lists the five founder-named currents in order', () => {
    expect(AGENTIC_CURRENTS.map((c) => c.id)).toEqual([...AGENTIC_CURRENT_IDS]);
    expect(AGENTIC_CURRENTS.map((c) => c.label)).toEqual([
      'Hermes Agent',
      'CLI Pairing',
      'Vellum',
      'OpenAGI',
      'A2A',
    ]);
  });

  it('marks the two with no integration surface as arriving, with an honest need', () => {
    expect(currentInfo('vellum').available).toBe(false);
    expect(currentInfo('openagi').available).toBe(false);
    expect(currentInfo('vellum').needs).toMatch(/no documented API/);
    expect(currentInfo('hermes').available).toBe(true);
  });

  it('names a written setup guide for every current', () => {
    for (const c of AGENTIC_CURRENTS) expect(SETUP_GUIDES[c.guide]).toBeDefined();
  });

  it('carries the BETA line the founder asked for', () => {
    expect(AGENTIC_CURRENTS_BETA_LINE).toMatch(/imperfect addition/i);
    expect(AGENTIC_CURRENTS_BETA_LINE).toMatch(/Off leaves no trace/);
  });
});

describe('one at a time, everywhere', () => {
  it('turning one on turns the other off; turning the active one off leaves none', () => {
    expect(nextActiveCurrent(null, 'hermes', true)).toBe('hermes');
    expect(nextActiveCurrent('hermes', 'a2a', true)).toBe('a2a');
    expect(nextActiveCurrent('hermes', 'hermes', false)).toBeNull();
    expect(nextActiveCurrent('hermes', 'a2a', false)).toBe('hermes');
  });

  it('reads the active current only from the roster', () => {
    expect(activeCurrent({})).toBeNull();
    expect(activeCurrent({ agenticCurrent: 'hermes' })).toBe('hermes');
    expect(activeCurrent({ agenticCurrent: 'layers' as never })).toBeNull();
  });
});

describe('the two-part gate', () => {
  const saved = { currentConnections: { hermes: { endpoint: 'http://box:8642/v1' } } };

  it('needs the toggle AND a probe to be On', () => {
    expect(currentState('hermes', {}, {})).toBe('off');
    expect(currentState('hermes', { agenticCurrent: 'hermes' }, {})).toBe('arriving');
    expect(currentState('hermes', { ...saved, agenticCurrent: 'hermes' }, {})).toBe('arriving');
    expect(currentState('hermes', { ...saved, agenticCurrent: 'hermes' }, { hermes: true })).toBe(
      'on',
    );
    expect(currentState('hermes', saved, { hermes: true })).toBe('ready');
    expect(currentState('hermes', { ...saved, agenticCurrent: 'a2a' }, { hermes: true })).toBe(
      'ready',
    );
  });

  it('knows what configured means per kind', () => {
    expect(currentConfigured('cli', { currentConnections: { cli: { command: 'codex' } } })).toBe(
      true,
    );
    expect(currentConfigured('cli', { currentConnections: { cli: {} } })).toBe(false);
    expect(
      currentConfigured('a2a', { currentConnections: { a2a: { endpoint: 'http://a' } } }),
    ).toBe(true);
  });

  it('writes the row line from the state, never a promise it cannot keep', () => {
    expect(currentStateLine('hermes', { agenticCurrent: 'hermes' }, {})).toMatch(
      /^Arriving\. A Hermes box/,
    );
    expect(currentStateLine('hermes', { ...saved, agenticCurrent: 'hermes' }, {})).toMatch(
      /did not answer yet/,
    );
    expect(
      currentStateLine('hermes', { ...saved, agenticCurrent: 'hermes' }, { hermes: true }),
    ).toMatch(/^On\. Answering at box:8642/);
    expect(currentStateLine('hermes', saved, { hermes: true })).toMatch(/^Ready/);
    expect(
      currentStateLine(
        'cli',
        { agenticCurrent: 'cli', currentConnections: { cli: { command: 'codex' } } },
        { cli: true },
      ),
    ).toMatch(/^On\. Codex/);
  });
});

describe('the mirrored pattern', () => {
  it('every current fills every slot, or says why not', () => {
    for (const id of AGENTIC_CURRENT_IDS) {
      const c = contributionFor(id, {});
      expect(c.header.label).toBe(currentInfo(id).label);
      expect(c.guide).toBe(currentInfo(id).guide);
      for (const slot of CONTRIBUTION_SLOTS) {
        const value = c[slot];
        expect(value, `${id}.${slot}`).toBeDefined();
        if (slotNone(value)) expect(value.none.length, `${id}.${slot} reason`).toBeGreaterThan(8);
      }
    }
  });

  it('puts Hermes on the bench as a BYOM-shaped ref keyed by its current id', () => {
    const settings = {
      agenticCurrent: 'hermes' as const,
      currentConnections: { hermes: { endpoint: 'http://box:8642/v1', model: 'hermes-4' } },
    };
    const refs = currentBenchRefs(settings);
    expect(refs).toEqual([
      {
        kind: 'byom',
        id: 'current-hermes',
        label: 'Hermes',
        baseUrl: 'http://box:8642/v1',
        model: 'hermes-4',
      },
    ]);
    expect(isCurrentBenchId(currentBenchId('hermes'))).toBe(true);
    expect(isCurrentBenchId('byom_abc')).toBe(false);
    // The bench row reads its key from the same slot the BYOM path reads.
    expect(currentSecretKey('hermes')).toBe('oscode.secret.byom.current-hermes');
  });

  it('an endpoint current joins the bench only when it answered as OpenAI-compatible', () => {
    const viaA2a = contributionFor('vellum', {
      currentConnections: { vellum: { endpoint: 'http://v', via: 'a2a', agentName: 'Vellum' } },
    });
    expect(slotNone(viaA2a.bench)).toBe(true);
    expect(slotNone(viaA2a.tools)).toBe(false);
    const viaOpenAi = contributionFor('vellum', {
      currentConnections: { vellum: { endpoint: 'http://v/v1', via: 'openai' } },
    });
    expect(slotNone(viaOpenAi.bench)).toBe(false);
  });
});

describe('off leaves no trace', () => {
  it('with none on there is no contribution and no bench ref', () => {
    expect(activeContribution({})).toBeUndefined();
    expect(currentBenchRefs({})).toEqual([]);
    expect(
      activeContribution({ currentConnections: { hermes: { endpoint: 'http://x/v1' } } }),
    ).toBeUndefined();
  });

  it('no room names a current itself: the names live only in the core, the settings, and the guides', () => {
    // The rooms render the active current through activeContribution, so the
    // proper nouns may appear only where the roster is defined and where a
    // person turns it on. Anything else would survive the toggle.
    const ALLOWED = new Set([
      'lib/currents.ts',
      'lib/currentsProbe.ts',
      'lib/setupGuides.ts',
      'screens/SettingsScreen.tsx',
      'components/CurrentConnectSheet.tsx',
    ]);
    const names = /\b(Hermes|Vellum|OpenAGI|CLI Pairing|Agentic Currents)\b/;
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

describe('the handles the engine gets', () => {
  it('hands the active current only, built from the saved connection', () => {
    expect(currentsHandles({}, 'k')).toBeUndefined();
    expect(
      currentsHandles(
        {
          agenticCurrent: 'hermes',
          currentConnections: { hermes: { endpoint: 'http://box/v1', model: 'h' } },
        },
        'k',
      ),
    ).toEqual({ hermes: { baseUrl: 'http://box/v1', apiKey: 'k', model: 'h' } });
    expect(
      currentsHandles(
        { agenticCurrent: 'a2a', currentConnections: { a2a: { endpoint: 'http://a' } } },
        undefined,
      ),
    ).toEqual({ a2a: { agentUrl: 'http://a', apiKey: undefined } });
    expect(
      currentsHandles(
        {
          agenticCurrent: 'vellum',
          currentConnections: { vellum: { endpoint: 'http://v', via: 'a2a' } },
        },
        undefined,
      ),
    ).toEqual({ a2a: { agentUrl: 'http://v', apiKey: undefined } });
    expect(currentsHandles({ agenticCurrent: 'hermes' }, 'k')).toBeUndefined();
  });

  it('hands a CLI only when the host really has it', () => {
    const settings = {
      agenticCurrent: 'cli' as const,
      currentConnections: { cli: { command: 'claude' as const } },
    };
    const host = { hermes: { home: '', present: false }, cli: { claude: false, codex: true } };
    expect(currentsHandles(settings, undefined, host)).toBeUndefined();
    expect(
      currentsHandles(settings, undefined, { ...host, cli: { claude: true, codex: false } }),
    ).toEqual({
      cli: { command: 'claude' },
    });
    expect(currentsHandles(settings, undefined)).toEqual({ cli: { command: 'claude' } });
  });
});

describe('probes', () => {
  it('an OpenAI-compatible server answers /models with anything but a 404 or a 5xx', async () => {
    expect(
      await probeOpenAiCompatible(
        'http://b/v1',
        undefined,
        fakeFetch(() => ({ status: 200 })),
      ),
    ).toBe(true);
    expect(
      await probeOpenAiCompatible(
        'http://b/v1',
        undefined,
        fakeFetch(() => ({ status: 401 })),
      ),
    ).toBe(true);
    expect(
      await probeOpenAiCompatible(
        'http://b/v1',
        undefined,
        fakeFetch(() => ({ status: 404 })),
      ),
    ).toBe(false);
    expect(
      await probeOpenAiCompatible(
        'http://b/v1',
        undefined,
        fakeFetch(() => ({ status: 502 })),
      ),
    ).toBe(false);
    const dead = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect(await probeOpenAiCompatible('http://b/v1', undefined, dead)).toBe(false);
  });

  it('reads an agent card from either well-known path', async () => {
    const f = fakeFetch((url) =>
      url.endsWith('agent.json') ? { status: 200, body: { name: 'Vellum' } } : { status: 404 },
    );
    expect(await probeAgentCard('http://v', undefined, f)).toEqual({
      name: 'Vellum',
      description: undefined,
    });
    expect(
      await probeAgentCard(
        'http://v',
        undefined,
        fakeFetch(() => ({ status: 404 })),
      ),
    ).toBeUndefined();
  });

  it('probes each kind by its own door and remembers which answered', async () => {
    const host = { hermes: { home: '', present: false }, cli: { claude: true, codex: false } };
    expect(await probeCurrent('cli', { command: 'claude' }, undefined, host)).toEqual({
      answered: true,
    });
    expect(await probeCurrent('cli', { command: 'codex' }, undefined, host)).toEqual({
      answered: false,
    });
    expect(await probeCurrent('cli', { command: 'claude' }, undefined, undefined)).toEqual({
      answered: false,
    });
    expect(await probeCurrent('hermes', undefined, undefined, undefined)).toEqual({
      answered: false,
    });
    expect(
      await probeCurrent(
        'hermes',
        { endpoint: 'http://b/v1' },
        'k',
        undefined,
        fakeFetch(() => ({ status: 200 })),
      ),
    ).toEqual({ answered: true });
    const cardOnly = fakeFetch((url) =>
      url.includes('well-known') ? { status: 200, body: { name: 'Vell' } } : { status: 404 },
    );
    expect(
      await probeCurrent('vellum', { endpoint: 'http://v' }, undefined, undefined, cardOnly),
    ).toEqual({
      answered: true,
      via: 'a2a',
      agentName: 'Vell',
    });
    const modelsOnly = fakeFetch((url) =>
      url.endsWith('/models') ? { status: 200 } : { status: 404 },
    );
    expect(
      await probeCurrent('openagi', { endpoint: 'http://o/v1' }, undefined, undefined, modelsOnly),
    ).toEqual({
      answered: true,
      via: 'openai',
    });
  });

  it('reads Hermes jobs beside the /v1 base, tolerant of the field names', async () => {
    const f = fakeFetch((url) =>
      url === 'http://box:8642/api/jobs'
        ? {
            status: 200,
            body: {
              jobs: [
                { id: 'j1', name: 'Morning digest', schedule: '0 6 * * *', enabled: true },
                {
                  job_id: 'j2',
                  prompt: 'Check the inbox and summarize',
                  cron: '*/30 * * * *',
                  paused: true,
                },
                { name: 'no id' },
              ],
            },
          }
        : { status: 404 },
    );
    const jobs = await hermesJobs('http://box:8642/v1', undefined, f);
    expect(jobs.map((j) => [j.id, j.name, j.schedule, j.enabled])).toEqual([
      ['j1', 'Morning digest', '0 6 * * *', true],
      ['j2', 'Check the inbox and summarize', '*/30 * * * *', false],
    ]);
    expect(
      await hermesJobs(
        'http://box:8642/v1',
        undefined,
        fakeFetch(() => ({ status: 500 })),
      ),
    ).toEqual([]);
  });
});
