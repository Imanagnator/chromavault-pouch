/* Pouch viewer runtime — video player */
(function () {
  'use strict';
  const PV = window.PV, h = PV.h, esc = PV.esc;

  /* ---------- subtitles ---------- */
  const T = /(?:(\d+):)?(\d+):(\d+)[.,](\d+)/;
  const toSec = (s) => { const m = T.exec(s); return m ? (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + parseFloat('0.' + m[4]) : 0; };
  function subHtml(t) {
    t = t.replace(/\{\\[^}]*\}/g, '').replace(/<\d+:\d+[:.\d]*>/g, '').replace(/<\/?(?:c|v|lang|ruby|rt)[^>]*>/gi, '');
    t = esc(t).replace(/&lt;(\/?)(i|b|u)&gt;/gi, '<$1$2>').replace(/\\N/g, '<br>').replace(/\n/g, '<br>');
    return t;
  }
  function parseSubs(text) {
    text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const cues = [];
    for (const block of text.split(/\n{2,}/)) {
      const lines = block.split('\n');
      const k = lines.findIndex((l) => l.indexOf('-->') >= 0);
      if (k < 0) continue;
      const [a, b] = lines[k].split('-->');
      const s = toSec(a), e = toSec(b.trim().split(/\s+/)[0]);
      const body = lines.slice(k + 1).join('\n').trim();
      if (body && e > s) cues.push({ s, e, h: subHtml(body) });
    }
    return cues.sort((x, y) => x.s - y.s);
  }
  PV.subs = { parse: parseSubs };

  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const isTouch = () => matchMedia('(hover: none)').matches;

  async function render(ctx) {
    const { meta, root, url } = ctx;
    root.classList.add('vd-root');
    const sk = 'v.pos.' + meta.id;
    const P = (k, d) => PV.pref.get('v.' + k, d);
    const S = { vol: P('vol', 1), fit: P('fit', 'contain'), loop: false, autonext: P('autonext', true), subSize: P('subsize', 22), subBg: P('subbg', 1), subDelay: 0, cues: null, subName: null, bright: 1, hold: false, uiTimer: 0, seeking: false, resumed: false };

    const video = h('video', { class: 'vd-video', playsinline: '', 'webkit-playsinline': '', preload: 'auto', disablepictureinpicture: false });
    video.volume = S.vol;
    const sub = h('div', { class: 'vd-sub' });
    const spinner = h('div', { class: 'vd-spin pv-hidden' }, h('i'));
    const bigPlay = h('button', { class: 'vd-big pv-hidden', type: 'button', 'aria-label': 'Play', html: PV.ic('play', 44), onclick: (e) => { e.stopPropagation(); toggle(); } });
    const flash = h('div', { class: 'vd-flash' });
    const hud = h('div', { class: 'vd-hud' });
    const gest = h('div', { class: 'vd-gest' });

    /* controls */
    const title = h('div', { class: 'vd-title', text: meta.name });
    const vids = PV.files().filter((f) => PV.kindOf(f) === 'video');
    const vi = vids.findIndex((f) => f.id === meta.id);
    const openFile = (f) => { const it = [...document.querySelectorAll('.file-item')].find((x) => x.getAttribute('aria-label') === f.name); if (it) it.click(); };
    const hasNav = vids.length > 1;
    const playBtn = PV.btn('play', 'Play / pause (K)', () => toggle(), 'vd-b', 22);
    const prevBtn = hasNav ? PV.btn('prev', 'Previous video (Shift+P)', () => openFile(vids[(vi - 1 + vids.length) % vids.length]), 'vd-b', 18) : null;
    const nextBtn = hasNav ? PV.btn('next', 'Next video (Shift+N)', () => openFile(vids[(vi + 1) % vids.length]), 'vd-b', 18) : null;
    const volBtn = PV.btn('vol', 'Mute (M)', () => { video.muted = !video.muted; }, 'vd-b', 20);
    const volR = PV.range({ min: 0, max: 1, step: 0.01, value: S.vol, label: 'Volume', onInput: (v) => { video.muted = false; video.volume = v; S.vol = v; PV.pref.set('v.vol', v); } });
    volR.classList.add('vd-vol');
    const timeEl = h('span', { class: 'vd-time', text: '0:00 / 0:00' });
    const seek = PV.range({ min: 0, max: 1000, step: 1, value: 0, label: 'Seek', onInput: (v) => { S.seeking = true; const d = video.duration || 0; timeEl.textContent = PV.fmtTime((v / 1000) * d) + ' / ' + PV.fmtTime(d); }, onChange: (v) => { video.currentTime = (v / 1000) * (video.duration || 0); S.seeking = false; } });
    seek.classList.add('vd-seek');
    const tip = h('div', { class: 'vd-tip pv-hidden' });
    seek.addEventListener('pointermove', (e) => { const r = seek.getBoundingClientRect(), p = PV.clamp((e.clientX - r.left) / r.width, 0, 1); tip.textContent = PV.fmtTime(p * (video.duration || 0)); tip.style.left = p * 100 + '%'; tip.classList.remove('pv-hidden'); });
    seek.addEventListener('pointerleave', () => tip.classList.add('pv-hidden'));
    const ccBtn = PV.btn('cc', 'Subtitles (C)', (e) => subMenu(e.currentTarget), 'vd-b', 20);
    const spdBtn = h('button', { class: 'vd-b vd-chip', type: 'button', text: '1×', title: 'Speed', onclick: (e) => PV.menu(e.currentTarget, SPEEDS.map((s) => ({ label: s === 1 ? 'Normal' : s + '×', active: video.playbackRate === s, onClick: () => setSpeed(s) })), { title: 'Playback speed' }) });
    const setBtn = PV.btn('gear', 'Settings', (e) => settingsMenu(e.currentTarget), 'vd-b', 20);
    const pipBtn = document.pictureInPictureEnabled ? PV.btn('pip', 'Picture-in-picture (P)', () => pip(), 'vd-b vd-hide-sm', 20) : null;
    const rotBtn = isTouch() ? PV.btn('rotCw', 'Rotate screen', () => rotate(), 'vd-b', 20) : null;
    const fsBtn = PV.btn('full', 'Fullscreen (F)', () => fullscreen(), 'vd-b', 20);

    const ui = h('div', { class: 'vd-ui' },
      h('div', { class: 'vd-top' }, title, h('span', { class: 'pv-grow' }), hasNav ? h('span', { class: 'vd-count', text: (vi + 1) + ' / ' + vids.length }) : null),
      h('div', { class: 'vd-bottom' },
        h('div', { class: 'vd-seekwrap' }, seek, tip),
        h('div', { class: 'vd-row' }, prevBtn, playBtn, nextBtn, h('span', { class: 'vd-volwrap' }, volBtn, volR), timeEl, h('span', { class: 'pv-grow' }), ccBtn, spdBtn, setBtn, pipBtn, rotBtn, fsBtn)));
    const stage = h('div', { class: 'vd-stage' }, video, sub, gest, spinner, flash, hud, bigPlay, ui);
    root.appendChild(stage);

    /* ---- helpers ---- */
    const showHud = (html, ms) => { hud.innerHTML = html; hud.classList.add('show'); clearTimeout(showHud.t); showHud.t = setTimeout(() => hud.classList.remove('show'), ms || 900); };
    const flashAt = (side, txt) => { const f = h('div', { class: 'vd-ripple ' + side, html: txt }); flash.appendChild(f); setTimeout(() => f.remove(), 650); };
    function toggle() { video.paused || video.ended ? video.play().catch(() => {}) : video.pause(); }
    function skip(d) { if (isFinite(video.duration)) video.currentTime = PV.clamp(video.currentTime + d, 0, video.duration); }
    function setSpeed(s) { video.playbackRate = s; video.defaultPlaybackRate = s; spdBtn.textContent = (s === 1 ? '1' : s) + '×'; spdBtn.classList.toggle('on', s !== 1); showHud('<b>' + s + '×</b> speed'); }
    function pip() { try { document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture(); } catch (e) { PV.toast('Picture-in-picture is not available'); } }
    function fullscreen() {
      if (!PV.isFull() && !stage.requestFullscreen && !stage.webkitRequestFullscreen && video.webkitEnterFullscreen) { video.webkitEnterFullscreen(); return; }
      PV.toggleFull(stage);
    }
    function rotate() {
      const go = () => { try { const o = screen.orientation; const land = o.type.indexOf('landscape') === 0; o.lock(land ? 'portrait' : 'landscape').catch(() => PV.toast('Rotation lock is not supported here')); } catch (e) { PV.toast('Rotation lock is not supported here'); } };
      if (!PV.isFull()) { const p = PV.toggleFull(stage); (p && p.then ? p : Promise.resolve()).then(go).catch(go); } else go();
    }
    function capture() {
      if (!video.videoWidth) return;
      const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      c.toBlob((b) => { if (!b) return PV.toast('Capture failed'); const a = h('a', { href: URL.createObjectURL(b), download: PV.baseName(meta.name) + '-' + PV.fmtTime(video.currentTime).replace(':', 'm') + 's.png' }); document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); PV.toast('Frame saved'); }, 'image/png');
    }
    const fitStyle = () => { video.style.objectFit = S.fit; };
    const FITS = [['contain', 'Fit'], ['cover', 'Fill (crop)'], ['fill', 'Stretch']];

    /* ---- UI visibility ---- */
    function showUI() { ui.classList.remove('hide'); stage.classList.add('ui-on'); stage.classList.remove('nocursor'); clearTimeout(S.uiTimer); if (!video.paused) S.uiTimer = setTimeout(hideUI, 3000); }
    function hideUI() {
      if (video.paused || document.querySelector('.pv-menu')) return;
      if (!isTouch() && ui.matches(':hover') && ui.querySelector(':hover') && ui.querySelector(':hover').closest('.vd-top,.vd-bottom')) { S.uiTimer = setTimeout(hideUI, 1500); return; }
      ui.classList.add('hide'); stage.classList.remove('ui-on'); stage.classList.add('nocursor');
    }
    stage.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') showUI(); });
    stage.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !video.paused) { clearTimeout(S.uiTimer); S.uiTimer = setTimeout(hideUI, 600); } });

    /* ---- gestures ---- */
    let g = null, lastTap = { t: 0, x: 0 }, tapTimer = 0, holdTimer = 0;
    gest.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const r = gest.getBoundingClientRect();
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now(), mode: null, rect: r, vol: video.volume, br: S.bright, type: e.pointerType };
      if (e.pointerType !== 'mouse') {
        holdTimer = setTimeout(() => { if (g && !g.mode) { g.mode = 'hold'; S.hold = video.playbackRate; video.playbackRate = 2; showHud('<b>2×</b> hold speed'); } }, 450);
      }
      try { gest.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    gest.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id || g.type === 'mouse') return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.mode && (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx) * 1.4)) { g.mode = (g.x - g.rect.left) < g.rect.width / 2 ? 'bright' : 'vol'; clearTimeout(holdTimer); }
      if (g.mode === 'vol') { const v = PV.clamp(g.vol - (dy / g.rect.height) * 1.3, 0, 1); video.muted = false; video.volume = v; S.vol = v; PV.setRange(volR, v); showHud(PV.ic('vol', 20) + '<b>' + Math.round(v * 100) + '%</b>'); }
      else if (g.mode === 'bright') { S.bright = PV.clamp(g.br - (dy / g.rect.height) * 1.3, 0.3, 1.8); video.style.filter = 'brightness(' + S.bright + ')'; showHud(PV.ic('bright', 20) + '<b>' + Math.round(S.bright * 100) + '%</b>'); }
    });
    const endG = (e) => {
      if (!g || e.pointerId !== g.id) return;
      clearTimeout(holdTimer);
      const cur = g; g = null;
      if (cur.mode === 'hold') { video.playbackRate = S.hold; hud.classList.remove('show'); return; }
      if (cur.mode === 'vol') { PV.pref.set('v.vol', video.volume); return; }
      if (cur.mode === 'bright') return;
      if (Math.hypot(e.clientX - cur.x, e.clientY - cur.y) > 10 || Date.now() - cur.t > 500) return;
      const now = Date.now(), rel = (e.clientX - cur.rect.left) / cur.rect.width;
      if (cur.type === 'mouse') {
        if (now - lastTap.t < 300) { clearTimeout(tapTimer); lastTap.t = 0; fullscreen(); return; }
        lastTap = { t: now, x: e.clientX }; tapTimer = setTimeout(() => { toggle(); }, 230); return;
      }
      if (now - lastTap.t < 320) {
        clearTimeout(tapTimer); lastTap.t = 0;
        if (rel < 0.34) { skip(-10); flashAt('l', PV.ic('back10', 30) + '<span>10 s</span>'); }
        else if (rel > 0.66) { skip(10); flashAt('r', PV.ic('fwd10', 30) + '<span>10 s</span>'); }
        else toggle();
        showUI();
      } else {
        lastTap = { t: now, x: e.clientX };
        tapTimer = setTimeout(() => { ui.classList.contains('hide') ? showUI() : (video.paused ? showUI() : hideUI()); }, 240);
      }
    };
    gest.addEventListener('pointerup', endG); gest.addEventListener('pointercancel', (e) => { clearTimeout(holdTimer); if (g && g.mode === 'hold') video.playbackRate = S.hold; g = null; });

    /* ---- video events ---- */
    const upPlay = () => { PV.setIcon(playBtn, video.paused ? 'play' : 'pause', 22); bigPlay.classList.toggle('pv-hidden', !video.paused || !!S.err || video.currentTime > 0.2 && !video.ended); stage.classList.toggle('paused', video.paused); if (video.paused) showUI(); else showUI(); };
    video.addEventListener('play', upPlay); video.addEventListener('pause', upPlay);
    video.addEventListener('playing', () => { spinner.classList.add('pv-hidden'); upPlay(); });
    video.addEventListener('waiting', () => spinner.classList.remove('pv-hidden'));
    video.addEventListener('canplay', () => spinner.classList.add('pv-hidden'));
    video.addEventListener('volumechange', () => { PV.setRange(volR, video.muted ? 0 : video.volume); PV.setIcon(volBtn, video.muted || video.volume === 0 ? 'mute' : video.volume < 0.5 ? 'volLow' : 'vol', 20); });
    let saveT = 0;
    const tick = () => {
      const d = video.duration, c = video.currentTime;
      if (!S.seeking) { PV.setRange(seek, isFinite(d) && d ? (c / d) * 1000 : 0); timeEl.textContent = PV.fmtTime(c) + ' / ' + PV.fmtTime(d); }
      if (video.buffered.length && d) { let end = 0; for (let i = 0; i < video.buffered.length; i++) if (video.buffered.start(i) <= c + 0.5) end = Math.max(end, video.buffered.end(i)); seek.style.setProperty('--b', (end / d) * 100 + '%'); }
      if (Date.now() - saveT > 4000 && c > 3) { saveT = Date.now(); PV.store.set(sk, { t: c, d }); }
    };
    video.addEventListener('timeupdate', tick); video.addEventListener('progress', tick); video.addEventListener('durationchange', tick);
    video.addEventListener('loadedmetadata', () => {
      tick();
      const saved = PV.store.get(sk, null);
      if (saved && !S.resumed && saved.t > 8 && saved.t < video.duration - 10) { S.resumed = true; video.currentTime = saved.t; PV.toast('Resumed at ' + PV.fmtTime(saved.t), 2600); }
      if (video.videoWidth) title.title = video.videoWidth + '×' + video.videoHeight;
    });
    video.addEventListener('ended', () => {
      PV.store.set(sk, null);
      if (S.loop) { video.currentTime = 0; video.play(); return; }
      if (S.autonext && hasNav && vi < vids.length - 1) { PV.toast('Next: ' + vids[vi + 1].name, 1800); setTimeout(() => openFile(vids[vi + 1]), 700); return; }
      showUI(); bigPlay.innerHTML = PV.ic('rotCw', 44); bigPlay.classList.remove('pv-hidden');
    });
    video.addEventListener('error', () => {
      const code = video.error && video.error.code;
      S.err = true; spinner.classList.add('pv-hidden'); bigPlay.classList.add('pv-hidden');
      const box = h('div', { class: 'vd-error' }, h('div', { class: 'pv-msg-ic', html: PV.ic('file', 30) }), h('b', { text: code === 4 ? 'This browser can’t play this video' : 'Video playback error' }),
        h('p', { text: code === 4 ? 'The container or codec (e.g. HEVC/H.265, MKV, AVI) isn’t supported here. Try Chrome or Edge, or download the file and open it in a media player.' : (video.error && video.error.message) || 'Unknown error.' }),
        h('button', { class: 'pv-cta', type: 'button', html: PV.ic('download', 16) + ' Download video', onclick: () => { const b = document.getElementById('download-file-btn'); b && b.click(); } }));
      stage.appendChild(box);
    });
    document.addEventListener('fullscreenchange', onFs); document.addEventListener('webkitfullscreenchange', onFs);
    function onFs() { PV.setIcon(fsBtn, PV.isFull() ? 'exitFull' : 'full', 20); stage.classList.toggle('full', PV.isFull()); if (!PV.isFull() && screen.orientation && screen.orientation.unlock) try { screen.orientation.unlock(); } catch (e) { /* ignore */ } }

    /* ---- subtitles ---- */
    const allSubs = PV.files().filter((f) => ['srt', 'vtt'].includes(PV.extOf(f.name)));
    const base = PV.baseName(meta.name).toLowerCase();
    const matched = allSubs.filter((f) => PV.baseName(f.name).toLowerCase().indexOf(base) === 0);
    const subFiles = matched.length ? matched : allSubs;
    async function loadSub(f) {
      try {
        const b = await PV.blobOf(f);
        S.cues = parseSubs(PV.decode(await b.arrayBuffer()).text); S.subName = f.name;
        showHud(PV.ic('cc', 20) + '<b>' + esc(f.name) + '</b>', 1400); applySub(); ccBtn.classList.add('on');
      } catch (e) { PV.toast('Could not load subtitles'); }
    }
    function loadLocalSub() {
      const inp = h('input', { type: 'file', accept: '.srt,.vtt,.txt', style: { display: 'none' }, onchange: async () => { const f = inp.files[0]; if (!f) return; S.cues = parseSubs(PV.decode(await f.arrayBuffer()).text); S.subName = f.name; ccBtn.classList.add('on'); applySub(); PV.toast('Loaded ' + f.name); inp.remove(); } });
      document.body.appendChild(inp); inp.click();
    }
    let cueIdx = 0;
    function applySub() {
      if (!S.cues) { sub.innerHTML = ''; return; }
      const t = video.currentTime - S.subDelay;
      const act = [];
      for (let i = Math.max(0, cueIdx - 3); i < S.cues.length; i++) { const c = S.cues[i]; if (c.s > t + 0.01) break; if (c.e >= t) act.push(c.h); }
      // keep cueIdx near current for speed
      while (cueIdx < S.cues.length - 1 && S.cues[cueIdx + 1].s <= t) cueIdx++;
      while (cueIdx > 0 && S.cues[cueIdx].s > t) cueIdx--;
      const html = act.join('<br>');
      if (sub._h !== html) { sub._h = html; sub.innerHTML = html ? '<span>' + html + '</span>' : ''; }
    }
    function styleSub() { stage.style.setProperty('--sub', S.subSize + 'px'); sub.dataset.bg = String(S.subBg); }
    function subMenu(anchor) {
      const items = [{ header: 'Subtitles' }, { label: 'Off', active: !S.cues, onClick: () => { S.cues = null; S.subName = null; ccBtn.classList.remove('on'); applySub(); } }];
      subFiles.forEach((f) => items.push({ label: f.name, active: S.subName === f.name, onClick: () => loadSub(f) }));
      items.push({ label: 'Load from device…', icon: 'folder', onClick: () => loadLocalSub() }, '-', { header: 'Style · size ' + S.subSize + ' px · delay ' + S.subDelay.toFixed(1) + ' s' },
        { label: 'Larger text', icon: 'plus', keepOpen: true, onClick: () => { S.subSize = Math.min(48, S.subSize + 2); PV.pref.set('v.subsize', S.subSize); styleSub(); } },
        { label: 'Smaller text', icon: 'minus', keepOpen: true, onClick: () => { S.subSize = Math.max(12, S.subSize - 2); PV.pref.set('v.subsize', S.subSize); styleSub(); } },
        { label: 'Delay +0.5 s (later)', keepOpen: true, onClick: () => { S.subDelay += 0.5; showHud('Subtitle delay <b>' + S.subDelay.toFixed(1) + ' s</b>'); applySub(); } },
        { label: 'Delay −0.5 s (earlier)', keepOpen: true, onClick: () => { S.subDelay -= 0.5; showHud('Subtitle delay <b>' + S.subDelay.toFixed(1) + ' s</b>'); applySub(); } },
        { label: 'Background: ' + ['none', 'soft', 'solid'][S.subBg], onClick: () => { S.subBg = (S.subBg + 1) % 3; PV.pref.set('v.subbg', S.subBg); styleSub(); } });
      PV.menu(anchor, items);
    }
    function settingsMenu(anchor) {
      PV.menu(anchor, [{ header: 'Playback' },
        { label: 'Loop this video', icon: 'repeat', active: S.loop, onClick: () => { S.loop = !S.loop; video.loop = S.loop; } },
        ...(hasNav ? [{ label: 'Auto-play next video', icon: 'next', active: S.autonext, onClick: () => { S.autonext = !S.autonext; PV.pref.set('v.autonext', S.autonext); } }] : []),
        '-', { header: 'Picture' }, ...FITS.map(([id, label]) => ({ label, icon: 'ratio', active: S.fit === id, onClick: () => { S.fit = id; PV.pref.set('v.fit', id); fitStyle(); } })),
        { label: 'Reset brightness', icon: 'bright', onClick: () => { S.bright = 1; video.style.filter = ''; } },
        '-', { label: 'Save current frame', icon: 'camera', onClick: () => capture() },
        { label: 'Download video', icon: 'download', onClick: () => { const b = document.getElementById('download-file-btn'); b && b.click(); } }]);
    }

    /* ---- loop for smooth subtitle + seek updates ---- */
    let raf = 0;
    const frame = () => { raf = 0; applySub(); if (!video.paused) raf = requestAnimationFrame(frame); };
    video.addEventListener('play', () => { if (!raf) raf = requestAnimationFrame(frame); }); video.addEventListener('seeked', applySub); video.addEventListener('pause', applySub);

    /* ---- keyboard ---- */
    PV.setKeys((e) => {
      const k = e.key;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      showUI();
      if (k === ' ' || k === 'k') { e.preventDefault(); toggle(); }
      else if (k === 'ArrowRight') { e.preventDefault(); skip(e.shiftKey ? 10 : 5); flashAt('r', PV.ic('fwd10', 30)); }
      else if (k === 'ArrowLeft') { e.preventDefault(); skip(e.shiftKey ? -10 : -5); flashAt('l', PV.ic('back10', 30)); }
      else if (k === 'l') { skip(10); flashAt('r', PV.ic('fwd10', 30) + '<span>10 s</span>'); } else if (k === 'j') { skip(-10); flashAt('l', PV.ic('back10', 30) + '<span>10 s</span>'); }
      else if (k === 'ArrowUp') { e.preventDefault(); video.muted = false; video.volume = PV.clamp(video.volume + 0.05, 0, 1); showHud(PV.ic('vol', 20) + '<b>' + Math.round(video.volume * 100) + '%</b>'); PV.pref.set('v.vol', video.volume); }
      else if (k === 'ArrowDown') { e.preventDefault(); video.volume = PV.clamp(video.volume - 0.05, 0, 1); showHud(PV.ic('vol', 20) + '<b>' + Math.round(video.volume * 100) + '%</b>'); PV.pref.set('v.vol', video.volume); }
      else if (k === 'm') video.muted = !video.muted;
      else if (k === 'f') fullscreen();
      else if (k === 'c') { if (S.cues) { S.cues = null; ccBtn.classList.remove('on'); applySub(); showHud('Subtitles off'); } else if (subFiles[0]) loadSub(subFiles[0]); else PV.toast('No subtitle files in this pouch'); }
      else if (k === 'p') pip(); else if (k === 'N' && hasNav) nextBtn.click(); else if (k === 'P' && hasNav) prevBtn.click();
      else if (k === '>') { const i = SPEEDS.indexOf(video.playbackRate); setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, (i < 0 ? 3 : i) + 1)]); }
      else if (k === '<') { const i = SPEEDS.indexOf(video.playbackRate); setSpeed(SPEEDS[Math.max(0, (i < 0 ? 3 : i) - 1)]); }
      else if (k === '.' && video.paused) video.currentTime += 1 / 30; else if (k === ',' && video.paused) video.currentTime -= 1 / 30;
      else if (/^[0-9]$/.test(k) && isFinite(video.duration)) video.currentTime = (+k / 10) * video.duration;
      else if (k === 'Home') video.currentTime = 0; else if (k === 'End' && isFinite(video.duration)) video.currentTime = video.duration - 0.1;
    });
    PV.onDispose(() => {
      if (isFinite(video.duration) && video.currentTime > 3 && video.currentTime < video.duration - 10) PV.store.set(sk, { t: video.currentTime, d: video.duration });
      cancelAnimationFrame(raf); clearTimeout(S.uiTimer); clearTimeout(tapTimer); clearTimeout(holdTimer);
      document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('webkitfullscreenchange', onFs);
      if (PV.isFull()) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) { /* ignore */ } }
      if (document.pictureInPictureElement === video) { /* keep PiP running: element survives only while attached; leave it */ }
      video.pause(); video.removeAttribute('src'); video.load();
    });

    if (PV.audio && PV.audio.el && !PV.audio.el.paused) PV.audio.el.pause();
    fitStyle(); styleSub(); PV.setRange(volR, S.vol);
    video.src = url;
    if (matched.length) loadSub(matched[0]);
    upPlay(); showUI();
    video.play().catch(() => { upPlay(); });
  }

  PV.video = { render };
})();
