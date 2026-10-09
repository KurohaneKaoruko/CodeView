// Canvas 提交树状图，两种模式：
//  - 'scroll'（默认）：VS Code 风格，图表随内容固定绘制，原生滚动条/滚轮查看
//  - 'free'：全宽自由视图，支持缩放（滚轮）与平移（拖拽）
import { el } from './ui.js?v=3';
import { LANE_W, ROW_H, X0, Y0, laneColor } from './gitlanes.js?v=3';

const NODE_R = 5.5;
const MAX_CANVAS_H = 30000; // scroll 模式画布高度上限

// 模块级共享 tooltip（避免多实例残留泄漏）
let sharedTooltip = null;
function ensureTooltip() {
  if (!sharedTooltip) {
    sharedTooltip = el('div', { class: 'gg-tooltip' });
    document.body.append(sharedTooltip);
  }
  return sharedTooltip;
}

/** 隐藏共享 tooltip：切换视图 / 窗口失焦 / 滚动时调用，避免残留 */
export function hideGraphTooltip() {
  if (sharedTooltip) sharedTooltip.style.display = 'none';
}
window.addEventListener('blur', hideGraphTooltip);
window.addEventListener('scroll', hideGraphTooltip, true);

export function createCommitGraph(container, { onNodeClick, onNodeMenu, mode = 'scroll', orientation = 'vertical' } = {}) {
  let rows = [];
  let edgeList = [];
  let laneCount = 1;
  let selected = null;
  let hover = null;
  let view = { x: 0, y: 0, k: 1 }; // free 模式视图变换

  const free = mode === 'free';
  const horizontal = free && orientation === 'horizontal';
  const COL_W = 26;   // 横向模式：相邻提交间距
  const HX0 = 30, HY0 = 30;
  let contentH = 0;
  let contentW = 0;

  // 节点坐标（free+horizontal 时时间轴向右、泳道纵向展开）
  function posOf(r, i) {
    if (horizontal) {
      return { x: HX0 + i * COL_W, y: HY0 + r.lane * LANE_W };
    }
    return { x: X0 + r.lane * LANE_W, y: Y0 + i * ROW_H };
  }

  // ---------- DOM ----------
  let content = null;
  const canvas = document.createElement('canvas');
  if (free) {
    container.append(canvas);
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
  } else {
    content = el('div', { class: 'gg-content' });
    container.append(content);
    content.append(canvas);
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
  }
  const ctx = canvas.getContext('2d');

  // ---------- 数据 ----------
  function setData(laid) {
    rows = laid.rows;
    laneCount = laid.laneCount;
    const oidToRow = new Map();
    rows.forEach((r, i) => { if (!oidToRow.has(r.oid)) oidToRow.set(r.oid, i); });
    rows.forEach((r, i) => {
      const p = posOf(r, i);
      r.x = p.x;
      r.y = p.y;
    });
    edgeList = [];
    const last = rows[rows.length - 1];
    for (const r of rows) {
      for (const e of r.edges) {
        const pj = oidToRow.get(e.toOid);
        let x2, y2;
        if (pj != null) {
          x2 = rows[pj].x;
          y2 = rows[pj].y;
        } else if (horizontal) {
          x2 = r.x + COL_W * 2;
          y2 = r.y;
        } else {
          x2 = r.x;
          y2 = Math.max((last ? last.y : Y0) + ROW_H * 1.5, r.y + ROW_H);
        }
        edgeList.push({ x1: r.x, y1: r.y, x2, y2, color: laneColor(e.from) });
      }
    }
    if (horizontal) {
      contentW = HX0 + (rows.length + 2) * COL_W + 60;
      contentH = HY0 + (laneCount + 1) * LANE_W + 60;
    } else {
      contentH = (rows.length ? rows[rows.length - 1].y : Y0) + 60;
      contentW = X0 + (laneCount + 1) * LANE_W + 300;
      if (!free) contentH = Math.min(MAX_CANVAS_H, contentH);
    }
    resize();
  }

  // ---------- 尺寸 ----------
  function resize() {
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (free) {
      canvas.width = Math.max(1, rect.width * dpr);
      canvas.height = Math.max(1, rect.height * dpr);
    } else {
      content.style.height = `${contentH}px`;
      const w = Math.max(1, rect.width);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${contentH}px`;
      canvas.width = w * dpr;
      canvas.height = contentH * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  new ResizeObserver(resize).observe(container);

  // ---------- 绘制 ----------
  function draw() {
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, free ? rect.height : contentH);
    if (free) {
      ctx.translate(view.x, view.y);
      ctx.scale(view.k, view.k);
    }

    // 泳道参考线
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    if (horizontal) {
      for (let l = 0; l < laneCount; l++) {
        const y = HY0 + l * LANE_W;
        ctx.beginPath();
        ctx.moveTo(HX0 - COL_W, y);
        ctx.lineTo(contentW, y);
        ctx.stroke();
      }
    } else {
      for (let l = 0; l < laneCount; l++) {
        const x = X0 + l * LANE_W;
        ctx.beginPath();
        ctx.moveTo(x, Y0 - ROW_H);
        ctx.lineTo(x, contentH);
        ctx.stroke();
      }
    }

    // 边
    ctx.lineCap = 'round';
    for (const e of edgeList) {
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 1.7;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(e.x1, e.y1);
      if (horizontal) {
        if (Math.abs(e.y1 - e.y2) < 0.5) {
          ctx.lineTo(e.x2, e.y2);
        } else {
          const midX = (e.x1 + e.x2) / 2;
          ctx.bezierCurveTo(midX, e.y1, midX, e.y2, e.x2, e.y2);
        }
      } else if (Math.abs(e.x1 - e.x2) < 0.5) {
        ctx.lineTo(e.x2, e.y2);
      } else {
        const midY = (e.y1 + e.y2) / 2;
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

    // 引用标签（free 模式缩得太小时不画，避免糊成一团）
    if (!free || view.k >= 0.5) {
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
          let bx, by;
          if (horizontal) {
            // 横向模式：标签画在节点上方，居中
            bx = r.x - (tw + pad * 2) / 2;
            by = r.y - NODE_R - h - 4;
          } else {
            bx = lx;
            by = r.y - h / 2 - 0.5;
          }
          roundRect(ctx, bx, by, tw + pad * 2, h, 4);
          ctx.fillStyle = bg;
          ctx.fill();
          ctx.strokeStyle = border;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = fg;
          ctx.fillText(text, bx + pad, by + h / 2 + 3.5);
          lx += tw + pad * 2 + 4;
        }
      }
    }
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
  function hitAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    let mx = clientX - rect.left;
    let my = clientY - rect.top;
    if (free) {
      mx = (mx - view.x) / view.k;
      my = (my - view.y) / view.k;
    } else if (mx < 0 || my < 0 || mx > rect.width || my > rect.height) {
      return null;
    }
    let best = null;
    let bestD = free ? 14 / Math.min(view.k, 1) + 6 : 14;
    for (const r of rows) {
      const d = Math.hypot(r.x - mx, r.y - my);
      if (d < bestD) { bestD = d; best = r; }
    }
    return best;
  }

  // ---------- 交互 ----------
  canvas.addEventListener('mousemove', (e) => {
    const hit = hitAt(e.clientX, e.clientY);
    canvas.classList.toggle('node-hover', !!hit);
    const prev = hover;
    hover = hit ? hit.oid : null;
    if (hit) {
      const tooltip = ensureTooltip();
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
    const hit = hitAt(e.clientX, e.clientY);
    if (hit) {
      selected = hit.oid;
      draw();
      onNodeClick && onNodeClick(hit, e.clientX, e.clientY);
    }
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const hit = hitAt(e.clientX, e.clientY);
    if (hit) {
      selected = hit.oid;
      draw();
      onNodeMenu && onNodeMenu(hit, e.clientX, e.clientY);
    }
  });

  // free 模式：拖拽平移 + 滚轮缩放
  if (free) {
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
    window.addEventListener('mouseup', () => {
      if (!panning) return;
      panning = false;
      canvas.classList.remove('panning');
      // 抑制平移后紧随的 click 误触
      if (moved) {
        canvas.addEventListener('click', (ev) => ev.stopImmediatePropagation(), { once: true, capture: true });
      }
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const k0 = view.k;
      const k1 = Math.min(3, Math.max(0.15, k0 * (e.deltaY < 0 ? 1.13 : 0.885)));
      view.x = mx - ((mx - view.x) / k0) * k1;
      view.y = my - ((my - view.y) / k0) * k1;
      view.k = k1;
      draw();
    }, { passive: false });
  }

  function fit() {
    if (!free || !rows.length) return;
    const rect = container.getBoundingClientRect();
    if (horizontal) {
      // 从左到右：最新提交贴左，泳道纵向居中
      view.k = Math.min(1.6, Math.max(0.2, rect.height / Math.max(contentH, 1)));
      view.x = 14;
      view.y = (rect.height - contentH * view.k) / 2;
    } else {
      const w = X0 + (laneCount + 1) * LANE_W + 300;
      const h = contentH + 40;
      view.k = Math.min(2, Math.max(0.15, Math.min(rect.width / w, rect.height / h)));
      view.x = (rect.width - w * view.k) / 2;
      view.y = (rect.height - h * view.k) / 2 + 10;
    }
    draw();
  }

  resize();
  // 调试句柄（无副作用，便于诊断）
  canvas.__debug = {
    rows: () => rows.length,
    view: () => ({ ...view }),
    hitAt,
    mode: free ? 'free' : 'scroll',
    orientation,
    content: () => ({ w: contentW, h: contentH }),
  };
  return { setData, draw, fit, resetSelection: () => { selected = null; draw(); } };
}
