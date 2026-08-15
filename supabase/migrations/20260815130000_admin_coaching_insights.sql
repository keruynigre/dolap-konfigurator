-- Priority 3 coaching: usage depth, passive dealers, sale speed, repeat phones
CREATE OR REPLACE FUNCTION public.admin_coaching_insights(
  p_from date DEFAULT (((now() AT TIME ZONE 'Europe/Istanbul'::text))::date - 30),
  p_to date DEFAULT ((now() AT TIME ZONE 'Europe/Istanbul'::text))::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_depth jsonb;
  v_sale_speed jsonb;
  v_passive jsonb;
  v_repeats jsonb;
  v_now timestamptz := now();
BEGIN
  IF NOT public.is_manufacturer_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT jsonb_build_object(
    'session_count', coalesce(sum(s.session_count), 0)::int,
    'design_count', coalesce(sum(s.design_count), 0)::int,
    'quote_open_count', coalesce(sum(s.quote_open_count), 0)::int,
    'quote_count', coalesce(sum(s.quote_count), 0)::int,
    'designs_per_session', CASE WHEN coalesce(sum(s.session_count), 0) > 0
      THEN round(coalesce(sum(s.design_count), 0)::numeric / sum(s.session_count), 2) ELSE 0 END,
    'opens_per_session', CASE WHEN coalesce(sum(s.session_count), 0) > 0
      THEN round(coalesce(sum(s.quote_open_count), 0)::numeric / sum(s.session_count), 2) ELSE 0 END,
    'quotes_per_session', CASE WHEN coalesce(sum(s.session_count), 0) > 0
      THEN round(coalesce(sum(s.quote_count), 0)::numeric / sum(s.session_count), 2) ELSE 0 END
  )
  INTO v_depth
  FROM public.dealers d
  LEFT JOIN public.dealer_daily_stats s
    ON s.dealer_id = d.id AND s.day BETWEEN p_from AND p_to
  WHERE d.active = true AND d.auth_user_id IS NOT NULL;

  SELECT jsonb_build_object(
    'sold_count', count(*)::int,
    'avg_days_to_sale', CASE WHEN count(*) > 0
      THEN round(avg(extract(epoch FROM (q.outcome_at - q.created_at)) / 86400.0)::numeric, 1)
      ELSE NULL END,
    'median_days_to_sale', CASE WHEN count(*) > 0
      THEN round((
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY extract(epoch FROM (q.outcome_at - q.created_at)) / 86400.0
        )
      )::numeric, 1)
      ELSE NULL END,
    'sold_within_3_days', count(*) FILTER (
      WHERE extract(epoch FROM (q.outcome_at - q.created_at)) / 86400.0 <= 3
    )::int,
    'sold_within_7_days', count(*) FILTER (
      WHERE extract(epoch FROM (q.outcome_at - q.created_at)) / 86400.0 <= 7
    )::int
  )
  INTO v_sale_speed
  FROM public.quote_leads q
  LEFT JOIN public.dealers d ON d.id = q.dealer_id
  WHERE q.outcome = 'sold'
    AND q.outcome_at IS NOT NULL
    AND (q.created_at AT TIME ZONE 'Europe/Istanbul')::date BETWEEN p_from AND p_to
    AND (q.dealer_id IS NULL OR d.auth_user_id IS NOT NULL);

  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.days_since DESC NULLS FIRST, t.name), '[]'::jsonb)
  INTO v_passive
  FROM (
    SELECT
      d.id,
      d.code,
      d.name,
      d.email,
      d.city,
      ls.last_seen_at,
      CASE
        WHEN ls.last_seen_at IS NULL THEN NULL
        ELSE greatest(0, floor(extract(epoch FROM (v_now - ls.last_seen_at)) / 86400.0))::int
      END AS days_since,
      CASE
        WHEN ls.last_seen_at IS NULL THEN 'never'
        WHEN ls.last_seen_at <= v_now - interval '30 days' THEN '30+'
        WHEN ls.last_seen_at <= v_now - interval '14 days' THEN '14+'
        WHEN ls.last_seen_at <= v_now - interval '7 days' THEN '7+'
        ELSE 'active'
      END AS band
    FROM public.dealers d
    LEFT JOIN LATERAL (
      SELECT max(s.last_seen_at) AS last_seen_at
      FROM public.dealer_sessions s
      WHERE s.dealer_id = d.id
    ) ls ON true
    WHERE d.active = true
      AND d.auth_user_id IS NOT NULL
      AND (
        ls.last_seen_at IS NULL
        OR ls.last_seen_at <= v_now - interval '7 days'
      )
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.lead_count DESC, t.last_created_at DESC), '[]'::jsonb)
  INTO v_repeats
  FROM (
    SELECT
      phone_key,
      count(*)::int AS lead_count,
      count(*) FILTER (WHERE outcome = 'sold')::int AS sold_count,
      count(DISTINCT dealer_id)::int AS dealer_count,
      max(customer_name) AS sample_name,
      max(customer_phone) AS sample_phone,
      max(created_at) AS last_created_at,
      coalesce(sum(total_price), 0) AS lead_total_price
    FROM (
      SELECT
        q.dealer_id,
        q.outcome,
        q.customer_name,
        q.customer_phone,
        q.created_at,
        q.total_price,
        CASE
          WHEN length(regexp_replace(coalesce(q.customer_phone, ''), '[^0-9]', '', 'g')) >= 10
            THEN right(regexp_replace(q.customer_phone, '[^0-9]', '', 'g'), 10)
          ELSE regexp_replace(coalesce(q.customer_phone, ''), '[^0-9]', '', 'g')
        END AS phone_key
      FROM public.quote_leads q
      LEFT JOIN public.dealers d ON d.id = q.dealer_id
      WHERE (q.created_at AT TIME ZONE 'Europe/Istanbul')::date BETWEEN p_from AND p_to
        AND (q.dealer_id IS NULL OR d.auth_user_id IS NOT NULL)
        AND nullif(trim(coalesce(q.customer_phone, '')), '') IS NOT NULL
    ) x
    WHERE phone_key <> ''
    GROUP BY phone_key
    HAVING count(*) >= 2
  ) t;

  RETURN jsonb_build_object(
    'ok', true,
    'from', p_from,
    'to', p_to,
    'depth', coalesce(v_depth, '{}'::jsonb),
    'sale_speed', coalesce(v_sale_speed, '{}'::jsonb),
    'passive', coalesce(v_passive, '[]'::jsonb),
    'repeat_phones', coalesce(v_repeats, '[]'::jsonb),
    'repeat_summary', jsonb_build_object(
      'phone_count', coalesce(jsonb_array_length(v_repeats), 0),
      'lead_count', coalesce((
        SELECT sum((e->>'lead_count')::int) FROM jsonb_array_elements(coalesce(v_repeats, '[]'::jsonb)) e
      ), 0)
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_coaching_insights(date, date) TO anon, authenticated, service_role;
