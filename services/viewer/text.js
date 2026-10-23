/* Pouch viewer runtime — text / code / markdown / data viewer */
(function () {
  'use strict';
  const PV = window.PV, h = PV.h, esc = PV.esc;
  const MAX_BYTES = 40 * 1048576;
  const MAX_LINES = 60000;
  const CHUNK = 300;

  async function render(ctx) {
    const { meta, blob, root, kind } = ctx;
    const P = (k, d) => PV.pref.get('text.' + k, d);
    const lang = PV.langOf(meta.name);
    const prefs = {
      theme: P('theme', 'dark'), font: P('font', 'sans'), size: P('size', 15),
      wrap: P('wrap.' + (kind === 'text' || kind === 'md' ? 'r' : 'c'), kind === 'text' || kind === 'md'),
      nums: P('nums', true), wide: P('wide', false),
    };
    const st = { enc: null, text: '', truncated: false, mode: null, view: null, urls: [], io: [], toc: null, srcApi: null, jsonErr: null };

    // ---- load ----
    let buf;
    if (blob.size > MAX_BYTES) { buf = await blob.slice(0, MAX_BYTES).arrayBuffer(); st.truncated = true; }
    else buf = await blob.arrayBuffer();
    const decode = () => { const d = PV.decode(buf, st.enc); st.text = d.text; st.enc = d.encoding; st.lines = null; };
    decode();

    // ---- modes ----
    let jsonVal, jsonOk = false;
    if (kind === 'json') {
      try { if (blob.size < 8 * 1048576) { jsonVal = JSON.parse(st.text); jsonOk = true; } } catch (e) { st.jsonErr = e.message; }
    }
    let nbObj = null;
    if (kind === 'notebook') { try { nbObj = JSON.parse(st.text); } catch (e) { st.jsonErr = e.message; } }
    const MODES = {
      md: [['preview', 'Preview', 'eye'], ['source', 'Source', 'code']],
      html: [['preview', 'Preview', 'eye'], ['source', 'Source', 'code']],
      json: jsonOk ? [['tree', 'Tree', 'list'], ['source', 'Text', 'code']] : null,
      csv: [['table', 'Table', 'table'], ['source', 'Text', 'code']],
      notebook: nbObj ? [['nb', 'Notebook', 'eye'], ['source', 'JSON', 'code']] : null,
    }[kind] || null;
    st.mode = MODES ? MODES[0][0] : 'source';

    // ---- shell ----
    root.classList.add('pv-text');
    root.dataset.theme = prefs.theme;
    const body = h('div', { class: 'tx-body pv-scroll' });
    const main = h('div', { class: 'tx-main' }, body);
    const status = h('div', { class: 'tx-status' });
    const segEl = MODES ? h('div', { class: 'pv-seg' }) : null;
    const searchBtn = PV.btn('search', 'Find (Ctrl+F)', () => openSearch(), 'pv-btn-sm');
    const aaBtn = PV.btn('type', 'Appearance', () => appearanceMenu(aaBtn), 'pv-btn-sm');
    const wrapBtn = PV.btn('wrap', 'Toggle word wrap', () => { prefs.wrap = !prefs.wrap; PV.pref.set('wrap.' + (kind === 'text' || kind === 'md' ? 'r' : 'c'), prefs.wrap); applyPrefs(); }, 'pv-btn-sm');
    const moreBtn = PV.btn('more', 'More', () => moreMenu(moreBtn), 'pv-btn-sm');
    const bar = h('div', { class: 'pv-bar' }, segEl, h('span', { class: 'pv-grow' }), searchBtn, wrapBtn, aaBtn, moreBtn);
    const search = PV.createSearch(() => (st.view && st.view.searchRoot) || body, () => body);
    const sbar = PV.searchBar({
      onQuery: (q, o) => { if (st.srcApi && st.mode === 'source') st.srcApi.ensureAll(); if (st.view && st.view.beforeSearch) st.view.beforeSearch(); const n = search.find(q, o); sbar.setCount(search.index(), n); },
      onNext: () => { search.next(); sbar.setCount(search.index(), search.count()); },
      onPrev: () => { search.prev(); sbar.setCount(search.index(), search.count()); },
      onClose: () => { sbar.close(); search.clear(); },
    });
    root.appendChild(bar); root.appendChild(sbar.el); root.appendChild(main); root.appendChild(status);

    function openSearch() {
      if (st.mode === 'table') { const f = body.querySelector('.csv-filter'); if (f) { f.focus(); f.select(); } return; }
      sbar.open();
    }

    function applyPrefs() {
      root.dataset.theme = prefs.theme;
      root.style.setProperty('--fs', prefs.size + 'px');
      root.dataset.font = prefs.font;
      body.classList.toggle('wrap', prefs.wrap);
      body.classList.toggle('nonums', !prefs.nums);
      body.classList.toggle('wide', prefs.wide);
      wrapBtn.classList.toggle('on', prefs.wrap);
      wrapBtn.style.display = ['source'].includes(st.mode) || st.mode === 'tree' ? '' : 'none';
      searchBtn.style.display = st.mode === 'preview' && kind === 'html' ? 'none' : '';
      aaBtn.style.display = st.mode === 'preview' && kind === 'html' ? 'none' : '';
    }
    const setPref = (k, v, store) => { prefs[k] = v; PV.pref.set(store || k, v); applyPrefs(); };

    function appearanceMenu(anchor) {
      const items = [{ header: 'Theme' }];
      [['dark', 'Dark', 'moon'], ['light', 'Light', 'sun'], ['sepia', 'Sepia', 'eye']].forEach(([id, label, icon]) => items.push({ label, icon, active: prefs.theme === id, onClick: () => setPref('theme', id) }));
      if (kind === 'text' || kind === 'md' || kind === 'notebook') {
        items.push('-', { header: 'Font' });
        [['sans', 'Sans-serif'], ['serif', 'Serif'], ['mono', 'Monospace']].forEach(([id, label]) => items.push({ label, active: prefs.font === id, onClick: () => setPref('font', id) }));
      }
      items.push('-', { header: 'Text size · ' + prefs.size + ' px' },
        { label: 'Larger', icon: 'plus', keepOpen: true, onClick: () => { setPref('size', Math.min(30, prefs.size + 1)); PV.toast('Text size ' + prefs.size); } },
        { label: 'Smaller', icon: 'minus', keepOpen: true, onClick: () => { setPref('size', Math.max(10, prefs.size - 1)); PV.toast('Text size ' + prefs.size); } },
        { label: 'Reset', onClick: () => setPref('size', 15) });
      if (st.mode === 'source') items.push('-', { label: 'Line numbers', icon: 'hash', active: prefs.nums, onClick: () => setPref('nums', !prefs.nums) });
      if (st.mode === 'preview' && kind === 'md') items.push('-', { label: 'Wide layout', icon: 'fit', active: prefs.wide, onClick: () => setPref('wide', !prefs.wide) });
      PV.menu(anchor, items);
    }

    function moreMenu(anchor) {
      const items = [];
      if (st.mode === 'source') items.push({ label: 'Go to line…', icon: 'hash', onClick: () => gotoLine() });
      if (st.mode === 'tree' && st.view) items.push({ label: 'Expand all', icon: 'down', onClick: () => st.view.tree.expandAll() }, { label: 'Collapse all', icon: 'up', onClick: () => st.view.tree.collapseAll() });
      if (st.mode === 'preview' && kind === 'md' && st.toc && st.toc.length > 1) items.push({ label: 'Outline', icon: 'list', onClick: () => toggleToc() });
      if (kind === 'json' && jsonOk && st.mode === 'source') items.push({ label: st.fmt === 'min' ? 'Pretty-print' : 'Minify', icon: 'code', onClick: () => { st.fmt = st.fmt === 'min' ? 'pretty' : 'min'; st.lines = null; show('source'); } });
      items.push({ label: 'Copy all text', icon: 'copy', onClick: () => copy(st.text, 'Copied') },
        { label: 'Encoding · ' + (st.enc || '').toUpperCase(), icon: 'type', onClick: () => setTimeout(() => encodingMenu(anchor), 0) },
        '-', { label: 'Download', icon: 'download', onClick: () => { const b = document.getElementById('download-file-btn'); b && b.click(); } });
      PV.menu(anchor, items);
    }
    function encodingMenu(anchor) {
      PV.menu(anchor, [{ header: 'Text encoding' }].concat(PV.ENCODINGS.map(([id, label]) => ({ label, active: st.enc === id, onClick: () => { st.enc = id; decode(); show(st.mode); } }))));
    }
    function copy(text, msg) {
      const done = () => PV.toast(msg || 'Copied');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fallback());
      else fallback();
      function fallback() { const t = h('textarea', { style: { position: 'fixed', opacity: '0' } }); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) { PV.toast('Copy failed'); } t.remove(); }
    }
    function gotoLine() {
      const total = st.srcApi ? st.srcApi.count : 0;
      const v = window.prompt('Go to line (1–' + total + ')');
      const n = parseInt(v, 10);
      if (n > 0 && st.srcApi) st.srcApi.goto(Math.min(n, total));
    }

    // ---- views ----
    function cleanupView() {
      if (st.view && st.view.destroy) st.view.destroy();
      st.io.forEach((o) => o.disconnect()); st.io = [];
      st.view = null; st.srcApi = null;
      search.clear(); if (sbar.isOpen()) sbar.setCount(0, 0);
      body.innerHTML = ''; main.querySelectorAll('.tx-toc').forEach((n) => n.remove());
      body.onscroll = null; body.classList.remove('is-md', 'is-src', 'is-frame', 'is-csv', 'is-tree');
      const pr = main.querySelector('.tx-progress'); if (pr) pr.remove();
    }

    function show(mode) {
      cleanupView();
      st.mode = mode;
      if (mode === 'source') viewSource();
      else if (mode === 'preview' && kind === 'md') viewMarkdown();
      else if (mode === 'preview' && kind === 'html') viewHtml();
      else if (mode === 'tree') viewTree();
      else if (mode === 'table') viewCsv();
      else if (mode === 'nb') viewNotebook();
      if (segEl) [...segEl.children].forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
      applyPrefs();
      updateStatus();
      if (sbar.isOpen() && sbar.input.value) sbar.rerun();
    }

    function sourceLines() {
      if (st.lines) return st.lines;
      let text = st.text;
      if (kind === 'json' && jsonOk && st.mode === 'source') {
        try { if (st.fmt === 'min') text = JSON.stringify(jsonVal); else if (st.fmt === 'pretty' || (text.length > 200 && text.split('\n').length < 4)) { text = JSON.stringify(jsonVal, null, 2); st.fmt = st.fmt || 'pretty'; } } catch (e) { /* keep */ }
      }
      let lines = PV.hl.lines(text, lang.id);
      if (lines.length > MAX_LINES) { st.truncated = true; lines = lines.slice(0, MAX_LINES); }
      st.lines = lines;
      return lines;
    }

    function viewSource() {
      body.classList.add('is-src');
      const lines = sourceLines();
      const digits = String(lines.length).length;
      const wrapEl = h('div', { class: 'pv-src', style: { '--gw': 'calc(' + digits + 'ch + 26px)' } });
      body.appendChild(wrapEl);
      let rendered = 0;
      const chunkHtml = (from, to) => {
        let s = '';
        for (let i = from; i < to; i++) s += '<div class="ln" data-n="' + (i + 1) + '"><span class="tx">' + lines[i] + '</span></div>';
        return '<div class="chunk" data-from="' + from + '">' + s + '</div>';
      };
      let sentinel = null;
      const io = new IntersectionObserver((en) => { if (en.some((x) => x.isIntersecting)) renderMore(); }, { root: body, rootMargin: '1500px' });
      st.io.push(io);
      function renderMore(n) {
        if (rendered >= lines.length) return;
        const to = Math.min(lines.length, rendered + (n || CHUNK * 2));
        if (sentinel) { io.unobserve(sentinel); sentinel.remove(); sentinel = null; }
        let s = '';
        for (let f = rendered; f < to; f += CHUNK) s += chunkHtml(f, Math.min(to, f + CHUNK));
        wrapEl.insertAdjacentHTML('beforeend', s);
        rendered = to;
        if (rendered < lines.length) { sentinel = h('div', { class: 'tx-sentinel' }); wrapEl.appendChild(sentinel); io.observe(sentinel); }
      }
      renderMore(CHUNK * 3);
      st.srcApi = {
        count: lines.length,
        ensureAll() { if (rendered < lines.length) { renderMore(lines.length); if (sbar.isOpen() && sbar.input.value) setTimeout(() => search.refresh(), 0); } },
        goto(n) {
          if (n > rendered) renderMore(n - rendered + CHUNK);
          const el = wrapEl.querySelector('.ln[data-n="' + n + '"]');
          if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); }
        },
      };
      st.view = { searchRoot: wrapEl };
      if (st.truncated) wrapEl.insertAdjacentHTML('afterbegin', '<div class="tx-note">Large file — showing the first part only. Download to see everything.</div>');
    }

    function mdOpts() { return { highlight: (c, l) => PV.hl.html(c, l) }; }
    function hydrateImages(container) {
      container.querySelectorAll('img[data-pouch-src]').forEach(async (img) => {
        const f = PV.findByName(img.getAttribute('data-pouch-src'));
        if (!f) { const s = h('span', { class: 'pv-md-remote missing', text: '🖼 ' + (img.alt || img.getAttribute('data-pouch-src')) + ' — not found in this pouch' }); img.replaceWith(s); return; }
        try { const b = await PV.blobOf(f); const u = URL.createObjectURL(b); st.urls.push(u); img.src = u; img.classList.add('loaded'); } catch (e) { img.alt = 'Could not load ' + f.name; }
      });
    }
    function wireArticle(article, scroller) {
      article.addEventListener('click', (e) => {
        const cp = e.target.closest('.pv-copy');
        if (cp) { const code = cp.closest('.pv-codeblock').querySelector('code'); copy(code.textContent, 'Code copied'); cp.textContent = 'Copied'; setTimeout(() => (cp.textContent = 'Copy'), 1400); return; }
        const rem = e.target.closest('.pv-md-remote[data-src]');
        if (rem) { const im = h('img', { src: rem.dataset.src, alt: rem.dataset.alt || '', loading: 'lazy', referrerpolicy: 'no-referrer' }); rem.replaceWith(im); return; }
        const pl = e.target.closest('a[data-pouch-link]');
        if (pl) {
          e.preventDefault();
          const raw = pl.getAttribute('data-pouch-link'); const f = PV.findByName(raw);
          if (f) { const el = [...document.querySelectorAll('.file-item')].find((x) => x.getAttribute('aria-label') === f.name); if (el) el.click(); }
          else PV.toast('"' + raw + '" is not in this pouch');
          return;
        }
        const a = e.target.closest('a[href^="#"]');
        if (a) {
          e.preventDefault();
          const id = decodeURIComponent(a.getAttribute('href').slice(1));
          const t = article.querySelector('[id="' + id.replace(/"/g, '\\"') + '"]');
          if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }

    function viewMarkdown() {
      body.classList.add('is-md');
      const r = PV.md.render(st.text, mdOpts());
      st.toc = r.toc; st.words = r.words;
      const article = h('article', { class: 'pv-md pv-reading' });
      let fm = '';
      if (r.meta) {
        const rows = PV.md.parseMeta(r.meta);
        if (rows.length) fm = '<details class="pv-fm"><summary>Document properties</summary><table>' + rows.map(([k, v]) => '<tr><th>' + esc(k) + '</th><td>' + esc(v) + '</td></tr>').join('') + '</table></details>';
      }
      article.innerHTML = fm + r.html;
      body.appendChild(article);
      hydrateImages(article); wireArticle(article, body);
      st.view = { searchRoot: article };
      const prog = h('div', { class: 'tx-progress' }, h('i'));
      main.appendChild(prog);
      const spy = () => {
        const max = body.scrollHeight - body.clientHeight;
        prog.firstChild.style.width = (max > 0 ? (body.scrollTop / max) * 100 : 0) + '%';
        if (st.tocEl) {
          let cur = null;
          for (const hd of article.querySelectorAll('h1,h2,h3,h4,h5,h6')) { if (hd.offsetTop - body.scrollTop <= 90) cur = hd.id; else break; }
          st.tocEl.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.id === cur));
        }
      };
      let raf = 0;
      body.onscroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; spy(); }); };
      st.tocEl = null;
      if (r.toc.length > 1) {
        const aside = h('aside', { class: 'tx-toc pv-scroll' + (innerWidth >= 1000 ? ' open' : '') },
          h('div', { class: 'tx-toc-title' }, h('span', { text: 'Outline' }), PV.btn('close', 'Close outline', () => aside.classList.remove('open'), 'pv-btn-sm')),
          r.toc.map((t) => h('a', { href: '#' + t.id, 'data-id': t.id, style: { paddingLeft: 12 + (t.level - 1) * 12 + 'px' }, text: t.text, onclick: (e) => { e.preventDefault(); const el = article.querySelector('[id="' + t.id + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); if (innerWidth < 1000) aside.classList.remove('open'); } })));
        main.insertBefore(aside, body);
        st.tocEl = aside;
      }
      spy();
    }
    function toggleToc() { if (st.tocEl) st.tocEl.classList.toggle('open'); }

    function viewHtml() {
      body.classList.add('is-frame');
      const f = h('iframe', { class: 'tx-frame', title: meta.name, sandbox: 'allow-scripts allow-downloads allow-forms allow-modals allow-popups' });
      f.src = ctx.url;
      body.appendChild(f);
      st.view = { searchRoot: null };
    }

    function viewTree() {
      body.classList.add('is-tree');
      const pathBar = h('div', { class: 'jt-path', text: '$' });
      const tree = PV.fmt.jsonTree(jsonVal, { onPath: (p) => { pathBar.textContent = p; } });
      const wrap = h('div', { class: 'jt-wrap' }, tree.el);
      body.appendChild(wrap);
      pathBar.title = 'Tap to copy path';
      pathBar.onclick = () => copy(pathBar.textContent, 'Path copied');
      main.appendChild(pathBar);
      st.view = { tree, searchRoot: wrap, beforeSearch: () => { if (tree.canExpandAll()) tree.expandAll(); }, destroy: () => pathBar.remove() };
    }

    function viewCsv() {
      body.classList.add('is-csv');
      const v = PV.fmt.csvView(st.text, meta.name, { onChange: updateStatus });
      body.appendChild(v.el);
      st.view = { csv: v, searchRoot: v.el, destroy: () => v.destroy() };
    }

    function viewNotebook() {
      const article = h('article', { class: 'pv-md pv-reading nb-article' });
      article.innerHTML = PV.fmt.notebookHtml(nbObj, mdOpts());
      body.appendChild(article);
      body.classList.add('is-md');
      wireArticle(article, body);
      st.view = { searchRoot: article };
    }

    // ---- status ----
    function updateStatus() {
      const parts = [];
      parts.push([kind === 'text' ? 'Plain text' : kind === 'md' ? 'Markdown' : kind === 'csv' ? 'CSV' : kind === 'html' ? 'HTML' : kind === 'notebook' ? 'Notebook' : lang.label, '']);
      if (st.mode === 'source') parts.push([String((st.lines || sourceLines()).length.toLocaleString()), 'lines']);
      const words = st.words != null && st.mode === 'preview' ? st.words : (kind === 'text' || kind === 'md') ? (st.text.match(/\S+/g) || []).length : null;
      if (words != null) { parts.push([words.toLocaleString(), 'words']); if (words > 120) parts.push(['~' + Math.max(1, Math.round(words / 220)) + ' min', 'read']); }
      parts.push([PV.fmtSize(meta.size), '']);
      status.innerHTML = '';
      parts.forEach(([a, b], i) => { if (i) status.appendChild(h('span', { class: 'dot', text: '·' })); status.appendChild(h('span', {}, h('b', { text: a }), b ? ' ' + b : '')); });
      const enc = h('button', { class: 'tx-enc', type: 'button', text: (st.enc || '').toUpperCase(), title: 'Change encoding', onclick: () => encodingMenu(enc) });
      status.appendChild(h('span', { class: 'pv-grow' })); status.appendChild(enc);
    }

    // ---- mode switch ----
    if (MODES) MODES.forEach(([id, label, icon]) => segEl.appendChild(h('button', { type: 'button', 'data-m': id, html: PV.ic(icon, 14) + '<span>' + label + '</span>', onclick: () => { if (st.mode !== id) show(id); } })));
    if (st.jsonErr && (kind === 'json' || kind === 'notebook')) {
      body.dataset.err = st.jsonErr;
    }

    PV.setKeys((e, typing) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') { if (sbar.isOpen()) { sbar.close(); search.clear(); } else if (st.tocEl && innerWidth < 1000) st.tocEl.classList.remove('open'); return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); openSearch(); }
      else if (e.key === '/' && !mod) { e.preventDefault(); openSearch(); }
      else if (mod && e.key.toLowerCase() === 'g' && st.mode === 'source') { e.preventDefault(); gotoLine(); }
      else if (e.key === 'F3') { e.preventDefault(); e.shiftKey ? search.prev() : search.next(); }
      else if ((e.key === '+' || e.key === '=') && !mod) { setPref('size', Math.min(30, prefs.size + 1)); }
      else if (e.key === '-' && !mod) { setPref('size', Math.max(10, prefs.size - 1)); }
    });
    PV.onDispose(() => { cleanupView(); st.urls.forEach((u) => URL.revokeObjectURL(u)); });

    show(st.mode);
    if (st.jsonErr && (kind === 'json' || kind === 'notebook')) PV.toast('Not valid ' + (kind === 'json' ? 'JSON' : 'notebook') + ': showing as text', 2800);
  }

  PV.text = { render };
})();
