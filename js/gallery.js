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
  const items    = thumbs.map(t => ({
    type:   t.dataset.type || 'image',
    src:    t.dataset.src,
    poster: t.dataset.poster || '',
  }));
  const images   = items.filter(it => it.type === 'image').map(it => it.src);
  let currentIdx = 0;

  /* ---- Thumb click → update main item ---- */
  thumbs.forEach((thumb, idx) => {
    thumb.addEventListener('click', () => {
      currentIdx = idx;
      updateMain(items[idx]);
      thumbs.forEach(t => t.classList.remove('active'));
      thumb.classList.add('active');
    });
  });

  function updateMain(item) {
    const video = mainImg.querySelector('video');
    if (video) video.pause();
    if (item.type === 'video') {
      mainImg.innerHTML = '';
      const v = document.createElement('video');
      v.src = item.src;
      if (item.poster) v.poster = item.poster;
      v.controls = true;
      v.preload = 'metadata';
      v.setAttribute('playsinline', '');
      mainImg.appendChild(v);
    } else {
      mainImg.innerHTML = '';
      const img = document.createElement('img');
      img.src = item.src;
      img.alt = '';
      mainImg.appendChild(img);
    }
  }

  /* ---- Main image click → open lightbox (fotos apenas) ---- */
  mainImg.addEventListener('click', () => {
    if (items[currentIdx] && items[currentIdx].type === 'video') return;
    openLightbox(currentIdx);
  });
  thumbs.forEach((t, i) => {
    t.addEventListener('dblclick', () => {
      if (items[i].type === 'video') return;
      openLightbox(i);
    });
  });

  let lbIdx = 0;

  function openLightbox(idx) {
    currentIdx = idx;
    const imgIdx = images.indexOf(items[idx].src);
    lbIdx = imgIdx === -1 ? 0 : imgIdx;
    lbImg.src = images[lbIdx];
    lightbox.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    lightbox.classList.remove('open');
    document.body.style.overflow = '';
  }

  function showLightboxImage(idx) {
    lbIdx = (idx + images.length) % images.length;
    lbImg.src = images[lbIdx];
  }

  lbClose && lbClose.addEventListener('click', closeLightbox);
  lbPrev  && lbPrev.addEventListener('click',  () => showLightboxImage(lbIdx - 1));
  lbNext  && lbNext.addEventListener('click',  () => showLightboxImage(lbIdx + 1));

  lightbox && lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('open')) return;
    if (e.key === 'Escape')      closeLightbox();
    if (e.key === 'ArrowLeft')   showLightboxImage(lbIdx - 1);
    if (e.key === 'ArrowRight')  showLightboxImage(lbIdx + 1);
  });

  /* ---- Touch swipe on lightbox ---- */
  let touchStartX = 0;
  lightbox && lightbox.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
  lightbox && lightbox.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) showLightboxImage(lbIdx + (dx < 0 ? 1 : -1));
  });

})();
