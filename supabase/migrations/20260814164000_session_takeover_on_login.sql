-- Çıkış sonrası tekrar giriş: eski oturum kilidi yeni girişi engellemesin.
-- Yeni giriş diğer cihazdaki oturumu kapatır (devralır).

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

    UPDATE public.dealer_sessions
    SET ended_at = now()
    WHERE dealer_id = v_dealer.id AND ended_at IS NULL;
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

CREATE OR REPLACE FUNCTION public.dealer_logout(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.dealer_sessions
  SET ended_at = now(),
      last_seen_at = now()
  WHERE ended_at IS NULL
    AND (
      id = p_session_id
      OR dealer_id IN (SELECT dealer_id FROM public.dealer_sessions WHERE id = p_session_id)
      OR dealer_id IN (SELECT id FROM public.dealers WHERE auth_user_id = auth.uid())
    );

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_release_session(p_device_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  UPDATE public.admin_profiles
  SET active_device_id = NULL,
      active_session_at = NULL
  WHERE user_id = v_uid;

  RETURN jsonb_build_object('ok', true);
END;
$function$;
