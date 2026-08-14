-- Eski bir fiyat listesini tekrar aktif et (yanlış yükleme geri alma).
CREATE OR REPLACE FUNCTION public.activate_price_list(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_list public.price_lists%rowtype;
  v_items integer;
begin
  if not public.is_manufacturer_admin() then
    raise exception 'not_authorized';
  end if;

  if p_id is null then
    raise exception 'not_found';
  end if;

  select * into v_list from public.price_lists where id = p_id;
  if not found then
    raise exception 'not_found';
  end if;

  select count(*)::integer into v_items
  from public.price_items
  where price_list_id = p_id;

  if coalesce(v_items, 0) < 1 then
    raise exception 'empty_items';
  end if;

  if v_list.active is true then
    return jsonb_build_object(
      'ok', true,
      'id', v_list.id,
      'version', v_list.version,
      'count', v_items,
      'already_active', true
    );
  end if;

  update public.price_lists set active = false where active = true;
  update public.price_lists set active = true where id = p_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_list.id,
    'version', v_list.version,
    'count', v_items,
    'already_active', false
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.activate_price_list(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.activate_price_list(uuid) TO anon, authenticated, service_role;
