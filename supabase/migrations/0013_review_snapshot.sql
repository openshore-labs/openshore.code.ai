-- The reviews scale path (CTO): a whole-catalog aggregate snapshot the daily
-- catalog builder reads once per build and bakes into catalog.json, so the
-- browse list can show a community star per row straight from the shipped
-- catalog, with ZERO per-view requests to Supabase. The live per-model RPCs
-- (model_review_summary, model_review_summaries) stay exactly as they were and
-- still serve the product page (where a reader who taps in wants the live
-- number). This function only makes browse cheap at scale; it changes nothing
-- about how a single model's reviews are read.
--
-- Unlike model_review_summaries, this takes no id list: it returns count and
-- average for EVERY model that has visible reviews, in one call, so the builder
-- never has to enumerate hundreds of catalog ids to ask about. It is a plain
-- aggregate over visible rows only (never SECURITY DEFINER), so it is as safe
-- for anon to call as the existing summary RPCs, and the builder can read it
-- with the anon key. Models with no visible reviews are simply absent from the
-- result (the builder reads their absence as "0 reports as of this snapshot").
--
-- Deploy ordering: apply AFTER 0011 (it reads model_reviews). Additive; nothing
-- existing depends on it, and an un-applied 0013 just means the builder finds no
-- snapshot RPC and publishes a catalog without the baked aggregates, which the
-- app already handles (it falls back to the live browse RPC, today's behavior).

create or replace function public.model_review_snapshot ()
returns json
language sql
stable
as $$
  select coalesce(json_agg(r), '[]'::json)
  from (
    select model_id, count(*) as count, avg(rating) as average
    from public.model_reviews
    where status = 'visible'
    group by model_id
    order by model_id
  ) r;
$$;

-- Safe for anyone to call: aggregates over visible rows only, no row bodies, no
-- author ids. PostgREST exposes it at /rest/v1/rpc/model_review_snapshot.
grant execute on function public.model_review_snapshot () to anon, authenticated;
