// DOM / 图标 / 交互工具

const NS = 'http://www.w3.org/2000/svg';

// lucide 风格 24x24 线性图标（stroke）
const ICONS = {
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  'chev-right': '<path d="m9 18 6-6-6-6"/>',
  'chev-down': '<path d="m6 9 6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  branch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  commit: '<circle cx="12" cy="12" r="4"/><line x1="1.05" x2="7" y1="12" y2="12"/><line x1="17.01" x2="22" y1="12" y2="12"/>',
  merge: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  'arrow-down': '<circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="m8 12 4 4 4-4"/>',
  'arrow-up': '<circle cx="12" cy="12" r="10"/><path d="M12 16V8"/><path d="m8 12 4-4 4 4"/>',
  package: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 8.7 5 8.7-5"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  stash: '<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/>',
  revert: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  play: '<path d="m5 3 14 9-14 9V3z"/>',
  cherry: '<circle cx="12" cy="13" r="8"/><path d="M12 5V3"/><path d="M5 3h14"/>',
  compare: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M11 18H8a2 2 0 0 1-2-2V9"/>',
  swap: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
  'win-min': '<path d="M5 12h14"/>',
  'win-max': '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
  'win-close': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'panel-left': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  dots: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  disc: '<circle cx="12" cy="12" r="9"/>',
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  graph: '<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M7 7.5 10.5 16"/><path d="m17 7.5-3.5 8.5"/><path d="M7.5 6h9"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  folderOpen: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
};

export function icon(name, size = 15, cls = 'ic') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', cls);
  svg.innerHTML = ICONS[name] || ICONS.dot;
  return svg;
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k in node && typeof v === 'boolean') node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

export function toast(msg, kind = '') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = el('div', { id: 'toasts' });
    document.body.append(box);
  }
  const t = el('div', { class: `toast ${kind}` }, String(msg));
  box.append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, kind === 'err' ? 8000 : 3200);
}

export const errToast = (e) => toast(e && e.message ? e.message : String(e), 'err');

// ---- 输入弹窗 ----
export function formModal({ title, icon: iconName, fields = [], okText = '确定', danger = false }) {
  return new Promise((resolve) => {
    const values = {};
    const inputs = {};
    const body = el('div', { class: 'm-body' },
      fields.map((f) => {
        const field = el('div', { class: 'm-field' });
        if (f.label && f.type !== 'checkbox') field.append(el('label', {}, f.label));
        let input;
        if (f.type === 'select') {
          // 自绘下拉（深色、样式统一），替代原生 select
          const comp = dropdown({
            items: (f.options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o })),
            value: f.value || '',
            placeholder: f.placeholder || '请选择…',
          });
          input = comp.el;
          input.classList.add('dd-field');
          inputs[f.key] = comp;
          values[f.key] = () => comp.get();
          field.append(input);
          return field;
        } else if (f.type === 'textarea') {
          input = el('textarea', { rows: f.rows || 3 }, f.value || '');
        } else if (f.type === 'checkbox') {
          input = el('input', { type: 'checkbox' });
          input.checked = !!f.value;
          field.classList.add('m-check');
          field.append(input, el('span', {}, f.label || ''));
          inputs[f.key] = input;
          values[f.key] = () => input.checked;
          return field;
        } else {
          input = el('input', { type: 'text', value: f.value || '', placeholder: f.placeholder || '', spellcheck: 'false' });
        }
        inputs[f.key] = input;
        values[f.key] = () => input.value;
        field.append(input);
        return field;
      }),
    );
    const close = (result) => { mask.remove(); document.removeEventListener('keydown', onKey); resolve(result); };
    const ok = () => {
      const out = {};
      for (const f of fields) out[f.key] = values[f.key]();
      close(out);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); ok(); }
    };
    const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) close(null); } },
      el('div', { class: 'modal' },
        el('h3', {}, iconName ? icon(iconName, 15) : null, title),
        body,
        el('div', { class: 'm-foot' },
          el('button', { class: 'btn', onclick: () => close(null) }, '取消'),
          el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: ok }, okText),
        ),
      ),
    );
    document.addEventListener('keydown', onKey);
    document.body.append(mask);
    const first = mask.querySelector('input,select,textarea');
    if (first) { first.focus(); if (first.select) first.select(); }
  });
}

export function confirmDlg(message, okText = '确定') {
  return formModal({ title: message, icon: 'warn', fields: [], okText, danger: true }).then((v) => !!v);
}

// ---- 内联输入气泡：轻量替代居中弹窗（如“在此创建分支”） ----
export function popoverInput(x, y, { label, value = '', placeholder = '', okText = '确定', onOk }) {
  document.querySelectorAll('.ctx-menu').forEach((m) => m.remove());
  const input = el('input', { type: 'text', value, placeholder, spellcheck: 'false', style: { width: '220px', fontFamily: 'var(--mono)', fontSize: '12px' } });
  const box = el('div', { class: 'ctx-menu', style: { minWidth: '260px', padding: '10px' } },
    el('div', { style: { fontSize: '11.5px', color: 'var(--fg-dim)', marginBottom: '8px' } }, label),
    el('div', { style: { display: 'flex', gap: '6px' } },
      input,
      el('button', {
        class: 'btn mini primary',
        onclick: () => { const v = input.value.trim(); if (v) { cleanup(); onOk && onOk(v); } },
      }, okText),
    ),
  );
  const cleanup = () => { box.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', onKey); };
  const outside = (e) => { if (!box.contains(e.target)) cleanup(); };
  const onKey = (e) => {
    if (e.key === 'Escape') cleanup();
    if (e.key === 'Enter') {
      const v = input.value.trim();
      if (v) { cleanup(); onOk && onOk(v); }
    }
  };
  document.addEventListener('mousedown', outside, true);
  document.addEventListener('keydown', onKey);
  document.body.append(box);
  const rect = box.getBoundingClientRect();
  box.style.left = `${Math.min(x, innerWidth - rect.width - 8)}px`;
  box.style.top = `${Math.min(y, innerHeight - rect.height - 8)}px`;
  setTimeout(() => { input.focus(); input.select(); }, 0);
}

// ---- 右键菜单 ----
export function contextMenu(x, y, items) {
  document.querySelectorAll('.ctx-menu').forEach((m) => m.remove());
  const menu = el('div', { class: 'ctx-menu' });
  for (const it of items) {
    if (it === '-') { menu.append(el('div', { class: 'ctx-sep' })); continue; }
    menu.append(el('div', {
      class: `ctx-item ${it.danger ? 'danger' : ''}`,
      onclick: () => { menu.remove(); it.onClick && it.onClick(); },
    }, it.icon ? icon(it.icon, 13) : null, it.label));
  }
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  if (x + rect.width > innerWidth) x = innerWidth - rect.width - 6;
  if (y + rect.height > innerHeight) y = innerHeight - rect.height - 6;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const off = () => { menu.remove(); document.removeEventListener('mousedown', off, true); };
  setTimeout(() => document.addEventListener('mousedown', off, true), 0);
}

// ---- 格式化 ----
export function fmtTime(unix) {
  if (!unix) return '';
  const d = new Date(unix * 1000);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fmtSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const shortOid = (oid) => (oid || '').slice(0, 7);

// ---- 颜色 ----
export const extColor = (ext) => ({
  rs: '#f74c00', js: '#f1e05a', mjs: '#f1e05a', cjs: '#f1e05a', jsx: '#f1e05a',
  ts: '#3178c6', tsx: '#3178c6', mts: '#3178c6', json: '#e0b13e', toml: '#9c8f7f',
  py: '#3572A5', c: '#7f8fa6', h: '#7f8fa6', cpp: '#f34b7d', cc: '#f34b7d', hpp: '#f34b7d',
  go: '#00ADD8', java: '#b07219', md: '#8fa6c8', css: '#563d7c', html: '#e34c26',
  yml: '#cb5b5b', yaml: '#cb5b5b', sh: '#89e051', bat: '#a9a9a9', ps1: '#4ec9d4',
  lock: '#5f6876', txt: '#5f6876',
}[ext] || '#6b7686');

export function avatarColor(name) {
  const palette = ['#5b8cff', '#3fb950', '#f0883e', '#bc8cff', '#f778ba', '#39c5cf', '#e3b341', '#ff7b72'];
  let h = 0;
  for (const ch of name || '?') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

export function avatar(name, size = 20) {
  const d = el('div', { class: 'avatar', title: name, style: { width: `${size}px`, height: `${size}px`, background: avatarColor(name) } },
    (name || '?').trim().charAt(0).toUpperCase());
  return d;
}

// ---- 自绘下拉选择（替代原生 select，深色可定制） ----
// items: [{value, label}] 或 [字符串]；返回 { el, get, set, setItems }
export function dropdown({ items = [], value = '', placeholder = '请选择…', width = '', onChange } = {}) {
  let list = null;
  let valSpan = null;
  const wrap = el('div', { class: 'dd', style: width ? { width } : {} });
  const btn = el('button', { type: 'button', class: 'dd-btn' },
    el('span', { class: 'dd-val' }, value || placeholder),
    icon('chev-down', 11),
  );
  const close = () => { if (list) { list.remove(); list = null; } document.removeEventListener('mousedown', out, true); };
  const out = (e) => { if (!wrap.contains(e.target)) close(); };
  const open = () => {
    if (list) { close(); return; }
    list = el('div', { class: 'dd-list' });
    if (!items.length) list.append(el('div', { class: 'ref-empty' }, '（无）'));
    for (const it of items) {
      const v = it.value ?? it;
      const label = it.label ?? v;
      list.append(el('div', {
        class: `dd-item${v === value ? ' sel' : ''}`,
        onclick: () => {
          value = v;
          valSpan.textContent = value || placeholder;
          close();
          onChange && onChange(value);
        },
      }, el('span', {}, label)));
    }
    wrap.append(list);
    document.addEventListener('mousedown', out, true);
  };
  btn.addEventListener('click', open);
  wrap.append(btn);
  return {
    el: wrap,
    get: () => value,
    set: (v) => { value = v; valSpan.textContent = v || placeholder; },
    setItems: (newItems) => { items = newItems; },
  };
}

// ---- 带行号的 diff 渲染 ----
// 解析 unified patch：@@ -a,b +c,d @@ 头跟踪新旧行号；点击行可回调（跳转到工作区文件）。
export function renderDiffRows(patch, opts = {}) {
  const MAX_ROWS = 6000;
  const grid = el('div', { class: 'diffgrid' });
  if (!patch || !patch.trim()) {
    grid.append(el('div', { class: 'diff-note' }, '（二进制文件或无文本差异）'));
    return grid;
  }
  let oldNo = 0, newNo = 0, count = 0, truncated = false;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const row = (no1, no2, cls, text, clickableLine) => {
    const code = el('span', { class: 'code' });
    code.innerHTML = esc(text) || '&nbsp;';
    const r = el('div', { class: `dlrow ${cls}${clickableLine != null ? ' clickable' : ''}` },
      el('span', { class: 'no' }, no1 != null ? String(no1) : ''),
      el('span', { class: 'no' }, no2 != null ? String(no2) : ''),
      code,
    );
    if (clickableLine != null && opts.onOpenLine) {
      r.addEventListener('click', () => opts.onOpenLine(clickableLine));
    }
    return r;
  };
  for (const raw of patch.split('\n')) {
    if (count++ > MAX_ROWS) { truncated = true; break; }
    if (raw.startsWith('@@')) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) { oldNo = parseInt(m[1], 10); newNo = parseInt(m[2], 10); }
      grid.append(el('div', { class: 'dlrow hunk' }, raw));
      continue;
    }
    if (/^(diff |index |--- |\+\+\+ |new file mode|old file mode|deleted file mode|similarity index|rename from|rename to|mode )/.test(raw)
      || raw.startsWith('\\ No newline')) {
      grid.append(el('div', { class: 'dlrow meta' }, raw));
      continue;
    }
    if (raw.startsWith('+')) {
      grid.append(row(null, newNo, 'add', raw.slice(1), newNo));
      newNo++;
    } else if (raw.startsWith('-')) {
      grid.append(row(oldNo, null, 'del', raw.slice(1), null));
      oldNo++;
    } else {
      const text = raw.startsWith(' ') ? raw.slice(1) : raw;
      grid.append(row(oldNo, newNo, 'ctx', text, newNo));
      oldNo++; newNo++;
    }
  }
  if (truncated) grid.append(el('div', { class: 'diff-note' }, '…内容过长，已截断显示'));
  if (opts.onOpenLine) {
    grid.append(el('div', { class: 'diff-note' }, '提示：点击任意行可跳转到工作区文件的对应行'));
  }
  return grid;
}
