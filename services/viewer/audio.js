/* Pouch viewer runtime — music player */
(function () {
  'use strict';
  const PV = window.PV, h = PV.h, esc = PV.esc;

  /* ===================== tag readers ===================== */
  const ascii = (b, s, n) => { let o = ''; for (let i = s; i < s + n && i < b.length; i++) o += String.fromCharCode(b[i]); return o; };
  const be32 = (b, p) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
  const synch = (b, p) => ((b[p] & 0x7f) << 21) | ((b[p + 1] & 0x7f) << 14) | ((b[p + 2] & 0x7f) << 7) | (b[p + 3] & 0x7f);
  const unsync = (b) => { const o = []; for (let i = 0; i < b.length; i++) { o.push(b[i]); if (b[i] === 0xff && b[i + 1] === 0) i++; } return new Uint8Array(o); };
  const clean = (s) => String(s || '').replace(/\0+$/g, '').replace(/^\0+/, '').trim();
  function decText(d, enc) {
    try {
      if (enc === 1) {
        if (d[0] === 0xff && d[1] === 0xfe) return clean(new TextDecoder('utf-16le').decode(d.subarray(2)));
        if (d[0] === 0xfe && d[1] === 0xff) return clean(new TextDecoder('utf-16be').decode(d.subarray(2)));
        return clean(new TextDecoder('utf-16le').decode(d));
      }
      if (enc === 2) return clean(new TextDecoder('utf-16be').decode(d));
      if (enc === 3) return clean(new TextDecoder('utf-8').decode(d));
      return clean(new TextDecoder('windows-1252').decode(d));
    } catch (e) { return ''; }
  }
  function skipTerm(d, q, enc) {
    if (enc === 0 || enc === 3) { while (q < d.length && d[q] !== 0) q++; return q + 1; }
    while (q + 1 < d.length && !(d[q] === 0 && d[q + 1] === 0)) q += 2;
    return q + 2;
  }
  const mkCover = (data, mime) => (data && data.length > 64 ? URL.createObjectURL(new Blob([data], { type: /^image\//.test(mime) ? mime : 'image/jpeg' })) : null);

  async function id3v2(blob, head) {
    const ver = head[3], flags = head[5], size = synch(head, 6);
    let buf = new Uint8Array(await blob.slice(10, 10 + size).arrayBuffer());
    if (flags & 0x80 && ver < 4) buf = unsync(buf);
    let p = 0;
    if (flags & 0x40) p = ver === 4 ? synch(buf, 0) : be32(buf, 0) + 4;
    const t = {}, idLen = ver === 2 ? 3 : 4, hdr = ver === 2 ? 6 : 10;
    while (p + hdr <= buf.length) {
      const id = ascii(buf, p, idLen);
      if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
      const fs = ver === 2 ? (buf[p + 3] << 16) | (buf[p + 4] << 8) | buf[p + 5] : ver === 4 ? synch(buf, p + 4) : be32(buf, p + 4);
      const fl = ver >= 3 ? (buf[p + 8] << 8) | buf[p + 9] : 0;
      let d = buf.subarray(p + hdr, p + hdr + fs);
      p += hdr + fs;
      if (!fs) continue;
      if (ver === 4) { if (fl & 0x01) d = d.subarray(4); if (fl & 0x02) d = unsync(d); }
      const enc = d[0], txt = () => decText(d.subarray(1), enc);
      switch (id) {
        case 'TIT2': case 'TT2': t.title = txt(); break;
        case 'TPE1': case 'TP1': t.artist = txt(); break;
        case 'TPE2': case 'TP2': t.albumArtist = txt(); break;
        case 'TALB': case 'TAL': t.album = txt(); break;
        case 'TYER': case 'TYE': case 'TDRC': case 'TDRL': t.year = (txt().match(/\d{4}/) || [''])[0]; break;
        case 'TRCK': case 'TRK': t.track = txt().split('/')[0]; break;
        case 'TCON': case 'TCO': t.genre = txt().replace(/^\(\d+\)/, '').replace(/\0/g, ' / '); break;
        case 'USLT': case 'ULT': { const q = skipTerm(d, 4, enc); t.lyrics = decText(d.subarray(q), enc); break; }
        case 'APIC': case 'PIC': {
          let mime, q;
          if (ver === 2) { const f = ascii(d, 1, 3); mime = f === 'PNG' ? 'image/png' : 'image/jpeg'; q = 4; }
          else { let e = 1; while (e < d.length && d[e] !== 0) e++; mime = ascii(d, 1, e - 1).toLowerCase(); q = e + 1; if (mime === 'image/jpg') mime = 'image/jpeg'; }
          const pic = d[q]; q++;
          q = skipTerm(d, q, enc);
          if (!t.cover || pic === 3) { const u = mkCover(d.subarray(q), mime); if (u) t.cover = u; }
          break;
        }
        default:
      }
    }
    return t;
  }
  async function id3v1(blob) {
    if (blob.size < 128) return {};
    const b = new Uint8Array(await blob.slice(blob.size - 128).arrayBuffer());
    if (ascii(b, 0, 3) !== 'TAG') return {};
    const s = (a, n) => decText(b.subarray(a, a + n), 0);
    return { title: s(3, 30), artist: s(33, 30), album: s(63, 30), year: s(93, 4) };
  }
  async function flac(blob) {
    const buf = new Uint8Array(await blob.slice(0, Math.min(blob.size, 6 * 1048576)).arrayBuffer());
    const t = {}; let p = 4;
    while (p + 4 <= buf.length) {
      const hd = buf[p], last = hd & 0x80, type = hd & 0x7f, len = (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3];
      const d = buf.subarray(p + 4, p + 4 + len); p += 4 + len;
      if (type === 4) {
        const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
        let q = 4 + dv.getUint32(0, true); const n = dv.getUint32(q, true); q += 4;
        for (let i = 0; i < n && q + 4 <= d.length; i++) {
          const l = dv.getUint32(q, true); q += 4;
          const s = new TextDecoder('utf-8').decode(d.subarray(q, q + l)); q += l;
          const eq = s.indexOf('='); if (eq < 0) continue;
          const k = s.slice(0, eq).toUpperCase(), v = s.slice(eq + 1);
          if (k === 'TITLE') t.title = v; else if (k === 'ARTIST') t.artist = v; else if (k === 'ALBUM') t.album = v;
          else if (k === 'DATE' || k === 'YEAR') t.year = (v.match(/\d{4}/) || [''])[0]; else if (k === 'TRACKNUMBER') t.track = v.split('/')[0];
          else if (k === 'GENRE') t.genre = v; else if (k === 'LYRICS' || k === 'UNSYNCEDLYRICS') t.lyrics = v;
        }
      } else if (type === 6 && d.length === len) {
        const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
        let q = 4; const ml = dv.getUint32(q); q += 4; const mime = ascii(d, q, ml); q += ml;
        const dl = dv.getUint32(q); q += 4 + dl + 16; const pl = dv.getUint32(q); q += 4;
        const u = mkCover(d.subarray(q, q + pl), mime); if (u && !t.cover) t.cover = u;
      }
      if (last) break;
    }
    return t;
  }
  const boxes = (b, s, e) => { const o = []; let p = s; while (p + 8 <= e) { const len = be32(b, p); if (len < 8) break; o.push({ type: ascii(b, p + 4, 4), s: p + 8, e: Math.min(e, p + len) }); p += len; } return o; };
  async function mp4(blob) {
    let pos = 0; const size = blob.size;
    while (pos + 8 <= size) {
      const hb = new DataView(await blob.slice(pos, pos + 16).arrayBuffer());
      let len = hb.getUint32(0), hdr = 8;
      const type = String.fromCharCode(hb.getUint8(4), hb.getUint8(5), hb.getUint8(6), hb.getUint8(7));
      if (len === 1) { len = Number(hb.getBigUint64(8)); hdr = 16; } else if (len === 0) len = size - pos;
      if (type === 'moov') {
        const b = new Uint8Array(await blob.slice(pos + hdr, pos + len).arrayBuffer());
        const t = {};
        const find = (list, ty) => list.find((x) => x.type === ty);
        const udta = find(boxes(b, 0, b.length), 'udta'); if (!udta) return t;
        const meta = find(boxes(b, udta.s, udta.e), 'meta'); if (!meta) return t;
        const ilst = find(boxes(b, meta.s + 4, meta.e), 'ilst'); if (!ilst) return t;
        for (const it of boxes(b, ilst.s, ilst.e)) {
          const dat = find(boxes(b, it.s, it.e), 'data'); if (!dat) continue;
          const v = b.subarray(dat.s + 8, dat.e), flag = b[dat.s + 3];
          const str = () => new TextDecoder('utf-8').decode(v);
          switch (it.type) {
            case '\u00a9nam': t.title = str(); break; case '\u00a9ART': t.artist = str(); break; case '\u00a9alb': t.album = str(); break;
            case 'aART': t.albumArtist = str(); break; case '\u00a9day': t.year = (str().match(/\d{4}/) || [''])[0]; break; case '\u00a9gen': t.genre = str(); break;
            case '\u00a9lyr': t.lyrics = str(); break; case 'trkn': t.track = String((v[2] << 8) | v[3]); break;
            case 'covr': { const u = mkCover(v, flag === 14 ? 'image/png' : 'image/jpeg'); if (u) t.cover = u; break; }
            default:
          }
        }
        return t;
      }
      pos += len; if (len < 8) break;
    }
    return {};
  }
  async function readTags(blob) {
    try {
      const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
      if (ascii(head, 0, 3) === 'ID3') return await id3v2(blob, head);
      if (ascii(head, 0, 4) === 'fLaC') return await flac(blob);
      if (ascii(head, 4, 4) === 'ftyp') return await mp4(blob);
      return await id3v1(blob);
    } catch (e) { console.warn('tag read failed', e); return {}; }
  }
  function parseLrc(text) {
    const out = [], re = /\[(\d+):(\d+(?:[.:]\d+)?)\]/g;
    text.split(/\r?\n/).forEach((line) => {
      const times = []; let m, last = 0; re.lastIndex = 0;
      while ((m = re.exec(line))) { times.push(+m[1] * 60 + parseFloat(m[2].replace(':', '.'))); last = re.lastIndex; }
      if (!times.length) return;
      const txt = line.slice(last).replace(/<\d+:\d+(?:\.\d+)?>/g, '').trim();
      times.forEach((t) => out.push({ t, text: txt }));
    });
    return out.sort((a, b) => a.t - b.t);
  }
  PV.tags = { readTags, parseLrc };

  /* ===================== engine ===================== */
  const el = new Audio();
  el.preload = 'auto';
  const A = {
    el, queue: [], idx: -1, cur: null, info: new Map(), order: [], lyrics: null,
    shuffle: PV.pref.get('a.shuffle', false), repeat: PV.pref.get('a.repeat', 'off'), speed: PV.pref.get('a.speed', 1),
    eq: PV.pref.get('a.eq', [0, 0, 0, 0, 0]), viz: PV.pref.get('a.viz', true),
    mounted: false, V: null, stopAfter: false, sleepT: null, sleepAt: 0, ctx: null, analyser: null, filters: null, url: null,
  };
  el.volume = PV.pref.get('a.vol', 1);
  el.defaultPlaybackRate = A.speed; el.playbackRate = A.speed;
  try { el.preservesPitch = true; } catch (e) { /* ignore */ }
  let token = 0;
  const EQ_BANDS = [[60, 'lowshelf', '60'], [230, 'peaking', '230'], [910, 'peaking', '910'], [3600, 'peaking', '3.6k'], [14000, 'highshelf', '14k']];
  const EQ_PRESETS = { Flat: [0, 0, 0, 0, 0], 'Bass boost': [7, 4, 0, -1, -2], Vocal: [-3, 0, 4, 3, 0], 'Treble boost': [-2, -1, 0, 4, 7], Rock: [5, 3, -2, 3, 5], Acoustic: [4, 2, 1, 3, 3], Loudness: [6, 2, -1, 2, 6] };

  A.buildQueue = () => {
    const prev = A.cur ? A.cur.id : null;
    A.queue = PV.files().filter((f) => PV.kindOf(f) === 'audio');
    A.idx = prev != null ? A.queue.findIndex((f) => f.id === prev) : -1;
    rebuildOrder();
  };
  function rebuildOrder() {
    const n = A.queue.length, o = [...Array(n).keys()];
    if (A.shuffle) {
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
      if (A.idx >= 0) { const k = o.indexOf(A.idx); [o[0], o[k]] = [o[k], o[0]]; }
    }
    A.order = o;
  }
  A.onFilesRendered = () => { A.buildQueue(); initMini(); };

  function ensureGraph() {
    if (A.ctx || A.graphFailed) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      A.ctx = new AC();
      const src = A.ctx.createMediaElementSource(el);
      A.filters = EQ_BANDS.map(([f, type], i) => { const b = A.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (type === 'peaking') b.Q.value = 1; b.gain.value = A.eq[i] || 0; return b; });
      A.analyser = A.ctx.createAnalyser(); A.analyser.fftSize = 512; A.analyser.smoothingTimeConstant = 0.78;
      let node = src; A.filters.forEach((f) => { node.connect(f); node = f; });
      node.connect(A.analyser); A.analyser.connect(A.ctx.destination);
    } catch (e) { console.warn('Audio graph unavailable', e); A.graphFailed = true; A.ctx = null; A.analyser = null; }
  }
  const info = (f) => A.info.get(f.id) || {};
  const titleOf = (f) => info(f).title || PV.baseName(f.name);
  const artistOf = (f) => info(f).artist || '';

  async function tagsFor(meta, blob) {
    let t = A.info.get(meta.id);
    if (t && t._done) return t;
    t = Object.assign(t || {}, await readTags(blob)); t._done = true;
    A.info.set(meta.id, t);
    return t;
  }
  function durationOf(blob) {
    return new Promise((res) => {
      const a = new Audio(), u = URL.createObjectURL(blob);
      const fin = (d) => { URL.revokeObjectURL(u); a.src = ''; res(d); };
      a.preload = 'metadata'; a.onloadedmetadata = () => fin(isFinite(a.duration) ? a.duration : 0); a.onerror = () => fin(0);
      setTimeout(() => fin(0), 4000); a.src = u;
    });
  }

  async function load(meta, autoplay, blob) {
    const my = ++token;
    A.cur = meta; A.idx = A.queue.findIndex((f) => f.id === meta.id);
    if (A.idx < 0) { A.queue.push(meta); A.idx = A.queue.length - 1; }
    if (A.shuffle) { const k = A.order.indexOf(A.idx); if (k > 0) { [A.order[0], A.order[k]] = [A.order[k], A.order[0]]; } }
    A.lyrics = null; A.stopAfter = false; A.error = null;
    changed();
    try {
      blob = blob || (await PV.blobOf(meta));
      if (my !== token) return;
      if (A.mounted) PV.setCurrent(meta, blob);
      if (A.url) URL.revokeObjectURL(A.url);
      A.url = URL.createObjectURL(blob);
      el.src = A.url; el.playbackRate = A.speed;
      tagsFor(meta, blob).then((t) => { if (my === token) { if (t.duration == null && el.duration) t.duration = el.duration; changed(); } });
      const lrc = PV.findSibling(meta, ['lrc'])[0];
      if (lrc) PV.blobOf(lrc).then((b) => b.text()).then((txt) => { if (my !== token) return; const s = parseLrc(txt); A.lyrics = s.length ? { synced: s } : { plain: txt }; lyricsChanged(); }).catch(() => {});
      if (autoplay) await play();
      const nx = A.queue[A.order[(A.order.indexOf(A.idx) + 1) % A.order.length]];
      if (nx && nx.id !== meta.id) setTimeout(() => PV.prefetch(nx), 1500);
    } catch (e) { if (my === token) { A.error = e.message || 'Could not load audio'; changed(); } }
  }
  async function play() {
    ensureGraph();
    if (A.ctx && A.ctx.state === 'suspended') { try { await A.ctx.resume(); } catch (e) { /* ignore */ } }
    try { await el.play(); } catch (e) { if (e && e.name !== 'AbortError') console.warn('play blocked', e); }
  }
  A.toggle = () => { if (!A.cur) return; el.paused ? play() : el.pause(); };
  const goTo = (pos, autoplay) => { const i = A.order[pos]; if (A.queue[i]) load(A.queue[i], autoplay !== false); };
  A.next = (auto) => {
    const n = A.order.length; if (!n) return;
    let pos = A.order.indexOf(A.idx) + 1;
    if (pos >= n) { if (auto && A.repeat === 'off') { el.pause(); el.currentTime = 0; return; } pos = 0; if (A.shuffle && auto) rebuildOrder(); }
    goTo(pos);
  };
  A.prev = () => {
    if (el.currentTime > 3) { el.currentTime = 0; return; }
    const n = A.order.length; if (!n) return;
    let pos = A.order.indexOf(A.idx) - 1; if (pos < 0) pos = n - 1;
    goTo(pos);
  };
  A.seek = (t) => { if (isFinite(el.duration)) el.currentTime = PV.clamp(t, 0, el.duration); };
  A.setSpeed = (s) => { A.speed = s; el.defaultPlaybackRate = s; el.playbackRate = s; PV.pref.set('a.speed', s); changed(); };
  A.setVol = (v) => { el.volume = PV.clamp(v, 0, 1); el.muted = false; PV.pref.set('a.vol', el.volume); };
  A.setShuffle = (on) => { A.shuffle = on; PV.pref.set('a.shuffle', on); rebuildOrder(); changed(); };
  A.cycleRepeat = () => { A.repeat = { off: 'all', all: 'one', one: 'off' }[A.repeat]; PV.pref.set('a.repeat', A.repeat); changed(); PV.toast('Repeat: ' + { off: 'off', all: 'all tracks', one: 'this track' }[A.repeat]); };
  A.setEq = (i, g) => { A.eq[i] = g; if (A.filters) A.filters[i].gain.value = g; PV.pref.set('a.eq', A.eq); };
  A.setSleep = (m) => {
    clearTimeout(A.sleepT); A.sleepAt = 0; A.stopAfter = false;
    if (m === 'end') { A.stopAfter = true; PV.toast('Sleep: stopping after this track'); }
    else if (m > 0) { A.sleepAt = Date.now() + m * 60000; A.sleepT = setTimeout(() => { el.pause(); A.sleepAt = 0; PV.toast('Sleep timer: paused'); changed(); }, m * 60000); PV.toast('Sleep timer: ' + m + ' min'); }
    else PV.toast('Sleep timer off');
    changed();
  };
  A.stop = () => { token++; el.pause(); el.removeAttribute('src'); el.load(); if (A.url) { URL.revokeObjectURL(A.url); A.url = null; } A.cur = null; A.idx = -1; A.lyrics = null; changed(); if ('mediaSession' in navigator) { navigator.mediaSession.metadata = null; } };
  A.openCurrent = () => { if (!A.cur) return; const it = [...document.querySelectorAll('.file-item')].find((x) => x.getAttribute('aria-label') === A.cur.name); if (it) it.click(); };

  /* ===================== events / subscribers ===================== */
  function changed() { updateView(); updateMini(); updateSession(); }
  el.addEventListener('play', () => { startLoop(); changed(); });
  el.addEventListener('pause', () => { changed(); });
  el.addEventListener('ended', () => {
    if (A.stopAfter) { A.stopAfter = false; changed(); return; }
    if (A.repeat === 'one') { el.currentTime = 0; play(); } else A.next(true);
  });
  el.addEventListener('loadedmetadata', () => { const t = A.info.get(A.cur && A.cur.id); if (t && el.duration) t.duration = el.duration; updateView(); });
  el.addEventListener('durationchange', () => tickUI());
  el.addEventListener('timeupdate', () => { tickUI(); });
  el.addEventListener('error', () => { A.error = 'This browser cannot play this audio format'; changed(); PV.toast(A.error, 2600); });
  el.addEventListener('volumechange', () => updateVolUI());
  el.addEventListener('ratechange', () => { if (A.V) A.V.speedBtn.textContent = fmtSpeed(el.playbackRate); });

  /* media session */
  function updateSession() {
    if (!('mediaSession' in navigator) || !A.cur) return;
    const t = info(A.cur);
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: titleOf(A.cur), artist: t.artist || '', album: t.album || '', artwork: t.cover ? [{ src: t.cover, sizes: '512x512' }] : [] });
      navigator.mediaSession.playbackState = el.paused ? 'paused' : 'playing';
    } catch (e) { /* ignore */ }
  }
  if ('mediaSession' in navigator) {
    const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) { /* ignore */ } };
    set('play', () => play()); set('pause', () => el.pause()); set('previoustrack', () => A.prev()); set('nexttrack', () => A.next());
    set('seekbackward', (d) => A.seek(el.currentTime - ((d && d.seekOffset) || 10))); set('seekforward', (d) => A.seek(el.currentTime + ((d && d.seekOffset) || 10)));
    set('seekto', (d) => { if (d.seekTime != null) A.seek(d.seekTime); });
  }

  /* ===================== mini player ===================== */
  let mini = null, miniRefs = null;
  function initMini() {
    const host = document.getElementById('pv-mini');
    if (!host || host._ok) return;
    host._ok = true; mini = host; host.className = 'pv-mini';
    const cover = h('div', { class: 'pm-cover' });
    const title = h('div', { class: 'pm-title' }), sub = h('div', { class: 'pm-sub' });
    const play = PV.btn('play', 'Play / pause', () => A.toggle(), 'pm-play', 20);
    const prog = h('div', { class: 'pm-prog' }, h('i'));
    host.append(prog, h('button', { class: 'pm-open', type: 'button', onclick: () => A.openCurrent(), 'aria-label': 'Open player' }, cover, h('div', { class: 'pm-text' }, title, sub)),
      PV.btn('prev', 'Previous', () => A.prev(), 'pm-sk', 18), play, PV.btn('next', 'Next', () => A.next(), 'pm-sk', 18), PV.btn('close', 'Close player', () => A.stop(), 'pm-x', 16));
    miniRefs = { cover, title, sub, play, prog: prog.firstChild };
  }
  function updateMini() {
    if (!mini) return;
    const show = !!A.cur && !A.mounted;
    mini.classList.toggle('show', show);
    if (!A.cur) return;
    const t = info(A.cur);
    miniRefs.title.textContent = titleOf(A.cur); miniRefs.sub.textContent = t.artist || t.album || 'Audio';
    miniRefs.cover.style.backgroundImage = t.cover ? 'url("' + t.cover + '")' : '';
    miniRefs.cover.classList.toggle('empty', !t.cover); miniRefs.cover.innerHTML = t.cover ? '' : PV.ic('music', 18);
    PV.setIcon(miniRefs.play, el.paused ? 'play' : 'pause', 20);
  }

  /* ===================== main view ===================== */
  const fmtSpeed = (s) => (s === 1 ? '1×' : s + '×');
  const hue = (s) => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 360; return x; };
  let raf = 0, last = { lyric: -1 };

  A.render = async function (ctx) {
    if (!A.queue.length || !A.queue.some((f) => f.id === ctx.meta.id)) A.buildQueue();
    initMini();
    buildView(ctx.root);
    const same = A.cur && A.cur.id === ctx.meta.id && el.src;
    if (!same) await load(ctx.meta, true, ctx.blob); else changed();
    PV.onDispose(unmount);
    PV.setKeys(onKey);
    enrich();
  };

  function unmount() {
    A.mounted = false; A.V = null; cancelAnimationFrame(raf); raf = 0; updateMini();
  }

  function buildView(root) {
    root.classList.add('au-root');
    const V = {};
    V.bg = h('div', { class: 'au-bg' });
    V.art = h('div', { class: 'au-art' });
    V.canvas = h('canvas', { class: 'au-viz' });
    V.title = h('div', { class: 'au-title' }); V.artist = h('div', { class: 'au-artist' }); V.meta = h('div', { class: 'au-meta' });
    V.cur = h('span', { class: 'au-t', text: '0:00' }); V.dur = h('span', { class: 'au-t', text: '0:00' });
    V.seek = PV.range({ min: 0, max: 1000, step: 1, value: 0, label: 'Seek', onInput: (v) => { V.seeking = true; V.cur.textContent = PV.fmtTime((v / 1000) * (el.duration || 0)); }, onChange: (v) => { A.seek((v / 1000) * (el.duration || 0)); V.seeking = false; } });
    V.seek.classList.add('au-seek');
    V.playBtn = h('button', { class: 'au-play', type: 'button', 'aria-label': 'Play / pause', onclick: () => A.toggle(), html: PV.ic('play', 30) });
    V.shuffleBtn = PV.btn('shuffle', 'Shuffle (S)', () => A.setShuffle(!A.shuffle), 'au-ctl');
    V.repeatBtn = PV.btn('repeat', 'Repeat (R)', () => A.cycleRepeat(), 'au-ctl');
    V.speedBtn = h('button', { class: 'pv-chip', type: 'button', text: fmtSpeed(A.speed), title: 'Playback speed', onclick: (e) => PV.menu(e.currentTarget, [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((s) => ({ label: fmtSpeed(s), active: A.speed === s, onClick: () => A.setSpeed(s) })), { title: 'Speed' }) });
    V.sleepBtn = h('button', { class: 'pv-chip', type: 'button', html: PV.ic('moon', 14) + '<span>Sleep</span>', title: 'Sleep timer', onclick: (e) => PV.menu(e.currentTarget, [{ label: 'Off', onClick: () => A.setSleep(0) }, ...[15, 30, 45, 60].map((m) => ({ label: m + ' minutes', onClick: () => A.setSleep(m) })), { label: 'End of this track', onClick: () => A.setSleep('end') }], { title: 'Sleep timer' }) });
    V.eqBtn = h('button', { class: 'pv-chip', type: 'button', html: PV.ic('eq', 14) + '<span>EQ</span>', title: 'Equalizer', onclick: () => toggleEq() });
    V.vizBtn = h('button', { class: 'pv-chip' + (A.viz ? ' on' : ''), type: 'button', html: PV.ic('speed', 14) + '<span>Visualizer</span>', title: 'Toggle visualizer', onclick: () => { A.viz = !A.viz; PV.pref.set('a.viz', A.viz); V.vizBtn.classList.toggle('on', A.viz); V.canvas.style.display = A.viz ? '' : 'none'; startLoop(); } });
    V.volIcon = PV.btn('vol', 'Mute (M)', () => { el.muted = !el.muted; }, 'au-ctl sm');
    V.vol = PV.range({ min: 0, max: 1, step: 0.01, value: el.volume, label: 'Volume', onInput: (v) => A.setVol(v) });
    V.vol.classList.add('au-vol');
    V.eqPanel = h('div', { class: 'au-eq pv-hidden' });
    buildEq(V);
    V.tabs = h('div', { class: 'pv-seg au-tabs' },
      h('button', { type: 'button', class: 'on', 'data-t': 'queue', html: PV.ic('list', 14) + '<span>Queue</span>', onclick: () => tab('queue') }),
      h('button', { type: 'button', 'data-t': 'lyrics', html: PV.ic('lyrics', 14) + '<span>Lyrics</span>', onclick: () => tab('lyrics') }));
    V.queue = h('div', { class: 'au-queue pv-scroll' });
    V.lyrics = h('div', { class: 'au-lyrics pv-scroll pv-hidden' });
    V.side = h('div', { class: 'au-side' }, V.tabs, V.queue, V.lyrics);
    V.err = h('div', { class: 'au-err pv-hidden' });

    const left = h('div', { class: 'au-left' },
      h('div', { class: 'au-art-wrap' }, V.art, V.canvas),
      h('div', { class: 'au-info' }, V.title, V.artist, V.meta), V.err,
      h('div', { class: 'au-seekrow' }, V.cur, V.seek, V.dur),
      h('div', { class: 'au-ctls' }, V.shuffleBtn, PV.btn('prev', 'Previous (P)', () => A.prev(), 'au-ctl', 22), PV.btn('back10', 'Back 10 s', () => A.seek(el.currentTime - 10), 'au-ctl', 24), V.playBtn, PV.btn('fwd10', 'Forward 10 s', () => A.seek(el.currentTime + 10), 'au-ctl', 24), PV.btn('next', 'Next (N)', () => A.next(), 'au-ctl', 22), V.repeatBtn),
      h('div', { class: 'au-extras' }, V.speedBtn, V.sleepBtn, V.eqBtn, V.vizBtn, h('span', { class: 'au-volwrap' }, V.volIcon, V.vol)),
      V.eqPanel);
    root.append(V.bg, h('div', { class: 'au-main pv-scroll' }, left, V.side));
    V.canvas.style.display = A.viz ? '' : 'none';
    A.V = V; A.mounted = true; last = { lyric: -1 };
    renderQueue(); updateView(); updateVolUI(); updateMini();
  }

  function tab(name) {
    const V = A.V; if (!V) return;
    [...V.tabs.children].forEach((b) => b.classList.toggle('on', b.dataset.t === name));
    V.queue.classList.toggle('pv-hidden', name !== 'queue'); V.lyrics.classList.toggle('pv-hidden', name !== 'lyrics');
    if (name === 'lyrics') lyricsScroll(true);
  }

  function buildEq(V) {
    V.eqPanel.innerHTML = '';
    const sliders = EQ_BANDS.map(([, , label], i) => {
      const r = PV.range({ min: -12, max: 12, step: 1, value: A.eq[i], label: label + ' Hz', onInput: (v) => { A.setEq(i, v); out.textContent = (v > 0 ? '+' : '') + v; V.eqPresetBtn.textContent = 'Custom'; } });
      r.classList.add('au-eqr');
      const out = h('span', { class: 'au-eqv', text: (A.eq[i] > 0 ? '+' : '') + A.eq[i] });
      return { col: h('div', { class: 'au-eqcol' }, out, r, h('span', { class: 'au-eql', text: label })), r, out };
    });
    V.eqSliders = sliders;
    V.eqPresetBtn = h('button', { class: 'pv-chip', type: 'button', text: matchPreset() || 'Custom', onclick: (e) => PV.menu(e.currentTarget, Object.keys(EQ_PRESETS).map((k) => ({ label: k, active: matchPreset() === k, onClick: () => { EQ_PRESETS[k].forEach((g, i) => { A.setEq(i, g); PV.setRange(sliders[i].r, g); sliders[i].out.textContent = (g > 0 ? '+' : '') + g; }); V.eqPresetBtn.textContent = k; } })), { title: 'EQ preset' }) });
    V.eqPanel.append(h('div', { class: 'au-eqhead' }, h('b', { text: 'Equalizer' }), V.eqPresetBtn), h('div', { class: 'au-eqbands' }, sliders.map((s) => s.col)));
  }
  const matchPreset = () => Object.keys(EQ_PRESETS).find((k) => EQ_PRESETS[k].every((g, i) => g === (A.eq[i] || 0)));
  function toggleEq() { const V = A.V; if (!V) return; ensureGraph(); V.eqPanel.classList.toggle('pv-hidden'); V.eqBtn.classList.toggle('on', !V.eqPanel.classList.contains('pv-hidden')); if (A.graphFailed) PV.toast('Equalizer is not supported in this browser'); }

  function renderQueue() {
    const V = A.V; if (!V) return;
    V.queue.innerHTML = '';
    A.queue.forEach((f, i) => {
      const t = info(f);
      const row = h('button', { class: 'au-qrow', type: 'button', 'data-id': f.id, onclick: () => { if (A.cur && A.cur.id === f.id) A.toggle(); else load(f, true); } },
        h('span', { class: 'au-qn' }, h('b', { text: String(i + 1) }), h('i', { html: '<s></s><s></s><s></s>' })),
        h('span', { class: 'au-qt' }, h('span', { class: 'au-qtitle', text: titleOf(f) }), h('span', { class: 'au-qartist', text: [t.artist, t.album].filter(Boolean).join(' — ') || PV.fmtSize(f.size) })),
        h('span', { class: 'au-qd', text: t.duration ? PV.fmtTime(t.duration) : '' }));
      V.queue.appendChild(row);
    });
    markQueue();
  }
  function markQueue() {
    const V = A.V; if (!V) return;
    V.queue.querySelectorAll('.au-qrow').forEach((r) => { const on = A.cur && String(A.cur.id) === r.dataset.id; r.classList.toggle('cur', !!on); r.classList.toggle('playing', !!on && !el.paused); });
  }
  function updateQueueRow(id) {
    const V = A.V; if (!V) return;
    const r = V.queue.querySelector('.au-qrow[data-id="' + id + '"]'); if (!r) return;
    const f = A.queue.find((x) => x.id === id), t = info(f);
    r.querySelector('.au-qtitle').textContent = titleOf(f);
    r.querySelector('.au-qartist').textContent = [t.artist, t.album].filter(Boolean).join(' — ') || PV.fmtSize(f.size);
    r.querySelector('.au-qd').textContent = t.duration ? PV.fmtTime(t.duration) : '';
  }
  let enriching = false;
  async function enrich() {
    if (enriching) return; enriching = true;
    for (const f of A.queue.slice()) {
      if (!A.mounted) break;
      const t = A.info.get(f.id);
      if ((t && t._done && t.duration != null) || f.size > 80e6) continue;
      try {
        const b = await PV.blobOf(f);
        const tg = await tagsFor(f, b);
        if (tg.duration == null) tg.duration = await durationOf(b);
        updateQueueRow(f.id);
      } catch (e) { /* skip */ }
      await PV.sleep(80);
    }
    enriching = false;
  }

  function updateView() {
    const V = A.V; if (!V) return;
    const f = A.cur; if (!f) return;
    const t = info(f), hh = hue(f.name);
    V.title.textContent = titleOf(f);
    V.artist.textContent = t.artist || 'Unknown artist';
    V.meta.textContent = [t.album, t.year, t.genre].filter(Boolean).join(' · ') + (A.queue.length > 1 ? (t.album || t.year || t.genre ? '  ·  ' : '') + 'Track ' + (A.idx + 1) + ' of ' + A.queue.length : '');
    if (t.cover) {
      V.art.style.backgroundImage = 'url("' + t.cover + '")'; V.art.classList.remove('gen'); V.art.innerHTML = '';
      V.bg.style.backgroundImage = 'url("' + t.cover + '")'; V.bg.style.backgroundColor = '';
    } else {
      V.art.style.backgroundImage = 'linear-gradient(135deg, hsl(' + hh + ' 70% 45%), hsl(' + ((hh + 60) % 360) + ' 70% 25%))'; V.art.classList.add('gen'); V.art.innerHTML = PV.ic('music', 84);
      V.bg.style.backgroundImage = 'linear-gradient(135deg, hsl(' + hh + ' 70% 35%), hsl(' + ((hh + 60) % 360) + ' 70% 12%))';
    }
    PV.setIcon(V.playBtn, el.paused ? 'play' : 'pause', 30);
    V.playBtn.classList.toggle('playing', !el.paused);
    V.art.classList.toggle('spin', !el.paused);
    V.shuffleBtn.classList.toggle('on', A.shuffle);
    V.repeatBtn.classList.toggle('on', A.repeat !== 'off'); PV.setIcon(V.repeatBtn, A.repeat === 'one' ? 'repeat1' : 'repeat');
    V.speedBtn.textContent = fmtSpeed(A.speed); V.speedBtn.classList.toggle('on', A.speed !== 1);
    V.sleepBtn.classList.toggle('on', !!A.sleepAt || A.stopAfter);
    V.err.classList.toggle('pv-hidden', !A.error); V.err.textContent = A.error || '';
    markQueue(); updateQueueRow(f.id);
    V.queue.querySelector('.au-qrow.cur') && last.q !== f.id && (last.q = f.id, V.queue.querySelector('.au-qrow.cur').scrollIntoView({ block: 'nearest' }));
    tickUI(); lyricsChanged(true);
  }
  function updateVolUI() {
    const V = A.V; if (!V) return;
    PV.setRange(V.vol, el.muted ? 0 : el.volume);
    PV.setIcon(V.volIcon, el.muted || el.volume === 0 ? 'mute' : el.volume < 0.5 ? 'volLow' : 'vol', 18);
  }
  function tickUI() {
    const d = el.duration, c = el.currentTime;
    if (A.V) {
      const V = A.V;
      if (!V.seeking) { V.cur.textContent = PV.fmtTime(c); PV.setRange(V.seek, isFinite(d) && d ? (c / d) * 1000 : 0); }
      V.dur.textContent = isFinite(d) ? PV.fmtTime(d) : '0:00';
      syncLyrics(c);
    }
    if (miniRefs && isFinite(d) && d) miniRefs.prog.style.width = (c / d) * 100 + '%';
    if ('mediaSession' in navigator && isFinite(d) && d && navigator.mediaSession.setPositionState && Math.abs(c - (tickUI.lastPos || 0)) > 4) {
      tickUI.lastPos = c;
      try { navigator.mediaSession.setPositionState({ duration: d, position: c, playbackRate: el.playbackRate }); } catch (e) { /* ignore */ }
    }
  }

  /* lyrics */
  function lyricsChanged(quiet) {
    const V = A.V; if (!V) return;
    V.lyrics.innerHTML = ''; last.lyric = -1;
    const L = A.lyrics || (info(A.cur || {}).lyrics ? (() => { const s = parseLrc(info(A.cur).lyrics); return s.length ? { synced: s } : { plain: info(A.cur).lyrics }; })() : null);
    A.lyricsShown = L;
    const lbtn = V.tabs.querySelector('[data-t="lyrics"]');
    lbtn.classList.toggle('dot', !!L);
    if (!L) { V.lyrics.appendChild(h('div', { class: 'au-nolyrics', html: PV.ic('lyrics', 28) + '<p>No lyrics for this track.</p><small>Add a <b>.lrc</b> file with the same name to the pouch for synced lyrics.</small>' })); return; }
    if (L.synced) L.synced.forEach((ln, i) => V.lyrics.appendChild(h('div', { class: 'au-ly', 'data-i': i, text: ln.text || '♪', onclick: () => { A.seek(ln.t); if (el.paused) play(); } })));
    else V.lyrics.appendChild(h('pre', { class: 'au-plainly', text: L.plain }));
    if (L.synced && !quiet) tab('lyrics');
  }
  function syncLyrics(c) {
    const L = A.lyricsShown; if (!L || !L.synced || !A.V) return;
    let i = -1; const s = L.synced;
    for (let k = 0; k < s.length; k++) { if (s[k].t <= c + 0.15) i = k; else break; }
    if (i === last.lyric) return;
    last.lyric = i;
    const kids = A.V.lyrics.children;
    for (let k = 0; k < kids.length; k++) kids[k].classList.toggle('on', k === i);
    lyricsScroll(false);
  }
  function lyricsScroll(instant) {
    const V = A.V; if (!V || V.lyrics.classList.contains('pv-hidden')) return;
    const on = V.lyrics.querySelector('.au-ly.on'); if (!on) return;
    V.lyrics.scrollTo({ top: on.offsetTop - V.lyrics.clientHeight / 2 + on.clientHeight / 2, behavior: instant ? 'auto' : 'smooth' });
  }

  /* visualizer + progress loop */
  function startLoop() { if (!raf && A.mounted) raf = requestAnimationFrame(loop); }
  const bars = new Float32Array(48);
  function loop() {
    raf = 0;
    const V = A.V; if (!V) return;
    if (!el.seeking) tickUI();
    drawViz(V.canvas);
    if (!el.paused || bars.some((b) => b > 0.01)) raf = requestAnimationFrame(loop);
  }
  function drawViz(c) {
    if (!A.viz) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), w = c.clientWidth, hgt = c.clientHeight;
    if (!w || !hgt) return;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hgt * dpr); }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hgt);
    const n = bars.length;
    let data = null;
    if (A.analyser && !el.paused) { data = new Uint8Array(A.analyser.frequencyBinCount); A.analyser.getByteFrequencyData(data); }
    const usable = data ? Math.floor(data.length * 0.72) : 0;
    for (let i = 0; i < n; i++) {
      let v = 0;
      if (data) {
        const a = Math.floor(Math.pow(i / n, 1.7) * usable), b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / n, 1.7) * usable));
        let s = 0; for (let k = a; k < b; k++) s += data[k]; v = s / (b - a) / 255;
        v = Math.pow(v, 1.25) * (0.8 + (i / n) * 0.6);
      }
      bars[i] = v > bars[i] ? v : bars[i] * 0.88;
    }
    const gap = 3, bw = (w - gap * (n - 1)) / n;
    const grad = g.createLinearGradient(0, hgt, 0, 0); grad.addColorStop(0, 'rgba(245,158,11,.95)'); grad.addColorStop(1, 'rgba(251,113,133,.95)');
    g.fillStyle = grad;
    for (let i = 0; i < n; i++) {
      const bh = Math.max(3, bars[i] * hgt * 0.95), x = i * (bw + gap), r = Math.min(bw / 2, 4);
      g.beginPath(); g.moveTo(x, hgt); g.lineTo(x, hgt - bh + r); g.quadraticCurveTo(x, hgt - bh, x + r, hgt - bh); g.lineTo(x + bw - r, hgt - bh); g.quadraticCurveTo(x + bw, hgt - bh, x + bw, hgt - bh + r); g.lineTo(x + bw, hgt); g.closePath(); g.fill();
    }
  }
  el.addEventListener('play', () => startLoop());

  /* keyboard */
  function onKey(e) {
    const k = e.key;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === ' ' || k === 'k') { e.preventDefault(); A.toggle(); }
    else if (k === 'ArrowRight') { e.preventDefault(); A.seek(el.currentTime + (e.shiftKey ? 15 : 5)); }
    else if (k === 'ArrowLeft') { e.preventDefault(); A.seek(el.currentTime - (e.shiftKey ? 15 : 5)); }
    else if (k === 'l') A.seek(el.currentTime + 10); else if (k === 'j') A.seek(el.currentTime - 10);
    else if (k === 'ArrowUp') { e.preventDefault(); A.setVol(el.volume + 0.05); }
    else if (k === 'ArrowDown') { e.preventDefault(); A.setVol(el.volume - 0.05); }
    else if (k === 'm') el.muted = !el.muted;
    else if (k === 'n' || k === 'N') A.next(); else if (k === 'p' || k === 'P') A.prev();
    else if (k === 's' || k === 'S') A.setShuffle(!A.shuffle); else if (k === 'r' || k === 'R') A.cycleRepeat();
  }

  PV.audio = A;
})();
