/* ============================================================
   PORTAL CURY – GALLERY & LIGHTBOX JS
   ============================================================ */
(function () {
  'use strict';

  const mainImg    = document.getElementById('galleryMain');
  const thumbsEl   = document.getElementById('galleryThumbs');
  const lightbox   = document.getElementById('lightbox');
  const lbImg      = document.getElementById('lightboxImg');
  const lbClose    = document.getElementById('lightboxClose');
  const lbPrev     = document.getElementById('lightboxPrev');
  const lbNext     = document.getElementById('lightboxNext');

  if (!mainImg || !thumbsEl) return;

  const thumbs   = Array.from(thumbsEl.querySelectorAll('.gallery-thumb'));
  const images   = thumbs.map(t => t.dataset.src);
  let currentIdx = 0;

  /* ---- Thumb click → update main image ---- */
  thumbs.forEach((thumb, idx) => {
    thumb.addEventListener('click', () => {
      currentIdx = idx;
      updateMain(images[idx]);
      thumbs.forEach(t => t.classList.remove('active'));
      thumb.classList.add('active');
    });
  });

  function updateMain(src) {
    const img = mainImg.querySelector('img');
    if (img) { img.src = src; img.alt = ''; }
  }

  /* ---- Main image click → open lightbox ---- */
  mainImg.addEventListener('click', () => openLightbox(currentIdx));
  thumbs.forEach((t, i) => {
    t.addEventListener('dblclick', () => openLightbox(i));
  });

  function openLightbox(idx) {
    currentIdx = idx;
    lbImg.src = images[idx];
    lightbox.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    lightbox.classList.remove('open');
    document.body.style.overflow = '';
  }

  function showLightboxImage(idx) {
    currentIdx = (idx + images.length) % images.length;
    lbImg.src = images[currentIdx];
  }

  lbClose && lbClose.addEventListener('click', closeLightbox);
  lbPrev  && lbPrev.addEventListener('click',  () => showLightboxImage(currentIdx - 1));
  lbNext  && lbNext.addEventListener('click',  () => showLightboxImage(currentIdx + 1));

  lightbox && lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('open')) return;
    if (e.key === 'Escape')      closeLightbox();
    if (e.key === 'ArrowLeft')   showLightboxImage(currentIdx - 1);
    if (e.key === 'ArrowRight')  showLightboxImage(currentIdx + 1);
  });

  /* ---- Touch swipe on lightbox ---- */
  let touchStartX = 0;
  lightbox && lightbox.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
  lightbox && lightbox.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) showLightboxImage(currentIdx + (dx < 0 ? 1 : -1));
  });

})();
