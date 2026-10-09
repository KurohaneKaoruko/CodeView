// 轻量客户端语法高亮（正则 tokenizer，覆盖常见语言）

const KW = {
  rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  js: 'abstract async await break case catch class const continue debugger default delete do else export extends false finally for from function get if implements import in instanceof interface let new null of return set static super switch this throw true try typeof undefined var void while with yield',
  ts: 'abstract any as asserts async await boolean break case catch class const constructor continue declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let namespace never new null number of private protected public readonly return set static string super switch symbol this throw true try type typeof undefined unknown var void while yield',
  py: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case',
  c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false',
  java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var record',
};

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const rulesCache = new Map();

function rulesFor(lang) {
  if (rulesCache.has(lang)) return rulesCache.get(lang);
  const R = [];
  const kw = KW[lang];
  switch (lang) {
    case 'rust':
      R.push([/\/\/\/?.*/y, 'c'], [/\/\*[\s\S]*?\*\//y, 'c']);
      R.push([/r?#*"(?:[^"]|"#)*"#*/y, 's'], [/"(?:\\.|[^"\\])*"/y, 's'], [/'(?:\\.|[^\\'])'/y, 's'], [/'[A-Za-z_][A-Za-z0-9_]*/y, 't']);
      R.push([/#\!?\[[^\]]*\]/y, 'a'], [/[a-z_][A-Za-z0-9_]*!/y, 'a']);
      break;
    case 'js': case 'ts':
      R.push([/\/\/.*/y, 'c'], [/\/\*[\s\S]*?\*\//y, 'c']);
      R.push([/`(?:\\.|[^`\\])*`/y, 's'], [/"(?:\\.|[^"\\])*"/y, 's'], [/'(?:\\.|[^'\\])*'/y, 's']);
      break;
    case 'py':
      R.push([/#.*/y, 'c']);
      R.push([/[rbfu]{0,2}"(?:\\.|[^"\\])*"/iy, 's'], [/[rbfu]{0,2}'(?:\\.|[^'\\])*'/iy, 's']);
      R.push([/@[A-Za-z_][\w.]*/y, 'a']);
      break;
    case 'c': case 'cpp':
      R.push([/\/\/.*/y, 'c'], [/\/\*[\s\S]*?\*\//y, 'c']);
      R.push([/"(?:\\.|[^"\\])*"/y, 's'], [/'(?:\\.|[^'\\])*'/y, 's']);
      R.push([/^\s*#\s*\w+.*$/my, 'a']);
      break;
    case 'go': case 'java':
      R.push([/\/\/.*/y, 'c'], [/\/\*[\s\S]*?\*\//y, 'c']);
      R.push([/"(?:\\.|[^"\\])*"/y, 's'], [/'(?:\\.|[^'\\])*'/y, 's'], [/`[^`]*`/y, 's']);
      break;
    default:
      R.push([/\/\/.*/y, 'c'], [/#.*/y, 'c'], [/"(?:\\.|[^"\\])*"/y, 's'], [/'(?:\\.|[^'\\])*'/y, 's']);
  }
  if (kw) R.push([new RegExp(`\\b(?:${kw.split(' ').join('|')})\\b`, 'y'), 'k']);
  R.push([/\b0x[0-9a-fA-F_]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y, 'n']);
  R.push([/\b[A-Z][A-Za-z0-9_]*\b/y, 't']);
  R.push([/\b[a-z_][A-Za-z0-9_]*(?=\s*\()/y, 'f']);
  R.push([/[{}()[\];,.:=+\-*/%<>!&|^~?]+/y, 'p']);
  rulesCache.set(lang, R);
  return R;
}

export function langOfPath(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const map = {
    rs: 'rust', js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'ts', tsx: 'ts', mts: 'ts',
    py: 'py', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
    go: 'go', java: 'java', json: 'js', toml: 'py', yaml: 'py', yml: 'py',
    md: 'md', css: 'css', html: 'html', sh: 'py', bat: 'py', ps1: 'py',
  };
  return map[ext] || '';
}

/** 返回高亮 HTML；lang 为空则整体转义 */
export function highlight(code, lang) {
  if (!lang || lang === 'md' || lang === 'css' || lang === 'html') {
    if (lang === 'md') return mdHighlight(code);
    return esc(code);
  }
  const rules = rulesFor(lang);
  let out = '';
  let pos = 0;
  const n = code.length;
  let guard = 0;
  while (pos < n && guard++ < 4_000_000) {
    let matched = false;
    for (const [re, cls] of rules) {
      re.lastIndex = pos;
      const m = re.exec(code);
      if (m && m.index === pos && m[0].length > 0) {
        out += `<span class="${cls}">${esc(m[0])}</span>`;
        pos += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += esc(code[pos]);
      pos++;
    }
  }
  if (pos < n) out += esc(code.slice(pos));
  return out;
}

function mdHighlight(code) {
  // 极简 Markdown：标题/代码块/引用/加粗
  return code.split('\n').map((line) => {
    const e = esc(line);
    if (/^#{1,6}\s/.test(line)) return `<span class="t">${e}</span>`;
    if (/^\s*(```|~~~)/.test(line)) return `<span class="a">${e}</span>`;
    if (/^\s*>/.test(line)) return `<span class="c">${e}</span>`;
    return e.replace(/(\*\*[^*]+\*\*|`[^`]+`)/g, '<span class="s">$1</span>');
  }).join('\n');
}
