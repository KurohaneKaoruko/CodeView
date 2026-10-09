// Git 管理：树状提交图（滚动） + 工作区操作 同屏；抽屉式详情；横向大型自由视图
import { api } from '../api.js?v=3';
import {
  el, icon, contextMenu, popoverInput, confirmDlg, formModal, toast, errToast,
  fmtTime, shortOid, avatar, renderDiffRows, dropdown,
} from '../ui.js?v=3';
import { layoutGraph } from '../gitlanes.js?v=3';
import { createCommitGraph, hideGraphTooltip } from '../gitgraph.js?v=3';

const state = {
  // 历史
  commits: [], ref: '', limit: 600, done: false, selected: null,
  // 工作区
  status: null, refs: null, output: '', selectedDiff: null,
  // 布局
  large: false, workOpen: false,
  grp: { staged: true, changes: true, untracked: true, branches: false, console: true },
  lastRoot: null,
};

export function render(content) {
  if (state.lastRoot !== window.__rootStamp) {
    Object.assign(state, {
      commits: [], ref: '', limit: 600, done: false, selected: null,
      status: null, refs: null, output: '', selectedDiff: null,
      large: false, workOpen: false,
      grp: { staged: true, changes: true, untracked: true, branches: false, console: true },
      lastRoot: window.__rootStamp,
    });
  }
  content.innerHTML = '';
  const wrap = el('div', { class: 'mgmt-wrap' });
  content.append(wrap);

  // 供快捷按钮使用的工具函数（须在任何构建调用之前）
  const currentBranch = () => window.__refsCache?.locals?.find((b) => b.is_head)?.name || '';
  const modeLabel = (m) => ({ merge: 'merge 合并', rebase: 'rebase 变基', 'ff-only': 'ff-only 仅快进' }[m] || m);

  // ---------------- 工具栏 ----------------
  const branchItems = (refs) => {
    const items = [{ value: '', label: '全部分支' }];
    for (const b of (refs ? refs.locals : [])) items.push({ value: b.name, label: (b.is_head ? '✓ ' : '') + b.name });
    for (const t of (refs ? refs.tags : [])) items.push({ value: `refs/tags/${t.name}`, label: `🏷 ${t.name}` });
    return items;
  };
  const branchDd = dropdown({
    items: [], value: state.ref, placeholder: '全部分支', width: '180px',
    onChange: (v) => { state.ref = v; state.limit = 600; refreshLog(); },
  });
  api.gitRefs().then((refs) => branchDd.setItems(branchItems(refs))).catch(() => {});
  const search = el('input', {
    type: 'text', placeholder: '搜索提交 / 作者 / hash', style: { width: '200px' },
    oninput: () => highlightSearch(),
  });
  const countLabel = el('span', { class: 'muted', style: { fontSize: '11.5px' } });
  const largeBtn = el('button', {
    class: 'btn ghost mini', title: '打开横向大型分支视图（可缩放平移）',
    onclick: () => setLarge(true),
  }, icon('maximize', 13), '大型视图');
  // 工作面板开关（默认收起，从左侧展开）
  const workToggle = el('button', {
    class: 'btn ghost mini', title: '更改面板（提交 / 暂存 / 分支）',
    onclick: () => { state.workOpen = !state.workOpen; layoutWork(); },
  }, icon('panel-left', 13), '更改', el('span', { class: 'scm-badge', id: 'work-badge', style: { display: 'none' } }, '0'));
  const toolbar = el('div', { class: 'view-toolbar' },
    workToggle,
    el('span', { class: 'sep' }),
    el('span', { class: 'vtitle' }, icon('branch', 15), 'Git 管理'),
    el('span', { class: 'sep' }),
    icon('branch', 12), branchDd.el,
    search,
    el('span', { class: 'sep' }),
    el('button', { class: 'btn ghost mini', title: '从远程拉取（不合并）', onclick: () => runQuick({ op: 'fetch', remote: 'origin', prune: true }, 'Fetch') }, icon('arrow-down', 12), 'Fetch'),
    quickPullBtn(),
    quickPushBtn(),
    el('span', { class: 'sep' }),
    largeBtn,
    el('button', { class: 'btn ghost mini', id: 'mgmt-more-btn', title: '加载更多提交', onclick: loadMore }, icon('plus', 12), '更多'),
    el('span', { style: { flex: 1 } }),
    countLabel,
    el('button', { class: 'btn ghost mini', title: '刷新', onclick: refreshAll }, icon('refresh', 13)),
  );
  wrap.append(toolbar);

  // ---------------- 冲突横幅 ----------------
  const bannerHost = el('div', {});
  wrap.append(bannerHost);

  // ---------------- 主区：图 + 工作面板 ----------------
  const main = el('div', { class: 'mgmt-main' });
  wrap.append(main);

  const graphPane = el('div', { class: 'graph-pane' });
  const graph = createCommitGraph(graphPane, {
    onNodeClick: (row) => { state.selected = row.oid; showCommitDetail(row); },
    onNodeMenu: (row, x, y) => nodeMenu(row, x, y, 'normal'),
  });
  const workPanel = el('div', { class: 'work-panel' });

  // 抽屉（从右侧滑出的详情 / diff）
  const drawer = el('div', { class: 'mgmt-drawer' },
    el('div', { class: 'drawer-h' },
      el('span', { class: 'drawer-title' }),
      el('span', { style: { flex: 1 } }),
      el('button', { class: 'btn mini ghost', onclick: closeDrawer }, icon('x', 12), '关闭')),
    el('div', { class: 'drawer-b' }));

  // 布局：工作面板在左，图在右，抽屉覆盖在右侧
  main.append(workPanel);
  main.append(graphPane);
  main.append(drawer);
  main.append(drawer);

  function openDrawer(title, build) {
    drawer.querySelector('.drawer-title').innerHTML = '';
    drawer.querySelector('.drawer-title').append(...(Array.isArray(title) ? title : [title]));
    const body = drawer.querySelector('.drawer-b');
    body.innerHTML = '';
    build(body);
    drawer.classList.add('open');
  }
  function closeDrawer() { drawer.classList.remove('open'); }

  // ---------------- 大型视图（横向自由画布） ----------------
  let largeHost = null;
  function setLarge(on) {
    state.large = on;
    largeBtn.classList.toggle('primary', on);
    if (!on) {
      if (largeHost) { largeHost.remove(); largeHost = null; }
      return;
    }
    largeHost = el('div', { class: 'large-overlay' },
      el('div', { class: 'view-toolbar' },
        el('span', { class: 'vtitle' }, icon('maximize', 14), '大型分支视图（横向）'),
        el('span', { class: 'muted', style: { fontSize: '11.5px' } }, '滚轮缩放 · 拖拽平移 · 右键节点就地操作 · 点击节点弹详情'),
        el('span', { style: { flex: 1 } }),
        el('button', {
          class: 'btn mini', title: '适应画布',
          onclick: () => freeGraph && freeGraph.fit(),
        }, icon('disc', 12), '适应'),
        el('button', { class: 'btn mini primary', onclick: () => setLarge(false) }, icon('minimize', 12), '退出大型视图'),
      ),
    );
    const freePane = el('div', { class: 'free-graph' });
    largeHost.append(freePane);
    wrap.append(largeHost);
    const freeGraph = createCommitGraph(freePane, {
      mode: 'free',
      orientation: 'horizontal',
      onNodeClick: (row, x, y) => { state.selected = row.oid; showCommitPopup(row, x, y); },
      onNodeMenu: (row, x, y) => nodeMenu(row, x, y, 'large'),
    });
    freeGraph.setData(layoutGraph(state.commits));
    setTimeout(() => freeGraph.fit(), 60);
  }

  // ---------------- 数据加载 ----------------
  api.gitRefs().then((refs) => branchDd.setItems(branchItems(refs))).catch(() => {});

  refreshLog();
  refreshWork();

  window.CodeView._workRefresh = () => { refreshWork(); refreshLog(); };

  async function refreshLog() {
    state.done = false;
    const batch = await api.gitLog(state.limit, 0, state.ref).catch(() => []);
    if (batch.length < state.limit) state.done = true;
    state.commits = batch;
    drawGraph();
  }

  async function loadMore() {
    const batch = await api.gitLog(state.limit, state.commits.length, state.ref).catch(() => []);
    if (batch.length < state.limit) state.done = true;
    state.commits = state.commits.concat(batch);
    drawGraph();
  }

  function drawGraph() {
    if (!state.commits.length) {
      graph.setData({ rows: [], laneCount: 1 });
      countLabel.textContent = '没有提交';
      return;
    }
    graph.setData(layoutGraph(state.commits));
    countLabel.textContent = `${state.commits.length} 个提交${state.done ? '' : ' · 点「加载更多」延伸'}`;
    const moreBtn = document.getElementById('mgmt-more-btn');
    if (moreBtn) moreBtn.disabled = state.done;
    highlightSearch();
  }

  function highlightSearch() {
    const q = search.value.trim().toLowerCase();
    if (!q) return;
    const hit = state.commits.find((c) => `${c.subject} ${c.author} ${c.oid}`.toLowerCase().includes(q));
    if (hit && state.selected !== hit.oid) {
      state.selected = hit.oid;
      graph.draw();
    }
  }

  async function refreshWork() {
    try {
      [state.status, state.refs] = await Promise.all([api.gitStatus(), api.gitRefs()]);
    } catch (e) {
      workPanel.innerHTML = '';
      workPanel.append(el('div', { class: 'empty-hint' }, `工作区加载失败：${e.message}`));
      return;
    }
    drawWork();
    drawBanner();
  }

  // ---------------- 冲突横幅 ----------------
  function drawBanner() {
    bannerHost.innerHTML = '';
    const st = state.status;
    if (!st || (!st.in_progress && !st.conflicted.length)) return;
    bannerHost.append(el('div', { class: 'conflict-banner' },
      el('span', { class: 'title' }, icon('warn', 17), `${opLabel(st.in_progress)} 进行中`),
      st.conflicted.length
        ? el('span', { class: 'muted' }, `${st.conflicted.length} 个冲突文件：`)
        : el('span', { class: 'muted' }, '冲突已标记，可以继续'),
      ...st.conflicted.slice(0, 8).map((p) =>
        el('span', {
          class: 'chip', title: '点击在编辑器中打开，解决后标记已解决',
          onclick: () => window.CodeView.openFile(p),
        }, p)),
      el('span', { style: { flex: 1 } }),
      st.conflicted.length ? el('button', { class: 'btn mini', onclick: markAllResolved }, icon('check', 12), '全部标记已解决') : null,
      el('button', { class: 'btn primary mini', onclick: doContinue }, icon('play', 12), '继续'),
      el('button', { class: 'btn danger mini', onclick: doAbort }, icon('x', 12), '中止'),
    ));
  }

  // ---------------- 工作面板（左侧、可收起、紧凑 SCM 列表） ----------------
  function layoutWork() {
    workPanel.classList.toggle('open', state.workOpen);
    workToggle.classList.toggle('primary', state.workOpen);
  }

  function updateBadge() {
    const st = state.status;
    const n = st ? st.staged.length + st.unstaged.length + st.untracked.length + st.conflicted.length : 0;
    const badge = document.getElementById('work-badge');
    if (badge) {
      badge.textContent = String(n);
      badge.style.display = n > 0 ? '' : 'none';
    }
  }

  function drawWork() {
    workPanel.innerHTML = '';
    updateBadge();
    const st = state.status;
    if (!st) return;
    const panel = el('div', { class: 'work-left' });
    const grp = state.grp;

    // 紧凑提交栏
    const msg = el('textarea', { rows: 2, placeholder: '提交信息 (Ctrl+Enter 提交)…', style: { width: '100%', resize: 'vertical' } });
    const amend = el('input', { type: 'checkbox' });
    const doCommit = async () => {
      if (!msg.value.trim() && !amend.checked) { toast('请填写提交信息', 'err'); return; }
      try {
        const r = await api.gitCommitMsg(msg.value, amend.checked);
        showOut(r);
        if (r.ok) { msg.value = ''; amend.checked = false; toast('✓ 提交成功', 'ok'); }
        refreshAll();
      } catch (e) { errToast(e); }
    };
    msg.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doCommit();
    });
    panel.append(el('div', { class: 'scm-commit' },
      msg,
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' } },
        el('label', { class: 'm-check' }, amend, el('span', {}, 'amend')),
        el('span', { style: { flex: 1 } }),
        el('button', { class: 'btn primary mini', onclick: doCommit }, icon('check', 12), '✓ 提交'),
      ),
    ));

    // 紧凑 SCM 分组
    const scmGroup = (key, title, files, staged, headAct, rowActs) => {
      const open = !!grp[key];
      const head = el('div', { class: 'scm-head' },
        el('span', { class: `caret${open ? ' open' : ''}` }, icon('chev-right', 10)),
        el('span', { class: 't' }, title),
        el('span', { class: 'count' }, files.length),
        el('span', { style: { flex: 1 } }),
        headAct || null,
      );
      head.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        grp[key] = !open;
        drawWork();
      });
      const rowsBox = el('div', {});
      if (open) {
        if (!files.length) rowsBox.append(el('div', { class: 'scm-empty' }, '（空）'));
        for (const f of files) {
          rowsBox.append(el('div', { class: 'scm-row' },
            el('span', { class: `chg-${f.code}`, style: { fontWeight: 700 } }, f.code),
            el('span', {
              class: 'path', title: '点击查看差异',
              onclick: () => { state.selectedDiff = { path: f.path, staged }; showWorkDiff(); },
            }, f.path),
            el('span', { class: 'acts' }, rowActs(f)),
          ));
        }
      }
      return el('div', { class: 'scm-group' }, head, rowsBox);
    };

    panel.append(
      scmGroup('staged', '暂存的更改', st.staged, true,
        el('button', { class: 'icon-btn', title: '全部取消暂存', onclick: () => act(() => api.gitUnstage([])) }, icon('revert', 12)),
        (f) => el('button', { class: 'icon-btn', title: '取消暂存', onclick: () => act(() => api.gitUnstage([f.path])) }, icon('x', 11)),
      ),
      scmGroup('changes', '更改', st.unstaged, false,
        el('button', { class: 'icon-btn', title: '全部暂存', onclick: () => act(() => api.gitStage([])) }, icon('plus', 12)),
        (f) => [
          el('button', { class: 'icon-btn', title: '暂存', onclick: () => act(() => api.gitStage([f.path])) }, icon('plus', 11)),
          el('button', { class: 'icon-btn danger', title: '丢弃改动', onclick: () => discardOne(f) }, icon('revert', 11)),
        ],
      ),
      scmGroup('untracked', '未跟踪', st.untracked, false,
        el('button', { class: 'icon-btn', title: '全部暂存', onclick: () => act(() => api.gitStage([])) }, icon('plus', 12)),
        (f) => el('button', { class: 'icon-btn', title: '加入版本控制', onclick: () => act(() => api.gitStage([f.path])) }, icon('plus', 11)),
      ),
    );

    // 分支（可折叠）
    const refs = state.refs;
    if (refs && refs.locals.length) {
      const open = !!grp.branches;
      const head = el('div', { class: 'scm-head' },
        el('span', { class: `caret${open ? ' open' : ''}` }, icon('chev-right', 10)),
        el('span', { class: 't' }, '分支'),
        el('span', { class: 'count' }, refs.locals.length),
        el('span', { style: { flex: 1 } }),
        el('button', { class: 'icon-btn', title: '新建分支', onclick: modalBranchNew }, icon('plus', 12)),
      );
      head.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        grp.branches = !open;
        drawWork();
      });
      const rowsBox = el('div', {});
      if (open) {
        for (const b of refs.locals) {
          rowsBox.append(el('div', { class: 'scm-row' },
            el('span', { style: { color: b.is_head ? 'var(--green)' : 'var(--fg-faint)' } }, b.is_head ? '✓' : '○'),
            el('span', {
              class: 'path', style: { cursor: b.is_head ? 'default' : 'pointer' },
              title: b.is_head ? '' : '点击切换',
              onclick: b.is_head ? null : () => run({ op: 'checkout', branch: b.name }),
            }, b.name),
            b.upstream ? el('span', { class: 'muted', style: { fontSize: '10px' } }, `↑${b.ahead ?? 0}↓${b.behind ?? 0}`) : null,
          ));
        }
      }
      panel.append(el('div', { class: 'scm-group' }, head, rowsBox));
    }

    // 历史类操作（低频，收进一行小按钮）
    panel.append(el('div', { class: 'work-actions', style: { padding: '8px 10px' } },
      el('button', { class: 'btn mini ghost', onclick: modalMerge }, icon('merge', 12), 'Merge'),
      el('button', { class: 'btn mini ghost', onclick: modalRebase }, icon('history', 12), 'Rebase'),
      el('button', { class: 'btn mini ghost', onclick: modalReset }, icon('reset', 12), 'Reset'),
      el('button', { class: 'btn mini ghost', onclick: modalStashPush }, icon('stash', 12), 'Stash'),
      el('button', { class: 'btn mini ghost', onclick: loadStash }, icon('dots', 12), '列表'),
    ));
    panel.append(el('div', { id: 'stash-list' }));

    // 输出（有内容才显示，可折叠）
    if (state.output) {
      const open = !!grp.console;
      const head = el('div', { class: 'scm-head' },
        el('span', { class: `caret${open ? ' open' : ''}` }, icon('chev-right', 10)),
        el('span', { class: 't' }, '操作输出'),
        el('span', { style: { flex: 1 } }),
        el('button', { class: 'icon-btn', title: '清空', onclick: () => { state.output = ''; drawWork(); } }, icon('x', 11)),
      );
      head.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        grp.console = !open;
        drawWork();
      });
      const rowsBox = el('div', {});
      if (open) rowsBox.append(el('pre', { class: 'console', style: { border: 'none', borderRadius: 0, maxHeight: '200px', margin: 0 } }, state.output));
      panel.append(el('div', { class: 'scm-group' }, head, rowsBox));
    }

    workPanel.append(panel);
    if (state.workOpen) workPanel.classList.add('open');
  }

  function showOut(r) {
    state.output = `[${r.op}] ${r.ok ? '成功' : `失败 (exit ${r.code})`}\n${r.output || '(无输出)'}${r.conflict ? `\n⚠ 检测到 ${r.conflicts.length} 个冲突文件` : ''}`;
    drawWork();
  }

  // ---------------- 抽屉：工作区 diff ----------------
  async function showWorkDiff() {
    if (!state.selectedDiff) return;
    const { path, staged } = state.selectedDiff;
    openDrawer([icon('code', 13), `${staged ? '[暂存区] ' : ''}${path}`], async (body) => {
      body.append(el('div', { class: 'empty-hint' }, el('span', { class: 'spin' }, '⠋'), ' 加载差异…'));
      try {
        const patch = await api.gitFileDiff(path, staged);
        body.innerHTML = '';
        if (!patch.trim()) {
          body.append(el('div', { class: 'empty-hint' }, '（无差异，可能是新文件）'));
        } else {
          const box = el('div', { class: 'diff-box', style: { margin: '10px', maxHeight: 'none' } });
          box.append(renderDiffRows(patch, {
            onOpenLine: (ln) => window.CodeView.openFileAt(path, ln),
          }));
          body.append(box);
        }
      } catch (e) {
        body.innerHTML = '';
        body.append(el('div', { class: 'empty-hint' }, e.message));
      }
    });
  }

  // ---------------- 抽屉：提交详情 ----------------
  async function showCommitDetail(row) {
    openDrawer([icon('commit', 13), `${row.subject || '(无信息)'}`, el('span', { class: 'muted mono', style: { fontSize: '11px', marginLeft: '8px' } }, shortOid(row.oid))], async (body) => {
      body.append(el('div', { class: 'empty-hint' }, el('span', { class: 'spin' }, '⠋'), ' 加载变更…'));
      try {
        const d = await api.gitCommit(row.oid);
        body.innerHTML = '';
        body.append(
          el('div', { class: 'commit-head' },
            el('div', { class: 'commit-meta' },
              avatar(d.commit.author, 24),
              el('span', {}, `${d.commit.author}`),
              el('span', { class: 'muted' }, `提交于 ${new Date(d.commit.time * 1000).toLocaleString()}`),
              el('span', {
                class: 'oidbox', title: '点击复制完整 hash',
                onclick: () => navigator.clipboard.writeText(d.commit.oid).then(() => toast('已复制完整 hash', 'ok')),
              }, d.commit.oid),
              el('span', { class: 'badge' }, `+${d.insertions}`),
              el('span', { class: 'badge' }, `−${d.deletions}`),
              el('span', { class: 'badge' }, `${d.files.length} 文件`),
            ),
          ),
        );
        const listBox = el('div', { class: 'detail-files' });
        body.append(listBox);
        for (const f of d.files) {
          listBox.append(el('div', {
            class: 'detail-file',
            onclick: (e) => {
              listBox.querySelectorAll('.detail-file').forEach((n) => (n.style.background = ''));
              e.currentTarget.style.background = 'var(--active)';
              openDrawer([icon('code', 13), f.path, el('button', { class: 'btn mini ghost', onclick: () => showCommitDetail(row) }, '← 返回详情')], (b2) => {
                b2.append(el('div', { class: 'diff-box', style: { margin: '10px' } },
                  renderDiffRows(f.patch, {
                    onOpenLine: f.change !== 'D' ? (ln) => window.CodeView.openFileAt(f.path, ln) : null,
                  })));
              });
            },
          },
          el('span', { class: `chg-${f.change}` }, f.change),
          el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            f.old_path ? `${f.old_path} → ${f.path}` : f.path),
          el('span', { class: 'muted', style: { fontSize: '10.5px', marginLeft: 'auto' } }, `+${f.additions} −${f.deletions}`),
          ));
        }
      } catch (e) {
        body.innerHTML = '';
        body.append(el('div', { class: 'empty-hint' }, e.message));
      }
    });
  }

  // ---------------- 大型视图：提交信息弹窗 ----------------
  let activePopupEl = null;
  function closeActivePopup() {
    if (activePopupEl) {
      activePopupEl.remove();
      activePopupEl = null;
    }
  }
  function showCommitPopup(row, x, y) {
    closeActivePopup();
    const body = el('div', { class: 'popup-b' });
    const pop = el('div', { class: 'commit-popup' },
      el('div', { class: 'card-h' },
        icon('commit', 13),
        el('span', { style: { textTransform: 'none', letterSpacing: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          row.subject || '(无信息)'),
        el('span', { style: { flex: 1 } }),
        el('button', { class: 'icon-btn', onclick: closeActivePopup }, icon('x', 12))),
      body,
    );
    activePopupEl = pop;
    body.append(el('div', { class: 'empty-hint' }, el('span', { class: 'spin' }, '⠋'), ' 加载…'));
    document.body.append(pop);
    const pw = 460;
    pop.style.width = `${pw}px`;
    pop.style.left = `${Math.max(8, Math.min(x - pw / 2, innerWidth - pw - 8))}px`;
    pop.style.top = `${Math.min(y + 16, Math.max(8, innerHeight - 420))}px`;

    const outside = (e) => { if (activePopupEl && !activePopupEl.contains(e.target)) closeActivePopup(); };
    const onKey = (e) => { if (e.key === 'Escape') closeActivePopup(); };
    setTimeout(() => {
      document.addEventListener('mousedown', outside, true);
      document.addEventListener('keydown', onKey);
    }, 0);

    const renderList = (d) => {
      body.innerHTML = '';
      body.append(
        el('div', { class: 'commit-meta', style: { padding: '10px 12px 4px' } },
          avatar(d.commit.author, 20),
          el('span', {}, d.commit.author),
          el('span', { class: 'muted' }, new Date(d.commit.time * 1000).toLocaleString()),
          el('span', {
            class: 'oidbox', onclick: () => navigator.clipboard.writeText(d.commit.oid).then(() => toast('已复制', 'ok')),
          }, shortOid(d.commit.oid)),
        ),
      );
      const listBox = el('div', { style: { padding: '4px 8px 10px' } });
      for (const f of d.files) {
        listBox.append(el('div', {
          class: 'detail-file',
          onclick: (e) => {
            listBox.querySelectorAll('.detail-file').forEach((n) => (n.style.background = ''));
            e.currentTarget.style.background = 'var(--active)';
            body.innerHTML = '';
            body.append(
              el('div', { style: { padding: '6px 12px', display: 'flex', gap: '8px', alignItems: 'center' } },
                el('button', { class: 'btn mini ghost', onclick: () => renderList(d) }, '← 文件列表'),
                el('span', { class: 'mono muted', style: { fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis' } }, f.path)),
              el('div', { class: 'diff-box', style: { margin: '0 10px 10px', maxHeight: '46vh' } },
                renderDiffRows(f.patch, {
                  onOpenLine: f.change !== 'D' ? (ln) => window.CodeView.openFileAt(f.path, ln) : null,
                })),
            );
          },
        },
        el('span', { class: `chg-${f.change}` }, f.change),
        el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, f.path),
        el('span', { class: 'muted', style: { fontSize: '10.5px', marginLeft: 'auto' } }, `+${f.additions} −${f.deletions}`),
        ));
      }
      if (!d.files.length) listBox.append(el('div', { class: 'muted', style: { padding: '4px 10px' } }, '（无变更文件）'));
      body.append(listBox);
    };

    (async () => {
      try {
        const d = await api.gitCommit(row.oid);
        renderList(d);
      } catch (e) {
        body.innerHTML = '';
        body.append(el('div', { class: 'empty-hint' }, e.message));
      }
    })();
  }

  // ---------------- 节点右键菜单 ----------------
  function nodeMenu(row, x, y, mode) {
    const headRefs = (row.refs || []).filter((r) => r.kind === 'head');
    const items = [
      { label: `复制 commit id (${shortOid(row.oid)})`, icon: 'copy', onClick: () => navigator.clipboard.writeText(row.oid).then(() => toast('已复制', 'ok')) },
      '-',
      { label: '设为对比 A（基准端）', icon: 'compare', onClick: () => window.CodeView.setCompareA(row.oid) },
      { label: '设为对比 B（目标端）', icon: 'compare', onClick: () => window.CodeView.setCompareB(row.oid) },
      '-',
      { label: '在此创建分支…', icon: 'branch', onClick: () => popoverInput(x, y, {
        label: `新分支名（起点 ${shortOid(row.oid)}，创建后切换）`,
        placeholder: 'feature/my-branch',
        okText: '创建',
        onOk: (name) => runOp({ op: 'checkout', new_branch: true, target: name, start: row.oid }),
      }) },
      { label: '检出此提交（detached）', icon: 'play', onClick: () => runOp({ op: 'checkout', target: row.oid }) },
      { label: 'Cherry-pick 此提交到当前分支', icon: 'cherry', onClick: () => runOp({ op: 'cherry-pick', target: row.oid }) },
      { label: 'Revert 此提交（生成反向提交）', icon: 'revert', onClick: () => runOp({ op: 'revert', target: row.oid }) },
      '-',
      { label: 'Reset 当前分支到此 · soft（保留在暂存区）', icon: 'reset', onClick: () => runOp({ op: 'reset', mode: 'soft', target: row.oid }) },
      { label: 'Reset 当前分支到此 · mixed（保留在工作区）', icon: 'reset', onClick: () => runOp({ op: 'reset', mode: 'mixed', target: row.oid }) },
      { label: 'Reset 当前分支到此 · hard（丢弃，危险）', icon: 'reset', danger: true, onClick: async () => {
        if (await confirmDlg(`hard reset 将丢弃 ${shortOid(row.oid)} 之后当前分支上的提交改动，且不易恢复。继续？`, '确认 hard reset')) {
          runOp({ op: 'reset', mode: 'hard', target: row.oid });
        }
      } },
    ];
    for (const h of headRefs) {
      if (h.current) continue;
      items.push('-');
      items.push({ label: `检出分支 ${h.name}`, icon: 'play', onClick: () => runOp({ op: 'checkout', branch: h.name }) });
      items.push({ label: `合并 ${h.name} → 当前分支`, icon: 'merge', onClick: () => runOp({ op: 'merge', target: h.name }) });
      items.push({ label: `变基：当前分支变基到 ${h.name}`, icon: 'history', onClick: () => runOp({ op: 'rebase', target: h.name }) });
      items.push({ label: `重命名分支 ${h.name}…`, icon: 'edit', onClick: () => popoverInput(x, y, {
        label: `${h.name} 的新名字`, value: h.name, okText: '重命名',
        onOk: (newName) => runOp({ op: 'branch', action: 'rename', name: h.name, start: newName }),
      }) });
      items.push({ label: `删除分支 ${h.name}`, icon: 'trash', danger: true, onClick: async () => {
        if (await confirmDlg(`删除分支 ${h.name}？`, '删除')) {
          const r = await api.gitAction({ op: 'branch', action: 'delete', name: h.name });
          if (!r.ok) {
            if (await confirmDlg(`git 拒绝删除：${r.output.slice(0, 120)}… 强制删除？`, '强制删除')) {
              runOp({ op: 'branch', action: 'force-delete', name: h.name });
              return;
            }
          }
          toast(r.ok ? `✓ 已删除 ${h.name}` : `删除失败：${r.output}`, r.ok ? 'ok' : 'err');
          refreshAll();
        }
      } });
    }
    contextMenu(x, y, items);
  }

  // ---------------- 快捷 pull / push ----------------
  function quickPullBtn() {
    const mode = localStorage.getItem('cv-pull-mode') || 'merge';
    const b = el('button', { class: 'btn ghost mini', title: `Pull（当前: ${modeLabel(mode)}，右键切换方式）`, onclick: () => runQuick({ op: 'pull', remote: 'origin', branch: currentBranch(), mode }, 'Pull') }, icon('arrow-down', 12), 'Pull ▾');
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, ['merge', 'rebase', 'ff-only'].map((m) => ({
        label: `${modeLabel(m)}${m === mode ? ' ✓' : ''}`,
        onClick: () => { localStorage.setItem('cv-pull-mode', m); toast(`Pull 方式已设为 ${modeLabel(m)}`); },
      })));
    });
    return b;
  }

  function quickPushBtn() {
    const b = el('button', { class: 'btn ghost mini', title: 'Push（origin + 当前分支，右键更多）', onclick: () => runQuick({ op: 'push', remote: 'origin', branch: currentBranch(), set_upstream: true }, 'Push') }, icon('arrow-up', 12), 'Push ▾');
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, [
        { label: '强制推送 (--force-with-lease)', onClick: () => runQuick({ op: 'push', remote: 'origin', branch: currentBranch(), set_upstream: true, force: true }, 'Push') },
      ]);
    });
    return b;
  }

  const allRefOptions = () => {
    if (!state.refs) return [];
    return [...state.refs.locals.map((b) => b.name), ...state.refs.tags.map((t) => t.name)];
  };

  function opLabel(op) {
    return { merge: '合并 (merge)', rebase: '变基 (rebase)', 'cherry-pick': '拣选 (cherry-pick)', revert: '还原 (revert)' }[op] || op || '冲突解决';
  }

  // ---------------- 通用执行 ----------------
  async function refreshAll() {
    await Promise.all([refreshWork(), refreshLog()]);
    window.CodeView.refreshStatusbar();
  }

  async function act(promiseOrFn, okMsg) {
    try {
      const r = await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn);
      if (r && r.output !== undefined) showOut(r);
      if (okMsg && (!r || r.ok)) toast(okMsg, 'ok');
      refreshAll();
      return r;
    } catch (e) { errToast(e); }
  }

  async function run(payload) {
    try {
      const r = await api.gitAction(payload);
      showOut(r);
      if (r.conflict) toast(`⚠ 有 ${r.conflicts.length} 个冲突文件，请解决后点「继续」`, 'err');
      else if (r.ok) toast(`✓ ${payload.op} 成功`, 'ok');
      else toast(`${payload.op} 失败：\n${r.output}`, 'err');
      refreshAll();
      return r;
    } catch (e) { errToast(e); }
  }

  async function runOp(payload) {
    try {
      const r = await api.gitAction(payload);
      if (r.conflict) toast(`⚠ 操作完成但有 ${r.conflicts.length} 个冲突文件，请在下方工作面板处理`, 'err');
      else if (r.ok) toast(`✓ ${payload.op} 成功`, 'ok');
      else toast(`${payload.op} 失败：\n${r.output}`, 'err');
      refreshAll();
    } catch (e) { errToast(e); }
  }

  async function runQuick(payload, label) {
    if ((payload.op === 'pull' || payload.op === 'push') && !payload.branch) {
      toast('当前处于游离 HEAD / 空仓库，无法 Pull/Push', 'err');
      return;
    }
    try {
      const r = await api.gitAction(payload);
      if (r.ok) toast(`✓ ${label} 完成${r.conflict ? '，但有冲突需处理' : ''}`, r.conflict ? 'err' : 'ok');
      else toast(`${label} 失败：\n${r.output}`, 'err');
      refreshAll();
    } catch (e) { errToast(e); }
  }

  // ---------------- 操作弹窗（低频复杂选项保留表单） ----------------
  async function modalBranchNew() {
    const r = await formModal2('新建分支', 'branch', [
      { key: 'name', label: '分支名', placeholder: 'feature/my-branch' },
      { key: 'start', type: 'select', label: '起点（默认当前 HEAD）', options: [''].concat(allRefOptions()) },
      { key: 'new_branch', type: 'checkbox', label: '创建后立即切换 (checkout -b)', value: true },
    ], '创建');
    if (r && r.name) {
      if (r.new_branch) run({ op: 'checkout', new_branch: true, target: r.name, start: r.start });
      else run({ op: 'branch', action: 'create', name: r.name, start: r.start });
    }
  }

  async function modalMerge() {
    const others = allRefOptions().filter((b) => b !== currentBranch());
    if (!others.length) { toast('没有可合并的分支', 'err'); return; }
    const r = await formModal2(`Merge：合并到 ${currentBranch()}`, 'merge', [
      { key: 'target', type: 'select', label: '来源分支', options: others },
      { key: 'no_ff', type: 'checkbox', label: 'no-ff：强制生成合并提交', value: false },
      { key: 'squash', type: 'checkbox', label: 'squash：压扁为单个提交', value: false },
    ], 'Merge');
    if (r && r.target) run({ op: 'merge', target: r.target, no_ff: r.no_ff, squash: r.squash });
  }

  async function modalRebase() {
    const others = allRefOptions().filter((b) => b !== currentBranch());
    if (!others.length) { toast('没有可变基的上游', 'err'); return; }
    const r = await formModal2(`Rebase：把 ${currentBranch()} 变基到所选上游`, 'history', [
      { key: 'target', type: 'select', label: '上游 (upstream)', options: others },
      { key: 'onto', type: 'select', label: 'onto（可选）', options: [''].concat(allRefOptions()) },
    ], 'Rebase', true);
    if (r && r.target) run({ op: 'rebase', target: r.target, onto: r.onto });
  }

  async function modalReset() {
    const r = await formModal2('Reset 重置当前分支', 'reset', [
      { key: 'target', type: 'select', label: '目标', options: allRefOptions() },
      { key: 'mode', type: 'select', label: '模式', value: 'mixed', options: [
        { value: 'soft', label: 'soft — 保留在暂存区' },
        { value: 'mixed', label: 'mixed — 保留在工作区' },
        { value: 'hard', label: 'hard — 完全丢弃（危险）' },
      ] },
    ], '重置', true);
    if (r && r.target) {
      if (r.mode === 'hard') {
        if (!(await confirmDlg('hard reset 会丢弃工作区与暂存区的所有改动，确定继续？', '确认'))) return;
      }
      run({ op: 'reset', mode: r.mode, target: r.target });
    }
  }

  async function modalStashPush() {
    const r = await formModal2('Stash 收藏当前改动', 'stash', [
      { key: 'message', label: '备注（可选）', placeholder: 'WIP: 描述' },
    ], 'Stash');
    if (r) run({ op: 'stash', action: 'push', message: r.message });
  }

  async function loadStash() {
    try {
      const r = await api.gitAction({ op: 'stash', action: 'list' });
      showOut(r);
      let box = document.getElementById('stash-list');
      box.innerHTML = '';
      const items = (r.output || '').split('\n').filter((l) => l.includes('|'));
      const card = el('div', { class: 'card', style: { marginTop: '10px' } },
        el('div', { class: 'card-h' }, icon('stash', 13), `Stash 列表 (${items.length})`, el('span', { style: { flex: 1 } }),
          el('button', { class: 'icon-btn', onclick: () => { box.innerHTML = ''; } }, icon('x', 12))),
        el('div', { class: 'card-b', style: { padding: '4px 8px' } }));
      if (!items.length) card.querySelector('.card-b').append(el('div', { class: 'muted', style: { padding: '2px 4px' } }, '（stash 为空）'));
      items.forEach((line, i) => {
        const idx = line.split('|')[0].trim();
        const msg = line.split('|').slice(1).join('|').trim();
        card.querySelector('.card-b').append(el('div', { class: 'stash-item' },
          el('span', { class: 'mono', style: { color: 'var(--yellow)', fontSize: '11px' } }, idx),
          el('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px' }, title: msg }, msg),
          el('button', { class: 'btn mini ghost', title: '弹出（应用并删除）', onclick: () => run({ op: 'stash', action: 'pop', index: i }) }, '↑'),
          el('button', { class: 'btn mini ghost', title: '仅应用', onclick: () => run({ op: 'stash', action: 'apply', index: i }) }, '↩'),
          el('button', { class: 'btn mini ghost danger', title: '删除', onclick: () => run({ op: 'stash', action: 'drop', index: i }) }, icon('x', 10)),
        ));
      });
      box.append(card);
    } catch (e) { errToast(e); }
  }

  async function markAllResolved() {
    if (!state.status.conflicted.length) return;
    await act(() => api.gitStage(state.status.conflicted.slice()), '已全部标记为已解决');
  }

  async function doContinue() {
    const op = state.status.in_progress;
    if (!op) { toast('没有进行中的操作', 'err'); return; }
    if (state.status.conflicted.length) { toast('仍有未解决的冲突文件，请先解决并标记', 'err'); return; }
    await run({ op: 'continue', action: op });
  }

  async function doAbort() {
    const op = state.status.in_progress;
    if (!op) { toast('没有进行中的操作', 'err'); return; }
    if (await confirmDlg(`确认中止当前 ${opLabel(op)}？工作区将恢复到操作前的状态。`, '中止')) {
      await run({ op: 'abort', action: op });
    }
  }

  async function discardOne(f) {
    if (await confirmDlg(`丢弃 ${f.path} 的工作区改动？此操作不可撤销。`, '丢弃')) {
      await run({ op: 'discard', paths: [f.path] });
    }
  }

  // 轻量表单弹窗（本地包装）
  function formModal2(title, iconName, fields, okText, danger = false) {
    return formModal({ title, icon: iconName, fields, okText, danger });
  }
}
