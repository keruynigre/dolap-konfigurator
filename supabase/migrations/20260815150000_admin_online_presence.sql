-- Show which manufacturer admins are currently online (heartbeat via admin_touch_session).
CREATE OR REPLACE FUNCTION public.admin_list_admins()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb;
  v_online integer := 0;
BEGIN
  IF NOT public.is_manufacturer_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      ap.user_id,
      ap.display_name,
      ap.created_at,
      ap.can_manage_admins,
      ap.active_session_at,
      u.email,
      (u.email_confirmed_at IS NOT NULL) AS email_confirmed,
      (
        ap.active_device_id IS NOT NULL
        AND ap.active_session_at IS NOT NULL
        AND ap.active_session_at > now() - interval '3 minutes'
      ) AS live
    FROM public.admin_profiles ap
    LEFT JOIN auth.users u ON u.id = ap.user_id
    ORDER BY
      (
        ap.active_device_id IS NOT NULL
        AND ap.active_session_at IS NOT NULL
        AND ap.active_session_at > now() - interval '3 minutes'
      ) DESC,
      ap.can_manage_admins DESC,
      ap.created_at
  ) t;

  SELECT count(*)::int
  INTO v_online
  FROM public.admin_profiles ap
  WHERE ap.active_device_id IS NOT NULL
    AND ap.active_session_at IS NOT NULL
    AND ap.active_session_at > now() - interval '3 minutes';

  RETURN jsonb_build_object(
    'ok', true,
    'can_manage', public.is_admin_manager(),
    'online_count', coalesce(v_online, 0),
    'admins', v_rows
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_admins() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_admins() TO anon, authenticated, service_role;
