// 侧栏 · 搜索：全局文本搜索（子串 / 正则，可选大小写敏感）
import { api } from '../api.js';
import { el, icon, toast, errToast } from '../ui.js';

export function render(host, opts = {}) {
  host.innerHTML = '';
  const input = el('input', { type: 'text', id: 'side-search-input', placeholder: '搜索项目内容…', spellcheck: 'false', style: { width: '100%' } });
  const cs = el('input', { type: 'checkbox' });
  const rx = el('input', { type: 'checkbox' });
  const results = el('div', { class: 'search-results' });

  const run = async () => {
    const q = input.value.trim();
    if (!q) return;
    results.innerHTML = '';
    results.append(el('div', { class: 'empty-hint' }, el('span', { class: 'spin' }, '⠋'), ' 搜索中…'));
    try {
      const r = await api.search(q, cs.checked, rx.checked);
      results.innerHTML = '';
      if (!r.files.length) {
        results.append(el('div', { class: 'empty-hint' }, '未找到匹配'));
        return;
      }
      results.append(el('div', { class: 'search-summary' },
        `共 ${r.total} 处匹配 · ${r.files.length} 个文件${r.truncated ? ' · 已截断' : ''}`));
      for (const f of r.files) {
        const g = el('div', { class: 'search-group' },
          el('div', { class: 'search-file', onclick: () => window.CodeView.openFile(f.file) },
            icon('file', 12),
            el('span', { class: 'p', title: f.file }, f.file),
            el('span', { class: 'count' }, f.hits.length),
          ));
        for (const h of f.hits) {
          const tx = el('span', { class: 'tx' });
          tx.innerHTML = highlightHit(h);
          g.append(el('div', {
            class: 'search-hit',
            title: `${f.file}:${h.line}`,
            onclick: () => window.CodeView.openFileAt(f.file, h.line),
          }, el('span', { class: 'ln' }, h.line), tx));
        }
        results.append(g);
      }
    } catch (e) {
      results.innerHTML = '';
      results.append(el('div', { class: 'empty-hint' }, e.message));
      errToast(e);
    }
  };

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });

  host.append(
    el('div', { class: 'side-head' }, icon('search', 13), '搜索'),
    el('div', { style: { padding: '10px' } },
      el('div', { style: { display: 'flex', gap: '6px' } },
        input,
        el('button', { class: 'btn mini primary', onclick: run }, icon('search', 12)),
      ),
      el('div', { style: { display: 'flex', gap: '12px', marginTop: '6px' } },
        el('label', { class: 'm-check' }, cs, el('span', {}, 'Aa 大小写敏感')),
        el('label', { class: 'm-check' }, rx, el('span', {}, '.* 正则')),
      ),
    ),
    results,
  );

  if (opts.focus) setTimeout(() => input.focus(), 0);
}

function highlightHit(h) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const chars = [...h.text];
  const start = Math.max(0, h.col - 1);
  const pre = chars.slice(0, start).join('');
  const mid = chars.slice(start, start + h.len).join('');
  const post = chars.slice(start + h.len).join('');
  return `${esc(pre)}<mark>${esc(mid)}</mark>${esc(post)}`;
}