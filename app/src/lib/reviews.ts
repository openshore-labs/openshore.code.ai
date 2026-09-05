// Community reviews: the network layer over Supabase (PostgREST + the aggregate
// RPC). All the honesty and hardware math lives in reviewsMath.ts; this file
// only reads and writes. Reads work signed-out (the store browses local-first),
// writes need a session. When Supabase is not configured on the build, every
// call degrades to "no reviews," so the store runs exactly as before.
import {
  del,
  insert,
  isConfigured,
  rpcPublic,
  selectPublic,
  upsert,
  type Session,
} from './supabase.js';
import { freshSession } from './authSession.js';
import type { ReviewRow, ReviewSummary } from './reviewsMath.js';

const REVIEWS = 'model_reviews';
const REPORTS = 'review_reports';
const BLOCKS = 'user_blocks';
const EULA = 'review_eula_acceptance';

/** The EULA version a reviewer must accept before their first review. Bump this
 *  when the terms change so acceptance is re-collected. */
export const REVIEW_EULA_VERSION = '2026-09-03';

const REVIEW_COLS =
  'id,user_id,model_id,rating,body,use_cases,hardware,ram_gb,tokens_per_sec,quant,felt_speed,created_at';

/** Whether the community layer can function on this build at all. */
export function reviewsAvailable(): boolean {
  return isConfigured();
}

async function tokenFor(session?: Session): Promise<string | undefined> {
  if (!session) return undefined;
  try {
    return (await freshSession(session)).accessToken;
  } catch {
    return undefined;
  }
}

/** The visible reviews for a model, newest first, bounded. A signed-in reader's
 *  token is passed so their blocks are applied by the read policy. */
export async function fetchReviews(
  modelId: string,
  session?: Session,
  limit = 50,
): Promise<ReviewRow[]> {
  if (!isConfigured()) return [];
  const token = await tokenFor(session);
  const q =
    `select=${REVIEW_COLS}&model_id=eq.${encodeURIComponent(modelId)}` +
    `&order=created_at.desc&limit=${limit}`;
  try {
    return await selectPublic<ReviewRow>(REVIEWS, q, token);
  } catch {
    return [];
  }
}

/** The server-computed summary (average, count, distribution) over visible rows
 *  only, so the client never pulls every row to average. Undefined when
 *  unconfigured or the read fails. */
export async function fetchSummary(
  modelId: string,
  session?: Session,
): Promise<ReviewSummary | undefined> {
  if (!isConfigured()) return undefined;
  const token = await tokenFor(session);
  try {
    const res = await rpcPublic<{
      count: number | string;
      average: number | string;
      dist: Record<string, number | string>;
    }>('model_review_summary', { p_model_id: modelId }, token);
    if (!res) return undefined;
    const d = res.dist ?? {};
    return {
      count: Number(res.count ?? 0),
      average: Number(res.average ?? 0),
      dist: {
        1: Number(d['1'] ?? 0),
        2: Number(d['2'] ?? 0),
        3: Number(d['3'] ?? 0),
        4: Number(d['4'] ?? 0),
        5: Number(d['5'] ?? 0),
      },
    };
  } catch {
    return undefined;
  }
}

/** A light count+average for many models at once, for the browse rows. One
 *  call, aggregates only (no bodies), over visible rows. */
export async function fetchSummaries(
  modelIds: string[],
  session?: Session,
): Promise<Map<string, { count: number; average: number }>> {
  const map = new Map<string, { count: number; average: number }>();
  if (!isConfigured() || modelIds.length === 0) return map;
  const token = await tokenFor(session);
  try {
    const rows = await rpcPublic<
      Array<{ model_id: string; count: number | string; average: number | string }>
    >('model_review_summaries', { p_model_ids: modelIds }, token);
    for (const r of rows ?? []) {
      map.set(r.model_id, { count: Number(r.count ?? 0), average: Number(r.average ?? 0) });
    }
  } catch {
    // Leave the map empty: rows fall back to benchmark stars only.
  }
  return map;
}

export interface ReviewDraft {
  modelId: string;
  rating: number;
  body?: string;
  useCases?: string[];
  hardware?: string;
  ramGB?: number;
  tokensPerSec?: number;
  quant?: string;
  feltSpeed?: 'snappy' | 'usable' | 'slow';
}

/** The row a review submit sends. Exactly the columns the server grants an
 *  author (migration 0015, BE-6): never `status`, `flag_count`, or
 *  `created_at`, which moderation owns. A payload carrying one of those is
 *  refused by the column grant, so this shape is pinned by a test. */
export function reviewPayload(
  userId: string,
  draft: ReviewDraft,
  now: Date = new Date(),
): Record<string, unknown> {
  return {
    user_id: userId,
    model_id: draft.modelId,
    rating: draft.rating,
    body: draft.body?.trim() || null,
    use_cases: draft.useCases ?? [],
    hardware: draft.hardware?.trim() || null,
    ram_gb: draft.ramGB ?? null,
    tokens_per_sec: draft.tokensPerSec ?? null,
    quant: draft.quant?.trim() || null,
    felt_speed: draft.feltSpeed ?? null,
    updated_at: now.toISOString(),
  };
}

/** Submit (or update) the signed-in user's review for a model. One row per user
 *  per model: a second submit merges onto the same row (the unique constraint).
 *  The reviewer's own id comes from the session, never the client's claim. A
 *  review that moderation has hidden cannot be re-submitted: the server's
 *  update policy refuses it, and the error surfaces to the caller. */
export async function submitReview(session: Session, draft: ReviewDraft): Promise<void> {
  const token = await tokenFor(session);
  if (!token) throw new Error('Sign in to write a review.');
  await upsert(REVIEWS, token, reviewPayload(session.user.id, draft), 'user_id,model_id');
}

/** Remove the signed-in user's own review for a model. */
export async function deleteOwnReview(session: Session, modelId: string): Promise<void> {
  const token = await tokenFor(session);
  if (!token) throw new Error('Sign in to manage your review.');
  await del(
    REVIEWS,
    token,
    `user_id=eq.${session.user.id}&model_id=eq.${encodeURIComponent(modelId)}`,
  );
}

/** Report a review as objectionable. The server trigger counts reports and
 *  auto-hides past a threshold pending moderation (Apple 1.2). */
export async function reportReview(
  session: Session,
  reviewId: string,
  reason?: string,
): Promise<void> {
  const token = await tokenFor(session);
  if (!token) throw new Error('Sign in to report a review.');
  await insert(REPORTS, token, {
    review_id: reviewId,
    reporter_id: session.user.id,
    reason: reason?.trim() || null,
  });
}

/** Block a reviewer, so their reviews no longer appear for this user (Apple
 *  1.2). Enforced at read time by the reviews select policy. */
export async function blockUser(session: Session, blockedId: string): Promise<void> {
  const token = await tokenFor(session);
  if (!token) throw new Error('Sign in to block a user.');
  await insert(BLOCKS, token, {
    blocker_id: session.user.id,
    blocked_id: blockedId,
  });
}

/** Whether this user has accepted the current review EULA. */
export async function hasAcceptedEula(session: Session): Promise<boolean> {
  const token = await tokenFor(session);
  if (!token) return false;
  try {
    const rows = await selectPublic<{ version: string }>(
      EULA,
      `select=version&user_id=eq.${session.user.id}&version=eq.${REVIEW_EULA_VERSION}`,
      token,
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

// -------------------------------------------------------------- moderation

/** One row in the moderation queue: a review plus its status and flag count. */
export interface ModeratedReview extends ReviewRow {
  status: 'visible' | 'reported' | 'hidden';
  flag_count: number;
}

/** Whether the signed-in user is a review moderator (an operator seeded into
 *  review_moderators). Decides whether the moderation surface shows at all. */
export async function isReviewModerator(session?: Session): Promise<boolean> {
  if (!isConfigured() || !session) return false;
  const token = await tokenFor(session);
  if (!token) return false;
  try {
    return (await rpcPublic<boolean>('is_review_moderator', {}, token)) === true;
  } catch {
    return false;
  }
}

/** The moderation queue: reported, hidden, or flagged reviews, most-flagged
 *  first. Empty for a non-moderator (the RPC refuses them). */
export async function listModerationQueue(session: Session): Promise<ModeratedReview[]> {
  const token = await tokenFor(session);
  if (!token) return [];
  try {
    return await rpcPublic<ModeratedReview[]>('admin_list_reviews', { p_limit: 100 }, token);
  } catch {
    return [];
  }
}

/** Hide, restore (visible), or re-flag a review as a moderator. Restoring
 *  clears its flag count so it is not immediately re-hidden. */
export async function setReviewStatus(
  session: Session,
  reviewId: string,
  status: 'visible' | 'hidden' | 'reported',
): Promise<void> {
  const token = await tokenFor(session);
  if (!token) throw new Error('Sign in as a moderator.');
  await rpcPublic('admin_set_review_status', { p_review_id: reviewId, p_status: status }, token);
}

/** Record acceptance of the current review EULA (required before a first
 *  review, Apple 1.2). */
export async function acceptEula(session: Session): Promise<void> {
  const token = await tokenFor(session);
  if (!token) throw new Error('Sign in to accept the terms.');
  await upsert(
    EULA,
    token,
    {
      user_id: session.user.id,
      version: REVIEW_EULA_VERSION,
      accepted_at: new Date().toISOString(),
    },
    'user_id',
  );
}
