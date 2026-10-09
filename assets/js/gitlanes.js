// Git 提交图：泳道分配 + 整体 SVG 渲染
const PALETTE = ['#5b8cff', '#3fb950', '#f0883e', '#bc8cff', '#f778ba', '#39c5cf', '#e3b341', '#ff7b72', '#7ee787', '#d2a8ff'];

/**
 * commits: [{oid, parents:[]}]（新→旧）
 * 返回 rows: [{..., lane, edges:[{from,to}]}]，lanes: 最终泳道状态
 */
export function computeLanes(commits) {
  const rows = [];
  let lanes = []; // lane -> 期待出现的 oid（null = 空闲）
  for (const c of commits) {
    let lane = lanes.indexOf(c.oid);
    if (lane === -1) {
      // 新出现的提交（分支头）：找空位或追加
      const free = lanes.indexOf(null);
      lane = free === -1 ? lanes.length : free;
    }
    lanes[lane] = null;
    const edges = [];
    c.parents.forEach((p, i) => {
      let tl = lanes.indexOf(p);
      if (tl === -1) {
        if (i === 0 && lanes[lane] == null) {
          tl = lane; // 第一父提交优先沿用本泳道
        } else {
          const free = lanes.indexOf(null);
          tl = free === -1 ? lanes.length : free;
        }
        lanes[tl] = p;
      }
      edges.push({ from: lane, to: tl });
    });
    rows.push({ ...c, lane, edges });
  }
  return { rows, laneCount: lanes.length || 1 };
}

export const LANE_W = 15;
export const ROW_H = 34;

/**
 * 在给定 SVG 元素内渲染整个提交图。
 * rows 来自 computeLanes；oidToRow: oid -> 第一次出现的行号
 */
export function renderGraphSvg(svg, rows, laneCount, oidToRow) {
  const W = Math.max(laneCount * LANE_W + 10, 60);
  const H = rows.length * ROW_H;
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const NS = 'http://www.w3.org/2000/svg';
  const x = (l) => l * LANE_W + LANE_W / 2 + 4;
  const cy = (i) => i * ROW_H + ROW_H / 2;
  const colorOf = (l) => PALETTE[l % PALETTE.length];

  const g = document.createElementNS(NS, 'g');

  // 泳道贯穿竖线：row i 处理完后仍活跃的 lane（lanes[l] != null）
  let lanes = [];
  rows.forEach((r, i) => {
    // 更新本行 lanes 状态（与 computeLanes 一致的重演）
    let lane = lanes.indexOf(r.oid);
    if (lane === -1) {
      const free = lanes.indexOf(null);
      lane = free === -1 ? lanes.length : free;
    }
    lanes[lane] = null;
    r.parents.forEach((p, k) => {
      let tl = lanes.indexOf(p);
      if (tl === -1) {
        if (k === 0 && lanes[lane] == null) tl = lane;
        else {
          const free = lanes.indexOf(null);
          tl = free === -1 ? lanes.length : free;
        }
        lanes[tl] = p;
      }
    });
    if (i < rows.length - 1) {
      lanes.forEach((expect, l) => {
        if (expect != null) {
          const line = document.createElementNS(NS, 'line');
          line.setAttribute('x1', x(l)); line.setAttribute('x2', x(l));
          line.setAttribute('y1', cy(i)); line.setAttribute('y2', cy(i + 1));
          line.setAttribute('stroke', colorOf(l));
          line.setAttribute('stroke-width', '1.6');
          g.append(line);
        }
      });
    }
    // 边：本行提交 → 父提交（画到下一行处的拐点；跨行部分由贯穿竖线补齐）
    for (const e of r.edges) {
      const y2 = cy(i + 1);
      const path = document.createElementNS(NS, 'path');
      const x1 = x(e.from), x2 = x(e.to);
      const y1 = cy(i);
      const my = (y1 + y2) / 2;
      path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`);
      path.setAttribute('stroke', colorOf(e.from));
      path.setAttribute('stroke-width', '1.6');
      path.setAttribute('fill', 'none');
      g.append(path);
    }
  });

  // 节点
  rows.forEach((r, i) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', x(r.lane));
    c.setAttribute('cy', cy(i));
    c.setAttribute('r', r.refs && r.refs.length ? 5 : 4);
    c.setAttribute('fill', colorOf(r.lane));
    if (r.parents.length > 1) c.setAttribute('stroke', '#fff');
    g.append(c);
  });

  svg.append(g);
}
