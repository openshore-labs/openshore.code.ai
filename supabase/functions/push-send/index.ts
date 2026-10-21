// Fire a content-free completion push. The desktop daemon calls this when a run
// finishes while idle, or blocks on an approval, and no phone is watching.
//
// Trust comes from the opaque grant in the body (verify_jwt=false, like the
// Stripe/Apple webhooks). The target user and device tokens are derived SOLELY
// from the grant, never from the request, so a leaked grant cannot be aimed at
// another user: the worst it can do is content-free banners to its own owner's
// devices, rate-limited, until the grant is revoked.
//
// The request carries only { grant, sessionId, kind, seq }. No code, no prompt,
// no titles from the run ever reach this function or Apple.
//
// What is kept: push_sends holds one row per push for the cooldown, the dedupe
// and the daily ceiling, and it never holds the session id itself, only a
// keyed one-way hash of it (HMAC-SHA256 under PUSH_SESSION_HASH_KEY, 0029), so
// the log cannot be matched to a session on the person's computer without the
// key. The retention job deletes the rows after 2 days (0027).
//
// The three checks run in one locked step in the database (0032's
// push_send_claim), so two sends at once cannot both slip under the daily
// ceiling. Until 0032 is applied the function is missing and push-send keeps
// its older count-then-insert checks, so the deploy order does not matter.
//
// What Apple sees: the banner, the kind, and the session id in the payload's
// data, which the phone needs to open that chat on a tap (lib/notices.ts
// decodeTap). The thread id that groups banners is the keyed hash instead,
// so the raw id rides only where the app reads it.
//
// A phone that received a push is marked as seen (push_devices.updated_at),
// so the 180-day clean-up (0027) never drops a phone in daily use.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PUSH_SESSION_HASH_KEY (at least
// 32 characters; without it nothing is sent, so a raw session id is never
// stored), and the APNS_* secrets used by _shared/apns.ts.
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import {
  claimMissing,
  hmacSha256Hex,
  readClaim,
  sessionHashKey,
  type ClaimOutcome,
} from "../_shared/push.ts";
import {
  apnsConfigured,
  sendApns,
  type ApsEnvironment,
} from "../_shared/apns.ts";

// A wedged daemon must not hammer APNs, and a leaked grant must not be able to
// notification-bomb the owner.
const DONE_COOLDOWN_MS = 15_000; // per session, for terminal "finished" pushes
const DAILY_CEILING = 200; // per user, across all sessions

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type Admin = SupabaseClient;

// The checks as push-send ran them before 0032: count, then insert. Kept for
// the window between this deploy and the migration; push_send_claim is the
// same three checks in the same order, under a lock.
async function claimWithoutLock(
  admin: Admin,
  userId: string,
  sessionHash: string,
  dedupeKey: string,
  kind: "approval" | "done",
): Promise<ClaimOutcome> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: sentToday, error: countErr } = await admin
    .from("push_sends")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", dayAgo);
  if (countErr) throw new Error(`push_sends count failed: ${countErr.message}`);
  if ((sentToday ?? 0) >= DAILY_CEILING) return "throttled";

  if (kind === "done") {
    const coolAgo = new Date(Date.now() - DONE_COOLDOWN_MS).toISOString();
    const { count: recent, error: recentErr } = await admin
      .from("push_sends")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("session_id", sessionHash)
      .gte("created_at", coolAgo);
    if (recentErr) {
      throw new Error(`push_sends cooldown check failed: ${recentErr.message}`);
    }
    if ((recent ?? 0) > 0) return "cooled";
  }

  const { error: dedupeErr } = await admin.from("push_sends").insert({
    user_id: userId,
    session_id: sessionHash,
    dedupe_key: dedupeKey,
  });
  if (dedupeErr) {
    // 23505 = unique_violation: already sent this exact push.
    if ((dedupeErr as { code?: string }).code === "23505") return "deduped";
    throw new Error(`push_sends insert failed: ${dedupeErr.message}`);
  }
  return "sent";
}

function messageFor(kind: "approval" | "done"): {
  title: string;
  body: string;
} {
  if (kind === "approval") {
    return {
      title: "OpenShore",
      body: "A session needs your approval to keep going.",
    };
  }
  return { title: "OpenShore", body: "Your session finished." };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders(req) });
  try {
    const hashKey = sessionHashKey(Deno.env.get("PUSH_SESSION_HASH_KEY"));
    if (!apnsConfigured() || !hashKey) {
      if (!hashKey) console.error("push-send: PUSH_SESSION_HASH_KEY is not set");
      return json(
        { error: "Push is not configured on the server yet." },
        503,
        req,
      );
    }

    const { grant, sessionId, kind, seq } = (await req
      .json()
      .catch(() => ({}))) as {
      grant?: string;
      sessionId?: string;
      kind?: string;
      seq?: number;
    };
    if (
      typeof grant !== "string" ||
      !grant ||
      typeof sessionId !== "string" ||
      !sessionId ||
      (kind !== "approval" && kind !== "done")
    ) {
      return json(
        { error: "grant, sessionId and a valid kind are required." },
        400,
        req,
      );
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Resolve the grant. A missing or revoked grant is a 403, and the response
    // deliberately reveals nothing about which.
    const tokenSha256 = await sha256Hex(grant);
    const { data: grantRow, error: grantErr } = await admin
      .from("push_grants")
      .select("id, user_id, sent_count, revoked_at")
      .eq("token_sha256", tokenSha256)
      .maybeSingle();
    if (grantErr)
      throw new Error(`push_grants read failed: ${grantErr.message}`);
    if (!grantRow || grantRow.revoked_at) {
      return json({ error: "That push grant is not valid." }, 403, req);
    }
    const userId = grantRow.user_id as string;
    // The only form of the session id this function stores or queries.
    const sessionHash = await hmacSha256Hex(hashKey, sessionId);

    // The daily ceiling across all of this user's sessions, the per-session
    // cooldown for terminal "finished" pushes (approvals are the run blocking
    // on the user and bypass it), and idempotency: one row per (user, dedupe
    // key), so a push-send retry does not buzz again. The dedupe key carries
    // the hash too, never the raw id.
    const dedupeKey = `${sessionHash}:${kind}:${seq ?? "na"}`;
    let outcome: ClaimOutcome;
    const { data: claimed, error: claimErr } = await admin.rpc(
      "push_send_claim",
      {
        p_user: userId,
        p_session_hash: sessionHash,
        p_dedupe_key: dedupeKey,
        p_kind: kind,
        p_daily_ceiling: DAILY_CEILING,
        p_cooldown_ms: DONE_COOLDOWN_MS,
      },
    );
    if (claimErr && claimMissing(claimErr)) {
      outcome = await claimWithoutLock(admin, userId, sessionHash, dedupeKey, kind);
    } else if (claimErr) {
      throw new Error(`push_send_claim failed: ${claimErr.message}`);
    } else {
      const read = readClaim(claimed);
      if (!read) throw new Error("push_send_claim gave no answer");
      outcome = read;
    }
    if (outcome === "throttled") return json({ ok: true, throttled: true }, 200, req);
    if (outcome === "cooled") return json({ ok: true, cooled: true }, 200, req);
    if (outcome === "deduped") return json({ ok: true, deduped: true }, 200, req);

    // Target devices come only from the grant's user, never from the request.
    const { data: devices, error: devErr } = await admin
      .from("push_devices")
      .select("device_token, aps_environment")
      .eq("user_id", userId);
    if (devErr) throw new Error(`push_devices read failed: ${devErr.message}`);

    const { title, body } = messageFor(kind);
    let sent = 0;
    const delivered: string[] = [];
    for (const device of devices ?? []) {
      const result = await sendApns({
        deviceToken: device.device_token as string,
        environment: device.aps_environment as ApsEnvironment,
        title,
        body,
        // Groups this session's banners; the keyed hash groups them as well
        // as the id would, and Apple keeps one copy of the id fewer.
        threadId: sessionHash,
        // The phone resolves the tap to its chat from this id.
        data: { sessionId, kind },
      });
      if (result.ok) {
        sent += 1;
        delivered.push(device.device_token as string);
        continue;
      }
      // A dead token (the app was deleted, or the token rotated): drop it so it
      // is not retried forever. Everything else is left in place.
      if (
        result.status === 410 ||
        result.reason === "Unregistered" ||
        result.reason === "BadDeviceToken"
      ) {
        await admin
          .from("push_devices")
          .delete()
          .eq("device_token", device.device_token);
      } else {
        console.error("apns send failed", result.status, result.reason);
      }
    }

    // A phone that took a push is in use: mark it seen, so the 180-day
    // clean-up (0027) only ever drops a phone that has gone quiet. Never
    // fails the send; the push already went out.
    if (delivered.length > 0) {
      try {
        const { error: seenErr } = await admin
          .from("push_devices")
          .update({ updated_at: new Date().toISOString() })
          .in("device_token", delivered);
        if (seenErr) console.error("push_devices seen update failed", seenErr.message);
      } catch (seenErr) {
        console.error("push_devices seen update failed", seenErr);
      }
    }

    await admin
      .from("push_grants")
      .update({
        last_sent_at: new Date().toISOString(),
        sent_count: Number(grantRow.sent_count ?? 0) + 1,
      })
      .eq("id", grantRow.id);

    return json({ ok: true, sent }, 200, req);
  } catch (err) {
    console.error("push-send error", err);
    return json({ error: "Could not send that push." }, 500, req);
  }
});
