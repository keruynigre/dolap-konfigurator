-- Excel yükleme taslak kaydeder; canlı liste ancak activate_price_list ile değişir.
CREATE OR REPLACE FUNCTION public.publish_price_list(p_filename text, p_note text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_version integer;
  v_list_id uuid;
  v_item jsonb;
  v_email text;
  v_count integer;
begin
  if not public.is_manufacturer_admin() then
    raise exception 'not_authorized';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_items';
  end if;

  select email into v_email from auth.users where id = auth.uid();
  v_count := jsonb_array_length(p_items);

  select coalesce(max(version), 0) + 1 into v_version from public.price_lists;

  insert into public.price_lists (
    version, filename, note, active, uploaded_by, uploaded_by_email, item_count
  ) values (
    v_version, p_filename, p_note, false, auth.uid(), v_email, v_count
  )
  returning id into v_list_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.price_items (
      price_list_id, item_type, series_id, body_type, finish_id, accessory_key,
      size, label, price, price_single, price_pair
    ) values (
      v_list_id,
      v_item->>'item_type',
      nullif(v_item->>'series_id', ''),
      nullif(v_item->>'body_type', ''),
      nullif(v_item->>'finish_id', ''),
      nullif(v_item->>'accessory_key', ''),
      nullif(v_item->>'size', ''),
      nullif(v_item->>'label', ''),
      nullif(v_item->>'price', '')::numeric,
      nullif(v_item->>'price_single', '')::numeric,
      nullif(v_item->>'price_pair', '')::numeric
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'id', v_list_id,
    'version', v_version,
    'count', v_count,
    'draft', true,
    'uploaded_by_email', v_email
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.publish_price_list(text, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.publish_price_list(text, text, jsonb) TO anon, authenticated, service_role;

-- Localden yüklenen test listesi canlıdan düşsün; site şablon fiyatlara döner.
UPDATE public.price_lists SET active = false WHERE active = true;
