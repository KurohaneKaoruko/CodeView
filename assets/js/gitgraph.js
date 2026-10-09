// Canvas 提交树状图：平移 / 缩放 / 悬停提示 / 点击与右键节点
import { el } from './ui.js';
import { LANE_W, ROW_H, X0, Y0, laneColor } from './gitlanes.js';

const NODE_R = 5.5;

export function createCommitGraph(container, { onNodeClick, onNodeMenu } = {}) {
  const canvas = document.createElement('canvas');
  container.append(canvas);
  let ctx = canvas.getContext('2d');
  let rows = [];
  let edgeList = [];   // {x1,y1,x2,y2,color}
  let laneCount = 1;
  let selected = null;
  let view = { x: 0, y: 0, k: 1 };
  let hover = null;
  let tooltip = null;
  let contentH = 0, contentW = 0;

  // ---------- 数据 ----------
  function setData(laid) {
    rows = laid.rows;
    laneCount = laid.laneCount;
    const oidToRow = new Map();
    rows.forEach((r, i) => { if (!oidToRow.has(r.oid)) oidToRow.set(r.oid, i); });
    edgeList = [];
    const maxY = rows.length ? rows[rows.length - 1].y : Y0;
    for (const r of rows) {
      for (const e of r.edges) {
        const pj = oidToRow.get(e.toOid);
        const y2 = pj != null ? rows[pj].y : maxY + ROW_H * 1.5;
        const x2 = pj != null ? X0 + e.to * LANE_W : r.x; // 未加载的父提交：垂直到底部
        edgeList.push({
          x1: r.x, y1: r.y, x2, y2: Math.max(y2, r.y + ROW_H),
          color: laneColor(e.from),
        });
      }
    }
    contentW = X0 + (laneCount + 1) * LANE_W + 260; // 右侧留标签空间
    contentH = (rows.length ? rows[rows.length - 1].y : Y0) + 60;
    draw();
  }

  // ---------- 视图 ----------
  function resize() {
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, rect.width * dpr);
    canvas.height = Math.max(1, rect.height * dpr);
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  new ResizeObserver(resize).observe(container);

  function draw() {
    const rect = container.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.translate(view.x, view.y);
    ctx.scale(view.k, view.k);

    // 泳道淡参考线
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let l = 0; l < laneCount; l++) {
      const x = X0 + l * LANE_W;
      ctx.beginPath();
      ctx.moveTo(x, Y0 - ROW_H);
      ctx.lineTo(x, contentH);
      ctx.stroke();
    }

    // 边
    ctx.lineCap = 'round';
    for (const e of edgeList) {
      const midY = (e.y1 + e.y2) / 2;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 1.7;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(e.x1, e.y1);
      if (Math.abs(e.x1 - e.x2) < 0.5) {
        ctx.lineTo(e.x2, e.y2);
      } else {
        ctx.bezierCurveTo(e.x1, midY, e.x2, midY, e.x2, e.y2);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 节点
    for (const r of rows) {
      const isSel = selected === r.oid;
      const isHead = (r.refs || []).some((x) => x.kind === 'head');
      if (isSel) {
        ctx.beginPath();
        ctx.arc(r.x, r.y, NODE_R + 4.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(91,140,255,.28)';
        ctx.fill();
      }
      if (isHead) {
        ctx.beginPath();
        ctx.arc(r.x, r.y, NODE_R + 2.2, 0, Math.PI * 2);
        ctx.strokeStyle = laneColor(r.lane);
        ctx.globalAlpha = 0.65;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.parents && r.parents.length > 1 ? NODE_R + 0.8 : NODE_R, 0, Math.PI * 2);
      ctx.fillStyle = laneColor(r.lane);
      ctx.fill();
      if (hover === r.oid || isSel) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }

    // 引用标签（放大到一定程度才画，避免缩小后糊成一团）
    if (view.k >= 0.5) {
      ctx.font = '10px Segoe UI, system-ui, sans-serif';
      for (const r of rows) {
        const refs = (r.refs || []).slice(0, 3);
        if (!refs.length) continue;
        let lx = r.x + NODE_R + 5;
        for (const ref of refs) {
          const text = ref.name + (ref.current ? ' ✓' : '');
          const tw = ctx.measureText(text).width;
          const kind = ref.kind;
          const bg = kind === 'head' ? 'rgba(63,185,80,.16)' : kind === 'remote' ? 'rgba(188,140,255,.16)' : 'rgba(224,177,62,.16)';
          const border = kind === 'head' ? 'rgba(63,185,80,.55)' : kind === 'remote' ? 'rgba(188,140,255,.55)' : 'rgba(224,177,62,.55)';
          const fg = kind === 'head' ? '#7ee787' : kind === 'remote' ? '#d2a8ff' : '#f2cc60';
          const pad = 4, h = 15;
          roundRect(ctx, lx, r.y - h / 2 - 0.5, tw + pad * 2, h, 4);
          ctx.fillStyle = bg;
          ctx.fill();
          ctx.strokeStyle = border;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = fg;
          ctx.fillText(text, lx + pad, r.y + 3.5);
          lx += tw + pad * 2 + 4;
        }
      }
    }

    ctx.restore();
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // ---------- 命中测试 ----------
  function pick(mx, my) {
    const wx = (mx - view.x) / view.k;
    const wy = (my - view.y) / view.k;
    let best = null, bestD = 12 / Math.min(view.k, 1) + 6;
    for (const r of rows) {
      const d = Math.hypot(r.x - wx, r.y - wy);
      if (d < bestD) { bestD = d; best = r; }
    }
    return best;
  }

  // ---------- 交互 ----------
  let panning = false, panStart = null, moved = false;
  canvas.addEventListener('mousedown', (e) => {
    panning = true; moved = false;
    panStart = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    canvas.classList.add('panning');
  });
  window.addEventListener('mousemove', (e) => {
    if (!panning) return;
    const dx = e.clientX - panStart.x, dy = e.clientY - panStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    view.x = panStart.vx + dx;
    view.y = panStart.vy + dy;
    draw();
  });
  window.addEventListener('mouseup', () => { panning = false; canvas.classList.remove('panning'); });

  canvas.addEventListener('wheel', (e) => {
    // 固定比例，不做缩放；阻止页面滚动由外层容器处理
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const hit = pick(e.clientX - rect.left, e.clientY - rect.top);
    canvas.classList.toggle('node-hover', !!hit);
    const prev = hover;
    hover = hit ? hit.oid : null;
    if (hit) {
      if (!tooltip) {
        tooltip = el('div', { class: 'gg-tooltip' });
        document.body.append(tooltip);
      }
      tooltip.innerHTML = '';
      tooltip.append(
        el('div', { class: 't-subject' }, hit.subject || '(无信息)'),
        el('div', { class: 't-meta' },
          `${hit.author} · ${new Date(hit.time * 1000).toLocaleString()} · ${hit.oid.slice(0, 7)}`),
      );
      tooltip.style.left = `${Math.min(e.clientX + 14, innerWidth - 440)}px`;
      tooltip.style.top = `${e.clientY + 14}px`;
      tooltip.style.display = '';
    } else if (tooltip) {
      tooltip.style.display = 'none';
    }
    if (prev !== hover) draw();
  });
  canvas.addEventListener('mouseleave', () => {
    hover = null;
    if (tooltip) tooltip.style.display = 'none';
    draw();
  });

  canvas.addEventListener('click', (e) => {
    if (moved) return;
    const rect = canvas.getBoundingClientRect();
    const hit = pick(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) {
      selected = hit.oid;
      draw();
      onNodeClick && onNodeClick(hit);
    }
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const hit = pick(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) {
      selected = hit.oid;
      draw();
      onNodeMenu && onNodeMenu(hit, e.clientX, e.clientY);
    }
  });

  function fit() {
    if (!rows.length) return;
    const rect = container.getBoundingClientRect();
    view.k = 1;
    view.x = 8;
    if (contentH < rect.height) {
      view.y = (rect.height - (Y0 * 2 + (rows.length - 1) * ROW_H)) / 2;
    } else {
      view.y = 0;
    }
    draw();
  }

  resize();
  return { setData, fit, draw, resetSelection: () => { selected = null; draw(); } };
}
