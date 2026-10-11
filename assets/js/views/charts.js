// 变更图表：项目当前总量趋势（折线 / K线 × 总行数 / 总文件数 × 按提交 / 按天）
// 语义：曲线是“当前值”（每次提交后的项目总量），随每次提交的增删上下波动；
//       K线按提交：实体 = 提交前→后总量，上影 = 提交中最高（先增后减），下影 = 最低；
//       K线按天：实体 = 当日开始→结束总量，上下影 = 当日各提交净变化轨迹的极值。
// 数值基准：后端给出窗口起点（最旧提交的第一父提交）的总量，前端逐提交累加净变化得到绝对总量。
// 交互：滚轮缩放（以鼠标为中心）· 拖拽平移 · 双击复位 · 悬停详情 · 点击固定
import { api } from '../api.js?v=3';
import { el, icon, shortOid, dropdown } from '../ui.js?v=3';

const C = {
  green: '#4ec96a',
  red: '#f47067',
  accent: '#5b8cff',
  grid: '#262a33',
  axis: '#3a4150',
  text: '#9aa3b2',
  faint: '#5f6876',
};

const MIN_SPAN = 6; // 最少可见柱数（缩放下限）

const state = {
  data: null,          // { base_files, base_lines, points[] }（点序：旧 → 新）
  ref: '', limit: 300, skipMerge: false,
  mode: 'line',        // 'line' | 'candle'
  metric: 'lines',     // 'lines' | 'files'
  gran: 'commit',      // 'commit' | 'day'
  lastRoot: null, loading: false,
};

// 视图销毁时断开上一个 ResizeObserver
let lastRO = null;
// 当前渲染内的交互状态
let hoverIdx = null;   // 指向 bars 下标
let pinnedIdx = null;
let geom = null;       // 绘图几何缓存（命中检测用）
let zoom = null;       // 可见窗口 { z0, z1 }（drawn 索引空间的浮点区间），null = 全量
let drag = null;       // 拖拽平移状态

const p2 = (x) => String(x).padStart(2, '0');

const fmtDate = (t) => {
  const d = new Date(t * 1000);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};

const fmtAxis = (v) => {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1000000) return `${(v / 1000000).toFixed(a % 1000000 ? 1 : 0)}M`;
  if (a >= 1000) return `${(v / 1000).toFixed(a % 1000 ? 1 : 0)}k`;
  return String(v);
};

const fmtNum = (v) => Number(v).toLocaleString('en-US');

function niceCeil(v) {
  if (v <= 1) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return step * exp;
}

function points() {
  return state.data ? state.data.points : [];
}

/**
 * 把逐提交的增删累加成总量，并按当前粒度聚合成柱（bar）：
 *   bar = { open, close, high, low, time, addSum, delSum, merge, label, pointIdxs }
 * 排除合并只影响“画哪些柱”，不影响累计（保证当前值真实）。
 */
function buildBars() {
  const pts = points();
  const addOf = (p) => (state.metric === 'lines' ? p.insertions : p.files_added);
  const delOf = (p) => (state.metric === 'lines' ? p.deletions : p.files_deleted);
  const base = state.data
    ? (state.metric === 'lines' ? state.data.base_lines : state.data.base_files)
    : 0;

  // 逐提交累计（open/close 为每次提交前后的总量）
  const open = [], close = [];
  let cur = base;
  for (let i = 0; i < pts.length; i++) {
    open.push(cur);
    cur += addOf(pts[i]) - delOf(pts[i]);
    close.push(cur);
  }

  const bars = [];
  if (state.gran === 'day') {
    // 按本地日历日分组；一天一根柱，上下影取当日净变化轨迹（含日起点）的极值
    let day = null;
    for (let i = 0; i < pts.length; i++) {
      const dk = fmtDate(pts[i].time);
      if (dk !== day) {
        day = dk;
        bars.push({
          open: open[i], close: close[i],
          high: Math.max(open[i], close[i]), low: Math.min(open[i], close[i]),
          time: pts[i].time, addSum: 0, delSum: 0, merge: false,
          label: dk, pointIdxs: [],
        });
      }
      const b = bars[bars.length - 1];
      b.close = close[i];
      if (close[i] > b.high) b.high = close[i];
      if (close[i] < b.low) b.low = close[i];
      b.addSum += addOf(pts[i]);
      b.delSum += delOf(pts[i]);
      b.time = pts[i].time;
      b.pointIdxs.push(i);
    }
  } else {
    for (let i = 0; i < pts.length; i++) {
      bars.push({
        open: open[i], close: close[i],
        high: open[i] + addOf(pts[i]),   // 提交内先增后减的轨迹极值
        low: open[i] - delOf(pts[i]),
        time: pts[i].time,
        addSum: addOf(pts[i]), delSum: delOf(pts[i]),
        merge: pts[i].parents > 1,
        label: pts[i].subject, pointIdxs: [i],
      });
    }
  }
  const drawn = bars.map((b, i) => i).filter((i) => !state.skipMerge || !bars[i].merge);
  return { base, bars, drawn };
}

export function render(content) {
  if (state.lastRoot !== window.__rootStamp) {
    Object.assign(state, { data: null, ref: '', limit: 300, skipMerge: false, lastRoot: window.__rootStamp });
  }
  hoverIdx = null;
  pinnedIdx = null;
  zoom = null;
  drag = null;
  if (lastRO) { lastRO.disconnect(); lastRO = null; }
  content.innerHTML = '';
  const wrap = el('div', { class: 'charts-wrap' });
  content.append(wrap);

  // ---------------- 工具栏 ----------------
  const setMode = (m) => {
    if (state.mode === m) return;
    state.mode = m;
    segModeLine.classList.toggle('on', m === 'line');
    segModeCandle.classList.toggle('on', m === 'candle');
    hoverIdx = null; pinnedIdx = null;
    updateLegend();
    draw();
  };
  const setMetric = (m) => {
    if (state.metric === m) return;
    state.metric = m;
    segMetricLines.classList.toggle('on', m === 'lines');
    segMetricFiles.classList.toggle('on', m === 'files');
    hoverIdx = null; pinnedIdx = null;
    updateLegend();
    updateMeta();
    draw();
  };
  const setGran = (g) => {
    if (state.gran === g) return;
    state.gran = g;
    segGranCommit.classList.toggle('on', g === 'commit');
    segGranDay.classList.toggle('on', g === 'day');
    hoverIdx = null; pinnedIdx = null;
    zoom = null; // 索引空间变化，复位缩放
    mergeLabel.style.display = g === 'day' ? 'none' : ''; // 按天时合并已计入当日轨迹
    updateLegend();
    updateMeta();
    draw();
  };
  const resetZoom = () => { zoom = null; draw(); };
  const segModeLine = el('button', { class: `seg-btn${state.mode === 'line' ? ' on' : ''}`, onclick: () => setMode('line') }, icon('chart', 12), '折线');
  const segModeCandle = el('button', { class: `seg-btn${state.mode === 'candle' ? ' on' : ''}`, onclick: () => setMode('candle') }, icon('candle', 12), 'K线');
  const segMetricLines = el('button', { class: `seg-btn${state.metric === 'lines' ? ' on' : ''}`, onclick: () => setMetric('lines') }, icon('code', 12), '行数');
  const segMetricFiles = el('button', { class: `seg-btn${state.metric === 'files' ? ' on' : ''}`, onclick: () => setMetric('files') }, icon('file', 12), '文件数');
  const segGranCommit = el('button', { class: `seg-btn${state.gran === 'commit' ? ' on' : ''}`, onclick: () => setGran('commit') }, icon('commit', 12), '按提交');
  const segGranDay = el('button', { class: `seg-btn${state.gran === 'day' ? ' on' : ''}`, onclick: () => setGran('day') }, icon('history', 12), '按天');

  const branchItems = (refs) => {
    const items = [{ value: '', label: '当前分支' }];
    for (const b of (refs ? refs.locals : [])) items.push({ value: b.name, label: (b.is_head ? '✓ ' : '') + b.name });
    for (const t of (refs ? refs.tags : [])) items.push({ value: `refs/tags/${t.name}`, label: `🏷 ${t.name}` });
    return items;
  };
  const branchDd = dropdown({
    items: [], value: state.ref, placeholder: '当前分支', width: '170px',
    onChange: (v) => { state.ref = v; load(); },
  });
  api.gitRefs().then((refs) => branchDd.setItems(branchItems(refs))).catch(() => {});

  const rangeDd = dropdown({
    items: [100, 300, 600, 1000, 2000].map((n) => ({ value: String(n), label: `最近 ${n} 提交` }))
      .concat([{ value: '0', label: '全部提交' }]),
    value: String(state.limit), width: '130px',
    onChange: (v) => {
      const n = parseInt(v, 10);
      state.limit = Number.isNaN(n) ? 300 : n; // 0 = 全部提交
      load();
    },
  });

  const mergeCb = el('input', { type: 'checkbox' });
  mergeCb.checked = state.skipMerge;
  mergeCb.addEventListener('change', () => {
    state.skipMerge = mergeCb.checked;
    hoverIdx = null; pinnedIdx = null;
    zoom = null; // 索引空间变化，复位缩放
    updateLegend();
    updateMeta();
    draw();
  });
  const mergeLabel = el('label', { class: 'm-check', title: '隐藏合并提交的 K线（其净变化仍计入总量曲线）' }, mergeCb, '排除合并');

  const meta = el('span', { class: 'muted', style: { fontSize: '11.5px' } });
  const toolbar = el('div', { class: 'view-toolbar' },
    el('span', { class: 'vtitle' }, icon('chart', 15), '变更图表'),
    el('span', { class: 'sep' }),
    el('span', { class: 'seg-group' }, segModeLine, segModeCandle),
    el('span', { class: 'seg-group' }, segMetricLines, segMetricFiles),
    el('span', { class: 'seg-group' }, segGranCommit, segGranDay),
    el('span', { class: 'sep' }),
    icon('branch', 12), branchDd.el,
    rangeDd.el,
    mergeLabel,
    el('button', { class: 'btn ghost mini', title: '复位缩放（双击图表同效）', onclick: resetZoom }, icon('maximize', 12), '复位'),
    el('button', { class: 'btn ghost mini', title: '重新统计', onclick: () => load() }, icon('refresh', 12), '刷新'),
    el('span', { style: { flex: 1 } }),
    meta,
  );
  wrap.append(toolbar);
  mergeLabel.style.display = state.gran === 'day' ? 'none' : '';

  // ---------------- 图例 + 画布 ----------------
  const legend = el('div', { class: 'charts-legend' });
  const holder = el('div', { class: 'charts-holder' });
  const canvas = el('canvas');
  const tip = el('div', { class: 'chart-tip', style: { display: 'none' } });
  const hint = el('div', { class: 'empty-hint' });
  holder.append(canvas, tip, hint);
  wrap.append(el('div', { class: 'charts-body' }, legend, holder));
  const ctx = canvas.getContext('2d');

  function updateLegend() {
    legend.innerHTML = '';
    const unit = state.metric === 'lines' ? '行数' : '文件数';
    const sw = (color) => el('span', { class: 'sw', style: { background: color } });
    if (state.mode === 'line') {
      legend.append(
        el('span', {}, sw(C.accent), `当前总${unit}（随每次提交的增删上下波动）`),
      );
    } else if (state.gran === 'day') {
      legend.append(
        el('span', {}, sw(C.green), `当日总量上升`),
        el('span', {}, sw(C.red), `当日总量下降`),
        el('span', { class: 'muted' }, `实体 = 当日起→止总${unit} · 上下影 = 当日提交净变化轨迹的极值`),
      );
    } else {
      legend.append(
        el('span', {}, sw(C.green), `提交后总量上升`),
        el('span', {}, sw(C.red), `提交后总量下降`),
        el('span', { class: 'muted' }, `实体 = 提交前→后总${unit} · 上影 = 提交中最高 · 下影 = 提交中最低`),
      );
    }
    // 右侧：缩放状态与操作提示（由 draw() 更新文本）
    legend.append(el('span', { class: 'muted', id: 'charts-zoominfo' }));
  }

  function showHint(text) {
    hint.style.display = '';
    hint.innerHTML = '';
    hint.append(text);
  }
  function hideHint() { hint.style.display = 'none'; }

  function updateMeta() {
    const s = buildBars();
    const pts = points();
    if (!s.drawn.length) { meta.textContent = ''; return; }
    const unit = state.metric === 'lines' ? ' 行' : ' 个文件';
    const lastBar = s.bars[s.drawn[s.drawn.length - 1]];
    const lastPt = pts[lastBar.pointIdxs[lastBar.pointIdxs.length - 1]];
    const cur = lastBar.close;
    const net = cur - s.base;
    const cntHead = state.gran === 'day' ? `${s.drawn.length} 天（${pts.length} 提交）` : (
      state.skipMerge && s.drawn.length !== s.bars.length ? `${s.drawn.length}/${s.bars.length} 提交` : `${s.drawn.length} 提交`
    );
    // 带上最新提交号：切换分支时即使数值相同（如镜像分支），也能看出数据已切换
    meta.textContent = `${cntHead} · 最新 ${shortOid(lastPt.oid)} · 当前 ${fmtNum(cur)}${unit} · 期间 ${net >= 0 ? '+' : ''}${fmtNum(net)}${unit}`;
  }

  // ---------------- 数据加载 ----------------
  async function load() {
    state.loading = true;
    hoverIdx = null; pinnedIdx = null;
    zoom = null;
    tip.style.display = 'none';
    draw();
    try {
      state.data = await api.gitStats(state.limit, state.ref);
      state.loading = false;
      updateMeta();
      updateLegend();
      draw();
    } catch (e) {
      state.loading = false;
      state.data = null;
      updateMeta();
      showHint(`统计失败：${e.message}`);
    }
  }

  // ---------------- 绘制 ----------------
  function draw() {
    const rect = holder.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (rect.width < 10 || rect.height < 10) return;
    const pxW = Math.round(rect.width * dpr);
    const pxH = Math.round(rect.height * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    geom = null;

    const pts = points();
    if (state.loading) { showHint(el('div', {}, el('span', { class: 'spin', style: { fontSize: '22px', display: 'block', marginBottom: '6px' } }, '⠋'), '统计中…（逐提交计算差异，稍候）')); return; }
    const s = buildBars();
    if (!s.drawn.length) { showHint('暂无提交数据（空仓库 / 无匹配提交 / 已全部被合并过滤）'); return; }
    hideHint();

    const padL = 56, padR = 18, padT = 16, padB = 30;
    const W = rect.width - padL - padR;
    const H = rect.height - padT - padB;
    if (W < 30 || H < 30) return;
    const m = s.drawn.length;

    // 可见窗口（drawn 索引空间），clamp 到合法范围
    const minSpan = Math.min(MIN_SPAN, m);
    let z0 = 0, z1 = m;
    if (zoom) {
      let span = Math.max(minSpan, Math.min(m, zoom.z1 - zoom.z0));
      z0 = Math.max(0, Math.min(m - span, zoom.z0));
      z1 = z0 + span;
    }
    zoom = { z0, z1 };
    const span = z1 - z0;
    const cell = W / span;
    const x = (k) => padL + (k - z0 + 0.5) * cell;
    const kStart = Math.max(0, Math.floor(z0));
    const kEnd = Math.min(m - 1, Math.ceil(z1) - 1);
    const visCount = kEnd - kStart + 1;

    // y 范围：仅取可见柱的极值 + 8% 余量（非负）——缩放后自动适配纵向
    let lo = Infinity, hi = -Infinity;
    if (state.mode === 'candle') {
      for (let k = kStart; k <= kEnd; k++) {
        const b = s.bars[s.drawn[k]];
        if (b.low < lo) lo = b.low;
        if (b.high > hi) hi = b.high;
      }
    } else {
      for (let k = kStart; k <= kEnd; k++) {
        const b = s.bars[s.drawn[k]];
        if (b.close < lo) lo = b.close;
        if (b.close > hi) hi = b.close;
      }
    }
    let pad = (hi - lo) * 0.08;
    if (pad <= 0) pad = Math.max(1, hi * 0.02);
    const yMin = Math.max(0, lo - pad);
    const yMax = hi + pad;
    const y = (v) => padT + (yMax - v) / (yMax - yMin) * H;

    // 网格 + 刻度
    ctx.font = '10.5px Consolas, monospace';
    ctx.textBaseline = 'middle';
    const step = niceCeil((yMax - yMin) / 5);
    for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(padL + W, yy);
      ctx.stroke();
      ctx.fillStyle = C.faint;
      ctx.textAlign = 'right';
      ctx.fillText(fmtAxis(v), padL - 8, yy);
    }
    // x 轴时间标签
    ctx.textAlign = 'center';
    ctx.fillStyle = C.faint;
    const t0 = s.bars[s.drawn[kStart]].time, t1 = s.bars[s.drawn[kEnd]].time;
    const yearly = (t1 - t0) > 366 * 86400;
    const labelOf = (t) => {
      const d = new Date(t * 1000);
      if (yearly) return `${String(d.getFullYear()).slice(2)}-${p2(d.getMonth() + 1)}`;
      if (state.gran === 'day' && visCount <= 14) return fmtDate(t);
      return `${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    };
    const cols = Math.max(1, Math.floor(W / 110));
    const tick = Math.max(1, Math.ceil((visCount - 1) / cols));
    for (let k = kStart; k <= kEnd; k += tick) {
      ctx.fillText(labelOf(s.bars[s.drawn[k]].time), x(k), padT + H + 14);
    }

    // 数据序列
    if (state.mode === 'candle') drawCandles(s, x, y, kStart, kEnd, cell);
    else drawLine(s, x, y, kStart, kEnd, visCount, padT, H);

    // 悬停 / 固定的十字线 + 数值锚点
    const idx = pinnedIdx != null ? pinnedIdx : hoverIdx;
    if (idx != null && idx >= 0 && idx < s.bars.length) {
      const k = s.drawn.indexOf(idx);
      if (k >= kStart - 1 && k <= kEnd + 1) {
        const xx = Math.round(x(k)) + 0.5;
        if (xx >= padL && xx <= padL + W) {
          ctx.strokeStyle = pinnedIdx != null ? C.accent : 'rgba(154,163,178,.5)';
          ctx.lineWidth = pinnedIdx != null ? 1.4 : 1;
          ctx.setLineDash(pinnedIdx != null ? [] : [4, 3]);
          ctx.beginPath();
          ctx.moveTo(xx, padT);
          ctx.lineTo(xx, padT + H);
          ctx.stroke();
          ctx.setLineDash([]);
          // 当前值锚点：柱的起点 / 终点总量
          ctx.fillStyle = C.accent;
          for (const v of [s.bars[idx].open, s.bars[idx].close]) {
            ctx.beginPath();
            ctx.arc(xx, y(v), 2.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    geom = { padL, W, m, drawn: s.drawn.slice(), z0, z1 };

    // 缩放状态提示
    const zi = document.getElementById('charts-zoominfo');
    if (zi) {
      const unitWord = state.gran === 'day' ? '天' : '个提交';
      const range = span < m - 0.5
        ? `第 ${kStart + 1}–${kEnd + 1} / ${m} ${unitWord}`
        : `共 ${m} ${unitWord}`;
      zi.textContent = `${range} · 滚轮缩放 · 拖动平移 · 双击复位`;
    }
  }

  function drawCandles(s, x, y, kStart, kEnd, cell) {
    const bw = Math.max(1.5, Math.min(26, cell * 0.62));
    const wickW = Math.max(1, Math.min(2, cell * 0.16));
    for (let k = kStart; k <= kEnd; k++) {
      const b = s.bars[s.drawn[k]];
      const xx = x(k);
      const bull = b.close >= b.open;
      const col = bull ? C.green : C.red;
      // 影线：最高 → 最低
      ctx.lineWidth = wickW;
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(xx, y(b.high));
      ctx.lineTo(xx, y(b.low));
      ctx.stroke();
      // 实体：起点 → 终点的总量
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = col;
      const yO = y(b.open), yC = y(b.close);
      const top = Math.min(yO, yC);
      const h = Math.max(1.2, Math.abs(yC - yO));
      ctx.fillRect(xx - bw / 2, top, bw, h);
    }
    ctx.globalAlpha = 1;
  }

  function drawLine(s, x, y, kStart, kEnd, visCount, padT, H) {
    // 总量曲线 + 渐变面积（仅可见段）
    const grad = ctx.createLinearGradient(0, padT, 0, padT + H);
    grad.addColorStop(0, `${C.accent}30`);
    grad.addColorStop(1, `${C.accent}05`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x(kStart), padT + H);
    for (let k = kStart; k <= kEnd; k++) ctx.lineTo(x(k), y(s.bars[s.drawn[k]].close));
    ctx.lineTo(x(kEnd), padT + H);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = C.accent;
    ctx.lineWidth = visCount > 400 ? 1 : 1.8;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let k = kStart; k <= kEnd; k++) {
      const xx = x(k), yy = y(s.bars[s.drawn[k]].close);
      if (k === kStart) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
    // 点稀疏时画圆点
    if (visCount <= 120) {
      ctx.fillStyle = C.accent;
      for (let k = kStart; k <= kEnd; k++) {
        ctx.beginPath();
        ctx.arc(x(k), y(s.bars[s.drawn[k]].close), 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ---------------- 交互：缩放 / 平移 / 悬停 / 固定 ----------------
  function hitIndex(mx) {
    if (!geom) return null;
    const cellW = geom.W / (geom.z1 - geom.z0);
    const k = Math.round(geom.z0 + (mx - geom.padL) / cellW - 0.5);
    if (k < 0 || k >= geom.m) return null;
    if (k < Math.floor(geom.z0) || k > Math.ceil(geom.z1) - 1) return null;
    return geom.drawn[k];
  }

  /** 把可见窗口平移 dk（drawn 索引），clamp 到边界 */
  function panBy(dk) {
    if (!geom) return;
    const span = geom.z1 - geom.z0;
    let z0 = geom.z0 + dk;
    if (z0 < 0) z0 = 0;
    if (z0 + span > geom.m) z0 = geom.m - span;
    zoom = { z0, z1: z0 + span };
    draw();
  }

  function tooltipFor(i) {
    const s = buildBars();
    const b = s.bars[i];
    if (!b) return '';
    const pts = points();
    const unit = state.metric === 'lines' ? '行数' : '文件数';
    const net = b.close - b.open;
    if (state.gran === 'day') {
      const list = b.pointIdxs.slice(0, 6).map((pi) =>
        `${shortOid(pts[pi].oid)} ${escapeHtml(pts[pi].subject || '(无提交信息)')}`
      ).join('<br>');
      const more = b.pointIdxs.length > 6 ? `<br>…等共 ${b.pointIdxs.length} 个提交` : '';
      return `<div class="t-subject">${b.label}（${b.pointIdxs.length} 个提交）</div>
        <div class="t-meta">
          当日总${unit}：<b>${fmtNum(b.open)}</b> → <b>${fmtNum(b.close)}</b>（${net >= 0 ? '+' : ''}${fmtNum(net)}）<br>
          当日合计：<span style="color:${C.green}">+${fmtNum(b.addSum)}</span> / <span style="color:${C.red}">−${fmtNum(b.delSum)}</span> · 最高 ${fmtNum(b.high)} · 最低 ${fmtNum(b.low)}<br>
          ${list}${more}
        </div>`;
    }
    const pi = b.pointIdxs[0];
    const p = pts[pi];
    return `<div class="t-subject">${escapeHtml(p.subject) || '(无提交信息)'}</div>
      <div class="t-meta">
        ${shortOid(p.oid)} · ${escapeHtml(p.author)} · ${fmtDate(p.time)}${p.parents > 1 ? ' · <span style="color:var(--purple)">merge</span>' : ''}<br>
        当前总${unit}：<b>${fmtNum(b.open)}</b> → <b>${fmtNum(b.close)}</b>（${net >= 0 ? '+' : ''}${fmtNum(net)}）<br>
        本次变更：<span style="color:${C.green}">+${fmtNum(b.addSum)}</span> / <span style="color:${C.red}">−${fmtNum(b.delSum)}</span><br>
        文件：共 ${p.files_added + p.files_deleted + p.files_modified}（新 ${p.files_added} · 删 ${p.files_deleted} · 改 ${p.files_modified}）
      </div>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function placeTip(i, my) {
    if (i == null) { tip.style.display = 'none'; return; }
    tip.innerHTML = tooltipFor(i);
    tip.style.display = '';
    const rect = holder.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const k = geom ? geom.drawn.indexOf(i) : -1;
    let xx = rect.width / 2;
    if (geom && k >= 0) {
      const cellW = geom.W / (geom.z1 - geom.z0);
      xx = geom.padL + (k - geom.z0 + 0.5) * cellW;
      if (xx < geom.padL - 10 || xx > geom.padL + geom.W + 10) { tip.style.display = 'none'; return; }
    }
    let left = xx + 14;
    if (left + tw > rect.width - 8) left = xx - tw - 14;
    let top = Math.max(8, Math.min((my != null ? my : 20) - th / 2, rect.height - th - 8));
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${top}px`;
  }

  // 滚轮缩放：以鼠标位置为锚点
  canvas.addEventListener('wheel', (e) => {
    if (!geom) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const cellW = geom.W / (geom.z1 - geom.z0);
    const kA = geom.z0 + (e.clientX - r.left - geom.padL) / cellW - 0.5;
    const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    const minSpan = Math.min(MIN_SPAN, geom.m);
    let span = Math.max(minSpan, Math.min(geom.m, (geom.z1 - geom.z0) * factor));
    const ratio = (kA - geom.z0) / (geom.z1 - geom.z0);
    let z0 = kA - ratio * span;
    let z1 = z0 + span;
    if (z0 < 0) { z0 = 0; z1 = span; }
    if (z1 > geom.m) { z1 = geom.m; z0 = geom.m - span; }
    zoom = { z0, z1 };
    draw();
  }, { passive: false });

  // 拖拽平移（位移超过阈值判定为拖动，否则视为点击固定）
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !geom) return;
    drag = { downX: e.clientX, lastX: e.clientX, moved: false };
  });
  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    if (drag && geom) {
      const totalDx = e.clientX - drag.downX;
      if (!drag.moved && Math.abs(totalDx) > 4) {
        drag.moved = true;
        canvas.classList.add('panning');
        tip.style.display = 'none';
      }
      if (drag.moved) {
        const dx = e.clientX - drag.lastX;
        drag.lastX = e.clientX;
        const span = geom.z1 - geom.z0;
        panBy(-(dx / geom.W) * span);
      }
      return;
    }
    if (pinnedIdx != null) return;
    const i = hitIndex(e.clientX - r.left);
    hoverIdx = i;
    if (i == null) { tip.style.display = 'none'; }
    else placeTip(i, e.clientY - r.top);
    draw();
  });
  canvas.addEventListener('mouseup', (e) => {
    if (!drag) return;
    const wasMoved = drag.moved;
    drag = null;
    canvas.classList.remove('panning');
    if (wasMoved) return;
    // 视为点击：固定 / 解除
    const r = canvas.getBoundingClientRect();
    const i = hitIndex(e.clientX - r.left);
    if (i == null || pinnedIdx === i) {
      pinnedIdx = null;
      tip.style.display = 'none';
    } else {
      pinnedIdx = i;
      placeTip(i, e.clientY - r.top);
    }
    draw();
  });
  canvas.addEventListener('mouseleave', () => {
    drag = null;
    canvas.classList.remove('panning');
    if (pinnedIdx != null) return;
    hoverIdx = null;
    tip.style.display = 'none';
    draw();
  });
  // 双击复位缩放
  canvas.addEventListener('dblclick', () => { zoom = null; draw(); });

  // 尺寸变化时重绘
  lastRO = new ResizeObserver(() => draw());
  lastRO.observe(holder);

  updateLegend();
  updateMeta();
  if (state.data) draw();
  else load();
}
