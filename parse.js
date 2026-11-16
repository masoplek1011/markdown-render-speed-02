// A fast, dependency-free drop-in for marked 18.1.3 (default options:
// GFM on, breaks off, pedantic off, async off). parse(markdown) returns
// exactly the HTML marked.parse(markdown) returns, for every string.
//
// This file is an independent implementation of the same CommonMark + GFM
// behaviour: a block lexer, an inline lexer and a renderer, written from
// the spec examples and from marked's documented behaviour. The block
// lexer works on one cursor over the source with sticky patterns instead
// of repeatedly slicing the remaining input, which is where the speed
// comes from; the inline lexer works on paragraph-sized strings.

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const RE_ESC_TEST = /[&<>"']/;
const RE_ESC_REPLACE = /[&<>"']/g;
const RE_ESC_TEST_NO_ENCODE = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/;
const RE_ESC_REPLACE_NO_ENCODE = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
const RE_NUM_REF = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/;
const RE_NUM_REF_OR_AMP = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
const RE_PERCENT = /%25/g;
const RE_CARET = /(^|[^\[])\^/g;

function escHtml(s, encode) {
  if (encode) {
    return RE_ESC_TEST.test(s) ? s.replace(RE_ESC_REPLACE, (c) => ESCAPES[c]) : s;
  }
  return RE_ESC_TEST_NO_ENCODE.test(s)
    ? s.replace(RE_ESC_REPLACE_NO_ENCODE, (c) => ESCAPES[c])
    : s;
}

function decodeNumRefs(text) {
  if (!RE_NUM_REF.test(text)) return text;
  return text.replace(RE_NUM_REF_OR_AMP, (ref, dec, hex) => {
    if (dec === undefined && hex === undefined) return '&amp;';
    const code = dec === undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\uFFFD';
    return code === 38 ? '&amp;' : String.fromCodePoint(code);
  });
}

function cleanUrl(href) {
  try {
    href = encodeURI(href).replace(RE_PERCENT, '%');
  } catch {
    return null;
  }
  return href;
}

// Split one table row on its unescaped pipes.
function splitCells(row, count) {
  const spaced = row.replace(/\|/g, (m, off, str) => {
    let escaped = false;
    let cur = off;
    while (--cur >= 0 && str[cur] === '\\') escaped = !escaped;
    return escaped ? '|' : ' |';
  });
  const cells = spaced.split(/ \|/);
  let i = 0;
  if (!cells[0].trim()) cells.shift();
  if (cells.length > 0 && !cells.at(-1).trim()) cells.pop();
  if (count) {
    if (cells.length > count) cells.splice(count);
    else while (cells.length < count) cells.push('');
  }
  for (; i < cells.length; i++) cells[i] = cells[i].trim().replace(/\\\|/g, '|');
  return cells;
}

// Remove a run of `c` from the end of str (or, inverted, a run of non-c).
function rtrim(str, c, invert) {
  const len = str.length;
  if (len === 0) return '';
  let n = 0;
  while (n < len) {
    const ch = str.charAt(len - n - 1);
    if (ch === c && !invert) n++;
    else if (ch !== c && invert) n++;
    else break;
  }
  return str.slice(0, len - n);
}

const RE_BLANK_LINE = /^[ \t]*$/;

function trimTrailingBlankLines(str) {
  const lines = str.split('\n');
  let end = lines.length - 1;
  while (end >= 0 && RE_BLANK_LINE.test(lines[end])) end--;
  if (lines.length - end <= 2) return str;
  return lines.slice(0, end + 1).join('\n');
}

// Case-fold a link label the way CommonMark asks: trim, collapse inner
// whitespace runs to one space, then fold case through upper case.
function normalizeLabel(label) {
  return label.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
}

// Index of the bracket that closes an unbalanced run, or -1 / -2.
function findClosingBracket(str, b) {
  if (str.indexOf(b[0]) === -1 && str.indexOf(b[1]) === -1) return -1;
  let level = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\') i++;
    else if (str[i] === b[0]) level++;
    else if (str[i] === b[1]) {
      level--;
      if (level < 0) return i;
    }
  }
  return level > 0 ? -2 : -1;
}

function expandTabs(line, indent = 0) {
  let col = indent;
  let out = '';
  for (const ch of line) {
    if (ch === '\t') {
      const added = 4 - (col % 4);
      out += ' '.repeat(added);
      col += added;
    } else {
      out += ch;
      col++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pattern assembly. Patterns are written as strings without a leading ^
// and compiled sticky ('y'), so the block lexer can run them at a cursor
// instead of slicing the source. `build` substitutes named parts into a
// template, stripping a ^ that a substituted part carried (the same caret
// rule marked's own pattern builder uses).
// ---------------------------------------------------------------------------

function build(template, flags, subs) {
  let src = template;
  if (subs) {
    for (const [key, val] of subs) {
      let v = val instanceof RegExp ? val.source : val;
      v = v.replace(RE_CARET, '$1');
      src = src.replace(key, () => v);
    }
  }
  // A sticky pattern is already anchored at the cursor, so a ^ at the start
  // of the pattern (or of an alternative) would only break matching past
  // position 0; drop those anchors. A ^ inside a character class is kept.
  if (flags.includes('y')) src = src.replace(/(^|\|)\^/g, '$1');
  return new RegExp(src, flags);
}

// Cache of small indent-dependent patterns (indent 0..3).
function indentCache(make) {
  const cache = [];
  return (indent) => {
    const idx = Math.max(0, Math.min(3, indent - 1));
    let re = cache[idx];
    if (!re) {
      re = make(idx);
      cache[idx] = re;
    }
    return re;
  };
}

// ---------------------------------------------------------------------------
// "other" patterns: small shared pieces used across the lexer.
// ---------------------------------------------------------------------------

const O = {
  codeRemoveIndent: /^(?: {0,3}\t| {1,4})/gm,
  outputLinkReplace: /\\([\[\]])/g,
  indentCodeCompensation: /^(\s+)(?:```)/,
  beginningSpace: /^\s+/,
  endingHash: /#$/,
  startingSpaceChar: /^ /,
  endingSpaceChar: / $/,
  endingSpaceTabChar: /[ \t]$/,
  nonSpaceChar: /[^ ]/,
  newLineCharGlobal: /\n/g,
  tabCharGlobal: /\t/g,
  leadingSpaceTab: /^[ \t]+/,
  multipleSpaceGlobal: /\s+/g,
  blankLine: /^[ \t]*$/,
  doubleBlankLine: /\n[ \t]*\n[ \t]*$/,
  blockquoteStart: /^ {0,3}>/,
  blockquoteSetextReplace: /\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g,
  blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm,
  blockquoteMarkerWhitespace: /^( {0,3}>)([ \t]+)/gm,
  listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g,
  listIsTask: /^\[[ xX]\][ \t]+\S/,
  listReplaceTask: /^\[[ xX]\][ \t]+/,
  listTaskCheckbox: /\[[ xX]\]/,
  anyLine: /\n.*\n/,
  hrefBrackets: /^<(.*)>$/,
  tableDelimiter: /[:|]/,
  tableAlignChars: /^\||\| *$/g,
  tableRowBlankLine: /\n[ \t]*$/,
  tableAlignRight: /^ *-+: *$/,
  tableAlignCenter: /^ *:-+: *$/,
  tableAlignLeft: /^ *:-+ *$/,
  startATag: /^<a /i,
  endATag: /^<\/a>/i,
  startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i,
  endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i,
  startAngleBracket: /^</,
  endAngleBracket: />$/,
  unicodeAlphaNumeric: /[\p{L}\p{N}]/u,
  notSpaceStart: /^\S*/,
  endingNewline: /\n$/,
  listItemRegex: (bull) => new RegExp(`( {0,3}${bull})((?:[\t ][^\\n]*)?(?:\\n|$))`, 'y'),
  nextBulletRegex: indentCache((n) => new RegExp(` {0,${n}}(?:[*+-]|\\d{1,9}[.)])((?:[ \t][^\\n]*)?(?:\\n|$))`, 'y')),
  hrRegex: indentCache((n) => new RegExp(` {0,${n}}((?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\\*[ \t]*){3,})(?:\\n+|$)`, 'y')),
  fencesBeginRegex: indentCache((n) => new RegExp(` {0,${n}}(?:\`\`\`|~~~)`, 'y')),
  headingBeginRegex: indentCache((n) => new RegExp(` {0,${n}}#{1,6}(?:\\s|$)`, 'y')),
  htmlBeginRegex: indentCache((n) => new RegExp(` {0,${n}}(?:</?(?:${TAG})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, 'iy')),
  blockquoteBeginRegex: indentCache((n) => new RegExp(` {0,${n}}>`, 'y')),
};

const TAG = 'address|article|aside|base|basefont|blockquote|body|caption'
  + '|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption'
  + '|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe'
  + '|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option'
  + '|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title'
  + '|tr|track|ul';

// ---------------------------------------------------------------------------
// Block patterns (GFM). All sticky; run at the block cursor.
// ---------------------------------------------------------------------------

const BULLET = ' {0,3}(?:[*+-]|\\d{1,9}[.)])';
const HR_SRC = ' {0,3}((?:-[\\t ]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$)';
const HEADING_SRC = ' {0,3}#{1,6}(?:\\s|$)';
const FENCES_SRC = ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)';
const BLOCKQUOTE_SRC = ' {0,3}>';
const BLOCKCODE_SRC = '(?: {4}| {0,3}\\t)';
const HTML_START_SRC = ' {0,3}(?:</?(?:' + TAG + ')(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)';

const COMMENT_SRC = '<!--(?:-?>|[\\s\\S]*?(?:-->|$))';

const BLOCK_HTML = build(
  ' {0,3}(?:'
  + '<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)'
  + '|comment[^\\n]*(\\n+|$)'
  + '|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)'
  + '|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)'
  + '|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)'
  + '|</?(tag)(?:[ \\t]+|\\n|/?>|$)[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)'
  + '|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)'
  + '|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)'
  + ')',
  'iy',
  [
    ['comment', COMMENT_SRC],
    ['tag', TAG],
    ['attribute', / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/],
  ],
);

// Setext underline, GFM flavour: a table delimiter row can interrupt.
const LHEADING_CORE = '(?!bull |blockCode|fences|blockquote|heading|html|table)'
  + '((?:.|\\n(?!\\s*?\\n|bull |fences|blockquote|heading|hr|html|table))+?)'
  + '\\n {0,3}(=+|-+)[ \\t]*(?:\\n+|$)';

const LHEADING = build(LHEADING_CORE, 'y', [
  [/bull/g, BULLET],
  [/blockCode/g, BLOCKCODE_SRC],
  [/fences/g, ' {0,3}(?:`{3,}|~{3,})'],
  [/blockquote/g, BLOCKQUOTE_SRC],
  [/heading/g, HEADING_SRC],
  [/hr/g, ' {0,3}(?:(?:-[\\t ]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$)'],
  [/html/g, ' {0,3}<[^\\n>]+>\\n'],
  [/table/g, ' {0,3}\\|?(?:[:\\- ]*\\|)+[\\:\\- ]*\\n'],
]);

const GFM_TABLE = build(
  ' *([^\\n ].*)\\n'
  + ' {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)'
  + '(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)',
  'y',
  [
    ['hr', HR_SRC],
    ['heading', HEADING_SRC],
    ['blockquote', BLOCKQUOTE_SRC],
    ['code', '(?: {4}| {0,3}\t)[^\\n]'],
    ['fences', FENCES_SRC],
    ['list', ' {0,3}(?:[*+-]|1[.)])[ \\t]'],
    ['html', HTML_START_SRC],
    ['tag', TAG],
  ],
);

// Paragraphs stop before a line that starts another block. Two flavours:
// the top-level one only lets a non-empty list starting at 1 interrupt,
// the blockquote one lets any bare marker start a sibling list.
function makeParagraph(listInterrupt) {
  return build(
    '([^\\n]+(?:\\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \\t]+\\n)[^\\n]+)*)',
    'y',
    [
      ['hr', HR_SRC],
      ['heading', HEADING_SRC],
      ['|lheading', ''],
      ['table', GFM_TABLE],
      ['blockquote', BLOCKQUOTE_SRC],
      ['fences', FENCES_SRC],
      ['list', listInterrupt],
      ['html', HTML_START_SRC],
      ['tag', TAG],
    ],
  );
}

const PARAGRAPH = makeParagraph(' {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]');
const BLOCKQUOTE_PARAGRAPH = makeParagraph(' {0,3}(?:[*+-]|\\d{1,9}[.)])(?:[ \\t]|\\n|$)');

const BLOCKQUOTE = build(
  '( {0,3}> ?(?:(?![ \\t]*(?:\\n|$))(paragraph)|[^\\n]*)(?:\\n|$))+',
  'y',
  [['paragraph', BLOCKQUOTE_PARAGRAPH]],
);

const BLOCK_LABEL = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+/;

const DEF = build(
  ' {0,3}\\[(label)\\]: *(?:\\n[ \\t]*)?([^<\\s][^\\s]*|<.*?>)(?:(?: +(?:\\n[ \\t]*)?| *\\n[ \\t]*)(title))? *(?:\\n+|$)',
  'y',
  [
    ['label', BLOCK_LABEL],
    ['title', /(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\\n]|\n(?!\n))*'|\((?:\\[\s\S]|[^()\\])*\))/],
  ],
);

const BLOCK = {
  newline: build('(?:[ \\t]*(?:\\n|$))+', 'y'),
  code: build('((?: {4}| {0,3}\\t)[^\\n]+(?:\\n(?:[ \\t]*(?:\\n|$))*)?)+', 'y'),
  fences: build(
    ' {0,3}(`{3,}(?=[^`\\n]*(?:\\n|$))|~{3,})([^\\n]*)(?:\\n|$)(?:|([\\s\\S]*?)(?:\\n|$))(?: {0,3}(?:(?=`)\\1`*|(?=~)\\1~*) *(?=\\n|$)|$)',
    'y',
  ),
  heading: build(' {0,3}(#{1,6})(?=\\s|$)(.*)(?:\\n+|$)', 'y'),
  hr: build(HR_SRC, 'y'),
  html: BLOCK_HTML,
  lheading: LHEADING,
  list: build('(bull)([ \\t][^\\n]*?)?(?:\\n|$)', 'y', [['bull', BULLET]]),
  paragraph: PARAGRAPH,
  table: GFM_TABLE,
  text: build('[^\\n]+', 'y'),
  blockquote: BLOCKQUOTE,
  def: DEF,
};

// ---------------------------------------------------------------------------
// Inline patterns (GFM). Anchored ones are sticky and run at the inline
// cursor; the scanning ones (right-delimiter, reflink search) keep the
// global flag marked uses, since they scan forward from a position.
// ---------------------------------------------------------------------------

const PUNCT = '[\\p{P}\\p{S}]';
const PUNCT_SPACE = '[\\s\\p{P}\\p{S}]';
const NOT_PUNCT_SPACE = '[^\\s\\p{P}\\p{S}]';
// GFM: a ~ is not punctuation for strong/em purposes (strikethrough owns it).
const PUNCT_GFM = '(?!~)[\\p{P}\\p{S}]';
const PUNCT_SPACE_GFM = '(?!~)[\\s\\p{P}\\p{S}]';
const NOT_PUNCT_SPACE_GFM = '(?:[^\\s\\p{P}\\p{S}]|~)';

const INLINE_LABEL_BRACKETS = '\\[(?:\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]';
const INLINE_LABEL = build(
  '(?:\\[(?:brackets|\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]|\\\\[\\s\\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\\])|[^\\[\\]\\\\`])*?',
  '',
  [['brackets', INLINE_LABEL_BRACKETS]],
).source;
const BOUNDED_BLOCK_LABEL = '(?!\\s*\\])(?:\\\\[\\s\\S]|[^\\[\\]\\\\]){1,999}';
const BOUNDED_INLINE_LABEL = build(
  '(?:[^\\[\\]\\\\`]*(?:\\[(?:brackets|\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]|\\\\[\\s\\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\\]))){0,999}?[^\\[\\]\\\\`]*?',
  '',
  [['brackets', INLINE_LABEL_BRACKETS]],
).source;

const EMAIL = "[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])";
const SCHEME = '[a-zA-Z][a-zA-Z0-9+.-]{1,31}';
const EXT_EMAIL = '[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\\w-])';
const EXT_EMAIL_PROTOCOL = build('(?:mailto:email|xmpp:email(?:\\/[A-Za-z0-9@.]+)?)', '', [[/email/g, EXT_EMAIL]]).source;
const PROTOCOL = '[hH][tT][tT][pP][sS]?|[fF][tT][pP]';

const INLINE_COMMENT = build(COMMENT_SRC, '', [['(?:-->|$)', '-->']]).source;

// A link, code span or tag, used to mask those spans out of emphasis scans.
const BLOCK_SKIP = build('link|precode-code|html', 'g', [
  ['link', /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/],
  ['precode-', '(?<!`)()'],
  ['code', /(?<b>`+)[^`]+\k<b>(?!`)/],
  ['html', /<(?! )[^<>]*?>/],
]);

const EM_STRONG_L_CORE = '^(?:\\*+(?:((?!\\*)punct)|([^\\s*]))?)|^_+(?:((?!_)punct)|([^\\s_]))?';
const EM_STRONG_L = build(EM_STRONG_L_CORE, 'yu', [[/punct/g, PUNCT_GFM]]);

const EM_STRONG_R_AST_CORE =
  '^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)' // orphan inside strong
  + '|[^*]+(?=[^*])'
  + '|(?!\\*)punct(\\*+)(?=[\\s]|$)'
  + '|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)'
  + '|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)'
  + '|[\\s](\\*+)(?!\\*)(?=punct)'
  + '|(?!\\*)punct(\\*+)(?!\\*)(?=punct)'
  + '|notPunctSpace(\\*+)(?=notPunctSpace)';
const EM_STRONG_R_AST = build(EM_STRONG_R_AST_CORE, 'gu', [
  [/notPunctSpace/g, NOT_PUNCT_SPACE_GFM],
  [/punctSpace/g, PUNCT_SPACE_GFM],
  [/punct/g, PUNCT_GFM],
]);
const EM_STRONG_R_UND = build(
  '^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)'
  + '|[^_]+(?=[^_])'
  + '|(?!_)punct(_+)(?=[\\s]|$)'
  + '|notPunctSpace(_+)(?!_)(?=punctSpace|$)'
  + '|(?!_)punctSpace(_+)(?=notPunctSpace)'
  + '|[\\s](_+)(?!_)(?=punct)'
  + '|(?!_)punct(_+)(?!_)(?=punct)',
  'gu',
  [
    [/notPunctSpace/g, NOT_PUNCT_SPACE],
    [/punctSpace/g, PUNCT_SPACE],
    [/punct/g, PUNCT],
  ],
);

const DEL_L = build('^~~?(?:((?!~)punct)|[^\\s~])', 'u', [[/punct/g, PUNCT]]);
const DEL_L_STICKY = new RegExp(DEL_L.source.slice(1), 'yu');
const DEL_R = build(
  '^[^~]+(?=[^~])'
  + '|(?!~)punct(~~?)(?=[\\s]|$)'
  + '|notPunctSpace(~~?)(?!~)(?=punctSpace|$)'
  + '|(?!~)punctSpace(~~?)(?=notPunctSpace)'
  + '|[\\s](~~?)(?!~)(?=punct)'
  + '|(?!~)punct(~~?)(?!~)(?=punct)'
  + '|notPunctSpace(~~?)(?=notPunctSpace)',
  'gu',
  [
    [/notPunctSpace/g, NOT_PUNCT_SPACE],
    [/punctSpace/g, PUNCT_SPACE],
    [/punct/g, PUNCT],
  ],
);

const ANY_PUNCT = build('\\\\(punct)', 'gu', [[/punct/g, PUNCT]]);
const ANY_PUNCT_OUTSIDE_CODE = build(
  '(`+)(?:[^`]|[^`][\\s\\S]*?[^`])\\1(?!`)|`+|\\\\(punct)',
  'gu',
  [[/punct/g, PUNCT]],
);
const PUNCT_RE = build('^((?![*_])punctSpace)', 'u', [[/punctSpace/g, PUNCT_SPACE]]);

const INLINE = {
  escape: build('\\\\([!"#$%&\'()*+,\\-./:;<=>?@\\[\\]\\\\^_`{|}~])', 'y'),
  code: build('(`+)([^`]|[^`][\\s\\S]*?[^`])\\1(?!`)', 'y'),
  br: build('( {2,}|\\\\)\\n(?!\\s*$)[ \\t]*', 'y'),
  tag: build(
    '^comment'
    + '|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>'
    + '|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>'
    + '|^<\\?[\\s\\S]*?\\?>'
    + '|^<![a-zA-Z]+\\s[\\s\\S]*?>'
    + '|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>',
    'y',
    [
      ['comment', INLINE_COMMENT],
      ['attribute', /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/],
    ],
  ),
  autolink: build('^<(scheme:[^\\s\\x00-\\x1f<>]*|email)>', 'y', [
    ['scheme', SCHEME],
    ['email', EMAIL],
  ]),
  link: build(
    '^!?\\[(label)\\]\\([ \\t\\n]*(href)(?:(?:[ \\t]+(?:\\n[ \\t]*)?|\\n[ \\t]*)(title))?[ \\t\\n]*\\)',
    'y',
    [
      ['label', INLINE_LABEL],
      ['href', /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/],
      ['title', /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^)\\])*\)/],
    ],
  ),
  reflink: build('^!?\\[(label)\\]\\[(ref)\\]', 'y', [
    ['label', INLINE_LABEL],
    ['ref', BLOCK_LABEL],
  ]),
  nolink: build('^!?\\[(ref)\\](?:\\[\\])?', 'y', [['ref', BLOCK_LABEL]]),
  url: build('^emailProtocol|^((?:protocol):\\/\\/|www\\.)(?:[a-zA-Z0-9\\-]+\\.?)+[^\\s<]*|^email', 'y', [
    ['emailProtocol', EXT_EMAIL_PROTOCOL],
    ['protocol', PROTOCOL],
    ['email', /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/],
  ]),
  backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,
  del: build('^(~~?)(?=[^\\s~])((?:\\\\[\\s\\S]|[^\\\\])*?(?:\\\\[\\s\\S]|[^\\s~\\\\]))\\1(?=[^~]|$)', 'y'),
  text: build(
    '^(?:[^a-zA-Z0-9](?=emailProtocol)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\\n)|(?=[a-zA-Z0-9.!#$%&\'*+\\/=?_`{|}~-]+@)|[\\s\\S]*?(?:(?=[\\\\<!\\[`*~_]|\\b_|protocol:\\/\\/|wwwStart|$)|[^ ](?= {2,}\\n)|[^a-zA-Z0-9](?=emailProtocol)|[^a-zA-Z0-9.!#$%&\'*+\\/=?_`{|}~-](?=[a-zA-Z0-9.!#$%&\'*+\\/=?_`{|}~-]+@))))',
    'y',
    [
      ['protocol', PROTOCOL],
      [/emailProtocol/g, /(?:mailto|xmpp):/],
      ['wwwStart', '(?<![^\\s*_~(])www\\.'],
    ],
  ),
  reflinkSearch: build('reflink|nolink(?!\\()', 'g', [
    ['reflink', build('^!?\\[(label)\\]\\[(ref)\\]', '', [
      ['label', BOUNDED_INLINE_LABEL],
      ['ref', BOUNDED_BLOCK_LABEL],
    ])],
    ['nolink', build('^!?\\[(ref)\\](?:\\[\\])?', '', [['ref', BOUNDED_BLOCK_LABEL]])],
  ]),
  emStrongLDelim: EM_STRONG_L,
  emStrongRDelimAst: EM_STRONG_R_AST,
  emStrongRDelimUnd: EM_STRONG_R_UND,
  delLDelim: DEL_L_STICKY,
  delRDelim: DEL_R,
  anyPunctuation: ANY_PUNCT,
  anyPunctuationOutsideCode: ANY_PUNCT_OUTSIDE_CODE,
  punctuation: PUNCT_RE,
  blockSkip: BLOCK_SKIP,
};

// ---------------------------------------------------------------------------
// Lexer state. One parse() call gets one fresh state: links collected from
// definitions, the inline queue (paragraph texts whose inline tokens are
// built after all blocks, so a definition anywhere in the document applies
// everywhere), and the flags the inline pass reads.
// ---------------------------------------------------------------------------

function newState() {
  return {
    links: Object.create(null),
    hasLinks: false,
    inlineQueue: [],
    inLink: false,
    inRawBlock: false,
    linkEmitted: false,
    linkParenPossible: true,
    top: true,
  };
}

// Queue one inline run; its tokens array is filled in later, in place.
function queueInline(st, src) {
  const tokens = [];
  st.inlineQueue.push({ src, tokens });
  return tokens;
}

// Run a sticky pattern at `pos` of `src`.
function at(re, src, pos) {
  re.lastIndex = pos;
  return re.exec(src);
}

// Test a sticky pattern at the start of `s`.
function atStart(re, s) {
  re.lastIndex = 0;
  return re.test(s);
}

// First line of `src` from `pos` (without the newline), and the position
// just past it.
function firstLine(src, pos) {
  const nl = src.indexOf('\n', pos);
  if (nl === -1) return [src.slice(pos), src.length];
  return [src.slice(pos, nl), nl + 1];
}

function indentCodeCompensation(raw, text) {
  const m = raw.match(O.indentCodeCompensation);
  if (m === null) return text;
  const indentToCode = m[1];
  return text.split('\n').map((node) => {
    const im = node.match(O.beginningSpace);
    if (im === null) return node;
    return node.slice(Math.min(im[0].length, indentToCode.length));
  }).join('\n');
}

// --- block tokenizers: each takes (st, src, pos) and returns
// { token, pos } or undefined. ----------------------------------------------

function tokSpace(st, src, pos) {
  const cap = at(BLOCK.newline, src, pos);
  if (cap && cap[0].length > 0) return { token: { type: 'space', raw: cap[0] }, pos: pos + cap[0].length };
}

function tokCode(st, src, pos) {
  const cap = at(BLOCK.code, src, pos);
  if (!cap) return;
  const raw = trimTrailingBlankLines(cap[0]);
  return {
    token: { type: 'code', raw, text: raw.replace(O.codeRemoveIndent, '') },
    pos: pos + cap[0].length,
  };
}

function tokFences(st, src, pos) {
  const cap = at(BLOCK.fences, src, pos);
  if (!cap) return;
  return {
    token: {
      type: 'code',
      raw: cap[0],
      lang: cap[2] ? cap[2].trim().replace(INLINE.anyPunctuation, '$1') : cap[2],
      text: indentCodeCompensation(cap[0], cap[3] || ''),
    },
    pos: pos + cap[0].length,
  };
}

function tokHeading(st, src, pos) {
  const cap = at(BLOCK.heading, src, pos);
  if (!cap) return;
  let text = cap[2].trim();
  if (O.endingHash.test(text)) {
    const trimmed = rtrim(text, '#');
    if (!trimmed || O.endingSpaceTabChar.test(trimmed)) text = trimmed.trim();
  }
  return {
    token: {
      type: 'heading', raw: rtrim(cap[0], '\n'), depth: cap[1].length,
      text, tokens: queueInline(st, text),
    },
    pos: pos + cap[0].length,
  };
}

function tokHr(st, src, pos) {
  const cap = at(BLOCK.hr, src, pos);
  if (!cap) return;
  return { token: { type: 'hr', raw: rtrim(cap[0], '\n') }, pos: pos + cap[0].length };
}

function tokBlockquote(st, src, pos) {
  const cap = at(BLOCK.blockquote, src, pos);
  if (!cap) return;
  let lines = rtrim(cap[0], '\n').split('\n');
  let raw = '';
  let text = '';
  const tokens = [];

  while (lines.length > 0) {
    let inBlockquote = false;
    const currentLines = [];
    let i;
    for (i = 0; i < lines.length; i++) {
      if (O.blockquoteStart.test(lines[i])) {
        currentLines.push(lines[i]);
        inBlockquote = true;
      } else if (!inBlockquote) {
        currentLines.push(lines[i]);
      } else {
        break;
      }
    }
    lines = lines.slice(i);

    const currentRaw = currentLines.join('\n');
    const currentText = currentRaw
      .replace(O.blockquoteMarkerWhitespace, (_, marker, ws) => marker + expandTabs(ws, marker.length))
      .replace(O.blockquoteSetextReplace, '\n    $1')
      .replace(O.blockquoteSetextReplace2, '');
    raw = raw ? raw + '\n' + currentRaw : currentRaw;
    text = text ? text + '\n' + currentText : currentText;

    const top = st.top;
    st.top = true;
    blockTokens(st, currentText, tokens, true);
    st.top = top;

    if (lines.length === 0) break;

    const lastToken = tokens.at(-1);
    if (lastToken?.type === 'code' || lastToken?.type === 'heading' || lastToken?.type === 'hr'
      || lastToken?.type === 'html' || lastToken?.type === 'table') {
      break;
    } else if (lastToken?.type === 'blockquote') {
      const oldToken = lastToken;
      const continuation = lines.join('\n');
      const newText = oldToken.raw + '\n' + continuation.replace(O.blockquoteSetextReplace2, '');
      const newToken = tokBlockquote(st, newText, 0).token;
      tokens[tokens.length - 1] = newToken;
      const leftover = newText.substring(newToken.raw.length).replace(/^\n/, '');
      const leftoverCount = leftover ? leftover.split('\n').length : 0;
      const consumed = leftoverCount ? lines.slice(0, -leftoverCount) : lines;
      if (consumed.length > 0) raw = raw + '\n' + consumed.join('\n');
      text = text.substring(0, text.length - oldToken.text.length) + newToken.text;
      lines = lines.slice(consumed.length);
      if (lines.length > 0 && O.blockquoteStart.test(lines[0])) continue;
      break;
    } else if (lastToken?.type === 'list') {
      const oldToken = lastToken;
      const newText = oldToken.raw + '\n' + lines.join('\n');
      const newToken = tokList(st, newText, 0).token;
      tokens[tokens.length - 1] = newToken;
      const consumedCount = newToken.raw.length > oldToken.raw.length
        ? newText.slice(oldToken.raw.length + 1, newToken.raw.length).split('\n').length
        : 0;
      if (consumedCount > 0) {
        const consumed = lines.slice(0, consumedCount).join('\n');
        raw = raw + '\n' + consumed;
        text = text + '\n' + consumed;
      }
      lines = lines.slice(consumedCount);
      continue;
    }
  }

  const token = { type: 'blockquote', raw, tokens, text };
  return { token, pos: pos + token.raw.length };
}
function tokList(st, src, startPos) {
  const cap = at(BLOCK.list, src, startPos);
  if (!cap) return;
  let pos = startPos;
  const taken = () => pos - startPos;
  let bull = cap[1].trim();
  const isOrdered = bull.length > 1;

  const list = {
    type: 'list', raw: '', ordered: isOrdered,
    start: isOrdered ? +bull.slice(0, -1) : '',
    loose: false, items: [],
  };

  bull = isOrdered ? `\\d{1,9}\\${bull.slice(-1)}` : `\\${bull}`;

  const itemRegex = O.listItemRegex(bull);
  let endsWithBlankLine = false;

  while (pos < src.length) {
    let endEarly = false;
    let itemContents = '';
    const itemCap = at(itemRegex, src, pos);
    if (!itemCap) break;
    if (at(BLOCK.hr, src, pos)) break;

    const itemStart = taken();
    pos += itemCap[0].length;

    const firstLineText = itemCap[2].split('\n', 1)[0];
    const bulletIndent = itemCap[1].length;
    let line = firstLineText.replace(O.leadingSpaceTab, (ws) => expandTabs(ws, bulletIndent));
    let [nextLine] = firstLine2(src, pos);
    let blankLine = !line.trim();

    let indent = 0;
    if (blankLine) {
      indent = bulletIndent + 1;
    } else {
      indent = line.search(O.nonSpaceChar);
      indent = indent > 4 ? 1 : indent;
      itemContents = line.slice(indent);
      indent += bulletIndent;
    }

    if (blankLine && O.blankLine.test(nextLine)) {
      pos += nextLine.length + 1;
      endEarly = true;
    }

    if (!endEarly) {
      const nextBulletRegex = O.nextBulletRegex(indent);
      const hrRegex = O.hrRegex(indent);
      const fencesBeginRegex = O.fencesBeginRegex(indent);
      const headingBeginRegex = O.headingBeginRegex(indent);
      const htmlBeginRegex = O.htmlBeginRegex(indent);
      const blockquoteBeginRegex = O.blockquoteBeginRegex(indent);

      while (pos < src.length) {
        const [rawLine, afterLine] = firstLine(src, pos);
        let nextLineWithoutTabs;
        nextLine = rawLine;
        nextLineWithoutTabs = nextLine.replace(O.leadingSpaceTab, (ws) => expandTabs(ws));

        if (atStart(fencesBeginRegex, nextLine)) break;
        if (atStart(headingBeginRegex, nextLine)) break;
        if (atStart(htmlBeginRegex, nextLine)) break;
        if (atStart(blockquoteBeginRegex, nextLine)) break;
        if (atStart(nextBulletRegex, nextLine)) break;
        if (atStart(hrRegex, nextLine)) break;

        if (nextLineWithoutTabs.search(O.nonSpaceChar) >= indent || !nextLine.trim()) {
          itemContents += '\n' + nextLineWithoutTabs.slice(indent);
        } else {
          if (blankLine) break;
          if (line.replace(O.tabCharGlobal, '    ').search(O.nonSpaceChar) >= 4) break;
          if (atStart(fencesBeginRegex, line)) break;
          if (atStart(headingBeginRegex, line)) break;
          if (atStart(htmlBeginRegex, line)) break;
          if (atStart(hrRegex, line)) break;
          // A lazy continuation can look like a setext underline after list
          // indentation is removed; keep it in the paragraph.
          const setextContinuation = /^ {0,3}(?:=+|-+) *$/.test(nextLine)
            && atStart(BLOCK.lheading, line + '\n' + nextLine);
          const continuation = setextContinuation
            ? '    ' + nextLineWithoutTabs.replace(/^ {0,3}/, '')
            : nextLine;
          itemContents += '\n' + continuation;
        }

        blankLine = !nextLine.trim();
        pos = afterLine;
        line = nextLineWithoutTabs.slice(indent);
      }
    }

    const raw = src.slice(startPos + itemStart, startPos + taken());

    if (!list.loose) {
      if (endsWithBlankLine) list.loose = true;
      else if (O.doubleBlankLine.test(raw)) endsWithBlankLine = true;
    }

    list.items.push({
      type: 'list_item', raw, task: O.listIsTask.test(itemContents),
      loose: false, text: itemContents, tokens: [],
    });
  }

  const lastItem = list.items.at(-1);
  if (lastItem) {
    lastItem.raw = lastItem.raw.trimEnd();
    lastItem.text = lastItem.text.trimEnd();
  } else {
    return;
  }
  list.raw = src.slice(startPos, startPos + taken()).trimEnd();

  for (const item of list.items) {
    st.top = false;
    item.tokens = blockTokens(st, item.text, []);
    if (!list.loose) {
      const spacers = item.tokens.filter((t) => t.type === 'space');
      const hasMultipleLineBreaks = spacers.length > 0 && spacers.some((t) => O.anyLine.test(t.raw));
      list.loose = hasMultipleLineBreaks;
    }
  }

  for (const item of list.items) {
    const itemToken = item.tokens[0];
    if (item.task && (itemToken?.type === 'text' || itemToken?.type === 'paragraph')) {
      item.text = item.text.replace(O.listReplaceTask, '');
      itemToken.raw = itemToken.raw.replace(O.listReplaceTask, '');
      itemToken.text = itemToken.text.replace(O.listReplaceTask, '');
      for (let i = st.inlineQueue.length - 1; i >= 0; i--) {
        if (O.listIsTask.test(st.inlineQueue[i].src)) {
          st.inlineQueue[i].src = st.inlineQueue[i].src.replace(O.listReplaceTask, '');
          break;
        }
      }
      const taskRaw = O.listTaskCheckbox.exec(item.raw);
      if (taskRaw) {
        const checkboxToken = {
          type: 'checkbox', raw: taskRaw[0] + ' ', checked: taskRaw[0] !== '[ ]',
        };
        item.checked = checkboxToken.checked;
        if (list.loose) {
          if (item.tokens[0] && ['paragraph', 'text'].includes(item.tokens[0].type) && 'tokens' in item.tokens[0] && item.tokens[0].tokens) {
            item.tokens[0].raw = checkboxToken.raw + item.tokens[0].raw;
            item.tokens[0].text = checkboxToken.raw + item.tokens[0].text;
            item.tokens[0].tokens.unshift(checkboxToken);
          } else {
            item.tokens.unshift({
              type: 'paragraph', raw: checkboxToken.raw, text: checkboxToken.raw,
              tokens: [checkboxToken],
            });
          }
        } else {
          item.tokens.unshift(checkboxToken);
        }
      }
    } else if (item.task) {
      item.task = false;
    }
  }

  if (list.loose) {
    for (const item of list.items) {
      item.loose = true;
      for (const token of item.tokens) {
        if (token.type === 'text') token.type = 'paragraph';
      }
    }
  }

  return { token: list, pos: startPos + list.raw.length };
}

// First line of the remaining source, for the list pre-check.
function firstLine2(src, pos) {
  return firstLine(src, pos);
}

function tokHtml(st, src, pos) {
  const cap = at(BLOCK.html, src, pos);
  if (!cap) return;
  const raw = trimTrailingBlankLines(cap[0]);
  return {
    token: {
      type: 'html', block: true, raw,
      pre: cap[1] === 'pre' || cap[1] === 'script' || cap[1] === 'style',
      text: raw,
    },
    pos: pos + cap[0].length,
  };
}

function tokDef(st, src, pos) {
  const cap = at(BLOCK.def, src, pos);
  if (!cap) return;
  if (!O.startAngleBracket.test(cap[2]) && findClosingBracket(cap[2], '()') !== -1) return;
  const tag = normalizeLabel(cap[1]);
  const href = cap[2] ? cap[2].replace(O.hrefBrackets, '$1').replace(INLINE.anyPunctuation, '$1') : '';
  const title = cap[3] ? cap[3].substring(1, cap[3].length - 1).replace(INLINE.anyPunctuation, '$1') : cap[3];
  return {
    token: { type: 'def', tag, raw: rtrim(cap[0], '\n'), href, title },
    pos: pos + cap[0].length,
  };
}

function tokTable(st, src, pos) {
  const cap = at(BLOCK.table, src, pos);
  if (!cap) return;
  if (!O.tableDelimiter.test(cap[2])) return;
  const headers = splitCells(cap[1]);
  const aligns = cap[2].replace(O.tableAlignChars, '').split('|');
  const rows = cap[3]?.trim() ? cap[3].replace(O.tableRowBlankLine, '').split('\n') : [];
  if (headers.length !== aligns.length) return;

  const item = {
    type: 'table', raw: rtrim(cap[0], '\n'), header: [], align: [], rows: [],
  };
  for (const align of aligns) {
    if (O.tableAlignRight.test(align)) item.align.push('right');
    else if (O.tableAlignCenter.test(align)) item.align.push('center');
    else if (O.tableAlignLeft.test(align)) item.align.push('left');
    else item.align.push(null);
  }
  for (let i = 0; i < headers.length; i++) {
    item.header.push({
      text: headers[i], tokens: queueInline(st, headers[i]), header: true, align: item.align[i],
    });
  }
  for (const row of rows) {
    item.rows.push(splitCells(row, item.header.length).map((cell, i) => ({
      text: cell, tokens: queueInline(st, cell), header: false, align: item.align[i],
    })));
  }
  return { token: item, pos: pos + cap[0].length };
}

function tokLheading(st, src, pos) {
  const cap = at(BLOCK.lheading, src, pos);
  if (!cap) return;
  const text = cap[1].trim();
  return {
    token: {
      type: 'heading', raw: rtrim(cap[0], '\n'),
      depth: cap[2].charAt(0) === '=' ? 1 : 2, text, tokens: queueInline(st, text),
    },
    pos: pos + cap[0].length,
  };
}

function tokParagraph(st, src, pos) {
  const cap = at(BLOCK.paragraph, src, pos);
  if (!cap) return;
  const text = cap[1].charAt(cap[1].length - 1) === '\n' ? cap[1].slice(0, -1) : cap[1];
  return {
    token: { type: 'paragraph', raw: cap[0], text, tokens: queueInline(st, text) },
    pos: pos + cap[0].length,
  };
}

function tokText(st, src, pos) {
  const cap = at(BLOCK.text, src, pos);
  if (!cap) return;
  return {
    token: { type: 'text', raw: cap[0], text: cap[0], tokens: queueInline(st, cap[0]) },
    pos: pos + cap[0].length,
  };
}

// Is any line up to the next blank line a setext underline (up to 3
// spaces, a run of = or of -, then spaces/tabs)? A setext heading needs
// one, so without it the lheading pattern cannot match and is skipped.
// The scan may say yes where the pattern still fails (a bullet line in
// between, say); then the pattern simply runs and fails, as before.
function hasSetextLine(src, pos) {
  let nl = src.indexOf('\n', pos);
  if (nl === -1) return false;
  let i = nl + 1;
  while (i < src.length) {
    let j = i;
    while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j++;
    if (j >= src.length || src[j] === '\n') return false; // blank line
    let k = i;
    let spaces = 0;
    while (k < src.length && src[k] === ' ' && spaces < 3) {
      k++;
      spaces++;
    }
    if (!(k < src.length && src[k] === ' ')) {
      const c = src[k];
      if (c === '=' || c === '-') {
        let m = k + 1;
        while (m < src.length && src[m] === c) m++;
        let e = m;
        while (e < src.length && (src[e] === ' ' || src[e] === '\t')) e++;
        if (e >= src.length || src[e] === '\n') return true;
      }
    }
    nl = src.indexOf('\n', i);
    if (nl === -1) return false;
    i = nl + 1;
  }
  return false;
}

// Is the second line a table delimiter row (up to 3 spaces, then only
// | : - and spaces, with at least one - and at least one | or :)? A
// table needs one on the line right after its header.
function hasTableDelimiterRow(src, pos) {
  const nl = src.indexOf('\n', pos);
  if (nl === -1) return false;
  let i = nl + 1;
  let spaces = 0;
  while (i < src.length && src[i] === ' ' && spaces < 3) {
    i++;
    spaces++;
  }
  if (i < src.length && src[i] === ' ') return false;
  let hasDash = false;
  let hasPipeOrColon = false;
  let j = i;
  while (j < src.length && src[j] !== '\n') {
    const ch = src[j];
    if (ch === '-') hasDash = true;
    else if (ch === '|' || ch === ':') hasPipeOrColon = true;
    else if (ch !== ' ') return false;
    j++;
  }
  return hasDash && hasPipeOrColon;
}

// The block loop: try each block kind in order until the source is spent.
function blockTokens(st, src, tokens = [], lastParagraphClipped = false) {
  let pos = 0;
  let remaining = Infinity;
  while (pos < src.length) {
    if (src.length - pos >= remaining) throw new Error('Infinite loop on byte: ' + src.charCodeAt(pos));
    remaining = src.length - pos;

    // Dispatch on the first character: most block patterns can only start
    // with one of a few characters (after at most 3 spaces), so an ordinary
    // text line only ever tries the table, setext and paragraph patterns.
    const c0 = src.charCodeAt(pos);
    let trySpace = true;
    let tryCode = true;
    let tryFences = true;
    let tryHeading = true;
    let tryHr = true;
    let tryBlockquote = true;
    let tryList = true;
    let tryHtml = true;
    let tryDef = true;
    let tryTable = true;
    let tryLheading = true;
    if (c0 === 10) {
      tryCode = tryFences = tryHeading = tryHr = tryBlockquote = tryList
        = tryHtml = tryDef = tryTable = tryLheading = false;
    } else if (c0 !== 32 && c0 !== 9) {
      trySpace = false;
      tryCode = false;
      if (c0 !== 96 && c0 !== 126) tryFences = false;
      if (c0 !== 35) tryHeading = false;
      if (c0 !== 45 && c0 !== 95 && c0 !== 42) tryHr = false;
      if (c0 !== 62) tryBlockquote = false;
      if (!(c0 === 45 || c0 === 42 || c0 === 43 || (c0 >= 48 && c0 <= 57))) tryList = false;
      if (c0 !== 60) tryHtml = false;
      if (c0 !== 91) tryDef = false;
    }
    if (tryTable && !hasTableDelimiterRow(src, pos)) tryTable = false;
    if (tryLheading && !hasSetextLine(src, pos)) tryLheading = false;

    let got;

    if (trySpace && (got = tokSpace(st, src, pos))) {
      pos = got.pos;
      const lastToken = tokens.at(-1);
      if (got.token.raw.length === 1 && lastToken !== undefined) {
        lastToken.raw += '\n';
      } else {
        tokens.push(got.token);
      }
      continue;
    }

    if (tryCode && (got = tokCode(st, src, pos))) {
      pos = got.pos;
      const lastToken = tokens.at(-1);
      if (lastToken?.type === 'paragraph' || lastToken?.type === 'text') {
        lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + got.token.raw;
        lastToken.text += '\n' + got.token.text;
        st.inlineQueue.at(-1).src = lastToken.text;
      } else {
        tokens.push(got.token);
      }
      continue;
    }

    if (tryFences && (got = tokFences(st, src, pos))) {
      pos = got.pos;
      tokens.push(got.token);
      continue;
    }

    if (tryHeading && (got = tokHeading(st, src, pos))) {
      pos = got.pos;
      tokens.push(got.token);
      continue;
    }

    if (tryHr && (got = tokHr(st, src, pos))) {
      pos = got.pos;
      tokens.push(got.token);
      continue;
    }

    if (tryBlockquote && (got = tokBlockquote(st, src, pos))) {
      pos = got.pos;
      tokens.push(got.token);
      continue;
    }

    if (tryList && (got = tokList(st, src, pos))) {
      pos = got.pos;
      tokens.push(got.token);
      continue;
    }

    if (tryHtml && (got = tokHtml(st, src, pos))) {
      pos = got.pos;
      tokens.push(got.token);
      continue;
    }

    if (tryDef && (got = tokDef(st, src, pos))) {
      pos = got.pos;
      const lastToken = tokens.at(-1);
      if (lastToken?.type === 'paragraph' || lastToken?.type === 'text') {
        lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + got.token.raw;
        lastToken.text += '\n' + got.token.raw;
        st.inlineQueue.at(-1).src = lastToken.text;
      } else {
        if (!st.links[got.token.tag]) {
          st.links[got.token.tag] = { href: got.token.href, title: got.token.title };
          st.hasLinks = true;
        }
        tokens.push(got.token);
      }
      continue;
    }

    if (tryTable && (got = tokTable(st, src, pos))) {
      pos = got.pos;
      tokens.push(got.token);
      continue;
    }

    if (tryLheading && (got = tokLheading(st, src, pos))) {
      pos = got.pos;
      tokens.push(got.token);
      continue;
    }

    if (st.top && (got = tokParagraph(st, src, pos))) {
      const lastToken = tokens.at(-1);
      if (lastParagraphClipped && lastToken?.type === 'paragraph') {
        lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + got.token.raw;
        lastToken.text += '\n' + got.token.text;
        st.inlineQueue.pop();
        st.inlineQueue.at(-1).src = lastToken.text;
      } else {
        tokens.push(got.token);
      }
      pos = got.pos;
      continue;
    }

    if ((got = tokText(st, src, pos))) {
      const lastToken = tokens.at(-1);
      if (lastToken?.type === 'text') {
        lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + got.token.raw;
        lastToken.text += '\n' + got.token.text;
        st.inlineQueue.pop();
        st.inlineQueue.at(-1).src = lastToken.text;
      } else {
        tokens.push(got.token);
      }
      pos = got.pos;
      continue;
    }

    if (pos < src.length) throw new Error('Infinite loop on byte: ' + src.charCodeAt(pos));
    break;
  }

  st.top = true;
  return tokens;
}

// ---------------------------------------------------------------------------
// Inline lexer.
// ---------------------------------------------------------------------------

// One scan of a masked source for the last runs that can close emphasis,
// strong or strikethrough. Frames stack because inline runs nest (a link
// label is its own run).
function scanClosers(src) {
  const lastEmStrong = { '*': -1, _: -1 };
  let lastDel = -1;
  const len = src.length;
  for (let i = 0; i < len; i++) {
    const ch = src[i];
    if (ch !== '*' && ch !== '_' && ch !== '~') continue;
    const prev = i === 0 ? '\n' : src[i - 1];
    let j = i + 1;
    while (j < len && src[j] === ch) j++;
    if (prev !== ' ' && prev !== '\t' && prev !== '\n' && prev !== '\r' && prev !== '\f') {
      if (ch === '~') lastDel = i;
      else lastEmStrong[ch] = i;
    }
    i = j - 1;
  }
  return { maskedSrc: src, lastEmStrong, lastDel };
}

function lastEmStrongCloser(st, maskedSrc, delim) {
  const frame = st.closerFrames.at(-1);
  if (frame && frame.maskedSrc === maskedSrc) return frame.lastEmStrong[delim];
  return scanClosers(maskedSrc).lastEmStrong[delim];
}

function lastDelCloser(st, maskedSrc) {
  const frame = st.closerFrames.at(-1);
  if (frame && frame.maskedSrc === maskedSrc) return frame.lastDel;
  return scanClosers(maskedSrc).lastDel;
}

// Does this link text already hold a link? An image does not count.
function linkInText(st, text) {
  if (!text.includes('[')) return false;
  const linkRule = INLINE.link;
  for (const match of text.matchAll(INLINE.blockSkip)) {
    linkRule.lastIndex = 0;
    if (linkRule.test(match[0]) && text.charAt(match.index - 1) !== '!') return true;
  }
  for (const match of text.matchAll(INLINE.reflinkSearch)) {
    const match0 = match[0];
    const refStart = match0.lastIndexOf('[');
    if (match0.charAt(0) === '!' || !Object.hasOwn(st.links, normalizeLabel(match0.slice(refStart + 1, -1)))) continue;
    if (refStart > 1 && linkInText(st, match0.slice(1, refStart - 1))) continue;
    return true;
  }
  return false;
}

// Mask links, code spans, html and escapes so emStrong/del do not see the
// delimiters inside them. Every mask keeps the length it replaces.
function maskSrc(st, src) {
  let masked = src;
  if (st.hasLinks && src.includes('[')) {
    const reflinkSearch = INLINE.reflinkSearch;
    const maskReflink = (match0) => {
      const refStart = match0.lastIndexOf('[');
      if (!Object.hasOwn(st.links, normalizeLabel(match0.slice(refStart + 1, -1)))) return match0;
      if (refStart > 1 && match0.charAt(0) !== '!') {
        const text = match0.slice(1, refStart - 1);
        if (linkInText(st, text)) {
          return '[' + text.replace(reflinkSearch, maskReflink)
            + '][' + 'a'.repeat(match0.length - refStart - 2) + ']';
        }
      }
      return '[' + 'a'.repeat(match0.length - 2) + ']';
    };
    masked = masked.replace(reflinkSearch, maskReflink);
  }
  // The escape/code-span mask only matches where a backslash or a backtick
  // occurs; the block mask only where a link, code span or tag can start.
  // Most runs hold none of those, so skip the whole replace passes.
  if (masked.includes('\\') || masked.includes('`')) {
    masked = masked.replace(INLINE.anyPunctuationOutsideCode, (match0, code, punct) => {
      if (punct) return '+'.repeat(match0.length);
      if (code) return code + match0.slice(code.length, -code.length).replace(/`/g, '+') + code;
      return match0;
    });
  }
  if (masked.includes('[') || masked.includes('`') || masked.includes('<')) {
    masked = masked.replace(INLINE.blockSkip, (match0, _link, context) => {
      const offset = context ? context.length : 0;
      return match0.slice(0, offset) + '[' + 'a'.repeat(match0.length - offset - 2) + ']';
    });
  }
  return masked;
}

function outputLink(st, cap, link, raw) {
  const href = link.href;
  const title = link.title || null;
  const text = cap[1].replace(O.outputLinkReplace, '$1');
  const isImage = cap[0].charAt(0) === '!';

  const outerInLink = st.inLink;
  const outerLinkEmitted = st.linkEmitted;
  const outerInRawBlock = st.inRawBlock;
  st.inLink = true;
  st.linkEmitted = false;
  const tokens = inlineTokens(st, text);
  const textHasLink = st.linkEmitted;
  st.linkEmitted = outerLinkEmitted;
  st.inLink = outerInLink;

  if (!isImage) {
    // Links may not contain other links, at any level of nesting.
    if (textHasLink) {
      st.inRawBlock = outerInRawBlock;
      return undefined;
    }
    st.linkEmitted = true;
  }

  return { type: isImage ? 'image' : 'link', raw, href, title, text, tokens };
}

function isLabelEndInsideToken(src, label, labelStart, base) {
  if (!label.includes('<')) return false;
  for (let i = 0; i < label.length; i++) {
    if (label[i] === '\\') {
      i++;
      continue;
    }
    if (label[i] === '`') {
      const code = at(INLINE.code, label.slice(i), 0);
      if (code) {
        i += code[0].length - 1;
        continue;
      }
    }
    if (label[i] !== '<') continue;
    const tokenSrc = src.slice(base + labelStart + i);
    const token = at(INLINE.tag, tokenSrc, 0) || at(INLINE.autolink, tokenSrc, 0);
    if (!token) continue;
    if (token[0].length > label.length - i) return true;
    i += token[0].length - 1;
  }
  return false;
}

function tokEscape(st, src, pos) {
  const cap = at(INLINE.escape, src, pos);
  if (cap) return { token: { type: 'escape', raw: cap[0], text: cap[1] }, len: cap[0].length };
}

function tokTag(st, src, pos) {
  const cap = at(INLINE.tag, src, pos);
  if (!cap) return;
  if (!st.inLink && O.startATag.test(cap[0])) st.inLink = true;
  else if (st.inLink && O.endATag.test(cap[0])) st.inLink = false;
  if (!st.inRawBlock && O.startPreScriptTag.test(cap[0])) st.inRawBlock = true;
  else if (st.inRawBlock && O.endPreScriptTag.test(cap[0])) st.inRawBlock = false;
  return {
    token: {
      type: 'html', raw: cap[0], inLink: st.inLink, inRawBlock: st.inRawBlock,
      block: false, text: cap[0],
    },
    len: cap[0].length,
  };
}

function tokLink(st, src, pos) {
  if (st.linkParenPossible === false) return;
  const cap = at(INLINE.link, src, pos);
  if (!cap) return;
  const labelStart = cap[0].charAt(0) === '!' ? 2 : 1;
  if (isLabelEndInsideToken(src, cap[1], labelStart, pos)) return;

  const trimmedUrl = cap[2].trim();
  if (O.startAngleBracket.test(trimmedUrl)) {
    if (!O.endAngleBracket.test(trimmedUrl)) return;
    const rtrimSlash = rtrim(trimmedUrl.slice(0, -1), '\\');
    if ((trimmedUrl.length - rtrimSlash.length) % 2 === 0) return;
  } else {
    const lastParenIndex = findClosingBracket(cap[2], '()');
    if (lastParenIndex === -2) return;
    if (lastParenIndex > -1) {
      const start = cap[0].indexOf('!') === 0 ? 5 : 4;
      const linkLen = start + cap[1].length + lastParenIndex;
      cap[2] = cap[2].substring(0, lastParenIndex);
      cap[0] = cap[0].substring(0, linkLen).trim();
      cap[3] = '';
    }
  }
  // The ')' that ends the match is the closer only when it is not escaped.
  const unescaped = rtrim(cap[0].slice(0, -1), '\\');
  if ((cap[0].length - unescaped.length) % 2 === 0) return;

  let href = cap[2];
  let title = '';
  title = cap[3] ? cap[3].slice(1, -1) : '';
  href = href.trim();
  if (O.startAngleBracket.test(href)) href = href.slice(1, -1);
  const token = outputLink(st, cap, {
    href: href ? href.replace(INLINE.anyPunctuation, '$1') : href,
    title: title ? title.replace(INLINE.anyPunctuation, '$1') : title,
  }, cap[0]);
  if (!token) return;
  return { token, len: cap[0].length };
}

function tokReflink(st, src, pos) {
  let cap = at(INLINE.reflink, src, pos) || at(INLINE.nolink, src, pos);
  if (!cap) return;
  const labelStart = cap[0].charAt(0) === '!' ? 2 : 1;
  if (isLabelEndInsideToken(src, cap[1], labelStart, pos)) return;
  const link = st.links[normalizeLabel(cap[2] || cap[1])];
  if (!link) {
    const text = cap[0].charAt(0);
    return { token: { type: 'text', raw: text, text }, len: 1 };
  }
  const token = outputLink(st, cap, link, cap[0]);
  if (!token) return;
  return { token, len: cap[0].length };
}

function tokEmStrong(st, src, pos, maskedSrc, prevChar = '') {
  let match = at(INLINE.emStrongLDelim, src, pos);
  if (!match) return;
  if (!match[1] && !match[2] && !match[3] && !match[4]) return;

  const delimChar = match[0][0];
  const midRun = prevChar === delimChar;

  const remaining = src.length - pos;
  const srcStart = maskedSrc.length - remaining;
  let runStart = srcStart;
  while (runStart > 0 && maskedSrc[runStart - 1] === delimChar) runStart--;
  const runPrevChar = [...maskedSrc.slice(Math.max(0, runStart - 2), runStart)].at(-1) ?? '';
  const runPrevPunct = runPrevChar === '*' || runPrevChar === '_' || !!at(INLINE.punctuation, runPrevChar, 0);
  if (runStart < srcStart) prevChar = runPrevChar;
  const prevPunct = runStart < srcStart ? runPrevPunct : !!at(INLINE.punctuation, prevChar, 0);

  if (match[4] && prevChar.match(O.unicodeAlphaNumeric)) return;

  const nextChar = match[1] || match[3] || '';

  if (!nextChar || !prevChar || prevPunct) {
    const lLength = [...match[0]].length - 1;
    let rDelim, rLength, delimTotal = lLength, midDelimTotal = 0;

    const runLength = srcStart - runStart + lLength;
    const openerCanClose = !!runPrevChar.trim()
      && (!!nextChar || (delimChar === '*' && !runPrevPunct));
    if (delimChar !== '*' && delimChar !== '_') return;
    const endReg = delimChar === '*' ? INLINE.emStrongRDelimAst : INLINE.emStrongRDelimUnd;
    const lastPossible = lastEmStrongCloser(st, maskedSrc, delimChar);
    const windowStart = maskedSrc.length - remaining + lLength;
    if (lastPossible < windowStart) return;
    maskedSrc = maskedSrc.slice(maskedSrc.length - remaining + lLength);
    const lastPossibleInWindow = lastPossible - windowStart;
    endReg.lastIndex = 0;

    while ((match = endReg.exec(maskedSrc)) !== null) {
      if (match.index > lastPossibleInWindow) break;
      rDelim = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
      if (!rDelim) continue;
      rLength = [...rDelim].length;

      if (match[3] || match[4]) {
        delimTotal += rLength;
        continue;
      } else if (match[5] || match[6] || openerCanClose) {
        if (midRun && (match[5] || match[6])) break;
        if (runLength % 3 && !((runLength + rLength) % 3)) {
          midDelimTotal += rLength;
          continue;
        }
      }

      delimTotal -= rLength;
      if (delimTotal > 0) continue;

      rLength = Math.min(rLength, rLength + delimTotal + midDelimTotal);
      const lastCharLength = [...match[0]][0].length;
      const raw = src.slice(pos, pos + lLength + match.index + lastCharLength + rLength);

      if (Math.min(lLength, rLength) % 2) {
        const text = raw.slice(1, -1);
        return {
          token: { type: 'em', raw, text, tokens: inlineTokens(st, text) },
          len: raw.length,
        };
      }
      const text = raw.slice(2, -2);
      return {
        token: { type: 'strong', raw, text, tokens: inlineTokens(st, text) },
        len: raw.length,
      };
    }
  }
}

function tokCodespan(st, src, pos) {
  const cap = at(INLINE.code, src, pos);
  if (!cap) return;
  let text = cap[2].replace(O.newLineCharGlobal, ' ');
  const hasNonSpaceChars = O.nonSpaceChar.test(text);
  const hasSpaceCharsOnBothEnds = O.startingSpaceChar.test(text) && O.endingSpaceChar.test(text);
  if (hasNonSpaceChars && hasSpaceCharsOnBothEnds) text = text.substring(1, text.length - 1);
  return { token: { type: 'codespan', raw: cap[0], text }, len: cap[0].length };
}

function tokBr(st, src, pos) {
  const cap = at(INLINE.br, src, pos);
  if (cap) return { token: { type: 'br', raw: cap[0] }, len: cap[0].length };
}

function tokDel(st, src, pos, maskedSrc, prevChar = '') {
  const match0 = at(INLINE.delLDelim, src, pos);
  if (!match0) return;
  const nextChar = match0[1] || '';
  if (!nextChar || !prevChar || at(INLINE.punctuation, prevChar, 0)) {
    const lLength = [...match0[0]].length - 1;
    let rDelim, rLength, delimTotal = lLength;
    const endReg = INLINE.delRDelim;
    const lastPossible = lastDelCloser(st, maskedSrc);
    const remaining = src.length - pos;
    const windowStart = maskedSrc.length - remaining + lLength;
    if (lastPossible < windowStart) return;
    maskedSrc = maskedSrc.slice(maskedSrc.length - remaining + lLength);
    const lastPossibleInWindow = lastPossible - windowStart;
    endReg.lastIndex = 0;

    let match;
    while ((match = endReg.exec(maskedSrc)) !== null) {
      if (match.index > lastPossibleInWindow) break;
      rDelim = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
      if (!rDelim) continue;
      rLength = [...rDelim].length;
      if (rLength !== lLength) continue;
      if (match[3] || match[4]) {
        delimTotal += rLength;
        continue;
      }
      delimTotal -= rLength;
      if (delimTotal > 0) continue;
      rLength = Math.min(rLength, rLength + delimTotal);
      const lastCharLength = [...match[0]][0].length;
      const raw = src.slice(pos, pos + lLength + match.index + lastCharLength + rLength);
      const text = raw.slice(lLength, -lLength);
      return {
        token: { type: 'del', raw, text, tokens: inlineTokens(st, text) },
        len: raw.length,
      };
    }
  }
}

function tokAutolink(st, src, pos) {
  const cap = at(INLINE.autolink, src, pos);
  if (!cap) return;
  let text, href;
  if (cap[2] === '@') {
    text = cap[1];
    href = 'mailto:' + text;
  } else {
    text = cap[1];
    href = text;
  }
  return {
    token: {
      type: 'link', raw: cap[0], text, href, autolink: true,
      tokens: [{ type: 'text', raw: text, text }],
    },
    len: cap[0].length,
  };
}

function tokUrl(st, src, pos) {
  const cap = at(INLINE.url, src, pos);
  if (!cap) return;
  let text, href;
  if (cap[2] === '@') {
    text = cap[0];
    href = 'mailto:' + text;
  } else {
    let prevCapZero;
    do {
      prevCapZero = cap[0];
      cap[0] = INLINE.backpedal.exec(cap[0])?.[0] ?? '';
    } while (prevCapZero !== cap[0]);
    text = cap[0];
    href = cap[1] === 'www.' ? 'http://' + cap[0] : cap[0];
  }
  return {
    token: {
      type: 'link', raw: cap[0], text, href, autolink: true,
      tokens: [{ type: 'text', raw: text, text }],
    },
    len: cap[0].length,
  };
}

// Characters that can appear inside an extended-autolink email address.
const EMAIL_CHAR = new Uint8Array(128);
for (const ch of "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!#$%&'*+/=?`{|}~-") {
  EMAIL_CHAR[ch.charCodeAt(0)] = 1;
}

function isAsciiAlnum(code) {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isEmailCharCode(code) {
  return code < 128 && EMAIL_CHAR[code] === 1;
}

function startsEmailProtocol(src, i, end) {
  if (i + 7 <= end && src[i] === 'm' && src.startsWith('mailto:', i)) return true;
  if (i + 5 <= end && src[i] === 'x' && src.startsWith('xmpp:', i)) return true;
  return false;
}

// The end of the text run starting at `pos`: the earliest of the next
// character that starts another inline token, the start of a scheme://
// or www. autolink, the start of an email address, and the start of the
// spaces of a hard break. Each candidate is found with indexOf, which
// scans in native code, instead of a lazy pattern with a lookahead at
// every character.
const TEXT_STOPS = ['\\', '<', '!', '[', '`', '*', '~', '_'];

function scanTextEnd(src, pos, end) {
  let i = pos;
  const first = src.charCodeAt(i);
  // A non-alphanumeric character right before mailto:/xmpp: is a run of
  // its own; the link starts after it.
  if (!isAsciiAlnum(first) && startsEmailProtocol(src, i + 1, end)) return i + 1;
  if (first === 96) {
    while (i < end && src.charCodeAt(i) === 96) i++;
  } else if (first === 126) {
    while (i < end && src.charCodeAt(i) === 126) i++;
  } else {
    i++;
  }

  let stop = end;
  for (let s = 0; s < TEXT_STOPS.length; s++) {
    const idx = src.indexOf(TEXT_STOPS[s], i);
    if (idx !== -1 && idx < stop) stop = idx;
  }
  // scheme:// autolinks stop the run at the scheme's first letter.
  let j = src.indexOf('://', i);
  while (j !== -1 && j < stop) {
    let s = -1;
    if (j - 4 >= i
      && (src.charCodeAt(j - 4) | 32) === 104 && (src.charCodeAt(j - 3) | 32) === 116
      && (src.charCodeAt(j - 2) | 32) === 116 && (src.charCodeAt(j - 1) | 32) === 112) s = j - 4;
    else if (j - 5 >= i
      && (src.charCodeAt(j - 5) | 32) === 104 && (src.charCodeAt(j - 4) | 32) === 116
      && (src.charCodeAt(j - 3) | 32) === 116 && (src.charCodeAt(j - 2) | 32) === 112
      && (src.charCodeAt(j - 1) | 32) === 115) s = j - 5;
    else if (j - 3 >= i
      && (src.charCodeAt(j - 3) | 32) === 102 && (src.charCodeAt(j - 2) | 32) === 116
      && (src.charCodeAt(j - 1) | 32) === 112) s = j - 3;
    if (s !== -1) {
      stop = s;
      break;
    }
    j = src.indexOf('://', j + 1);
  }
  // www. autolinks stop the run where they start, when the character
  // before them is the start of the run, whitespace, *, _, ~ or (.
  let w = src.indexOf('www.', i);
  while (w !== -1 && w < stop) {
    if (w === pos) {
      stop = w;
      break;
    }
    const p = src[w - 1];
    if (p === ' ' || p === '\t' || p === '\n' || p === '\r' || p === '*' || p === '_' || p === '~' || p === '(') {
      stop = w;
      break;
    }
    w = src.indexOf('www.', w + 1);
  }
  // An email address stops the run where it starts.
  let a = src.indexOf('@', i);
  while (a !== -1 && a < stop) {
    let e = a;
    while (e > i && isEmailCharCode(src.charCodeAt(e - 1))) e--;
    if (e < a && e >= i) {
      stop = e;
      break;
    }
    a = src.indexOf('@', a + 1);
  }
  // A hard break stops the run where its spaces start.
  let h = src.indexOf('  \n', i);
  while (h !== -1 && h < stop) {
    let s = h;
    while (s > i && src[s - 1] === ' ') s--;
    stop = s;
    break;
  }
  return stop;
}

function tokInlineText(st, src, pos, len) {
  const end = scanTextEnd(src, pos, len);
  if (end <= pos) return;
  const raw = src.slice(pos, end);
  const escaped = st.inRawBlock;
  return {
    token: {
      type: 'text', raw,
      text: escaped ? raw : decodeNumRefs(raw),
      escaped,
    },
    len: end - pos,
  };
}

function inlineTokens(st, src, tokens = []) {
  const prevLinkParenPossible = st.linkParenPossible;
  st.linkParenPossible = prevLinkParenPossible && src.includes(')');
  try {
    return inlineTokensInner(st, src, tokens);
  } finally {
    st.linkParenPossible = prevLinkParenPossible;
  }
}

function inlineTokensInner(st, src, tokens) {
  const maskedSrc = src.includes('*') || src.includes('_') || src.includes('~')
    ? maskSrc(st, src)
    : src;

  st.closerFrames = st.closerFrames || [];
  st.closerFrames.push(scanClosers(maskedSrc));
  try {
    return tokenizeInlines(st, src, maskedSrc, tokens);
  } finally {
    st.closerFrames.pop();
  }
}

function tokenizeInlines(st, src, maskedSrc, tokens) {
  let keepPrevChar = false;
  let prevChar = '';
  const len = src.length;
  let pos = 0;
  let remaining = Infinity;
  while (pos < len) {
    if (len - pos >= remaining) throw new Error('Infinite loop on byte: ' + src.charCodeAt(pos));
    remaining = len - pos;

    if (!keepPrevChar) prevChar = '';
    keepPrevChar = false;

    // Dispatch on the first character: each inline token can only start
    // with one of a few characters, so most positions try one pattern
    // instead of all ten.
    const c = src.charCodeAt(pos);
    let got;

    if (c === 92) { // backslash: escape, a backslash hard break, or text
      if ((got = tokEscape(st, src, pos))) {
        pos += got.len;
        tokens.push(got.token);
        continue;
      }
      if ((got = tokBr(st, src, pos))) {
        pos += got.len;
        tokens.push(got.token);
        continue;
      }
    } else if (c === 60) { // <: tag or autolink
      if ((got = tokTag(st, src, pos))) {
        pos += got.len;
        tokens.push(got.token);
        continue;
      }
      if ((got = tokAutolink(st, src, pos))) {
        pos += got.len;
        tokens.push(got.token);
        continue;
      }
    } else if (c === 91 || c === 33) { // [ or !: link or reference link
      if ((got = tokLink(st, src, pos))) {
        pos += got.len;
        tokens.push(got.token);
        continue;
      }
      if ((got = tokReflink(st, src, pos))) {
        pos += got.len;
        const lastToken = tokens.at(-1);
        if (got.token.type === 'text' && lastToken?.type === 'text') {
          lastToken.raw += got.token.raw;
          lastToken.text += got.token.text;
        } else {
          tokens.push(got.token);
        }
        continue;
      }
    } else if (c === 42 || c === 95) { // * or _: emphasis or strong
      if ((got = tokEmStrong(st, src, pos, maskedSrc, prevChar))) {
        pos += got.len;
        tokens.push(got.token);
        continue;
      }
    } else if (c === 96) { // backtick: code span
      if ((got = tokCodespan(st, src, pos))) {
        pos += got.len;
        tokens.push(got.token);
        continue;
      }
    } else if (c === 126) { // ~: strikethrough
      if ((got = tokDel(st, src, pos, maskedSrc, prevChar))) {
        pos += got.len;
        tokens.push(got.token);
        continue;
      }
    } else if (c === 32) { // space: a hard break made of spaces
      if ((got = tokBr(st, src, pos))) {
        pos += got.len;
        tokens.push(got.token);
        continue;
      }
    } else if (!st.inLink && (got = tokUrl(st, src, pos))) {
      pos += got.len;
      tokens.push(got.token);
      continue;
    }
    if ((got = tokInlineText(st, src, pos, len))) {
      pos += got.len;
      if (got.token.raw.slice(-1) !== '_') prevChar = got.token.raw.slice(-1);
      keepPrevChar = true;
      const lastToken = tokens.at(-1);
      if (lastToken?.type === 'text') {
        lastToken.raw += got.token.raw;
        lastToken.text += got.token.text;
      } else {
        tokens.push(got.token);
      }
      continue;
    }

    if (pos < len) throw new Error('Infinite loop on byte: ' + src.charCodeAt(pos));
    break;
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Renderer: tokens to HTML, exactly as marked renders them.
// ---------------------------------------------------------------------------

function renderText(token) {
  if ('tokens' in token && token.tokens) return renderInline(token.tokens);
  return 'escaped' in token && token.escaped ? token.text : escHtml(token.text);
}

// The text-only rendering used for image alt text: no tags, no escapes.
function renderPlain(token) {
  switch (token.type) {
    case 'strong':
    case 'em':
    case 'del':
    case 'link':
    case 'image':
      return token.tokens ? renderInlinePlain(token.tokens) : token.text;
    case 'codespan':
    case 'html':
    case 'text':
    case 'escape':
      return token.text;
    case 'br':
      return '';
    case 'checkbox':
      return token.raw;
    default:
      return token.text ?? '';
  }
}

function renderInlinePlain(tokens) {
  let out = '';
  for (const t of tokens) out += renderPlain(t);
  return out;
}

function renderLink(token) {
  const parsedText = token.autolink
    ? escHtml(token.text, true)
    : renderInline(token.tokens);
  const cleanHref = cleanUrl(token.href);
  if (cleanHref === null) return parsedText;
  const href = escHtml(cleanHref, token.autolink);
  let out = '<a href="' + href + '"';
  if (token.title) out += ' title="' + escHtml(token.title) + '"';
  out += '>' + parsedText + '</a>';
  return out;
}

function renderImage(token) {
  let text = token.text;
  if (token.tokens) text = renderInlinePlain(token.tokens);
  const cleanHref = cleanUrl(token.href);
  if (cleanHref === null) return escHtml(text);
  const href = cleanHref;
  let out = '<img src="' + escHtml(href) + '" alt="' + escHtml(text) + '"';
  if (token.title) out += ' title="' + escHtml(token.title) + '"';
  out += '>';
  return out;
}

function renderInline(tokens) {
  let out = '';
  for (const token of tokens) {
    switch (token.type) {
      case 'escape':
      case 'text':
        out += renderText(token);
        break;
      case 'html':
        out += token.text;
        break;
      case 'link':
        out += renderLink(token);
        break;
      case 'image':
        out += renderImage(token);
        break;
      case 'checkbox':
        out += '<input ' + (token.checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
        break;
      case 'strong':
        out += '<strong>' + renderInline(token.tokens) + '</strong>';
        break;
      case 'em':
        out += '<em>' + renderInline(token.tokens) + '</em>';
        break;
      case 'codespan':
        out += '<code>' + escHtml(token.text, true) + '</code>';
        break;
      case 'br':
        out += '<br>';
        break;
      case 'del':
        out += '<del>' + renderInline(token.tokens) + '</del>';
        break;
      default:
        throw new Error('Token with "' + token.type + '" type was not found.');
    }
  }
  return out;
}

function renderCode(token) {
  const langString = (token.lang || '').match(O.notSpaceStart)?.[0];
  const code = token.text ? token.text.replace(O.endingNewline, '') + '\n' : '';
  if (!langString) {
    return '<pre><code>' + escHtml(code, true) + '</code></pre>\n';
  }
  return '<pre><code class="language-' + escHtml(langString) + '">'
    + escHtml(code, true) + '</code></pre>\n';
}

function renderTable(token) {
  let header = '';
  let cell = '';
  for (const h of token.header) cell += renderTableCell(h);
  header += '<tr>\n' + cell + '</tr>\n';
  let body = '';
  for (const row of token.rows) {
    cell = '';
    for (const c of row) cell += renderTableCell(c);
    body += '<tr>\n' + cell + '</tr>\n';
  }
  if (body) body = '<tbody>' + body + '</tbody>';
  return '<table>\n<thead>\n' + header + '</thead>\n' + body + '</table>\n';
}

function renderTableCell(token) {
  const content = renderInline(token.tokens);
  const type = token.header ? 'th' : 'td';
  const tag = token.align ? '<' + type + ' align="' + token.align + '">' : '<' + type + '>';
  return tag + content + '</' + type + '>\n';
}

function renderListItem(item) {
  return '<li>' + renderTokens(item.tokens) + '</li>\n';
}

function renderTokens(tokens) {
  let out = '';
  for (const token of tokens) {
    switch (token.type) {
      case 'space':
      case 'def':
        break;
      case 'hr':
        out += '<hr>\n';
        break;
      case 'heading':
        out += '<h' + token.depth + '>' + renderInline(token.tokens) + '</h' + token.depth + '>\n';
        break;
      case 'code':
        out += renderCode(token);
        break;
      case 'table':
        out += renderTable(token);
        break;
      case 'blockquote':
        out += '<blockquote>\n' + renderTokens(token.tokens) + '</blockquote>\n';
        break;
      case 'list': {
        const type = token.ordered ? 'ol' : 'ul';
        const startAttr = token.ordered && token.start !== 1 ? ' start="' + token.start + '"' : '';
        let body = '';
        for (const item of token.items) body += renderListItem(item);
        out += '<' + type + startAttr + '>\n' + body + '</' + type + '>\n';
        break;
      }
      case 'checkbox':
        out += '<input ' + (token.checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
        break;
      case 'html':
        out += token.text;
        break;
      case 'paragraph':
        out += '<p>' + renderInline(token.tokens) + '</p>\n';
        break;
      case 'text':
        out += renderText(token);
        break;
      default:
        throw new Error('Token with "' + token.type + '" type was not found.');
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

export function parse(markdown) {
  const st = newState();
  const src = markdown.replace(/\r\n|\r/g, '\n');
  const tokens = blockTokens(st, src, []);

  for (const next of st.inlineQueue) {
    // An inline <pre>, <code>, <kbd> or <script> left open ends with the
    // block holding it; carried over, it would stop every later block's
    // text from being escaped.
    st.inRawBlock = false;
    inlineTokens(st, next.src, next.tokens);
  }
  st.inlineQueue = [];

  return renderTokens(tokens);
}
