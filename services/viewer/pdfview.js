/* Pouch viewer runtime — PDF reader (built on the embedded pdf.js) */
(function () {
  'use strict';
  const PV = window.PV, h = PV.h, esc = PV.esc;
  const GAP = 14, PAD = 16;

  async function render(ctx) {
    const { meta, blob, root } = ctx;
    if (typeof pdfjsLib === 'undefined') throw new Error('The PDF engine is not available in this pouch.');
    const raw = new Uint8Array(await blob.arrayBuffer());
    const P = (k, d) => PV.pref.get('p.' + k, d);
    const saved = PV.store.get('pdf', null) || {};
    const S = { mode: (saved[meta.id] && saved[meta.id].mode) || 'width', zoom: (saved[meta.id] && saved[meta.id].zoom) || 1, scale: 1, rot: 0, night: P('night', false), compat: P('compat', false), cur: 1, pdf: null, slots: [], texts: [], tok: 0, hits: [], hit: -1, q: '', gen: 0, destroyed: false };
    root.classList.add('pv-pdf');

    /* ---- DOM ---- */
    const pages = h('div', { class: 'pd-pages' });
    const scroller = h('div', { class: 'pd-scroll pv-scroll', tabindex: '0' }, pages);
    const loading = h('div', { class: 'pd-loading' }, h('div', { class: 'vd-spin' }, h('i')), h('span', { text: 'Opening PDF…' }));
    const side = h('aside', { class: 'pd-side' + (innerWidth >= 900 ? ' open' : '') });
    const thumbs = h('div', { class: 'pd-thumbs pv-scroll' }), outline = h('div', { class: 'pd-outline pv-scroll pv-hidden' });
    const sideTabs = h('div', { class: 'pv-seg pd-tabs' },
      h('button', { type: 'button', class: 'on', 'data-t': 'pages', html: PV.ic('grid', 14) + '<span>Pages</span>', onclick: () => sideTab('pages') }),
      h('button', { type: 'button', 'data-t': 'outline', html: PV.ic('list', 14) + '<span>Outline</span>', onclick: () => sideTab('outline') }));
    side.append(sideTabs, thumbs, outline);
    const main = h('div', { class: 'pd-main' }, side, h('div', { class: 'pd-view' }, scroller, loading));

    const pageIn = h('input', { class: 'pv-input pd-page', type: 'text', inputmode: 'numeric', value: '1', 'aria-label': 'Page number' });
    const pageTot = h('span', { class: 'pv-label', text: '/ –' });
    const zoomBtn = h('button', { class: 'pv-chip pd-zoom', type: 'button', text: '100%', onclick: (e) => zoomMenu(e.currentTarget) });
    const btn = (icon, label, fn, cls) => PV.btn(icon, label, fn, 'pv-btn-sm ' + (cls || ''), 18);
    const sideBtn = btn('sidebar', 'Pages & outline', () => { side.classList.toggle('open'); sideBtn.classList.toggle('on', side.classList.contains('open')); setTimeout(relayout, 30); });
    const nightBtn = btn('moon', 'Night mode (D)', () => { S.night = !S.night; PV.pref.set('p.night', S.night); applyNight(); });
    const searchBtn = btn('search', 'Search (Ctrl+F)', () => openSearch());
    const bar = h('div', { class: 'pv-bar' }, sideBtn, h('span', { class: 'pv-sep' }),
      btn('up', 'Previous page', () => goTo(S.cur - 1), 'pv-hide-sm'), pageIn, pageTot, btn('down', 'Next page', () => goTo(S.cur + 1), 'pv-hide-sm'), h('span', { class: 'pv-sep pv-hide-sm' }),
      btn('zoomOut', 'Zoom out (−)', () => zoomStep(1 / 1.25)), zoomBtn, btn('zoomIn', 'Zoom in (+)', () => zoomStep(1.25)),
      h('span', { class: 'pv-grow' }), btn('rotCw', 'Rotate (R)', () => { S.rot = (S.rot + 90) % 360; relayout(true); }, 'pv-hide-sm'), nightBtn, searchBtn, btn('full', 'Fullscreen', () => PV.toggleFull(root), 'pv-hide-sm'), btn('more', 'More', (e) => moreMenu(e.currentTarget)));
    const search = {
      bar: PV.searchBar({ noOptions: true, placeholder: 'Search in document…', onQuery: (q) => runSearch(q), onNext: () => stepHit(1), onPrev: () => stepHit(-1), onClose: () => closeSearch() }),
    };
    root.append(bar, search.bar.el, main);

    function sideTab(t) { [...sideTabs.children].forEach((b) => b.classList.toggle('on', b.dataset.t === t)); thumbs.classList.toggle('pv-hidden', t !== 'pages'); outline.classList.toggle('pv-hidden', t !== 'outline'); }
    function applyNight() { pages.classList.toggle('night', S.night); nightBtn.classList.toggle('on', S.night); }

    /* ---- document ---- */
    let task = null;
    async function openDoc() {
      S.gen++;
      loading.classList.remove('pv-hidden');
      loading.querySelector('span').textContent = 'Opening PDF…';
      if (S.pdf) { try { Promise.resolve(S.pdf.destroy()).catch(() => {}); } catch (e) { /* ignore */ } S.pdf = null; }
      pages.innerHTML = ''; thumbs.innerHTML = ''; outline.innerHTML = ''; S.slots = []; S.texts = []; S.hits = []; S.hit = -1;
      task = pdfjsLib.getDocument({ data: new Uint8Array(raw), disableFontFace: S.compat, isEvalSupported: false });
      task.onPassword = (cb, reason) => {
        const pw = window.prompt(reason === 2 ? 'Incorrect password. Try again:' : 'This PDF is password-protected. Enter the password:');
        if (pw == null) { Promise.resolve(task.destroy()).catch(() => {}); PV.message(root, 'Password required', 'This PDF is protected and can’t be shown without its password.', true); return; }
        cb(pw);
      };
      task.onProgress = (p) => { if (p.total) loading.querySelector('span').textContent = 'Opening PDF… ' + Math.round((p.loaded / p.total) * 100) + '%'; };
      const pdf = await task.promise;
      if (S.destroyed) { pdf.destroy(); return; }
      S.pdf = pdf;
      const p1 = await pdf.getPage(1);
      S.base = baseDims(p1);
      for (let i = 1; i <= pdf.numPages; i++) {
        const el = h('div', { class: 'pd-page-slot', 'data-i': i }, h('span', { class: 'pd-ph', text: String(i) }));
        pages.appendChild(el);
        S.slots.push({ i, el, pw: S.base[0], ph: S.base[1], top: 0, h: 0, rendered: null, task: null });
      }
      pageTot.textContent = '/ ' + pdf.numPages;
      loading.classList.add('pv-hidden');
      applyNight();
      layout();
      const st = saved[meta.id];
      if (st && st.page > 1) goTo(st.page, true);
      update();
      buildThumbs(); buildOutline();
      sizePass(S.gen);
      scroller.focus({ preventScroll: true });
    }
    const baseDims = (pg) => { const v = pg.getViewport({ scale: 1 }); return [v.width, v.height]; };
    async function sizePass(gen) {
      for (let i = 2; i <= S.pdf.numPages; i++) {
        if (S.destroyed || gen !== S.gen) return;
        try {
          const pg = await S.pdf.getPage(i), d = baseDims(pg), sl = S.slots[i - 1];
          if (Math.abs(d[0] - sl.pw) > 0.5 || Math.abs(d[1] - sl.ph) > 0.5) { sl.pw = d[0]; sl.ph = d[1]; sl.dirty = true; }
        } catch (e) { /* ignore */ }
        if (i % 30 === 0) { if (S.slots.some((s) => s.dirty)) relayout(false, true); await PV.sleep(0); }
      }
      if (S.slots.some((s) => s.dirty)) relayout(false, true);
    }

    /* ---- layout / zoom ---- */
    const dimsOf = (sl) => (S.rot % 180 === 0 ? [sl.pw, sl.ph] : [sl.ph, sl.pw]);
    function computeScale() {
      const cw = scroller.clientWidth - PAD * 2, ch = scroller.clientHeight - PAD * 2;
      const [w, h2] = dimsOf(S.slots[0] || { pw: 612, ph: 792 });
      if (S.mode === 'width') S.scale = cw / w;
      else if (S.mode === 'page') S.scale = Math.min(cw / w, ch / h2);
      else S.scale = S.zoom;
      S.scale = PV.clamp(S.scale || 1, 0.2, 6);
    }
    function layout() {
      computeScale();
      let y = PAD;
      for (const sl of S.slots) {
        const [w, h2] = dimsOf(sl);
        sl.w = Math.round(w * S.scale); sl.h = Math.round(h2 * S.scale); sl.top = y; y += sl.h + GAP;
        sl.el.style.width = sl.w + 'px'; sl.el.style.height = sl.h + 'px'; sl.dirty = false;
      }
      pages.style.height = y + PAD - GAP + 'px';
      zoomBtn.textContent = Math.round(S.scale * 100) + '%';
    }
    function relayout(forceRerender, keepPos) {
      if (!S.slots.length) return;
      const cur = S.slots[S.cur - 1], frac = cur && cur.h ? (scroller.scrollTop - cur.top) / cur.h : 0;
      layout();
      if (forceRerender) S.slots.forEach((sl) => unrender(sl));
      else S.slots.forEach((sl) => { if (sl.rendered && (sl.rendered.scale !== S.scale || sl.rendered.w !== sl.w)) unrender(sl); });
      const n = S.slots[S.cur - 1];
      if (n) scroller.scrollTop = n.top + frac * n.h;
      update();
    }
    function setMode(mode, z) { S.mode = mode; if (z) S.zoom = z; persist(); relayout(); }
    function zoomStep(f) { S.mode = 'custom'; S.zoom = PV.clamp(S.scale * f, 0.2, 6); persist(); relayout(); }
    function zoomMenu(anchor) {
      PV.menu(anchor, [{ label: 'Fit width', active: S.mode === 'width', onClick: () => setMode('width') }, { label: 'Fit page', active: S.mode === 'page', onClick: () => setMode('page') }, '-',
        ...[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((z) => ({ label: z * 100 + '%', active: S.mode === 'custom' && Math.abs(S.zoom - z) < 0.01, onClick: () => setMode('custom', z) }))], { title: 'Zoom' });
    }
    function moreMenu(anchor) {
      PV.menu(anchor, [{ label: 'Rotate', icon: 'rotCw', onClick: () => { S.rot = (S.rot + 90) % 360; relayout(true); } },
        { label: 'Fullscreen', icon: 'full', onClick: () => PV.toggleFull(root) },
        { label: 'Compatibility mode', sub: S.compat ? 'on' : 'off', icon: 'gear', active: S.compat, onClick: () => { S.compat = !S.compat; PV.pref.set('p.compat', S.compat); PV.toast(S.compat ? 'Drawing fonts as shapes (slower, most compatible)' : 'Using normal font rendering', 2400); openDoc().catch(fail); } },
        '-', { label: 'Download', icon: 'download', onClick: () => { const b = document.getElementById('download-file-btn'); b && b.click(); } }]);
    }
    function persist() { const all = PV.store.get('pdf', {}) || {}; all[meta.id] = { page: S.cur, mode: S.mode, zoom: S.zoom }; PV.store.set('pdf', all); }

    /* ---- page rendering ---- */
    function unrender(sl) {
      if (sl.task) { try { sl.task.cancel(); } catch (e) { /* ignore */ } sl.task = null; }
      if (!sl.rendered && !sl.el.querySelector('canvas')) return;
      const c = sl.el.querySelector('canvas'); if (c) { c.width = 0; c.height = 0; }
      sl.el.querySelectorAll('.pd-canvas,.pd-text,.pd-links').forEach((n) => n.remove());
      sl.rendered = null; sl.divs = null;
    }
    async function renderPage(sl) {
      if (S.destroyed || !S.pdf || sl.rendered || sl.busy) return;
      sl.busy = true;
      const gen = S.gen, scale = S.scale, rot = S.rot;
      try {
        const page = await S.pdf.getPage(sl.i);
        if (gen !== S.gen || scale !== S.scale || rot !== S.rot) { sl.busy = false; return; }
        const vp = page.getViewport({ scale, rotation: (page.rotate + rot) % 360 });
        const dpr = window.devicePixelRatio || 1, os = Math.min(dpr, Math.sqrt(14e6 / (vp.width * vp.height)), 3);
        const canvas = h('canvas', { class: 'pd-canvas' });
        canvas.width = Math.floor(vp.width * os); canvas.height = Math.floor(vp.height * os);
        canvas.style.width = Math.floor(vp.width) + 'px'; canvas.style.height = Math.floor(vp.height) + 'px';
        sl.el.style.width = Math.floor(vp.width) + 'px';
        sl.el.appendChild(canvas);
        const g2 = canvas.getContext('2d', { alpha: false }); g2.fillStyle = '#fff'; g2.fillRect(0, 0, canvas.width, canvas.height);
        const t = page.render({ canvasContext: g2, viewport: vp, transform: os !== 1 ? [os, 0, 0, os, 0, 0] : null, background: '#ffffff' });
        sl.task = t;
        await t.promise;
        sl.task = null;
        sl.rendered = { scale, w: sl.w, rot };
        sl.el.querySelector('.pd-ph') && sl.el.querySelector('.pd-ph').remove();
        // text layer
        const tcont = h('div', { class: 'pd-text' });
        tcont.style.setProperty('--scale-factor', vp.scale);
        sl.el.appendChild(tcont);
        const tc = await page.getTextContent();
        const divs = [], strs = [];
        await pdfjsLib.renderTextLayer({ textContentSource: tc, container: tcont, viewport: vp, textDivs: divs, textContentItemsStr: strs }).promise;
        sl.divs = divs; sl.strs = strs; if (!S.texts[sl.i - 1]) S.texts[sl.i - 1] = tc.items.map((it) => it.str);
        applyHits(sl);
        // links
        try {
          const ann = await page.getAnnotations({ intent: 'display' });
          const lay = h('div', { class: 'pd-links' });
          for (const a of ann) {
            if (a.subtype !== 'Link' || !(a.url || a.dest)) continue;
            const r = vp.convertToViewportRectangle(a.rect);
            const a2 = h('a', { class: 'pd-link', style: { left: Math.min(r[0], r[2]) + 'px', top: Math.min(r[1], r[3]) + 'px', width: Math.abs(r[2] - r[0]) + 'px', height: Math.abs(r[3] - r[1]) + 'px' } });
            if (a.url && /^(https?:|mailto:)/i.test(a.url)) { a2.href = a.url; a2.target = '_blank'; a2.rel = 'noopener noreferrer'; a2.title = a.url; }
            else if (a.dest) a2.addEventListener('click', (e) => { e.preventDefault(); navDest(a.dest); });
            else continue;
            lay.appendChild(a2);
          }
          if (sl.el.isConnected) sl.el.appendChild(lay);
        } catch (e) { /* ignore */ }
      } catch (e) {
        if (e && e.name !== 'RenderingCancelledException') console.warn('page render failed', sl.i, e);
        const c = sl.el.querySelector('canvas'); if (c && !sl.rendered) c.remove();
      } finally { sl.busy = false; sl.task = null; }
    }
    function visibleRange() {
      const top = scroller.scrollTop, bot = top + scroller.clientHeight;
      let lo = 0, hi = S.slots.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (S.slots[m].top + S.slots[m].h < top) lo = m + 1; else hi = m; }
      let first = lo, last = lo;
      while (last + 1 < S.slots.length && S.slots[last + 1].top < bot) last++;
      return [first, last];
    }
    let raf = 0;
    function update() {
      if (!S.slots.length) return;
      const [a, b] = visibleRange();
      const mid = scroller.scrollTop + scroller.clientHeight * 0.4;
      let cur = a; for (let i = a; i <= b; i++) if (S.slots[i].top <= mid) cur = i;
      if (S.cur !== cur + 1) { S.cur = cur + 1; pageIn.value = String(S.cur); markThumb(); persistSoon(); }
      for (let i = Math.max(0, a - 1); i <= Math.min(S.slots.length - 1, b + 1); i++) renderPage(S.slots[i]);
      for (let i = 0; i < S.slots.length; i++) if ((i < a - 5 || i > b + 5) && (S.slots[i].rendered || S.slots[i].task)) unrender(S.slots[i]);
    }
    let pT = 0; const persistSoon = () => { clearTimeout(pT); pT = setTimeout(persist, 600); };
    scroller.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); }); });
    function goTo(n, instant) {
      n = PV.clamp(Math.round(n) || 1, 1, S.slots.length || 1);
      const sl = S.slots[n - 1]; if (!sl) return;
      scroller.scrollTo({ top: sl.top - 8, behavior: instant ? 'auto' : 'smooth' });
      if (instant) update();
    }
    pageIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { goTo(parseInt(pageIn.value, 10)); scroller.focus(); } e.stopPropagation(); });
    pageIn.addEventListener('focus', () => pageIn.select());
    pageIn.addEventListener('blur', () => { pageIn.value = String(S.cur); });
    const ro = new ResizeObserver(() => { if (S.destroyed || !S.pdf || !scroller.clientWidth) return; if (S.slots.length && S.mode !== 'custom') relayout(); else update(); });
    ro.observe(scroller);

    /* ---- wheel / pinch zoom ---- */
    scroller.addEventListener('wheel', (e) => { if (!e.ctrlKey) return; e.preventDefault(); S.mode = 'custom'; S.zoom = PV.clamp(S.scale * Math.exp(-e.deltaY * 0.01), 0.2, 6); clearTimeout(wheelT); wheelT = setTimeout(() => relayout(), 120); preview(S.zoom / S.scale, e.clientX, e.clientY); }, { passive: false });
    let wheelT = 0;
    let pz = null;
    function preview(k, cx, cy) {
      const r = scroller.getBoundingClientRect();
      pages.style.transformOrigin = scroller.scrollLeft + (cx - r.left) + 'px ' + (scroller.scrollTop + (cy - r.top)) + 'px';
      pages.style.transform = 'scale(' + k + ')';
    }
    scroller.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) { const a = e.touches[0], b = e.touches[1]; const r = scroller.getBoundingClientRect(); pz = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s: S.scale, mx: (a.clientX + b.clientX) / 2 - r.left, my: (a.clientY + b.clientY) / 2 - r.top, k: 1, sl: scroller.scrollLeft, st: scroller.scrollTop }; }
    }, { passive: true });
    scroller.addEventListener('touchmove', (e) => {
      if (!pz || e.touches.length !== 2) return;
      e.preventDefault();
      const a = e.touches[0], b = e.touches[1];
      pz.k = PV.clamp(Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pz.d, 0.3, 4);
      const target = PV.clamp(pz.s * pz.k, 0.2, 6); pz.k = target / pz.s;
      pages.style.transformOrigin = pz.sl + pz.mx + 'px ' + (pz.st + pz.my) + 'px'; pages.style.transform = 'scale(' + pz.k + ')';
    }, { passive: false });
    const endPinch = () => {
      if (!pz) return;
      const p = pz; pz = null;
      pages.style.transform = ''; pages.style.transformOrigin = '';
      if (Math.abs(p.k - 1) < 0.02) return;
      S.mode = 'custom'; S.zoom = PV.clamp(p.s * p.k, 0.2, 6);
      const cx = p.sl + p.mx, cy = p.st + p.my;
      relayout();
      scroller.scrollLeft = cx * p.k - p.mx; scroller.scrollTop = cy * p.k - p.my;
      update();
    };
    scroller.addEventListener('touchend', (e) => { if (e.touches.length < 2) endPinch(); }); scroller.addEventListener('touchcancel', endPinch);

    /* ---- thumbnails / outline ---- */
    let thumbQ = Promise.resolve();
    function buildThumbs() {
      const io = new IntersectionObserver((en) => en.forEach((x) => {
        if (!x.isIntersecting) return; io.unobserve(x.target);
        const i = +x.target.dataset.i, gen = S.gen;
        thumbQ = thumbQ.then(async () => {
          if (gen !== S.gen || S.destroyed) return;
          try {
            const pg = await S.pdf.getPage(i), v0 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: 150 / v0.width }), c = x.target.querySelector('canvas');
            c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
            await pg.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp, background: '#fff' }).promise;
          } catch (e) { /* ignore */ }
        });
      }), { root: thumbs, rootMargin: '300px' });
      S.io = io;
      S.slots.forEach((sl) => {
        const t = h('button', { class: 'pd-th', type: 'button', 'data-i': sl.i, onclick: () => { goTo(sl.i); if (innerWidth < 900) side.classList.remove('open'); } }, h('canvas', { style: { aspectRatio: sl.pw + '/' + sl.ph } }), h('span', { text: String(sl.i) }));
        thumbs.appendChild(t); io.observe(t);
      });
      markThumb();
    }
    function markThumb() { const old = thumbs.querySelector('.cur'); if (old) old.classList.remove('cur'); const t = thumbs.children[S.cur - 1]; if (t) { t.classList.add('cur'); if (side.classList.contains('open') && !thumbs.classList.contains('pv-hidden')) { const r = t.getBoundingClientRect(), tr = thumbs.getBoundingClientRect(); if (r.top < tr.top || r.bottom > tr.bottom) thumbs.scrollTop += r.top - tr.top - tr.height / 3; } } }
    async function navDest(dest) {
      try {
        if (typeof dest === 'string') dest = await S.pdf.getDestination(dest);
        if (!Array.isArray(dest)) return;
        const ref = dest[0], idx = typeof ref === 'object' ? await S.pdf.getPageIndex(ref) : ref;
        const sl = S.slots[idx]; if (!sl) return;
        let off = 0;
        if (dest[1] && dest[1].name === 'XYZ' && dest[3] != null && S.rot === 0) off = Math.max(0, (sl.ph - dest[3]) * S.scale - 10);
        scroller.scrollTo({ top: sl.top + off - 6, behavior: 'smooth' });
      } catch (e) { /* ignore */ }
    }
    async function buildOutline() {
      let ol = null; try { ol = await S.pdf.getOutline(); } catch (e) { /* none */ }
      outline.innerHTML = '';
      if (!ol || !ol.length) { outline.appendChild(h('div', { class: 'au-nolyrics', html: PV.ic('list', 26) + '<p>No outline</p><small>This PDF has no bookmarks.</small>' })); return; }
      const walk = (items, depth) => items.forEach((it) => {
        const row = h('div', { class: 'pd-ol' }, h('button', { type: 'button', style: { paddingLeft: 10 + depth * 14 + 'px' }, text: it.title || 'Untitled', onclick: () => { if (it.dest) navDest(it.dest); else if (it.url && /^https?:/i.test(it.url)) window.open(it.url, '_blank', 'noopener'); if (innerWidth < 900) side.classList.remove('open'); } }));
        outline.appendChild(row);
        if (it.items && it.items.length) walk(it.items, depth + 1);
      });
      walk(ol, 0);
      const t = sideTabs.querySelector('[data-t="outline"]'); t.classList.add('dot');
    }

    /* ---- search ---- */
    function openSearch() { search.bar.open(); }
    function closeSearch() { search.bar.close(); S.q = ''; S.hits = []; S.hit = -1; S.slots.forEach(clearHits); }
    async function runSearch(q) {
      const my = ++S.tok; S.q = q; S.hits = []; S.hit = -1;
      S.slots.forEach(clearHits);
      if (!q) { search.bar.setCount(0, 0); return; }
      const needle = q.toLowerCase();
      for (let i = 1; i <= S.pdf.numPages; i++) {
        if (my !== S.tok) return;
        let strs = S.texts[i - 1];
        if (!strs) { try { const pg = await S.pdf.getPage(i); strs = (await pg.getTextContent()).items.map((it) => it.str); S.texts[i - 1] = strs; } catch (e) { strs = []; } }
        for (let j = 0; j < strs.length; j++) {
          const low = strs[j].toLowerCase(); let k = 0, at;
          while ((at = low.indexOf(needle, k)) >= 0) { S.hits.push({ page: i, item: j, at, len: needle.length }); k = at + needle.length; }
        }
        if (S.hit < 0 && S.hits.length) { S.hit = 0; focusHit(); }
        if (i % 6 === 0 || i === S.pdf.numPages) { search.bar.setCount(Math.max(S.hit, 0), S.hits.length); await PV.sleep(0); }
      }
      search.bar.setCount(Math.max(S.hit, 0), S.hits.length);
      S.slots.forEach(applyHits);
    }
    function clearHits(sl) {
      if (!sl.marked || !sl.divs) { sl.marked = null; return; }
      sl.marked.forEach((j) => { if (sl.divs[j]) sl.divs[j].textContent = sl.strs[j]; }); sl.marked = null;
    }
    function applyHits(sl) {
      clearHits(sl);
      if (!S.q || !sl.divs) return;
      const mine = S.hits.map((x, idx) => [x, idx]).filter(([x]) => x.page === sl.i);
      if (!mine.length) return;
      const by = {}; mine.forEach(([x, idx]) => { (by[x.item] = by[x.item] || []).push([x, idx]); });
      sl.marked = new Set();
      for (const j in by) {
        const d = sl.divs[j], s = sl.strs[j]; if (!d || d.textContent !== s) continue;
        let html = '', p = 0;
        by[j].forEach(([x, idx]) => { html += esc(s.slice(p, x.at)) + '<mark class="pd-hit' + (idx === S.hit ? ' cur' : '') + '">' + esc(s.slice(x.at, x.at + x.len)) + '</mark>'; p = x.at + x.len; });
        d.innerHTML = html + esc(s.slice(p)); sl.marked.add(+j);
      }
    }
    function stepHit(d) {
      if (!S.hits.length) return;
      S.hit = (S.hit + d + S.hits.length) % S.hits.length;
      S.slots.forEach((sl) => { if (sl.marked) applyHits(sl); });
      search.bar.setCount(S.hit, S.hits.length); focusHit();
    }
    function focusHit() {
      const x = S.hits[S.hit]; if (!x) return;
      const sl = S.slots[x.page - 1];
      S.slots.forEach((s2) => { if (s2.marked) applyHits(s2); });
      const go = () => { const m = sl.el.querySelector('.pd-hit.cur'); if (m) m.scrollIntoView({ block: 'center', inline: 'nearest' }); };
      if (sl.rendered) { applyHits(sl); go(); } else { goTo(x.page, true); let tries = 0; const iv = setInterval(() => { if (sl.rendered && sl.divs) { clearInterval(iv); applyHits(sl); go(); } else if (++tries > 40) clearInterval(iv); }, 100); }
    }

    /* ---- keys ---- */
    PV.setKeys((e, typing) => {
      const k = e.key, mod = e.ctrlKey || e.metaKey;
      if (k === 'Escape') { if (search.bar.isOpen()) closeSearch(); return; }
      if (typing) return;
      if (mod && k.toLowerCase() === 'f') { e.preventDefault(); openSearch(); }
      else if (mod && k.toLowerCase() === 'g') { e.preventDefault(); pageIn.focus(); }
      else if (k === '/' && !mod) { e.preventDefault(); openSearch(); }
      else if (k === '+' || k === '=') zoomStep(1.25); else if (k === '-') zoomStep(1 / 1.25); else if (k === '0') setMode('width');
      else if (k === 'r') { S.rot = (S.rot + 90) % 360; relayout(true); }
      else if (k === 'd') { S.night = !S.night; PV.pref.set('p.night', S.night); applyNight(); }
      else if (k === 'ArrowRight' && scroller.scrollWidth <= scroller.clientWidth + 2) { e.preventDefault(); goTo(S.cur + 1); }
      else if (k === 'ArrowLeft' && scroller.scrollWidth <= scroller.clientWidth + 2) { e.preventDefault(); goTo(S.cur - 1); }
      else if (k === 'Home') { e.preventDefault(); goTo(1); } else if (k === 'End') { e.preventDefault(); goTo(S.slots.length); }
      else if (k === 'F3') { e.preventDefault(); stepHit(e.shiftKey ? -1 : 1); }
      else if (k === 'f') PV.toggleFull(root);
    });
    const fail = (e) => { console.error(e); if (e && e.name === 'PasswordException') return; PV.message(root, 'Could not open this PDF', (e && e.message) || String(e), true); };
    PV.onDispose(() => { S.destroyed = true; ro.disconnect(); persist(); S.slots.forEach((sl) => { if (sl.task) try { sl.task.cancel(); } catch (e) { /* ignore */ } }); if (S.io) S.io.disconnect(); const quiet = (p) => { try { Promise.resolve(p).catch(() => {}); } catch (e) { /* ignore */ } }; quiet(S.pdf ? S.pdf.destroy() : task && task.destroy()); if (PV.isFull()) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) { /* ignore */ } } });
    try { await openDoc(); } catch (e) { fail(e); }
  }

  PV.pdf = { render };
})();
