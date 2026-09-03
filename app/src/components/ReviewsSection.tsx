// The community reviews surface on a model's product page: the room, next to
// the benchmark instrument. It is a SEPARATE axis from "OpenShore fit" (warm
// --voice, always a count), so the two are never confused. A review is a run
// report: a star plus the hardware and felt speed it ran at, which is what lets
// the store answer "how does it run on a machine like mine."
//
// Everything degrades gracefully: with Supabase unconfigured, or offline, or no
// reviews yet, this shows the cold-start invitation rather than an error or a
// dead widget. Writing needs a signed-in account; reading does not.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CatalogModel } from 'os-code/protocol';
import type { Session } from '../lib/supabase.js';
import {
  communityScore,
  containsObjectionable,
  hardwareSignal,
  ranItLabel,
  type CommunityScore,
  type ReviewRow,
  type ReviewSummary,
} from '../lib/reviewsMath.js';
import {
  REVIEW_EULA_VERSION,
  acceptEula,
  blockUser,
  deleteOwnReview,
  fetchReviews,
  fetchSummary,
  hasAcceptedEula,
  reportReview,
  reviewsAvailable,
  submitReview,
} from '../lib/reviews.js';
import { CommunityStars, Stars } from './Stars.js';
import { Sheet } from './Sheet.js';
import { hapticSuccess, hapticTick } from '../lib/haptics.js';

type Speed = 'snappy' | 'usable' | 'slow';

export interface ReviewsSectionProps {
  model: CatalogModel;
  /** The benchmark OpenShore-fit stars, the prior a sparse average shrinks to. */
  benchmarkStars?: number;
  session?: Session;
  /** This device's memory, GB, for the "machines like yours" read and prefill. */
  deviceRamGB?: number;
  /** A plain-language prefill for the hardware field, editable by the reviewer. */
  hardwarePrefill?: string;
  showToast: (msg: string) => void;
  /** Invoked when a signed-out user taps to write; the host routes to sign-in. */
  onNeedSignIn: () => void;
}

const SPEEDS: { key: Speed; label: string }[] = [
  { key: 'snappy', label: 'Snappy' },
  { key: 'usable', label: 'Usable' },
  { key: 'slow', label: 'Slow' },
];

export function ReviewsSection({
  model,
  benchmarkStars,
  session,
  deviceRamGB,
  hardwarePrefill,
  showToast,
  onNeedSignIn,
}: ReviewsSectionProps) {
  const [summary, setSummary] = useState<ReviewSummary | undefined>();
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);

  const load = useCallback(async () => {
    if (!reviewsAvailable()) {
      setLoaded(true);
      return;
    }
    const [s, r] = await Promise.all([
      fetchSummary(model.id, session),
      fetchReviews(model.id, session),
    ]);
    setSummary(s);
    setReviews(r);
    setLoaded(true);
  }, [model.id, session]);

  useEffect(() => {
    setLoaded(false);
    setSummary(undefined);
    setReviews([]);
    void load();
  }, [load]);

  const score: CommunityScore = communityScore(summary, benchmarkStars);
  const signal = hardwareSignal(reviews, deviceRamGB);
  const mine = session ? reviews.find((r) => r.user_id === session.user.id) : undefined;

  if (!reviewsAvailable()) return null; // no community layer on this build

  const openWrite = () => {
    if (!session) {
      onNeedSignIn();
      return;
    }
    hapticTick();
    setSheetOpen(true);
  };

  const onReport = async (r: ReviewRow) => {
    if (!session) return onNeedSignIn();
    try {
      await reportReview(session, r.id);
      showToast('Reported. Our team will take a look.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not report that review.');
    }
  };

  const onBlock = async (r: ReviewRow) => {
    if (!session) return onNeedSignIn();
    try {
      await blockUser(session, r.user_id);
      setReviews((list) => list.filter((x) => x.user_id !== r.user_id));
      showToast('Blocked. You will not see their reviews.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not block that user.');
    }
  };

  const afterSubmit = async () => {
    setSheetOpen(false);
    await load();
    // The lux beat: the distribution settles and the count pops on return.
    setJustSubmitted(true);
    hapticSuccess();
    setTimeout(() => setJustSubmitted(false), 700);
  };

  const total = score.dist[1] + score.dist[2] + score.dist[3] + score.dist[4] + score.dist[5];

  return (
    <section className="reviews">
      <div className="osfit-divider" />
      <div className="reviews-head">
        <h3 className="reviews-title">The room</h3>
        <span className="reviews-sub">Rated by people who ran it.</span>
      </div>

      {!loaded ? (
        <p className="hint">Loading run reports.</p>
      ) : score.count === 0 ? (
        // Cold start: an open door, never a zero-star or a dead widget.
        <div className="reviews-cold">
          <CommunityStars score={score} invite size={22} />
          <p className="reviews-cold-lead">Be the first who runs it.</p>
          <p className="reviews-cold-sub">
            Ran it on your machine? Tell the next person how it felt.
          </p>
          <button className="btn primary press-fb" onClick={openWrite}>
            Write the first run report
          </button>
        </div>
      ) : (
        <>
          <div className="reviews-summary">
            <div className={`reviews-avg${justSubmitted ? ' pop' : ''}`}>
              {score.hasAverage ? (
                <span className="reviews-avg-num">{score.average.toFixed(1)}</span>
              ) : (
                <span className="reviews-avg-num muted">.</span>
              )}
              <CommunityStars score={score} size={16} />
            </div>
            <div className="reviews-dist" aria-hidden="true">
              {[5, 4, 3, 2, 1].map((star) => {
                const c = score.dist[star as 1 | 2 | 3 | 4 | 5];
                const frac = total ? c / total : 0;
                return (
                  <div className="dist-row" key={star}>
                    <span className="dist-star">{star}</span>
                    <span className="dist-track">
                      <span className="dist-fill" style={{ transform: `scaleX(${frac})` }} />
                    </span>
                    <span className="dist-count">{c}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {!score.hasAverage ? (
            <p className="hint reviews-early">
              {ranItLabel(score.count)}. A few more and an average appears.
            </p>
          ) : null}

          {signal ? (
            <p className="reviews-signal">
              {signal.count === 1 ? '1 person' : `${signal.count} people`} on machines like yours
              {signal.medianTokensPerSec
                ? ` ran it around ${signal.medianTokensPerSec} tokens per second.`
                : ' ran it.'}
            </p>
          ) : null}

          <div className="reviews-list">
            {reviews.map((r, i) => (
              <ReviewRowView
                key={r.id}
                r={r}
                mine={session?.user.id === r.user_id}
                index={i}
                onReport={() => void onReport(r)}
                onBlock={() => void onBlock(r)}
              />
            ))}
          </div>

          <button className="btn ghost press-fb reviews-cta" onClick={openWrite}>
            {mine ? 'Edit your run report' : 'Add your run report'}
          </button>
        </>
      )}

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
        {sheetOpen && session ? (
          <WriteReview
            model={model}
            session={session}
            existing={mine}
            deviceRamGB={deviceRamGB}
            hardwarePrefill={hardwarePrefill}
            onDone={() => void afterSubmit()}
            onDelete={async () => {
              try {
                await deleteOwnReview(session, model.id);
                showToast('Your run report was removed.');
                await afterSubmit();
              } catch (err) {
                showToast(err instanceof Error ? err.message : 'Could not remove it.');
              }
            }}
            showToast={showToast}
          />
        ) : null}
      </Sheet>
    </section>
  );
}

function ReviewRowView({
  r,
  mine,
  index,
  onReport,
  onBlock,
}: {
  r: ReviewRow;
  mine: boolean;
  index: number;
  onReport: () => void;
  onBlock: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const chips = [r.hardware, r.tokens_per_sec ? `${r.tokens_per_sec} tok/s` : undefined, r.quant]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="review-row" style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}>
      <div className="review-row-head">
        <Stars value={r.rating} size={12} fill="var(--voice)" label={`${r.rating} out of 5`} />
        {mine ? <span className="review-mine">You</span> : null}
        <button
          className="review-more"
          aria-label="Review options"
          onClick={() => setMenu((m) => !m)}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
        </button>
      </div>
      {r.body ? <p className="review-body">{r.body}</p> : null}
      {chips ? <div className="review-chips">{chips}</div> : null}
      {menu && !mine ? (
        <div className="review-menu">
          <button
            className="review-menu-item"
            onClick={() => {
              setMenu(false);
              onReport();
            }}
          >
            Report this review
          </button>
          <button
            className="review-menu-item"
            onClick={() => {
              setMenu(false);
              onBlock();
            }}
          >
            Block this user
          </button>
        </div>
      ) : null}
    </div>
  );
}

function WriteReview({
  model,
  session,
  existing,
  deviceRamGB,
  hardwarePrefill,
  onDone,
  onDelete,
  showToast,
}: {
  model: CatalogModel;
  session: Session;
  existing?: ReviewRow;
  deviceRamGB?: number;
  hardwarePrefill?: string;
  onDone: () => void;
  onDelete: () => void;
  showToast: (msg: string) => void;
}) {
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [body, setBody] = useState(existing?.body ?? '');
  const [hardware, setHardware] = useState(existing?.hardware ?? hardwarePrefill ?? '');
  const [tokensPerSec, setTokensPerSec] = useState(
    existing?.tokens_per_sec ? String(existing.tokens_per_sec) : '',
  );
  const [quant, setQuant] = useState(existing?.quant ?? model.quantization ?? '');
  const [speed, setSpeed] = useState<Speed | undefined>(existing?.felt_speed ?? undefined);
  const [useCases, setUseCases] = useState<string[]>(existing?.use_cases ?? []);
  const [busy, setBusy] = useState(false);
  const eulaChecked = useRef(false);
  const [needEula, setNeedEula] = useState(false);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    void hasAcceptedEula(session).then((ok) => {
      eulaChecked.current = true;
      setNeedEula(!ok);
    });
  }, [session]);

  const toggleUse = (c: string) =>
    setUseCases((list) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]));

  const submit = async () => {
    if (rating < 1) {
      showToast('Tap a star to rate it first.');
      return;
    }
    if (needEula && !agreed) {
      showToast('Please accept the community terms to post.');
      return;
    }
    if (containsObjectionable(body)) {
      showToast('That note breaks the community guidelines. Please revise it.');
      return;
    }
    setBusy(true);
    try {
      if (needEula) await acceptEula(session);
      await submitReview(session, {
        modelId: model.id,
        rating,
        body,
        useCases,
        hardware,
        ramGB: deviceRamGB,
        tokensPerSec: tokensPerSec ? Number(tokensPerSec) : undefined,
        quant,
        feltSpeed: speed,
      });
      onDone();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not post your run report.');
      setBusy(false);
    }
  };

  return (
    <div className="write-review">
      <h2>{existing ? 'Your run report' : 'Write a run report'}</h2>
      <div className="sheet-sub">{model.name}</div>

      <div className="write-stars" role="radiogroup" aria-label="Your rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            className={`write-star press-fb${n <= rating ? ' on' : ''}`}
            role="radio"
            aria-checked={n === rating}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            onClick={() => {
              hapticTick();
              setRating(n);
            }}
          >
            <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
              <path
                d="M12 2.2l2.9 6.26 6.85.72-5.1 4.62 1.42 6.74L12 17.6l-6.08 3.94 1.42-6.74-5.1-4.62 6.85-.72z"
                fill={n <= rating ? 'var(--voice)' : 'none'}
                stroke="var(--voice)"
                strokeWidth="1.4"
              />
            </svg>
          </button>
        ))}
      </div>

      <label className="write-label">How did it feel to run?</label>
      <textarea
        className="write-body"
        placeholder="What you ran it for, how it held up, anything the next person should know."
        value={body}
        maxLength={2000}
        onChange={(e) => setBody(e.target.value)}
      />

      {model.categories.length ? (
        <>
          <label className="write-label">What did you run it for?</label>
          <div className="write-chips">
            {model.categories.map((c) => (
              <button
                key={c}
                className={`write-chip${useCases.includes(c) ? ' on' : ''}`}
                onClick={() => toggleUse(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <label className="write-label">The run (helps the next person)</label>
      <div className="write-field">
        <span className="write-field-label">Hardware</span>
        <input
          value={hardware}
          placeholder="e.g. M3 Max, 36 GB"
          onChange={(e) => setHardware(e.target.value)}
        />
      </div>
      <div className="write-field">
        <span className="write-field-label">Tokens per second</span>
        <input
          value={tokensPerSec}
          inputMode="decimal"
          placeholder="optional"
          onChange={(e) => setTokensPerSec(e.target.value.replace(/[^0-9.]/g, ''))}
        />
      </div>
      <div className="write-field">
        <span className="write-field-label">Quant</span>
        <input value={quant} onChange={(e) => setQuant(e.target.value)} />
      </div>
      <div className="write-chips">
        {SPEEDS.map((s) => (
          <button
            key={s.key}
            className={`write-chip${speed === s.key ? ' on' : ''}`}
            onClick={() => setSpeed(speed === s.key ? undefined : s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {needEula ? (
        <label className="write-eula">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>
            I agree to the community guidelines and to a zero-tolerance policy for objectionable
            content. Reviews that break the rules are removed and repeat offenders are banned.
            (Terms {REVIEW_EULA_VERSION}.)
          </span>
        </label>
      ) : null}

      <div className="sheet-actions">
        <button className="btn primary press-fb" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Posting...' : existing ? 'Update' : 'Post run report'}
        </button>
        {existing ? (
          <button className="btn quiet press-fb" disabled={busy} onClick={onDelete}>
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}
