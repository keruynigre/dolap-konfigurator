-- Product/basket insights from quote_leads.payload for manufacturer admin.
CREATE OR REPLACE FUNCTION public.admin_product_insights(
  p_from date DEFAULT (((now() AT TIME ZONE 'Europe/Istanbul'::text))::date - 30),
  p_to date DEFAULT ((now() AT TIME ZONE 'Europe/Istanbul'::text))::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_summary jsonb;
  v_by_series jsonb;
  v_by_layout jsonb;
  v_by_doors jsonb;
  v_by_price jsonb;
  v_addons jsonb;
BEGIN
  IF NOT public.is_manufacturer_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  WITH base AS (
    SELECT
      q.id,
      coalesce(nullif(q.outcome, ''), 'open') AS outcome,
      coalesce(nullif(q.series_id, ''), '(yok)') AS series_id,
      coalesce(nullif(q.layout_mode, ''), 'flat') AS layout_mode,
      coalesce(q.total_price, 0)::numeric AS total_price,
      coalesce((
        SELECT sum(jsonb_array_length(coalesce(c->'doors', '[]'::jsonb)))
        FROM jsonb_array_elements(coalesce(q.payload->'config', '[]'::jsonb)) c
      ), 0)::int AS door_count,
      (jsonb_array_length(coalesce(q.payload->'sets', '[]'::jsonb)) > 0) AS has_sets,
      (jsonb_array_length(coalesce(q.payload->'accessories', '[]'::jsonb)) > 0) AS has_accessories,
      (jsonb_array_length(coalesce(q.payload->'rugs', '[]'::jsonb)) > 0) AS has_rugs
    FROM public.quote_leads q
    WHERE (q.created_at AT TIME ZONE 'Europe/Istanbul')::date BETWEEN p_from AND p_to
  ),
  enriched AS (
    SELECT
      b.*,
      CASE
        WHEN b.door_count <= 0 THEN '0'
        WHEN b.door_count <= 3 THEN '1-3'
        WHEN b.door_count <= 6 THEN '4-6'
        WHEN b.door_count <= 9 THEN '7-9'
        WHEN b.door_count <= 12 THEN '10-12'
        ELSE '13+'
      END AS door_band,
      CASE
        WHEN b.total_price < 50000 THEN '<50k'
        WHEN b.total_price < 100000 THEN '50-100k'
        WHEN b.total_price < 150000 THEN '100-150k'
        ELSE '150k+'
      END AS price_band
    FROM base b
  )
  SELECT jsonb_build_object(
    'lead_count', count(*)::int,
    'sold_count', count(*) FILTER (WHERE outcome = 'sold')::int,
    'avg_doors', CASE WHEN count(*) > 0 THEN round(avg(door_count)::numeric, 1) ELSE 0 END,
    'avg_price', CASE WHEN count(*) > 0 THEN round(avg(total_price), 2) ELSE 0 END,
    'with_sets_count', count(*) FILTER (WHERE has_sets)::int,
    'with_sets_pct', CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE has_sets) / count(*), 1) ELSE 0 END,
    'with_accessories_count', count(*) FILTER (WHERE has_accessories)::int,
    'with_accessories_pct', CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE has_accessories) / count(*), 1) ELSE 0 END,
    'with_rugs_count', count(*) FILTER (WHERE has_rugs)::int,
    'with_rugs_pct', CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE has_rugs) / count(*), 1) ELSE 0 END,
    'corner_count', count(*) FILTER (WHERE layout_mode = 'corner')::int,
    'corner_pct', CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE layout_mode = 'corner') / count(*), 1) ELSE 0 END,
    'flat_count', count(*) FILTER (WHERE layout_mode <> 'corner')::int
  )
  INTO v_summary
  FROM enriched;

  WITH base AS (
    SELECT
      q.id,
      coalesce(nullif(q.outcome, ''), 'open') AS outcome,
      coalesce(nullif(q.series_id, ''), '(yok)') AS series_id,
      coalesce(q.total_price, 0)::numeric AS total_price,
      coalesce((
        SELECT sum(jsonb_array_length(coalesce(c->'doors', '[]'::jsonb)))
        FROM jsonb_array_elements(coalesce(q.payload->'config', '[]'::jsonb)) c
      ), 0)::int AS door_count
    FROM public.quote_leads q
    WHERE (q.created_at AT TIME ZONE 'Europe/Istanbul')::date BETWEEN p_from AND p_to
  )
  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.lead_count DESC), '[]'::jsonb)
  INTO v_by_series
  FROM (
    SELECT
      series_id,
      count(*)::int AS lead_count,
      count(*) FILTER (WHERE outcome = 'sold')::int AS sold_count,
      CASE WHEN count(*) > 0 THEN round(avg(total_price), 2) ELSE 0 END AS avg_price,
      CASE WHEN count(*) > 0 THEN round(avg(door_count)::numeric, 1) ELSE 0 END AS avg_doors,
      CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE outcome = 'sold') / count(*), 1) ELSE 0 END AS sold_pct
    FROM base
    GROUP BY series_id
  ) t;

  WITH base AS (
    SELECT
      coalesce(nullif(q.outcome, ''), 'open') AS outcome,
      coalesce(nullif(q.layout_mode, ''), 'flat') AS layout_mode,
      coalesce(q.total_price, 0)::numeric AS total_price
    FROM public.quote_leads q
    WHERE (q.created_at AT TIME ZONE 'Europe/Istanbul')::date BETWEEN p_from AND p_to
  )
  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.lead_count DESC), '[]'::jsonb)
  INTO v_by_layout
  FROM (
    SELECT
      layout_mode,
      count(*)::int AS lead_count,
      count(*) FILTER (WHERE outcome = 'sold')::int AS sold_count,
      CASE WHEN count(*) > 0 THEN round(avg(total_price), 2) ELSE 0 END AS avg_price,
      CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE outcome = 'sold') / count(*), 1) ELSE 0 END AS sold_pct
    FROM base
    GROUP BY layout_mode
  ) t;

  WITH base AS (
    SELECT
      coalesce(nullif(q.outcome, ''), 'open') AS outcome,
      coalesce(q.total_price, 0)::numeric AS total_price,
      CASE
        WHEN coalesce((
          SELECT sum(jsonb_array_length(coalesce(c->'doors', '[]'::jsonb)))
          FROM jsonb_array_elements(coalesce(q.payload->'config', '[]'::jsonb)) c
        ), 0) <= 0 THEN '0'
        WHEN coalesce((
          SELECT sum(jsonb_array_length(coalesce(c->'doors', '[]'::jsonb)))
          FROM jsonb_array_elements(coalesce(q.payload->'config', '[]'::jsonb)) c
        ), 0) <= 3 THEN '1-3'
        WHEN coalesce((
          SELECT sum(jsonb_array_length(coalesce(c->'doors', '[]'::jsonb)))
          FROM jsonb_array_elements(coalesce(q.payload->'config', '[]'::jsonb)) c
        ), 0) <= 6 THEN '4-6'
        WHEN coalesce((
          SELECT sum(jsonb_array_length(coalesce(c->'doors', '[]'::jsonb)))
          FROM jsonb_array_elements(coalesce(q.payload->'config', '[]'::jsonb)) c
        ), 0) <= 9 THEN '7-9'
        WHEN coalesce((
          SELECT sum(jsonb_array_length(coalesce(c->'doors', '[]'::jsonb)))
          FROM jsonb_array_elements(coalesce(q.payload->'config', '[]'::jsonb)) c
        ), 0) <= 12 THEN '10-12'
        ELSE '13+'
      END AS door_band
    FROM public.quote_leads q
    WHERE (q.created_at AT TIME ZONE 'Europe/Istanbul')::date BETWEEN p_from AND p_to
  )
  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_by_doors
  FROM (
    SELECT
      door_band AS band,
      count(*)::int AS lead_count,
      count(*) FILTER (WHERE outcome = 'sold')::int AS sold_count,
      CASE WHEN count(*) > 0 THEN round(avg(total_price), 2) ELSE 0 END AS avg_price,
      CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE outcome = 'sold') / count(*), 1) ELSE 0 END AS sold_pct,
      CASE door_band
        WHEN '0' THEN 0 WHEN '1-3' THEN 1 WHEN '4-6' THEN 2
        WHEN '7-9' THEN 3 WHEN '10-12' THEN 4 ELSE 5
      END AS sort_key
    FROM base
    GROUP BY door_band
    ORDER BY sort_key
  ) t;

  WITH base AS (
    SELECT
      coalesce(nullif(q.outcome, ''), 'open') AS outcome,
      coalesce(q.total_price, 0)::numeric AS total_price,
      CASE
        WHEN coalesce(q.total_price, 0) < 50000 THEN '<50k'
        WHEN coalesce(q.total_price, 0) < 100000 THEN '50-100k'
        WHEN coalesce(q.total_price, 0) < 150000 THEN '100-150k'
        ELSE '150k+'
      END AS price_band
    FROM public.quote_leads q
    WHERE (q.created_at AT TIME ZONE 'Europe/Istanbul')::date BETWEEN p_from AND p_to
  )
  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_by_price
  FROM (
    SELECT
      price_band AS band,
      count(*)::int AS lead_count,
      count(*) FILTER (WHERE outcome = 'sold')::int AS sold_count,
      CASE WHEN count(*) > 0 THEN round(avg(total_price), 2) ELSE 0 END AS avg_price,
      CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE outcome = 'sold') / count(*), 1) ELSE 0 END AS sold_pct,
      CASE price_band
        WHEN '<50k' THEN 0 WHEN '50-100k' THEN 1 WHEN '100-150k' THEN 2 ELSE 3
      END AS sort_key
    FROM base
    GROUP BY price_band
    ORDER BY sort_key
  ) t;

  WITH base AS (
    SELECT
      coalesce(nullif(q.outcome, ''), 'open') AS outcome,
      (jsonb_array_length(coalesce(q.payload->'sets', '[]'::jsonb)) > 0) AS has_sets,
      (jsonb_array_length(coalesce(q.payload->'accessories', '[]'::jsonb)) > 0) AS has_accessories,
      (jsonb_array_length(coalesce(q.payload->'rugs', '[]'::jsonb)) > 0) AS has_rugs
    FROM public.quote_leads q
    WHERE (q.created_at AT TIME ZONE 'Europe/Istanbul')::date BETWEEN p_from AND p_to
  )
  SELECT jsonb_build_object(
    'sets', jsonb_build_object(
      'lead_count', count(*) FILTER (WHERE has_sets)::int,
      'sold_count', count(*) FILTER (WHERE has_sets AND outcome = 'sold')::int,
      'pct', CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE has_sets) / count(*), 1) ELSE 0 END,
      'sold_pct', CASE WHEN count(*) FILTER (WHERE has_sets) > 0
        THEN round(100.0 * count(*) FILTER (WHERE has_sets AND outcome = 'sold') / count(*) FILTER (WHERE has_sets), 1) ELSE 0 END
    ),
    'accessories', jsonb_build_object(
      'lead_count', count(*) FILTER (WHERE has_accessories)::int,
      'sold_count', count(*) FILTER (WHERE has_accessories AND outcome = 'sold')::int,
      'pct', CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE has_accessories) / count(*), 1) ELSE 0 END,
      'sold_pct', CASE WHEN count(*) FILTER (WHERE has_accessories) > 0
        THEN round(100.0 * count(*) FILTER (WHERE has_accessories AND outcome = 'sold') / count(*) FILTER (WHERE has_accessories), 1) ELSE 0 END
    ),
    'rugs', jsonb_build_object(
      'lead_count', count(*) FILTER (WHERE has_rugs)::int,
      'sold_count', count(*) FILTER (WHERE has_rugs AND outcome = 'sold')::int,
      'pct', CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE has_rugs) / count(*), 1) ELSE 0 END,
      'sold_pct', CASE WHEN count(*) FILTER (WHERE has_rugs) > 0
        THEN round(100.0 * count(*) FILTER (WHERE has_rugs AND outcome = 'sold') / count(*) FILTER (WHERE has_rugs), 1) ELSE 0 END
    ),
    'wardrobe_only', jsonb_build_object(
      'lead_count', count(*) FILTER (WHERE NOT has_sets AND NOT has_accessories AND NOT has_rugs)::int,
      'sold_count', count(*) FILTER (WHERE NOT has_sets AND NOT has_accessories AND NOT has_rugs AND outcome = 'sold')::int,
      'pct', CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE NOT has_sets AND NOT has_accessories AND NOT has_rugs) / count(*), 1) ELSE 0 END,
      'sold_pct', CASE WHEN count(*) FILTER (WHERE NOT has_sets AND NOT has_accessories AND NOT has_rugs) > 0
        THEN round(100.0 * count(*) FILTER (WHERE NOT has_sets AND NOT has_accessories AND NOT has_rugs AND outcome = 'sold')
          / count(*) FILTER (WHERE NOT has_sets AND NOT has_accessories AND NOT has_rugs), 1) ELSE 0 END
    )
  )
  INTO v_addons
  FROM base;

  RETURN jsonb_build_object(
    'ok', true,
    'from', p_from,
    'to', p_to,
    'summary', coalesce(v_summary, '{}'::jsonb),
    'by_series', coalesce(v_by_series, '[]'::jsonb),
    'by_layout', coalesce(v_by_layout, '[]'::jsonb),
    'by_doors', coalesce(v_by_doors, '[]'::jsonb),
    'by_price_band', coalesce(v_by_price, '[]'::jsonb),
    'addons', coalesce(v_addons, '{}'::jsonb)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_product_insights(date, date) TO anon, authenticated, service_role;
