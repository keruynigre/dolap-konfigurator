-- Yüklenen fiyat listesini kalıcı sil (satırlar CASCADE ile gider).
CREATE OR REPLACE FUNCTION public.delete_price_list(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_list public.price_lists%rowtype;
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

  delete from public.price_lists where id = p_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_list.id,
    'version', v_list.version,
    'was_active', coalesce(v_list.active, false)
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.delete_price_list(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_price_list(uuid) TO anon, authenticated, service_role;
