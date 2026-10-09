// 依赖图谱：文件级依赖（力导向图）+ 符号级引用/调用
import { api } from '../api.js';
import { el, icon, toast, errToast, extColor } from '../ui.js';
import { createForceGraph } from '../graph.js';

const state = {
  graph: null,
  mode: 'files',
  selectedFile: null,
};

export function render(content) {
  content.innerHTML = '';
  const wrap = el('div', { class: 'deps-wrap' });
  content.append(wrap);

  const search = el('input', { type: 'text', placeholder: '搜索文件名…', style: { width: '190px' } });
  const segFiles = el('button', { class: 'seg-btn on', onclick: () => { state.mode = 'files'; if (state.graph) drawGraph(); } }, icon('code', 12), '文件依赖');
  const segSyms = el('button', { class: 'seg-btn', onclick: () => { state.mode = 'symbols'; symbolEntry(); } }, icon('graph', 12), '符号 / 调用');

  const toolbar = el('div', { class: 'view-toolbar' },
    el('span', { class: 'vtitle' }, icon('package', 15), '依赖图谱'),
    el('span', { class: 'sep' }),
    el('span', { class: 'seg-group' }, segFiles, segSyms),
    search,
    el('button', { class: 'btn primary mini', onclick: loadGraph }, icon('refresh', 12), '构建 / 刷新'),
    el('span', { style: { flex: 1 } }),
    el('span', { id: 'deps-cycles', style: { display: 'inline-flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } }),
    el('span', { id: 'deps-meta', class: 'muted', style: { fontSize: '11.5px' } }),
  );
  wrap.append(toolbar);

  const body = el('div', { class: 'deps-body' });
  wrap.append(body);
  const canvas = el('div', { class: 'deps-canvas' });
  const info = el('div', { class: 'deps-info' }, el('div', { class: 'inner' },
    el('div', { class: 'empty-hint' }, el('span', { class: 'big' }, '◈'), '正在构建依赖图…')));
  body.append(canvas, info);

  const fg = createForceGraph(canvas, {
    onNodeClick: (n) => {
      if (n.kind === 'file') showFileInfo(n.id);
      else if (n.kind === 'symbol') showSymbolInfo(n);
      else if (n.kind === 'ref') window.CodeView.openFile(n.file);
    },
    onNodeDblClick: (n) => { if (n.kind === 'file') window.CodeView.openFile(n.id); },
  });

  search.addEventListener('input', () => {
    if (!state.graph) return;
    const q = search.value.trim().toLowerCase();
    if (!q) { fg.highlight(null); return; }
    fg.highlight(new Set(state.graph.nodes.filter((n) => n.id.toLowerCase().includes(q)).map((n) => n.id)));
  });

  const active = window.CodeView.activeFile();
  if (active) state.selectedFile = active;

  if (state.graph) drawGraph(); else loadGraph();

  async function loadGraph() {
    try {
      state.graph = await api.depsGraph();
      document.getElementById('deps-meta').textContent =
        `${state.graph.nodes.length} 文件 · ${state.graph.edges.length} 条依赖` + (state.graph.truncated ? '（已截断）' : '');
      drawGraph();
    } catch (e) {
      info.innerHTML = '';
      info.append(el('div', { class: 'inner' }, el('div', { class: 'empty-hint' }, `分析失败：${e.message}`)));
    }
  }

  function cyclesBar() {
    const box = document.getElementById('deps-cycles');
    box.innerHTML = '';
    if (!state.graph || !state.graph.cycles.length) return;
    box.append(icon('warn', 13), el('span', { class: 'muted', style: { fontSize: '11.5px' } }, `循环依赖 ×${state.graph.cycles.length}`));
    state.graph.cycles.forEach((c) => {
      box.append(el('span', {
        class: 'cycle-chip', title: c.join('\n'),
        onclick: () => fg.highlight(new Set(c)),
      }, `↻${c.length}`));
    });
  }

  function drawGraph() {
    if (!state.graph) return;
    segFiles.classList.add('on');
    segSyms.classList.remove('on');
    cyclesBar();
    const nodes = state.graph.nodes.map((n) => ({
      id: n.id,
      label: n.id.split('/').pop(),
      color: extColor(n.ext),
      kind: 'file',
      r: n.symbols > 0 ? 7 : 5,
    }));
    const edges = state.graph.edges.map((e) => ({ source: e.from, target: e.to }));
    fg.setData(nodes, edges);
    setTimeout(() => fg.fitView(), 700);
    if (state.selectedFile && state.graph.nodes.some((n) => n.id === state.selectedFile)) {
      showFileInfo(state.selectedFile);
    } else {
      state.selectedFile = null;
      showOverview();
    }
  }

  function showOverview() {
    const exts = {};
    for (const n of state.graph.nodes) exts[n.ext] = (exts[n.ext] || 0) + 1;
    info.innerHTML = '';
    info.append(el('div', { class: 'inner' },
      el('h3', { style: { margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: '8px' } }, icon('package', 15), '依赖图谱'),
      el('div', { class: 'muted', style: { fontSize: '12px', lineHeight: 2 } },
        '拖拽节点 · 滚轮缩放 · 空白处拖动平移', el('br'),
        '单击节点查看详情，双击打开文件', el('br'),
        '解析方式：静态规则匹配（尽力而为）'),
      el('div', { class: 'card', style: { marginTop: '12px' } },
        el('div', { class: 'card-h' }, '语言分布'),
        el('div', { class: 'card-b legend' },
          Object.entries(exts).sort((a, b) => b[1] - a[1]).map(([e, c]) =>
            el('span', {}, el('span', { class: 'sw', style: { background: extColor(e) } }), `.${e} ×${c}`))),
      ),
      state.graph.cycles.length
        ? el('div', { class: 'card', style: { marginTop: '12px', borderColor: 'rgba(244,112,103,.4)' } },
          el('div', { class: 'card-h', style: { color: 'var(--red)' } }, icon('warn', 13), `发现 ${state.graph.cycles.length} 组循环依赖`),
          el('div', { class: 'card-b muted', style: { fontSize: '12px' } }, '点击上方红色标签查看环上的文件'))
        : null,
    ));
  }

  function symbolEntry() {
    if (state.selectedFile) showSymbolGraph(state.selectedFile);
    else toast('先在文件图中点击一个文件，再查看符号依赖', 'err');
  }

  // ---------------- 文件详情 ----------------
  async function showFileInfo(path) {
    state.selectedFile = path;
    info.innerHTML = '';
    const inner = el('div', { class: 'inner' });
    info.append(inner);
    const node = state.graph.nodes.find((n) => n.id === path);
    const outEdges = state.graph.edges.filter((e) => e.from === path);
    const inEdges = state.graph.edges.filter((e) => e.to === path);

    inner.append(
      el('h3', { style: { margin: '0 0 8px', fontSize: '14px', wordBreak: 'break-all' } }, path),
      node ? el('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '10px' } },
        `${node.lang} · ${node.symbols} 个符号 · ${outEdges.length} 个依赖 / ${inEdges.length} 个被依赖`) : null,
      el('div', { class: 'work-actions', style: { marginBottom: '12px' } },
        el('button', { class: 'btn mini primary', onclick: () => window.CodeView.openFile(path) }, icon('file', 12), '打开文件'),
        el('button', { class: 'btn mini', onclick: () => showSymbolGraph(path) }, icon('graph', 12), '符号依赖'),
        el('button', { class: 'btn mini', onclick: () => fg.highlight(new Set([path, ...outEdges.map((e) => e.to), ...inEdges.map((e) => e.from)])) }, icon('search', 12), '高亮邻居'),
        el('button', { class: 'btn mini ghost', onclick: () => fg.highlight(null) }, '取消高亮'),
      ),
    );

    const edgeList = (title, arr, pick) => {
      const card = el('div', { class: 'card', style: { marginBottom: '10px' } });
      card.append(el('div', { class: 'card-h' }, title, el('span', { class: 'count' }, arr.length)));
      const b = el('div', { class: 'card-b', style: { padding: '4px 6px' } });
      for (const e of arr.slice(0, 80)) {
        b.append(el('div', { class: 'detail-file', onclick: () => showFileInfo(pick(e)) },
          icon('chev-right', 11),
          el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, pick(e))));
      }
      if (!arr.length) b.append(el('div', { class: 'muted', style: { padding: '2px 8px', fontSize: '12px' } }, '（无）'));
      card.append(b);
      return card;
    };
    inner.append(
      edgeList('依赖（本文件引用了）', outEdges, (e) => e.to),
      edgeList('被依赖（引用了本文件）', inEdges, (e) => e.from),
    );
    fg.highlight(new Set([path, ...outEdges.map((e) => e.to), ...inEdges.map((e) => e.from)]));
  }

  // ---------------- 符号图 ----------------
  async function showSymbolGraph(path) {
    try {
      const symbols = await api.depsSymbols(path);
      segSyms.classList.add('on');
      segFiles.classList.remove('on');
      info.innerHTML = '';
      const inner = el('div', { class: 'inner' });
      info.append(inner);
      inner.append(
        el('h3', { style: { margin: '0 0 4px', fontSize: '14px' } }, '符号'),
        el('div', { class: 'muted mono', style: { fontSize: '11.5px', marginBottom: '10px' } }, path),
      );
      const card = el('div', { class: 'card' },
        el('div', { class: 'card-h' }, `符号列表 (${symbols.length})`, el('span', { style: { flex: 1 } }),
          el('button', { class: 'btn mini ghost', onclick: () => state.selectedFile && showFileInfo(state.selectedFile) }, '← 文件图')),
        el('div', { class: 'card-b', style: { padding: '4px 6px' } }));
      for (const s of symbols) {
        card.querySelector('.card-b').append(el('div', {
          class: 'detail-file',
          onclick: () => showSymbolInfo({ name: s.name, kind: s.kind, file: path, line: s.line }),
        },
        el('span', { class: 'badge' }, s.kind),
        el('span', { class: 'mono' }, s.name),
        el('span', { class: 'muted', style: { marginLeft: 'auto', fontSize: '10.5px' } }, `L${s.line}`),
        ));
      }
      if (!symbols.length) card.querySelector('.card-b').append(el('div', { class: 'muted', style: { padding: '4px 8px' } }, '（未识别到符号）'));
      inner.append(card);
    } catch (e) { errToast(e); }
  }

  async function showSymbolInfo(n) {
    info.innerHTML = '';
    info.append(el('div', { class: 'inner' }, el('div', { class: 'empty-hint' }, el('span', { class: 'spin' }, '⠋'), ' 正在扫描引用…')));
    try {
      const si = await api.depsRefs(n.file, n.name);
      drawSymbolView(si);
    } catch (e) {
      info.innerHTML = '';
      info.append(el('div', { class: 'inner' }, el('div', { class: 'empty-hint' }, e.message)));
    }
  }

  function drawSymbolView(si) {
    segSyms.classList.add('on');
    segFiles.classList.remove('on');
    document.getElementById('deps-cycles').innerHTML = '';

    const refKey = (r) => (r.enclosing ? `${r.file}#${r.enclosing}` : r.file);
    const refMap = new Map();
    for (const r of si.references) {
      const k = refKey(r);
      if (!refMap.has(k)) refMap.set(k, { file: r.file, enclosing: r.enclosing, count: 0 });
      refMap.get(k).count++;
    }
    const refs = [...refMap.values()].sort((a, b) => b.count - a.count).slice(0, 50);

    const centerId = `sym:${si.file}:${si.name}`;
    const nodes = [{ id: centerId, label: `${si.name}()`, color: '#bc8cff', kind: 'symbol', r: 11 }];
    const edges = [];
    for (const r of refs) {
      const id = r.enclosing ? `ref:${r.file}#${r.enclosing}` : `ref:${r.file}`;
      nodes.push({
        id,
        label: r.enclosing ? r.enclosing : r.file.split('/').pop(),
        color: r.enclosing ? '#39c5cf' : extColor(r.file.split('.').pop() || ''),
        kind: 'ref', file: r.file,
        r: Math.min(9, 4 + Math.log2(r.count + 1)),
      });
      edges.push({ source: id, target: centerId });
    }
    for (const c of si.callees.slice(0, 30)) {
      const id = `call:${si.file}#${c.line}`;
      nodes.push({ id, label: `↳ ${c.text.slice(0, 22)}`, color: '#5c6370', kind: 'ref', file: si.file, r: 4 });
      edges.push({ source: centerId, target: id });
    }
    fg.setData(nodes, edges);
    setTimeout(() => fg.fitView(), 600);

    info.innerHTML = '';
    const inner = el('div', { class: 'inner' });
    info.append(inner);
    inner.append(
      el('h3', { style: { margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: '8px' } },
        el('span', { class: 'badge', style: { fontSize: '11px' } }, si.kind),
        el('span', { class: 'mono' }, si.name)),
      el('div', { class: 'muted mono', style: { fontSize: '11.5px', marginBottom: '10px' } }, `定义于 ${si.file}:${si.line}`),
      el('div', { class: 'work-actions', style: { marginBottom: '12px' } },
        el('button', { class: 'btn mini primary', onclick: () => window.CodeView.openFile(si.file) }, icon('file', 12), '打开定义'),
        el('button', { class: 'btn mini', onclick: () => showSymbolGraph(si.file) }, '← 符号列表'),
        el('button', { class: 'btn mini', onclick: () => drawGraph() }, '← 文件图'),
      ),
    );

    const refCard = el('div', { class: 'card', style: { marginBottom: '10px' } },
      el('div', { class: 'card-h' }, '引用位置', el('span', { class: 'count' }, si.references.length)),
      el('div', { class: 'card-b', style: { padding: '4px 6px' } }));
    for (const r of si.references.slice(0, 150)) {
      refCard.querySelector('.card-b').append(el('div', {
        class: 'detail-file', title: `${r.file}:${r.line}`,
        onclick: () => window.CodeView.openFile(r.file),
      },
      el('span', { class: 'muted', style: { fontSize: '10.5px', flex: '0 0 38px' } }, `L${r.line}`),
      el('span', { class: 'mono', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.text),
      r.enclosing ? el('span', { class: 'badge', style: { marginLeft: 'auto', flex: '0 0 auto' } }, r.enclosing) : null,
      ));
    }
    if (!si.references.length) refCard.querySelector('.card-b').append(el('div', { class: 'muted', style: { padding: '4px 8px' } }, '（项目中没有找到引用）'));
    inner.append(refCard);

    if (si.callees.length) {
      const callCard = el('div', { class: 'card' },
        el('div', { class: 'card-h' }, '本文件内调用', el('span', { class: 'count' }, si.callees.length)),
        el('div', { class: 'card-b', style: { padding: '4px 6px' } }));
      for (const c of si.callees.slice(0, 60)) {
        callCard.querySelector('.card-b').append(el('div', { class: 'detail-file', title: c.text },
          el('span', { class: 'muted', style: { fontSize: '10.5px', flex: '0 0 38px' } }, `L${c.line}`),
          el('span', { class: 'mono', style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, c.text)));
      }
      inner.append(callCard);
    }
  }
}
