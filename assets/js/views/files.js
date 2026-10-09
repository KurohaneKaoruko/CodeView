// 资源管理器：文件树 + git 状态着色 + 右键操作
import { api } from '../api.js';
import { el, icon, contextMenu, formModal, confirmDlg, toast, errToast, extColor } from '../ui.js';

const state = {
  expanded: new Set(),
  statusMap: new Map(),
  selected: null,
};

const EXT_LANG = {
  rs: 'Rust', js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript',
  ts: 'TypeScript', tsx: 'TypeScript', py: 'Python', go: 'Go', java: 'Java',
  c: 'C', h: 'C', cpp: 'C++', cc: 'C++', hpp: 'C++', md: 'Markdown', json: 'JSON',
  toml: 'TOML', yml: 'YAML', yaml: 'YAML', html: 'HTML', css: 'CSS', sh: 'Shell',
};

export function refreshGitStatus() {
  return api.gitStatus().then((st) => {
    state.statusMap.clear();
    for (const f of [...st.staged, ...st.unstaged, ...st.untracked]) {
      if (!state.statusMap.has(f.path)) state.statusMap.set(f.path, f.code);
    }
    for (const p of st.conflicted) state.statusMap.set(p, 'U');
    rerender();
  }).catch(() => {});
}

function statusClass(path) {
  const c = state.statusMap.get(path);
  return c ? `st-${c}` : '';
}

export function render(side) {
  side.classList.add('visible');
  side.innerHTML = '';
  side.append(el('div', { class: 'side-head' }, '资源管理器',
    el('span', { class: 'btns' },
      el('button', { class: 'icon-btn', title: '新建文件', onclick: () => newAt('') }, icon('file', 14)),
      el('button', { class: 'icon-btn', title: '新建文件夹', onclick: () => newAt('', 'dir') }, icon('folder', 14)),
      el('button', { class: 'icon-btn', title: '刷新', onclick: () => { refreshGitStatus(); window.CodeView.refreshStatusbar(); } }, icon('refresh', 14)),
    ),
  ));
  const root = el('div', {});
  side.append(root);
  loadChildren('', root, 0);
}

function rerender() {
  const side = document.getElementById('side');
  if (side.classList.contains('visible')) render(side);
}

async function loadChildren(path, container, depth) {
  try {
    const entries = await api.tree(path);
    container.innerHTML = '';
    for (const e of entries) container.append(nodeFor(e, depth));
  } catch (err) {
    container.append(el('div', { class: 'empty-hint' }, err.message));
  }
}

function fileIconNode(e) {
  if (e.kind === 'dir') return icon('folder', 14, 'ic');
  const color = extColor(e.ext || '');
  const ic = icon('file', 14, 'ic');
  ic.style.color = color;
  return ic;
}

function nodeFor(e, depth) {
  const wrap = el('div', { class: `tree-node ${statusClass(e.path)}` });
  const row = el('div', {
    class: `tree-row${state.selected === e.path ? ' selected' : ''}`,
    style: { paddingLeft: `${6 + depth * 16}px` },
    title: e.path,
  });
  const caretBox = el('span', { class: 'caret' });
  if (e.kind === 'dir') caretBox.append(icon('chev-right', 11));
  row.append(caretBox, el('span', { class: 'ficon' }, fileIconNode(e)), el('span', { class: 'name' }, e.name));
  wrap.append(row);

  const kidsBox = el('div', {});
  wrap.append(kidsBox);

  const setCaret = (open) => caretBox.classList.toggle('open', open);
  setCaret(state.expanded.has(e.path));

  const toggle = async () => {
    if (e.kind !== 'dir') return;
    if (state.expanded.has(e.path)) {
      state.expanded.delete(e.path);
      kidsBox.innerHTML = '';
      setCaret(false);
    } else {
      state.expanded.add(e.path);
      setCaret(true);
      await loadChildren(e.path, kidsBox, depth + 1);
    }
  };

  row.addEventListener('click', () => {
    state.selected = e.path;
    document.querySelectorAll('.tree-row.selected').forEach((n) => n.classList.remove('selected'));
    row.classList.add('selected');
    if (e.kind === 'dir') toggle();
    else window.CodeView.openFile(e.path);
  });

  row.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    const items = [];
    if (e.kind === 'dir') {
      items.push(
        { label: '新建文件', icon: 'file', onClick: () => newAt(e.path) },
        { label: '新建文件夹', icon: 'folder', onClick: () => newAt(e.path, 'dir') },
        '-',
        { label: '在资源管理器中展开/折叠', icon: 'chev-right', onClick: toggle },
        '-',
        { label: '重命名', icon: 'edit', onClick: () => renameAt(e) },
        { label: '删除', icon: 'trash', danger: true, onClick: () => delAt(e) },
      );
    } else {
      items.push(
        { label: '打开', icon: 'file', onClick: () => window.CodeView.openFile(e.path) },
        { label: '重命名', icon: 'edit', onClick: () => renameAt(e) },
        '-',
        { label: '删除', icon: 'trash', danger: true, onClick: () => delAt(e) },
      );
    }
    contextMenu(ev.clientX, ev.clientY, items);
  });

  return wrap;
}

async function newAt(base, kind = 'file') {
  const r = await formModal({
    title: kind === 'dir' ? '新建文件夹' : '新建文件',
    icon: kind === 'dir' ? 'folder' : 'file',
    fields: [{ key: 'name', label: `名称（位于 ${base || '项目根'} 下）`, placeholder: kind === 'dir' ? 'new-folder' : 'new-file.rs' }],
    okText: '创建',
  });
  if (!r || !r.name) return;
  const p = base ? `${base}/${r.name}` : r.name;
  try {
    await api.createFile(p, kind);
    if (kind === 'file') window.CodeView.openFile(p);
    toast(`已创建 ${p}`, 'ok');
    window.CodeView.gitChanged();
    rerender();
  } catch (e) { errToast(e); }
}

async function renameAt(e) {
  const r = await formModal({
    title: '重命名',
    icon: 'edit',
    fields: [{ key: 'to', label: '新路径', value: e.path }],
    okText: '重命名',
  });
  if (!r || !r.to || r.to === e.path) return;
  try {
    await api.renameFile(e.path, r.to);
    window.CodeView.fileRenamed(e.path, r.to);
    toast(`已重命名 → ${r.to}`, 'ok');
    window.CodeView.gitChanged();
    rerender();
  } catch (err) { errToast(err); }
}

async function delAt(e) {
  const ok = await confirmDlg(`确认删除 ${e.path} ？${e.kind === 'dir' ? '（含全部内容）' : ''}`, '删除');
  if (!ok) return;
  try {
    await api.deleteFile(e.path);
    toast(`已删除 ${e.path}`, 'ok');
    window.CodeView.fileDeleted(e.path);
    window.CodeView.gitChanged();
    rerender();
  } catch (err) { errToast(err); }
}
