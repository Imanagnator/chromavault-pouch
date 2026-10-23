/* Pouch viewer runtime — Markdown renderer (GFM subset, XSS-safe) */
(function () {
  'use strict';
  const PV = window.PV;
  const esc = PV.esc;

  const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
  const safeUrl = (u) => (/^\s*(?:javascript|vbscript|data|file):/i.test(u) ? '#' : u);
  const isRemote = (u) => /^(?:https?:)?\/\//i.test(u);

  function render(src, opts) {
    opts = opts || {};
    src = src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
    const refs = {}, foots = {}, footOrder = [], toc = [], ids = {};
    let words = 0, meta = null;

    // front matter
    const fm = /^---\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(src);
    if (fm) { meta = fm[1]; src = src.slice(fm[0].length); }

    const stash = [];
    const hold = (html) => '\u0000' + (stash.push(html) - 1) + '\u0000';
    const unhold = (s) => { let n = 0; while (/\u0000\d+\u0000/.test(s) && n++ < 8) s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[+i]); return s; };

    function imgHtml(alt, url, title, w, h) {
      url = safeUrl(url);
      const a = esc(alt || ''), t = title ? ' title="' + esc(title) + '"' : '', dim = (w ? ' width="' + esc(w) + '"' : '') + (h ? ' height="' + esc(h) + '"' : '');
      if (isRemote(url)) return '<span class="pv-md-remote" data-src="' + esc(url) + '" data-alt="' + a + '"' + dim + ' role="button" tabindex="0">🖼 ' + (a || 'Remote image') + ' <em>— remote image blocked, tap to load</em></span>';
      if (/^data:image\//i.test(url)) return '<img src="' + esc(url) + '" alt="' + a + '"' + t + dim + ' loading="lazy">';
      return '<img data-pouch-src="' + esc(url) + '" alt="' + a + '"' + t + dim + '>';
    }
    function linkHtml(text, url, title) {
      url = safeUrl(url.trim());
      const t = title ? ' title="' + esc(title) + '"' : '';
      if (url[0] === '#') return '<a href="' + esc(url) + '"' + t + '>' + text + '</a>';
      if (/^(?:https?:|mailto:|tel:)/i.test(url)) return '<a href="' + esc(url) + '"' + t + ' target="_blank" rel="noopener noreferrer">' + text + '</a>';
      return '<a href="#" data-pouch-link="' + esc(url) + '"' + t + '>' + text + '</a>';
    }

    function inline(text) {
      // code spans
      text = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, __, c) => hold('<code>' + esc(c.replace(/^ (.*) $/, '$1')) + '</code>'));
      // whitelisted inline html
      text = text.replace(/<img\b([^>]*)>/gi, (_, at) => {
        const g = (n) => { const m = new RegExp('\\b' + n + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(at); return m ? (m[1] != null ? m[1] : m[2]) : ''; };
        return g('src') ? hold(imgHtml(g('alt'), g('src'), g('title'), g('width'), g('height'))) : '';
      });
      text = text.replace(/<(\/?)(br|kbd|sub|sup|b|i|u|mark|del|s|small|em|strong|details|summary|ins|abbr)\b[^>]*?(\/?)>/gi, (_, c, t, s) => hold('<' + c + t.toLowerCase() + (s && !c ? '/' : '') + '>'));
      text = text.replace(/<((?:https?:\/\/|mailto:)[^\s>]+)>/g, (_, u) => hold(linkHtml(esc(u), u)));
      text = esc(text);
      // footnote refs
      text = text.replace(/\[\^([^\]\s]+)\]/g, (m, id) => {
        if (!(id in foots) && !/\n\[\^/.test(src)) return m;
        if (footOrder.indexOf(id) < 0) footOrder.push(id);
        const n = footOrder.indexOf(id) + 1;
        return hold('<sup class="pv-fnref"><a href="#fn-' + esc(id) + '" id="fnref-' + esc(id) + '">' + n + '</a></sup>');
      });
      // images, links
      text = text.replace(/!\[([^\]]*)\]\(\s*(?:&lt;)?([^\s)]+?)(?:&gt;)?(?:\s+&quot;(.*?)&quot;)?\s*\)/g, (_, a, u, t) => hold(imgHtml(a.replace(/&amp;/g, '&').replace(/&quot;/g, '"'), u.replace(/&amp;/g, '&'), t)));
      text = text.replace(/\[((?:[^\[\]]|\[[^\]]*\])*)\]\(\s*(?:&lt;)?([^\s)]+?)(?:&gt;)?(?:\s+&quot;(.*?)&quot;)?\s*\)/g, (_, t, u, ti) => hold(linkHtml(inline2(t), u.replace(/&amp;/g, '&'), ti)));
      text = text.replace(/!\[([^\]]*)\]\[([^\]]*)\]/g, (m, a, r) => { const d = refs[(r || a).toLowerCase()]; return d ? hold(imgHtml(a, d.url, d.title)) : m; });
      text = text.replace(/\[((?:[^\[\]]|\[[^\]]*\])*)\]\[([^\]]*)\]/g, (m, t, r) => { const d = refs[(r || t).toLowerCase()]; return d ? hold(linkHtml(inline2(t), d.url, d.title)) : m; });
      text = text.replace(/\[([^\[\]]+)\](?!\()/g, (m, t) => { const d = refs[t.toLowerCase()]; return d ? hold(linkHtml(inline2(t), d.url, d.title)) : m; });
      // bare urls
      text = text.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g, (_, p, u) => p + hold(linkHtml(u, u.replace(/&amp;/g, '&'))));
      text = inline2(text);
      return unhold(text);
    }
    function inline2(t) {
      t = t.replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>');
      t = t.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
      t = t.replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>');
      t = t.replace(/(^|[^\w*])\*(?=[^\s*])([^*]*?[^\s*])\*(?!\w)/g, '$1<em>$2</em>');
      t = t.replace(/(^|[^\w_])_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>');
      t = t.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
      t = t.replace(/(?: {2,}|\\)\n/g, '<br>\n');
      return t;
    }

    const indentOf = (l) => /^ */.exec(l)[0].length;
    const RE = {
      fence: /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/,
      atx: /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/,
      hr: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
      quote: /^ {0,3}>/,
      item: /^( *)([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/,
      tdelim: /^ {0,3}\|?[ \t]*:?-{1,}:?[ \t]*(?:\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/,
      ref: /^ {0,3}\[([^\]^][^\]]*)\]:[ \t]*<?(\S+?)>?(?:[ \t]+["'(](.*?)["')])?[ \t]*$/,
      foot: /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/,
    };

    const splitRow = (l) => {
      l = l.trim().replace(/^\|/, '').replace(/\|$/, '');
      const cells = []; let cur = '', esc2 = false, code = false;
      for (const ch of l) {
        if (esc2) { cur += ch; esc2 = false; continue; }
        if (ch === '\\') { esc2 = true; cur += ch; continue; }
        if (ch === '`') code = !code;
        if (ch === '|' && !code) { cells.push(cur.trim()); cur = ''; } else cur += ch;
      }
      cells.push(cur.trim());
      return cells.map((c) => c.replace(/\\\|/g, '|'));
    };
    const isBlockStart = (l, nxt) => RE.fence.test(l) || RE.atx.test(l) || RE.hr.test(l) || RE.quote.test(l) || (RE.item.test(l) && /^( *)([-*+]|1[.)])[ \t]+\S/.test(l)) || (l.indexOf('|') >= 0 && nxt != null && RE.tdelim.test(nxt) && nxt.indexOf('-') >= 0 && nxt.indexOf('|') >= 0);

    function blocks(lines) {
      const out = [];
      let i = 0;
      while (i < lines.length) {
        let l = lines[i];
        if (!l.trim()) { i++; continue; }
        let m;
        if ((m = RE.fence.exec(l))) {
          const ind = indentOf(l), fch = m[1][0], flen = m[1].length, lang = m[2];
          const body = []; i++;
          while (i < lines.length && !new RegExp('^ {0,3}' + (fch === '`' ? '`' : '~') + '{' + flen + ',}[ \\t]*$').test(lines[i])) { body.push(lines[i].replace(new RegExp('^ {0,' + ind + '}'), '')); i++; }
          i++;
          out.push(codeBlock(body.join('\n'), lang));
          continue;
        }
        if ((m = RE.atx.exec(l))) {
          const level = m[1].length, raw = m[2];
          const html = inline(raw), plain = html.replace(/<[^>]+>/g, '');
          let id = slug(raw); if (ids[id] != null) id += '-' + (++ids[id]); else ids[id] = 0;
          toc.push({ level, text: plain.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"), id });
          words += plain.split(/\s+/).filter(Boolean).length;
          out.push('<h' + level + ' id="' + esc(id) + '"><a class="pv-anchor" href="#' + esc(id) + '" aria-hidden="true">#</a>' + html + '</h' + level + '>');
          i++; continue;
        }
        if (RE.hr.test(l)) { out.push('<hr>'); i++; continue; }
        if ((m = RE.foot.exec(l))) {
          const body = [m[2]]; i++;
          while (i < lines.length && (/^ {2,}\S/.test(lines[i]) || (!lines[i].trim() && /^ {2,}\S/.test(lines[i + 1] || '')))) { body.push(lines[i].replace(/^ {1,4}/, '')); i++; }
          foots[m[1]] = body.join('\n');
          continue;
        }
        if ((m = RE.ref.exec(l)) && !RE.item.test(l)) { refs[m[1].toLowerCase()] = { url: m[2], title: m[3] }; i++; continue; }
        if (RE.quote.test(l)) {
          const q = [];
          while (i < lines.length && lines[i].trim() && (RE.quote.test(lines[i]) || (q.length && !isBlockStart(lines[i], lines[i + 1])))) { q.push(lines[i].replace(/^ {0,3}> ?/, '')); i++; }
          let inner = blocks(q);
          inner = inner.replace(/^<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br>)?\n?/i, (_, k) => '<p class="pv-callout-title ' + k.toLowerCase() + '">' + k[0] + k.slice(1).toLowerCase() + '</p><p>');
          out.push('<blockquote' + (/pv-callout-title (\w+)/.test(inner) ? ' class="pv-callout ' + /pv-callout-title (\w+)/.exec(inner)[1] + '"' : '') + '>' + inner + '</blockquote>');
          continue;
        }
        if (RE.item.test(l) && (m = RE.item.exec(l))) { i = list(lines, i, out); continue; }
        if (l.indexOf('|') >= 0 && i + 1 < lines.length && RE.tdelim.test(lines[i + 1]) && lines[i + 1].indexOf('|') >= 0) {
          const head = splitRow(l), aligns = splitRow(lines[i + 1]).map((c) => (/^:-*:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : /^:-/.test(c) ? 'left' : ''));
          i += 2;
          const rows = [];
          while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') >= 0) { rows.push(splitRow(lines[i])); i++; }
          const cell = (tag, c, j) => '<' + tag + (aligns[j] ? ' style="text-align:' + aligns[j] + '"' : '') + '>' + inline(c) + '</' + tag + '>';
          words += head.length;
          out.push('<div class="pv-table-wrap"><table><thead><tr>' + head.map((c, j) => cell('th', c, j)).join('') + '</tr></thead><tbody>' +
            rows.map((r) => '<tr>' + head.map((_, j) => cell('td', r[j] || '', j)).join('') + '</tr>').join('') + '</tbody></table></div>');
          continue;
        }
        if (indentOf(l) >= 4 && !/^\s*$/.test(l)) {
          const code = [];
          while (i < lines.length && (indentOf(lines[i]) >= 4 || !lines[i].trim())) { code.push(lines[i].slice(4)); i++; }
          while (code.length && !code[code.length - 1].trim()) code.pop();
          out.push(codeBlock(code.join('\n'), ''));
          continue;
        }
        if (/^ {0,3}<(?:div|details|summary|p|table|center|h[1-6]|img|br|hr|figure|picture|video|a)\b/i.test(l)) {
          const html = [];
          while (i < lines.length && lines[i].trim()) { html.push(lines[i]); i++; }
          const j = html.join('\n');
          out.push('<p class="pv-rawhtml">' + inline(j) + '</p>');
          continue;
        }
        // paragraph (+ setext)
        const para = [l.replace(/^ +/, '')]; i++;
        let setext = 0;
        while (i < lines.length && lines[i].trim()) {
          if (/^ {0,3}=+[ \t]*$/.test(lines[i])) { setext = 1; i++; break; }
          if (/^ {0,3}-+[ \t]*$/.test(lines[i])) { setext = 2; i++; break; }
          if (isBlockStart(lines[i], lines[i + 1])) break;
          para.push(lines[i].replace(/^ +/, '')); i++;
        }
        const txt = para.join('\n');
        if (setext) {
          const html = inline(txt.replace(/\n/g, ' ')), plain = html.replace(/<[^>]+>/g, '');
          let id = slug(txt); if (ids[id] != null) id += '-' + (++ids[id]); else ids[id] = 0;
          toc.push({ level: setext, text: plain, id });
          out.push('<h' + setext + ' id="' + esc(id) + '"><a class="pv-anchor" href="#' + esc(id) + '" aria-hidden="true">#</a>' + html + '</h' + setext + '>');
        } else {
          words += txt.split(/\s+/).filter(Boolean).length;
          out.push('<p>' + inline(txt) + '</p>');
        }
      }
      return out.join('\n');
    }

    function list(lines, i, out) {
      const first = RE.item.exec(lines[i]);
      const base = first[1].length, ordered = /\d/.test(first[2]);
      const start = ordered ? parseInt(first[2], 10) : 1;
      const items = [];
      let loose = false;
      while (i < lines.length) {
        const m = RE.item.exec(lines[i]);
        if (!m || m[1].length !== base || /\d/.test(m[2]) !== ordered) break;
        const sp = m[3].length > 4 || !m[4].length ? 1 : m[3].length;
        const cIndent = base + m[2].length + sp;
        const body = [m[4]];
        i++;
        while (i < lines.length) {
          const x = lines[i];
          if (!x.trim()) {
            let j = i; while (j < lines.length && !lines[j].trim()) j++;
            if (j < lines.length && indentOf(lines[j]) >= Math.min(cIndent, base + 2) && indentOf(lines[j]) > base) { for (; i < j; i++) body.push(''); continue; }
            break;
          }
          const ind = indentOf(x);
          if (ind >= cIndent) { body.push(x.slice(cIndent)); i++; continue; }
          if (ind > base && RE.item.test(x)) { body.push(x.slice(ind)); i++; continue; }
          if (ind <= base && RE.item.test(x)) break;
          if (!isBlockStart(x, lines[i + 1]) && body[body.length - 1] !== '') { body.push(x.trim()); i++; continue; }
          break;
        }
        let j = i, blank = false;
        while (j < lines.length && !lines[j].trim()) { j++; blank = true; }
        if (blank && j < lines.length) {
          const n = RE.item.exec(lines[j]);
          if (n && n[1].length === base && /\d/.test(n[2]) === ordered) { loose = true; i = j; }
        }
        let task = null;
        const tm = /^\[([ xX])\][ \t]+/.exec(body[0]);
        if (tm) { task = tm[1] !== ' '; body[0] = body[0].slice(tm[0].length); }
        for (let b = 1; b < body.length - 1; b++) if (body[b] === '' && body[b + 1] !== '' && !/^ *([-*+]|\d+[.)])\s/.test(body[b + 1])) loose = true;
        items.push({ body, task });
      }
      const tag = ordered ? 'ol' : 'ul';
      const hasTask = items.some((x) => x.task !== null);
      let html = '<' + tag + (ordered && start !== 1 ? ' start="' + start + '"' : '') + (hasTask ? ' class="pv-tasks"' : '') + '>';
      for (const it of items) {
        let inner = blocks(it.body);
        if (!loose) inner = inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
        const cb = it.task === null ? '' : '<input type="checkbox" disabled' + (it.task ? ' checked' : '') + '> ';
        html += '<li' + (it.task !== null ? ' class="pv-task' + (it.task ? ' done' : '') + '"' : '') + '>' + cb + inner + '</li>';
      }
      out.push(html + '</' + tag + '>');
      return i;
    }

    function codeBlock(code, lang) {
      const id = (lang || '').toLowerCase();
      const map = { javascript: 'js', typescript: 'ts', python: 'py', py3: 'py', bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', yml: 'yaml', 'c++': 'cpp', 'c#': 'cs', csharp: 'cs', html: 'xml', jsx: 'js', tsx: 'ts', golang: 'go', rust: 'rs', rb: 'rb', ruby: 'rb', kotlin: 'kt', powershell: 'ps1', docker: 'make', dockerfile: 'make', makefile: 'make', plaintext: '', text: '', txt: '' };
      const lid = id in map ? map[id] : id;
      const body = opts.highlight && lid && (!PV.hl || PV.hl.supported(lid)) ? opts.highlight(code, lid) : esc(code);
      words += 0;
      return '<div class="pv-codeblock"><div class="pv-codehead"><span>' + esc(lang || 'text') + '</span><button type="button" class="pv-copy" aria-label="Copy code">Copy</button></div><pre><code>' + body + '</code></pre></div>';
    }

    const body = blocks(src.split('\n'));
    let foot = '';
    if (footOrder.length) {
      foot = '<section class="pv-footnotes"><hr><ol>' + footOrder.map((id) => '<li id="fn-' + esc(id) + '">' + inline(foots[id] || '') + ' <a href="#fnref-' + esc(id) + '" class="pv-fnback" aria-label="Back to reference">↩</a></li>').join('') + '</ol></section>';
    }
    return { html: body + foot, toc, meta, words };
  }

  function parseMeta(meta) {
    const rows = [];
    (meta || '').split('\n').forEach((l) => { const m = /^([\w.-]+):\s*(.*)$/.exec(l); if (m) rows.push([m[1], m[2].replace(/^["']|["']$/g, '')]); });
    return rows;
  }
  PV.md = { render, parseMeta };
})();
