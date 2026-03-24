/* ============================================================
   CENTRAL CURY VENDAS – Analytics Tracker
   Registra pageviews e mantém heartbeat de sessão ativa
   ============================================================ */
(function () {
  'use strict';

  // Gera/recupera session_id persistente na aba
  let sid = sessionStorage.getItem('_ccv_sid');
  if (!sid) {
    sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem('_ccv_sid', sid);
  }

  // Detecta dispositivo
  function getDevice() {
    const ua = navigator.userAgent;
    if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
    if (/mobile|android|iphone|ipod|blackberry|windows phone/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  // Lê parâmetros UTM da URL atual
  function getUtm() {
    const p = new URLSearchParams(window.location.search);
    // Persiste UTMs na sessão para não perder em navegações internas
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(k => {
      if (p.get(k)) sessionStorage.setItem('_ccv_' + k, p.get(k));
    });
    return {
      utm_source:   sessionStorage.getItem('_ccv_utm_source')   || '',
      utm_medium:   sessionStorage.getItem('_ccv_utm_medium')   || '',
      utm_campaign: sessionStorage.getItem('_ccv_utm_campaign') || '',
      utm_content:  sessionStorage.getItem('_ccv_utm_content')  || '',
      utm_term:     sessionStorage.getItem('_ccv_utm_term')     || '',
    };
  }

  function send(endpoint, extra) {
    const body = JSON.stringify({
      session_id: sid,
      page: window.location.pathname + window.location.search,
      ...extra,
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  }

  // Registra pageview
  function trackPageview() {
    const utm = getUtm();
    send('/api/analytics/pageview', {
      referrer: document.referrer,
      device: getDevice(),
      ...utm,
    });
  }

  // Heartbeat a cada 60 s para manter visitante "ativo"
  function startHeartbeat() {
    setInterval(() => {
      send('/api/analytics/heartbeat', {});
    }, 60 * 1000);
  }

  trackPageview();
  startHeartbeat();
})();
