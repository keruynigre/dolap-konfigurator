-- Include quote payload so dealers can re-download PDF from Tekliflerim.
CREATE OR REPLACE FUNCTION public.dealer_list_quote_leads(
  p_session_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_session public.dealer_sessions%rowtype;
  v_lim integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_rows jsonb;
BEGIN
  SELECT * INTO v_session
  FROM public.dealer_sessions
  WHERE id = p_session_id AND ended_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_found');
  END IF;

  UPDATE public.dealer_sessions
  SET last_seen_at = now()
  WHERE id = p_session_id;

  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      q.id,
      q.created_at,
      q.customer_name,
      q.customer_phone,
      q.customer_email,
      q.customer_note,
      q.series_id,
      q.total_price,
      q.layout_mode,
      q.outcome,
      q.outcome_at,
      q.outcome_note,
      q.sale_ref,
      q.payload
    FROM public.quote_leads q
    WHERE q.dealer_id = v_session.dealer_id
    ORDER BY q.created_at DESC
    LIMIT v_lim
  ) t;

  RETURN jsonb_build_object('ok', true, 'leads', v_rows);
END;
$function$;
