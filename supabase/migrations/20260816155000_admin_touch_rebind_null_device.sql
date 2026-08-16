-- Admin yenilemede touch düşmesin; başka cihaz son 15 dk canlıysa kilitle.

CREATE OR REPLACE FUNCTION public.admin_touch_session(p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_device text := nullif(trim(coalesce(p_device_id, '')), '');
  v_prof public.admin_profiles%rowtype;
  v_stale interval := interval '15 minutes';
BEGIN
  IF v_uid IS NULL OR v_device IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO v_prof
  FROM public.admin_profiles
  WHERE user_id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_admin');
  END IF;

  IF v_prof.active_device_id IS NOT NULL
     AND v_prof.active_device_id IS DISTINCT FROM v_device THEN
    IF v_prof.active_session_at IS NOT NULL
       AND v_prof.active_session_at > now() - v_stale THEN
      RETURN jsonb_build_object('ok', false, 'error', 'session_taken');
    END IF;
  END IF;

  UPDATE public.admin_profiles
  SET active_device_id = v_device,
      active_session_at = now()
  WHERE user_id = v_uid;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_claim_session(p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_device text := nullif(trim(coalesce(p_device_id, '')), '');
  v_prof public.admin_profiles%rowtype;
  v_confirmed_at timestamptz;
  v_password text;
  v_stale interval := interval '15 minutes';
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF v_device IS NULL OR length(v_device) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_required');
  END IF;

  SELECT email_confirmed_at, encrypted_password
    INTO v_confirmed_at, v_password
  FROM auth.users
  WHERE id = v_uid;

  IF v_confirmed_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email_not_confirmed');
  END IF;

  IF v_password IS NULL OR length(v_password) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'password_required');
  END IF;

  SELECT * INTO v_prof
  FROM public.admin_profiles
  WHERE user_id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_admin');
  END IF;

  IF v_prof.active_device_id IS NOT NULL
     AND v_prof.active_device_id IS DISTINCT FROM v_device
     AND v_prof.active_session_at IS NOT NULL
     AND v_prof.active_session_at > now() - v_stale THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_active');
  END IF;

  UPDATE public.admin_profiles
  SET active_device_id = v_device,
      active_session_at = now()
  WHERE user_id = v_uid;

  RETURN jsonb_build_object('ok', true);
END;
$function$;
