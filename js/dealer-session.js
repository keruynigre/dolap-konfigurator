/**
 * Mağaza oturumu: e-posta/şifre (Supabase Auth), tek cihaz kilidi, heartbeat, tasarım/teklif eventleri.
 * Üye olma yok; yalnızca panelden eklenen hesaplar giriş yapabilir.
 */
(function (global) {
  const STORAGE_KEY = 'dolapDealerSession';
  const DEVICE_KEY = 'dolapDealerDeviceId';
  const HEARTBEAT_MS = 60000;

  let client = null;
  let heartbeatTimer = null;
  let lastTrackedSeries = null;
  let onSessionInvalid = null;

  function getClient() {
    if (client) return client;
    const cfg = global.DOLAP_SUPABASE;
    if (!cfg || !global.supabase) return null;
    client = global.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,
        detectSessionInUrl: true,
        flowType: 'implicit'
      }
    });
    return client;
  }

  function getDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (id && id.length >= 8) return id;
      id = (global.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : ('dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
      localStorage.setItem(DEVICE_KEY, id);
      return id;
    } catch (_) {
      return 'dev-fallback-' + String(Date.now());
    }
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.session_id || !s.dealer) return null;
      return s;
    } catch (_) {
      return null;
    }
  }

  function saveSession(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
    lastTrackedSeries = null;
    stopHeartbeat();
  }

  function getSession() {
    return loadSession();
  }

  function setOnSessionInvalid(fn) {
    onSessionInvalid = typeof fn === 'function' ? fn : null;
  }

  function invalidateLocalSession() {
    clearSession();
    if (onSessionInvalid) {
      try { onSessionInvalid(); } catch (_) { /* ignore */ }
    }
  }

  function applyDealerRpc(data) {
    const session = {
      session_id: data.session_id,
      dealer: data.dealer,
      started_at: new Date().toISOString()
    };
    saveSession(session);
    startHeartbeat();
    return { ok: true, session };
  }

  async function requireConfirmedAuthUser(sb) {
    const { data } = await sb.auth.getUser();
    const user = data && data.user;
    if (user && user.email_confirmed_at) return { ok: true, user };
    try { await sb.auth.signOut(); } catch (_) { /* ignore */ }
    clearSession();
    return { ok: false, error: 'email_not_confirmed' };
  }

  async function startDealerSessionFromAuth() {
    const sb = getClient();
    if (!sb) return { ok: false, error: 'supabase_unavailable' };
    const confirmed = await requireConfirmedAuthUser(sb);
    if (!confirmed.ok) return confirmed;
    const { data, error } = await sb.rpc('dealer_login_auth', {
      p_user_agent: navigator.userAgent || '',
      p_device_id: getDeviceId()
    });
    if (error) return { ok: false, error: error.message || 'rpc_error' };
    if (!data || !data.ok) {
      if (data && data.error === 'email_not_confirmed') {
        try { await sb.auth.signOut(); } catch (_) { /* ignore */ }
        clearSession();
      }
      return { ok: false, error: (data && data.error) || 'auth_session_failed' };
    }
    return applyDealerRpc(data);
  }

  function readAuthLinkType() {
    try {
      const hash = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
      const query = new URLSearchParams(String(location.search || '').replace(/^\?/, ''));
      return String(hash.get('type') || query.get('type') || '').toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function readAuthLinkError() {
    try {
      const hash = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
      const query = new URLSearchParams(String(location.search || '').replace(/^\?/, ''));
      return String(
        hash.get('error_description') ||
        query.get('error_description') ||
        hash.get('error') ||
        query.get('error') ||
        ''
      ).replace(/\+/g, ' ');
    } catch (_) {
      return '';
    }
  }

  function clearAuthLinkFromUrl() {
    try {
      if (location.hash || /[?&](code|type|error)=/.test(location.search)) {
        history.replaceState({}, document.title, location.pathname);
      }
    } catch (_) { /* ignore */ }
  }

  async function consumeAuthLink() {
    const sb = getClient();
    if (!sb) return { ok: false, error: 'supabase_unavailable' };
    const type = readAuthLinkType();
    const linkError = readAuthLinkError();
    if (linkError) {
      clearAuthLinkFromUrl();
      return { ok: false, error: 'auth_link_invalid', message: linkError };
    }
    const { data } = await sb.auth.getSession();
    const session = data && data.session;
    const needsPassword = type === 'invite' || type === 'recovery' || type === 'signup';
    if (needsPassword) {
      if (!session) {
        clearAuthLinkFromUrl();
        return { ok: false, error: 'auth_link_invalid' };
      }
      return { ok: true, needsPassword: true, type, session };
    }
    return { ok: true, needsPassword: false, type, session: session || null };
  }

  async function setPassword(password) {
    const sb = getClient();
    if (!sb) return { ok: false, error: 'supabase_unavailable' };
    const pwd = String(password || '');
    if (pwd.length < 6) return { ok: false, error: 'password_too_short' };
    const { error } = await sb.auth.updateUser({ password: pwd });
    if (error) return { ok: false, error: error.message || 'password_update_failed' };
    clearAuthLinkFromUrl();
    return startDealerSessionFromAuth();
  }

  async function loginWithPassword(email, password) {
    const sb = getClient();
    if (!sb) return { ok: false, error: 'supabase_unavailable' };
    const { error } = await sb.auth.signInWithPassword({
      email: String(email || '').trim(),
      password: String(password || '')
    });
    if (error) {
      const msg = String(error.message || '').toLowerCase();
      if (msg.indexOf('email not confirmed') !== -1) return { ok: false, error: 'email_not_confirmed' };
      return { ok: false, error: 'invalid_credentials' };
    }
    return startDealerSessionFromAuth();
  }

  async function resumeAuthSession() {
    const sb = getClient();
    if (!sb) return { ok: false, error: 'supabase_unavailable' };
    const { data } = await sb.auth.getSession();
    if (!data || !data.session) {
      clearSession();
      return { ok: false, error: 'no_auth' };
    }
    return startDealerSessionFromAuth();
  }

  async function logout() {
    const s = loadSession();
    const sb = getClient();
    if (s && sb) {
      try {
        await sb.rpc('dealer_logout', { p_session_id: s.session_id });
      } catch (_) { /* ignore */ }
    }
    clearSession();
    if (sb) {
      try { await sb.auth.signOut(); } catch (_) { /* ignore */ }
    }
  }

  async function heartbeat() {
    const s = loadSession();
    const sb = getClient();
    if (!s || !sb) return;
    try {
      const { data } = await sb.rpc('dealer_heartbeat', { p_session_id: s.session_id });
      if (data && data.ok === false && (data.error === 'session_not_found')) {
        invalidateLocalSession();
      }
    } catch (_) { /* ignore */ }
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeat();
    heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', onVisibility);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    document.removeEventListener('visibilitychange', onVisibility);
  }

  function onVisibility() {
    if (document.visibilityState === 'visible') heartbeat();
  }

  async function track(event, seriesId) {
    const s = loadSession();
    const sb = getClient();
    if (!s || !sb) return;
    try {
      await sb.rpc('dealer_track', {
        p_session_id: s.session_id,
        p_event: event,
        p_series_id: seriesId || null
      });
    } catch (_) { /* ignore */ }
  }

  function trackDesign(seriesId) {
    if (!seriesId) return;
    if (seriesId === lastTrackedSeries) return;
    lastTrackedSeries = seriesId;
    track('design', seriesId);
  }

  function trackQuote(seriesId) {
    track('quote', seriesId || lastTrackedSeries);
  }

  /** Teklif formunu sunucuya kaydet (müşteri bilgileri + özet). quote_count burada artar. */
  async function submitQuoteLead(opts) {
    opts = opts || {};
    const s = loadSession();
    const sb = getClient();
    if (!s || !s.session_id) return { ok: false, error: 'no_session' };
    if (!sb) return { ok: false, error: 'no_client' };
    let payload = opts.payload || null;
    if (payload != null) {
      try {
        payload = JSON.parse(JSON.stringify(payload));
      } catch (e) {
        return { ok: false, error: 'payload_not_serializable' };
      }
    }
    const totalPrice = opts.totalPrice;
    const safeTotal =
      totalPrice == null || totalPrice === '' || Number.isNaN(Number(totalPrice))
        ? null
        : Number(totalPrice);
    try {
      const { data, error } = await sb.rpc('submit_quote_lead', {
        p_session_id: s.session_id,
        p_customer: opts.customer || {},
        p_series_id: opts.seriesId || lastTrackedSeries || null,
        p_total_price: safeTotal,
        p_layout_mode: opts.layoutMode || null,
        p_payload: payload
      });
      if (error) {
        console.error('submit_quote_lead rpc error', error);
        return { ok: false, error: error.message || 'rpc_error' };
      }
      if (!data || !data.ok) {
        console.error('submit_quote_lead rejected', data);
        return data || { ok: false, error: 'unknown' };
      }
      return data;
    } catch (e) {
      console.error('submit_quote_lead exception', e);
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  async function listQuoteLeads(limit) {
    const s = loadSession();
    const sb = getClient();
    if (!s || !s.session_id) return { ok: false, error: 'no_session' };
    if (!sb) return { ok: false, error: 'no_client' };
    try {
      const { data, error } = await sb.rpc('dealer_list_quote_leads', {
        p_session_id: s.session_id,
        p_limit: limit || 50
      });
      if (error) return { ok: false, error: error.message || 'rpc_error' };
      if (!data || !data.ok) return data || { ok: false, error: 'unknown' };
      return data;
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  async function markQuoteOutcome(leadId, outcome, opts) {
    opts = opts || {};
    const s = loadSession();
    const sb = getClient();
    if (!s || !s.session_id) return { ok: false, error: 'no_session' };
    if (!sb) return { ok: false, error: 'no_client' };
    try {
      const { data, error } = await sb.rpc('dealer_mark_quote_outcome', {
        p_session_id: s.session_id,
        p_lead_id: leadId,
        p_outcome: outcome,
        p_sale_ref: opts.saleRef || null,
        p_note: opts.note || null
      });
      if (error) return { ok: false, error: error.message || 'rpc_error' };
      if (!data || !data.ok) return data || { ok: false, error: 'unknown' };
      return data;
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  function initIfLoggedIn() {
    if (loadSession()) startHeartbeat();
  }

  /** Teklif PDF'ini Storage'a yükler; Gmail/WhatsApp için paylaşılabilir URL döner. */
  async function uploadQuotePdf(blob, filename) {
    const sb = getClient();
    if (!sb) return { ok: false, error: 'no_client' };
    if (!blob) return { ok: false, error: 'no_blob' };
    const safeName = String(filename || 'teklif.pdf')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'teklif.pdf';
    const path =
      (global.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())) +
      '/' +
      (safeName.toLowerCase().endsWith('.pdf') ? safeName : safeName + '.pdf');
    try {
      const { error } = await sb.storage.from('quote-pdfs').upload(path, blob, {
        contentType: 'application/pdf',
        upsert: false,
        cacheControl: '3600'
      });
      if (error) {
        console.error('quote pdf upload', error);
        return { ok: false, error: error.message || 'upload_failed' };
      }
      const { data } = sb.storage.from('quote-pdfs').getPublicUrl(path);
      const url = data && data.publicUrl;
      if (!url) return { ok: false, error: 'no_public_url' };
      return { ok: true, url, path };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  async function sendQuoteEmail(opts) {
    opts = opts || {};
    const s = loadSession();
    if (!s || !s.session_id) return { ok: false, error: 'no_session' };
    const payload = {
      session_id: s.session_id,
      to: opts.to,
      subject: opts.subject,
      filename: opts.filename,
      path: opts.path || null,
      pdf_base64: opts.pdfBase64 || null
    };
    try {
      const res = await fetch('/api/send-quote-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => null);
      if (data && data.ok) return data;
      if (data && data.error) return { ok: false, error: data.error };
    } catch (e) {
      console.error('send-quote-email api', e);
    }
    const sb = getClient();
    if (!sb) return { ok: false, error: 'no_client' };
    try {
      const { data, error } = await sb.functions.invoke('send-quote-email', {
        body: {
          session_id: s.session_id,
          to: opts.to,
          subject: opts.subject,
          filename: opts.filename,
          path: opts.path || null,
          pdf_base64: opts.pdfBase64 || null,
          gmail_access_token: opts.gmailAccessToken || null
        }
      });
      if (data && data.ok) return data;
      const errCode = (data && data.error) || (error && error.message) || 'rpc_error';
      return { ok: false, error: errCode };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  async function calculateQuote(config) {
    config = config || {};
    const s = loadSession();
    const sb = getClient();
    if (!s || !s.session_id) return { ok: false, error: 'no_session' };
    if (!sb) return { ok: false, error: 'no_client' };
    try {
      const { data, error } = await sb.functions.invoke('calculate-quote', {
        body: {
          session_id: s.session_id,
          modules: config.modules || [],
          accessories: config.accessories || [],
          sets: config.sets || [],
          includeCatalog: !!config.includeCatalog
        }
      });
      if (error) return { ok: false, error: error.message || 'fn_error' };
      if (!data || !data.ok) return data || { ok: false, error: 'unknown' };
      return data;
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  global.DolapDealer = {
    calculateQuote,
    loginWithPassword,
    consumeAuthLink,
    setPassword,
    resumeAuthSession,
    logout,
    getSession,
    trackDesign,
    trackQuote,
    submitQuoteLead,
    listQuoteLeads,
    markQuoteOutcome,
    uploadQuotePdf,
    sendQuoteEmail,
    initIfLoggedIn,
    getClient,
    getDeviceId,
    setOnSessionInvalid
  };
})(window);
