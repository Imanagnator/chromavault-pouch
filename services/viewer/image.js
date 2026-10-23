/* Pouch viewer runtime — image viewer (zoom/pan/pinch, gallery, slideshow, EXIF) */
(function () {
  'use strict';
  const PV = window.PV, h = PV.h, esc = PV.esc;

  /* ---------- EXIF ---------- */
  function parseTiff(dv, base) {
    const little = dv.getUint16(base) === 0x4949;
    const g16 = (o) => dv.getUint16(o, little), g32 = (o) => dv.getUint32(o, little);
    const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
    function val(type, cnt, o) {
      if (type === 2) { let s = ''; for (let i = 0; i < cnt - 1; i++) s += String.fromCharCode(dv.getUint8(o + i)); return s.trim(); }
      const out = [];
      for (let i = 0; i < Math.min(cnt, 4); i++) {
        if (type === 3) out.push(g16(o + i * 2)); else if (type === 4) out.push(g32(o + i * 4));
        else if (type === 5) out.push(g32(o + i * 8) / (g32(o + i * 8 + 4) || 1)); else out.push(dv.getUint8(o + i));
      }
      return cnt === 1 ? out[0] : out;
    }
    function ifd(off) {
      const out = {}, n = g16(base + off);
      for (let i = 0; i < n; i++) {
        const e = base + off + 2 + i * 12, tag = g16(e), type = g16(e + 2), cnt = g32(e + 4);
        let vo = e + 8; if ((SZ[type] || 1) * cnt > 4) vo = base + g32(e + 8);
        try { out[tag] = val(type, cnt, vo); } catch (er) { /* skip */ }
      }
      return out;
    }
    const a = ifd(g32(base + 4)), r = {};
    const fmtExp = (v) => (v >= 1 ? v + ' s' : '1/' + Math.round(1 / v) + ' s');
    if (a[0x010f] || a[0x0110]) r.Camera = [a[0x010f], a[0x0110]].filter(Boolean).join(' ').replace(/(\b\w+\b) \1/i, '$1');
    if (a[0x0132]) r.Taken = String(a[0x0132]).replace(/^(\d{4}):(\d\d):(\d\d)/, '$1-$2-$3');
    if (a[0x0112]) r.Orientation = a[0x0112];
    if (a[0x8769]) {
      const x = ifd(a[0x8769]);
      if (x[0x9003]) r.Taken = String(x[0x9003]).replace(/^(\d{4}):(\d\d):(\d\d)/, '$1-$2-$3');
      if (x[0xa434]) r.Lens = x[0xa434];
      if (x[0x829a]) r.Exposure = fmtExp(x[0x829a]);
      if (x[0x829d]) r.Aperture = 'f/' + (+x[0x829d]).toFixed(1).replace(/\.0$/, '');
      if (x[0x8827]) r.ISO = 'ISO ' + (Array.isArray(x[0x8827]) ? x[0x8827][0] : x[0x8827]);
      if (x[0x920a]) r['Focal length'] = Math.round(x[0x920a]) + ' mm';
    }
    if (a[0x8825]) {
      const g = ifd(a[0x8825]);
      const dms = (v) => (Array.isArray(v) && v.length === 3 ? v[0] + v[1] / 60 + v[2] / 3600 : null);
      const la = dms(g[2]), lo = dms(g[4]);
      if (la != null && lo != null) r.GPS = (g[1] === 'S' ? -la : la).toFixed(5) + ', ' + (g[3] === 'W' ? -lo : lo).toFixed(5);
    }
    return r;
  }
  async function readExif(blob) {
    try {
      const dv = new DataView(await blob.slice(0, 262144).arrayBuffer());
      if (dv.getUint16(0) !== 0xffd8) return null;
      let off = 2;
      while (off < dv.byteLength - 4) {
        const m = dv.getUint16(off);
        if ((m & 0xff00) !== 0xff00 || m === 0xffda) break;
        const len = dv.getUint16(off + 2);
        if (m === 0xffe1 && dv.getUint32(off + 4) === 0x45786966) return parseTiff(dv, off + 10);
        off += 2 + len;
      }
    } catch (e) { /* none */ }
    return null;
  }
  PV.exif = { readExif };

  /* ---------- thumbnails ---------- */
  const thumbCache = new Map();
  let thumbQ = Promise.resolve();
  function thumbFor(f) {
    if (thumbCache.has(f.id)) return thumbCache.get(f.id);
    const p = (thumbQ = thumbQ.then(async () => {
      try {
        const blob = await PV.blobOf(f);
        if (blob.size > 25e6) return null;
        let bmp;
        try { bmp = await createImageBitmap(blob, { resizeWidth: 160, resizeQuality: 'low' }); } catch (e) { bmp = null; }
        if (!bmp) return URL.createObjectURL(blob);
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0); bmp.close && bmp.close();
        return await new Promise((res) => c.toBlob((b) => res(b ? URL.createObjectURL(b) : null), 'image/webp', 0.7));
      } catch (e) { return null; }
    }));
    thumbCache.set(f.id, p);
    return p;
  }

  /* ---------- viewer ---------- */
  async function render(ctx) {
    const { root } = ctx;
    const imgs = PV.files().filter((f) => PV.kindOf(f) === 'image');
    let idx = Math.max(0, imgs.findIndex((f) => f.id === ctx.meta.id));
    if (!imgs.length) imgs.push(ctx.meta);
    const S = { s: 1, x: 0, y: 0, rot: 0, fx: 1, fy: 1, fit: 1, nw: 0, nh: 0, bg: PV.pref.get('i.bg', 'dark'), ui: true, slide: 0, slideSec: PV.pref.get('i.sec', 4), blob: ctx.blob, meta: ctx.meta, tok: 0, fitMode: true, film: PV.pref.get('i.film', innerWidth > 800) };
    root.classList.add('im-root');
    const img = h('img', { class: 'im-img', alt: ctx.meta.name, draggable: 'false' });
    const stage = h('div', { class: 'im-stage' }, img);
    const spin = h('div', { class: 'vd-spin pv-hidden' }, h('i'));
    const title = h('div', { class: 'im-title' });
    const count = h('span', { class: 'im-count' });
    const zoomLbl = h('button', { class: 'im-zoom', type: 'button', title: 'Reset to fit', text: '100%', onclick: () => fitView(true) });
    const mk = (icon, label, fn, cls) => PV.btn(icon, label, fn, 'im-b ' + (cls || ''), 20);
    const slideBtn = mk('slides', 'Slideshow (Space)', () => toggleSlide());
    const infoBtn = mk('info', 'Details (I)', () => toggleInfo());
    const filmBtn = mk('grid', 'Thumbnails (G)', () => { S.film = !S.film; PV.pref.set('i.film', S.film); applyFilm(); });
    const bgBtn = mk('sun', 'Background', (e) => PV.menu(e.currentTarget, [{ header: 'Background' }, ...[['dark', 'Dark'], ['black', 'Black'], ['light', 'Light'], ['checker', 'Transparency grid']].map(([id, l]) => ({ label: l, active: S.bg === id, onClick: () => { S.bg = id; PV.pref.set('i.bg', id); applyBg(); } }))]));
    const fullBtn = mk('full', 'Fullscreen (F)', () => PV.toggleFull(root));
    const top = h('div', { class: 'im-top im-ui' }, h('div', { class: 'im-tt' }, title, count), h('span', { class: 'pv-grow' }), slideBtn, filmBtn, infoBtn, bgBtn, mk('copy', 'Copy image', () => copyImg(), 'im-hide-sm'), fullBtn);
    const prev = mk('left', 'Previous (←)', () => go(-1), 'im-nav l im-ui'), next = mk('right', 'Next (→)', () => go(1), 'im-nav r im-ui');
    const tools = h('div', { class: 'im-tools im-ui' },
      mk('zoomOut', 'Zoom out (−)', () => zoomBy(1 / 1.35)), zoomLbl, mk('zoomIn', 'Zoom in (+)', () => zoomBy(1.35)),
      h('span', { class: 'im-sep' }), mk('fit', 'Fit to screen (0)', () => fitView(true)), h('button', { class: 'im-b im-one', type: 'button', title: 'Actual size (1)', text: '1:1', onclick: () => actual() }),
      h('span', { class: 'im-sep' }), mk('rotCcw', 'Rotate left (Shift+R)', () => rotate(-90)), mk('rotCw', 'Rotate right (R)', () => rotate(90)), mk('flipH', 'Flip horizontally (H)', () => flip('x')), mk('flipV', 'Flip vertically (V)', () => flip('y')));
    const film = h('div', { class: 'im-film im-ui pv-scroll' });
    const infoPanel = h('aside', { class: 'im-info im-ui pv-hidden' });
    const bottom = h('div', { class: 'im-bottom' }, film, tools);
    stage.append(spin, top, prev, next, bottom, infoPanel);
    root.appendChild(stage);
    if (imgs.length < 2) { prev.classList.add('pv-hidden'); next.classList.add('pv-hidden'); filmBtn.classList.add('pv-hidden'); slideBtn.classList.add('pv-hidden'); }

    const W = () => stage.clientWidth, H = () => stage.clientHeight;
    const dims = () => (S.rot % 180 === 0 ? [S.nw, S.nh] : [S.nh, S.nw]);
    function maxScale() { return Math.max(40, S.fit * 8); }
    function clampPan() {
      const [ew, eh] = dims(), sw = ew * S.s, sh = eh * S.s;
      const mx = Math.max(0, (sw - W()) / 2), my = Math.max(0, (sh - H()) / 2);
      S.x = PV.clamp(S.x, -mx, mx); S.y = PV.clamp(S.y, -my, my);
    }
    function apply(anim) {
      if (!S.nw) return;
      img.style.transition = anim ? 'transform .22s cubic-bezier(.2,.8,.2,1)' : 'none';
      img.style.transform = 'translate(-50%,-50%) translate(' + S.x + 'px,' + S.y + 'px) rotate(' + S.rot + 'deg) scale(' + S.fx * S.s + ',' + S.fy * S.s + ')';
      img.style.imageRendering = S.s > 3 ? 'pixelated' : '';
      zoomLbl.textContent = Math.round(S.s * 100) + '%';
      stage.classList.toggle('zoomed', S.s > S.fit * 1.02);
    }
    function computeFit() {
      const [ew, eh] = dims();
      const cap = /svg/i.test(S.meta.type || '') || PV.extOf(S.meta.name) === 'svg' ? 8 : 2;
      S.fit = Math.min(W() / ew, H() / eh, cap) || 1;
      if (W() < 40 || H() < 40) S.fit = 1;
    }
    function fitView(anim) { computeFit(); S.s = S.fit; S.x = 0; S.y = 0; S.fitMode = true; apply(anim); }
    function actual() { computeFit(); S.s = 1; S.fitMode = false; clampPan(); apply(true); }
    function zoomAt(cx, cy, f, anim) {
      const r = stage.getBoundingClientRect(), px = cx - (r.left + r.width / 2), py = cy - (r.top + r.height / 2);
      const ns = PV.clamp(S.s * f, S.fit * 0.25, maxScale()), k = ns / S.s;
      S.x = px - (px - S.x) * k; S.y = py - (py - S.y) * k; S.s = ns; S.fitMode = false;
      clampPan(); apply(anim);
    }
    function zoomBy(f) { const r = stage.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, f, true); }
    function rotate(d) { S.rot = (S.rot + d + 360) % 360; fitView(true); }
    function flip(a) { if (a === 'x') S.fx *= -1; else S.fy *= -1; apply(true); }

    /* ---- gestures ---- */
    const ptrs = new Map();
    let drag = null, pinch = null, lastTap = { t: 0, x: 0, y: 0 }, tapTimer = 0;
    const mid = () => { const a = [...ptrs.values()]; return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) }; };
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.im-ui')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { stage.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
      if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, ox: S.x, oy: S.y, t: Date.now(), moved: 0, type: e.pointerType };
      else if (ptrs.size === 2) { const m = mid(); pinch = { d: m.d, s: S.s, x0: S.x, y0: S.y, mx: m.x, my: m.y }; drag = null; }
      img.style.transition = 'none';
    });
    stage.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && ptrs.size >= 2) {
        const m = mid(), r = stage.getBoundingClientRect();
        const ns = PV.clamp(pinch.s * (m.d / pinch.d), S.fit * 0.25, maxScale()), k = ns / pinch.s;
        const px = pinch.mx - (r.left + r.width / 2), py = pinch.my - (r.top + r.height / 2);
        S.x = px - (px - pinch.x0) * k + (m.x - pinch.mx); S.y = py - (py - pinch.y0) * k + (m.y - pinch.my);
        S.s = ns; S.fitMode = false; clampPan(); apply(false); return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
      const zoomed = S.s > S.fit * 1.02;
      if (zoomed) { S.x = drag.ox + dx; S.y = drag.oy + dy; clampPan(); }
      else if (drag.type !== 'mouse' && imgs.length > 1) { S.x = dx; S.y = dy * 0.15; }
      else if (drag.type === 'mouse') return;
      apply(false);
    });
    const up = (e) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (pinch) { if (ptrs.size < 2) { pinch = null; if (S.s < S.fit) fitView(true); } drag = null; if (ptrs.size === 1) { const p = [...ptrs.values()][0]; drag = { x: p.x, y: p.y, ox: S.x, oy: S.y, t: Date.now(), moved: 99, type: 'touch' }; } return; }
      if (!drag) return;
      const d = drag; drag = null;
      const dx = e.clientX - d.x, zoomed = S.s > S.fit * 1.02;
      if (!zoomed && d.type !== 'mouse' && imgs.length > 1 && Math.abs(dx) > Math.min(90, W() * 0.18) && d.moved > 20) { go(dx < 0 ? 1 : -1, dx < 0 ? 'l' : 'r'); return; }
      if (d.moved < 8 && Date.now() - d.t < 350) {
        const now = Date.now();
        if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
          clearTimeout(tapTimer); lastTap.t = 0;
          if (S.s > S.fit * 1.1) fitView(true); else zoomAt(e.clientX, e.clientY, Math.max(2.5, 1 / S.fit * 1.0 > 1.2 ? 1 / S.fit : 2.5), true);
        } else {
          lastTap = { t: now, x: e.clientX, y: e.clientY };
          tapTimer = setTimeout(() => { setUi(!S.ui); }, d.type === 'mouse' ? 0 : 260);
        }
      } else if (!zoomed) { S.x = 0; S.y = 0; apply(true); }
    };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', (e) => {
      if (e.target.closest('.im-ui') && !e.target.closest('.im-film')) return;
      e.preventDefault();
      if (e.target.closest('.im-film')) { return; }
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016)), false);
    }, { passive: false });
    stage.addEventListener('dblclick', (e) => { if (e.target.closest('.im-ui')) return; });

    function setUi(on) { S.ui = on; stage.classList.toggle('ui-off', !on); }
    function applyBg() { stage.dataset.bg = S.bg; PV.setIcon(bgBtn, S.bg === 'light' ? 'sun' : 'moon', 20); }
    function applyFilm() { film.classList.toggle('pv-hidden', !S.film || imgs.length < 2); filmBtn.classList.toggle('on', S.film && imgs.length > 1); if (S.film) setTimeout(() => { const c = film.querySelector('.cur'); c && c.scrollIntoView({ inline: 'center', block: 'nearest' }); resizeFit(); }, 30); else setTimeout(resizeFit, 30); }

    /* ---- loading ---- */
    function setSrc(blob) {
      return new Promise((resolve) => {
        if (S.url) URL.revokeObjectURL(S.url);
        S.url = URL.createObjectURL(blob);
        img.onload = () => { S.nw = img.naturalWidth || 300; S.nh = img.naturalHeight || 300; img.style.width = S.nw + 'px'; img.style.height = S.nh + 'px'; resolve(true); };
        img.onerror = () => resolve(false);
        img.src = S.url;
      });
    }
    async function show(i, blob, dir) {
      const my = ++S.tok, f = imgs[i];
      idx = i; S.meta = f;
      spin.classList.remove('pv-hidden');
      try {
        blob = blob || (await PV.blobOf(f));
        if (my !== S.tok) return;
        S.blob = blob;
        stage.querySelectorAll('.im-err').forEach((n) => n.remove());
        img.style.opacity = '0';
        const ok = await setSrc(blob);
        if (my !== S.tok) return;
        if (!ok) throw new Error('This browser cannot display this image format.');
        S.rot = 0; S.fx = 1; S.fy = 1;
        fitView(false);
        img.style.opacity = '1';
        if (dir) { img.style.transition = 'none'; const sx = dir === 'l' ? W() * 0.35 : -W() * 0.35; img.style.transform = 'translate(-50%,-50%) translate(' + sx + 'px,0) scale(' + S.s + ')'; requestAnimationFrame(() => requestAnimationFrame(() => { img.style.opacity = '1'; apply(true); })); }
      } catch (e) {
        if (my !== S.tok) return;
        img.style.opacity = '0'; S.nw = 0;
        stage.appendChild(h('div', { class: 'im-err vd-error' }, h('div', { class: 'pv-msg-ic', html: PV.ic('file', 30) }), h('b', { text: 'Can’t display this image' }), h('p', { text: e.message || 'Unknown error' }),
          h('button', { class: 'pv-cta', type: 'button', html: PV.ic('download', 16) + ' Download', onclick: () => { const b = document.getElementById('download-file-btn'); b && b.click(); } })));
      } finally { if (my === S.tok) spin.classList.add('pv-hidden'); }
      title.textContent = f.name; count.textContent = imgs.length > 1 ? (i + 1) + ' / ' + imgs.length : '';
      PV.setCurrent(f, S.blob);
      film.querySelectorAll('.im-th').forEach((t, k) => t.classList.toggle('cur', k === i));
      const c = film.querySelector('.cur'); if (c && S.film) c.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      if (!infoPanel.classList.contains('pv-hidden')) fillInfo();
      [imgs[i + 1], imgs[i - 1]].forEach((n) => n && PV.prefetch(n));
    }
    function go(d, dir) {
      if (imgs.length < 2) return;
      const i = (idx + d + imgs.length) % imgs.length;
      show(i, null, dir || (d > 0 ? 'l' : 'r'));
    }

    /* ---- filmstrip ---- */
    const io = new IntersectionObserver((en) => en.forEach((x) => {
      if (!x.isIntersecting) return; io.unobserve(x.target);
      const f = imgs[+x.target.dataset.i];
      thumbFor(f).then((u) => { if (u) x.target.style.backgroundImage = 'url("' + u + '")'; });
    }), { root: film, rootMargin: '200px' });
    imgs.forEach((f, i) => { const t = h('button', { class: 'im-th', type: 'button', title: f.name, 'data-i': i, onclick: () => show(i, null, i > idx ? 'l' : 'r') }); film.appendChild(t); io.observe(t); });

    /* ---- info ---- */
    async function fillInfo() {
      const f = S.meta, b = S.blob;
      const rows = [['Name', f.name], ['Type', f.type || PV.extOf(f.name).toUpperCase()], ['Size', PV.fmtSize(b ? b.size : f.size)], ['Dimensions', S.nw ? S.nw + ' × ' + S.nh + ' px' : '—']];
      if (S.nw) { rows.push(['Aspect', (S.nw / S.nh).toFixed(2) + ' : 1'], ['Megapixels', (S.nw * S.nh / 1e6).toFixed(1) + ' MP']); }
      infoPanel.innerHTML = '';
      infoPanel.append(h('div', { class: 'im-info-h' }, h('b', { text: 'Details' }), PV.btn('close', 'Close', () => toggleInfo(false), 'pv-btn-sm')),
        h('dl', {}, rows.map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])));
      const ex = b ? await readExif(b) : null;
      if (ex && S.meta === f) {
        infoPanel.appendChild(h('div', { class: 'im-info-h2', text: 'Camera data' }));
        const ks = Object.keys(ex).filter((k) => k !== 'Orientation');
        infoPanel.appendChild(h('dl', {}, ks.map((k) => [h('dt', { text: k }), h('dd', { text: String(ex[k]) })])));
      }
    }
    function toggleInfo(on) { const show2 = on == null ? infoPanel.classList.contains('pv-hidden') : on; infoPanel.classList.toggle('pv-hidden', !show2); infoBtn.classList.toggle('on', show2); if (show2) fillInfo(); setTimeout(resizeFit, 30); }

    /* ---- slideshow ---- */
    let slideT = 0;
    function toggleSlide(on) {
      const run = on == null ? !S.slide : on; S.slide = run;
      clearInterval(slideT); slideBtn.classList.toggle('on', run);
      PV.setIcon(slideBtn, run ? 'pause' : 'slides', 20);
      if (run) { slideT = setInterval(() => go(1, 'l'), S.slideSec * 1000); PV.toast('Slideshow · every ' + S.slideSec + ' s · long-press the button to change', 2200); }
    }
    let lp = 0;
    slideBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); slideMenu(); });
    slideBtn.addEventListener('pointerdown', () => { lp = setTimeout(slideMenu, 550); }); ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => slideBtn.addEventListener(ev, () => clearTimeout(lp)));
    function slideMenu() { PV.menu(slideBtn, [{ header: 'Slideshow interval' }, ...[2, 3, 4, 6, 10].map((n) => ({ label: n + ' seconds', active: S.slideSec === n, onClick: () => { S.slideSec = n; PV.pref.set('i.sec', n); if (S.slide) toggleSlide(true); } }))]); }

    /* ---- misc ---- */
    async function copyImg() {
      try {
        const c = document.createElement('canvas'); c.width = S.nw; c.height = S.nh; c.getContext('2d').drawImage(img, 0, 0);
        const b = await new Promise((r) => c.toBlob(r, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); PV.toast('Image copied');
      } catch (e) { PV.toast('Copy isn’t supported for this image here'); }
    }
    function resizeFit() { if (!S.nw) return; if (S.fitMode) fitView(false); else { clampPan(); apply(false); } }
    const ro = new ResizeObserver(() => resizeFit()); ro.observe(stage);

    PV.setKeys((e) => {
      const k = e.key;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === 'ArrowRight') { e.preventDefault(); S.s > S.fit * 1.02 ? (S.x -= 60, clampPan(), apply(false)) : go(1); }
      else if (k === 'ArrowLeft') { e.preventDefault(); S.s > S.fit * 1.02 ? (S.x += 60, clampPan(), apply(false)) : go(-1); }
      else if (k === 'ArrowUp' && S.s > S.fit * 1.02) { e.preventDefault(); S.y += 60; clampPan(); apply(false); }
      else if (k === 'ArrowDown' && S.s > S.fit * 1.02) { e.preventDefault(); S.y -= 60; clampPan(); apply(false); }
      else if (k === '+' || k === '=') zoomBy(1.35); else if (k === '-' || k === '_') zoomBy(1 / 1.35);
      else if (k === '0') fitView(true); else if (k === '1') actual();
      else if (k === 'r') rotate(90); else if (k === 'R') rotate(-90);
      else if (k === 'h') flip('x'); else if (k === 'v') flip('y');
      else if (k === 'f') PV.toggleFull(root); else if (k === 'i') toggleInfo(); else if (k === 'g') filmBtn.click();
      else if (k === ' ') { e.preventDefault(); if (imgs.length > 1) toggleSlide(); }
      else if (k === 'Home') show(0); else if (k === 'End') show(imgs.length - 1);
    });
    PV.onDispose(() => { clearInterval(slideT); clearTimeout(tapTimer); io.disconnect(); ro.disconnect(); if (S.url) URL.revokeObjectURL(S.url); if (PV.isFull()) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) { /* ignore */ } } });

    applyBg(); applyFilm();
    await show(idx, ctx.blob);
    resizeFit();
  }

  PV.image = { render };
})();
