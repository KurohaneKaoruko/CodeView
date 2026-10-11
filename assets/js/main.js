// CodeView 前端入口
import { api } from './api.js?v=3';
import { el, icon, toast, errToast } from './ui.js?v=3';import { initPathDrop } from './pathdrop.js?v=3';
import { hideGraphTooltip } from './gitgraph.js?v=3';
import { showPalette, paletteOpen } from './palette.js?v=3';
import * as files from './views/files.js?v=3';
import * as editor from './views/editor.js?v=3';
import * as git from './views/gitmgmt.js?v=3';
import * as compare from './views/compare.js?v=3';
import * as deps from './views/deps.js?v=3';
import * as searchPanel from './views/searchpanel.js?v=3';
import * as ai from './views/ai.js?v=3';

const S = { overview: null, view: 'files', sidePanel: 'files' };

const side = document.getElementById('side');
const content = document.getElementById('content');

// 活动栏图标：左列每个图标 = 一个视图 或 一个侧栏面板
const ACT_ICONS = { files: 'code', search: 'search', ai: 'sparkles', git: 'branch', compare: 'compare', deps: 'package' };
function syncActivity() {
  document.querySelectorAll('.act-btn').forEach((x) => {
    const onPanel = x.dataset.panel && x.dataset.panel === S.sidePanel && S.view === 'files';
    const onView = x.dataset.view && x.dataset.view === S.view;
    x.classList.toggle('active', !!(onPanel || onView));
  });
}
document.querySelectorAll('.act-btn').forEach((b) => {
  b.append(icon(ACT_ICONS[b.dataset.panel || b.dataset.view], 20));
  b.addEventListener('click', () => {
    if (b.dataset.panel) {
      // 面板图标：切换侧栏面板并回到编辑器视图
      S.sidePanel = b.dataset.panel;
      switchView('files', true);
    } else {
      switchView(b.dataset.view, true);
    }
  });
});

// 编辑器容器常驻（切换视图时隐藏/显示以保留状态）
editor.init(content);
const editorWrap = content.querySelector('.editor-wrap');
editor.onDirtyChange((n) => {
  const el2 = document.getElementById('sb-dirty');
  el2.textContent = n ? `● ${n} 个未保存` : '';
  const tab = document.querySelector('.act-btn[data-panel=files]');
  let badge = tab ? tab.querySelector('.act-badge') : null;
  if (n > 0) {
    if (!badge) { badge = el('span', { class: 'act-badge' }); tab.append(badge); }
    badge.textContent = n;
  } else if (badge) badge.remove();
});

// 状态栏：光标行列 / 选区
editor.onCursorChange((pos) => {
  const sb = document.getElementById('sb-pos');
  if (!sb) return;
  if (!pos) { sb.textContent = ''; sb.title = ''; return; }
  sb.textContent = pos.sel
    ? `行 ${pos.line}，列 ${pos.col}（已选 ${pos.sel}）`
    : `行 ${pos.line}，列 ${pos.col}`;
  sb.title = '光标位置';
});

function setActiveEditor(active) {
  editorWrap.style.display = active ? '' : 'none';
}

// ---- 全局桥 ----
window.CodeView = {
  openFile: (p) => { switchView('files'); editor.openFile(p); },
  activeFile: () => {
    const t = document.querySelector('.tab.active');
    return t ? t.title : null;
  },
  gitChanged: () => {
    files.refreshGitStatus();
    refreshRefsCache().then(refreshStatusbar);
    if (S.view === 'git' && window.CodeView._workRefresh) window.CodeView._workRefresh();
  },
  refreshStatusbar,
  fileRenamed: editor.fileRenamed,
  fileDeleted: editor.fileDeleted,
  openFileAt: editor.openFileAt,
  setCompareA: (oid) => { window.__cmpPrefill = { a: oid }; switchView('compare'); },
  setCompareB: (oid) => { window.__cmpPrefill = { b: oid }; switchView('compare'); },
  switchView,
  quickOpen,
  commandPalette,
  openFind: () => editor.openFind(),
  goToLine: () => editor.goToLine(),
  toggleMode: () => editor.toggleMode(),
  reloadActive: () => editor.reloadActive(),
  closeActive: () => editor.closeActive(),
  showShortcuts,
  _workRefresh: null,
};

// ---- 快速打开（Ctrl+P） ----
let fileIndex = null;
async function ensureFileIndex() {
  if (fileIndex) return fileIndex;
  const r = await api.files();
  fileIndex = r.files || [];
  return fileIndex;
}
function quickOpen() {
  ensureFileIndex().then((list) => {
    if (!list.length) { toast('当前项目没有可打开的文件', 'err'); return; }
    const items = list.map((p) => {
      const i = p.lastIndexOf('/');
      return {
        label: i >= 0 ? p.slice(i + 1) : p,
        sub: i >= 0 ? p.slice(0, i) : '',
        icon: 'file',
        action: () => window.CodeView.openFile(p),
      };
    });
    showPalette({ placeholder: '输入文件名或路径片段…', items, emptyText: '没有匹配的文件', icon: 'file' });
  }).catch(errToast);
}

// ---- 命令面板（Ctrl+Shift+P / F1） ----
function commandPalette() {
  const go = (v) => () => switchView(v, true);
  const items = [
    { label: '视图：资源管理器', sub: '文件树', icon: 'code', keywords: 'explorer files tree', action: () => { S.sidePanel = 'files'; switchView('files', true); } },
    { label: '视图：全局搜索', sub: '侧栏', icon: 'search', keywords: 'search grep find', action: () => { S.sidePanel = 'search'; switchView('files', true); } },
    { label: '视图：Git 管理', sub: '提交 / 分支', icon: 'branch', keywords: 'git scm commit', action: go('git') },
    { label: '视图：提交对比', sub: 'A/B 差异', icon: 'compare', keywords: 'diff compare', action: go('compare') },
    { label: '视图：依赖图谱', sub: '文件 / 符号依赖', icon: 'package', keywords: 'deps graph import', action: go('deps') },
    { label: '视图：AI 分析', sub: '问答 / 概览', icon: 'sparkles', keywords: 'ai chat llm', action: go('ai') },
    '-',
    { label: '文件：快速打开', sub: 'Ctrl+P', icon: 'file', keywords: 'quick open go to file', action: quickOpen },
    { label: '文件：在文件中查找', sub: 'Ctrl+F', icon: 'search', keywords: 'find in file', action: () => { switchView('files'); setTimeout(() => editor.openFind(), 0); } },
    { label: '文件：跳转到行', sub: 'Ctrl+G', icon: 'layers', keywords: 'go to line', action: () => editor.goToLine() },
    { label: '文件：切换阅读 / 编辑模式', sub: '编辑', icon: 'edit', keywords: 'toggle edit mode', action: () => { switchView('files'); setTimeout(() => editor.toggleMode(), 0); } },
    { label: '文件：保存当前文件', sub: 'Ctrl+S', icon: 'save', keywords: 'save write', action: () => { switchView('files'); setTimeout(() => editor.saveActive(), 0); } },
    { label: '文件：从磁盘重新加载', sub: '丢弃内存修改', icon: 'refresh', keywords: 'reload revert disk', action: () => { switchView('files'); setTimeout(() => editor.reloadActive(), 0); } },
    { label: '文件：关闭当前标签', sub: '', icon: 'x', keywords: 'close tab', action: () => { switchView('files'); setTimeout(() => editor.closeActive(), 0); } },
    '-',
    { label: '项目：打开其他项目…', sub: '路径输入框', icon: 'folderOpen', keywords: 'open project folder', action: () => { const i = document.getElementById('root-input'); if (i) { i.focus(); i.select(); } } },
    { label: '项目：在系统文件管理器中显示', sub: '', icon: 'folderOpen', keywords: 'reveal explorer finder', action: () => { if (S.overview) fetch(`/api/open_native?path=${encodeURIComponent(S.overview.root)}`).catch(() => {}); } },
    { label: '项目：刷新 Git 状态', sub: '', icon: 'refresh', keywords: 'refresh git status', action: () => window.CodeView.gitChanged() },
    '-',
    { label: '帮助：键盘快捷键', sub: 'Ctrl+/', icon: 'terminal', keywords: 'shortcuts keybindings help', action: showShortcuts },
  ];
  showPalette({
    placeholder: '输入命令…',
    icon: 'terminal',
    items,
    emptyText: '没有匹配的命令',
    onSelect: (it) => it.action && it.action(),
  });
}

// ---- 快捷键帮助 ----
function showShortcuts() {
  const rows = [
    ['Ctrl + P', '快速打开文件'],
    ['Ctrl + Shift + P / F1', '命令面板'],
    ['Ctrl + F', '在文件中查找'],
    ['Enter / Shift + Enter', '查找下一个 / 上一个'],
    ['Ctrl + G', '跳转到行'],
    ['Ctrl + S', '保存当前文件'],
    ['Ctrl + Tab', '切换编辑器标签'],
    ['Ctrl + W', '关闭当前标签'],
    ['Ctrl + Shift + F', '全局搜索（侧栏）'],
    ['Tab / Shift + Tab', '缩进 / 反缩进'],
    ['Enter', '自动保持缩进'],
    ['Ctrl + /', '显示本帮助'],
    ['Esc', '关闭浮层 / 查找条'],
  ];
  const box = el('div', { class: 'pal-mask' },
    el('div', { class: 'pal shortcut-panel' },
      el('div', { class: 'pal-head' }, icon('terminal', 15), el('span', { class: 'pal-title' }, '键盘快捷键')),
      el('div', { class: 'shortcut-list' },
        rows.map(([k, d]) => el('div', { class: 'shortcut-row' },
          el('span', { class: 'kbd-group' }, k.split(' + ').map((p) => el('kbd', {}, p))),
          el('span', { class: 'shortcut-desc' }, d),
        )),
      ),
    ),
  );
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(); } };
  box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(box);
}

const isMod = (e) => e.ctrlKey || e.metaKey;
document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  // Ctrl+S 保存
  if (isMod(e) && !e.shiftKey && k === 's') {
    e.preventDefault();
    if (S.view === 'files') editor.saveActive();
    return;
  }
  // Ctrl+P 快速打开 / Ctrl+Shift+P 命令面板
  if (isMod(e) && k === 'p') {
    e.preventDefault();
    if (paletteOpen()) return;
    if (e.shiftKey) commandPalette(); else quickOpen();
    return;
  }
  // F1 命令面板
  if (e.key === 'F1') { e.preventDefault(); if (!paletteOpen()) commandPalette(); return; }
  // Ctrl+F 在文件中查找（Ctrl+Shift+F 走下面的全局搜索）
  if (isMod(e) && !e.shiftKey && k === 'f') {
    e.preventDefault();
    if (S.view !== 'files') switchView('files', true);
    editor.openFind();
    return;
  }
  // Ctrl+G 跳转到行
  if (isMod(e) && !e.shiftKey && k === 'g') {
    e.preventDefault();
    if (S.view !== 'files') switchView('files', true);
    editor.goToLine();
    return;
  }
  // Ctrl+W 关闭当前标签
  if (isMod(e) && !e.shiftKey && k === 'w') {
    if (S.view === 'files') { e.preventDefault(); editor.closeActive(); }
    return;
  }
  // Ctrl+/ 快捷键帮助
  if (isMod(e) && (e.key === '/' || e.key === '?')) {
    e.preventDefault();
    showShortcuts();
    return;
  }
  // Ctrl+Tab 切换编辑器标签
  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    if (S.view === 'files') editor.cycleTab(e.shiftKey ? -1 : 1);
    return;
  }
  // Ctrl+Shift+F 聚焦侧栏搜索
  if (isMod(e) && e.shiftKey && k === 'f') {
    e.preventDefault();
    S.sidePanel = 'search';
    if (S.view !== 'files') switchView('files', true); else renderSidebar();
    setTimeout(() => { const input = document.getElementById('side-search-input'); if (input) { input.focus(); input.select(); } }, 0);
    return;
  }
});

// 有未保存修改时，关闭/刷新页面给出提醒
window.addEventListener('beforeunload', (e) => {
  if (editor.hasDirty()) { e.preventDefault(); e.returnValue = ''; }
});

// ---- 视图切换（force：手动点击时即使同视图也重绘） ----
// 侧栏面板由活动栏图标切换（资源/搜索/AI），在所有视图常驻
function switchView(view, force = false) {
  S.view = view;
  // 清理上一个视图的浮层残留（悬停提示 / 右键菜单 / 弹窗 / 路径下拉）
  hideGraphTooltip();
  document.querySelectorAll('.ctx-menu, .commit-popup, .pathdrop').forEach((n) => n.remove());
  content.querySelectorAll('.view').forEach((v) => v.remove());
  if (view === 'files') {
    setActiveEditor(true);
    side.classList.remove('collapsed');
    if (force || S.sidePanel !== S.renderedPanel) renderSidebar();
  } else {
    // 其他视图全宽，不显示侧栏
    setActiveEditor(false);
    side.classList.add('collapsed');
    const holder = el('div', { class: 'view' });
    content.append(holder);
    if (view === 'git') git.render(holder);
    else if (view === 'compare') compare.render(holder);
    else if (view === 'ai') ai.render(holder);
    else if (view === 'deps') deps.render(holder);
  }
  syncActivity();
}

// ---- 侧栏面板（仅编辑器视图：资源管理器 / 搜索） ----
function renderSidebar() {
  side.innerHTML = '';
  S.renderedPanel = S.sidePanel;
  const host = el('div', { class: 'side-host' });
  side.append(host);
  if (S.sidePanel === 'search') searchPanel.render(host, { focus: true });
  else files.render(host);
}

// ---- 打开项目 ----
async function openProject(path) {
  try {
    S.overview = await api.openProject(path);
    await boot();
    toast(`已打开项目：${S.overview.name}`, 'ok');
  } catch (e) { errToast(e); }
}

document.getElementById('btn-open').addEventListener('click', () => {
  const p = document.getElementById('root-input').value.trim();
  if (p) openProject(p);
});
document.getElementById('root-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-open').click();
});

// 路径下拉：最近打开 + 文件夹浏览
initPathDrop(document.getElementById('root-input'), {
  onOpen: (p) => openProject(p),
});

// ---- 桌面端：无边框窗口的自绘标题栏（经服务端转发窗口动作） ----
function setupDesktopChrome() {
  document.body.classList.add('desktop');
  const top = document.getElementById('topbar');
  const winAction = (action) => fetch('/api/desktop/win', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  }).catch(() => {});
  // 拖拽区（品牌区与空白延伸区）
  top.querySelector('.brand')?.setAttribute('data-drag', '');
  top.querySelector('.spacer')?.setAttribute('data-drag', '');
  const mk = (cls, iconName, label, fn) => el('button', {
    class: `win-ctl ${cls}`,
    title: label,
    onclick: (e) => { e.stopPropagation(); fn(); },
  }, icon(iconName, 14));
  top.append(el('span', { class: 'win-ctls' },
    mk('min', 'win-min', '最小化', () => winAction('minimize')),
    mk('max', 'win-max', '最大化 / 还原', () => winAction('maximize')),
    mk('close', 'win-close', '关闭', () => winAction('close')),
  ));
  // 按住拖拽区 → 后端进入窗口拖拽循环
  top.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, input, select, textarea, .path-box, .win-ctl')) return;
    if (e.target.closest('[data-drag]')) winAction('drag');
  });
  // 双击拖拽区最大化/还原
  top.addEventListener('dblclick', (e) => {
    if (e.target.closest('button, input, select, textarea, .path-box, .win-ctl')) return;
    winAction('maximize');
  });
}

// ---- 状态栏 ----
async function refreshStatusbar() {
  const sbBranch = document.getElementById('sb-branch');
  const sbSync = document.getElementById('sb-sync');
  const sbOp = document.getElementById('sb-op');
  if (!S.overview) return;
  if (!S.overview.is_git) {
    sbBranch.textContent = '非 git 仓库';
    document.getElementById('branch-pill').textContent = '—';
    sbOp.textContent = '';
    sbSync.textContent = '';
    return;
  }
  try {
    const st = await api.gitStatus();
    const name = st.detached ? `detached @ ${(st.head_oid || '').slice(0, 7)}` : (st.head_branch || '空仓库');
    sbBranch.innerHTML = '';
    sbBranch.append(icon('branch', 11), `${name}`);
    document.getElementById('branch-pill').textContent = name;
    let syncText = '';
    if (!st.detached) {
      const b = st.head_branch;
      if (window.__refsCache) {
        const bi = window.__refsCache.locals.find((x) => x.name === b);
        if (bi && bi.upstream) syncText = `↑${bi.ahead ?? 0} ↓${bi.behind ?? 0}`;
      }
    }
    sbSync.textContent = syncText;
    sbOp.textContent = st.in_progress
      ? `${st.in_progress} 进行中${st.conflicted.length ? ` · 冲突 ${st.conflicted.length}` : ''}`
      : (st.conflicted.length ? `冲突 ${st.conflicted.length} 个文件` : '');
    sbOp.title = st.in_progress ? '点击前往 Git 工作区处理' : '';
    sbOp.onclick = st.in_progress || st.conflicted.length ? () => switchView('git', true) : null;
  } catch { /* ignore */ }
}

async function refreshRefsCache() {
  try {
    window.__refsCache = await api.gitRefs();
  } catch { window.__refsCache = null; }
}

// ---- 启动 ----
async function boot() {
  document.getElementById('root-input').value = S.overview.root;
  document.getElementById('sb-root').textContent = S.overview.root;
  document.getElementById('sb-root').title = S.overview.root;
  document.getElementById('proj-name').textContent = S.overview.name;
  document.getElementById('sb-hint').textContent = 'Ctrl+P 快速打开 · Ctrl+F 查找 · Ctrl+S 保存';
  document.title = `CodeView — ${S.overview.name}`;
  // 项目切换：清空各视图残留状态
  window.__rootStamp = S.overview.root;
  fileIndex = null;
  editor.clearAll();
  await refreshRefsCache();
  await refreshStatusbar();
  files.refreshGitStatus();
  switchView('files', true);
}

(async function start() {
  try {
    S.overview = await api.overview();
    await boot();
  } catch (e) {
    fatal(`无法连接服务：${e.message}`);
  }
})();

// 启动/切换失败：居中浮层提示（不污染内容区布局），重试或关闭后可继续操作
function fatal(msg) {
  document.querySelectorAll('.fatal-overlay').forEach((n) => n.remove());
  const box = el('div', { class: 'fatal-overlay' },
    el('div', { class: 'fatal-box' },
      el('div', { class: 'fatal-title' }, '⚠ CodeView 启动失败'),
      el('div', { class: 'fatal-msg' }, String(msg)),
      el('div', { class: 'fatal-actions' },
        el('button', { class: 'btn mini', onclick: () => location.reload() }, '重新加载'),
        el('button', { class: 'btn mini ghost', onclick: () => box.remove() }, '关闭'),
      ),
    ),
  );
  document.body.append(box);
}
