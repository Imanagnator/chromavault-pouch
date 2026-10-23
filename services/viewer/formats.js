/* Pouch viewer runtime — structured formats: JSON tree, CSV/TSV table, Jupyter notebook */
(function () {
  'use strict';
  const PV = window.PV, h = PV.h, esc = PV.esc;

  /* ===================== JSON tree ===================== */
  const IDENT = /^[A-Za-z_$][\w$]*$/;
  const PAGE = 100;

  function countNodes(v, cap) {
    let n = 0;
    (function walk(x) { if (n > cap) return; n++; if (x && typeof x === 'object') for (const k in x) walk(x[k]); })(v);
    return n;
  }

  function jsonTree(value, opts) {
    opts = opts || {};
    const state = { budget: 20000, onPath: opts.onPath || (() => {}) };
    const root = h('div', { class: 'jt' });

    function node(key, val, path, isIdx) {
      const isObj = val !== null && typeof val === 'object';
      const el = h('div', { class: 'jt-node' });
      const row = h('div', { class: 'jt-row', tabindex: '-1' });
      el.appendChild(row);
      const self = { el, expand() {}, collapse() {}, kids: [] };
      const caret = h('span', { class: 'jt-caret' + (isObj ? '' : ' none'), html: isObj ? PV.ic('right', 12) : '' });
      row.appendChild(caret);
      if (key != null) row.appendChild(h('span', { class: isIdx ? 'jt-idx' : 'jt-key', text: isIdx ? String(key) : JSON.stringify(key) }));
      if (key != null) row.appendChild(h('span', { class: 'jt-colon', text: isIdx ? '  ' : ': ' }));
      if (!isObj) {
        let cls = 'jt-null', txt = 'null';
        if (typeof val === 'string') { cls = 'jt-str'; txt = JSON.stringify(val); }
        else if (typeof val === 'number') { cls = 'jt-num'; txt = String(val); }
        else if (typeof val === 'boolean') { cls = 'jt-bool'; txt = String(val); }
        const long = txt.length > 400;
        const vs = h('span', { class: 'jt-val ' + cls, text: long ? txt.slice(0, 400) + '…' : txt });
        if (long) { vs.classList.add('jt-long'); vs.title = 'Tap to expand'; vs.addEventListener('click', (e) => { e.stopPropagation(); vs.textContent = vs.textContent.endsWith('…') ? txt : txt.slice(0, 400) + '…'; }); }
        row.appendChild(vs);
        row.addEventListener('click', () => state.onPath(path));
        return self;
      }
      const isArr = Array.isArray(val);
      const keys = isArr ? null : Object.keys(val);
      const total = isArr ? val.length : keys.length;
      row.appendChild(h('span', { class: 'jt-br', text: isArr ? '[' : '{' }));
      const sum = h('span', { class: 'jt-sum', text: total ? '… ' + total + (isArr ? ' item' : ' key') + (total === 1 ? '' : 's') : '' });
      row.appendChild(sum);
      const inlineClose = h('span', { class: 'jt-br', text: isArr ? ']' : '}' });
      if (!total) { row.appendChild(inlineClose); caret.classList.add('none'); caret.innerHTML = ''; row.addEventListener('click', () => state.onPath(path)); return self; }
      row.appendChild(inlineClose);
      const kidsBox = h('div', { class: 'jt-kids pv-hidden' });
      const tail = h('div', { class: 'jt-close pv-hidden', text: isArr ? ']' : '}' });
      el.appendChild(kidsBox); el.appendChild(tail);
      let rendered = 0, more = null, open = false;
      const childPath = (k) => path + (isArr ? '[' + k + ']' : IDENT.test(k) ? '.' + k : '[' + JSON.stringify(k) + ']');
      function renderMore(n) {
        const end = Math.min(total, rendered + n);
        for (; rendered < end && state.budget > 0; rendered++) {
          const k = isArr ? rendered : keys[rendered];
          const kn = node(k, val[k], childPath(k), isArr);
          self.kids.push(kn);
          kidsBox.insertBefore(kn.el, more);
          state.budget--;
        }
        if (rendered < total) {
          if (!more) { more = h('button', { class: 'jt-more', type: 'button', onclick: (e) => { e.stopPropagation(); renderMore(PAGE); } }); kidsBox.appendChild(more); }
          more.textContent = 'Show ' + Math.min(PAGE, total - rendered) + ' more (' + (total - rendered) + ' remaining)';
        } else if (more) { more.remove(); more = null; }
      }
      self.expand = (depth) => {
        if (!open) {
          open = true;
          if (!rendered) renderMore(PAGE);
          kidsBox.classList.remove('pv-hidden'); tail.classList.remove('pv-hidden');
          sum.classList.add('pv-hidden'); inlineClose.classList.add('pv-hidden'); caret.classList.add('open');
        }
        if (depth > 0) {
          if (depth > 1 && rendered < total) renderMore(total - rendered);
          self.kids.forEach((k) => k.expand(depth - 1));
        }
      };
      self.collapse = () => {
        if (open) { open = false; kidsBox.classList.add('pv-hidden'); tail.classList.add('pv-hidden'); sum.classList.remove('pv-hidden'); inlineClose.classList.remove('pv-hidden'); caret.classList.remove('open'); }
        self.kids.forEach((k) => k.collapse());
      };
      self.isOpen = () => open;
      row.addEventListener('click', () => { state.onPath(path); open ? self.collapse() : self.expand(0); });
      return self;
    }
    const top = node(null, value, '$', false);
    root.appendChild(top.el);
    const small = countNodes(value, 400) <= 400;
    top.expand ? top.expand(small ? 3 : 1) : 0;
    return {
      el: root,
      expandAll() { state.budget = 20000; top.expand(Infinity); if (state.budget <= 0) PV.toast('Very large — expanded the first 20,000 nodes'); },
      collapseAll() { top.collapse(); top.expand(0); },
      canExpandAll: () => countNodes(value, 20000) <= 20000,
    };
  }

  /* ===================== CSV / TSV ===================== */
  function parseCSV(text, delim) {
    const rows = [];
    let row = [], cell = '', inQ = false, i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } inQ = false; i++; continue; }
        cell += c; i++; continue;
      }
      if (c === '"' && cell === '') { inQ = true; i++; continue; }
      if (c === delim) { row.push(cell); cell = ''; i++; continue; }
      if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; rows.push(row); row = []; i++; continue; }
      cell += c; i++;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function detectDelim(text, name) {
    if (/\.tsv$/i.test(name)) return '\t';
    const lines = text.slice(0, 20000).split(/\r?\n/).filter(Boolean).slice(0, 12);
    let best = ',', score = -1;
    for (const d of [',', ';', '\t', '|']) {
      const counts = lines.map((l) => l.split(d).length - 1);
      const min = Math.min.apply(null, counts.length ? counts : [0]);
      if (min > score) { score = min; best = d; }
    }
    return best;
  }

  function csvView(text, name, opts) {
    opts = opts || {};
    let delim = detectDelim(text, name);
    let rows = parseCSV(text, delim), header = true, wrap = false, sortCol = -1, sortDir = 1, query = '';
    let order = [], shown = 0;
    const root = h('div', { class: 'csv' });
    const filter = h('input', { class: 'pv-input csv-filter', type: 'search', placeholder: 'Filter rows…', 'aria-label': 'Filter rows' });
    const count = h('span', { class: 'pv-label' });
    const hdrChip = h('button', { class: 'pv-chip on', type: 'button', onclick: () => { header = !header; hdrChip.classList.toggle('on', header); sortCol = -1; rebuild(); } }, 'Header row');
    const wrapChip = h('button', { class: 'pv-chip', type: 'button', onclick: () => { wrap = !wrap; wrapChip.classList.toggle('on', wrap); tableWrap.classList.toggle('wrap', wrap); } }, 'Wrap');
    const delimBtn = h('button', { class: 'pv-chip', type: 'button' });
    const DN = { ',': 'Comma', ';': 'Semicolon', '\t': 'Tab', '|': 'Pipe' };
    const upDelim = () => { delimBtn.textContent = 'Delimiter: ' + DN[delim]; };
    delimBtn.onclick = () => PV.menu(delimBtn, Object.keys(DN).map((d) => ({ label: DN[d], active: d === delim, onClick: () => { delim = d; rows = parseCSV(text, delim); sortCol = -1; upDelim(); rebuild(); } })));
    upDelim();
    const sub = h('div', { class: 'csv-bar' }, filter, count, h('span', { class: 'pv-grow' }), hdrChip, wrapChip, delimBtn);
    const tableWrap = h('div', { class: 'csv-wrap pv-scroll' });
    root.appendChild(sub); root.appendChild(tableWrap);
    let io = null;

    const body = () => (header ? rows.slice(1) : rows);
    const cols = () => rows.reduce((m, r) => Math.max(m, r.length), 0);
    const num = (s) => { const t = String(s).replace(/[,\s%$€£]/g, ''); return t !== '' && /^-?\d*\.?\d+(?:e[+-]?\d+)?$/i.test(t) ? parseFloat(t) : NaN; };

    function computeOrder() {
      const b = body();
      let idx = [];
      const q = query.toLowerCase();
      for (let i = 0; i < b.length; i++) if (!q || b[i].some((c) => c.toLowerCase().indexOf(q) >= 0)) idx.push(i);
      if (sortCol >= 0) {
        let nums = 0, tot = 0;
        for (const i of idx.slice(0, 300)) { const v = b[i][sortCol]; if (v !== undefined && v !== '') { tot++; if (!isNaN(num(v))) nums++; } }
        const numeric = tot && nums / tot > 0.8;
        const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        idx.sort((a, c) => {
          const x = b[a][sortCol] || '', y = b[c][sortCol] || '';
          const r = numeric ? ((isNaN(num(x)) ? -Infinity : num(x)) - (isNaN(num(y)) ? -Infinity : num(y))) : coll.compare(x, y);
          return (r || a - c) * sortDir;
        });
      }
      order = idx;
    }
    function rebuild() {
      computeOrder();
      const b = body(), nc = cols();
      let html = '<table class="csv-table"><thead><tr><th class="rn">#</th>';
      for (let c = 0; c < nc; c++) {
        const label = header ? (rows[0][c] || 'Column ' + (c + 1)) : 'Col ' + (c + 1);
        html += '<th data-c="' + c + '" class="' + (sortCol === c ? 'sorted' : '') + '" title="Sort by this column">' + esc(label) + '<span class="sort">' + (sortCol === c ? (sortDir > 0 ? '▲' : '▼') : '') + '</span></th>';
      }
      html += '</tr></thead><tbody></tbody></table>';
      tableWrap.innerHTML = html;
      shown = 0;
      count.textContent = order.length.toLocaleString() + (query ? ' of ' + b.length.toLocaleString() : '') + ' rows × ' + nc + ' cols';
      tableWrap.querySelector('thead').onclick = (e) => {
        const th = e.target.closest('th[data-c]'); if (!th) return;
        const c = +th.dataset.c;
        if (sortCol === c) { if (sortDir === 1) sortDir = -1; else { sortCol = -1; sortDir = 1; } } else { sortCol = c; sortDir = 1; }
        rebuild();
      };
      tableWrap.querySelector('tbody').onclick = (e) => { const td = e.target.closest('td:not(.rn)'); if (td && navigator.clipboard) navigator.clipboard.writeText(td.textContent).then(() => PV.toast('Cell copied')).catch(() => {}); };
      if (io) io.disconnect();
      more();
      opts.onChange && opts.onChange();
    }
    function more() {
      const tb = tableWrap.querySelector('tbody'); if (!tb) return;
      const b = body(), nc = cols();
      const end = Math.min(order.length, shown + 200);
      let html = '';
      for (; shown < end; shown++) {
        const i = order[shown], r = b[i];
        html += '<tr><td class="rn">' + (i + 1) + '</td>';
        for (let c = 0; c < nc; c++) html += '<td>' + esc(r[c] == null ? '' : r[c]) + '</td>';
        html += '</tr>';
      }
      const old = tb.querySelector('.sentinel'); if (old) old.remove();
      tb.insertAdjacentHTML('beforeend', html);
      if (shown < order.length) {
        const s = document.createElement('tr'); s.className = 'sentinel'; s.innerHTML = '<td colspan="' + (nc + 1) + '" class="csv-more">Loading more rows…</td>'; tb.appendChild(s);
        if (io) io.disconnect();
        io = new IntersectionObserver((en) => { if (en.some((x) => x.isIntersecting)) more(); }, { root: tableWrap, rootMargin: '400px' });
        io.observe(s);
      }
    }
    let ft;
    filter.addEventListener('input', () => { clearTimeout(ft); ft = setTimeout(() => { query = filter.value.trim(); rebuild(); }, 160); });
    rebuild();
    return { el: root, destroy() { if (io) io.disconnect(); }, stats: () => ({ rows: rows.length, cols: cols() }) };
  }

  /* ===================== Notebook ===================== */
  function notebookHtml(nb, mdOpts) {
    const lang = (nb.metadata && ((nb.metadata.kernelspec && nb.metadata.kernelspec.language) || (nb.metadata.language_info && nb.metadata.language_info.name))) || 'python';
    const join = (s) => (Array.isArray(s) ? s.join('') : s || '');
    const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const cells = nb.cells || (nb.worksheets && nb.worksheets[0] && nb.worksheets[0].cells) || [];
    let out = '<div class="pv-nb">';
    for (const c of cells) {
      const src = join(c.source != null ? c.source : c.input);
      if (c.cell_type === 'markdown') out += '<div class="nb-cell nb-md pv-md-body">' + PV.md.render(src, mdOpts).html + '</div>';
      else if (c.cell_type === 'code') {
        const n = c.execution_count != null ? c.execution_count : c.prompt_number;
        out += '<div class="nb-cell nb-code"><div class="nb-in"><span class="nb-prompt">In [' + (n == null ? ' ' : n) + ']:</span><pre class="nb-src"><code>' + PV.hl.html(src, lang === 'python' ? 'py' : lang === 'javascript' ? 'js' : 'plain') + '</code></pre></div>';
        for (const o of c.outputs || []) {
          if (o.output_type === 'stream') out += '<pre class="nb-out">' + esc(strip(join(o.text))) + '</pre>';
          else if (o.output_type === 'error') out += '<pre class="nb-out nb-err">' + esc(strip((o.traceback || []).join('\n') || o.ename + ': ' + o.evalue)) + '</pre>';
          else if (o.data) {
            if (o.data['image/png']) out += '<img class="nb-img" alt="output" src="data:image/png;base64,' + esc(join(o.data['image/png']).replace(/\s/g, '')) + '">';
            else if (o.data['image/jpeg']) out += '<img class="nb-img" alt="output" src="data:image/jpeg;base64,' + esc(join(o.data['image/jpeg']).replace(/\s/g, '')) + '">';
            else if (o.data['text/markdown']) out += '<div class="nb-out pv-md-body">' + PV.md.render(join(o.data['text/markdown']), mdOpts).html + '</div>';
            else if (o.data['text/plain']) out += '<pre class="nb-out">' + esc(strip(join(o.data['text/plain']))) + '</pre>';
          }
        }
        out += '</div>';
      } else if (c.cell_type === 'raw') out += '<pre class="nb-cell nb-raw">' + esc(src) + '</pre>';
    }
    return out + '</div>';
  }

  PV.fmt = { jsonTree, parseCSV, csvView, detectDelim, notebookHtml };
})();
