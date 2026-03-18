/* ============================================
   PORTAL CURY – MAIN JAVASCRIPT
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
    input.addEventListener('input', () => {
      let v = input.value.replace(/\D/g, '').substring(0, 11);
      if (v.length <= 10) {
        v = v.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
      } else {
        v = v.replace(/(\d{2})(\d{1})(\d{4})(\d{0,4})/, '($1) $2 $3-$4');
      }
      input.value = v;
    });
  }

  document.querySelectorAll('input[type="tel"]').forEach(phoneMask);

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

      // Add spinner keyframe if not present
      if (!document.getElementById('spin-style')) {
        const style = document.createElement('style');
        style.id = 'spin-style';
        style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
        document.head.appendChild(style);
      }

      // Collect form data
      const data = Object.fromEntries(new FormData(form).entries());

      try {
        /*
         * INTEGRAÇÃO: Substitua o bloco abaixo pelo endpoint real
         * Exemplo: await fetch('/api/leads', { method: 'POST', body: JSON.stringify(data) })
         * Ou integre com RD Station, HubSpot, Leadlovers, etc.
         */
        await simulateSubmit(data);

        form.reset();
        showModal();

        // Google Ads Conversion Tracking (descomentar após configurar)
        // if (typeof gtag !== 'undefined') {
        //   gtag('event', 'conversion', { 'send_to': 'AW-XXXXXXXXX/XXXXXXXX' });
        // }

        // Facebook Pixel (descomentar após configurar)
        // if (typeof fbq !== 'undefined') {
        //   fbq('track', 'Lead');
        // }

      } catch (err) {
        console.error('Erro ao enviar formulário:', err);
        alert('Ocorreu um erro. Por favor, tente novamente ou entre em contato pelo WhatsApp.');
      } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
    });
  }

  // Simula envio (remover em produção)
  function simulateSubmit(data) {
    console.log('Lead capturado:', data);
    return new Promise(resolve => setTimeout(resolve, 1200));
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

})();
