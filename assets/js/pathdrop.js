// 路径输入下拉面板：输入路径 / 最近打开 / 文件夹浏览三合一
import { api } from './api.js?v=3';
import { el, icon, toast, errToast } from './ui.js?v=3';

// 是否运行在 Tauri 桌面端（暴露了全局 API）
export const isDesktop = () => !!(window.__TAURI__ && window.__TAURI__.core);
const currentWindow = () => (window.__TAURI__ && window.__TAURI__.window ? window.__TAURI__.window.getCurrent() : null);

/** 原生目录选择对话框（仅桌面端可用）；返回路径或 null */
async function nativePickDir() {
  if (!isDesktop()) return null;
  try {
    const res = await window.__TAURI__.core.invoke('plugin:dialog|open', {
      options: { directory: true, multiple: false, title: '选择项目目录' },
    });
    if (!res) return null;
    if (typeof res === 'string') return res;
    if (Array.isArray(res)) return res[0] && (res[0].path || res[0]);
    return res.path || null;
  } catch (e) {
    errToast(e);
    return null;
  }
}

export function initPathDrop(input, { onOpen }) {
  let panel = null;
  let mode = 'menu'; // menu | browse
  let browseDir = '';

  const close = () => {
    if (panel) { panel.remove(); panel = null; }
    mode = 'menu';
    document.removeEventListener('mousedown', outside, true);
    window.removeEventListener('resize', close);
  };
  const outside = (e) => {
    if (panel && !panel.contains(e.target) && e.target !== input) close();
  };

  const position = () => {
    if (!panel) return;
    const r = input.getBoundingClientRect();
    panel.style.left = `${r.left}px`;
    panel.style.top = `${r.bottom + 5}px`;
    panel.style.width = `${Math.max(r.width, 460)}px`;
  };

  const row = ({ iconName, label, kbd, dim, action, keep, onClick }) => {
    const r = el('div', { class: `pd-row${action ? ' action' : ''}` },
      el('span', { class: 'pd-icon' }, icon(iconName, 14)),
      el('span', { class: 'pd-label' }, dim ? [label, el('span', { class: 'dim' }, `  ${dim}`)] : label),
      kbd ? el('kbd', { class: 'pd-kbd' }, kbd) : null,
    );
    r.addEventListener('click', () => {
      if (!keep) close();
      onClick && onClick();
    });
    return r;
  };

  async function renderMenu() {
    panel.innerHTML = '';
    const typed = input.value.trim();
    if (typed) {
      panel.append(row({
        iconName: 'folderOpen', action: true,
        label: `打开 "${typed}"`, kbd: 'Enter',
        onClick: () => onOpen(typed),
      }));
    }
    panel.append(row({
      iconName: 'folder', label: '选择目录…（打开文件夹浏览器）', keep: true,
      onClick: async () => { mode = 'browse'; browseDir = ''; await renderBrowse(); },
    }));
    if (isDesktop()) {
      panel.append(row({
        iconName: 'disc', label: '用系统对话框选择目录…', keep: true,
        onClick: async () => {
          const p = await nativePickDir();
          if (p) { close(); onOpen(p); }
        },
      }));
    }
    panel.append(row({
      iconName: 'disc', label: '在系统文件管理器中显示当前项目', keep: true,
      onClick: async () => {
        const cur = document.getElementById('root-input').value;
        if (!cur) return;
        try {
          await fetch('/api/open_native?path=' + encodeURIComponent(cur));
        } catch (e) { errToast(e); }
      },
    }));
    // 最近打开
    panel.append(el('div', { class: 'pd-section' }, '最近打开'));
    try {
      const rec = await api.recent();
      if (!rec.items.length) {
        panel.append(el('div', { class: 'pd-empty' }, '暂无记录'));
      } else {
        for (const p of rec.items) {
          const name = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
          panel.append(row({
            iconName: 'history', dim: p,
            label: name,
            onClick: () => onOpen(p),
          }));
        }
      }
    } catch { panel.append(el('div', { class: 'pd-empty' }, '无法读取最近记录')); }
    panel.append(el('div', { class: 'pd-empty', style: { borderTop: '1px solid var(--border)', paddingTop: '7px' } },
      '输入完整路径后回车直接打开 · Esc 关闭'));
  }

  async function renderBrowse() {
    panel.innerHTML = '';
    panel.append(el('div', { class: 'pd-browse-head' },
      el('button', {
        class: 'btn mini ghost', title: '返回',
        onclick: async () => { mode = 'menu'; await renderMenu(); },
      }, icon('chev-right', 12)),
      el('span', { class: 'cur' }, browseDir || '此电脑（选择驱动器 / 根目录）'),
      el('button', {
        class: 'btn mini primary',
        onclick: () => { if (browseDir) { close(); onOpen(browseDir); } },
      }, '打开此目录'),
    ));
    if (!browseDir) {
      panel.append(el('div', { class: 'pd-loading' }, '点击下方驱动器进入；驱动器内可继续逐层进入，或直接点上方「打开此目录」。'));
    }
    panel.append(el('div', { class: 'pd-loading' }, el('span', { class: 'spin' }, '⠋'), ' 加载中…'));
    try {
      const res = await api.browse(browseDir);
      panel.innerHTML = '';
      panel.append(el('div', { class: 'pd-browse-head' },
        el('button', {
          class: 'btn mini ghost', title: '返回上一级',
          onclick: async () => { browseDir = res.parent || ''; await renderBrowse(); },
        }, icon('chev-right', 12)),
        el('span', { class: 'cur', title: res.current }, res.current || '此电脑（选择驱动器 / 根目录）'),
        res.current ? el('button', {
          class: 'btn mini primary',
          onclick: () => { close(); onOpen(res.current); },
        }, '打开此目录') : null,
      ));
      if (res.parent != null && res.current) {
        panel.append(row({
          iconName: 'chev-right', label: '..（上一级）', keep: true,
          onClick: async () => { browseDir = res.parent || ''; await renderBrowse(); },
        }));
      }
      if (!res.entries.length) {
        panel.append(el('div', { class: 'pd-empty' }, '（没有子目录）'));
      }
      for (const e of res.entries) {
        panel.append(row({
          iconName: e.kind === 'drive' ? 'disc' : 'folder',
          label: e.name,
          keep: true,
          onClick: async () => { browseDir = e.path; await renderBrowse(); },
        }));
      }
    } catch (e) {
      panel.innerHTML = '';
      panel.append(el('div', { class: 'pd-empty' }, e.message || String(e)));
    }
  }

  async function openPanel() {
    close();
    panel = el('div', { class: 'pathdrop' });
    document.body.append(panel);
    position();
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('resize', close);
    if (mode === 'browse') await renderBrowse();
    else await renderMenu();
  }

  input.addEventListener('focus', openPanel);
  input.addEventListener('click', openPanel);
  input.addEventListener('input', () => { if (panel && mode === 'menu') renderMenu(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); input.blur(); }
  });
}
