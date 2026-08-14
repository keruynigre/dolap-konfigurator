import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_REDIRECT = "https://dolap-konfigurator.vercel.app/admin/";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function adminRedirect(_raw: unknown) {
  return DEFAULT_REDIRECT;
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
    const redirectTo = adminRedirect(body?.redirect_to);

    if (!email || !email.includes("@")) {
      return json({ ok: false, error: "invalid_email" }, 400);
    }
    if (!displayName) {
      return json({ ok: false, error: "invalid_name" }, 400);
    }

    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listed.error) {
      return json({ ok: false, error: listed.error.message || "lookup_failed" }, 400);
    }
    let existing = (listed.data?.users || []).find(
      (u) => String(u.email || "").toLowerCase() === email,
    );

    let userId = existing?.id || "";
    let invited = false;
    let resent = false;

    if (!existing || !existing.email_confirmed_at) {
      const invitedRes = await admin.auth.admin.inviteUserByEmail(email, {
        data: { display_name: displayName },
        redirectTo,
      });
      if (invitedRes.data?.user?.id) {
        userId = invitedRes.data.user.id;
        invited = true;
        resent = !!existing;
      } else {
        const msg = String(invitedRes.error?.message || "").toLowerCase();
        if (existing && (msg.includes("already") || msg.includes("registered"))) {
          const link = await admin.auth.admin.generateLink({
            type: "invite",
            email,
            options: { data: { display_name: displayName }, redirectTo },
          });
          if (link.error) {
            return json({
              ok: false,
              error: link.error.message || invitedRes.error?.message || "invite_failed",
            }, 400);
          }
          userId = existing.id;
          invited = true;
          resent = true;
        } else {
          return json({
            ok: false,
            error: invitedRes.error?.message || "invite_failed",
          }, 400);
        }
      }
    } else {
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
        invited,
        resent,
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
      return json({ ok: false, error: insErr.message || "profile_failed" }, 400);
    }

    return json({
      ok: true,
      already_admin: false,
      invited,
      resent,
      email,
      display_name: displayName,
    });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
