/* Pouch viewer runtime — core: helpers, icons, file typing, decoding, menus, search */
(function () {
  'use strict';
  const PV = (window.PV = window.PV || {});

  /* ---------- tiny utils ---------- */
  PV.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  PV.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  PV.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  PV.fmtTime = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
  };
  PV.fmtSize = (n) => {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  };
  PV.baseName = (n) => n.replace(/\.[^./\\]+$/, '');
  PV.extOf = (n) => { const m = /\.([^./\\]+)$/.exec(n || ''); return m ? m[1].toLowerCase() : ''; };

  PV.h = function (tag, props) {
    const el = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') { for (const sk in v) { if (sk.slice(0, 2) === '--') el.style.setProperty(sk, v[sk]); else el.style[sk] = v[sk]; } }
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'muted') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    };
    for (let i = 2; i < arguments.length; i++) add(arguments[i]);
    return el;
  };
  const h = PV.h;

  /* ---------- icons ---------- */
  const T = (x, y, t) => `<text x="${x}" y="${y}" font-size="8" text-anchor="middle" fill="currentColor" stroke="none" font-weight="700" font-family="sans-serif">${t}</text>`;
  const SPK = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>';
  PV.icons = {
    play: '<polygon points="7 4 20 12 7 20 7 4" fill="currentColor"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>',
    prev: '<polygon points="19 20 9 12 19 4 19 20" fill="currentColor"/><line x1="5" y1="19" x2="5" y2="5"/>',
    next: '<polygon points="5 4 15 12 5 20 5 4" fill="currentColor"/><line x1="19" y1="5" x2="19" y2="19"/>',
    back10: '<path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 9 8 9"/>' + T(12, 15.5, '10'),
    fwd10: '<path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 4 21 9 16 9"/>' + T(12, 15.5, '10'),
    vol: SPK + '<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
    volLow: SPK + '<path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
    mute: SPK + '<line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/>',
    shuffle: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>',
    repeat: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    repeat1: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>' + T(12, 14.5, '1'),
    list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.2" y1="19.8" x2="5.6" y2="18.4"/><line x1="18.4" y1="5.6" x2="19.8" y2="4.2"/>',
    eq: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    full: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
    exitFull: '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>',
    pip: '<rect x="2" y="4" width="20" height="16" rx="2"/><rect x="12" y="11" width="8" height="6" rx="1" fill="currentColor"/>',
    rotCw: '<polyline points="23 4 23 10 17 10"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/>',
    rotCcw: '<polyline points="1 4 1 10 7 10"/><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10"/>',
    flipH: '<path d="M12 3v18"/><path d="M8 7 3 12l5 5V7z"/><path d="M16 7l5 5-5 5V7z"/>',
    flipV: '<path d="M3 12h18"/><path d="M7 8 12 3l5 5H7z"/><path d="M7 16l5 5 5-5H7z"/>',
    zoomIn: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>',
    zoomOut: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>',
    fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    up: '<polyline points="18 15 12 9 6 15"/>',
    down: '<polyline points="6 9 12 15 18 9"/>',
    left: '<polyline points="15 18 9 12 15 6"/>',
    right: '<polyline points="9 18 15 12 9 6"/>',
    close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    wrap: '<line x1="3" y1="6" x2="21" y2="6"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><polyline points="16 16 14 18 16 20"/><line x1="3" y1="18" x2="10" y2="18"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    cc: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M10 10a2 2 0 1 0 0 4M17 10a2 2 0 1 0 0 4"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    hash: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
    type: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
    code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    speed: '<path d="M12 14l4-4"/><path d="M3.3 17a10 10 0 1 1 17.4 0"/>',
    table: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/>',
    panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>',
    more: '<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
    lyrics: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="13" y2="13"/>',
    bright: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>',
    ratio: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10v4M17 10v4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    expand: '<polyline points="7 10 12 15 17 10"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    case: '<path d="M3 17 8 5l5 12M4.8 13h6.4"/><path d="M15 17v-5a2.5 2.5 0 0 1 5 0v5M15 14h5"/>',
    regex: '<line x1="12" y1="4" x2="12" y2="14"/><line x1="7.7" y1="6.5" x2="16.3" y2="11.5"/><line x1="7.7" y1="11.5" x2="16.3" y2="6.5"/><circle cx="6" cy="19" r="1.2" fill="currentColor"/>',
    slides: '<rect x="2" y="3" width="20" height="14" rx="2"/><polygon points="10 7 15 10 10 13 10 7" fill="currentColor"/><line x1="8" y1="21" x2="16" y2="21"/>',
    sidebar: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>',
  };
  PV.ic = (name, size) => `<svg class="pv-ic" width="${size || 18}" height="${size || 18}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PV.icons[name] || ''}</svg>`;
  PV.btn = (icon, title, onclick, cls, size) => h('button', { class: 'pv-btn ' + (cls || ''), title, 'aria-label': title, type: 'button', onclick, html: PV.ic(icon, size) });
  PV.setIcon = (btn, icon, size) => { btn.innerHTML = PV.ic(icon, size); };

  /* ---------- storage (safe) ---------- */
  const spine = () => { try { return typeof pouchSpine !== 'undefined' ? pouchSpine : null; } catch (e) { return null; } };
  const pk = () => 'pv:' + ((spine() && spine().name) || 'x') + ':';
  PV.store = {
    get(k, d) { try { const v = localStorage.getItem(pk() + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(pk() + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  PV.pref = {
    get(k, d) { try { const v = localStorage.getItem('pv:pref:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('pv:pref:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  /* ---------- toast ---------- */
  let toastEl, toastT;
  PV.toast = (msg, ms) => {
    if (!toastEl) { toastEl = h('div', { class: 'pv-toast', role: 'status' }); document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), ms || 1800);
  };

  /* ---------- range slider ---------- */
  PV.setRange = (el, v) => {
    el.value = v;
    const min = +el.min || 0, max = +el.max || 100;
    el.style.setProperty('--p', (max === min ? 0 : ((v - min) / (max - min)) * 100) + '%');
  };
  PV.range = (o) => {
    const el = h('input', { type: 'range', class: 'pv-range ' + (o.cls || ''), min: o.min, max: o.max, step: o.step || 'any', 'aria-label': o.label || 'slider' });
    PV.setRange(el, o.value == null ? o.min : o.value);
    if (o.onInput) el.addEventListener('input', () => { PV.setRange(el, +el.value); o.onInput(+el.value); });
    if (o.onChange) el.addEventListener('change', () => o.onChange(+el.value));
    return el;
  };

  /* ---------- popover menu ---------- */
  let openMenu = null;
  PV.closeMenu = () => { if (openMenu) { openMenu.close(); openMenu = null; } };
  PV.menu = (anchor, items, opts) => {
    opts = opts || {};
    PV.closeMenu();
    const box = h('div', { class: 'pv-menu', role: 'menu' });
    if (opts.title) box.appendChild(h('div', { class: 'pv-menu-title', text: opts.title }));
    items.forEach((it) => {
      if (it === '-') { box.appendChild(h('div', { class: 'pv-menu-sep' })); return; }
      if (it.header) { box.appendChild(h('div', { class: 'pv-menu-title', text: it.header })); return; }
      const row = h('button', {
        class: 'pv-menu-item' + (it.active ? ' active' : ''), type: 'button', role: 'menuitem',
        onclick: (e) => { e.stopPropagation(); if (!it.keepOpen) PV.closeMenu(); it.onClick && it.onClick(row); },
      },
      it.icon ? h('span', { class: 'pv-menu-ic', html: PV.ic(it.icon, 16) }) : null,
      h('span', { class: 'pv-menu-label', text: it.label }),
      it.sub ? h('span', { class: 'pv-menu-sub', text: it.sub }) : null,
      it.active ? h('span', { class: 'pv-menu-check', html: PV.ic('check', 14) }) : null);
      box.appendChild(row);
    });
    document.body.appendChild(box);
    const place = () => {
      const r = anchor.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight, vw = innerWidth, vh = innerHeight;
      let left = PV.clamp(r.left + r.width / 2 - bw / 2, 8, vw - bw - 8);
      let top = r.top - bh - 8;
      if (top < 8) top = Math.min(r.bottom + 8, vh - bh - 8);
      box.style.left = left + 'px';
      box.style.top = Math.max(8, top) + 'px';
      box.style.maxHeight = vh - 16 + 'px';
    };
    place();
    requestAnimationFrame(() => box.classList.add('in'));
    const onDown = (e) => { if (!box.contains(e.target) && !anchor.contains(e.target)) PV.closeMenu(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); PV.closeMenu(); } };
    setTimeout(() => { document.addEventListener('pointerdown', onDown, true); }, 0);
    document.addEventListener('keydown', onKey, true);
    openMenu = { close() { box.remove(); document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true); } };
    return box;
  };

  /* ---------- fullscreen ---------- */
  PV.isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  PV.toggleFull = (el) => {
    try {
      if (PV.isFull()) return (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    } catch (e) { /* ignore */ }
  };

  /* ---------- keyboard routing ---------- */
  PV.keyFn = null;
  PV.setKeys = (fn) => { PV.keyFn = fn; };
  window.addEventListener('keydown', (e) => {
    const t = e.target, tag = t && t.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
    if (typing && e.key !== 'Escape') return;
    if (PV.keyFn) PV.keyFn(e, typing);
  });

  /* ---------- lifecycle ---------- */
  const disposers = [];
  PV.onDispose = (fn) => { disposers.push(fn); };
  PV.dispose = () => {
    PV.closeMenu();
    while (disposers.length) { try { disposers.pop()(); } catch (e) { console.warn(e); } }
    PV.keyFn = null;
    if (PV.clearSearch) PV.clearSearch();
  };

  /* ---------- file typing ---------- */
  const X = (s) => new Set(s.split(' '));
  const EXT = {
    audio: X('mp3 wav ogg oga m4a aac flac opus weba mka wma'),
    video: X('mp4 m4v webm mkv mov ogv avi 3gp 3g2'),
    image: X('png jpg jpeg jpe jfif gif webp avif bmp ico svg apng cur'),
    pdf: X('pdf'),
    md: X('md markdown mdown mkd mdx'),
    html: X('html htm xhtml'),
    csv: X('csv tsv'),
    json: X('json jsonc json5 geojson webmanifest'),
    notebook: X('ipynb'),
    text: X('txt text nfo rtf'),
    code: X('js mjs cjs jsx ts tsx py pyw rb php java kt kts scala c h cc cpp cxx hpp hh cs go rs swift m mm dart lua r pl pm sh bash zsh fish bat cmd ps1 psm1 sql css scss sass less xml xsl xslt plist yaml yml toml ini cfg conf env properties gradle cmake mk dockerfile gitignore gitattributes editorconfig diff patch vue svelte astro graphql gql proto tex bib srt vtt ass ssa lrc vb vba asm s clj ex exs erl hs ml fs jl nim zig tf hcl service desktop reg log rst adoc org jsonl ndjson lock'),
  };
  const LANG = {};
  const L = (id, label, exts) => exts.split(' ').forEach((e) => { LANG[e] = { id, label }; });
  L('js', 'JavaScript', 'js mjs cjs jsx'); L('ts', 'TypeScript', 'ts tsx'); L('py', 'Python', 'py pyw'); L('rb', 'Ruby', 'rb');
  L('php', 'PHP', 'php'); L('java', 'Java', 'java'); L('kt', 'Kotlin', 'kt kts'); L('scala', 'Scala', 'scala'); L('c', 'C', 'c h'); L('cpp', 'C++', 'cc cpp cxx hpp hh');
  L('cs', 'C#', 'cs'); L('go', 'Go', 'go'); L('rs', 'Rust', 'rs'); L('swift', 'Swift', 'swift'); L('c', 'Objective-C', 'm mm'); L('dart', 'Dart', 'dart');
  L('lua', 'Lua', 'lua'); L('r', 'R', 'r'); L('perl', 'Perl', 'pl pm'); L('sh', 'Shell', 'sh bash zsh fish'); L('bat', 'Batch', 'bat cmd'); L('ps1', 'PowerShell', 'ps1 psm1');
  L('sql', 'SQL', 'sql'); L('css', 'CSS', 'css scss sass less'); L('xml', 'XML', 'xml xsl xslt plist svg vue svelte astro xhtml'); L('html', 'HTML', 'html htm');
  L('yaml', 'YAML', 'yaml yml'); L('toml', 'TOML', 'toml'); L('ini', 'INI', 'ini cfg conf env properties service desktop reg editorconfig'); L('json', 'JSON', 'json jsonc json5 geojson webmanifest jsonl ndjson');
  L('diff', 'Diff', 'diff patch'); L('md', 'Markdown', 'md markdown mdown mkd mdx'); L('log', 'Log', 'log'); L('make', 'Makefile', 'mk dockerfile gradle cmake');
  L('plain', 'Text', 'txt text nfo rtf srt vtt ass ssa lrc tex bib rst adoc org lock gitignore gitattributes graphql gql proto asm s vb vba clj ex exs erl hs ml fs jl nim zig tf hcl');
  const SPECIAL = { makefile: 'code', dockerfile: 'code', gemfile: 'code', rakefile: 'code', license: 'text', readme: 'text', changelog: 'text', authors: 'text', copying: 'text', notice: 'text', procfile: 'code', '.gitignore': 'code', '.env': 'code', '.bashrc': 'code', '.zshrc': 'code' };
  const SPECIAL_LANG = { makefile: 'make', dockerfile: 'make', gemfile: 'rb', rakefile: 'rb', '.bashrc': 'sh', '.zshrc': 'sh', '.env': 'ini', procfile: 'ini' };

  PV.langOf = (name) => {
    const low = (name || '').toLowerCase();
    if (SPECIAL_LANG[low]) return { id: SPECIAL_LANG[low], label: low[0].toUpperCase() + low.slice(1) };
    return LANG[PV.extOf(name)] || { id: 'plain', label: 'Plain text' };
  };
  PV.kindOf = (meta) => {
    const name = meta.name || '', ext = PV.extOf(name), low = name.toLowerCase(), type = meta.type || '';
    for (const k of ['pdf', 'md', 'html', 'csv', 'json', 'notebook', 'code', 'text', 'audio', 'video', 'image']) if (EXT[k].has(ext)) return k;
    if (SPECIAL[low]) return SPECIAL[low];
    if (type.startsWith('audio/')) return 'audio';
    if (type.startsWith('video/')) return 'video';
    if (type.startsWith('image/')) return 'image';
    if (type === 'application/pdf') return 'pdf';
    if (type === 'text/html') return 'html';
    if (type === 'text/markdown') return 'md';
    if (type === 'text/csv') return 'csv';
    if (type === 'application/json') return 'json';
    if (type.startsWith('text/') || /(xml|javascript|x-sh|yaml|toml)/.test(type)) return 'code';
    return 'unknown';
  };
  PV.category = (meta) => {
    switch (PV.kindOf(meta)) {
      case 'audio': return 'Audio';
      case 'video': return 'Video';
      case 'image': return 'Images';
      case 'pdf': case 'md': case 'text': case 'notebook': return 'Documents';
      case 'code': case 'json': case 'csv': return 'Code & Data';
      case 'html': return 'Apps & Games';
      default: return 'Other';
    }
  };
  PV.isViewable = (meta) => PV.kindOf(meta) !== 'unknown';

  PV.files = () => (spine() && spine().files) || [];
  PV.findSibling = (meta, exts) => {
    const base = PV.baseName(meta.name).toLowerCase();
    return PV.files().filter((f) => f.id !== meta.id && exts.includes(PV.extOf(f.name)) && (PV.baseName(f.name).toLowerCase() === base || PV.baseName(f.name).toLowerCase().startsWith(base + '.')));
  };
  PV.findByName = (name) => {
    const n = decodeURIComponent(String(name).split(/[?#]/)[0]).replace(/^\.?\//, '').toLowerCase();
    const base = n.split('/').pop();
    const fs = PV.files();
    return fs.find((f) => f.name.toLowerCase() === n) || fs.find((f) => f.name.toLowerCase() === base);
  };
  PV.blobOf = (meta) => window.getFileBlob(meta, true);
  PV.prefetch = (meta) => { if (meta) PV.blobOf(meta).catch(() => {}); };

  /* ---------- text decoding ---------- */
  PV.ENCODINGS = [['utf-8', 'UTF-8'], ['utf-16le', 'UTF-16 LE'], ['utf-16be', 'UTF-16 BE'], ['windows-1252', 'Western (Windows-1252)'], ['iso-8859-1', 'Latin-1'], ['iso-8859-2', 'Central European'], ['windows-1251', 'Cyrillic (Windows-1251)'], ['windows-1256', 'Arabic'], ['gbk', 'Chinese (GBK)'], ['big5', 'Chinese (Big5)'], ['shift_jis', 'Japanese (Shift-JIS)'], ['euc-kr', 'Korean (EUC-KR)']];
  PV.decode = (buf, label) => {
    const u8 = new Uint8Array(buf);
    let enc = label, off = 0;
    if (!enc) {
      if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) { enc = 'utf-8'; off = 3; }
      else if (u8[0] === 0xff && u8[1] === 0xfe) { enc = 'utf-16le'; off = 2; }
      else if (u8[0] === 0xfe && u8[1] === 0xff) { enc = 'utf-16be'; off = 2; }
      else { try { new TextDecoder('utf-8', { fatal: true }).decode(u8); enc = 'utf-8'; } catch (e) { enc = 'windows-1252'; } }
    } else if (enc === 'utf-8' && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) off = 3;
    let text;
    try { text = new TextDecoder(enc).decode(off ? u8.subarray(off) : u8); } catch (e) { text = new TextDecoder('utf-8').decode(u8); enc = 'utf-8'; }
    return { text, encoding: enc };
  };
  PV.sniffText = async (blob) => {
    const u8 = new Uint8Array(await blob.slice(0, 8192).arrayBuffer());
    if (!u8.length) return true;
    if ((u8[0] === 0xff && u8[1] === 0xfe) || (u8[0] === 0xfe && u8[1] === 0xff)) return true;
    let bad = 0;
    for (const b of u8) { if (b === 0) return false; if (b < 7 || (b > 13 && b < 32 && b !== 27)) bad++; }
    return bad / u8.length < 0.02;
  };

  /* ---------- in-page text search (CSS Custom Highlight API) ---------- */
  const HL = !!(window.CSS && CSS.highlights && window.Highlight);
  PV.clearSearch = () => { if (HL) { CSS.highlights.delete('pv-hit'); CSS.highlights.delete('pv-cur'); } };
  PV.createSearch = (getRoot, getScroller) => {
    let ranges = [], cur = -1, last = null;
    const S = {
      count: () => ranges.length,
      index: () => cur,
      find(q, o) {
        o = o || {};
        last = { q, o };
        ranges = []; cur = -1;
        PV.clearSearch();
        if (!q) return 0;
        let re;
        try {
          let src = o.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (o.word) src = '\\b(?:' + src + ')\\b';
          re = new RegExp(src, 'g' + (o.cs ? '' : 'i'));
        } catch (e) { return -1; }
        const root = getRoot();
        if (!root) return 0;
        const nodes = [], starts = [];
        let text = '';
        const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && n.parentElement.closest('.pv-nosearch,script,style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
        let n;
        while ((n = tw.nextNode())) { nodes.push(n); starts.push(text.length); text += n.nodeValue; }
        const locate = (pos) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
        let m, guard = 0;
        while ((m = re.exec(text)) && guard++ < 5000) {
          if (!m[0].length) { re.lastIndex++; continue; }
          const a = locate(m.index), b = locate(m.index + m[0].length - 1);
          const r = document.createRange();
          r.setStart(nodes[a], m.index - starts[a]);
          r.setEnd(nodes[b], m.index + m[0].length - starts[b]);
          ranges.push(r);
        }
        if (HL && ranges.length) CSS.highlights.set('pv-hit', new Highlight(...ranges));
        if (ranges.length) S.go(0);
        return ranges.length;
      },
      go(i) {
        if (!ranges.length) return;
        cur = ((i % ranges.length) + ranges.length) % ranges.length;
        const r = ranges[cur];
        if (HL) CSS.highlights.set('pv-cur', new Highlight(r));
        else { const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
        const el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' });
      },
      next() { S.go(cur + 1); },
      prev() { S.go(cur - 1); },
      refresh() { if (last && last.q) { const keep = cur; S.find(last.q, last.o); if (keep > 0) S.go(keep); } },
      clear() { ranges = []; cur = -1; last = null; PV.clearSearch(); },
    };
    return S;
  };

  /* search bar UI (shared by text/pdf-like views) */
  PV.searchBar = (opts) => {
    const input = h('input', { class: 'pv-input', type: 'search', placeholder: opts.placeholder || 'Find…', 'aria-label': 'Find', autocomplete: 'off', spellcheck: 'false' });
    const count = h('span', { class: 'pv-search-count', text: '' });
    const st = { cs: false, regex: false, word: false };
    const mk = (key, icon, title) => { const b = PV.btn(icon, title, () => { st[key] = !st[key]; b.classList.toggle('on', st[key]); run(); }, 'pv-btn-sm'); return b; };
    let t;
    const run = () => { clearTimeout(t); t = setTimeout(() => opts.onQuery(input.value, st), 120); };
    input.addEventListener('input', run);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? opts.onPrev() : opts.onNext(); }
      else if (e.key === 'Escape') { e.stopPropagation(); opts.onClose(); }
    });
    const bar = h('div', { class: 'pv-searchbar hidden' },
      h('span', { class: 'pv-ic-wrap', html: PV.ic('search', 16) }), input, count,
      opts.noOptions ? null : [mk('cs', 'case', 'Match case'), mk('regex', 'regex', 'Regular expression'), mk('word', 'type', 'Whole word')],
      PV.btn('up', 'Previous match', () => opts.onPrev(), 'pv-btn-sm'), PV.btn('down', 'Next match', () => opts.onNext(), 'pv-btn-sm'),
      PV.btn('close', 'Close search', () => opts.onClose(), 'pv-btn-sm'));
    return {
      el: bar, input,
      setCount(i, n) { count.textContent = n < 0 ? 'bad regex' : n ? (i + 1) + ' / ' + n : input.value ? 'none' : ''; count.classList.toggle('bad', n <= 0 && !!input.value); },
      open() { bar.classList.remove('hidden'); input.focus(); input.select(); },
      close() { bar.classList.add('hidden'); },
      isOpen: () => !bar.classList.contains('hidden'),
      rerun: run,
    };
  };

  /* ---------- messages ---------- */
  PV.message = (root, title, body, withDownload) => {
    root.innerHTML = '';
    const box = h('div', { class: 'pv-msg' },
      h('div', { class: 'pv-msg-ic', html: PV.ic('file', 34) }),
      h('div', { class: 'pv-msg-title', text: title }),
      body ? h('div', { class: 'pv-msg-body', text: body }) : null,
      withDownload ? h('button', { class: 'pv-cta', type: 'button', onclick: () => { const b = document.getElementById('download-file-btn'); if (b) b.click(); }, html: PV.ic('download', 16) + ' Download file' }) : null);
    root.appendChild(box);
  };

  /* keep shell chrome (title, sidebar highlight, download button) in sync when a viewer switches files itself */
  PV.setCurrent = (meta, blob) => {
    document.querySelectorAll('.file-item').forEach((el) => el.classList.remove('active', 'text-amber-300'));
    const it = [...document.querySelectorAll('.file-item')].find((x) => x.getAttribute('aria-label') === meta.name);
    if (it) { it.classList.add('active', 'text-amber-300'); if (it.scrollIntoView) it.scrollIntoView({ block: 'nearest' }); }
    const t = document.getElementById('viewer-title'); if (t) t.textContent = meta.name;
    const dl = document.getElementById('download-file-btn');
    if (dl && blob) dl.onclick = () => { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = meta.name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000); };
  };

  /* ---------- router ---------- */
  PV.render = async function (ctx) {
    PV.dispose();
    const root = h('div', { class: 'pv-root' });
    ctx.viewer.innerHTML = '';
    ctx.viewer.appendChild(root);
    ctx.root = root;
    let kind = PV.kindOf(ctx.meta);
    if (kind === 'unknown') kind = (await PV.sniffText(ctx.blob)) ? 'code' : 'unknown';
    ctx.kind = kind;
    const M = { audio: 'audio', video: 'video', image: 'image', pdf: 'pdf' };
    try {
      if (M[kind]) {
        if (!PV[M[kind]]) throw new Error('Viewer module missing: ' + kind);
        await PV[M[kind]].render(ctx);
      } else if (kind === 'unknown') {
        PV.message(root, 'No inline preview', (ctx.meta.type || 'This file type') + ' · ' + PV.fmtSize(ctx.meta.size), true);
      } else {
        await PV.text.render(ctx);
      }
    } catch (e) {
      console.error(e);
      PV.message(root, 'Could not open this file', (e && e.message) || String(e), true);
    }
  };
})();
