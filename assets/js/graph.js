// 力导向图渲染（SVG + pan/zoom + 节点拖拽）

const NS = 'http://www.w3.org/2000/svg';

export function createForceGraph(container, { nodeRadius = 7, onNodeClick, onNodeDblClick } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  container.append(svg);
  const viewport = document.createElementNS(NS, 'g');
  svg.append(viewport);
  const gEdges = document.createElementNS(NS, 'g');
  const gNodes = document.createElementNS(NS, 'g');
  viewport.append(gEdges, gNodes);

  let nodes = [];      // {id,label,color,r,x,y,vx,vy,fixed}
  let nodeMap = new Map();
  let edges = [];      // {s,t}
  let tf = { x: 0, y: 0, k: 1 };
  let running = false;
  let raf = 0;
  let hlNodes = null;  // Set(id) 高亮集合（null=全部）
  let hlEdges = null;

  // ---- pan / zoom ----
  let panning = false;
  let panStart = null;
  svg.addEventListener('mousedown', (e) => {
    if (e.target === svg || e.target === viewport || e.target === gEdges || e.target === gNodes) {
      panning = true;
      panStart = { x: e.clientX, y: e.clientY, tx: tf.x, ty: tf.y };
      svg.classList.add('panning');
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (panning && panStart) {
      tf.x = panStart.tx + (e.clientX - panStart.x);
      tf.y = panStart.ty + (e.clientY - panStart.y);
      applyTf();
    }
  });
  window.addEventListener('mouseup', () => { panning = false; svg.classList.remove('panning'); });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const k0 = tf.k;
    const k1 = Math.min(6, Math.max(0.08, k0 * (e.deltaY < 0 ? 1.12 : 0.89)));
    tf.x = mx - ((mx - tf.x) / k0) * k1;
    tf.y = my - ((my - tf.y) / k0) * k1;
    tf.k = k1;
    applyTf();
  }, { passive: false });

  function applyTf() {
    viewport.setAttribute('transform', `translate(${tf.x},${tf.y}) scale(${tf.k})`);
  }

  // ---- 数据 ----
  function setData(nodeList, edgeList) {
    const old = nodeMap;
    nodes = nodeList.map((n, i) => {
      const o = old.get(n.id);
      const a = (i / Math.max(nodeList.length, 1)) * Math.PI * 2;
      const R = 40 + 6 * Math.sqrt(nodeList.length);
      return {
        ...n,
        r: n.r || nodeRadius,
        x: o ? o.x : Math.cos(a) * R + (Math.random() - 0.5) * 20,
        y: o ? o.y : Math.sin(a) * R + (Math.random() - 0.5) * 20,
        vx: 0, vy: 0, fixed: false,
      };
    });
    nodeMap = new Map(nodes.map((n) => [n.id, n]));
    edges = edgeList
      .map((e) => ({ s: nodeMap.get(e.source), t: nodeMap.get(e.target) }))
      .filter((e) => e.s && e.t);
    hlNodes = null; hlEdges = null;
    render();
    start();
  }

  function render() {
    while (gEdges.firstChild) gEdges.removeChild(gEdges.firstChild);
    for (const e of edges) {
      const line = document.createElementNS(NS, 'path');
      const dx = e.t.x - e.s.x, dy = e.t.y - e.s.y;
      const len = Math.max(Math.hypot(dx, dy), 1);
      const ox = (dx / len) * (e.s.r + 2), oy = (dy / len) * (e.s.r + 2);
      const px = (dx / len) * (e.t.r + 6), py = (dy / len) * (e.t.r + 6);
      const x1 = e.s.x + ox, y1 = e.s.y + oy;
      const x2 = e.t.x - px, y2 = e.t.y - py;
      // 箭头
      const ax = dx / len, ay = dy / len;
      const wx = -ay, wy = ax;
      const AS = 5;
      line.setAttribute('d',
        `M ${x1} ${y1} L ${x2} ${y2} M ${x2} ${y2} L ${x2 - AS * ax + AS * 0.5 * wx} ${y2 - AS * ay + AS * 0.5 * wy} M ${x2} ${y2} L ${x2 - AS * ax - AS * 0.5 * wx} ${y2 - AS * ay - AS * 0.5 * wy}`);
      line.setAttribute('class', `graph-edge${hlEdges && hlEdges.has(e) ? ' hl' : ''}`);
      gEdges.append(line);
    }
    while (gNodes.firstChild) gNodes.removeChild(gNodes.firstChild);
    for (const n of nodes) {
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', `graph-node${hlNodes && !hlNodes.has(n.id) ? ' dim' : ''}`);
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', n.x); c.setAttribute('cy', n.y); c.setAttribute('r', n.r);
      c.setAttribute('fill', n.color || '#5b8cff');
      c.setAttribute('stroke', 'rgba(0,0,0,.5)');
      g.append(c);
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', n.x + n.r + 4);
      t.setAttribute('y', n.y + 3.5);
      t.textContent = n.label;
      g.append(t);
      g.addEventListener('mousedown', (ev) => {
        ev.stopPropagation();
        n.dragging = true;
        n.fixed = true;
        const start = { x: ev.clientX, y: ev.clientY, nx: n.x, ny: n.y };
        const move = (e2) => {
          if (!n.dragging) return;
          n.x = start.nx + (e2.clientX - start.x) / tf.k;
          n.y = start.ny + (e2.clientY - start.y) / tf.k;
          n.vx = n.vy = 0;
          render();
        };
        const up = () => {
          n.dragging = false;
          setTimeout(() => { n.fixed = false; }, 800);
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      });
      g.addEventListener('click', () => onNodeClick && onNodeClick(n));
      g.addEventListener('dblclick', () => onNodeDblClick && onNodeDblClick(n));
      gNodes.append(g);
    }
  }

  // ---- 模拟 ----
  function tick() {
    const N = nodes.length;
    if (N === 0) return;
    // 斥力（O(n^2)，节点多时降采样）
    const step = N > 500 ? 2 : 1;
    for (let i = 0; i < N; i += step) {
      const a = nodes[i];
      for (let j = i + step; j < N; j += step) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        if (d2 > 250000) continue;
        const f = 2600 / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
    }
    // 弹簧
    for (const e of edges) {
      const dx = e.t.x - e.s.x, dy = e.t.y - e.s.y;
      const d = Math.max(Math.hypot(dx, dy), 1);
      const f = (d - 120) * 0.02;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      e.s.vx += fx; e.s.vy += fy;
      e.t.vx -= fx; e.t.vy -= fy;
    }
    // 中心引力
    for (const n of nodes) {
      n.vx -= n.x * 0.003;
      n.vy -= n.y * 0.003;
      if (!n.fixed && !n.dragging) {
        n.vx *= 0.82; n.vy *= 0.82;
        n.x += Math.max(-8, Math.min(8, n.vx));
        n.y += Math.max(-8, Math.min(8, n.vy));
      } else {
        n.vx = n.vy = 0;
      }
    }
  }

  function start() {
    if (running) return;
    running = true;
    const loop = () => {
      if (!running) return;
      tick();
      render();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    // 15 秒后自动停止渲染循环（图基本稳定）
    setTimeout(stop, 15000);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    render();
  }
  function nudge() { start(); setTimeout(stop, 4000); }

  // ---- 高亮 ----
  function highlight(nodeIds, edgeFilter) {
    hlNodes = nodeIds; // Set 或 null
    hlEdges = edgeFilter || null;
    render();
  }

  // ---- 视图控制 ----
  function fitView() {
    if (!nodes.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) {
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y);
    }
    const rect = svg.getBoundingClientRect();
    const pad = 40;
    const k = Math.min(2.2, Math.max(0.08,
      Math.min((rect.width - pad * 2) / Math.max(x1 - x0, 1), (rect.height - pad * 2) / Math.max(y1 - y0, 1))));
    tf.k = k;
    tf.x = rect.width / 2 - ((x0 + x1) / 2) * k;
    tf.y = rect.height / 2 - ((y0 + y1) / 2) * k;
    applyTf();
  }

  return { svg, setData, highlight, fitView, nudge, stop, focusNode: (id) => highlight(new Set([id])) };
}
