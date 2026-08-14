import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-dolap-preview",
};

const SERIES_LABEL: Record<string, string> = {
  welldora: "Welldora",
  monerra: "Monerra",
  travina: "Travina",
  cappadocia: "Cappadocia",
};

const BODY_LABEL: Record<string, string> = {
  "1door": "1 Kapaklı Gövde",
  "2door": "2 Kapaklı Gövde",
  "3door": "3 Kapaklı Gövde",
  corner: "Köşe Gövde",
};

const FINISH_LABEL: Record<string, string> = {
  ceviz: "Rubens",
  aytasi: "Aytaşı",
  ayna: "Ayna",
  cam: "Cam",
  buz_gri: "Buz Gri",
  travent_almond: "Travent-Almond",
};

const ACC_LABEL: Record<string, string> = {
  "welldora:sifonyer": "Yüksek Şifonyer",
  "welldora:komodin": "Komodin",
  "welldora:makyajMasasi": "Makyaj Masası",
  "welldora:makyajAynasi": "Makyaj Aynası",
  "welldora:puf": "Cario Puf",
  "monerra:sifonyer": "Yüksek Şifonyer",
  "monerra:komodin": "Komodin",
  "monerra:makyajMasasi": "Makyaj Masası",
  "monerra:makyajAynasi": "Makyaj Aynası",
  "monerra:puf": "Cario Puf",
  "travina:sifonyer": "Yüksek Şifonyer",
  "travina:komodin": "Komodin",
  "travina:makyajMasasi": "Makyaj Masası",
  "travina:makyajAynasi": "Makyaj Aynası",
  "travina:puf": "Cario Puf",
  "cappadocia:sifonyer3": "3'lü Şifonyer",
  "cappadocia:sifonyer4": "4'lü Şifonyer",
  "cappadocia:komodin": "Komodin",
  "cappadocia:makyajMasasi": "Makyaj Masası",
  "cappadocia:makyajAynasi": "Ayna",
  "cappadocia:puf": "Cario Puf",
};

const SET_LABEL: Record<string, string> = {
  "welldora:magnasand": "Magnasand Therapy",
  "welldora:biosalt": "Biosalt",
  "monerra:climextra": "Climextra",
  "monerra:blacksand": "Blacksand",
  "travina:bohemella": "Bohemella",
  "travina:borjen": "Borjen",
  "cappadocia:cappadocia_natura": "Cappadocia Natura",
};

type DoorPrice = { single: number; pair: number };
type Catalog = {
  bodies: Record<string, number>;
  drawerAddon: number;
  doors: Record<string, DoorPrice>;
  accessories: Record<string, number>;
  sets: Record<string, Record<string, number>>;
};

function fallbackCatalog(): Catalog {
  return {
    bodies: {
      "1door": 9861.81,
      "2door": 13296.59,
      "3door": 21458.28,
      corner: 19881.83,
    },
    drawerAddon: 8666.62,
    doors: {
      "welldora:ceviz": { single: 4528.64, pair: 8036.08 },
      "welldora:aytasi": { single: 4534.84, pair: 7934.37 },
      "welldora:ayna": { single: 6226.54, pair: 12496.43 },
      "welldora:cam": { single: 4898.01, pair: 9258.84 },
      "monerra:buz_gri": { single: 2110.15, pair: 3778.39 },
      "monerra:ayna": { single: 4314.71, pair: 8023.14 },
      "monerra:cam": { single: 5729.37, pair: 10807.72 },
      "travina:travent_almond": { single: 2475.36, pair: 4679.02 },
      "travina:ayna": { single: 4680.60, pair: 8309.09 },
      "travina:cam": { single: 4953.39, pair: 9258.84 },
      "cappadocia:aytasi": { single: 6756.09, pair: 12872.13 },
      "cappadocia:ayna": { single: 4680.60, pair: 8309.09 },
      "cappadocia:cam": { single: 4898.01, pair: 9258.84 },
    },
    accessories: {
      "welldora:sifonyer": 14870.94,
      "welldora:komodin": 6894.50,
      "welldora:makyajMasasi": 18728.25,
      "welldora:makyajAynasi": 3497.11,
      "welldora:puf": 4455.79,
      "monerra:sifonyer": 11516.75,
      "monerra:komodin": 5486.40,
      "monerra:makyajMasasi": 16242.26,
      "monerra:makyajAynasi": 3881.78,
      "monerra:puf": 4455.79,
      "travina:sifonyer": 11872.47,
      "travina:komodin": 5486.40,
      "travina:makyajMasasi": 15758.30,
      "travina:makyajAynasi": 3228.23,
      "travina:puf": 4455.79,
      "cappadocia:sifonyer3": 11577.23,
      "cappadocia:sifonyer4": 13268.87,
      "cappadocia:komodin": 5486.40,
      "cappadocia:makyajMasasi": 18986.68,
      "cappadocia:makyajAynasi": 4569.27,
      "cappadocia:puf": 4455.79,
    },
    sets: {
      "welldora:magnasand": {
        "140x200": 49428.42,
        "150x200": 50456.69,
        "160x200": 52676.83,
        "180x200": 58270.83,
        "200x200": 65381.06,
      },
      "welldora:biosalt": {
        "140x200": 54881.20,
        "150x200": 56586.46,
        "160x200": 59098.47,
        "180x200": 65135.79,
        "200x200": 72897.25,
      },
      "monerra:climextra": {
        "140x200": 43765.03,
        "150x200": 44448.75,
        "160x200": 46501.75,
        "180x200": 52324.54,
        "200x200": 58584.89,
      },
      "monerra:blacksand": {
        "140x200": 51787.51,
        "150x200": 52392.48,
        "160x200": 54730.45,
        "180x200": 60885.98,
        "200x200": 68072.64,
      },
      "travina:bohemella": {
        "140x200": 44667.18,
        "150x200": 45179.27,
        "160x200": 46570.24,
        "180x200": 51035.73,
        "200x200": 57966.25,
      },
      "travina:borjen": {
        "140x200": 51583.69,
        "150x200": 52172.76,
        "160x200": 54484.18,
        "180x200": 60698.38,
        "200x200": 68057.52,
      },
      "cappadocia:cappadocia_natura": {
        "140x200": 54030.82,
        "150x200": 54658.44,
        "160x200": 57148.65,
        "180x200": 63608.63,
        "200x200": 71203.49,
      },
    },
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function priceByPairRule(count: number, single: number, pair: number) {
  const pairs = Math.floor(count / 2);
  const odd = count % 2;
  return pairs * pair + odd * single;
}

function parseRef(ref: unknown): { seriesId: string; finishId: string } | null {
  const raw = String(ref || "").trim();
  if (!raw) return null;
  const i = raw.indexOf(":");
  if (i === -1) return { seriesId: "welldora", finishId: raw };
  return { seriesId: raw.slice(0, i), finishId: raw.slice(i + 1) };
}

function overlayDbItems(catalog: Catalog, items: Record<string, unknown>[]) {
  for (const it of items) {
    const type = String(it.item_type || "");
    if (type === "body") {
      const bodyType = String(it.body_type || "");
      const price = num(it.price);
      if (price == null) continue;
      if (bodyType === "drawerAddon") catalog.drawerAddon = price;
      else if (BODY_LABEL[bodyType]) catalog.bodies[bodyType] = price;
    } else if (type === "door") {
      const seriesId = String(it.series_id || "");
      const finishId = String(it.finish_id || "");
      if (!seriesId || !finishId) continue;
      const key = seriesId + ":" + finishId;
      const cur = catalog.doors[key] || { single: 0, pair: 0 };
      const single = num(it.price_single);
      const pair = num(it.price_pair);
      catalog.doors[key] = {
        single: single != null ? single : cur.single,
        pair: pair != null ? pair : cur.pair,
      };
    } else if (type === "accessory") {
      const seriesId = String(it.series_id || "");
      const key = String(it.accessory_key || "");
      const price = num(it.price);
      if (!seriesId || !key || price == null) continue;
      catalog.accessories[seriesId + ":" + key] = price;
    } else if (type === "set") {
      const seriesId = String(it.series_id || "");
      const key = String(it.accessory_key || "");
      const size = String(it.size || "").trim();
      const price = num(it.price);
      if (!seriesId || !key || !size || price == null) continue;
      const setKey = seriesId + ":" + key;
      if (!catalog.sets[setKey]) catalog.sets[setKey] = {};
      catalog.sets[setKey][size] = price;
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const body = await req.json();
    const sessionId = String(body?.session_id || "").trim();
    if (!sessionId) return json({ ok: false, error: "no_session" }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: session, error: sessionErr } = await sb
      .from("dealer_sessions")
      .select("id, ended_at")
      .eq("id", sessionId)
      .is("ended_at", null)
      .maybeSingle();

    if (sessionErr || !session) {
      return json({ ok: false, error: "session_not_found" }, 401);
    }

    const catalog = fallbackCatalog();
    const origin = String(req.headers.get("origin") || req.headers.get("referer") || "");
    const previewHeader = String(req.headers.get("x-dolap-preview") || "");
    const preview =
      previewHeader === "1" ||
      body?.preview === true ||
      body?.preview === "true" ||
      body?.preview === 1 ||
      /localhost|127\.0\.0\.1|\[::1\]/.test(origin);
    let list: { id: string; version: number } | null = null;
    if (preview) {
      const { data: latest } = await sb
        .from("price_lists")
        .select("id, version")
        .order("created_at", { ascending: false })
        .limit(1);
      const row = Array.isArray(latest) ? latest[0] : latest;
      list = (row ?? null) as { id: string; version: number } | null;
    } else {
      const { data: active } = await sb
        .from("price_lists")
        .select("id, version")
        .eq("active", true)
        .maybeSingle();
      list = (active ?? null) as { id: string; version: number } | null;
    }
    if (list?.id) {
      const { data: items } = await sb
        .from("price_items")
        .select(
          "item_type, series_id, body_type, finish_id, accessory_key, size, price, price_single, price_pair",
        )
        .eq("price_list_id", list.id);
      if (items?.length) overlayDbItems(catalog, items as Record<string, unknown>[]);
    }

    const modules = Array.isArray(body?.modules) ? body.modules : [];
    const accessories = Array.isArray(body?.accessories) ? body.accessories : [];
    const sets = Array.isArray(body?.sets) ? body.sets : [];

    const lineItems: Array<{
      label: string;
      qty: number;
      unitPrice: number;
      lineTotal: number;
    }> = [];

    let bodyTotal = 0;
    let drawerTotal = 0;
    const bodyCounts: Record<string, number> = {};
    let drawerQty = 0;

    for (const mod of modules) {
      const type = String(mod?.type || "");
      if (!BODY_LABEL[type]) continue;
      bodyCounts[type] = (bodyCounts[type] || 0) + 1;
      if (mod?.drawer) drawerQty += 1;
    }

    for (const type of ["1door", "2door", "3door", "corner"]) {
      const qty = bodyCounts[type] || 0;
      if (!qty) continue;
      const unit = catalog.bodies[type] || 0;
      bodyTotal += unit * qty;
      lineItems.push({
        label: BODY_LABEL[type],
        qty,
        unitPrice: unit,
        lineTotal: unit * qty,
      });
    }

    if (drawerQty) {
      const unit = catalog.drawerAddon || 0;
      drawerTotal = unit * drawerQty;
      lineItems.push({
        label: "Çekmece Modülü",
        qty: drawerQty,
        unitPrice: unit,
        lineTotal: drawerTotal,
      });
    }

    const doorGroups: Record<
      string,
      { label: string; qty: number; single: number; pair: number }
    > = {};
    for (const mod of modules) {
      const doors = Array.isArray(mod?.doors) ? mod.doors : [];
      for (const raw of doors) {
        const parsed = parseRef(raw);
        if (!parsed) continue;
        const key = parsed.seriesId + ":" + parsed.finishId;
        const price = catalog.doors[key];
        if (!price) continue;
        if (!doorGroups[key]) {
          const seriesLabel = SERIES_LABEL[parsed.seriesId] || parsed.seriesId;
          const finishLabel = FINISH_LABEL[parsed.finishId] || parsed.finishId;
          doorGroups[key] = {
            label: seriesLabel + " · " + finishLabel,
            qty: 0,
            single: price.single,
            pair: price.pair,
          };
        }
        doorGroups[key].qty += 1;
      }
    }

    let doorsTotal = 0;
    for (const g of Object.values(doorGroups)) {
      const lineTotal = priceByPairRule(g.qty, g.single, g.pair);
      doorsTotal += lineTotal;
      lineItems.push({
        label: g.label + " Kapak",
        qty: g.qty,
        unitPrice: g.single,
        lineTotal,
      });
    }

    let accTotal = 0;
    for (const a of accessories) {
      const parsed = parseRef(a?.ref);
      const qty = Math.max(0, Math.round(Number(a?.qty) || 0));
      if (!parsed || !qty) continue;
      const key = parsed.seriesId + ":" + parsed.finishId;
      const unit = catalog.accessories[key];
      if (unit == null) continue;
      const lineTotal = unit * qty;
      accTotal += lineTotal;
      const seriesLabel = SERIES_LABEL[parsed.seriesId] || parsed.seriesId;
      const label = ACC_LABEL[key] || parsed.finishId;
      lineItems.push({
        label: seriesLabel + " · " + label,
        qty,
        unitPrice: unit,
        lineTotal,
      });
    }

    let setTotal = 0;
    for (const s of sets) {
      const seriesId = String(s?.seriesId || "").trim();
      const keyName = String(s?.key || "").trim();
      const size = String(s?.size || "").trim();
      const qty = Math.max(0, Math.round(Number(s?.qty) || 0));
      if (!seriesId || !keyName || !size || !qty) continue;
      const setKey = seriesId + ":" + keyName;
      const unit = catalog.sets[setKey]?.[size];
      if (unit == null) continue;
      const lineTotal = unit * qty;
      setTotal += lineTotal;
      const seriesLabel = SERIES_LABEL[seriesId] || seriesId;
      const label = SET_LABEL[setKey] || keyName;
      lineItems.push({
        label: seriesLabel + " · " + label + " Set · " + size,
        qty,
        unitPrice: unit,
        lineTotal,
      });
    }

    const pricing = {
      body: bodyTotal,
      doors: doorsTotal,
      drawer: drawerTotal,
      accessories: accTotal,
      sets: setTotal,
      total: bodyTotal + doorsTotal + drawerTotal + accTotal + setTotal,
    };

    const out: Record<string, unknown> = {
      ok: true,
      pricing,
      lineItems,
      priceVersion: list?.version ?? null,
      pricePreview: preview,
    };

    if (body?.includeCatalog) {
      out.catalog = {
        accessories: catalog.accessories,
        sets: catalog.sets,
      };
    }

    return json(out);
  } catch (e) {
    return json(
      { ok: false, error: String((e as Error)?.message || e) },
      500,
    );
  }
});
