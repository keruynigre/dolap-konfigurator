-- Admin listesi ve yetki kaldırma (hesap silinmez, yalnızca admin_profiles).
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
      u.email
    from public.admin_profiles ap
    left join auth.users u on u.id = ap.user_id
    order by ap.created_at
  ) t;

  return jsonb_build_object('ok', true, 'admins', v_rows);
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
begin
  if not public.is_manufacturer_admin() then
    raise exception 'not_authorized';
  end if;

  if p_user_id is null then
    raise exception 'not_found';
  end if;

  if p_user_id = auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'self');
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

REVOKE ALL ON FUNCTION public.admin_list_admins() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_admins() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_revoke_admin(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_revoke_admin(uuid) TO anon, authenticated, service_role;
