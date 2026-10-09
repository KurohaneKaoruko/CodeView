// CodeView 前端入口
import { api } from './api.js?v=3';
import { el, icon, toast, errToast } from './ui.js?v=3';import { initPathDrop } from './pathdrop.js?v=3';
import { hideGraphTooltip } from './gitgraph.js?v=3';
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
  _workRefresh: null,
};

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (S.view === 'files') editor.saveActive();
  }
  // Ctrl+Tab 切换编辑器标签
  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    if (S.view === 'files') editor.cycleTab(1);
  }
  // Ctrl+Shift+F 聚焦侧栏搜索
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
    e.preventDefault();
    const input = document.getElementById('side-search-input');
    if (input) { input.focus(); input.select(); }
  }
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
  const mk = (cls, label, fn) => el('button', {
    class: `win-ctl ${cls}`,
    title: label,
    onclick: (e) => { e.stopPropagation(); fn(); },
  }, label);
  top.append(el('span', { class: 'win-ctls' },
    mk('min', '最小化', () => winAction('minimize')),
    mk('max', '最大化 / 还原', () => winAction('maximize')),
    mk('close', '关闭', () => winAction('close')),
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
setupDesktopChrome();

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
  document.getElementById('proj-name').textContent = ` — ${S.overview.name}`;
  document.getElementById('sb-hint').textContent = 'Ctrl+S 保存 · Ctrl+Tab 切换标签';
  document.title = `CodeView — ${S.overview.name}`;
  // 项目切换：清空各视图残留状态
  window.__rootStamp = S.overview.root;
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
