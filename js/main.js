/* ============================================
   CENTRAL CURY VENDAS – MAIN JAVASCRIPT
   ============================================ */

(function () {
  'use strict';

  /* ---- Sticky Header ---- */
  const header = document.getElementById('header');
  window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', window.scrollY > 60);
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
        'Américas 19':                  'americas-19',
        'Metropolitan Dream':           'metropolitan-dream',
      };

      // Pre-fill both forms
      ['hero-interest', 'ct-interest'].forEach(id => {
        const sel = document.getElementById(id);
        if (sel && selectMap[emp]) sel.value = selectMap[emp];
      });
    });
  });

  /* ---- Phone Mask ---- */
  function phoneMask(input) {
    // Teclado numérico no mobile
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('autocomplete', 'tel');

    // Normaliza dígitos: remove DDI (55/0055) e zero de DDD (ex: 021 → 21)
    function normalizeDigits(raw) {
      let d = raw.replace(/\D/g, '');
      if (d.startsWith('0055'))                   d = d.slice(4);   // 0055 21...
      else if (d.startsWith('55') && d.length > 11) d = d.slice(2); // 55 21...
      if (d.length > 1 && d.startsWith('0'))       d = d.slice(1);  // 021... → 21...
      return d.slice(0, 11);
    }

    function applyMask(raw) {
      const d = normalizeDigits(raw);
      if (d.length <= 2)  return d.replace(/(\d{1,2})/, '($1');
      if (d.length <= 6)  return d.replace(/(\d{2})(\d{1,4})/, '($1) $2');
      if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d{1,4})/, '($1) $2-$3');
                          return d.replace(/(\d{2})(\d{1})(\d{4})(\d{1,4})/, '($1) $2 $3-$4');
    }

    // Bloqueia teclas não numéricas (permite controles)
    input.addEventListener('keydown', e => {
      const ctrl = e.ctrlKey || e.metaKey;
      const allowed = ['Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Tab','Home','End'];
      if (ctrl || allowed.includes(e.key)) return;
      if (!/^\d$/.test(e.key)) e.preventDefault();
    });

    // Reaplica máscara a cada input — salva dígitos brutos (pré-normalização) em dataset
    input.addEventListener('input', () => {
      input.dataset.rawPhone = input.value.replace(/\D/g, ''); // dígitos antes de normalizar
      input.value = applyMask(input.value);
    });

    // Colar: salva raw dos dígitos colados e normaliza
    input.addEventListener('paste', e => {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData).getData('text');
      input.dataset.rawPhone = pasted.replace(/\D/g, '');
      input.value = applyMask(pasted);
    });
  }

  // Valida se o telefone tem dígitos suficientes (10 = fixo, 11 = celular)
  function isPhoneValid(input) {
    const digits = input.value.replace(/\D/g, '');
    return digits.length === 10 || digits.length === 11;
  }

  document.querySelectorAll('input[type="tel"]').forEach(phoneMask);

  /* ---- Form Validation & Submission ---- */
  function validateForm(form) {
    let valid = true;
    form.querySelectorAll('[required]').forEach(field => {
      field.classList.remove('error');
      field.removeAttribute('data-error');
      let fieldValid = !!field.value.trim();
      if (fieldValid && field.type === 'tel') fieldValid = isPhoneValid(field);
      if (!fieldValid) {
        field.classList.add('error');
        if (field.type === 'tel') field.setAttribute('data-error', 'DDD + número inválido');
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

      const data = Object.fromEntries(new FormData(form).entries());
      // Inclui o telefone exatamente como o cliente digitou (pré-normalização)
      const telInput = form.querySelector('input[type="tel"]');
      if (telInput) data.phone_raw = telInput.dataset.rawPhone || data.phone;

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

        // Google Ads Conversion — disparado automaticamente via config do admin
        if (typeof gtag !== 'undefined' && window._GADS) {
          gtag('event', 'conversion', { 'send_to': window._GADS });
        }

        // Facebook Pixel (descomentar após configurar)
        // if (typeof fbq !== 'undefined') {
        //   fbq('track', 'Lead');
        // }

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

  /* ---- WhatsApp Lead Modal ---- */
  (function () {
    const modal = document.getElementById('waLeadModal');
    if (!modal) return;

    let pendingWaUrl = '';

    function openWaModal(url) {
      pendingWaUrl = url;
      modal.classList.add('open');
      document.body.style.overflow = 'hidden';
      const nameInput = modal.querySelector('#wa-name');
      if (nameInput) setTimeout(() => nameInput.focus(), 100);
    }

    function closeWaModal() {
      modal.classList.remove('open');
      document.body.style.overflow = '';
    }

    // Intercept all WhatsApp links
    document.addEventListener('click', e => {
      const link = e.target.closest('a[href*="wa.me"], .whatsapp-float');
      if (!link) return;
      e.preventDefault();
      openWaModal(link.href);
    });

    document.getElementById('waModalClose') && document.getElementById('waModalClose').addEventListener('click', closeWaModal);
    document.getElementById('waModalBackdrop') && document.getElementById('waModalBackdrop').addEventListener('click', closeWaModal);

    // Apply phone mask to modal input
    const waPhoneInput = modal.querySelector('#wa-phone');
    if (waPhoneInput) phoneMask(waPhoneInput);

    const waForm = modal.querySelector('#waLeadForm');
    waForm && waForm.addEventListener('submit', async e => {
      e.preventDefault();
      const nameInput  = modal.querySelector('#wa-name');
      const phoneInput = modal.querySelector('#wa-phone');
      const name  = nameInput.value.trim();
      const phone = phoneInput.value.trim();

      // Validação com as mesmas regras do formulário principal
      let valid = true;
      nameInput.style.borderColor  = '';
      phoneInput.style.borderColor = '';
      phoneInput.removeAttribute('title');
      if (!name)  { nameInput.style.borderColor  = '#e53e3e'; valid = false; }
      if (!isPhoneValid(phoneInput)) {
        phoneInput.style.borderColor = '#e53e3e';
        phoneInput.setAttribute('title', 'DDD + número inválido (mín. 10 dígitos)');
        valid = false;
      }
      if (!valid) return;

      const phone_raw = phoneInput.dataset.rawPhone || phone;

      const btn = waForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Aguarde...';

      let waRedirectUrl = pendingWaUrl;
      try {
        const resp = await fetch('/api/leads/wa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, phone, phone_raw }),
        });
        const json = await resp.json();
        if (json.wa_url) waRedirectUrl = json.wa_url;
      } catch (_) { /* silent — always redirect */ }

      closeWaModal();
      waForm.reset();
      modal.querySelector('#wa-name').style.borderColor  = '';
      modal.querySelector('#wa-phone').style.borderColor = '';
      delete modal.querySelector('#wa-phone').dataset.rawPhone;
      btn.disabled = false;
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg> Continuar para o WhatsApp';

      window.open(waRedirectUrl, '_blank', 'noopener');
    });
  })();

})();
