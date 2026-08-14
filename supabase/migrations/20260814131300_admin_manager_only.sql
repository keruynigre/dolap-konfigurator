-- Yönetici ekleme/çıkarma yalnızca can_manage_admins=true olan tek kişide.
ALTER TABLE public.admin_profiles
  ADD COLUMN IF NOT EXISTS can_manage_admins boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS admin_profiles_one_manager
  ON public.admin_profiles (can_manage_admins)
  WHERE can_manage_admins = true;

UPDATE public.admin_profiles
SET can_manage_admins = true
WHERE user_id = 'afb7b69b-b751-46c1-b584-f0ad917fd3d9'
  AND NOT EXISTS (
    SELECT 1 FROM public.admin_profiles WHERE can_manage_admins = true
  );

CREATE OR REPLACE FUNCTION public.is_admin_manager()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.admin_profiles
    where user_id = auth.uid() and can_manage_admins is true
  );
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_admins()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_rows jsonb;
begin
  if not public.is_manufacturer_admin() then
    raise exception 'not_authorized';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  into v_rows
  from (
    select
      ap.user_id,
      ap.display_name,
      ap.created_at,
      ap.can_manage_admins,
      u.email
    from public.admin_profiles ap
    left join auth.users u on u.id = ap.user_id
    order by ap.can_manage_admins desc, ap.created_at
  ) t;

  return jsonb_build_object(
    'ok', true,
    'can_manage', public.is_admin_manager(),
    'admins', v_rows
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_revoke_admin(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_count integer;
  v_target public.admin_profiles%rowtype;
begin
  if not public.is_manufacturer_admin() then
    raise exception 'not_authorized';
  end if;

  if not public.is_admin_manager() then
    return jsonb_build_object('ok', false, 'error', 'not_manager');
  end if;

  if p_user_id is null then
    raise exception 'not_found';
  end if;

  if p_user_id = auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'self');
  end if;

  select * into v_target from public.admin_profiles where user_id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_target.can_manage_admins is true then
    return jsonb_build_object('ok', false, 'error', 'manager');
  end if;

  select count(*)::integer into v_count from public.admin_profiles;
  if coalesce(v_count, 0) <= 1 then
    return jsonb_build_object('ok', false, 'error', 'last_admin');
  end if;

  delete from public.admin_profiles where user_id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object('ok', true, 'user_id', p_user_id);
end;
$function$;

REVOKE ALL ON FUNCTION public.is_admin_manager() FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin_manager() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_list_admins() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_admins() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_revoke_admin(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_revoke_admin(uuid) TO anon, authenticated, service_role;
