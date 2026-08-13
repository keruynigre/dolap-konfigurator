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

function bytesToBase64(bytes: Uint8Array) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function encodeRfc2047(value: string) {
  const bytes = new TextEncoder().encode(value);
  return `=?UTF-8?B?${bytesToBase64(bytes)}?=`;
}

function wrap76(b64: string) {
  return b64.replace(/(.{76})/g, "$1\r\n");
}

function safeFilename(name: string) {
  const cleaned = String(name || "teklif.pdf")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.toLowerCase().endsWith(".pdf")
    ? cleaned
    : `${cleaned || "teklif"}.pdf`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const body = await req.json();
    const sessionId = String(body?.session_id || "").trim();
    const to = String(body?.to || "").trim();
    const subject = String(body?.subject || "Bambi dolap teklifi").trim();
    const filename = safeFilename(body?.filename);
    const path = String(body?.path || "").trim();
    const gmailToken = String(body?.gmail_access_token || "").trim();

    if (!sessionId) return json({ ok: false, error: "no_session" }, 401);
    if (!to || !to.includes("@")) {
      return json({ ok: false, error: "missing_email" }, 400);
    }
    if (!path || path.includes("..")) {
      return json({ ok: false, error: "missing_pdf" }, 400);
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: session, error: sessionErr } = await sb
      .from("dealer_sessions")
      .select("id, dealer_id, ended_at")
      .eq("id", sessionId)
      .is("ended_at", null)
      .maybeSingle();

    if (sessionErr || !session) {
      return json({ ok: false, error: "session_not_found" }, 401);
    }

    const { data: file, error: fileErr } = await sb.storage
      .from("quote-pdfs")
      .download(path);
    if (fileErr || !file) {
      return json({ ok: false, error: "pdf_missing" }, 400);
    }

    const pdfBytes = new Uint8Array(await file.arrayBuffer());
    if (!pdfBytes.length) return json({ ok: false, error: "pdf_empty" }, 400);

    const pdfB64 = wrap76(bytesToBase64(pdfBytes));
    const boundary = `bambi_${crypto.randomUUID()}`;
    const mime = [
      `To: ${to}`,
      `Subject: ${encodeRfc2047(subject)}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 7bit",
      "",
      "",
      `--${boundary}`,
      `Content-Type: application/pdf; name="${filename}"`,
      `Content-Disposition: attachment; filename="${filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      pdfB64,
      `--${boundary}--`,
      "",
    ].join("\r\n");

    if (gmailToken) {
      const raw = btoa(mime)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
      const gmailRes = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${gmailToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ raw }),
        },
      );
      if (!gmailRes.ok) {
        const errText = await gmailRes.text();
        console.error("gmail send", gmailRes.status, errText);
        return json({ ok: false, error: "gmail_send_failed" }, 502);
      }
      return json({ ok: true, via: "gmail" });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY") || "";
    if (resendKey) {
      const from =
        Deno.env.get("MAIL_FROM") || "Bambi Teklif <beth.t@example.com>";
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject,
          text: " ",
          attachments: [
            {
              filename,
              content: bytesToBase64(pdfBytes),
              content_type: "application/pdf",
            },
          ],
        }),
      });
      if (!resendRes.ok) {
        const errText = await resendRes.text();
        console.error("resend send", resendRes.status, errText);
        return json({ ok: false, error: "mail_send_failed" }, 502);
      }
      return json({ ok: true, via: "resend" });
    }

    const gmailUser = Deno.env.get("GMAIL_USER") || "";
    const gmailPass = Deno.env.get("GMAIL_APP_PASSWORD") || "";
    if (gmailUser && gmailPass) {
      const { SMTPClient } = await import(
        "https://deno.land/x/denomailer@1.6.0/mod.ts"
      );
      const client = new SMTPClient({
        connection: {
          hostname: "smtp.gmail.com",
          port: 465,
          tls: true,
          auth: {
            username: gmailUser,
            password: gmailPass,
          },
        },
      });
      try {
        await client.send({
          from: gmailUser,
          to,
          subject,
          content: " ",
          attachments: [
            {
              content: pdfBytes,
              encoding: "binary",
              filename,
              mimeType: "application/pdf",
            },
          ],
        });
      } finally {
        try {
          await client.close();
        } catch (_) {
          /* ignore */
        }
      }
      return json({ ok: true, via: "gmail_smtp" });
    }

    return json({ ok: false, error: "mail_not_configured" }, 503);
  } catch (err) {
    console.error("send-quote-email", err);
    return json({ ok: false, error: "mail_exception" }, 500);
  }
});
