// CodeView 前端入口
import { api } from './api.js';
import { el, icon, toast, errToast } from './ui.js';
import { initPathDrop } from './pathdrop.js';
import * as files from './views/files.js';
import * as editor from './views/editor.js';
import * as gitlog from './views/gitlog.js';
import * as gitwork from './views/gitwork.js';
import * as compare from './views/compare.js';
import * as deps from './views/deps.js';

const S = { overview: null, view: 'files' };

const side = document.getElementById('side');
const content = document.getElementById('content');

// 活动栏图标
const ACT_ICONS = { files: 'code', gitlog: 'history', gitwork: 'branch', compare: 'compare', deps: 'package' };
document.querySelectorAll('.act-btn').forEach((b) => {
  b.append(icon(ACT_ICONS[b.dataset.view], 20));
  b.addEventListener('click', () => switchView(b.dataset.view, true));
});

// 编辑器容器常驻（切换视图时隐藏/显示以保留状态）
editor.init(content);
const editorWrap = content.querySelector('.editor-wrap');
editor.onDirtyChange((n) => {
  const el2 = document.getElementById('sb-dirty');
  el2.textContent = n ? `● ${n} 个未保存` : '';
  const tab = document.querySelector('.act-btn[data-view=files]');
  let badge = tab.querySelector('.act-badge');
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
    if (S.view === 'gitwork' && window.CodeView._workRefresh) window.CodeView._workRefresh();
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
});

// ---- 视图切换（force：手动点击时即使同视图也重绘） ----
function switchView(view, force = false) {
  const same = S.view === view;
  S.view = view;
  document.querySelectorAll('.act-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  content.querySelectorAll('.view').forEach((v) => v.remove());
  if (view === 'files') {
    setActiveEditor(true);
    if (force || !same || !side.children.length) {
      files.render(side);
      side.classList.add('visible');
    } else {
      side.classList.add('visible');
    }
    return;
  }
  setActiveEditor(false);
  side.classList.remove('visible');
  side.innerHTML = '';
  const holder = el('div', { class: 'view' });
  content.append(holder);
  if (view === 'gitlog') gitlog.render(holder);
  else if (view === 'gitwork') gitwork.render(holder);
  else if (view === 'compare') compare.render(holder);
  else if (view === 'deps') deps.render(holder);
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
    sbOp.onclick = st.in_progress || st.conflicted.length ? () => switchView('gitwork', true) : null;
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
    content.append(el('div', { class: 'empty-hint' }, `无法连接服务：${e.message}`));
  }
})();
