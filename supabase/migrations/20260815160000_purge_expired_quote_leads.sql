-- Quotes are valid for 1 week; purge older rows from Tekliflerim / quote_leads.
CREATE OR REPLACE FUNCTION public.purge_expired_quote_leads()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM public.quote_leads
  WHERE created_at < (now() - interval '7 days');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN coalesce(v_deleted, 0);
END;
$function$;

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
  v_cutoff timestamptz := now() - interval '7 days';
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

  -- Global purge so expired quotes leave Tekliflerim and storage.
  PERFORM public.purge_expired_quote_leads();

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
      AND q.created_at >= v_cutoff
    ORDER BY q.created_at DESC
    LIMIT v_lim
  ) t;

  RETURN jsonb_build_object('ok', true, 'leads', v_rows);
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_expired_quote_leads() FROM public;
GRANT EXECUTE ON FUNCTION public.purge_expired_quote_leads() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.dealer_list_quote_leads(uuid, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.dealer_list_quote_leads(uuid, integer) TO anon, authenticated, service_role;

-- One-shot cleanup for any already-expired rows.
SELECT public.purge_expired_quote_leads();
