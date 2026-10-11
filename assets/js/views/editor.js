// 编辑器：多标签页、查看（高亮）/编辑双模式、Ctrl+S 保存、面包屑
// 增强：文件内查找（Ctrl+F）、跳转行（Ctrl+G）、缩进/反缩进、自动缩进与括号补全、光标定位
import { api } from '../api.js?v=3';
import { el, icon, toast, errToast, fmtSize, confirmDlg, formModal } from '../ui.js?v=3';
import { highlight, langOfPath } from '../highlight.js?v=3';

const tabs = [];
let activePath = null;
let container = null;
let dirtyListener = null;
let cursorListener = null;
let pendingLine = null;

const IND = '    ';

// ---- 查找状态（跨标签常驻查询串） ----
const findState = { open: false, query: '', cs: false, matches: [], idx: 0 };
let findBarEl = null;
let findInput = null;
let findCountEl = null;

export function init(parent) {
  container = el('div', { class: 'editor-wrap' });
  parent.append(container);
  render();
  return container;
}

export function onDirtyChange(fn) { dirtyListener = fn; }
/** 光标位置回调：({ line, col, sel }) */
export function onCursorChange(fn) { cursorListener = fn; }

export function openFile(path) {
  const existing = tabs.find((t) => t.path === path);
  if (existing) {
    activePath = path;
    render();
    return;
  }
  api.file(path).then((f) => {
    tabs.push({
      path,
      content: f.content,
      orig: f.content,
      binary: f.binary,
      size: f.size,
      lineCount: f.line_count,
      lang: langOfPath(path),
      editMode: false,
      caret: 0,
      scroll: 0,
    });
    activePath = path;
    render();
  }).catch(errToast);
}

export function clearAll() {
  tabs.length = 0;
  activePath = null;
  pendingLine = null;
  findState.matches = [];
  render();
}

export function cycleTab(dir = 1) {
  if (tabs.length < 2) return;
  const i = tabs.findIndex((t) => t.path === activePath);
  const next = tabs[(i + dir + tabs.length) % tabs.length];
  activePath = next.path;
  render();
}

/** 打开文件并跳转到指定行（阅读模式下高亮该行） */
export function openFileAt(path, line) {
  pendingLine = line;
  openFile(path);
}

export const getActivePath = () => activePath;
export const hasDirty = () => tabs.some((t) => t.content !== t.orig);

/** 切换阅读 / 编辑模式 */
export function toggleMode() {
  const cur = tabs.find((x) => x.path === activePath);
  if (!cur || cur.binary) return;
  cur.editMode = !cur.editMode;
  render();
}

/** 关闭当前标签 */
export function closeActive() {
  if (activePath) closeTab(activePath);
}

/** 从磁盘重新加载当前文件 */
export async function reloadActive() {
  const t = tabs.find((x) => x.path === activePath);
  if (!t) return;
  if (t.content !== t.orig) {
    const ok = await confirmDlg(`${t.path} 有未保存的修改，重新加载将丢弃它们，继续？`, '重新加载');
    if (!ok) return;
  }
  try {
    const f = await api.file(t.path);
    t.content = f.content;
    t.orig = f.content;
    t.binary = f.binary;
    t.size = f.size;
    t.lineCount = f.line_count;
    toast(`已重新加载 ${t.path}`, 'ok');
    render();
  } catch (e) { errToast(e); }
}

export function fileRenamed(from, to) {
  for (const t of tabs) if (t.path === from || t.path.startsWith(from + '/')) t.path = to + t.path.slice(from.length);
  render();
}

export function fileDeleted(path) {
  const i = tabs.findIndex((t) => t.path === path);
  if (i >= 0) {
    tabs.splice(i, 1);
    if (activePath === path) activePath = tabs.length ? tabs[Math.max(0, i - 1)].path : null;
    render();
  }
}

export async function saveActive() {
  const t = tabs.find((x) => x.path === activePath);
  if (!t) return;
  if (t.binary) { toast('二进制文件不支持编辑保存', 'err'); return; }
  try {
    // 记住光标与滚动位置，保存后恢复（避免整页重渲染打断输入）
    const ta = document.querySelector('.editor-body textarea');
    const sel = ta ? { start: ta.selectionStart, end: ta.selectionEnd, top: ta.scrollTop } : null;
    await api.saveFile(t.path, t.content);
    t.orig = t.content;
    toast(`已保存 ${t.path}`, 'ok');
    render();
    if (sel) {
      const ta2 = document.querySelector('.editor-body textarea');
      if (ta2) {
        ta2.focus();
        ta2.setSelectionRange(sel.start, sel.end);
        ta2.scrollTop = sel.top;
        notifyCursor(ta2);
      }
    }
    window.CodeView.gitChanged();
  } catch (e) { errToast(e); }
}

function closeTab(path) {
  const t = tabs.find((x) => x.path === path);
  const doClose = () => {
    const i = tabs.findIndex((x) => x.path === path);
    if (i >= 0) tabs.splice(i, 1);
    if (activePath === path) activePath = tabs.length ? tabs[Math.min(i, tabs.length - 1)].path : null;
    render();
  };
  if (t && t.content !== t.orig) {
    confirmDlg(`${t.path} 有未保存的修改，确定关闭？`, '关闭').then((ok) => { if (ok) doClose(); });
  } else {
    doClose();
  }
}

function notifyDirty() {
  if (dirtyListener) dirtyListener(tabs.filter((t) => t.content !== t.orig).length);
}

function notifyCursor(ta) {
  if (!cursorListener || !ta) return;
  const v = ta.value;
  const s = ta.selectionStart, e = ta.selectionEnd;
  const before = v.slice(0, s);
  const line = before.split('\n').length;
  const col = s - (before.lastIndexOf('\n') + 1) + 1;
  cursorListener({ line, col, sel: Math.abs(e - s) });
}

// ---------------- 渲染 ----------------

function render() {
  if (!container) return;
  container.innerHTML = '';
  notifyDirty();
  // openFileAt 跳行时强制回到阅读模式
  if (pendingLine != null) {
    const cur0 = tabs.find((x) => x.path === activePath);
    if (cur0) cur0.editMode = false;
  }

  // 标签栏
  const tabBar = el('div', { class: 'tabs' });
  for (const t of tabs) {
    const dirty = t.content !== t.orig;
    const ic = icon('file', 13, 'ic ficon');
    ic.style.color = fileTabColor(t.path);
    const tabEl = el('div', {
      class: `tab${t.path === activePath ? ' active' : ''}`,
      onclick: () => { activePath = t.path; render(); },
      onauxclick: (e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.path); } },
      title: t.path,
    },
    ic,
    el('span', {}, t.path.split('/').pop()),
    dirty ? el('span', { class: 'dirty', title: '未保存' }) : null,
    el('span', {
      class: 'close', title: '关闭 (Ctrl+W)',
      onclick: (e) => { e.stopPropagation(); closeTab(t.path); },
    }, icon('x', 11)),
    );
    tabBar.append(tabEl);
  }
  container.append(tabBar);

  const cur = tabs.find((x) => x.path === activePath);
  if (!cur) {
    container.append(el('div', { class: 'editor-empty' },
      el('span', { class: 'big' }, '⌘'),
      el('div', {}, '在左侧选择文件，即可查看 / 编辑'),
      el('div', { class: 'muted', style: { fontSize: '11.5px' } },
        el('kbd', {}, 'Ctrl'), ' + ', el('kbd', {}, 'P'), ' 快速打开　',
        el('kbd', {}, 'Ctrl'), ' + ', el('kbd', {}, 'F'), ' 查找　',
        el('kbd', {}, 'Ctrl'), ' + ', el('kbd', {}, 'S'), ' 保存'),
    ));
    return;
  }

  // 面包屑
  const parts = cur.path.split('/');
  const crumbs = el('div', { class: 'breadcrumbs' },
    parts.map((p, i) => [
      i > 0 ? el('span', { class: 'sep' }, '›') : null,
      el('span', { class: 'seg' }, p),
    ]),
  );
  container.append(crumbs);

  // 工具栏
  const dirty = cur.content !== cur.orig;
  const modePill = el('span', { class: 'mode-pill' },
    el('button', {
      class: `mp${!cur.editMode ? ' on' : ''}`,
      title: '阅读模式',
      onclick: () => { cur.editMode = false; render(); },
    }, icon('eye', 12), '阅读'),
    el('button', {
      class: `mp${cur.editMode ? ' on' : ''}`,
      title: '编辑模式',
      onclick: () => { if (!cur.binary) { cur.editMode = true; render(); } },
    }, icon('edit', 12), '编辑'),
  );
  const toolbar = el('div', { class: 'editor-toolbar' },
    modePill,
    el('button', { class: 'btn mini ghost', title: '在文件中查找 (Ctrl+F)', onclick: () => openFind() }, icon('search', 12), '查找'),
    cur.editMode && !cur.binary ? el('button', { class: 'btn mini ghost', title: '跳转到行 (Ctrl+G)', onclick: () => goToLine() }, icon('layers', 12), '跳行') : null,
    el('span', { class: 'meta' },
      el('span', {}, cur.lang || 'text'),
      el('span', {}, `${(cur.content.split('\n').length)} 行`),
      el('span', {}, fmtSize(cur.size ?? cur.content.length)),
      cur.binary ? el('span', { style: { color: 'var(--orange)' } }, '二进制') : null,
    ),
    el('span', { style: { flex: 1 } }),
    dirty ? el('span', { style: { color: 'var(--yellow)', fontSize: '11.5px', display: 'inline-flex', alignItems: 'center', gap: '5px' } },
      el('span', { class: 'dirty', style: { width: '7px', height: '7px', borderRadius: '50%', background: 'var(--yellow)', display: 'inline-block' } }), '未保存') : null,
    cur.editMode && !cur.binary ? el('button', {
      class: 'btn primary mini',
      onclick: () => saveActive().then(() => render()),
    }, icon('save', 12), '保存 (Ctrl+S)') : null,
    cur.editMode && !cur.binary ? el('button', {
      class: 'btn mini danger',
      onclick: () => { cur.content = cur.orig; render(); },
    }, icon('revert', 12), '还原') : null,
  );
  container.append(toolbar);

  // 查找条（常驻元素复用，避免输入时丢焦点）
  if (findState.open) {
    if (!findBarEl) findBarEl = buildFindBar();
    container.append(findBarEl);
  }

  // 内容区
  const body = el('div', { class: 'editor-body' });
  if (cur.editMode && !cur.binary) {
    const gutterInner = el('div', { class: 'gutter-inner' });
    const gutter = el('div', { class: 'gutter', style: { overflow: 'hidden' } }, gutterInner);
    const ta = el('textarea', { spellcheck: 'false' });
    ta.value = cur.content;
    const syncGutter = () => {
      const lines = ta.value.split('\n').length;
      const start = Math.max(0, Math.floor(ta.scrollTop / lineHeight) - 1);
      const vis = Math.ceil(ta.clientHeight / lineHeight) + 2;
      let g = '';
      for (let i = start + 1; i <= Math.max(lines, start + vis); i++) g += `${i}\n`;
      gutterInner.textContent = g;
      gutterInner.style.transform = `translateY(${-start * lineHeight}px)`;
    };
    ta.addEventListener('input', () => { cur.content = ta.value; syncGutter(); notifyDirty(); });
    ta.addEventListener('scroll', () => { syncGutter(); cur.scroll = ta.scrollTop; });
    ta.addEventListener('keydown', (e) => onEditorKey(e, ta, cur));
    ta.addEventListener('click', () => notifyCursor(ta));
    ta.addEventListener('keyup', () => notifyCursor(ta));
    ta.addEventListener('select', () => notifyCursor(ta));
    body.append(gutter, ta);
    setTimeout(() => {
      syncGutter();
      // 恢复光标 / 滚动位置
      if (cur.caret > 0 && cur.caret <= ta.value.length) ta.setSelectionRange(cur.caret, cur.caret);
      if (cur.scroll) ta.scrollTop = cur.scroll;
      ta.focus();
      notifyCursor(ta);
      if (findState.open) applyFind();
    }, 0);
  } else if (cur.binary) {
    body.append(el('div', { class: 'editor-empty', style: { flex: 1 } },
      el('span', { class: 'big' }, '▦'),
      el('div', {}, `二进制文件（${fmtSize(cur.size)}），不支持预览`)));
    if (cursorListener) cursorListener(null);
  } else {
    const gutterInner = el('div', { class: 'gutter-inner' }, rangeText(cur.content.split('\n').length));
    const gutter = el('div', { class: 'gutter', style: { overflow: 'hidden' } }, gutterInner);
    const scroll = el('div', { class: 'code-scroll' });
    const pre = el('pre', { class: 'codeview' });
    let html = highlight(cur.content, cur.lang);
    if (pendingLine != null) {
      const lines = html.split('\n');
      const i = pendingLine - 1;
      if (i >= 0 && i < lines.length) {
        lines[i] = `<span class="line-hl">${lines[i] || ' '}</span>`;
        html = lines.join('\n');
        const target = pendingLine;
        setTimeout(() => { scroll.scrollTop = Math.max(0, (target - 4) * lineHeight); }, 0);
      }
      pendingLine = null;
    }
    pre.innerHTML = html;
    scroll.append(pre);
    scroll.addEventListener('scroll', () => { gutterInner.style.transform = `translateY(${-scroll.scrollTop}px)`; });
    body.append(gutter, scroll);
    setTimeout(() => { if (findState.open) applyFind(); }, 0);
    if (cursorListener) cursorListener(null);
  }
  container.append(body);
}

// 输入防抖：大文件下避免每次按键都整体重高亮
let findTimer = null;
function debouncedFind() {
  clearTimeout(findTimer);
  findTimer = setTimeout(applyFind, 110);
}

// ---------------- 编辑增强 ----------------

function onEditorKey(e, ta, cur) {
  // Tab / Shift+Tab：缩进 / 反缩进
  if (e.key === 'Tab') {
    e.preventDefault();
    transformIndent(ta, e.shiftKey);
    cur.content = ta.value;
    notifyDirty();
    notifyCursor(ta);
    return;
  }
  // Enter：自动保持缩进 / 括号内换行
  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    handleEnter(ta);
    cur.content = ta.value;
    notifyDirty();
    notifyCursor(ta);
    return;
  }
  // Backspace：删除空配对
  if (e.key === 'Backspace' && ta.selectionStart === ta.selectionEnd) {
    const s = ta.selectionStart;
    const a = ta.value[s - 1], b = ta.value[s];
    if (a && b && PAIRS[a] === b) {
      e.preventDefault();
      ta.setRangeText('', s - 1, s + 1, 'end');
      cur.content = ta.value;
      notifyDirty();
      return;
    }
  }
  // 自动补全括号 / 引号
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    const k = e.key;
    if (k.length === 1) {
      // 闭合符号跳过
      if (CLOSERS.includes(k) && ta.selectionStart === ta.selectionEnd && ta.value[ta.selectionStart] === k) {
        e.preventDefault();
        const c = ta.selectionStart + 1;
        ta.setSelectionRange(c, c);
        notifyCursor(ta);
        return;
      }
      if (k in PAIRS) {
        const handled = autoPair(ta, k);
        if (handled) {
          e.preventDefault();
          cur.content = ta.value;
          notifyDirty();
          notifyCursor(ta);
          return;
        }
      }
    }
  }
}

const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
const CLOSERS = [')', ']', '}', '"', "'", '`'];
const OPENERS = ['(', '[', '{'];

function autoPair(ta, k) {
  const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
  const close = PAIRS[k];
  if (s !== e) { // 有选区 → 用括号包裹
    ta.setRangeText(k + v.slice(s, e) + close, s, e, 'end');
    ta.setSelectionRange(s + 1, e + 1);
    return true;
  }
  // 引号：紧跟在单词字符后不自动补全（如 don't）
  if ((k === '"' || k === "'" || k === '`') && /[\w'"`]/.test(v[s - 1] || '')) return false;
  // 右侧是空白或闭合符时才补全
  const after = v[s] || '';
  if (after && !/[\s)\]}>,;:]/.test(after)) return false;
  ta.setRangeText(k + close, s, s, 'end');
  const c = s + 1;
  ta.setSelectionRange(c, c);
  return true;
}

function handleEnter(ta) {
  const v = ta.value;
  const s = ta.selectionStart, e = ta.selectionEnd;
  const lineStart = v.lastIndexOf('\n', s - 1) + 1;
  const curLine = v.slice(lineStart, s);
  const indent = (curLine.match(/^[ \t]*/) || [''])[0];
  const chBefore = v[s - 1] || '';
  const chAfter = v[e] || '';
  const pair = OPENERS.indexOf(chBefore) >= 0 && PAIRS[chBefore] === chAfter;
  if (pair) {
    const insert = `\n${indent}${IND}\n${indent}`;
    ta.setRangeText(insert, s, e, 'end');
    const caret = s + 1 + indent.length + IND.length;
    ta.setSelectionRange(caret, caret);
  } else {
    let insert = `\n${indent}`;
    if (OPENERS.includes(chBefore)) insert += IND;
    ta.setRangeText(insert, s, e, 'end');
  }
}

function transformIndent(ta, dedent) {
  const v = ta.value;
  const s = ta.selectionStart, e = ta.selectionEnd;
  const lineStart = v.lastIndexOf('\n', s - 1) + 1;
  let lineEnd = v.indexOf('\n', e);
  if (lineEnd === -1) lineEnd = v.length;
  const lines = v.slice(lineStart, lineEnd).split('\n');
  let deltaFirst = 0;
  const out = lines.map((l, i) => {
    if (dedent) {
      let removed = 0;
      if (l.startsWith('\t')) removed = 1;
      else { const m = l.match(/^ {1,4}/); removed = m ? m[0].length : 0; }
      if (i === 0) deltaFirst = -removed;
      return l.slice(removed);
    }
    if (i === 0) deltaFirst = IND.length;
    return IND + l;
  }).join('\n');
  const hadSel = e > s;
  ta.value = v.slice(0, lineStart) + out + v.slice(lineEnd);
  if (hadSel) {
    ta.setSelectionRange(lineStart, lineStart + out.length);
  } else {
    const c = Math.max(lineStart, s + deltaFirst);
    ta.setSelectionRange(c, c);
  }
}

// ---------------- 文件内查找 ----------------

function buildFindBar() {
  findInput = el('input', {
    type: 'text', class: 'find-input', placeholder: '在文件中查找…', spellcheck: 'false', autocomplete: 'off',
  });
  findCountEl = el('span', { class: 'find-count' }, '');
  const csBox = el('input', { type: 'checkbox' });
  csBox.checked = findState.cs;
  csBox.addEventListener('change', () => { findState.cs = csBox.checked; findState.idx = 0; applyFind(); });

  findInput.addEventListener('input', () => { findState.query = findInput.value; findState.idx = 0; debouncedFind(); });
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
    else if (e.key === 'F3') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
  });

  const bar = el('div', { class: 'find-bar' },
    el('div', { class: 'find-box' },
      icon('search', 13),
      findInput,
      findCountEl,
      el('button', { class: 'find-btn', title: '上一个 (Shift+Enter)', onclick: () => stepFind(-1) }, icon('chev-down', 13, 'ic rot180')),
      el('button', { class: 'find-btn', title: '下一个 (Enter)', onclick: () => stepFind(1) }, icon('chev-down', 13)),
      el('label', { class: 'm-check', title: '区分大小写' }, csBox, el('span', {}, 'Aa')),
      el('button', { class: 'find-btn', title: '关闭 (Esc)', onclick: () => closeFind() }, icon('x', 13)),
    ),
  );
  return bar;
}

export function openFind() {
  const cur = tabs.find((x) => x.path === activePath);
  if (!cur || cur.binary) return;
  findState.open = true;
  if (!findBarEl) findBarEl = buildFindBar();
  if (!container.querySelector('.find-bar')) {
    const tb = container.querySelector('.editor-toolbar');
    if (tb) tb.after(findBarEl); else container.append(findBarEl);
  }
  if (findInput) {
    findInput.value = findState.query;
    setTimeout(() => { findInput.focus(); findInput.select(); }, 0);
  }
  applyFind();
}

export function closeFind() {
  findState.open = false;
  if (findBarEl) findBarEl.remove();
  // 清除阅读模式下的查找高亮
  const cur = tabs.find((x) => x.path === activePath);
  const pre = container.querySelector('pre.codeview');
  if (cur && pre && !cur.editMode) pre.innerHTML = highlight(cur.content, cur.lang);
  const ta = container.querySelector('.editor-body textarea');
  if (ta) ta.focus();
}

function computeMatches(content, query, cs) {
  const out = [];
  if (!query) return out;
  const hay = cs ? content : content.toLowerCase();
  const needle = cs ? query : query.toLowerCase();
  if (!needle) return out;
  let i = 0;
  while (i <= hay.length) {
    const p = hay.indexOf(needle, i);
    if (p === -1) break;
    out.push({ start: p, end: p + needle.length });
    i = p + Math.max(1, needle.length);
    if (out.length >= 5000) break;
  }
  return out;
}

function applyFind() {
  const cur = tabs.find((x) => x.path === activePath);
  if (!cur) return;
  findState.matches = computeMatches(cur.content, findState.query, findState.cs);
  if (findState.idx >= findState.matches.length) findState.idx = 0;
  const total = findState.matches.length;
  if (findCountEl) {
    if (!findState.query) findCountEl.textContent = '';
    else if (!total) findCountEl.textContent = '无结果';
    else findCountEl.textContent = `${findState.idx + 1}/${total}`;
  }
  if (cur.editMode) {
    applyFindTextarea(cur);
  } else {
    const scroll = container.querySelector('.code-scroll');
    const pre = container.querySelector('pre.codeview');
    if (pre) {
      pre.innerHTML = highlight(cur.content, cur.lang);
      paintMatches(pre, findState.matches, findState.idx);
      const curEl = pre.querySelector('mark.find-hit.cur');
      if (curEl && scroll) scroll.scrollTop = Math.max(0, curEl.offsetTop - scroll.clientHeight / 2);
    }
  }
}

function applyFindTextarea(cur) {
  const ta = container.querySelector('.editor-body textarea');
  const m = findState.matches[findState.idx];
  if (!ta || !m) return;
  try { ta.setSelectionRange(m.start, m.end); } catch { /* ignore */ }
  const line = cur.content.slice(0, m.start).split('\n').length;
  ta.scrollTop = Math.max(0, (line - 1) * lineHeight - ta.clientHeight / 3);
}

function stepFind(dir) {
  const n = findState.matches.length;
  if (!n) return;
  findState.idx = (findState.idx + dir + n) % n;
  applyFind();
}

/** 在已高亮的 DOM 上包裹命中词；支持跨越多个语法节点（如 `pub fn`）的短语 */
function paintMatches(pre, matches, curIdx) {
  if (!matches.length) return;
  const nodes = [];
  const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) nodes.push(walker.currentNode);
  if (!nodes.length) return;
  const starts = [];
  let pos = 0;
  for (const n of nodes) { starts.push(pos); pos += n.nodeValue.length; }

  // 先按原始偏移为每个文本节点收集片段（此时尚未修改 DOM，长度可信）
  const perNode = nodes.map(() => []);
  matches.forEach((m, mi) => {
    let k = -1;
    for (let j = nodes.length - 1; j >= 0; j--) { if (starts[j] <= m.start) { k = j; break; } }
    if (k < 0) return;
    let offset = m.start;
    while (k < nodes.length && offset < m.end) {
      const ns = starts[k];
      const len = nodes[k].nodeValue.length;
      const ls = Math.max(0, offset - ns);
      const le = Math.min(len, m.end - ns);
      if (le > ls) perNode[k].push({ ls, le, cur: mi === curIdx });
      offset = ns + len;
      k++;
    }
  });

  // 逐节点、由后向前包裹，避免拆分影响尚未处理的偏移
  for (let k = nodes.length - 1; k >= 0; k--) {
    const node = nodes[k];
    const ranges = perNode[k].sort((a, b) => b.ls - a.ls);
    for (const r of ranges) {
      if (r.le > node.nodeValue.length) continue;
      const range = document.createRange();
      range.setStart(node, r.ls);
      range.setEnd(node, r.le);
      const mark = document.createElement('mark');
      mark.className = 'find-hit' + (r.cur ? ' cur' : '');
      try { range.surroundContents(mark); } catch { /* ignore */ }
    }
  }
}

/** 跳转到指定行（Ctrl+G） */
export async function goToLine() {
  const cur = tabs.find((x) => x.path === activePath);
  if (!cur || cur.binary) return;
  const total = cur.content.split('\n').length;
  const r = await formModal({
    title: '跳转到行',
    icon: 'layers',
    fields: [{ key: 'line', label: `行号（1 - ${total}）`, placeholder: '1', value: '' }],
    okText: '跳转',
  });
  if (!r) return;
  const n = parseInt(r.line, 10);
  if (!n || n < 1) return;
  const line = Math.min(n, total);
  if (cur.editMode) {
    const off = lineOffset(cur.content, line);
    cur.caret = off;
    render();
  } else {
    pendingLine = line;
    render();
  }
}

function lineOffset(content, line) {
  let idx = 0;
  for (let i = 1; i < line; i++) {
    const nl = content.indexOf('\n', idx);
    if (nl === -1) return content.length;
    idx = nl + 1;
  }
  return idx;
}

// ---------------- 工具 ----------------

function fileTabColor(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  return ({ rs: '#f74c00', js: '#f1e05a', ts: '#3178c6', py: '#3572A5', md: '#8fa6c8', json: '#e0b13e' })[ext] || 'var(--fg-faint)';
}

const lineHeight = 20; // 12.5px * 1.6

function rangeText(n) {
  let s = '';
  for (let i = 1; i <= n; i++) s += `${i}\n`;
  return s;
}
