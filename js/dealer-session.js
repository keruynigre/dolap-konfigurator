/**
 * Mağaza oturumu: kod ile giriş, tek cihaz kilidi, heartbeat, tasarım/teklif eventleri.
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
    client = global.supabase.createClient(cfg.url, cfg.anonKey);
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

  async function login(code) {
    const sb = getClient();
    if (!sb) return { ok: false, error: 'supabase_unavailable' };
    const { data, error } = await sb.rpc('dealer_login', {
      p_code: String(code || '').trim(),
      p_user_agent: navigator.userAgent || '',
      p_device_id: getDeviceId()
    });
    if (error) return { ok: false, error: error.message || 'rpc_error' };
    if (!data || !data.ok) return { ok: false, error: (data && data.error) || 'invalid_code' };
    const session = {
      session_id: data.session_id,
      dealer: data.dealer,
      started_at: new Date().toISOString()
    };
    saveSession(session);
    startHeartbeat();
    return { ok: true, session };
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

  global.DolapDealer = {
    login,
    logout,
    getSession,
    trackDesign,
    trackQuote,
    submitQuoteLead,
    listQuoteLeads,
    markQuoteOutcome,
    initIfLoggedIn,
    getClient,
    getDeviceId,
    setOnSessionInvalid
  };
})(window);
