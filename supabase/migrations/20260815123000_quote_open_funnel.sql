-- Priority 2 funnel: design → quote form open → quote submit
ALTER TABLE public.dealer_daily_stats
  ADD COLUMN IF NOT EXISTS quote_open_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.series_daily_stats
  ADD COLUMN IF NOT EXISTS quote_open_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.dealer_track(
  p_session_id uuid,
  p_event text,
  p_series_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_session public.dealer_sessions%rowtype;
  v_day date := (now() at time zone 'Europe/Istanbul')::date;
begin
  if p_event not in ('design', 'quote_open', 'quote') then
    return jsonb_build_object('ok', false, 'error', 'invalid_event');
  end if;

  select * into v_session
  from public.dealer_sessions
  where id = p_session_id and ended_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;

  update public.dealer_sessions set last_seen_at = now() where id = p_session_id;

  if p_event = 'design' then
    insert into public.dealer_daily_stats (dealer_id, day, design_count)
    values (v_session.dealer_id, v_day, 1)
    on conflict (dealer_id, day) do update
      set design_count = public.dealer_daily_stats.design_count + 1;

    if p_series_id is not null and length(trim(p_series_id)) > 0 then
      insert into public.series_daily_stats (day, series_id, design_count)
      values (v_day, lower(trim(p_series_id)), 1)
      on conflict (day, series_id) do update
        set design_count = public.series_daily_stats.design_count + 1;
    end if;

  elsif p_event = 'quote_open' then
    insert into public.dealer_daily_stats (dealer_id, day, quote_open_count)
    values (v_session.dealer_id, v_day, 1)
    on conflict (dealer_id, day) do update
      set quote_open_count = public.dealer_daily_stats.quote_open_count + 1;

    if p_series_id is not null and length(trim(p_series_id)) > 0 then
      insert into public.series_daily_stats (day, series_id, quote_open_count)
      values (v_day, lower(trim(p_series_id)), 1)
      on conflict (day, series_id) do update
        set quote_open_count = public.series_daily_stats.quote_open_count + 1;
    end if;

  else
    insert into public.dealer_daily_stats (dealer_id, day, quote_count)
    values (v_session.dealer_id, v_day, 1)
    on conflict (dealer_id, day) do update
      set quote_count = public.dealer_daily_stats.quote_count + 1;

    if p_series_id is not null and length(trim(p_series_id)) > 0 then
      insert into public.series_daily_stats (day, series_id, quote_count)
      values (v_day, lower(trim(p_series_id)), 1)
      on conflict (day, series_id) do update
        set quote_count = public.series_daily_stats.quote_count + 1;
    end if;
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;

-- admin_dashboard updated in same remote migration (quote_open_funnel);
-- keep repo copy by re-applying via MCP history; full body lives in DB.
