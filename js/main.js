/* ============================================
   PORTAL CURY – MAIN JAVASCRIPT
   ============================================ */

(function () {
  'use strict';

  /* ---- Sticky Header ---- */
  const header = document.getElementById('header');

  /* ---- Hero Parallax ---- */
  const heroBgParallax = document.querySelector('.hero__bg-parallax');
  window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', window.scrollY > 60);
    if (heroBgParallax) {
      heroBgParallax.style.transform = `translateY(${window.scrollY * 0.22}px)`;
    }
  }, { passive: true });

  /* ---- Mobile Menu ---- */
  const menuBtn = document.getElementById('menuBtn');
  menuBtn && menuBtn.addEventListener('click', () => {
    header.classList.toggle('mobile-open');
  });

  // Close menu on nav link click
  document.querySelectorAll('.header__nav a').forEach(link => {
    link.addEventListener('click', () => header.classList.remove('mobile-open'));
  });

  /* ---- Filter Tabs ---- */
  const filterTabs = document.querySelectorAll('.filter-tab');
  const cards = document.querySelectorAll('.emp-card');

  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const filter = tab.dataset.filter;

      // Update active tab
      filterTabs.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      // Filter cards
      cards.forEach(card => {
        if (filter === 'all' || card.dataset.bairro === filter) {
          card.classList.remove('hidden');
          card.style.animation = 'none';
          requestAnimationFrame(() => {
            card.style.animation = '';
          });
        } else {
          card.classList.add('hidden');
        }
      });
    });
  });

  /* ---- "Saiba Mais" buttons pre-fill form ---- */
  document.querySelectorAll('[data-empreendimento]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const emp = btn.dataset.empreendimento;
      const selectMap = {
        'Luzes do Rio':                 'luzes-do-rio',
        'Residencial Cartola':          'residencial-cartola',
        'Residencial Nova Norte Raízes':'nova-norte-raizes',
        'Caminhos da Guanabara':        'caminhos-guanabara',
        'Farol da Guanabara':           'farol-guanabara',
        'Residencial Pixinguinha':      'residencial-pixinguinha',
      };

      // Pre-fill both forms
      ['hero-interest', 'ct-interest'].forEach(id => {
        const sel = document.getElementById(id);
        if (sel && selectMap[emp]) sel.value = selectMap[emp];
      });
    });
  });

  /* ---- Captura gclid (Google Ads Click ID) ---- */
  // Armazena por 30 dias; enviado com cada lead para conversão server-side
  (function () {
    try {
      var p = new URLSearchParams(window.location.search);
      var gc = p.get('gclid');
      if (gc) {
        localStorage.setItem('_pc_gc', gc);
        localStorage.setItem('_pc_gc_ts', Date.now().toString());
      }
    } catch (e) {}
  })();

  function getStoredGclid() {
    try {
      var gc = localStorage.getItem('_pc_gc');
      var ts = parseInt(localStorage.getItem('_pc_gc_ts') || '0', 10);
      var TTL = 30 * 24 * 60 * 60 * 1000; // 30 dias
      if (gc && (Date.now() - ts) < TTL) return gc;
    } catch (e) {}
    return '';
  }
  window.getStoredGclid = getStoredGclid; // expõe para scripts inline (WA modal)

  /* ---- Captura UTM + referrer + landing page ---- */
  // Armazena por 30 dias; enviado com cada lead para rastreamento de origem no CRM
  (function () {
    try {
      var p = new URLSearchParams(window.location.search);
      var utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
      var hasUtm = false;
      utmKeys.forEach(function (k) { if (p.get(k)) hasUtm = true; });
      if (hasUtm) {
        var utmData = {};
        utmKeys.forEach(function (k) { utmData[k] = p.get(k) || ''; });
        utmData.referrer = document.referrer || '';
        utmData.landing_page = window.location.pathname + window.location.search;
        utmData.ts = Date.now();
        localStorage.setItem('_pc_utm', JSON.stringify(utmData));
      } else if (!localStorage.getItem('_pc_utm')) {
        // Sem UTM e sem dado salvo: salvar referrer + landing page para leads orgânicos
        var fallback = {
          utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '',
          referrer: document.referrer || '',
          landing_page: window.location.pathname,
          ts: Date.now(),
        };
        localStorage.setItem('_pc_utm', JSON.stringify(fallback));
      }
    } catch (e) {}
  })();

  function getStoredUtm() {
    try {
      var raw = localStorage.getItem('_pc_utm');
      if (!raw) return {};
      var d = JSON.parse(raw);
      var TTL = 30 * 24 * 60 * 60 * 1000; // 30 dias
      if ((Date.now() - (d.ts || 0)) > TTL) return {};
      return d;
    } catch (e) {}
    return {};
  }
  window.getStoredUtm = getStoredUtm; // expõe para scripts inline (WA modal)

  /* ---- Phone Mask ---- */
  function phoneMask(input) {
    // Hint element – shown temporarily when DDI 55 is auto-stripped
    const hint = document.createElement('small');
    hint.style.cssText = 'color:#dc2626;font-size:.78rem;display:none;margin-top:3px;line-height:1.3;';
    hint.textContent = '⚠ DDI 55 removido — informe apenas DDD + número (ex: 21 9 8888-7777)';
    if (input.parentNode) input.parentNode.insertBefore(hint, input.nextSibling);

    let hintTimer;
    input.addEventListener('input', () => {
      let raw = input.value.replace(/\D/g, '');

      // Auto-strip DDI 55: detectado quando dígitos ≥ 12 e começa com 55
      if (raw.length >= 12 && raw.startsWith('55')) {
        raw = raw.slice(2);
        clearTimeout(hintTimer);
        hint.style.display = 'block';
        hintTimer = setTimeout(() => { hint.style.display = 'none'; }, 5000);
      }

      raw = raw.substring(0, 11);

      if (raw.length <= 10) {
        raw = raw.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
      } else {
        raw = raw.replace(/(\d{2})(\d{1})(\d{4})(\d{0,4})/, '($1) $2 $3-$4');
      }
      input.value = raw;
    });
  }

  document.querySelectorAll('input[type="tel"]').forEach(phoneMask);

  /* ---- Currency Mask for FGTS valor ---- */
  function currencyMask(input) {
    input.addEventListener('input', () => {
      let v = input.value.replace(/\D/g, '');
      if (!v) { input.value = ''; return; }
      v = (parseInt(v, 10) / 100).toFixed(2);
      input.value = 'R$ ' + v.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    });
  }
  document.querySelectorAll('[name="fgts_valor"]').forEach(currencyMask);

  /* ---- Form Validation & Submission ---- */
  function validateForm(form) {
    let valid = true;
    const required = form.querySelectorAll('[required]');
    required.forEach(field => {
      field.classList.remove('error');
      if (!field.value.trim()) {
        field.classList.add('error');
        valid = false;
      }
    });
    return valid;
  }

  function showModal() {
    const modal = document.getElementById('successModal');
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function hideModal() {
    const modal = document.getElementById('successModal');
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  // Close modal
  document.getElementById('closeModal') && document.getElementById('closeModal').addEventListener('click', hideModal);
  document.querySelector('.modal__backdrop') && document.querySelector('.modal__backdrop').addEventListener('click', hideModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideModal(); });

  /* ---- Submit handler ---- */
  function handleFormSubmit(form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      if (!validateForm(form)) {
        const firstError = form.querySelector('.error');
        if (firstError) firstError.focus();
        return;
      }

      const btn = form.querySelector('button[type="submit"]');
      const originalText = btn.innerHTML;
      btn.innerHTML = '<span style="display:inline-block;width:18px;height:18px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:8px"></span>Enviando...';
      btn.disabled = true;

      if (!document.getElementById('spin-style')) {
        const style = document.createElement('style');
        style.id = 'spin-style';
        style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
        document.head.appendChild(style);
      }

      const formData = new FormData(form);
      const data = Object.fromEntries(formData.entries());

      // Collect multi-value checkboxes and extra fields, append to message
      const regions   = formData.getAll('regions');
      const fgts      = data.fgts       || '';
      const fgtsValor = data.fgts_valor || '';
      const renda     = data.renda      || '';
      let extra = '';
      if (regions.length > 0) extra += `Regiões: ${regions.join(', ')}. `;
      if (fgts)               extra += `FGTS/Entrada: ${fgts}. `;
      if (fgtsValor)          extra += `Valor: ${fgtsValor}. `;
      if (renda)              extra += `Renda familiar: ${renda}.`;
      if (extra) data.message = extra.trim() + (data.message ? ' | ' + data.message : '');
      delete data.regions;
      delete data.fgts;
      delete data.fgts_valor;
      delete data.renda;

      data.gclid = getStoredGclid(); // inclui gclid para conversão server-side
      var _utm = getStoredUtm();
      data.utm_source   = _utm.utm_source   || '';
      data.utm_medium   = _utm.utm_medium   || '';
      data.utm_campaign = _utm.utm_campaign || '';
      data.utm_content  = _utm.utm_content  || '';
      data.utm_term     = _utm.utm_term     || '';
      data.referrer_url = _utm.referrer     || '';
      data.landing_page = _utm.landing_page || '';
      // UUID único para deduplicar C2S (gtag) e S2S (pixel servidor)
      data.conversion_id = typeof window.generateConversionId === 'function'
        ? window.generateConversionId() : '';

      try {
        const res = await fetch('/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Erro ao enviar. Tente novamente.');

        form.reset();
        showModal();

        // Google Ads Conversion — Enhanced Conversions + deduplicação por transaction_id
        window.fireGadsConversion({
          email:         data.email  || '',
          phone:         data.phone  || '',
          transactionId: data.conversion_id || '',
        });

        // Meta Ads (Facebook Pixel) — disparado automaticamente via config do admin
        if (typeof fbq !== 'undefined' && window._META_EVENT) {
          fbq('track', window._META_EVENT);
        }

        // QAO Lead Capture
        if (window.QAO) {
          window.QAO.sendLead({
            name: data.name,
            email: data.email || "",
            phone: data.phone,
            data: {
              origem: "formulario_contato",
              pagina: window.location.pathname,
              interesse: data.interest || ""
            }
          });
        }

      } catch (err) {
        console.error('Erro ao enviar formulário:', err);
        alert(err.message || 'Ocorreu um erro. Entre em contato pelo WhatsApp.');
      } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
    });
  }

  document.querySelectorAll('.lead-form').forEach(handleFormSubmit);

  /* ---- Smooth scroll for anchor links ---- */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        e.preventDefault();
        const offset = 80;
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  /* ---- Intersection Observer – fade-in animation ---- */
  const observerOpts = { threshold: 0.1, rootMargin: '0px 0px -40px 0px' };
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        observer.unobserve(entry.target);
      }
    });
  }, observerOpts);

  // Add initial hidden state and observe
  const animatables = document.querySelectorAll(
    '.emp-card, .vantagem-item, .step-item, .stat-item, .channel-item'
  );
  animatables.forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(24px)';
    el.style.transition = `opacity .5s ease ${i * 0.05}s, transform .5s ease ${i * 0.05}s`;
    observer.observe(el);
  });

  /* ---- Announce filter changes to screen readers ---- */
  const liveRegion = document.createElement('div');
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.setAttribute('aria-atomic', 'true');
  liveRegion.className = 'sr-only';
  liveRegion.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;';
  document.body.appendChild(liveRegion);

  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const filter = tab.dataset.filter;
      const visible = [...cards].filter(c => !c.classList.contains('hidden')).length;
      const label = filter === 'all' ? 'todos os bairros' : tab.textContent;
      liveRegion.textContent = `Exibindo ${visible} empreendimento${visible !== 1 ? 's' : ''} em ${label}.`;
    });
  });

  /* ---- Dynamic config from API (WhatsApp + Rastreamento) ---- */
  fetch('/api/public-config')
    .then(r => r.json())
    .then(cfg => {
      // WhatsApp links
      if (cfg.whatsapp_number) {
        const num = cfg.whatsapp_number.replace(/\D/g, '');
        const msg = encodeURIComponent(cfg.whatsapp_message || '');
        const waUrl = `https://wa.me/${num}?text=${msg}`;
        document.querySelectorAll('a[href*="wa.me"]').forEach(a => { a.href = waUrl; });
      }

      // Google Tag Manager
      if (cfg.gtm_id) {
        (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',cfg.gtm_id);
        var ns=document.createElement('noscript');var fr=document.createElement('iframe');fr.src='https://www.googletagmanager.com/ns.html?id='+cfg.gtm_id;fr.height='0';fr.width='0';fr.style.cssText='display:none;visibility:hidden';ns.appendChild(fr);document.body.insertBefore(ns,document.body.firstChild);
      }

      // Google Ads (gtag.js)
      if (cfg.gads_tag_id) {
        var gScript=document.createElement('script');gScript.async=true;gScript.src='https://www.googletagmanager.com/gtag/js?id='+cfg.gads_tag_id;document.head.appendChild(gScript);
        window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments);};gtag('js',new Date());gtag('config',cfg.gads_tag_id);
        if (cfg.gads_conversion_label) {
          window._GADS = cfg.gads_tag_id + '/' + cfg.gads_conversion_label;
        }
      }

      // Meta Ads (Facebook Pixel)
      if (cfg.meta_pixel_id) {
        !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
        n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
        document,'script','https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', cfg.meta_pixel_id);
        fbq('track', 'PageView');
        window._META_EVENT = cfg.meta_conversion_event || 'Lead';
        
        // NoScript fallback
        var ns=document.createElement('noscript');
        var img=document.createElement('img');
        img.height='1'; img.width='1'; img.style.display='none';
        img.src='https://www.facebook.com/tr?id='+cfg.meta_pixel_id+'&ev=PageView&noscript=1';
        ns.appendChild(img);
        document.body.insertBefore(ns, document.body.firstChild);
      }

      // Código personalizado no <head>
      if (cfg.custom_head_code) {
        var headFrag=document.createElement('div');headFrag.innerHTML=cfg.custom_head_code;
        Array.from(headFrag.childNodes).forEach(function(n){document.head.appendChild(n.cloneNode(true));});
      }

      // Código personalizado no <body>
      if (cfg.custom_body_code) {
        var bodyFrag=document.createElement('div');bodyFrag.innerHTML=cfg.custom_body_code;
        Array.from(bodyFrag.childNodes).forEach(function(n){document.body.insertBefore(n.cloneNode(true),document.body.firstChild);});
      }
    })
    .catch(() => {});

  /* ---- WhatsApp Lead Modal — desativado: botão vai direto ao WhatsApp ---- */

  /* ---- Clique na foto do card ---- */
  document.querySelectorAll('.emp-card').forEach(card => {
    const imgWrap = card.querySelector('.emp-card__img-wrap');
    const link = card.querySelector('a.btn');
    if (imgWrap && link) {
      imgWrap.style.cursor = 'pointer';
      imgWrap.addEventListener('click', () => { window.location.href = link.href; });
    }
  });

  /* ---- Lazy Background Images (Intersection Observer) ---- */
  if ('IntersectionObserver' in window) {
    const lazyBgObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const bg = el.dataset.bg;
          if (bg) {
            el.style.backgroundImage = `url('${bg}')`;
            el.removeAttribute('data-bg');
          }
          lazyBgObserver.unobserve(el);
        }
      });
    }, { rootMargin: '200px 0px' }); // começa a carregar 200px antes de entrar na tela

    document.querySelectorAll('.lazy-bg').forEach(el => lazyBgObserver.observe(el));
  } else {
    // Fallback para browsers sem suporte a IntersectionObserver
    document.querySelectorAll('.lazy-bg').forEach(el => {
      const bg = el.dataset.bg;
      if (bg) el.style.backgroundImage = `url('${bg}')`;
    });
  }

})();

/* ============================================================
   GOOGLE ADS CONVERSION — helper global acessível por inline scripts
   Aguarda até 3s por window._GADS e window.gtag (carregamento async)

   opts (opcional):
     email         — e-mail do lead (plaintext; gtag faz o hash SHA-256)
     phone         — telefone do lead (plaintext; formatado E.164 internamente)
     transactionId — UUID único por submissão; usado pelo Google para deduplicar
                     disparos client-side e server-side do mesmo lead
   ============================================================ */

/* Gera UUID v4 para deduplicação de conversões */
window.generateConversionId = function () {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) {}
  // Fallback manual para browsers legados
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
};

/* Normaliza telefone para E.164 (+55XXXXXXXXXXX) */
function _toE164(phone) {
  var digits = (phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55') && digits.length >= 12) return '+' + digits;
  return '+55' + digits;
}

window.fireGadsConversion = function (opts) {
  opts = opts || {};
  var attempts = 0;
  var maxAttempts = 6; // 6 × 500ms = 3s

  var tryFire = function () {
    var id = window._GADS;

    if (!id) {
      if (attempts < maxAttempts) {
        attempts++;
        setTimeout(tryFire, 500); // aguarda _GADS ficar disponível
        return;
      }
      console.warn('[PortalCury] Conversão Google Ads: window._GADS não definido após 3s. Verifique a configuração em /admin → Google Ads (Tag ID + Label).');
      return;
    }

    if (typeof window.gtag === 'function') {
      // ── Enhanced Conversions: envia dados do usuário para match server-side ──
      // Google faz o hash SHA-256 internamente; não enviamos dado cru para servidores deles
      if (opts.email || opts.phone) {
        var userData = {};
        if (opts.email) userData.email = opts.email.toLowerCase().trim();
        if (opts.phone) userData.phone_number = _toE164(opts.phone);
        window.gtag('set', 'user_data', userData);
      }

      // ── Evento de conversão com transaction_id para deduplicação C2S + S2S ──
      var params = { send_to: id };
      if (opts.transactionId) params.transaction_id = opts.transactionId;

      window.gtag('event', 'conversion', params);
      console.log('[PortalCury] Conversão Google Ads disparada →', id,
        opts.transactionId ? '| txn=' + opts.transactionId.slice(0, 8) + '…' : '',
        opts.email ? '| enhanced=✓' : ''
      );
    } else if (attempts < maxAttempts) {
      attempts++;
      setTimeout(tryFire, 500);
    } else {
      console.warn('[PortalCury] Conversão Google Ads: window.gtag indisponível após 3s. gtag.js bloqueado ou Tag ID inválido?');
    }
  };

  tryFire();
};
