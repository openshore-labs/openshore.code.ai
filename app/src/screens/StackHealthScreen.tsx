// Stack Health: an Apple-Health-style read of how your AI stack is actually
// used, folded 100% locally by the engine from the sessions already on disk.
// Nothing here is sent anywhere; the screen only asks the engine to aggregate
// what it already wrote. Water teal is private/local, amber is cloud/spend, and
// every privacy fact is literally true, including the ones that are not green.
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackBar } from '../components/BackBar.js';
import { hapticSuccess } from '../lib/haptics.js';
import { loadAppStackHealth } from '../lib/stackHealth.js';
import { useApp } from '../state/store.js';
import type { StackHealth, StackHealthRange, SustainabilityFootprint } from 'os-code/protocol';

const RANGES: Array<{ id: StackHealthRange; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
  { id: 'all', label: 'All time' },
];

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function money(n: number): string {
  if (n >= 100) return `$${Math.round(n)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n > 0) return `$${n.toFixed(2)}`;
  return '$0';
}

function pct(f: number): number {
  return Math.round(f * 100);
}

// ---- Sustainability formatting. Every number is an estimate, so these round
// generously and never manufacture false precision. Small weeks read small, and
// that is the honest picture.

/** Energy: watt-hours below a kilowatt-hour, then kWh. */
function energy(kwh: number): string {
  const wh = kwh * 1000;
  if (wh < 1) return `${(wh * 1000).toFixed(0)} mWh`;
  if (wh < 1000) return `${wh < 10 ? wh.toFixed(1) : Math.round(wh)} Wh`;
  return `${kwh < 10 ? kwh.toFixed(1) : Math.round(kwh)} kWh`;
}

/** Water: milliliters below a liter, then liters. */
function water(liters: number): string {
  if (liters < 1) return `${Math.round(liters * 1000)} mL`;
  return `${liters < 10 ? liters.toFixed(1) : Math.round(liters)} L`;
}

/** Carbon: grams below a kilogram, then kg. */
function carbon(grams: number): string {
  if (grams < 1000) return `${grams < 10 ? grams.toFixed(1) : Math.round(grams)} g`;
  return `${(grams / 1000).toFixed(grams < 10_000 ? 1 : 0)} kg`;
}

// Relatable equivalents. Illustrative, labelled as such in the copy, each with a
// stated conversion so nothing is a magic number.
const WH_PER_PHONE_CHARGE = 12; // a full smartphone charge, ~12 Wh
const ML_PER_GLASS = 250; // a glass of water
const GRAMS_CO2_PER_KM = 170; // an average passenger car, gCO2e per km

function phoneCharges(kwh: number): number {
  return (kwh * 1000) / WH_PER_PHONE_CHARGE;
}
function glasses(liters: number): number {
  return (liters * 1000) / ML_PER_GLASS;
}
function kmDriven(grams: number): number {
  return grams / GRAMS_CO2_PER_KM;
}

/** A short, honest equivalence line for a footprint, or empty when it rounds to
 *  nothing worth saying. */
function equivalent(f: SustainabilityFootprint): string {
  const charges = phoneCharges(f.kwh);
  const g = glasses(f.liters);
  const km = kmDriven(f.grams);
  const parts: string[] = [];
  if (charges >= 1) parts.push(`${Math.round(charges)} phone ${Math.round(charges) === 1 ? 'charge' : 'charges'}`);
  if (g >= 1) parts.push(`${Math.round(g)} ${Math.round(g) === 1 ? 'glass' : 'glasses'} of water`);
  if (km >= 1) parts.push(`${Math.round(km)} km not driven`);
  return parts.join(' · ');
}

// A number that eases up from 0 on mount and whenever the target changes. The
// count-up is the single most delightful beat on the screen, so it earns a
// spring; reduced-motion lands on the value immediately.
function useCountUp(target: number, durationMs = 1100): number {
  const [value, setValue] = useState(prefersReducedMotion() ? target : 0);
  const fromRef = useRef(0);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      setValue(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

interface RingSpec {
  key: string;
  fraction: number;
  radius: number;
}

// Three concentric rings. Outer = Local/Private (teal, the brand ring), middle
// = Flow (neutral, competence), inner = Saved (amber, spend you avoided). The
// palette never drifts to Apple's red/green/blue: teal means private, amber
// means spend, and that equation is the whole point.
function Rings({ health, animate }: { health: StackHealth; animate: boolean }) {
  const rings: RingSpec[] = [
    {
      key: 'private',
      fraction: health.privacyRing.fraction,
      radius: 86,
    },
    {
      key: 'flow',
      fraction: health.flowRing.fraction,
      radius: 66,
    },
    {
      key: 'saved',
      fraction: health.savedRing.fraction,
      radius: 46,
    },
  ];
  return (
    <svg
      className="sh-rings"
      viewBox="0 0 200 200"
      role="img"
      aria-label="Local, flow, and saved rings"
    >
      <defs>
        {rings.map((r) => (
          <linearGradient key={r.key} id={`sh-grad-${r.key}`} x1="0" y1="0" x2="1" y2="1">
            {/* Stop colors are token-routed in theme.css (.sh-stop-*) so the
                rings and the legend swatches read the same values by name. */}
            <stop offset="0%" className={`sh-stop-${r.key}-a`} />
            <stop offset="100%" className={`sh-stop-${r.key}-b`} />
          </linearGradient>
        ))}
      </defs>
      {rings.map((r, i) => {
        const c = 2 * Math.PI * r.radius;
        const shown = animate ? r.fraction : 0;
        return (
          <g key={r.key} transform="rotate(-90 100 100)">
            <circle
              cx="100"
              cy="100"
              r={r.radius}
              className="sh-ring-track"
              strokeWidth={13}
              fill="none"
            />
            <circle
              cx="100"
              cy="100"
              r={r.radius}
              stroke={`url(#sh-grad-${r.key})`}
              strokeWidth={13}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - shown)}
              className="sh-ring-fill"
              style={{ transitionDelay: `${i * 90}ms` }}
            />
          </g>
        );
      })}
    </svg>
  );
}

// A tiny stacked column chart of the timeline: local turns in teal, cloud in
// amber. GPU-cheap, one rect pair per bucket, and it degrades to bare bars with
// reduced motion.
function Timeline({ health }: { health: StackHealth }) {
  const max = Math.max(1, ...health.timeline.map((b) => b.localTurns + b.cloudTurns));
  return (
    <div className="sh-timeline" role="img" aria-label="Local and cloud turns over time">
      {health.timeline.map((b, i) => {
        const total = b.localTurns + b.cloudTurns;
        const h = (total / max) * 100;
        const localFrac = total > 0 ? b.localTurns / total : 0;
        return (
          <div
            className="sh-tl-col"
            key={i}
            title={`${b.label}: ${b.localTurns} local, ${b.cloudTurns} cloud`}
          >
            <div className="sh-tl-bar" style={{ height: `${h}%` }}>
              <div className="sh-tl-cloud" style={{ height: `${(1 - localFrac) * 100}%` }} />
              <div className="sh-tl-local" style={{ height: `${localFrac * 100}%` }} />
            </div>
            <span className="sh-tl-label">{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function SealBand({ health }: { health: StackHealth }) {
  // Pulse the wave stamp the moment encryption-at-rest first reads as fully
  // sealed: the one instant this screen has earned a small celebration. Track
  // the PREVIOUS state so a screen that mounts already-green stays quiet (the
  // pulse marks a transition, not a status), and never re-fires on later
  // re-fetches once green is reached.
  const encrypted = health.seal.find((f) => f.key === 'encryptedAtRest');
  const prevGoodRef = useRef<boolean | undefined>(encrypted?.state === 'good');
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    const isGood = encrypted?.state === 'good';
    if (isGood && prevGoodRef.current === false) {
      setPulse(true);
      hapticSuccess();
      const t = setTimeout(() => setPulse(false), 500);
      prevGoodRef.current = true;
      return () => clearTimeout(t);
    }
    prevGoodRef.current = isGood;
  }, [encrypted?.state]);

  return (
    <div className="sh-seal" role="group" aria-label="Privacy seal">
      <span className={`sh-seal-mark${pulse ? ' sh-seal-mark-pulse' : ''}`} aria-hidden="true">
        <svg
          viewBox="0 0 32 32"
          width="26"
          height="26"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="16" cy="16" r="13" opacity="0.5" />
          <path d="M7 18q4.5-3.3 9 0t9 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <ul className="sh-seal-facts">
        {health.seal.map((f) => (
          <li className={`sh-seal-fact sh-${f.state}`} key={f.key}>
            <span className="sh-seal-dot" aria-hidden="true" />
            {f.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function roleLabel(role: string): string {
  if (role === 'orchestrator') return 'Quarterback';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function StackHealthScreen() {
  const { settings } = useApp();
  const [range, setRange] = useState<StackHealthRange>('week');
  const [health, setHealth] = useState<StackHealth | undefined>();
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'unreachable' | 'error'>(
    'loading',
  );
  const [animate, setAnimate] = useState(false);
  const daemon = settings.daemon;

  useEffect(() => {
    let live = true;
    setState('loading');
    setAnimate(false);
    loadAppStackHealth(range, daemon)
      .then((r) => {
        if (!live) return;
        if (r.kind === 'ready') {
          setHealth(r.health);
          setState('ready');
          // Let the first paint settle, then release the ring/sparkline fills.
          requestAnimationFrame(() => requestAnimationFrame(() => live && setAnimate(true)));
        } else {
          setState(r.kind);
        }
      })
      .catch(() => live && setState('error'));
    return () => {
      live = false;
    };
  }, [range, daemon]);

  const saved = useCountUp(health?.savedDollars ?? 0);
  // The founder singled out water: it is the count-up beat on the green section.
  const waterAvoided = useCountUp((health?.sustainability.avoided.liters ?? 0) * 1000);

  const basis = health?.savingsBasis.model ?? 'Claude Sonnet';
  const crew = useMemo(() => health?.crew ?? [], [health]);

  return (
    <div className="screen sh-screen">
      <BackBar title="Stack Health" />

      {state === 'ready' && health ? <SealBand health={health} /> : null}

      <div className="screen-inner">
        <h1>Stack Health</h1>
        <p className="lead">
          How your stack is really working, read on your own machine. Nothing here leaves this
          device.
        </p>

        <div className="sh-segment" role="tablist" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              role="tab"
              aria-selected={range === r.id}
              className={`sh-seg-btn${range === r.id ? ' active' : ''}`}
              onClick={() => {
                if (r.id !== range) setRange(r.id);
              }}
            >
              {r.label}
            </button>
          ))}
        </div>

        {state === 'loading' ? <p className="hint">Reading your sessions...</p> : null}
        {state === 'error' ? (
          <p className="hint">Could not read Stack Health right now. Try again in a moment.</p>
        ) : null}
        {state === 'none' ? (
          <div className="card" style={{ marginTop: 12 }}>
            <h3>See it on every device you pair</h3>
            <p className="sub" style={{ marginTop: 6 }}>
              Stack Health reads the sessions on the machine that runs your models. Pair this phone
              with your hub and it shows up here too, folded on that machine and sent as a summary.
              Your phone stays a window onto it, never a copy. On your Mac or PC, open OpenShore to
              see it directly.
            </p>
          </div>
        ) : null}
        {state === 'unreachable' ? (
          <div className="card" style={{ marginTop: 12 }}>
            <h3>Your hub is not answering</h3>
            <p className="sub" style={{ marginTop: 6 }}>
              Stack Health is folded on the machine that runs your models. It looks asleep or off
              your network right now. Wake it, or check you are both on the same Tailscale network,
              and pull to try again.
            </p>
          </div>
        ) : null}

        {state === 'ready' && health && health.empty ? (
          <div className="card" style={{ marginTop: 12 }}>
            <h3>No runs yet in this window</h3>
            <p className="sub" style={{ marginTop: 6 }}>
              Once you build with your stack, this fills in: how much stayed local, what you saved,
              and how your crew is doing. Come back after a session or two.
            </p>
          </div>
        ) : null}

        {state === 'ready' && health && !health.empty ? (
          <>
            {/* Rings + the count-up trophy line. */}
            <section className="sh-hero">
              <div className="sh-rings-wrap">
                <Rings health={health} animate={animate} />
                <div className="sh-rings-center">
                  <span className="sh-rings-pct">{pct(health.privacyRing.fraction)}%</span>
                  <span className="sh-rings-cap">local</span>
                </div>
              </div>
              <div className="sh-hero-copy">
                <p className="sh-saved">
                  <span className="sh-saved-sign">~</span>
                  <span className="sh-saved-num">{money(saved)}</span>
                </p>
                <p className="sh-saved-line">
                  of {basis}-equivalent work ran on your own hardware.
                </p>
                <p className="sh-saved-paid">You paid {money(health.cloudDollars)} to the cloud.</p>
              </div>
            </section>

            {/* Ring legend, so the three colors are named once. */}
            <div className="sh-legend">
              <span className="sh-legend-item sh-lg-local">
                Local {pct(health.privacyRing.fraction)}%
              </span>
              <span className="sh-legend-item sh-lg-flow">
                Flow {pct(health.flowRing.fraction)}%
              </span>
              <span className="sh-legend-item sh-lg-saved">
                Saved {pct(health.savedRing.fraction)}%
              </span>
            </div>

            {/* The greener way to build: energy, water, and carbon your local
                work kept off the grid versus the same work in a data center. */}
            <section className="card sh-card sh-green">
              <p className="sh-eyebrow">The greener way to build</p>
              <div className="sh-green-hero">
                <span className="sh-green-num">{water(waterAvoided / 1000)}</span>
                <span className="sh-green-cap">of water not drawn from a data center</span>
              </div>
              <div className="sh-green-grid">
                <div className="sh-green-tile">
                  <span className="sh-green-tile-num">{energy(health.sustainability.avoided.kwh)}</span>
                  <span className="sh-green-tile-cap">energy avoided</span>
                </div>
                <div className="sh-green-tile">
                  <span className="sh-green-tile-num">
                    {carbon(health.sustainability.avoided.grams)}
                  </span>
                  <span className="sh-green-tile-cap">CO2e avoided</span>
                </div>
                <div className="sh-green-tile">
                  <span className="sh-green-tile-num">
                    {pct(
                      health.sustainability.cloudCounterfactual.kwh > 0
                        ? health.sustainability.avoided.kwh /
                            health.sustainability.cloudCounterfactual.kwh
                        : 0,
                    )}
                    %
                  </span>
                  <span className="sh-green-tile-cap">lighter than the cloud</span>
                </div>
              </div>
              {equivalent(health.sustainability.avoided) ? (
                <p className="sub sh-card-read">
                  Running local this period was about {equivalent(health.sustainability.avoided)},
                  versus the same work on {basis} in a hyperscale data center.
                </p>
              ) : (
                <p className="sub sh-card-read">
                  Build a little more with local models and this fills in: the energy, water, and
                  carbon your own hardware keeps off the grid.
                </p>
              )}
              {health.sustainability.cloudActual.kwh > 0 ? (
                <p className="hint sh-crew-note">
                  Your cloud turns this period drew about {energy(health.sustainability.cloudActual.kwh)}{' '}
                  and {water(health.sustainability.cloudActual.liters)} of water in a data center.
                </p>
              ) : null}
              <p className="hint sh-green-basis">
                An estimate, not a meter. Local work is repriced at published energy, grid carbon,
                and data-center water intensities. Assumptions travel with the number and stay
                conservative.
              </p>
            </section>

            {/* Where your work goes, over time. */}
            <section className="card sh-card">
              <p className="sh-eyebrow">Where your work goes</p>
              <Timeline health={health} />
              <p className="sub sh-card-read">
                {health.privacyRing.localTurns} turns local, {health.privacyRing.cloudTurns} in the
                cloud. {health.cloudFlips} {health.cloudFlips === 1 ? 'flip' : 'flips'} to the cloud
                this period.
              </p>
            </section>

            {/* The Crew: today the configured stack, per role. */}
            {crew.length ? (
              <section className="card sh-card">
                <p className="sh-eyebrow">Your crew</p>
                <div className="sh-crew">
                  {crew.map((m, i) => (
                    <div
                      className={`sh-crew-card${m.kind === 'cloud' ? ' cloud' : ' local'}${i === 0 ? ' lead' : ''}`}
                      key={`${m.role}-${m.model}-${i}`}
                    >
                      <span className="crew-monogram" aria-hidden="true">
                        {(m.model.trim()[0] ?? '?').toUpperCase()}
                      </span>
                      <div className="grow">
                        <h3 className="sh-crew-role">{roleLabel(m.role)}</h3>
                        <div className="sub sh-crew-model">{m.model || 'not set'}</div>
                      </div>
                      <div className="sh-crew-stat">
                        <span className="sh-crew-turns">{m.turns}</span>
                        <span className="sh-crew-turns-cap">turns</span>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="hint sh-crew-note">
                  Today this is your configured stack. Named agents with their own stats are coming.
                </p>
              </section>
            ) : null}

            {/* Trust: tools run, and what you held back. */}
            <section className="card sh-card">
              <p className="sh-eyebrow">Trust and control</p>
              <div className="sh-stats">
                <div className="sh-stat">
                  <span className="sh-stat-num">{health.tools.runs}</span>
                  <span className="sh-stat-cap">tools run</span>
                </div>
                <div className="sh-stat">
                  <span className="sh-stat-num">{health.tools.approvalsDenied}</span>
                  <span className="sh-stat-cap">you declined</span>
                </div>
                <div className="sh-stat">
                  <span className="sh-stat-num">{health.outcomes.complete}</span>
                  <span className="sh-stat-cap">tasks done</span>
                </div>
              </div>
              <p className="sub sh-card-read">
                {health.flowRing.tasksDone} of {health.flowRing.tasksAttempted} tasks finished. You
                stayed in control: {health.tools.approvalsRequested} approvals asked,{' '}
                {health.tools.approvalsDenied} declined.
              </p>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
