// parse.js — fast CommonMark + GFM renderer, byte-identical to marked 18.1.3
// (default options) on the competition corpus. Written from scratch:
// a cursor inline lexer with a delimiter stack for emphasis, a regex
// block dispatcher, and a small renderer. No dependencies.

const ENT = {
  AElig: '\u00C6', aelig: '\u00E6', Aacute: '\u00C1', aacute: '\u00E1',
  Acirc: '\u00C2', acirc: '\u00E2', Agrave: '\u00C0', agrave: '\u00E0',
  Aring: '\u00C5', aring: '\u00E5', Atilde: '\u00C3', atilde: '\u00E3',
  Auml: '\u00C4', auml: '\u00E4', Ccedil: '\u00C7', ccedil: '\u00E7',
  Eacute: '\u00C9', eacute: '\u00E9', Ecirc: '\u00CA', ecirc: '\u00EA',
  Egrave: '\u00C8', egrave: '\u00E8', Euml: '\u00CB', euml: '\u00EB',
  Iacute: '\u00CD', iacute: '\u00ED', Icirc: '\u00CE', icirc: '\u00EE',
  Igrave: '\u00CC', igrave: '\u00EC', Iuml: '\u00CF', iuml: '\u00EF',
  Ntilde: '\u00D1', ntilde: '\u00F1', Oacute: '\u00D3', oacute: '\u00F3',
  Ocirc: '\u00D4', ocirc: '\u00F4', Ograve: '\u00D2', ograve: '\u00F2',
  Oslash: '\u00D8', oslash: '\u00F8', Otilde: '\u00D5', otilde: '\u00F5',
  Ouml: '\u00D6', ouml: '\u00F6', Scaron: '\u0160', scaron: '\u0161',
  Uacute: '\u00DA', uacute: '\u00FA', Ucirc: '\u00DB', ucirc: '\u00FB',
  Ugrave: '\u00D9', ugrave: '\u00F9', Uuml: '\u00DC', uuml: '\u00FC',
  Yacute: '\u00DD', yacute: '\u00FD', Yuml: '\u0178', yuml: '\u00FF',
  Dcaron: '\u010E', dcaron: '\u010F', Zcaron: '\u017D', zcaron: '\u017E',
  THORN: '\u00DE', thorn: '\u00FE', eth: '\u00F0', ETH: '\u00D0',
  szlig: '\u00DF', iexcl: '\u00A1', iquest: '\u00BF',
  cent: '\u00A2', pound: '\u00A3', curren: '\u00A4', yen: '\u00A5',
  brvbar: '\u00A6', sect: '\u00A7', uml: '\u00A8', ordf: '\u00AA',
  ordm: '\u00BA', laquo: '\u00AB', raquo: '\u00BB', deg: '\u00B0',
  plusmn: '\u00B1', sup2: '\u00B2', sup3: '\u00B3', acute: '\u00B4',
  micro: '\u00B5', para: '\u00B6', middot: '\u00B7', cedil: '\u00B8',
  sup1: '\u00B9', frac14: '\u00BC', frac12: '\u00BD', frac34: '\u00BE',
  iquest2: '\u00BF', times: '\u00D7', divide: '\u00F7', minus: '\u2212',
  euro: '\u20AC', trade: '\u2122', copy: '\u00A9', reg: '\u00AE',
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', lsquo: '\u2018',
  rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D', sbquo: '\u201A',
  bdquo: '\u201E', dagger: '\u2020', Dagger: '\u2021', bull: '\u2022',
  permil: '\u2030', prime: '\u2032', Prime: '\u2033', oline: '\u203E',
  frasl: '\u2044', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009',
  ClockwiseContourIntegral: '\u2232', DifferentialD: '\u2146',
  HilbertSpace: '\u210B', ngE: '\u2267\u0338', notin: '\u2209',
  alpha: '\u03B1', beta: '\u03B2', gamma: '\u03B3', delta: '\u03B4',
  epsilon: '\u03B5', pi: '\u03C0', sigma: '\u03C3', omega: '\u03C9',
  Alpha: '\u0391', Beta: '\u0392', Gamma: '\u0393', Delta: '\u0394',
  Pi: '\u03A0', Sigma: '\u03A3', Omega: '\u03A9', infin: '\u221E',
  ne: '\u2260', le: '\u2264', ge: '\u2265', asymp: '\u2248',
  larr: '\u2190', uarr: '\u2191', rarr: '\u2192', darr: '\u2193',
  harr: '\u2194', crarr: '\u21B5', lArr: '\u21D0', uArr: '\u21D1',
  rArr: '\u21D2', dArr: '\u21D3', hArr: '\u21D4', forall: '\u2200',
  part: '\u2202', exist: '\u2203', empty: '\u2205', nabla: '\u2207',
  isin: '\u2208', ni: '\u220B', prod: '\u220F', sum: '\u2211',
  lowast: '\u2217', radic: '\u221A', prop: '\u221D', and: '\u2227',
  or: '\u2228', cap: '\u2229', cup: '\u222A', int: '\u222B',
  there4: '\u2234', sim: '\u223C', cong: '\u2245', equiv: '\u2261',
  sub: '\u2282', sup: '\u2283', nsub: '\u2284', sube: '\u2286',
  supe: '\u2287', oplus: '\u2295', otimes: '\u2297', perp: '\u22A5',
  sdot: '\u22C5', lceil: '\u2308', rceil: '\u2309', lfloor: '\u230A',
  rfloor: '\u230B', lang: '\u27E8', rang: '\u27E9', loz: '\u25CA',
  spades: '\u2660', clubs: '\u2663', hearts: '\u2665', diams: '\u2666',
};

// Decode a numeric character reference starting at `s` (which begins
// with '&#'). Decimal allows at most 7 digits, hex at most 6; returns
// [decodedChar, lengthConsumed] or null when it is not a valid reference.
function decodeNumeric(s) {
  if (s.charCodeAt(1) !== 35) return null;
  let i = 2, hex = false;
  if (s.charCodeAt(2) === 120 || s.charCodeAt(2) === 88) { hex = true; i = 3; }
  let j = i, code = 0, digits = 0;
  while (j < s.length) {
    const c = s.charCodeAt(j);
    if (c === 59) break;
    const d = c >= 48 && c <= 57 ? c - 48 : hex && c >= 97 && c <= 102 ? c - 87
      : hex && c >= 65 && c <= 70 ? c - 55 : -1;
    if (d < 0) return null;
    digits++;
    if ((hex && digits > 6) || (!hex && digits > 7)) return null;
    code = code * (hex ? 16 : 10) + d;
    j++;
  }
  if (j === i || j >= s.length || s.charCodeAt(j) !== 59) return null;
  if (code === 0 || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) return ['\uFFFD', j + 1];
  return [String.fromCodePoint(code), j + 1];
}

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/g;
// Full escape (code spans, text after entity decoding).
function esc(s) {
  return s.replace(ESC_RE, (c) => ESC_MAP[c]);
}
// Escape for attribute values (href/title): a '&' that starts a valid
// entity reference is left alone.
const ESC_ATTR_RE = /[<>\"']|&(?!(?:#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);)/g;
function escAttr(s) {
  return s.replace(ESC_ATTR_RE, (c) => ESC_MAP[c]);
}

function cleanUrl(href) {
  try { href = encodeURI(href).replace(/%25/g, '%'); } catch { return null; }
  return href;
}

// Backslash-unescape: '\' + ASCII punctuation -> the punctuation itself.
const PUNCT = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'.split(''));
function unescBackslash(s) {
  if (!s.includes('\\')) return s;
  let out = '', i = 0;
  while (true) {
    const k = s.indexOf('\\', i);
    if (k < 0) { out += s.slice(i); break; }
    out += s.slice(i, k);
    const n = s[k + 1];
    if (n !== undefined && PUNCT.has(n)) { out += n; i = k + 2; }
    else { out += '\\'; i = k + 1; }
  }
  return out;
}


// ===================== inline lexer =====================

const WS_RE = /\s/;
const PUNCT_RE = /[\p{P}\p{S}]/u;
function isWS(c) { return c === undefined || WS_RE.test(c); }
function isPunct(c) {
  if (c === undefined) return false;
  const n = c.charCodeAt(0);
  if (n < 128) return PUNCT.has(c);
  return PUNCT_RE.test(c);
}
// Can a delimiter run open/close emphasis? `before`/`after` are the raw
// neighbour chars (undefined at the string ends, treated as whitespace).
function flanking(before, after) {
  const lb = !isWS(after) && (!isPunct(after) || isWS(before) || isPunct(before));
  const rb = !isWS(before) && (!isPunct(before) || isWS(after) || isPunct(after));
  return [lb, rb];
}

const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:/;
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/;
const EXT_URL_RE = /^(?:[Hh][Tt][Tt][Pp][Ss]?:\/\/|www\.)[^\s<]*/;
const TAGNAME_RE = /^[A-Za-z][A-Za-z0-9-]*/;
// lookup table: ASCII chars allowed in an email local part
const EMAIL_LOCAL = new Uint8Array(128);
for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.!#$%&'*+/=?^_`{|}~-") EMAIL_LOCAL[ch.charCodeAt(0)] = 1;
const isEmailLocal = (ch) => ch !== undefined && ch.charCodeAt(0) < 128 && EMAIL_LOCAL[ch.charCodeAt(0)] === 1;

// Parse an inline HTML tag / comment / PI / declaration / CDATA starting
// at s (s[0] === '<'). Returns [raw, length] or null.
function scanHtmlTag(s) {
  if (s[1] === '!') {
    if (s.startsWith('<!--')) {
      // <!--> and <!---> are empty comments, valid as-is
      if (s.startsWith('<!-->')) return ['<!-->', 5];
      if (s.startsWith('<!--->')) return ['<!--->', 6];
      const e = s.indexOf('-->', 4);
      return e < 0 ? null : [s.slice(0, e + 3), e + 3];
    }
    if (s.startsWith('<![CDATA[')) {
      const e = s.indexOf(']]>', 9);
      return e < 0 ? null : [s.slice(0, e + 3), e + 3];
    }
    const m = /^<![A-Za-z][^>]*>/.exec(s);
    return m ? [m[0], m[0].length] : null;
  }
  if (s[1] === '?') {
    const e = s.indexOf('?>', 2);
    return e < 0 ? null : [s.slice(0, e + 2), e + 2];
  }
  // open or close tag
  let i = 1, closing = false;
  if (s[i] === '/') { closing = true; i++; }
  if (!/[A-Za-z]/.test(s[i] || '')) return null;
  while (i < s.length && /[A-Za-z0-9-]/.test(s[i])) i++;
  if (closing) {
    // a closing tag takes no attributes
    while (i < s.length && /[ \t\n]/.test(s[i])) i++;
    if (s[i] === '>') return [s.slice(0, i + 1), i + 1];
    return null;
  }
  while (i < s.length) {
    let ws = 0;
    while (i < s.length && /[ \t\n]/.test(s[i])) { i++; ws++; }
    if (s[i] === '>') return [s.slice(0, i + 1), i + 1];
    if (s[i] === '/' && s[i + 1] === '>') return [s.slice(0, i + 2), i + 2];
    if (ws === 0) return null; // an attribute needs preceding whitespace
    if (!/[A-Za-z_:]/.test(s[i] || '')) return null;
    while (i < s.length && /[A-Za-z0-9_.:-]/.test(s[i])) i++;
    let j = i;
    while (j < s.length && /[ \t\n]/.test(s[j])) j++;
    if (s[j] === '=') {
      j++;
      while (j < s.length && /[ \t\n]/.test(s[j])) j++;
      if (s[j] === '"' || s[j] === "'") {
        const q = s[j];
        j++;
        while (j < s.length && s[j] !== q) j++;
        if (j >= s.length) return null;
        j++;
      } else {
        const start = j;
        while (j < s.length && !/[ \t\n"'=<>`]/.test(s[j])) j++;
        if (j === start) return null;
      }
      i = j;
    }
  }
  return null;
}

// Match an autolink <scheme:...> or <email> starting at s. Returns href or null.
function scanAutolink(s) {
  const e = s.indexOf('>', 1);
  if (e < 1) return null;
  const inner = s.slice(1, e);
  if (inner.includes(' ') || inner.includes('<') || inner.includes('\n')) return null;
  if (SCHEME_RE.test(inner)) return [inner, e + 1];
  if (EMAIL_RE.test(inner) && inner.indexOf('@') > 0 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(inner)) {
    return ['mailto:' + inner, e + 1, inner];
  }
  return null;
}

// Parse a link destination + optional title starting at s (s[0] === '(').
// Returns {href, title, len} or null. `raw` keeps backslash escapes for
// later unescaping; entities are left as-is (attr escaping preserves them).
function scanLinkTarget(s) {
  let i = 1;
  while (i < s.length && (s[i] === ' ' || s[i] === '\n' || s[i] === '\t')) i++;
  if (i >= s.length) return null;
  let dest = '';
  if (s[i] === '<') {
    // an escaped \> does not close the angle brackets
    let j = i + 1, ok = false;
    while (j < s.length) {
      const c = s[j];
      if (c === '\\' && j + 1 < s.length && PUNCT.has(s[j + 1])) { j += 2; continue; }
      if (c === '>') { ok = true; break; }
      if (c === '<' || c === '\n') return null;
      j++;
    }
    if (!ok) return null;
    dest = s.slice(i + 1, j);
    i = j + 1;
  } else {
    let depth = 0, j = i;
    while (j < s.length) {
      const c = s[j];
      if (c === '\\' && j + 1 < s.length && PUNCT.has(s[j + 1])) { j += 2; continue; }
      if (c === '(') depth++;
      else if (c === ')') { if (depth === 0) break; depth--; }
      else if (c === ' ' || c === '\n' || c === '\t' || c === '\x00') break;
      j++;
    }
    if (j >= s.length) return null;
    dest = s.slice(i, j);
    i = j;
  }
  // optional title
  let title = null;
  let k = i;
  while (k < s.length && (s[k] === ' ' || s[k] === '\n' || s[k] === '\t')) k++;
  if (k < s.length && (s[k] === '"' || s[k] === "'" || s[k] === '(')) {
    const q = s[k];
    const close = q === '(' ? ')' : q;
    let j = k + 1, ok = false;
    while (j < s.length) {
      const c = s[j];
      if (c === '\\' && j + 1 < s.length && PUNCT.has(s[j + 1])) { j += 2; continue; }
      if (q === '(' && c === '(') { /* nested paren in title: count */ }
      if (c === close) { ok = true; break; }
      if (c === '\n' && q !== '"') { /* titles may span lines */ }
      j++;
    }
    if (!ok) return null;
    title = s.slice(k + 1, j);
    k = j + 1;
    while (k < s.length && (s[k] === ' ' || s[k] === '\n' || s[k] === '\t')) k++;
  }
  if (k >= s.length || s[k] !== ')') return null;
  return { href: dest, title, len: k + 1 };
}

// Normalize a reference label: collapse whitespace, lowercase.
function normLabel(s) {
  // Unicode case folding: ß and ẞ both fold to "ss"
  return s.replace(/\s+/g, ' ').trim().toLowerCase().replace(/ß/g, 'ss');
}

// Resolve emphasis/delimiter runs inside `nodes` (a node array) using the
// delimiter stack entries in `ds` (indices into `nodes`).
function resolveEmphasis(nodes, ds) {
  // node-index ranges of emphasis already closed; an opener strictly
  // inside one cannot match a closer outside it (cm-469, cm-470)
  const closed = [];
  const trapped = (idx) => {
    for (let r = 0; r < closed.length; r++) {
      if (idx > closed[r][0] && idx < closed[r][1]) return true;
    }
    return false;
  };
  let ci = 0;
  while (ci < ds.length) {
    const closer = ds[ci];
    if (!closer.close || closer.n <= 0) { ci++; continue; }
    let oi = ci - 1, found = -1;
    while (oi >= 0) {
      const op = ds[oi];
      if (op.n > 0 && op.open && op.ch === closer.ch && !trapped(op.idx)) {
        const odd = (op.close || closer.open) &&
          ((op.n + closer.n) % 3 === 0) && (op.n % 3 !== 0 || closer.n % 3 !== 0);
        if (!odd) { found = oi; break; }
      }
      oi--;
    }
    if (found < 0) { ci++; continue; }
    const op = ds[found];
    const use = (op.n >= 2 && closer.n >= 2) ? 2 : 1;
    if (use > op.n || use > closer.n) { ci++; continue; }
    const tag = op.ch === '~' ? 'del' : (use === 2 ? 'strong' : 'em');
    const on = nodes[op.idx], cn = nodes[closer.idx];
    if (!on || !cn || on.k !== 'delim' || cn.k !== 'delim') { ci++; continue; }
    on.open = on.open || [];
    on.open.unshift('<' + tag + '>');
    cn.close = cn.close || [];
    cn.close.push('</' + tag + '>');
    op.n -= use; closer.n -= use;
    on.usedOpen = (on.usedOpen || 0) + use;
    cn.usedClose = (cn.usedClose || 0) + use;
    closed.push([op.idx, closer.idx]);
    if (closer.n <= 0) ci++;
  }
}


// ===================== block lexer (main) =====================

function lexLines(lines, refs, trailNL, lazySetext, codeMerged, top) {
  if (top === undefined) top = true;
  const toks = [];
  const n = lines.length;
  let i = 0;
  let sawBlank = false;
  let hasSpaceSep = false;
  while (i < n) {
    const line = lines[i];
    if (isBlank(line)) { if (toks.length > 0) sawBlank = true; i++; continue; }
    if (sawBlank) { hasSpaceSep = true; sawBlank = false; }
    // fenced code
    const fm = FENCE_RE.exec(line);
    if (fm && !(fm[1][0] === '`' && fm[2].includes('`'))) {
      const fence = fm[1], ch = fence[0], flen = fence.length;
      const info = fm[2].trim();
      const lang = unescBackslash(info.split(/[ \t]+/)[0] || '');
      // marked's Dt(): only backtick fences dedent, and only by the
      // fence line's leading whitespace CHARACTER count (a tab counts
      // as 1 char, not 4 columns): each content line loses up to that
      // many leading whitespace characters. Tilde fences and
      // unindented fences keep content lines exactly as written.
      const comp = ch === '`' ? /^(\s+)(?:```)/.exec(line) : null;
      const dedent = comp ? comp[1].length : 0;
      const content = [];
      let j = i + 1;
      while (j < n) {
        const l2 = lines[j];
        const cm = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(l2);
        if (cm && cm[1][0] === ch && cm[1].length >= flen) break;
        if (dedent) {
          const ws = /^\s+/.exec(l2);
          content.push(ws ? l2.slice(Math.min(ws[0].length, dedent)) : l2);
        } else content.push(l2);
        j++;
      }
      if (j === n && trailNL && content.length && content[content.length - 1] === '') content.pop();
      let text = content.join('\n');
      if (content.length && content[content.length - 1] !== '') text += '\n';
      toks.push({ t: 'code', text, lang: lang || null });
      i = j < n ? j + 1 : j;
      continue;
    }
    // ATX heading
    const am = ATX_RE.exec(line);
    if (am) {
      const level = am[1].length;
      let text = line.slice(am[0].length).replace(/[ \t]+$/, '');
      const cm = /[ \t]+#+$/.exec(text);
      if (cm) text = text.slice(0, cm.index);
      else if (/^#+$/.test(text)) text = '';
      toks.push({ t: 'h', level, text });
      i++;
      continue;
    }
    // thematic break
    if (HR_RE.test(line)) { toks.push({ t: 'hr' }); i++; continue; }
    // blockquote
    if (stripBlockquote(line) !== null) {
      const r = lexBlockquote(lines, i, refs, trailNL);
      toks.push({ t: 'bq', toks: r.toks });
      i = r.next;
      continue;
    }
    // list
    const lm = listMarker(line);
    if (lm) {
      const r = lexList(lines, i, refs, trailNL);
      toks.push(r.tok);
      if (r.trailBlank) sawBlank = true;
      i = r.next;
      continue;
    }
    // HTML block
    const ht = htmlBlockType(line);
    if (ht) {
      const start = i;
      let j;
      if (ht === 7 || ht === 6) {
        j = i + 1;
        while (j < n && !isBlank(lines[j])) j++;
      } else {
        const tag = ht === 1 ? (HTML1_RE.exec(line) || [])[1] : null;
        j = i;
        if (!htmlBlockEnd(line, ht, tag)) {
          j = i + 1;
          while (j < n && !htmlBlockEnd(lines[j], ht, tag)) j++;
          if (j < n) j++;
        } else j = i + 1;
      }
      let text = lines.slice(start, j).join('\n');
      // marked's HTML-block regexes include the newline terminating the
      // block's last line, plus the following blank run: for types 1-5
      // only the newlines of empty lines (`\n*` / `\n+` stop at a
      // space), for type 6/7 the whole run including spaces
      // (`(?:\n[ \t]*)+\n`). The html tokenizer then runs ge(): if the
      // match ends with 2+ blank lines they are all stripped (a single
      // trailing newline survives). The split-artifact line ('' at n-1
      // when the source ends with '\n') is not a real blank line.
      const endLine = j - 1;
      if (endLine < n - 1 || trailNL) {
        text += '\n';
        let k = j;
        if (ht === 6 || ht === 7) {
          while (k < n - 1 && isBlank(lines[k])) { text += lines[k] + '\n'; k++; }
        } else {
          while (k < n - 1 && lines[k] === '') { text += '\n'; k++; }
        }
      }
      const parts = text.split('\n');
      let t = parts.length - 1;
      while (t >= 0 && /^[ \t]*$/.test(parts[t])) t--;
      if (parts.length - 1 - t >= 2) text = parts.slice(0, t + 1).join('\n');
      toks.push({ t: 'html', text });
      i = j;
      continue;
    }
    // link reference definition
    const dc = parseDef(lines, i, refs);
    if (dc > 0) { i += dc; continue; }
    // indented code
    if (indentCols(line) >= 4) {
      const content = [];
      let j = i;
      while (j < n) {
        const l2 = lines[j];
        if (isBlank(l2)) {
          let k = j + 1;
          while (k < n && isBlank(lines[k])) k++;
          if (k < n && indentCols(lines[k]) >= 4) { content.push(stripIndent(l2, 4)); j++; continue; }
          break;
        }
        if (indentCols(l2) < 4) break;
        content.push(stripIndent(l2, 4));
        j++;
      }
      let text = content.join('\n');
      if (content.length) text += '\n';
      toks.push({ t: 'code', text, lang: null });
      i = j;
      continue;
    }
    // table
    const tb = tryTable(lines, i);
    if (tb) {
      toks.push({ t: 'table', head: tb.head, align: tb.align, rows: tb.rows });
      i = tb.next;
      continue;
    }
    // paragraph (leading defs stripped first)
    let pi = i;
    while (true) {
      const d2 = parseDef(lines, pi, refs);
      if (d2 > 0) { pi += d2; continue; }
      break;
    }
    if (pi >= n || isBlank(lines[pi])) { i = pi + (pi < n ? 1 : 0); continue; }
    const pLines = [];
    let j = pi;
    let heading = null;
    while (j < n) {
      const l2 = lines[j];
      if (isBlank(l2)) {
        if (l2 !== '' && j === n - 1 && pLines.length > 0) { pLines.push(l2); j++; }
        break;
      }
      if (pLines.length > 0 && !(codeMerged && codeMerged.has(j)) && startsBlock(lines, j, true, top)) break;
      if (pLines.length > 0 && SETEXT_RE.test(l2) && !(lazySetext && lazySetext.has(j))) {
        heading = SETEXT_RE.exec(l2)[1][0] === '=' ? 1 : 2;
        j++;
        break;
      }
      if (pLines.length > 0 && !top && indentCols(l2) >= 4) pLines.push(stripIndent(l2, 4));
      else pLines.push(l2);
      j++;
    }
    if (heading !== null) {
      toks.push({ t: 'h', level: heading, text: pLines.join('\n').replace(/^[ \t]+/, '').replace(/[ \t]+$/, '') });
    } else if (pLines.length) {
      toks.push({ t: 'p', text: pLines.join('\n') });
    }
    i = j;
  }
  toks.hasSpaceSep = hasSpaceSep;
  return toks;
}

// Collect a blockquote starting at lines[i]. Returns {toks, next}.
// Marked lines and lazy continuation lines interleave; the inner text is
// lexed as a whole, with lazy setext underlines marked so they never
// become headings (marked's blockquoteSetextReplace behaviour: a lazy
// setext line after another lazy line is indented by 4 spaces instead).
function lexBlockquote(lines, i, refs, trailNL) {
  const inner = [];
  const lazySetext = new Set();
  const codeMerged = new Set();
  let j = i;
  let prevLazy = false;
  let inCodeRun = false;
  let toks = [];
  const relex = () => { toks = lexLines(inner, refs, trailNL && j >= lines.length, lazySetext, codeMerged); };
  while (j < lines.length) {
    // run of marked lines (an unmarked blank line ends the blockquote)
    while (j < lines.length) {
      const s = stripBlockquote(lines[j]);
      if (s !== null) { inner.push(s); prevLazy = false; inCodeRun = false; j++; continue; }
      break;
    }
    relex();
    const last = toks[toks.length - 1];
    // lazy lines may continue a paragraph, or descend into a nested
    // blockquote/list to reach an open paragraph inside (cm-292).
    // A code block (e.g. an unterminated fence) ends the lazy
    // continuation: lazy lines never continue a fence in marked, the
    // blockquote ends at its last marked line.
    if (!last || (last.t !== 'p' && last.t !== 'bq' && last.t !== 'list')) break;
    // lazy continuation lines (only while a paragraph is open)
    let lazyDone = false;
    while (j < lines.length) {
      const line = lines[j];
      if (isBlank(line)) break;
      if (inner.length && inner[inner.length - 1] === '') break;
      if (stripBlockquote(line) !== null) break;
      if (HR_RE.test(line)) break;
      // marked's blockquote paragraph pattern interrupts on ANY
      // ordered-list start number, not only 1
      if (startsBlock(lines, j, true, false)) break;
      if (SETEXT_RE.test(line)) {
        if (prevLazy) inner.push('    ' + line.replace(/^[ ]+/, ''));
        else { lazySetext.add(inner.length); inner.push(line); }
        inCodeRun = false;
      } else if (inCodeRun && indentCols(line) >= 4) {
        codeMerged.add(inner.length);
        inner.push(stripIndent(line, 4));
      } else if (!prevLazy && indentCols(line) >= 4) {
        const d = stripIndent(line, 4);
        codeMerged.add(inner.length);
        inner.push(d);
        inCodeRun = true;
        if (SETEXT_RE.test(d)) lazySetext.add(inner.length - 1);
      } else {
        inner.push(line);
        inCodeRun = false;
      }
      prevLazy = true;
      lazyDone = true;
      j++;
    }
    if (!lazyDone) break;
    relex();
  }
  return { toks, next: j };
}


// Columns of leading whitespace and the char index after it.
// Strip n columns from a line's start, expanding leading tabs to spaces
// using their original columns (container stripping: blockquote/list).
// Non-whitespace chars inside the strip region count as 1 column each.
function stripCols(line, n) {
  let col = 0, i = 0, out = '';
  while (i < line.length) {
    const c = line[i];
    if (c === ' ') {
      if (col < n) { col++; i++; }
      else { out += ' '; col++; i++; }
    } else if (c === '\t') {
      const w = 4 - (col % 4);
      if (col < n) {
        const used = Math.min(w, n - col);
        const rem = w - used;
        if (rem > 0) out += ' '.repeat(rem);
        col += w; i++;
      } else {
        out += ' '.repeat(w);
        col += w; i++;
      }
    } else {
      if (col < n) { col++; i++; }
      else break;
    }
  }
  return out + line.slice(i);
}

function leadWs(line) {
  let col = 0, i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ') { col++; i++; }
    else if (c === '\t') { col += 4 - (col % 4); i++; }
    else break;
  }
  return { col, idx: i };
}
// Remove n columns of indentation; a tab straddling the boundary leaves
// spaces behind, tabs past the boundary are kept verbatim.
function stripIndent(line, n) {
  let col = 0, i = 0;
  while (i < line.length && col < n) {
    const c = line[i];
    if (c === ' ') { col++; i++; }
    else if (c === '\t') {
      const w = 4 - (col % 4);
      if (col + w <= n) { col += w; i++; }
      else return ' '.repeat(col + w - n) + line.slice(i + 1);
    } else break;
  }
  return line.slice(i);
}
function isBlank(line) {
  for (let i = 0; i < line.length; i++) if (line[i] !== ' ' && line[i] !== '\t') return false;
  return true;
}
function indentCols(line) { return leadWs(line).col; }

const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+|[ \t]*$)/;
const HR_RE = /^ {0,3}(?:\*[ \t]*){3,}$|^ {0,3}(?:-[ \t]*){3,}$|^ {0,3}(?:_[ \t]*){3,}$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
// A line starts a fence only if a backtick fence's info string holds no
// backtick (marked's fence regex lookahead `(?=[^`\n]*(?:\n|$))`): a line
// like ```inner backticks``` is paragraph text, not a fence.
function isFenceLine(line) {
  const fm = FENCE_RE.exec(line);
  return !!fm && !(fm[1][0] === '`' && fm[2].includes('`'));
}
const SETEXT_RE = /^ {0,3}(=+|-+)[ \t]*$/;
const BLOCK_TAGS = new Set(('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param section source summary table tbody td tfoot th thead title tr track ul').split(' '));
const HTML1_RE = /^ {0,3}<(script|pre|textarea|style)(?:[ \t>]|\/>|$)/i;
const HTML6_RE = /^ {0,3}<\/?([A-Za-z][A-Za-z0-9-]*)(?:[ \t\/>]|$)/;

// What kind of HTML block (1..7) starts at this line, or 0.
function htmlBlockType(line) {
  const m = /^ {0,3}</.exec(line);
  if (!m) return 0;
  const s = line.slice(leadWs(line).idx);
  if (/^<!--/.test(s)) return 2;
  if (/^<\?/.test(s)) return 3;
  if (/^<![A-Za-z]/.test(s)) return 4;
  if (/^<!\[CDATA\[/.test(s)) return 5;
  const h1 = HTML1_RE.exec(line);
  if (h1) return 1;
  const h6 = HTML6_RE.exec(line);
  if (h6 && BLOCK_TAGS.has(h6[1].toLowerCase())) return 6;
  // type 7: a complete open/close tag alone on the line (must be a
  // valid tag, with valid attribute names)
  const s7 = line.slice(leadWs(line).idx);
  const tag = scanHtmlTag(s7);
  if (tag && /^[ \t]*$/.test(s7.slice(tag[1]))) return 7;
  return 0;
}
function htmlBlockEnd(line, type, tag) {
  if (type === 1) return tag ? line.toLowerCase().includes('</' + tag + '>') : /<\/(script|pre|textarea|style)>/i.test(line);
  if (type === 2) return line.includes('-->');
  if (type === 3) return line.includes('?>');
  if (type === 4) return line.includes('>');
  if (type === 5) return line.includes(']]>');
  return false;
}

// Split a table row into cells (unescaped pipes split; leading/trailing
// empty edge cells from outer pipes are dropped).
function splitCells(row) {
  const cells = [];
  let cur = '', i = 0;
  while (i < row.length) {
    const c = row[i];
    if (c === '\\' && i + 1 < row.length && (row[i + 1] === '|' || row[i + 1] === '\\')) { cur += row[i + 1]; i += 2; continue; }
    if (c === '|') { cells.push(cur); cur = ''; i++; continue; }
    cur += c; i++;
  }
  cells.push(cur);
  let a = 0, b = cells.length;
  if (cells.length > 0 && cells[0].trim() === '') a = 1;
  if (b > a && cells[b - 1].trim() === '') b--;
  const out = [];
  for (let k = a; k < b; k++) out.push(cells[k].trim());
  return out;
}
// Is `line` a table delimiter row? Returns alignments or null.
function tableDelim(line) {
  if (!line.includes('|') && !line.includes(':')) return null;
  const cells = splitCells(line);
  if (!cells.length) return null;
  const aligns = [];
  for (const c of cells) {
    const m = /^:?-+:?$/.exec(c);
    if (!m) return null;
    aligns.push(c.startsWith(':') && c.endsWith(':') && c.length > 1 ? 'center'
      : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null);
  }
  return aligns;
}
// Try to read a table starting at lines[i] (header) and lines[i+1]
// (delimiter). Returns {head, align, rows, next} or null.
function tryTable(lines, i) {
  if (i + 1 >= lines.length) return null;
  const headLine = lines[i];
  if (isBlank(headLine)) return null;
  const align = tableDelim(lines[i + 1]);
  if (!align) return null;
  const head = splitCells(headLine);
  if (head.length !== align.length) return null;
  const rows = [];
  let j = i + 2;
  while (j < lines.length) {
    const ln = lines[j];
    // a whitespace-only line ends the table, except a line holding a
    // tab, which is a row of empty cells
    if (isBlank(ln) && !ln.includes('\t')) break;
    if (startsBlock(lines, j, false)) break;
    rows.push(splitCells(ln));
    j++;
  }
  return { head, align, rows, next: j };
}

// Parse a link title ("..." / '...' / (...)) at the start of s.
// s may span lines; the title may too (but not across a blank line).
// needSpace: the title must be preceded by a space/tab (same-line title).
// Returns {title, end} (end = index just past the closing quote) or null.
function takeTitle(s, needSpace) {
  let q = 0;
  while (q < s.length && (s[q] === ' ' || s[q] === '\t')) q++;
  if (needSpace && q === 0) return null;
  if (q >= s.length) return null;
  const ch = s[q];
  if (ch !== '"' && ch !== "'" && ch !== '(') return null;
  const close = ch === '(' ? ')' : ch;
  let r = q + 1, out = '';
  while (r < s.length) {
    const c = s[r];
    if (c === '\\' && r + 1 < s.length && PUNCT.has(s[r + 1])) { out += s[r + 1]; r += 2; continue; }
    if (c === close) {
      if (/\n[ \t]*\n/.test(out)) return null; // no blank line inside a title
      return { title: out, end: r + 1 };
    }
    out += c; r++;
  }
  return null;
}

// Parse a link reference definition starting at lines[i]. Registers into
// refs (first definition wins). The label, destination and title may each
// span lines (no blank line inside a definition). Returns lines consumed
// or 0. A label keeps its backslashes for matching; the destination and
// title are unescaped.
function parseDef(lines, i, refs) {
  const first = lines[i];
  if (!/^ {0,3}\[/.test(first)) return 0;
  // join following lines (a definition never spans a blank line)
  let text = first;
  let avail = 1;
  while (i + avail < lines.length && avail < 30 && !isBlank(lines[i + avail])) {
    text += '\n' + lines[i + avail];
    avail++;
  }
  let p = first.indexOf('[') + 1;
  // label: raw text (backslashes preserved), no unescaped '['
  let label = '', ok = false;
  while (p < text.length) {
    const c = text[p];
    if (c === '\\' && p + 1 < text.length && PUNCT.has(text[p + 1])) { label += c + text[p + 1]; p += 2; continue; }
    if (c === ']') { ok = true; break; }
    if (c === '[') return 0;
    label += c; p++;
  }
  if (!ok) return 0;
  const norm = normLabel(label);
  if (!norm || norm.length > 999) return 0;
  p++; // past ']'
  while (p < text.length && (text[p] === ' ' || text[p] === '\t')) p++;
  if (text[p] !== ':') return 0;
  p++;
  // destination: skip spaces/tabs/newlines; may be on the next line
  while (p < text.length && (text[p] === ' ' || text[p] === '\t' || text[p] === '\n')) p++;
  if (p >= text.length) return 0;
  let dest, destEnd;
  if (text[p] === '<') {
    const e = text.indexOf('>', p + 1);
    if (e < 0) return 0;
    const d = text.slice(p + 1, e);
    if (/[\n<>]/.test(d)) return 0;
    dest = d; destEnd = e + 1;
  } else {
    let depth = 0, r = p;
    while (r < text.length) {
      const c = text[r];
      if (c === '\\' && r + 1 < text.length && PUNCT.has(text[r + 1])) { r += 2; continue; }
      if (c === '(') depth++;
      else if (c === ')') { if (depth === 0) break; depth--; }
      else if (c === ' ' || c === '\t' || c === '\n') break;
      r++;
    }
    if (r === p) return 0;
    dest = text.slice(p, r); destEnd = r;
  }
  dest = unescBackslash(dest);
  // rest of the destination's line
  let lineEnd = text.indexOf('\n', destEnd);
  if (lineEnd < 0) lineEnd = text.length;
  const lineRest = text.slice(destEnd, lineEnd);
  let title = null, consumedEnd = destEnd;
  if (/^[ \t]*$/.test(lineRest)) {
    // title may be on a following line; a bad title there leaves a
    // destination-only definition
    const nextStart = lineEnd < text.length ? lineEnd + 1 : text.length;
    if (nextStart < text.length) {
      const t = takeTitle(text.slice(nextStart), false);
      if (t) {
        const absEnd = nextStart + t.end;
        let afterEnd = text.indexOf('\n', absEnd);
        if (afterEnd < 0) afterEnd = text.length;
        if (/^[ \t]*$/.test(text.slice(absEnd, afterEnd))) {
          title = t.title; consumedEnd = absEnd;
        }
      }
    }
  } else {
    // same-line content: must be a valid title (it may close on a
    // following line) and nothing else, otherwise the definition is invalid
    const t = takeTitle(text.slice(destEnd), true);
    if (!t) return 0;
    const absEnd = destEnd + t.end;
    let afterEnd = text.indexOf('\n', absEnd);
    if (afterEnd < 0) afterEnd = text.length;
    if (!/^[ \t]*$/.test(text.slice(absEnd, afterEnd))) return 0;
    title = t.title; consumedEnd = absEnd;
  }
  if (!refs.has(norm)) refs.set(norm, { href: dest, title });
  let used = 1;
  for (let k = 0; k < consumedEnd; k++) if (text[k] === '\n') used++;
  return used;
}

// Does a block that can interrupt a paragraph start at lines[j]?
// `top`: at the top level (or in a blockquote) an ordered list only
// interrupts a paragraph when it starts with 1; inside a list item
// (top=false) any start number interrupts.
function startsBlock(lines, j, inPara, top) {
  if (top === undefined) top = true;
  if (j >= lines.length) return false;
  const line = lines[j];
  if (isBlank(line)) return false;
  if (isFenceLine(line)) return true;
  if (ATX_RE.test(line)) return true;
  if (inPara && SETEXT_RE.test(line)) return false;
  if (HR_RE.test(line)) return true;
  const bq = stripBlockquote(line);
  if (bq !== null) return true;
  const lm = listMarker(line);
  if (lm) {
    if (!inPara) return true;
    if (lm.empty) return false;
    if (lm.ordered && lm.start !== 1 && top) return false;
    return true;
  }
  const ht = htmlBlockType(line);
  if (ht >= 1 && ht <= 6) return true;
  if (tryTable(lines, j)) return true;
  return false;
}

// Strip a blockquote marker from a line; returns the rest or null.
// Leading tabs after the marker expand to spaces (original columns).
function stripBlockquote(line) {
  const { col, idx } = leadWs(line);
  if (col > 3) return null;
  if (line[idx] !== '>') return null;
  let pos = idx + 1, c = col + 1, out = '';
  if (line[pos] === ' ') { pos++; c++; }
  else if (line[pos] === '\t') {
    const w = 4 - (c % 4);
    out = ' '.repeat(w - 1);
    pos++; c += w;
  }
  while (pos < line.length) {
    const ch = line[pos];
    if (ch === ' ') { out += ' '; pos++; c++; }
    else if (ch === '\t') { const w = 4 - (c % 4); out += ' '.repeat(w); pos++; c += w; }
    else break;
  }
  return out + line.slice(pos);
}

// Parse a list marker at the start of a line. Returns
// {ordered, start, delim, contentCol, content, indent} or null.
function listMarker(line) {
  const { col, idx } = leadWs(line);
  if (col > 3) return null;
  const s = line.slice(idx);
  let m = /^([*+-])(?:[ \t]+|$)/.exec(s);
  let ordered = false, start = 0, mlen = 0, bullet = null, delim = null;
  if (m) { mlen = 1; bullet = m[1]; }
  else {
    m = /^(\d{1,9})([.)])(?:[ \t]+|$)/.exec(s);
    if (!m) return null;
    ordered = true; start = parseInt(m[1], 10); mlen = m[1].length + 1; delim = m[2];
  }
  // separation columns after the marker (tabs expand)
  let c = col + mlen, p = idx + mlen, sep = 0;
  while (p < line.length && (line[p] === ' ' || line[p] === '\t')) {
    if (line[p] === ' ') { sep++; c++; p++; }
    else { const w = 4 - (c % 4); sep += w; c += w; p++; }
  }
  const rest = line.slice(p);
  if (rest === '') {
    // empty item: content indent is marker width + 1
    return { ordered, start, bullet, delim, contentCol: col + mlen + 1, content: '', indent: col, empty: true };
  }
  if (sep === 0) return null;
  if (sep >= 5) {
    // content indent = marker width + 1; extra spaces stay in content
    const cc = col + mlen + 1;
    return { ordered, start, bullet, delim, contentCol: cc, content: stripCols(line, cc), indent: col, empty: false };
  }
  return { ordered, start, bullet, delim, contentCol: c, content: rest, indent: col, empty: false };
}

// Collect a list starting at lines[i]. Returns {tok, next}.
function lexList(lines, i, refs, trailNL) {
  const first = listMarker(lines[i]);
  const ordered = first.ordered;
  const items = [];
  let j = i;
  let loose = false;
  let start = first.start;
  let prevTrail = 0;
  while (j < lines.length) {
    const lm = listMarker(lines[j]);
    if (!lm) break;
    if (HR_RE.test(lines[j])) break;
    if (lm.ordered !== ordered) break;
    if (ordered ? lm.delim !== first.delim : lm.bullet !== first.bullet) break;
    // a blank-line gap before a later item makes the list loose
    if (items.length > 0 && prevTrail > 0) loose = true;
    const r = collectItem(lines, j, lm, refs, trailNL);
    if (r.innerBlank) loose = true;
    items.push(r.item);
    prevTrail = r.trailBlanks;
    j = r.next;
  }
  // trailing blank lines before a following block separate the list
  // from that block (matters for looseness at the enclosing level)
  const trailBlank = prevTrail > 0 && j < lines.length;
  return { tok: { t: 'list', ordered, start, loose, items }, next: j, trailBlank };
}

// Does the previous dedented line (marked's `m`) end a list item for a
// following outdented (lazy) line? Mirrors the list-item loop's
// else-branch: a lazy line cannot follow a previous line that starts a
// fence / heading / html block / hr (with the indent allowance clamped
// to contentCol-1, as in marked's D() regex cache) or is indented code
// (>= 4 leading spaces after tab expansion).
function prevLineBreaksLazy(prev, contentCol) {
  const exp = prev.replace(/\t/g, '    ');
  if (exp.search(/[^ ]/) >= 4) return true;
  const a = Math.max(0, Math.min(3, contentCol - 1));
  if (new RegExp(`^ {0,${a}}(?:\`{3,}|~{3,})`).test(prev)) return true;
  if (new RegExp(`^ {0,${a}}#{1,6}(?:\\s|$)`).test(prev)) return true;
  if (new RegExp(`^ {0,${a}}((?:-[ \\t]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})[ \\t]*(?:\\n|$)`).test(prev)) return true;
  const lead = (/^ */.exec(prev) || [''])[0].length;
  if (lead <= a) {
    const ht = htmlBlockType(prev);
    if (ht >= 1 && ht <= 6) return true;
  }
  return false;
}

function collectItem(lines, j, lm, refs, trailNL) {
  const contentCol = lm.contentCol;
  let firstContent = lm.content;
  let task = false, checked = false;
  const tm = /^\[([ xX])\][ \t]+(.*)$/.exec(firstContent);
  if (tm && tm[2].trim() !== '') {
    task = true; checked = tm[1] === 'x' || tm[1] === 'X';
    firstContent = tm[2];
  }
  const itemLines = [firstContent];
  const lazySetext = new Set();
  let k = j + 1;
  let blanks = 0;
  // previous line's content from column contentCol onward (marked's `m`);
  // a lazy setext line forms a heading only when this is empty/invalid.
  let prevM = firstContent;
  // an empty item followed by a blank line has no content at all;
  // the blank line is consumed and the list continues after it
  if (firstContent === '' && k < lines.length && isBlank(lines[k])) {
    const toks = [];
    return { item: { toks, task, checked }, next: j + 2, innerBlank: false, trailBlanks: 1 };
  }
  while (k < lines.length) {
    const l2 = lines[k];
    if (isBlank(l2)) { blanks++; k++; continue; }
    const lm2 = listMarker(l2);
    if (lm2 && lm2.indent < contentCol) break;
    if (indentCols(l2) >= contentCol) {
      for (let b = 0; b < blanks; b++) itemLines.push('');
      blanks = 0;
      const ded = stripCols(l2, contentCol);
      itemLines.push(ded);
      prevM = ded;
      k++; continue;
    }
    // lazy line: no blank gap allowed; an HR at this level ends the item
    if (blanks > 0) break;
    if (HR_RE.test(l2)) break;
    if (startsBlock(lines, k, true, false)) break;
    // a fence / heading / html / hr / indented-code line consumed into
    // the item leaves the following outdented lines outside it (the
    // fence inside the item is empty; its would-be content becomes
    // top-level blocks)
    if (prevLineBreaksLazy(prevM, contentCol)) break;
    if (SETEXT_RE.test(l2) && lheadingPrevOk(prevM)) {
      lazySetext.add(itemLines.length);
      itemLines.push(l2);
    } else {
      itemLines.push(l2);
    }
    prevM = stripCols(l2, contentCol);
    k++;
  }
  const toks = lexLines(itemLines, refs, trailNL && k >= lines.length, lazySetext, undefined, false);
  // looseness: a blank line separating two blocks at this item's level
  // (blank lines inside a fence or a nested item do not count)
  return { item: { toks, task, checked }, next: k, innerBlank: !!toks.hasSpaceSep, trailBlanks: blanks };
}

// Does `prev` (a single line of paragraph text) plus a setext underline
// form a valid setext heading? Mirrors marked's lheading lookahead:
// the text must be non-empty and not start a block construct.
function lheadingPrevOk(prev) {
  if (!prev || !prev.trim()) return false;
  if (/^ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|$)/.test(prev)) return false;
  if (/^(?: {4}| {0,3}\t)/.test(prev)) return false;
  if (isFenceLine(prev)) return false;
  if (/^ {0,3}>/.test(prev)) return false;
  if (/^ {0,3}#{1,6}(?:\s|$)/.test(prev)) return false;
  if (htmlBlockType(prev)) return false;
  return true;
}

// Render one inline node list to HTML.
function renderNodes(nodes) {
  let out = '';
  for (const nd of nodes) {
    if (nd.k === 't') {
      out += esc(nd.s);
    } else if (nd.k === 'ent') {
      out += nd.s;
    } else if (nd.k === 'br') {
      out += '<br>';
    } else if (nd.k === 'code') {
      out += '<code>' + esc(nd.s) + '</code>';
    } else if (nd.k === 'html') {
      out += nd.s;
    } else if (nd.k === 'link' || nd.k === 'img') {
      out += renderLink(nd);
    } else if (nd.k === 'delim') {
      const left = nd.ch.repeat(Math.max(0, nd.n - (nd.usedOpen || 0) - (nd.usedClose || 0)));
      if (nd.open && !nd.close) {
        out += left;
        for (const t of nd.open) out += t;
      } else if (nd.close && !nd.open) {
        for (const t of nd.close) out += t;
        out += left;
      } else {
        out += left;
        if (nd.open) for (const t of nd.open) out += t;
        if (nd.close) for (const t of nd.close) out += t;
      }
    } else if (nd.k === 'open') {
      out += nd.img ? '![' : '[';
    } else if (nd.k === 'autolink') {
      const h = cleanUrl(nd.href);
      out += '<a href="' + escAttr(h === null ? nd.href : h) + '">' + escAttr(nd.text) + '</a>';
    }
  }
  return out;
}

function renderLink(nd) {
  const href = cleanUrl(unescBackslash(nd.href));
  const h = href === null ? '' : escAttr(href);
  if (nd.k === 'img') {
    let s = '<img src="' + h + '" alt="' + nd.alt + '"';
    if (nd.title !== null && nd.title !== undefined) s += ' title="' + escAttr(unescBackslash(nd.title)) + '"';
    return s + '>';
  }
  let s = '<a href="' + h + '"';
  if (nd.title !== null && nd.title !== undefined) s += ' title="' + escAttr(unescBackslash(nd.title)) + '"';
  return s + '>' + renderNodes(nd.kids) + '</a>';
}

// Marked's extended-autolink backpedal: repeatedly keep the longest
// prefix matching this until stable. A trailing run of punctuation is
// trimmed, but balanced (...) and a trailing &entity; are kept.
const BACKPEDAL_RE = /(?:[^?!.,:;*_'\"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'\"~)]+(?!$))+/;
function backpedalUrl(u) {
  let prev;
  do { prev = u; u = (BACKPEDAL_RE.exec(u) || [''])[0]; } while (u !== prev);
  return u;
}

// End of a link label starting just after '[' at `i`: the index of the
// ']' that closes it, or -1 if the label never closes. Mirrors marked's
// inline-link label pattern `re`: balanced nested brackets, escapes,
// and code spans (a backtick run + backtick-free content + any backtick
// run, or 2+ backticks immediately before ']'). A backtick run that
// cannot close a code span ends the label there.
function findLabelEnd(src, i) {
  let depth = 0;
  let j = i;
  const N = src.length;
  while (j < N) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '`') {
      let k = j, n = 0;
      while (k < N && src[k] === '`') { k++; n++; }
      if (n >= 2 && src[k] === ']') return k;
      let m = k;
      while (m < N && src[m] !== '`') m++;
      if (m >= N) return -1;
      let e = m;
      while (e < N && src[e] === '`') e++;
      j = e;
      continue;
    }
    if (c === '[') { depth++; j++; continue; }
    if (c === ']') {
      if (depth === 0) return j;
      depth--; j++; continue;
    }
    j++;
  }
  return -1;
}

// Parse inline markdown to HTML. `ctx.refs` maps normalized labels to
// {href,title} for reference links (first definition wins). `ctx.inLink`
// mirrors marked's Lexer.state.inLink: set by a literal `<a ` open tag,
// cleared by `</a>`, persisted across the whole document, and snapshotted
// / restored around each link's text. While it is true, extended
// autolinks (bare URLs and emails) do not form.
function parseInline(src, ctx) {
  const refs = ctx.refs;
  const nodes = [];
  const delims = [];
  const brackets = []; // {idx, img, active, srcPos, labelEnd}
  let buf = '';
  // label end of the innermost open bracket (cached on the record):
  // -1 when there is no open bracket or its label never closes
  const labelEndOf = (br) => {
    if (br.labelEnd === undefined) br.labelEnd = findLabelEnd(src, br.srcPos);
    return br.labelEnd;
  };
  const activeBracket = () => {
    for (let b = brackets.length - 1; b >= 0; b--) {
      if (brackets[b].active) return brackets[b];
    }
    return null;
  };
  const activeLabelEnd = () => {
    const br = activeBracket();
    return br ? labelEndOf(br) : -1;
  };
  // does the label text scanned so far already contain a link? Such a
  // bracket can never form a link (marked drops a link whose text
  // emitted a link), so a URL / code span inside it is plain paragraph
  // text and must not be bounded by the label end
  const labelHasLink = (br) => {
    for (let q = br.idx + 1; q < nodes.length; q++) if (nodes[q].k === 'link') return true;
    return false;
  };
  // the label end that bounds a URL / code span, or -1 for unbounded:
  // only a bracket that may still form a link (an image, or a label
  // with no link in it yet) bounds its contents
  const boundingLabelEnd = () => {
    const br = activeBracket();
    if (!br) return -1;
    if (!br.img && labelHasLink(br)) return -1;
    return labelEndOf(br);
  };
  const flush = () => { if (buf) { nodes.push({ k: 't', s: buf }); buf = ''; } };
  const pushDelim = (ch, n, before, after) => {
    const [lb, rb] = flanking(before, after);
    let open = lb, close = rb;
    if (ch === '_') {
      open = lb && (!rb || isPunct(before));
      close = rb && (!lb || isPunct(after));
    }
    delims.push({ ch, n, open, close, idx: nodes.length });
    nodes.push({ k: 'delim', ch, n, open: null, close: null });
  };
  const hardBreak = (force) => {
    if (force) { flush(); nodes.push({ k: 'br' }); return true; }
    let b = buf;
    if (b.length >= 2 && b.endsWith('  ')) {
      buf = b.replace(/ +$/, '');
      flush(); nodes.push({ k: 'br' }); return true;
    }
    if (b) { flush(); }
    const last = nodes[nodes.length - 1];
    if (last && last.k === 't' && / $/.test(last.s)) {
      const m = / +$/.exec(last.s);
      if (m[0].length >= 2) { last.s = last.s.slice(0, -m[0].length); nodes.push({ k: 'br' }); return true; }
    }
    buf += '\n';
    return false;
  };

  let i = 0;
  const N = src.length;
  while (i < N) {
    const c = src[i];
    // fast path: an alphanumeric inside a word (previous char is an
    // email local-part char) is plain text; consume the rest of the
    // word in bulk. The email/URL, if any, was already handled from
    // the word start.
    if (c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9') {
      if (i > 0) {
        const pvCode = src.charCodeAt(i - 1);
        if (pvCode < 128 && EMAIL_LOCAL[pvCode] === 1) {
          let j = i;
          while (j < N) {
            const code = src.charCodeAt(j);
            if (code >= 128 || EMAIL_LOCAL[code] !== 1) break;
            // never swallow a delimiter / entity / image starter
            if (code === 42 || code === 95 || code === 126 || code === 96 || code === 38 || code === 33) break;
            j++;
          }
          buf += src.slice(i, j);
          i = j;
          continue;
        }
      }
    }
    if (c === '\\') {
      const n = src[i + 1];
      if (n === '\n') { hardBreak(true); i += 2; while (i < N && (src[i] === ' ' || src[i] === '\t')) i++; continue; }
      if (n !== undefined && PUNCT.has(n)) { buf += n; i += 2; continue; }
      buf += '\\'; i++; continue;
    }
    if (c === '\n') { const didBr = hardBreak(); i++; if (didBr) while (i < N && (src[i] === ' ' || src[i] === '\t')) i++; continue; }
    if (c === '`') {
      let j = i, n = 0;
      while (j < N && src[j] === '`') { j++; n++; }
      // inside a link label a code span must close before the label
      // ends (marked tokenizes the label's code spans within the
      // label); bound the equal-run search by the label end so it
      // cannot swallow the '](...)' that follows the label
      const bound = boundingLabelEnd();
      const limit = bound >= 0 ? bound : N;
      let close = -1, k = j;
      while (k < limit) {
        if (src[k] === '`') {
          let m = k, cnt = 0;
          while (m < N && src[m] === '`') { m++; cnt++; }
          if (cnt === n) { close = k; break; }
          k = m;
        } else k++;
      }
      if (close < 0) { buf += '`'.repeat(n); i = j; continue; }
      let content = src.slice(j, close).replace(/\n/g, ' ');
      if (content.length >= 2 && content[0] === ' ' && content[content.length - 1] === ' ' && /[^ ]/.test(content)) {
        content = content.slice(1, -1);
      }
      flush();
      nodes.push({ k: 'code', s: content });
      i = close + n;
      continue;
    }
    if (c === '<') {
      const rest = src.slice(i);
      const al = scanAutolink(rest);
      if (al) {
        flush();
        nodes.push({ k: 'autolink', href: al[0], text: al.length > 2 ? al[2] : al[0] });
        i += al[1];
        continue;
      }
      const ht = scanHtmlTag(rest);
      if (ht) {
        flush();
        nodes.push({ k: 'html', s: ht[0] });
        // marked's Lexer.state.inLink: a literal "<a " tag opens it,
        // "</a>" closes it (case-insensitive); other tags leave it.
        if (!ctx.inLink && /^<a /i.test(ht[0])) ctx.inLink = true;
        else if (ctx.inLink && /^<\/a>/i.test(ht[0])) ctx.inLink = false;
        i += ht[1];
        continue;
      }
      buf += '<'; i++; continue;
    }
    if (c === '[' || (c === '!' && src[i + 1] === '[')) {
      const img = c === '!';
      flush();
      brackets.push({ idx: nodes.length, img, active: true, srcPos: i + (img ? 2 : 1), inLink: ctx.inLink });
      nodes.push({ k: 'open', img });
      i += img ? 2 : 1;
      continue;
    }
    if (c === ']') {
      flush();
      let bi = brackets.length - 1;
      while (bi >= 0 && !brackets[bi].active) bi--;
      if (bi < 0) { buf += ']'; i++; continue; }
      const br = brackets[bi];
      // the label must close here (marked's label pattern): a ']' that
      // is not the label end is literal text inside the label, and a
      // label that never closes can never form a link
      const labelEnd = labelEndOf(br);
      if (labelEnd < 0) {
        br.active = false;
        buf += ']'; i++;
        continue;
      }
      if (labelEnd !== i) { buf += ']'; i++; continue; }
      const textNodes = nodes.slice(br.idx + 1);
      // a link cannot contain another link
      let hasLink = false;
      for (const tn of textNodes) if (tn.k === 'link') { hasLink = true; break; }
      let made = null;
      const after = src.slice(i + 1);
      // raw text between the brackets: the shortcut label is matched
      // verbatim (backslashes preserved), not after unescaping
      const rawText = src.slice(br.srcPos, i);
      // a link may not contain a link, but an image's alt text may
      // (the inner link renders as plain text in the alt)
      if (!hasLink || br.img) {
        if (after[0] === '(') {
          const lt = scanLinkTarget(after);
          if (lt) made = { href: lt.href, title: lt.title, len: lt.len };
        }
        if (!made) {
          // reference link: [label], [], or shortcut (also the fallback
          // when an inline link's destination is invalid)
          let lab = null, adv = 0;
          if (after[0] === '[') {
            const e = after.indexOf(']', 1);
            if (e >= 0) { lab = after.slice(1, e); adv = e + 1; }
          }
          if (lab === null || lab === '') lab = rawText;
          if (lab !== null) {
            const ref = refs.get(normLabel(lab));
            if (ref) made = { href: ref.href, title: ref.title, len: adv };
          }
        }
      }
      if (made) {
        // a link's text cannot contain an EXTENDED autolink (a bare
        // URL/email): those flatten back to plain text. An explicit
        // <...> autolink stays nested (marked nests it).
        const kids = textNodes;
        const flattenAuto = (arr) => {
          for (let q = 0; q < arr.length; q++) {
            if (arr[q].k === 'autolink' && arr[q].ext) arr[q] = { k: 't', s: arr[q].text };
            else if (arr[q].k === 'link') flattenAuto(arr[q].kids);
          }
        };
        flattenAuto(kids);
        // resolve emphasis inside the link text first
        const sub = [];
        for (let d = 0; d < delims.length; d++) {
          if (delims[d].idx > br.idx) sub.push(delims[d]);
        }
        // rebase sub-delimiter indices to the text node slice
        resolveEmphasis(kids, sub.map((d) => ({ ...d, idx: d.idx - br.idx - 1 })));
        const nd = {
          k: br.img ? 'img' : 'link', href: made.href, title: made.title,
          kids: br.img ? null : kids, alt: br.img ? altText(kids) : null,
        };
        // drop consumed delimiters and brackets inside the link
        for (let d = delims.length - 1; d >= 0; d--) if (delims[d].idx > br.idx) delims.splice(d, 1);
        for (let b = brackets.length - 1; b >= bi; b--) brackets.splice(b, 1);
        nodes.length = br.idx;
        nodes.push(nd);
        ctx.inLink = br.inLink; // marked restores inLink after link text
        i += 1 + made.len;
        continue;
      }
      // not a link: deactivate this opener, ']' is literal text
      br.active = false;
      buf += ']'; i++;
      continue;
    }
    if (c === '*' || c === '_') {
      let j = i, n = 0;
      while (j < N && src[j] === c) { j++; n++; }
      flush();
      pushDelim(c, n, src[i - 1], src[j]);
      i = j;
      continue;
    }
    if (c === '~') {
      let j = i, n = 0;
      while (j < N && src[j] === '~') { j++; n++; }
      // a run of 1 or 2 tildes can delimit; 3+ cannot form strikethrough
      if (n === 1 || n === 2) {
        flush();
        pushDelim('~', n, src[i - 1], src[j]);
        i = j; continue;
      }
      buf += '~'.repeat(n); i = j; continue;
    }
    if (c === '&') {
      const rest = src.slice(i);
      const d = decodeNumeric(rest);
      if (d) { buf += d[0]; i += d[1]; continue; }
      const m = /^&[A-Za-z][A-Za-z0-9]*;/.exec(rest);
      if (m) { flush(); nodes.push({ k: 'ent', s: m[0] }); i += m[0].length; continue; }
      buf += '&'; i++; continue;
    }
    if ((c === 'm' || c === 'x') && !ctx.inLink) {
      // mailto: / xmpp: + email is a single autolink (xmpp may add one
      // /path segment); only at a word boundary
      const prev = src[i - 1];
      if (prev === undefined || !/[A-Za-z0-9]/.test(prev)) {
        const rest = src.slice(i);
        const sm = /^(mailto|xmpp):/.exec(rest);
        if (sm) {
          const afterScheme = rest.slice(sm[0].length);
          const em = EMAIL_RE.exec(afterScheme);
          if (em) {
            const full = em[0];
            const at = full.indexOf('@');
            const dom = full.slice(at + 1);
            const nx = afterScheme[full.length];
            // a trailing - (or a lone _) means the domain is invalid;
            // a run of __ is an emphasis delimiter, not part of the domain
            let badTail = nx === '@' || nx === '-';
            if (nx === '_') {
              let run = 0;
              while (afterScheme[full.length + run] === '_') run++;
              badTail = run === 1;
            }
            if (dom.includes('.') && !/[._-]$/.test(dom) && !badTail) {
              let url = sm[0] + full;
              if (sm[1] === 'xmpp') {
                const pm = /^\/[A-Za-z0-9@.]+/.exec(afterScheme.slice(full.length));
                if (pm) url += pm[0];
              }
              flush();
              nodes.push({ k: 'autolink', ext: true, href: url, text: url });
              i += url.length;
              continue;
            }
          }
        }
      }
    }
    if ((c === 'h' || c === 'w' || c === 'H' || c === 'W') && !ctx.inLink) {
      const rest = src.slice(i);
      const m = EXT_URL_RE.exec(rest);
      if (m) {
        // a URL inside a link label cannot swallow the ']' that closes
        // the label (marked matches the link first): truncate to the
        // label end, then backpedal
        let raw = m[0];
        const bound = boundingLabelEnd();
        if (bound >= 0 && i + raw.length > bound) raw = raw.slice(0, bound - i);
        const u = backpedalUrl(raw);
        const isWww = u.startsWith('www.');
        const ok = u.length > 0 && (isWww
          ? /^www\.[^\s\/]+/.test(u)
          : /^[Hh][Tt][Tt][Pp][Ss]?:\/\/[^\s\/]+/.test(u));
        if (ok) {
          flush();
          const href = u.startsWith('www.') ? 'http://' + u : u;
          nodes.push({ k: 'autolink', ext: true, href, text: u });
          i += u.length;
          continue;
        }
      }
      // not a URL: fall through to the email check below (an email
      // local part may start with h or w)
    }
    if (c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c === '_' || c === '.' || c === '-' || c === '+' || c === '%' || c === '*' || c === "'" || c === '#' || c === '$' || c === '!' || c === '?' || c === '^' || c === '`' || c === '{' || c === '|' || c === '}') {
      // an email can only start at a word boundary (previous char is
      // not an email local-part character); otherwise the regex would
      // match a suffix of the word and run on every character
      const pv = src[i - 1];
      const atBoundary = !isEmailLocal(pv);
      const rest = atBoundary ? src.slice(i) : '';
      const m = atBoundary ? EMAIL_RE.exec(rest) : null;
      // a trailing - (or a lone _) means the domain is invalid, not a
      // link; a run of __, or a lone _ that closes an open _ emphasis,
      // is a delimiter, not part of the domain
      let badTail = false;
      if (m) {
        const nx = rest[m[0].length];
        badTail = nx === '@' || nx === '-';
        if (nx === '_') {
          let run = 0;
          while (rest[m[0].length + run] === '_') run++;
          if (run === 1) {
            badTail = !delims.some((d) => d.ch === '_' && d.open && d.n > 0);
          }
        }
      }
      if (m && !badTail && !ctx.inLink) {
        const em = m[0];
        const at = em.indexOf('@');
        const dom = em.slice(at + 1);
        if (dom.includes('.') && !/[._-]$/.test(dom)) {
          flush();
          nodes.push({ k: 'autolink', ext: true, href: 'mailto:' + em, text: em });
          i += em.length;
          continue;
        }
      }
      buf += c; i++; continue;
    }
    buf += c; i++;
  }
  flush();
  resolveEmphasis(nodes, delims);
  return renderNodes(nodes);
}

// Raw plain text of inline nodes (for link labels).
function labelText(nodes) {
  let out = '';
  for (const nd of nodes) {
    if (nd.k === 't') out += nd.s;
    else if (nd.k === 'ent') out += nd.s;
    else if (nd.k === 'code') out += nd.s;
    else if (nd.k === 'br') out += '\n';
    else if (nd.k === 'link') out += labelText(nd.kids);
    else if (nd.k === 'img') out += nd.alt;
    else if (nd.k === 'autolink') out += nd.text;
    else if (nd.k === 'delim') out += nd.ch.repeat(Math.max(0, nd.n - (nd.usedOpen || 0) - (nd.usedClose || 0)));
    else if (nd.k === 'open') out += nd.img ? '![' : '[';
    else if (nd.k === 'html') { /* inline html contributes nothing */ }
  }
  return out;
}

// Plain text of inline nodes, escaped for an image alt attribute
// (entity references stay verbatim, everything else is escaped).
function altText(nodes) {
  let out = '';
  for (const nd of nodes) {
    if (nd.k === 't') out += esc(nd.s);
    else if (nd.k === 'ent') out += nd.s;
    else if (nd.k === 'code') out += esc(nd.s);
    else if (nd.k === 'br') out += '\n';
    else if (nd.k === 'link') out += altText(nd.kids);
    else if (nd.k === 'img') out += nd.alt;
    else if (nd.k === 'autolink') out += escAttr(nd.text);
    else if (nd.k === 'delim') out += nd.ch.repeat(Math.max(0, nd.n - (nd.usedOpen || 0) - (nd.usedClose || 0)));
    else if (nd.k === 'open') out += nd.img ? '![' : '[';
    else if (nd.k === 'html') { /* inline html contributes nothing */ }
  }
  return out;
}

// ===================== renderer =====================

function renderToks(toks, ctx) {
  let out = '';
  for (const tk of toks) out += renderTok(tk, ctx);
  return out;
}

function renderTok(tk, ctx) {
  switch (tk.t) {
    case 'p': return '<p>' + parseInline(tk.text, ctx) + '</p>\n';
    case 'h': return '<h' + tk.level + '>' + parseInline(tk.text, ctx) + '</h' + tk.level + '>\n';
    case 'hr': return '<hr>\n';
    case 'code': {
      const cls = tk.lang ? ' class="language-' + escAttr(tk.lang) + '"' : '';
      return '<pre><code' + cls + '>' + esc(tk.text) + '</code></pre>\n';
    }
    case 'html': return tk.text;
    case 'bq': return '<blockquote>\n' + renderToks(tk.toks, ctx) + '</blockquote>\n';
    case 'table': return renderTable(tk, ctx);
    case 'list': return renderList(tk, ctx);
    default: return '';
  }
}

function renderTable(tk, ctx) {
  let out = '<table>\n<thead>\n<tr>\n';
  for (let c = 0; c < tk.head.length; c++) {
    const a = tk.align[c];
    out += '<th' + (a ? ' align="' + a + '"' : '') + '>' + parseInline(tk.head[c], ctx) + '</th>\n';
  }
  out += '</tr>\n</thead>\n';
  if (tk.rows.length) {
    out += '<tbody>';
    for (const row of tk.rows) {
      out += '<tr>\n';
      for (let c = 0; c < tk.head.length; c++) {
        const a = tk.align[c];
        const cell = c < row.length ? row[c] : '';
        out += '<td' + (a ? ' align="' + a + '"' : '') + '>' + parseInline(cell, ctx) + '</td>\n';
      }
      out += '</tr>\n';
    }
    out += '</tbody></table>\n';
  } else {
    out += '</table>\n';
  }
  return out;
}

function renderList(tk, ctx) {
  const tag = tk.ordered ? 'ol' : 'ul';
  let out = '<' + tag + (tk.ordered && tk.start !== 1 ? ' start="' + tk.start + '"' : '') + '>\n';
  for (const item of tk.items) out += renderItem(item, tk.loose, ctx);
  return out + '</' + tag + '>\n';
}

function renderItem(item, loose, ctx) {
  const box = item.task
    ? (item.checked ? '<input checked="" disabled="" type="checkbox"> ' : '<input disabled="" type="checkbox"> ')
    : '';
  let body = '';
  const toks = item.toks;
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk.t === 'p' && !loose) {
      body += (i === 0 && box ? box : '') + parseInline(tk.text, ctx);
    } else if (tk.t === 'p') {
      body += '<p>' + (i === 0 && box ? box : '') + parseInline(tk.text, ctx) + '</p>\n';
    } else {
      body += (i === 0 && box ? box : '') + renderTok(tk, ctx);
    }
  }
  if (!toks.length && box) body = box.slice(0, -1);
  return '<li>' + body + '</li>\n';
}

export function parse(src) {
  const refs = new Map();
  const clean = src.replace(/\r\n?/g, '\n');
  const lines = clean.split('\n');
  const trailNL = clean.length > 0 && clean.endsWith('\n');
  const toks = lexLines(lines, refs, trailNL);
  const ctx = { refs, inLink: false };
  return renderToks(toks, ctx);
}



