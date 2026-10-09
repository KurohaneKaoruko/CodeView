// 编辑器：多标签页、查看（高亮）/编辑双模式、Ctrl+S 保存、面包屑
import { api } from '../api.js?v=3';
import { el, icon, toast, errToast, fmtSize, confirmDlg } from '../ui.js?v=3';
import { highlight, langOfPath } from '../highlight.js?v=3';

const tabs = [];
let activePath = null;
let container = null;
let dirtyListener = null;
let pendingLine = null;

export function init(parent) {
  container = el('div', { class: 'editor-wrap' });
  parent.append(container);
  render();
  return container;
}

export function onDirtyChange(fn) { dirtyListener = fn; }

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
    });
    activePath = path;
    render();
  }).catch(errToast);
}

export function clearAll() {
  tabs.length = 0;
  activePath = null;
  pendingLine = null;
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
    tabBar.append(el('div', {
      class: `tab${t.path === activePath ? ' active' : ''}`,
      onclick: () => { activePath = t.path; render(); },
      title: t.path,
    },
    ic,
    el('span', {}, t.path.split('/').pop()),
    dirty ? el('span', { class: 'dirty', title: '未保存' }) : null,
    el('span', {
      class: 'close', title: '关闭',
      onclick: (e) => { e.stopPropagation(); closeTab(t.path); },
    }, icon('x', 11)),
    ));
  }
  container.append(tabBar);

  const cur = tabs.find((x) => x.path === activePath);
  if (!cur) {
    container.append(el('div', { class: 'editor-empty' },
      el('span', { class: 'big' }, '⌘'),
      el('div', {}, '在左侧选择文件，即可查看 / 编辑'),
      el('div', { class: 'muted', style: { fontSize: '11.5px' } }, el('kbd', {}, 'Ctrl'), ' + ', el('kbd', {}, 'S'), ' 保存　', el('kbd', {}, 'Ctrl'), ' + ', el('kbd', {}, 'Tab'), ' 切换标签'),
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
      onclick: () => { cur.editMode = false; render(); },
    }, icon('eye', 12), '阅读'),
    el('button', {
      class: `mp${cur.editMode ? ' on' : ''}`,
      onclick: () => { if (!cur.binary) { cur.editMode = true; render(); } },
    }, icon('edit', 12), '编辑'),
  );
  const toolbar = el('div', { class: 'editor-toolbar' },
    modePill,
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
    ta.addEventListener('scroll', syncGutter);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = ta.selectionStart;
        ta.setRangeText('    ', s, ta.selectionEnd, 'end');
        cur.content = ta.value;
      }
    });
    body.append(gutter, ta);
    setTimeout(() => { syncGutter(); ta.focus(); }, 0);
  } else if (cur.binary) {
    body.append(el('div', { class: 'editor-empty', style: { flex: 1 } },
      el('span', { class: 'big' }, '▦'),
      el('div', {}, `二进制文件（${fmtSize(cur.size)}），不支持预览`)));
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
  }
  container.append(body);
}

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
