// Stack Health: an Apple-Health-style read of how your AI stack is actually
// used, folded 100% locally by the engine from the sessions already on disk.
// Nothing here is sent anywhere; the screen only asks the engine to aggregate
// what it already wrote. Water teal is private/local, amber is cloud/spend, and
// every privacy fact is literally true, including the ones that are not green.
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackBar } from '../components/BackBar.js';
import { bridge } from '../lib/electronBridge.js';
import { hapticTick } from '../lib/haptics.js';
import type { StackHealth, StackHealthRange } from 'os-code/protocol';

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
  gradient: [string, string];
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
      gradient: ['#24454f', '#4b90a3'],
      radius: 86,
    },
    {
      key: 'flow',
      fraction: health.flowRing.fraction,
      gradient: ['#5a6b72', '#8aa0a8'],
      radius: 66,
    },
    {
      key: 'saved',
      fraction: health.savedRing.fraction,
      gradient: ['#a35f0a', '#e0902f'],
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
            <stop offset="0%" stopColor={r.gradient[0]} />
            <stop offset="100%" stopColor={r.gradient[1]} />
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
  return (
    <div className="sh-seal" role="group" aria-label="Privacy seal">
      <span className="sh-seal-mark" aria-hidden="true">
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
  const [range, setRange] = useState<StackHealthRange>('week');
  const [health, setHealth] = useState<StackHealth | undefined>();
  const [state, setState] = useState<'loading' | 'ready' | 'nobridge' | 'error'>('loading');
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const b = bridge();
    if (!b) {
      setState('nobridge');
      return;
    }
    let live = true;
    setState('loading');
    setAnimate(false);
    b.stackHealth(range)
      .then((h) => {
        if (!live) return;
        setHealth(h);
        setState('ready');
        // Let the first paint settle, then release the ring/sparkline fills.
        requestAnimationFrame(() => requestAnimationFrame(() => live && setAnimate(true)));
      })
      .catch(() => live && setState('error'));
    return () => {
      live = false;
    };
  }, [range]);

  const saved = useCountUp(health?.savedDollars ?? 0);

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
                if (r.id !== range) {
                  hapticTick();
                  setRange(r.id);
                }
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
        {state === 'nobridge' ? (
          <div className="card" style={{ marginTop: 12 }}>
            <h3>Stack Health lives on your desktop</h3>
            <p className="sub" style={{ marginTop: 6 }}>
              It reads the sessions stored on the machine that runs your models. Open OS Code on
              your Mac or PC to see it. Your phone stays a window onto that machine, never a copy of
              it.
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
