import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return json({ ok: false, error: "not_authenticated" }, 401);
    }

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const userSb = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userSb.auth.getUser();
    const caller = userData?.user;
    if (userErr || !caller) {
      return json({ ok: false, error: "not_authenticated" }, 401);
    }

    const admin = createClient(url, service);
    const { data: callerProf } = await admin
      .from("admin_profiles")
      .select("user_id, can_manage_admins")
      .eq("user_id", caller.id)
      .maybeSingle();
    if (!callerProf) {
      return json({ ok: false, error: "not_admin" }, 403);
    }
    if (!callerProf.can_manage_admins) {
      return json({ ok: false, error: "not_manager" }, 403);
    }

    const body = await req.json();
    const email = String(body?.email || "").trim().toLowerCase();
    const displayName = String(body?.display_name || "").trim();
    const password = String(body?.password || "");

    if (!email || !email.includes("@")) {
      return json({ ok: false, error: "invalid_email" });
    }
    if (!displayName) {
      return json({ ok: false, error: "invalid_name" });
    }
    if (password.length < 8) {
      return json({ ok: false, error: "invalid_password" });
    }

    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listed.error) {
      return json({ ok: false, error: listed.error.message || "lookup_failed" });
    }
    const existing = (listed.data?.users || []).find(
      (u) => String(u.email || "").toLowerCase() === email,
    );

    let userId = existing?.id || "";

    if (!existing) {
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      });
      if (created.error || !created.data?.user?.id) {
        return json({
          ok: false,
          error: created.error?.message || "create_failed",
        });
      }
      userId = created.data.user.id;
    } else {
      const updated = await admin.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      });
      if (updated.error) {
        return json({
          ok: false,
          error: updated.error.message || "password_update_failed",
        });
      }
      userId = existing.id;
    }

    const { data: existingProf } = await admin
      .from("admin_profiles")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (existingProf) {
      await admin.from("admin_profiles").update({ display_name: displayName }).eq(
        "user_id",
        userId,
      );
      return json({
        ok: true,
        already_admin: true,
        password_set: true,
        email,
        display_name: displayName,
      });
    }

    const { error: insErr } = await admin.from("admin_profiles").insert({
      user_id: userId,
      display_name: displayName,
      can_manage_admins: false,
    });
    if (insErr) {
      return json({ ok: false, error: insErr.message || "profile_failed" });
    }

    return json({
      ok: true,
      already_admin: false,
      password_set: true,
      email,
      display_name: displayName,
    });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) });
  }
});
