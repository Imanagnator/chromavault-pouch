/* Pouch viewer runtime — dependency-free syntax highlighter */
(function () {
  'use strict';
  const PV = window.PV;
  const esc = PV.esc;
  const S = (s) => new Set(s.split(' '));
  const R = String.raw;

  const DQ = R`"(?:\\[\s\S]|[^"\\\n])*"?`;
  const SQ = R`'(?:\\[\s\S]|[^'\\\n])*'?`;
  const BT = R`\`(?:\\[\s\S]|[^\`\\])*\`?`;
  const TDQ = R`"""[\s\S]*?(?:"""|(?![\s\S]))`;
  const TSQ = R`'''[\s\S]*?(?:'''|(?![\s\S]))`;
  const CLINE = R`\/\/[^\n]*`;
  const CBLOCK = R`\/\*[\s\S]*?(?:\*\/|(?![\s\S]))`;
  const HASH = R`#[^\n]*`;
  const NUM = R`\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)[a-zA-Z]{0,3}\b`;
  const WORD = R`[A-Za-z_$\u00C0-\uFFFF][\w$\u00C0-\uFFFF]*`;
  const ANNOT = R`@[A-Za-z_][\w.]*`;
  const PREPROC = R`^[ \t]*#[ \t]*(?:include|define|undef|ifn?def|if|else|elif|endif|pragma|error|warning|line|import|using)\b`;

  const KW = {
    js: S('break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static switch throw try typeof var void while with yield async await get set as enum implements interface package private protected public abstract declare type namespace readonly keyof is satisfies'),
    py: S('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self cls print'),
    java: S('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var record sealed permits'),
    kt: S('as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while by catch constructor delegate dynamic field file finally get import init param property receiver set setparam value where abstract actual annotation companion const crossinline data enum expect external final infix inline inner internal lateinit noinline open operator out override private protected public reified sealed suspend tailrec vararg'),
    cs: S('abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw try typeof uint ulong unchecked unsafe ushort using virtual void volatile while var async await record init get set yield'),
    c: S('auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while class namespace template typename public private protected virtual override final new delete this try catch throw using nullptr bool constexpr operator explicit friend mutable noexcept static_assert thread_local decltype'),
    go: S('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var'),
    rs: S('as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while'),
    swift: S('associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as catch throw throws try async await actor some any'),
    dart: S('abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory final finally for Function get hide if implements import in interface is late library mixin new on operator part required rethrow return set show static super switch sync this throw try typedef var void while with yield'),
    php: S('abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield'),
    rb: S('alias and begin BEGIN break case class def defined do else elsif end END ensure for if in module next not or redo rescue retry return self super then undef unless until when while yield require require_relative puts attr_accessor attr_reader attr_writer lambda proc'),
    lua: S('and break do else elseif end for function goto if in local not or repeat return then until while'),
    perl: S('my our local sub if elsif else unless while until for foreach return last next redo use no package require print say defined undef and or not eq ne lt gt le ge'),
    r: S('if else repeat while function for next break in library require return'),
    sh: S('if then else elif fi for while until do done case esac in function select time echo cd ls export local readonly return exit set unset shift source alias eval exec trap read test true false cat grep sed awk mkdir rm cp mv chmod chown sudo apt npm git'),
    bat: S('echo set if else for in do goto call exit rem pause cd dir copy move del type cls start setlocal endlocal not exist errorlevel'),
    ps1: S('begin break catch class continue data do dynamicparam else elseif end exit filter finally for foreach from function if in param process return switch throw trap try until using var while workflow'),
    sql: S('select from where and or not in is null like between join inner left right full outer cross on as group by order having limit offset insert into values update set delete create table alter drop index view primary key foreign references unique default check constraint distinct union all case when then else end exists count sum avg min max asc desc with begin commit rollback transaction database schema if truncate returning using cast over partition'),
    make: S('FROM RUN CMD LABEL EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER WORKDIR ARG ONBUILD STOPSIGNAL HEALTHCHECK SHELL AS ifeq ifneq ifdef ifndef else endif include define endef export override'),
  };
  KW.ts = KW.js;
  KW.cpp = KW.c;
  KW.scala = KW.java;
  const LIT = S('true false null undefined NaN Infinity None True False nil NULL nullptr void this super self TRUE FALSE yes no on off');

  const ccom = [['c1', CLINE], ['c2', CBLOCK]];
  const defaults = (kw, extra) => ({ kw, lit: LIT });
  const cfgs = {
    js: { rules: [...ccom, ['s1', BT], ['s2', DQ], ['s3', SQ], ['m1', ANNOT], ['n', NUM], ['w', WORD]], kw: KW.js },
    ts: { rules: [...ccom, ['s1', BT], ['s2', DQ], ['s3', SQ], ['m1', ANNOT], ['n', NUM], ['w', WORD]], kw: KW.ts },
    java: { rules: [...ccom, ['s1', DQ], ['s2', SQ], ['m1', ANNOT], ['n', NUM], ['w', WORD]], kw: KW.java },
    kt: { rules: [...ccom, ['s0', R`"""[\s\S]*?(?:"""|(?![\s\S]))`], ['s1', DQ], ['s2', SQ], ['m1', ANNOT], ['n', NUM], ['w', WORD]], kw: KW.kt },
    scala: { rules: [...ccom, ['s0', TDQ], ['s1', DQ], ['s2', SQ], ['m1', ANNOT], ['n', NUM], ['w', WORD]], kw: KW.scala },
    cs: { rules: [...ccom, ['m0', PREPROC], ['s1', R`@"(?:[^"]|"")*"?`], ['s2', DQ], ['s3', SQ], ['n', NUM], ['w', WORD]], kw: KW.cs },
    c: { rules: [...ccom, ['m0', PREPROC], ['s1', DQ], ['s2', SQ], ['s3', R`<[\w./]+\.h(?:pp)?>`], ['n', NUM], ['w', WORD]], kw: KW.c },
    cpp: { rules: [...ccom, ['m0', PREPROC], ['s1', DQ], ['s2', SQ], ['s3', R`<[\w./]+>`], ['n', NUM], ['w', WORD]], kw: KW.cpp },
    go: { rules: [...ccom, ['s1', BT], ['s2', DQ], ['s3', SQ], ['n', NUM], ['w', WORD]], kw: KW.go },
    rs: { rules: [...ccom, ['s1', DQ], ['s2', R`'(?:\\.|[^'\\\n])'`], ['m1', R`#!?\[[^\]\n]*\]`], ['n', NUM], ['w', WORD]], kw: KW.rs },
    swift: { rules: [...ccom, ['s0', TDQ], ['s1', DQ], ['m1', ANNOT], ['n', NUM], ['w', WORD]], kw: KW.swift },
    dart: { rules: [...ccom, ['s0', TDQ], ['s0b', TSQ], ['s1', DQ], ['s2', SQ], ['m1', ANNOT], ['n', NUM], ['w', WORD]], kw: KW.dart },
    php: { rules: [...ccom, ['c3', HASH], ['s1', DQ], ['s2', SQ], ['v', R`\$[A-Za-z_]\w*`], ['n', NUM], ['w', WORD]], kw: KW.php },
    py: { rules: [['c1', HASH], ['s0', TDQ], ['s0b', TSQ], ['s1', DQ], ['s2', SQ], ['m1', ANNOT], ['n', NUM], ['w', WORD]], kw: KW.py },
    rb: { rules: [['c1', HASH], ['s1', DQ], ['s2', SQ], ['v', R`[@$]{1,2}[A-Za-z_]\w*|:[A-Za-z_]\w*`], ['n', NUM], ['w', WORD]], kw: KW.rb },
    lua: { rules: [['c1', R`--\[\[[\s\S]*?(?:\]\]|(?![\s\S]))`], ['c2', R`--[^\n]*`], ['s1', DQ], ['s2', SQ], ['s3', R`\[\[[\s\S]*?(?:\]\]|(?![\s\S]))`], ['n', NUM], ['w', WORD]], kw: KW.lua },
    perl: { rules: [['c1', HASH], ['s1', DQ], ['s2', SQ], ['v', R`[$@%][A-Za-z_]\w*`], ['n', NUM], ['w', WORD]], kw: KW.perl },
    r: { rules: [['c1', HASH], ['s1', DQ], ['s2', SQ], ['n', NUM], ['w', R`[A-Za-z_.][\w.]*`]], kw: KW.r },
    sh: { rules: [['c1', R`(?:^|[ \t;])#[^\n]*`], ['s1', DQ], ['s2', R`'[^']*'?`], ['v', R`\$(?:\{[^}\n]*\}?|[A-Za-z_]\w*|[0-9@#?!$*-])`], ['n', NUM], ['w', R`[A-Za-z_][\w-]*`]], kw: KW.sh },
    bat: { rules: [['c1', R`^[ \t]*(?:@?rem\b|::)[^\n]*`], ['s1', DQ], ['v', R`%[\w~:*]+%?|![\w]+!`], ['m1', R`^[ \t]*:\w+`], ['n', NUM], ['w', R`[A-Za-z_][\w]*`]], kw: KW.bat, ci: true },
    ps1: { rules: [['c1', R`<#[\s\S]*?(?:#>|(?![\s\S]))`], ['c2', HASH], ['s1', DQ], ['s2', R`'[^']*'?`], ['v', R`\$\{?[\w:]+\}?`], ['n', NUM], ['w', R`[A-Za-z_][\w-]*`]], kw: KW.ps1, ci: true },
    sql: { rules: [['c1', R`--[^\n]*`], ['c2', CBLOCK], ['s1', R`'(?:''|[^'])*'?`], ['s2', DQ], ['n', NUM], ['w', WORD]], kw: KW.sql, ci: true, types: false },
    make: { rules: [['c1', HASH], ['s1', DQ], ['s2', SQ], ['v', R`\$[({][^)}\n]*[)}]?|\$[@<^?*%]`], ['m1', R`^[\w./%-]+(?=\s*:(?!=))`], ['n', NUM], ['w', WORD]], kw: KW.make },
    css: { rules: [['c1', CBLOCK], ['s1', DQ], ['s2', SQ], ['m1', R`@[\w-]+`], ['n1', R`#[\da-fA-F]{3,8}\b`], ['v', R`--[\w-]+`], ['n2', R`-?(?:\d+\.)?\d+(?:px|r?em|%|vh|vw|vmin|vmax|ch|ex|s|ms|deg|rad|turn|fr|pt|cm|mm|in)?\b`], ['b', R`[{}]`], ['w', R`-?[A-Za-z_][\w-]*`]], css: true },
    json: { rules: [['s1', DQ], ['n', R`-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b`], ['c1', CLINE], ['c2', CBLOCK], ['w', R`[A-Za-z_]\w*`]], kw: new Set(), keys: true },
    yaml: { rules: [['c1', R`(?:^|[ \t])#[^\n]*`], ['p', R`^[ \t-]*[\w.\-/]+(?=[ \t]*:(?:[ \t]|$))`], ['s1', DQ], ['s2', R`'[^']*'?`], ['m1', R`[&*][\w-]+|---|\.\.\.`], ['n', NUM], ['w', R`[A-Za-z_][\w-]*`]], kw: new Set(), types: false },
    toml: { rules: [['c1', HASH], ['m1', R`^[ \t]*\[\[?[^\]\n]+\]\]?`], ['p', R`^[ \t]*[\w.\-"]+(?=[ \t]*=)`], ['s0', TDQ], ['s1', DQ], ['s2', R`'[^'\n]*'?`], ['n', NUM], ['w', R`[A-Za-z_][\w-]*`]], kw: new Set(), types: false },
    ini: { rules: [['c1', R`^[ \t]*[;#][^\n]*`], ['m1', R`^[ \t]*\[[^\]\n]+\]`], ['p', R`^[ \t]*[\w.\-]+(?=[ \t]*[=:])`], ['s1', DQ], ['s2', R`'[^'\n]*'?`], ['n', NUM], ['w', R`[A-Za-z_][\w-]*`]], kw: new Set(), types: false },
    diff: { rules: [['m1', R`^(?:diff |index |---|\+\+\+)[^\n]*`], ['ins', R`^\+[^\n]*`], ['del', R`^-[^\n]*`], ['k', R`^@@[^\n]*`]], kw: new Set() },
    log: { rules: [['n', R`\b\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:[.,]\d+)?(?:Z|[+-]\d\d:?\d\d)?|\b\d\d:\d\d:\d\d(?:[.,]\d+)?\b`], ['er', R`\b(?:ERROR|FATAL|CRITICAL|SEVERE|Exception|FAIL(?:ED)?)\b`], ['wa', R`\bWARN(?:ING)?\b`], ['in', R`\bINFO\b`], ['db', R`\b(?:DEBUG|TRACE)\b`], ['c1', R`\[[^\]\n]{1,40}\]`], ['s1', DQ]], kw: new Set() },
    md: { rules: [['s0', R`^[ \t]*(?:\`\`\`|~~~)[^\n]*\n[\s\S]*?(?:^[ \t]*(?:\`\`\`|~~~)[^\n]*$|(?![\s\S]))`], ['k', R`^#{1,6}[ \t][^\n]*`], ['c1', R`^>[^\n]*`], ['m1', R`^[ \t]*(?:[-*+]|\d+[.)])[ \t]`], ['s1', R`\`[^\`\n]+\``], ['f', R`!?\[[^\]\n]*\]\([^)\n]*\)`], ['t', R`\*\*[^*\n]+\*\*|__[^_\n]+__`], ['c2', R`<!--[\s\S]*?(?:-->|(?![\s\S]))`]], kw: new Set() },
  };
  cfgs.kt.lit = cfgs.js.lit = LIT;

  const reCache = {};
  const getRe = (id) => reCache[id] || (reCache[id] = new RegExp(cfgs[id].rules.map(([n, s]) => '(?<' + n + '>' + s + ')').join('|'), 'gm'));

  function tokenize(text, id) {
    const cfg = cfgs[id], re = getRe(id), out = [];
    re.lastIndex = 0;
    let pos = 0, m, depth = 0;
    while ((m = re.exec(text))) {
      if (m[0] === '') { re.lastIndex++; continue; }
      if (m.index > pos) out.push([null, text.slice(pos, m.index)]);
      let type = null;
      const g = m.groups;
      for (const k in g) if (g[k] !== undefined) { type = k.replace(/\d+[a-z]?$/, ''); break; }
      const tok = m[0], end = re.lastIndex;
      if (type === 'b') { depth += tok === '{' ? 1 : -1; type = null; }
      else if (type === 's' && cfg.keys && /^\s*:/.test(text.substr(end, 12))) type = 'p';
      else if (type === 'w') {
        const key = cfg.ci ? tok.toLowerCase() : tok;
        if (cfg.css) {
          type = depth > 0 && /^\s*:/.test(text.substr(end, 12)) ? 'p' : depth > 0 ? null : (/^[A-Za-z]/.test(tok) && /^[\s,{:.>+~[]/.test(text.substr(end, 2)) ? 'k' : null);
        } else if (cfg.kw && cfg.kw.has(key)) type = 'k';
        else if (LIT.has(tok) && id !== 'sql') type = 'l';
        else if (text.charCodeAt(end) === 40) type = 'f';
        else if (cfg.types !== false && tok.length > 1 && /^[A-Z][a-z]/.test(tok)) type = 't';
        else type = null;
      }
      out.push([type, tok]);
      pos = end;
    }
    if (pos < text.length) out.push([null, text.slice(pos)]);
    return out;
  }

  function tokXml(text) {
    const out = [];
    const re = /<!--[\s\S]*?(?:-->|(?![\s\S]))|<!\[CDATA\[[\s\S]*?(?:\]\]>|(?![\s\S]))|<[!?][^>]*>|<\/?[\w:.-]+(?:[^<>"']|"[^"]*"|'[^']*')*>|&#?\w+;/g;
    let pos = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > pos) out.push([null, text.slice(pos, m.index)]);
      const t = m[0];
      if (t.startsWith('<!--')) out.push(['c', t]);
      else if (t.startsWith('<![') || t.startsWith('<?') || t.startsWith('<!')) out.push(['m', t]);
      else if (t[0] === '&') out.push(['n', t]);
      else {
        const head = /^<\/?[\w:.-]+/.exec(t)[0];
        out.push(['k', head]);
        let rest = t.slice(head.length);
        const tail = /\/?>$/.exec(rest);
        if (tail) rest = rest.slice(0, tail.index);
        const ar = /([\w:.@-]+)(\s*=\s*)?("[^"]*"|'[^']*'|[^\s"'>]+)?|\s+|./g;
        let a;
        while ((a = ar.exec(rest))) {
          if (a[1]) { out.push(['a', a[1]]); if (a[2]) out.push([null, a[2]]); if (a[3]) out.push(['s', a[3]]); }
          else out.push([null, a[0]]);
        }
        if (tail) out.push(['k', tail[0]]);
      }
      pos = re.lastIndex;
    }
    if (pos < text.length) out.push([null, text.slice(pos)]);
    return out;
  }

  function toLines(tokens) {
    const lines = [];
    let cur = '';
    for (const [t, s] of tokens) {
      const parts = s.split('\n');
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) { lines.push(cur); cur = ''; }
        const p = parts[i];
        if (p) cur += t ? '<span class="t-' + t + '">' + esc(p) + '</span>' : esc(p);
      }
    }
    lines.push(cur);
    return lines;
  }

  const ALIAS = { html: 'xml', htm: 'xml', plain: null };
  PV.hl = {
    MAX_CHARS: 1500000,
    supported: (id) => id === 'xml' || !!cfgs[id],
    lines(text, id) {
      text = text.replace(/\r\n?/g, '\n');
      id = id in ALIAS ? ALIAS[id] : id;
      let toks;
      try {
        if (!id || text.length > PV.hl.MAX_CHARS) toks = [[null, text]];
        else if (id === 'xml') toks = tokXml(text);
        else if (cfgs[id]) toks = tokenize(text, id);
        else toks = [[null, text]];
      } catch (e) { console.warn('highlight failed', e); toks = [[null, text]]; }
      return toLines(toks);
    },
    html(text, id) { return PV.hl.lines(text, id).join('\n'); },
  };
})();
