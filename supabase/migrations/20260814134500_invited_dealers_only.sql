-- Kod ile girilen mağazaları kaldır; Auth davetindeki bayileri dealers tablosuna yaz.
CREATE OR REPLACE FUNCTION public.sync_dealer_from_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email text;
  v_name text;
  v_code text;
BEGIN
  IF NEW.email IS NULL OR length(trim(NEW.email)) = 0 THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.admin_profiles WHERE user_id = NEW.id) THEN
    DELETE FROM public.dealers WHERE auth_user_id = NEW.id;
    RETURN NEW;
  END IF;

  v_email := lower(trim(NEW.email));
  v_name := nullif(trim(coalesce(
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'full_name',
    ''
  )), '');
  IF v_name IS NULL THEN
    v_name := split_part(v_email, '@', 1);
  END IF;
  v_code := 'u-' || substr(replace(NEW.id::text, '-', ''), 1, 16);

  UPDATE public.dealers
  SET email = v_email,
      name = CASE
        WHEN name IS NULL OR name = '' OR name = email OR name = split_part(coalesce(email, ''), '@', 1)
          THEN v_name
        ELSE name
      END
  WHERE auth_user_id = NEW.id;

  IF FOUND THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.dealers (code, name, city, active, email, auth_user_id)
  VALUES (v_code, v_name, NULL, true, v_email, NEW.id);

  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    UPDATE public.dealers
    SET auth_user_id = NEW.id,
        email = v_email
    WHERE lower(email) = v_email
      AND auth_user_id IS NULL;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_auth_user_sync_dealer ON auth.users;
CREATE TRIGGER on_auth_user_sync_dealer
  AFTER INSERT OR UPDATE OF email, raw_user_meta_data ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.sync_dealer_from_auth_user();

CREATE OR REPLACE FUNCTION public.strip_dealer_if_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.dealers WHERE auth_user_id = NEW.user_id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS admin_profiles_strip_dealer ON public.admin_profiles;
CREATE TRIGGER admin_profiles_strip_dealer
  AFTER INSERT OR UPDATE OF user_id ON public.admin_profiles
  FOR EACH ROW
  EXECUTE PROCEDURE public.strip_dealer_if_admin();

DELETE FROM public.dealers WHERE auth_user_id IS NULL;
DELETE FROM public.dealers d
USING public.admin_profiles a
WHERE d.auth_user_id = a.user_id;

INSERT INTO public.dealers (code, name, city, active, email, auth_user_id)
SELECT
  'u-' || substr(replace(u.id::text, '-', ''), 1, 16),
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'display_name'), ''),
    nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
    split_part(u.email, '@', 1),
    'Mağaza'
  ),
  NULL,
  true,
  lower(trim(u.email)),
  u.id
FROM auth.users u
WHERE u.email IS NOT NULL
  AND length(trim(u.email)) > 0
  AND NOT EXISTS (SELECT 1 FROM public.admin_profiles a WHERE a.user_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM public.dealers d WHERE d.auth_user_id = u.id);

ALTER TABLE public.dealers
  DROP CONSTRAINT IF EXISTS dealers_auth_user_id_fkey;
ALTER TABLE public.dealers
  ADD CONSTRAINT dealers_auth_user_id_fkey
  FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.dealer_login_auth(
  p_user_agent text DEFAULT NULL,
  p_device_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed_at timestamptz;
  v_dealer public.dealers%rowtype;
  v_session_id uuid;
  v_active public.dealer_sessions%rowtype;
  v_device text := nullif(trim(coalesce(p_device_id, '')), '');
  v_stale interval := interval '15 minutes';
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF EXISTS (SELECT 1 FROM public.admin_profiles WHERE user_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_dealer');
  END IF;

  IF v_device IS NULL OR length(v_device) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_required');
  END IF;

  SELECT email, email_confirmed_at INTO v_email, v_confirmed_at
  FROM auth.users
  WHERE id = v_uid;

  IF v_email IS NULL OR length(trim(v_email)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_email');
  END IF;

  IF v_confirmed_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email_not_confirmed');
  END IF;

  v_email := lower(trim(v_email));

  SELECT * INTO v_dealer
  FROM public.dealers
  WHERE auth_user_id = v_uid
     OR (email IS NOT NULL AND lower(email) = v_email)
  ORDER BY CASE WHEN auth_user_id = v_uid THEN 0 ELSE 1 END
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_dealer');
  END IF;

  IF v_dealer.active IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'inactive');
  END IF;

  IF v_dealer.auth_user_id IS DISTINCT FROM v_uid OR v_dealer.email IS DISTINCT FROM v_email THEN
    UPDATE public.dealers
    SET auth_user_id = v_uid,
        email = v_email
    WHERE id = v_dealer.id;
    v_dealer.auth_user_id := v_uid;
    v_dealer.email := v_email;
  END IF;

  SELECT * INTO v_active
  FROM public.dealer_sessions
  WHERE dealer_id = v_dealer.id
    AND ended_at IS NULL
  ORDER BY last_seen_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_active.device_id IS NOT NULL AND v_active.device_id = v_device THEN
      UPDATE public.dealer_sessions
      SET last_seen_at = now(),
          user_agent = left(coalesce(p_user_agent, user_agent, ''), 400)
      WHERE id = v_active.id;

      RETURN jsonb_build_object(
        'ok', true,
        'session_id', v_active.id,
        'resumed', true,
        'dealer', jsonb_build_object(
          'id', v_dealer.id,
          'code', v_dealer.code,
          'name', v_dealer.name,
          'city', v_dealer.city,
          'email', v_dealer.email
        )
      );
    END IF;

    IF v_active.last_seen_at < now() - v_stale THEN
      UPDATE public.dealer_sessions
      SET ended_at = now()
      WHERE id = v_active.id AND ended_at IS NULL;
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'session_active');
    END IF;
  END IF;

  INSERT INTO public.dealer_sessions (dealer_id, user_agent, device_id)
  VALUES (v_dealer.id, left(coalesce(p_user_agent, ''), 400), v_device)
  RETURNING id INTO v_session_id;

  INSERT INTO public.dealer_daily_stats (dealer_id, day, session_count)
  VALUES (v_dealer.id, (now() AT TIME ZONE 'Europe/Istanbul')::date, 1)
  ON CONFLICT (dealer_id, day) DO UPDATE
    SET session_count = public.dealer_daily_stats.session_count + 1;

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', v_session_id,
    'dealer', jsonb_build_object(
      'id', v_dealer.id,
      'code', v_dealer.code,
      'name', v_dealer.name,
      'city', v_dealer.city,
      'email', v_dealer.email
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_dashboard(p_from date DEFAULT (((now() AT TIME ZONE 'Europe/Istanbul'::text))::date - 30), p_to date DEFAULT ((now() AT TIME ZONE 'Europe/Istanbul'::text))::date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_dealers jsonb;
  v_series jsonb;
  v_totals jsonb;
  v_daily jsonb;
  v_leads jsonb;
  v_live integer;
  v_inactive integer;
begin
  if not public.is_manufacturer_admin() then
    raise exception 'not_authorized';
  end if;

  select count(*)::int into v_live
  from public.dealer_sessions s
  join public.dealers d on d.id = s.dealer_id
  where s.ended_at is null
    and s.last_seen_at > now() - interval '3 minutes'
    and d.auth_user_id is not null
    and d.active is true;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.live desc, t.session_count desc, t.name), '[]'::jsonb)
  into v_dealers
  from (
    select
      d.id,
      d.code,
      d.name,
      d.city,
      d.email,
      (u.email_confirmed_at is not null) as email_confirmed,
      exists (
        select 1
        from public.dealer_sessions ls
        where ls.dealer_id = d.id
          and ls.ended_at is null
          and ls.last_seen_at > now() - interval '3 minutes'
      ) as live,
      coalesce(sum(s.session_count), 0)::int as session_count,
      coalesce(sum(s.active_seconds), 0)::int as active_seconds,
      coalesce(sum(s.design_count), 0)::int as design_count,
      coalesce(sum(s.quote_count), 0)::int as quote_count,
      case when coalesce(sum(s.session_count), 0) > 0
        then round(coalesce(sum(s.active_seconds), 0)::numeric / sum(s.session_count))
        else 0 end as avg_session_seconds,
      case when coalesce(sum(s.design_count), 0) > 0
        then round(100.0 * coalesce(sum(s.quote_count), 0) / sum(s.design_count), 1)
        else 0 end as design_to_quote_pct,
      case when coalesce(sum(s.session_count), 0) > 0
        then round(100.0 * coalesce(sum(s.quote_count), 0) / sum(s.session_count), 1)
        else 0 end as session_to_quote_pct
    from public.dealers d
    left join auth.users u on u.id = d.auth_user_id
    left join public.dealer_daily_stats s
      on s.dealer_id = d.id and s.day between p_from and p_to
    where d.active = true
      and d.auth_user_id is not null
    group by d.id, u.email_confirmed_at
  ) t;

  select count(*)::int into v_inactive
  from jsonb_array_elements(v_dealers) e
  where (e->>'session_count')::int = 0;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.design_count desc), '[]'::jsonb)
  into v_series
  from (
    select
      series_id,
      coalesce(sum(design_count), 0)::int as design_count,
      coalesce(sum(quote_count), 0)::int as quote_count,
      case when coalesce(sum(design_count), 0) > 0
        then round(100.0 * coalesce(sum(quote_count), 0) / sum(design_count), 1)
        else 0 end as design_to_quote_pct
    from public.series_daily_stats
    where day between p_from and p_to
    group by series_id
  ) t;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.day), '[]'::jsonb)
  into v_daily
  from (
    select
      g.day,
      coalesce(sum(s.session_count), 0)::int as session_count,
      coalesce(sum(s.active_seconds), 0)::int as active_seconds,
      coalesce(sum(s.design_count), 0)::int as design_count,
      coalesce(sum(s.quote_count), 0)::int as quote_count
    from generate_series(p_from, p_to, interval '1 day') as g(day)
    left join public.dealer_daily_stats s
      on s.day = g.day::date
     and exists (
       select 1 from public.dealers d
       where d.id = s.dealer_id and d.auth_user_id is not null
     )
    group by g.day
  ) t;

  select jsonb_build_object(
    'lead_count', count(*)::int,
    'lead_total_price', coalesce(sum(q.total_price), 0),
    'lead_avg_price', case when count(*) > 0 then round(avg(q.total_price), 2) else 0 end,
    'lead_max_price', coalesce(max(q.total_price), 0)
  )
  into v_leads
  from public.quote_leads q
  left join public.dealers d on d.id = q.dealer_id
  where (q.created_at at time zone 'Europe/Istanbul')::date between p_from and p_to
    and (q.dealer_id is null or d.auth_user_id is not null);

  select jsonb_build_object(
    'dealers', count(distinct d.id)::int,
    'session_count', coalesce(sum(s.session_count), 0)::int,
    'active_seconds', coalesce(sum(s.active_seconds), 0)::int,
    'design_count', coalesce(sum(s.design_count), 0)::int,
    'quote_count', coalesce(sum(s.quote_count), 0)::int,
    'avg_session_seconds', case when coalesce(sum(s.session_count), 0) > 0
      then round(coalesce(sum(s.active_seconds), 0)::numeric / sum(s.session_count))
      else 0 end,
    'design_to_quote_pct', case when coalesce(sum(s.design_count), 0) > 0
      then round(100.0 * coalesce(sum(s.quote_count), 0) / sum(s.design_count), 1)
      else 0 end,
    'session_to_design_pct', case when coalesce(sum(s.session_count), 0) > 0
      then round(100.0 * coalesce(sum(s.design_count), 0) / sum(s.session_count), 1)
      else 0 end,
    'session_to_quote_pct', case when coalesce(sum(s.session_count), 0) > 0
      then round(100.0 * coalesce(sum(s.quote_count), 0) / sum(s.session_count), 1)
      else 0 end,
    'live_sessions', v_live,
    'inactive_dealers', v_inactive
  )
  into v_totals
  from public.dealers d
  left join public.dealer_daily_stats s
    on s.dealer_id = d.id and s.day between p_from and p_to
  where d.active = true
    and d.auth_user_id is not null;

  return jsonb_build_object(
    'ok', true,
    'from', p_from,
    'to', p_to,
    'totals', v_totals || v_leads,
    'dealers', v_dealers,
    'series', v_series,
    'daily', v_daily
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.sync_dealer_from_auth_user() FROM public;
GRANT EXECUTE ON FUNCTION public.sync_dealer_from_auth_user() TO supabase_auth_admin, postgres, service_role;
REVOKE ALL ON FUNCTION public.strip_dealer_if_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.strip_dealer_if_admin() TO postgres, service_role, authenticated;
REVOKE ALL ON FUNCTION public.dealer_login_auth(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.dealer_login_auth(text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_dashboard(date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_dashboard(date, date) TO authenticated, service_role;
