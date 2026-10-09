// 路径输入下拉面板：输入路径 / 最近打开 / 文件夹浏览三合一
import { api } from './api.js?v=3';
import { el, icon, errToast } from './ui.js?v=3';

// 是否运行在 Tauri 桌面端（暴露了全局 API）——仅用于自绘标题栏
export const isDesktop = () => !!(window.__TAURI__ && window.__TAURI__.core);

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
      iconName: 'folder', label: '选择目录…（系统文件管理器）', keep: true,
      onClick: async () => {
        try {
          const r = await api.pickDir();
          if (r && r.path) { close(); onOpen(r.path); }
        } catch (e) { errToast(e); }
      },
    }));
    panel.append(row({
      iconName: 'folderOpen', label: '浏览目录（内置树）…', keep: true,
      onClick: async () => { mode = 'browse'; browseDir = ''; await renderBrowse(); },
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
