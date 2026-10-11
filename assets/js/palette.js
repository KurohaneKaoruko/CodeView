// 通用命令面板 / 快速打开浮层
// 提供模糊匹配、命中高亮、键盘导航（↑↓ / Enter / Esc / Tab）
import { el, icon } from './ui.js?v=3';

/** 模糊匹配：返回 { score, indices } 或 null（未全部命中） */
export function fuzzyMatch(query, text) {
  const q = (query || '').toLowerCase();
  const t = (text || '').toLowerCase();
  if (!q) return { score: 0, indices: [] };
  const indices = [];
  let qi = 0, score = 0, last = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    indices.push(ti);
    score += 1;
    if (ti === last + 1) score += 6;                 // 连续命中
    if (ti === 0) score += 9;                        // 命中开头
    const prev = t[ti - 1];
    if (prev && '/\\_-. '.includes(prev)) score += 5; // 词边界
    last = ti;
    qi++;
  }
  if (qi < q.length) return null;                    // 有字符未命中
  score -= t.length * 0.02;                          // 更短者优先
  return { score, indices };
}

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 用 <b> 包裹命中字符 */
function markHtml(text, indices) {
  const s = String(text == null ? '' : text);
  if (!indices || !indices.length) return esc(s);
  const set = new Set(indices);
  let out = '';
  for (let i = 0; i < s.length; i++) out += set.has(i) ? `<b>${esc(s[i])}</b>` : esc(s[i]);
  return out;
}

// 分隔符：字符串 '-' 或 { separator: true }
const isSep = (x) => x === '-' || (!!x && typeof x === 'object' && x.separator === true);
const isItem = (x) => !!x && typeof x === 'object' && typeof x.label === 'string';

/**
 * 打开一个通用浮层。
 * items: [{ label, sub?, icon?, action, keywords? }]（其中可插入 '-' 作为分组分隔）
 * onSelect: (item) => void（可选，默认执行 item.action）
 */
export function showPalette({ placeholder = '', items = [], onSelect, emptyText = '无匹配结果', icon: headIcon = 'search' } = {}) {
  const MAX_RENDER = 200;
  let filtered = [];   // 行：{ sep:true } 或 { it, labelIdx, subIdx }
  let sel = 0;

  const input = el('input', { type: 'text', class: 'pal-input', placeholder, spellcheck: 'false', autocomplete: 'off' });
  const listBox = el('div', { class: 'pal-list' });
  const counter = el('span', { class: 'pal-count' });
  const overlay = el('div', { class: 'pal-mask' },
    el('div', { class: 'pal' },
      el('div', { class: 'pal-head' }, icon(headIcon, 15), input, counter),
      listBox,
    ),
  );

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  };

  const pick = (i) => {
    const row = filtered[i];
    if (!row || row.sep) return;
    close();
    if (onSelect) onSelect(row.it);
    else if (row.it.action) row.it.action();
  };

  const applyFilter = () => {
    const q = input.value.trim();
    if (!q) {
      filtered = items.slice(0, MAX_RENDER).map((it) => (isSep(it) ? { sep: true } : { it, labelIdx: [], subIdx: [] }));
    } else {
      const scored = [];
      for (const it of items) {
        if (!isItem(it)) continue;   // 跳过分隔符 / 非对象项
        const label = it.label;
        const sub = typeof it.sub === 'string' ? it.sub : '';
        // 搜索串按完整路径拼接（目录 + 文件名），便于用路径片段检索
        const hay = sub ? `${sub}/${label}` : label;
        const labelStart = sub ? sub.length + 1 : 0;
        let m = fuzzyMatch(q, hay);
        const labelIdx = [], subIdx = [];
        if (m) {
          for (const i of m.indices) {
            if (i < sub.length) subIdx.push(i);
            else if (i >= labelStart) labelIdx.push(i - labelStart);
          }
        } else if (it.keywords) {
          const km = fuzzyMatch(q, it.keywords);
          if (km) m = { score: km.score * 0.6 };
        }
        if (!m) continue;
        scored.push({ it, labelIdx, subIdx, score: m.score });
      }
      scored.sort((a, b) => b.score - a.score || a.it.label.length - b.it.label.length);
      filtered = scored.slice(0, MAX_RENDER);
    }
    // 去掉首尾多余分隔符
    while (filtered.length && filtered[0].sep) filtered.shift();
    while (filtered.length && filtered[filtered.length - 1].sep) filtered.pop();
    sel = filtered.findIndex((r) => !r.sep);
    if (sel < 0) sel = 0;
    renderList();
  };

  const renderList = () => {
    listBox.innerHTML = '';
    const n = filtered.filter((r) => !r.sep).length;
    counter.textContent = n ? `${n}${items.length > MAX_RENDER ? '+' : ''}` : '';
    if (!n) {
      listBox.append(el('div', { class: 'pal-empty' }, emptyText));
      return;
    }
    filtered.forEach((row, i) => {
      if (row.sep) { listBox.append(el('div', { class: 'pal-sep' })); return; }
      const node = el('div', {
        class: `pal-item${i === sel ? ' sel' : ''}`,
        dataset: { idx: String(i) },
        onmousemove: () => { if (sel !== i) { sel = i; paintSel(); } },
        onclick: () => pick(i),
      },
      row.it.icon ? icon(row.it.icon, 13) : null,
      el('span', { class: 'pal-label' }),
      row.it.sub ? el('span', { class: 'pal-sub' }) : null,
      );
      node.querySelector('.pal-label').innerHTML = markHtml(row.it.label, row.labelIdx);
      const subEl = node.querySelector('.pal-sub');
      if (subEl) subEl.innerHTML = markHtml(row.it.sub, row.subIdx);
      listBox.append(node);
    });
  };

  const paintSel = () => {
    const nodes = listBox.querySelectorAll('.pal-item');
    let cur = null;
    nodes.forEach((node) => {
      const on = Number(node.dataset.idx) === sel;
      node.classList.toggle('sel', on);
      if (on) cur = node;
    });
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  };

  const move = (d) => {
    if (!filtered.length) return;
    let i = sel;
    for (let step = 0; step < filtered.length; step++) {
      i = (i + d + filtered.length) % filtered.length;
      if (!filtered[i].sep) { sel = i; paintSel(); return; }
    }
  };

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Tab') { e.preventDefault(); move(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pick(sel); }
  };

  input.addEventListener('input', applyFilter);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey, true);

  document.body.append(overlay);
  applyFilter();
  setTimeout(() => input.focus(), 0);
  return close;
}

/** 是否已有浮层打开（避免重复触发） */
export const paletteOpen = () => !!document.querySelector('.pal-mask');
