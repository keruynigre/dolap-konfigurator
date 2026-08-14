-- Halı fiyatları: item_type=rug, accessory_key=halı kodu, price=tutar. series_id boş olabilir.
ALTER TABLE public.price_items DROP CONSTRAINT IF EXISTS price_items_item_type_check;
ALTER TABLE public.price_items
  ADD CONSTRAINT price_items_item_type_check
  CHECK (item_type = ANY (ARRAY['body'::text, 'door'::text, 'accessory'::text, 'set'::text, 'rug'::text]));
