// Git 历史：全分支提交图谱 + 提交详情 + 上下文操作
import { api } from '../api.js';
import { el, icon, contextMenu, formModal, confirmDlg, toast, errToast, fmtTime, shortOid, avatar } from '../ui.js';
import { computeLanes, renderGraphSvg } from '../gitlanes.js';

const state = {
  commits: [],
  loading: false,
  ref: '',
  limit: 400,
  selected: null,
  done: false,
};

export function render(content) {
  content.innerHTML = '';
  const wrap = el('div', { class: 'log-wrap' });
  content.append(wrap);

  // 工具栏
  const branchSel = el('select', { style: { maxWidth: '190px' }, onchange: () => { state.ref = branchSel.value; reload(); } });
  const search = el('input', {
    type: 'text', placeholder: '搜索提交信息 / 作者 / hash…', style: { width: '220px' },
    oninput: () => filterRows(),
  });
  const toolbar = el('div', { class: 'view-toolbar' },
    el('span', { class: 'vtitle' }, icon('history', 15), 'Git 历史'),
    el('span', { class: 'sep' }),
    icon('branch', 13), branchSel,
    search,
    el('span', { style: { flex: 1 } }),
    el('span', { id: 'log-count', class: 'muted', style: { fontSize: '11.5px' } }),
    el('button', { class: 'btn ghost mini', title: '刷新', onclick: reload }, icon('refresh', 13)),
  );
  wrap.append(toolbar);

  const main = el('div', { class: 'log-main' });
  wrap.append(main);

  const listPane = el('div', { class: 'log-list-pane' });
  const detail = el('div', { class: 'log-detail' },
    el('div', { class: 'empty-hint' }, el('span', { class: 'big' }, '⑂'), '点击一个提交查看变更详情'));
  main.append(listPane, detail);

  const rowsBox = el('div', { class: 'log-rows' });
  listPane.append(rowsBox);

  api.gitRefs().then((refs) => {
    branchSel.innerHTML = '';
    branchSel.append(el('option', { value: '', selected: state.ref === '' }, '全部分支'));
    for (const b of refs.locals) {
      branchSel.append(el('option', { value: b.name, selected: state.ref === b.name }, `${b.is_head ? '✓ ' : ''}${b.name}`));
    }
    for (const t of refs.tags) branchSel.append(el('option', { value: `refs/tags/${t.name}` }, `🏷 ${t.name}`));
  }).catch(() => {});

  rowsBox.addEventListener('scroll', () => {
    if (rowsBox.scrollTop + rowsBox.clientHeight > rowsBox.scrollHeight - 160 && !state.loading && !state.done) {
      fetchPage(false);
    }
  });

  reload();

  async function reload() {
    state.commits = [];
    state.done = false;
    rowsBox.innerHTML = '';
    rowsBox.append(el('div', { class: 'empty-hint' }, el('span', { class: 'spin' }, '⠋'), ' 正在加载提交历史…'));
    await fetchPage(true);
  }

  async function fetchPage(reset) {
    state.loading = true;
    try {
      const batch = await api.gitLog(state.limit, reset ? 0 : state.commits.length, state.ref);
      if (batch.length < state.limit) state.done = true;
      state.commits = reset ? batch : state.commits.concat(batch);
      if (!state.commits.length) {
        rowsBox.innerHTML = '';
        rowsBox.append(el('div', { class: 'empty-hint' }, el('span', { class: 'big' }, '∅'), '没有提交记录'));
        return;
      }
      draw();
    } catch (e) {
      rowsBox.innerHTML = '';
      rowsBox.append(el('div', { class: 'empty-hint' }, `加载失败：${e.message}`));
    } finally {
      state.loading = false;
    }
  }

  function draw() {
    rowsBox.innerHTML = '';
    const { rows, laneCount } = computeLanes(state.commits);
    const oidToRow = new Map();
    rows.forEach((r, i) => { if (!oidToRow.has(r.oid)) oidToRow.set(r.oid, i); });

    const graphSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    renderGraphSvg(graphSvg, rows, laneCount, oidToRow);
    const graphW = `${laneCount * 15 + 10}px`;

    rows.forEach((r, i) => {
      const badgeBox = el('span', { style: { display: 'inline-flex', gap: '4px', flex: '0 0 auto', maxWidth: '260px', overflow: 'hidden' } });
      for (const ref of [...(r.refs || [])].sort((a, b) => (a.kind === 'head' ? -1 : b.kind === 'head' ? 1 : 0)).slice(0, 4)) {
        badgeBox.append(el('span', { class: `badge ${ref.kind}` }, ref.name + (ref.current ? ' ✓' : '')));
      }
      const cells = el('div', { class: 'cells' },
        el('span', { class: 'cell-subject' },
          el('span', { class: 'oid' }, shortOid(r.oid)),
          badgeBox,
          el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, r.subject || '(无信息)'),
        ),
        el('span', { class: 'cell-author' }, avatar(r.author, 20), el('span', {}, r.author)),
        el('span', { class: 'cell-time' }, fmtTime(r.time)),
      );

      const row = el('div', { class: `log-row${state.selected === r.oid ? ' selected' : ''}`, dataset: { oid: r.oid } }, cells);
      const gcell = el('div', { class: 'log-graph', style: { width: graphW } });
      if (i === 0) gcell.append(graphSvg);
      row.prepend(gcell);

      row.addEventListener('click', () => {
        state.selected = r.oid;
        rowsBox.querySelectorAll('.log-row.selected').forEach((n) => n.classList.remove('selected'));
        row.classList.add('selected');
        showDetail(r, detail);
      });
      row.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        contextMenu(ev.clientX, ev.clientY, [
          { label: '复制 commit id', icon: 'copy', onClick: () => navigator.clipboard.writeText(r.oid).then(() => toast('已复制', 'ok')) },
          '-',
          { label: '在此创建分支…', icon: 'branch', onClick: () => branchHere(r) },
          { label: '检出此提交（detached HEAD）', icon: 'play', onClick: () => runOp({ op: 'checkout', target: r.oid }) },
          { label: 'Cherry-pick 此提交', icon: 'cherry', onClick: () => runOp({ op: 'cherry-pick', target: r.oid }) },
          { label: 'Revert 此提交（反向提交）', icon: 'revert', onClick: () => runOp({ op: 'revert', target: r.oid }) },
          '-',
          { label: 'Reset 当前分支到此…', icon: 'reset', danger: true, onClick: () => resetHere(r) },
        ]);
      });
      rowsBox.append(row);
    });
    document.getElementById('log-count').textContent =
      `${rows.length} 个提交${state.done ? '' : ' · 滚动加载更多'}`;
    filterRows();
  }

  function filterRows() {
    const q = search.value.trim().toLowerCase();
    rowsBox.querySelectorAll('.log-row').forEach((row) => {
      if (!q) { row.style.display = ''; return; }
      const r = state.commits.find((c) => c.oid === row.dataset.oid);
      const hay = r ? `${r.subject} ${r.author} ${r.oid}`.toLowerCase() : '';
      row.style.display = hay.includes(q) ? '' : 'none';
    });
  }

  async function showDetail(r, detail) {
    detail.innerHTML = '';
    detail.append(el('div', { class: 'empty-hint' }, el('span', { class: 'spin' }, '⠋'), ' 加载变更…'));
    try {
      const d = await api.gitCommit(r.oid);
      detail.innerHTML = '';
      detail.append(
        el('div', { class: 'commit-head' },
          el('h3', {}, d.commit.subject),
          el('div', { class: 'commit-meta' },
            avatar(d.commit.author, 24),
            el('span', {}, `${d.commit.author}`),
            el('span', { class: 'muted' }, `提交于 ${new Date(d.commit.time * 1000).toLocaleString()}`),
          ),
          el('div', { class: 'commit-meta', style: { marginTop: '8px' } },
            el('span', {
              class: 'oidbox', title: '点击复制完整 hash',
              onclick: () => navigator.clipboard.writeText(d.commit.oid).then(() => toast('已复制完整 hash', 'ok')),
            }, d.commit.oid),
            d.commit.parents.length ? el('span', { class: 'muted', style: { fontSize: '11px' } }, `父提交 ${d.commit.parents.map(shortOid).join(', ')}`) : null,
            el('span', { class: 'badge' }, `+${d.insertions}`),
            el('span', { class: 'badge' }, `−${d.deletions}`),
            el('span', { class: 'badge' }, `${d.files.length} 文件`),
          ),
        ),
      );
      const listBox = el('div', { class: 'detail-files' });
      detail.append(listBox);
      const diffBox = el('div', {});
      for (const f of d.files) {
        listBox.append(el('div', {
          class: 'detail-file',
          onclick: (e) => {
            listBox.querySelectorAll('.detail-file').forEach((n) => (n.style.background = ''));
            e.currentTarget.style.background = 'var(--active)';
            diffBox.innerHTML = '';
            diffBox.className = 'diff-box';
            diffBox.append(Object.assign(el('pre', {}), { innerHTML: renderPatch(f.patch) }));
          },
        },
        el('span', { class: `chg-${f.change}` }, f.change),
        el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          f.old_path ? `${f.old_path} → ${f.path}` : f.path),
        el('span', { class: 'muted', style: { fontSize: '10.5px', marginLeft: 'auto' } }, `+${f.additions} −${f.deletions}`),
        ));
      }
      detail.append(diffBox);
    } catch (e) {
      detail.innerHTML = '';
      detail.append(el('div', { class: 'empty-hint' }, e.message));
    }
  }

  function renderPatch(patch) {
    if (!patch) return '<div class="empty-hint">（二进制文件或无差异）</div>';
    return patch.split('\n').map((line) => {
      if (/^(\+\+\+|---|diff |index )/.test(line)) return `<div class="dl-meta">${esc(line)}</div>`;
      if (line.startsWith('@@')) return `<div class="dl-hunk">${esc(line)}</div>`;
      if (line.startsWith('+')) return `<div class="dl-add">${esc(line)}</div>`;
      if (line.startsWith('-')) return `<div class="dl-del">${esc(line)}</div>`;
      return esc(line);
    }).join('');
  }
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function branchHere(r) {
  const res = await formModal({
    title: '在此提交上创建分支',
    icon: 'branch',
    fields: [{ key: 'name', label: `分支名（起点 ${shortOid(r.oid)}）`, placeholder: 'feature/new-thing' }],
    okText: '创建',
  });
  if (!res || !res.name) return;
  runOp({ op: 'branch', action: 'create', name: res.name, start: r.oid });
}

async function resetHere(r) {
  const res = await formModal({
    title: `Reset ${shortOid(r.oid)}`,
    icon: 'reset',
    fields: [
      { key: 'mode', type: 'select', label: '模式', value: 'mixed', options: [
        { value: 'soft', label: 'soft — 保留改动在暂存区' },
        { value: 'mixed', label: 'mixed — 保留改动在工作区' },
        { value: 'hard', label: 'hard — 完全丢弃（危险）' },
      ] },
    ],
    okText: '重置',
    danger: true,
  });
  if (!res) return;
  if (res.mode === 'hard') {
    const ok = await confirmDlg('hard reset 将丢弃目标之后的提交改动，且不可轻易恢复。继续？', '确认 hard reset');
    if (!ok) return;
  }
  runOp({ op: 'reset', mode: res.mode, target: r.oid });
}

async function runOp(payload) {
  try {
    const r = await api.gitAction(payload);
    if (r.conflict) {
      toast(`操作完成但有冲突：${r.conflicts.length} 个文件需要解决。\n请前往「Git 工作区」处理。`, 'err');
    } else if (r.ok) {
      toast(`✓ ${payload.op} 成功`, 'ok');
    } else {
      toast(`${payload.op} 失败：\n${r.output}`, 'err');
    }
    window.CodeView.gitChanged();
  } catch (e) { errToast(e); }
}
