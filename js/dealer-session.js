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
  let heartbeatInFlight = false;
  let rebindInFlight = null;

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
    // Önce yerel oturum: getUser() ağ hatasında null dönerse signOut yapmak
    // sekme değişiminde / uyanmada yanlışlıkla çıkışa yol açıyordu.
    const local = await sb.auth.getSession();
    const localUser = local && local.data && local.data.session && local.data.session.user;
    if (localUser && localUser.email_confirmed_at) return { ok: true, user: localUser };
    if (localUser && !localUser.email_confirmed_at) {
      try { await sb.auth.signOut(); } catch (_) { /* ignore */ }
      clearSession();
      return { ok: false, error: 'email_not_confirmed' };
    }

    let remoteUser = null;
    try {
      const { data, error } = await sb.auth.getUser();
      if (error) return { ok: false, error: 'auth_check_failed' };
      remoteUser = data && data.user;
    } catch (_) {
      return { ok: false, error: 'auth_check_failed' };
    }
    if (remoteUser && remoteUser.email_confirmed_at) return { ok: true, user: remoteUser };
    if (remoteUser && !remoteUser.email_confirmed_at) {
      try { await sb.auth.signOut(); } catch (_) { /* ignore */ }
      clearSession();
      return { ok: false, error: 'email_not_confirmed' };
    }
    return { ok: false, error: 'no_auth' };
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

  function waitForAuthInit(sb) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (session) => {
        if (done) return;
        done = true;
        try { sub.unsubscribe(); } catch (_) { /* ignore */ }
        resolve(session || null);
      };
      const { data: { subscription: sub } } = sb.auth.onAuthStateChange((event, session) => {
        if (event === 'INITIAL_SESSION') finish(session);
      });
      setTimeout(() => {
        sb.auth.getSession()
          .then(({ data }) => finish(data && data.session))
          .catch(() => finish(null));
      }, 2500);
    });
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
    const session = await waitForAuthInit(sb);
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

  async function isAdminUser(session) {
    const sb = getClient();
    const uid = session && session.user && session.user.id;
    if (!sb || !uid) return false;
    const { data } = await sb.from('admin_profiles').select('user_id').eq('user_id', uid).maybeSingle();
    return !!(data && data.user_id);
  }

  async function setPassword(password) {
    const sb = getClient();
    if (!sb) return { ok: false, error: 'supabase_unavailable' };
    const pwd = String(password || '');
    if (pwd.length < 6) return { ok: false, error: 'password_too_short' };
    const { error } = await sb.auth.updateUser({ password: pwd });
    if (error) return { ok: false, error: error.message || 'password_update_failed' };
    clearAuthLinkFromUrl();
    const login = await startDealerSessionFromAuth();
    if (!login.ok && login.error === 'not_dealer') {
      return { ok: true, adminRedirect: true };
    }
    return login;
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
    // Auth storage hydrate olmadan getSession null dönerse oturumu silme.
    let session = await waitForAuthInit(sb);
    if (!session) {
      const again = await sb.auth.getSession();
      session = again && again.data && again.data.session;
    }
    if (!session) {
      // Yerel bayi kaydı kalsın; auth yoksa kapıyı göster ama agresif silme yapma.
      return { ok: false, error: 'no_auth' };
    }
    return startDealerSessionFromAuth();
  }

  async function logout() {
    stopHeartbeat();
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

  async function rebindDealerSession() {
    if (rebindInFlight) return rebindInFlight;
    rebindInFlight = (async () => {
      const res = await startDealerSessionFromAuth();
      return !!(res && res.ok);
    })().finally(() => {
      rebindInFlight = null;
    });
    return rebindInFlight;
  }

  async function heartbeat() {
    if (heartbeatInFlight) return;
    const s = loadSession();
    const sb = getClient();
    if (!s || !sb) return;
    if (document.visibilityState === 'hidden') return;
    heartbeatInFlight = true;
    try {
      const { data } = await sb.rpc('dealer_heartbeat', { p_session_id: s.session_id });
      if (data && data.ok === false && data.error === 'session_not_found') {
        // Sekme yarışı / takeover sonrası: önce aynı auth ile oturumu yeniden bağla.
        const rebound = await rebindDealerSession();
        if (!rebound) invalidateLocalSession();
      }
    } catch (_) { /* ignore transient network */ }
    finally {
      heartbeatInFlight = false;
    }
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

  /** Tasarım: Teklifi Gönder başarılı olunca 1 sayılır. */
  function trackDesign(seriesId) {
    const sid = seriesId || lastTrackedSeries || null;
    if (sid) lastTrackedSeries = sid;
    track('design', sid);
  }

  /** Teklif formu açıldı (gönderim değil). */
  function trackQuoteOpen(seriesId) {
    const sid = seriesId || lastTrackedSeries;
    if (sid) lastTrackedSeries = sid;
    track('quote_open', sid || null);
  }

  /** Eski yardımcı: form gönderimi artık submit_quote_lead ile sayılır. */
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

  function isLocalPreviewHost() {
    const loc = global.location || {};
    const h = String(loc.hostname || '');
    const host = String(loc.host || '');
    const href = String(loc.href || '');
    if (/\.vercel\.app$/i.test(h) || /dolap-konfigurator\.vercel\.app/i.test(href)) return false;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1') return true;
    if (host.indexOf('localhost') !== -1 || host.indexOf('127.0.0.1') !== -1) return true;
    if (String(loc.port) === '5173') return true;
    return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
  }

  function ensureLocalPriceBanner(version) {
    if (!isLocalPreviewHost() || !global.document) return;
    let el = document.getElementById('dolap-local-price-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dolap-local-price-banner';
      el.setAttribute('style',
        'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;padding:8px 12px;border-radius:8px;' +
        'background:#161616;color:#e8d5a3;font:12px/1.4 Inter,sans-serif;border:1px solid #c9a35a;text-align:center;');
      document.body.appendChild(el);
    }
    el.textContent = version
      ? ('Yerel test: taslak v' + version + '. Canlı site değişmez; adminde Canlıya al ile yayınlanır.')
      : 'Yerel test: taslak fiyatlar. Canlı site değişmez; adminde Canlıya al ile yayınlanır.';
  }

  async function calculateQuote(config) {
    config = config || {};
    const s = loadSession();
    const sb = getClient();
    if (!s || !s.session_id) return { ok: false, error: 'no_session' };
    if (!sb) return { ok: false, error: 'no_client' };
    try {
      const preview = isLocalPreviewHost();
      if (preview) ensureLocalPriceBanner();
      const { data, error } = await sb.functions.invoke('calculate-quote', {
        headers: preview ? { 'x-dolap-preview': '1' } : {},
        body: {
          session_id: s.session_id,
          modules: config.modules || [],
          accessories: config.accessories || [],
          sets: config.sets || [],
          rugs: config.rugs || [],
          includeCatalog: !!config.includeCatalog,
          preview: preview
        }
      });
      if (error) return { ok: false, error: error.message || 'fn_error' };
      if (!data || !data.ok) return data || { ok: false, error: 'unknown' };
      if (preview) ensureLocalPriceBanner(data.priceVersion);
      return data;
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  global.DolapDealer = {
    calculateQuote,
    loginWithPassword,
    consumeAuthLink,
    isAdminUser,
    setPassword,
    resumeAuthSession,
    logout,
    getSession,
    trackDesign,
    trackQuoteOpen,
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
