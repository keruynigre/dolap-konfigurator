'use strict';

const tls = require('tls');

const SUPABASE_URL = 'https://flhffroxhewrmyeufcsk.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsaGZmcm94aGV3cm15ZXVmY3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1MzI1NzksImV4cCI6MjEwMjEwODU3OX0.E1JSjsbTQga2B4ITYGYTTOXr8pg9gHJy8INiwO8ndJA';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function safeFilename(name) {
  const cleaned = String(name || 'teklif.pdf')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : (cleaned || 'teklif') + '.pdf';
}

function asciiFilename(name) {
  const ascii = String(name || 'teklif.pdf').replace(/[^\x20-\x7E]/g, '_');
  return ascii.toLowerCase().endsWith('.pdf') ? ascii : 'teklif.pdf';
}

function encodeRfc2047(value) {
  return '=?UTF-8?B?' + Buffer.from(String(value || ''), 'utf8').toString('base64') + '?=';
}

function wrap76(b64) {
  return b64.replace(/(.{76})/g, '$1\r\n');
}

function readSmtpReply(socket) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\r\n');
      if (!buf.endsWith('\r\n')) return;
      const full = lines.filter(Boolean);
      const last = full[full.length - 1] || '';
      if (/^\d{3} /.test(last)) {
        socket.removeListener('data', onData);
        resolve({ code: parseInt(last.slice(0, 3), 10), text: buf });
      }
    };
    socket.on('data', onData);
    socket.once('error', reject);
  });
}

function sendCmd(socket, line) {
  socket.write(line + '\r\n');
  return readSmtpReply(socket);
}

function smtpSend({ user, pass, from, to, rawMessage }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host: 'smtp.gmail.com',
        port: 465,
        servername: 'smtp.gmail.com',
        timeout: 20000
      },
      async () => {
        try {
          const greet = await readSmtpReply(socket);
          if (greet.code !== 220) throw new Error('smtp_greet_' + greet.code);
          const ehlo = await sendCmd(socket, 'EHLO dolap.bambi');
          if (ehlo.code !== 250) throw new Error('smtp_ehlo_' + ehlo.code);
          const auth = await sendCmd(socket, 'AUTH LOGIN');
          if (auth.code !== 334) throw new Error('smtp_auth_' + auth.code);
          const userRes = await sendCmd(socket, Buffer.from(user).toString('base64'));
          if (userRes.code !== 334) throw new Error('smtp_user_' + userRes.code);
          const passRes = await sendCmd(socket, Buffer.from(pass).toString('base64'));
          if (passRes.code !== 235) throw new Error('smtp_pass_' + passRes.code);
          const mailFrom = await sendCmd(socket, 'MAIL FROM:<' + from + '>');
          if (mailFrom.code !== 250) throw new Error('smtp_from_' + mailFrom.code);
          const rcpt = await sendCmd(socket, 'RCPT TO:<' + to + '>');
          if (rcpt.code !== 250 && rcpt.code !== 251) throw new Error('smtp_rcpt_' + rcpt.code);
          const data = await sendCmd(socket, 'DATA');
          if (data.code !== 354) throw new Error('smtp_data_' + data.code);
          const dot = await sendCmd(socket, rawMessage.replace(/^\./gm, '..') + '\r\n.');
          if (dot.code !== 250) throw new Error('smtp_end_' + dot.code);
          await sendCmd(socket, 'QUIT').catch(() => {});
          socket.end();
          resolve();
        } catch (err) {
          try { socket.destroy(); } catch (_) {}
          reject(err);
        }
      }
    );
    socket.setTimeout(20000, () => {
      socket.destroy();
      reject(new Error('smtp_timeout'));
    });
    socket.once('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'method' });
    return;
  }

  const gmailUser = String(process.env.GMAIL_USER || '').trim();
  const gmailPass = String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!gmailUser || !gmailPass) {
    json(res, 503, { ok: false, error: 'mail_not_configured' });
    return;
  }

  try {
    const body = await readBody(req);
    const sessionId = String(body.session_id || '').trim();
    const to = String(body.to || '').trim();
    const subject = String(body.subject || 'Bambi dolap teklifi').trim();
    const filename = safeFilename(body.filename);
    const path = String(body.path || '').trim();
    const pdfBase64 = String(body.pdf_base64 || '').replace(/\s+/g, '');

    if (!sessionId) {
      json(res, 401, { ok: false, error: 'no_session' });
      return;
    }
    if (!to || !to.includes('@')) {
      json(res, 400, { ok: false, error: 'missing_email' });
      return;
    }

    const sessionRes = await fetch(SUPABASE_URL + '/rest/v1/rpc/dealer_list_quote_leads', {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_session_id: sessionId, p_limit: 1 })
    });
    const sessionData = await sessionRes.json().catch(() => null);
    if (!sessionData || sessionData.ok !== true) {
      json(res, 401, { ok: false, error: 'session_not_found' });
      return;
    }

    let pdfBuf = null;
    if (pdfBase64) {
      pdfBuf = Buffer.from(pdfBase64, 'base64');
    } else if (path && !path.includes('..') && !path.startsWith('/')) {
      const pdfUrl =
        SUPABASE_URL + '/storage/v1/object/public/quote-pdfs/' + path.split('/').map(encodeURIComponent).join('/');
      const pdfRes = await fetch(pdfUrl);
      if (!pdfRes.ok) {
        json(res, 400, { ok: false, error: 'pdf_missing' });
        return;
      }
      pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
    }
    if (!pdfBuf || !pdfBuf.length) {
      json(res, 400, { ok: false, error: 'pdf_empty' });
      return;
    }

    const boundary = 'bambi_' + Date.now().toString(36);
    const rawMessage = [
      'From: Bambi Teklif <' + gmailUser + '>',
      'To: <' + to + '>',
      'Subject: ' + encodeRfc2047(subject),
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="' + boundary + '"',
      '',
      '--' + boundary,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      '',
      '--' + boundary,
      'Content-Type: application/pdf; name="' + asciiFilename(filename) + '"',
      'Content-Disposition: attachment; filename="' + asciiFilename(filename) + '"',
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(pdfBuf.toString('base64')),
      '--' + boundary + '--',
      ''
    ].join('\r\n');

    await smtpSend({
      user: gmailUser,
      pass: gmailPass,
      from: gmailUser,
      to,
      rawMessage
    });

    json(res, 200, { ok: true, via: 'gmail_smtp' });
  } catch (err) {
    console.error('send-quote-email', err && err.message ? err.message : err);
    json(res, 502, { ok: false, error: 'mail_send_failed' });
  }
};
