// Git 提交图布局：泳道分配 + 供 Canvas 渲染的几何数据
const PALETTE = ['#5b8cff', '#3fb950', '#f0883e', '#bc8cff', '#f778ba', '#39c5cf', '#e3b341', '#ff7b72', '#7ee787', '#d2a8ff'];

export const LANE_W = 18;   // 泳道间距（世界坐标 px）
export const ROW_H = 30;    // 行距（世界坐标 px）
export const X0 = 26;       // 首泳道 x
export const Y0 = 24;       // 首行 y

export const laneColor = (l) => PALETTE[((l % PALETTE.length) + PALETTE.length) % PALETTE.length];

/**
 * commits: [{oid, parents:[]}]（新→旧）
 * 返回 { rows, laneCount }；rows 每项附加：
 *   lane       泳道号
 *   x, y       世界坐标
 *   edges      [{ from: 本节点泳道, to: 目标泳道, toOid }]（指向父提交）
 *   incoming   [泳道…]  从上方汇入本节点的边
 */
export function layoutGraph(commits) {
  const rows = [];
  let lanes = []; // lane -> 期待出现的 oid（null = 空闲）
  let maxLane = 0;

  commits.forEach((c, i) => {
    // 收集汇入本节点的泳道
    const incoming = [];
    lanes.forEach((expect, l) => {
      if (expect === c.oid) incoming.push(l);
    });

    let lane = lanes.indexOf(c.oid);
    if (lane === -1) {
      const free = lanes.indexOf(null);
      lane = free === -1 ? lanes.length : free;
    }
    lanes[lane] = null;

    const edges = [];
    c.parents.forEach((p, k) => {
      let tl = lanes.indexOf(p);
      if (tl === -1) {
        if (k === 0 && lanes[lane] == null) tl = lane;
        else {
          const free = lanes.indexOf(null);
          tl = free === -1 ? lanes.length : free;
        }
        lanes[tl] = p;
      }
      edges.push({ from: lane, to: tl, toOid: p });
      maxLane = Math.max(maxLane, tl);
    });
    maxLane = Math.max(maxLane, lane);

    rows.push({
      ...c,
      lane,
      x: X0 + lane * LANE_W,
      y: Y0 + i * ROW_H,
      edges,
      incoming,
    });
  });

  return { rows, laneCount: Math.max(1, maxLane + 1) };
}
