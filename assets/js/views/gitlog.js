// Git 历史：Canvas 树状图（全部分支关系）+ 节点就地操作 + 提交详情
import { api } from '../api.js';
import {
  el, icon, contextMenu, popoverInput, confirmDlg, toast, errToast,
  fmtTime, shortOid, avatar, renderDiffRows,
} from '../ui.js';
import { layoutGraph } from '../gitlanes.js';
import { createCommitGraph } from '../gitgraph.js';

const state = {
  commits: [],
  loading: false,
  ref: '',
  limit: 600,
  done: false,
  selected: null,
  lastRoot: null,
};

export function render(content) {
  if (state.lastRoot !== window.__rootStamp) {
    state.commits = []; state.ref = ''; state.limit = 600; state.done = false;
    state.selected = null; state.lastRoot = window.__rootStamp;
  }
  content.innerHTML = '';
  const wrap = el('div', { class: 'log-wrap' });
  content.append(wrap);

  // ---------------- 工具栏 ----------------
  const branchSel = el('select', { style: { maxWidth: '180px' }, onchange: () => { state.ref = branchSel.value; state.limit = 600; reload(); } });
  const search = el('input', {
    type: 'text', placeholder: '搜索提交 / 作者 / hash（画布中高亮）', style: { width: '230px' },
    oninput: () => highlightSearch(),
  });
  const countLabel = el('span', { class: 'muted', style: { fontSize: '11.5px' } });
  const toolbar = el('div', { class: 'view-toolbar' },
    el('span', { class: 'vtitle' }, icon('history', 15), 'Git 历史'),
    el('span', { class: 'sep' }),
    icon('branch', 13), branchSel,
    search,
    el('span', { class: 'sep' }),
    el('button', { class: 'btn ghost mini', title: '从远程拉取（不合并）', onclick: () => runQuick({ op: 'fetch', remote: 'origin', prune: true }, 'Fetch') }, icon('arrow-down', 12), 'Fetch'),
    quickPullBtn(),
    quickPushBtn(),
    el('span', { class: 'sep' }),
    el('button', { class: 'btn mini', onclick: loadMore, title: '加载更多提交' }, icon('plus', 12), '加载更多'),
    el('button', { class: 'btn ghost mini', title: '刷新', onclick: reload }, icon('refresh', 13)),
    el('span', { style: { flex: 1 } }),
    countLabel,
  );
  wrap.append(toolbar);

  // ---------------- 主体 ----------------
  const main = el('div', { class: 'log-main' });
  wrap.append(main);
  const graphPane = el('div', { class: 'graph-pane' });
  graphPane.append(el('div', { class: 'graph-hint' }, '拖动平移 · 点击节点看详情 · 右键节点就地操作'));
  const detail = el('div', { class: 'log-detail' },
    el('div', { class: 'empty-hint' }, el('span', { class: 'big' }, '⑂'), '点击图中提交节点查看变更详情'));
  main.append(graphPane, detail);

  const graph = createCommitGraph(graphPane, {
    onNodeClick: (row) => {
      state.selected = row.oid;
      showDetail(row, detail);
    },
    onNodeMenu: (row, x, y) => nodeMenu(row, x, y),
  });

  api.gitRefs().then((refs) => {
    branchSel.innerHTML = '';
    branchSel.append(el('option', { value: '', selected: state.ref === '' }, '全部分支'));
    for (const b of refs.locals) branchSel.append(el('option', { value: b.name, selected: state.ref === b.name }, `${b.is_head ? '✓ ' : ''}${b.name}`));
    for (const t of refs.tags) branchSel.append(el('option', { value: `refs/tags/${t.name}` }, `🏷 ${t.name}`));
  }).catch(() => {});

  reload();

  async function reload() {
    state.commits = [];
    state.done = false;
    graphPane.querySelectorAll('.empty-hint').forEach((n) => n.remove());
    const hint = el('div', { class: 'empty-hint' }, el('span', { class: 'spin' }, '⠋'), ' 正在加载提交历史…');
    graphPane.append(hint);
    await fetchPage(true);
    hint.remove();
  }

  async function loadMore() {
    await fetchPage(false);
  }

  async function fetchPage(reset) {
    if (state.loading) return;
    state.loading = true;
    try {
      const batch = await api.gitLog(state.limit, reset ? 0 : state.commits.length, state.ref);
      if (batch.length < state.limit) state.done = true;
      state.commits = reset ? batch : state.commits.concat(batch);
      drawGraph();
    } catch (e) {
      toast(`加载历史失败：${e.message}`, 'err');
    } finally {
      state.loading = false;
    }
  }

  function drawGraph() {
    if (!state.commits.length) {
      graph.setData({ rows: [], laneCount: 1 });
      countLabel.textContent = '没有提交';
      return;
    }
    const laid = layoutGraph(state.commits);
    graph.setData(laid);
    countLabel.textContent = `${state.commits.length} 个提交${state.done ? '' : ' · 点「加载更多」延伸历史'}`;
    highlightSearch();
    if (reset2.first) { graph.fit(); reset2.first = false; }
  }

  const reset2 = { first: true };

  function highlightSearch() {
    const q = search.value.trim().toLowerCase();
    if (!q) return;
    const hit = state.commits.find((c) =>
      `${c.subject} ${c.author} ${c.oid}`.toLowerCase().includes(q));
    if (hit && state.selected !== hit.oid) {
      // 搜索命中：选中第一个匹配节点
      state.selected = hit.oid;
      graph.draw();
    }
  }

  // ---------------- 节点右键菜单（就地操作） ----------------
  function nodeMenu(row, x, y) {
    const headRefs = (row.refs || []).filter((r) => r.kind === 'head');
    const tagRefs = (row.refs || []).filter((r) => r.kind === 'tag');
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

    // 分支头节点：分支级操作
    for (const h of headRefs) {
      if (h.current) continue;
      items.push('-');
      items.push({ label: `检出分支 ${h.name}`, icon: 'play', onClick: () => runOp({ op: 'checkout', branch: h.name }) });
      items.push({ label: `合并 ${h.name} → 当前分支`, icon: 'merge', onClick: () => runOp({ op: 'merge', target: h.name }) });
      items.push({ label: `变基：当前分支变基到 ${h.name}`, icon: 'history', onClick: () => runOp({ op: 'rebase', target: h.name }) });
      items.push({ label: `重命名分支 ${h.name}…`, icon: 'edit', onClick: () => popoverInput(x, y, {
        label: `${h.name} 的新名字`,
        value: h.name,
        okText: '重命名',
        onOk: (newName) => runOp({ op: 'branch', action: 'rename', name: h.name, start: newName }),
      }) });
      items.push({ label: `删除分支 ${h.name}`, icon: 'trash', danger: true, onClick: async () => {
        if (await confirmDlg(`删除分支 ${h.name}？（未合并会被 git 拒绝，可再强制删除）`, '删除')) {
          const r = await api.gitAction({ op: 'branch', action: 'delete', name: h.name });
          if (!r.ok) {
            if (await confirmDlg(`git 拒绝删除：${r.output.slice(0, 120)}… 强制删除？`, '强制删除')) {
              runOp({ op: 'branch', action: 'force-delete', name: h.name });
              return;
            }
          }
          toast(r.ok ? `✓ 已删除 ${h.name}` : `删除失败：${r.output}`, r.ok ? 'ok' : 'err');
          window.CodeView.gitChanged();
          refreshLog();
        }
      } });
    }
    for (const t of tagRefs) {
      items.push('-');
      items.push({ label: `标签 ${t.name}（仅展示，可用 git CLI 管理）`, icon: 'tag-dim', onClick: () => {} });
    }

    contextMenu(x, y, items);
  }

  async function refreshLog() {
    await fetchPage(true);
  }

  // ---------------- 快捷 pull / push（单击默认参数，右键更多选项） ----------------
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
        { label: '常规推送 (--force-with-lease)', onClick: () => runQuick({ op: 'push', remote: 'origin', branch: currentBranch(), set_upstream: true, force: true }, 'Push') },
        { label: '打开完整 Push 选项…', onClick: () => window.CodeView.openGitworkAdvanced('push') },
      ]);
    });
    return b;
  }

  const currentBranch = () => window.__refsCache?.locals?.find((b) => b.is_head)?.name || '';

  function modeLabel(m) {
    return { merge: 'merge 合并', rebase: 'rebase 变基', 'ff-only': 'ff-only 仅快进' }[m] || m;
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
      window.CodeView.gitChanged();
      refreshLog();
    } catch (e) { errToast(e); }
  }

  async function runOp(payload) {
    try {
      const r = await api.gitAction(payload);
      if (r.conflict) {
        toast(`⚠ 操作完成但有 ${r.conflicts.length} 个冲突文件，请到「Git 工作区」处理`, 'err');
      } else if (r.ok) {
        toast(`✓ ${payload.op} 成功`, 'ok');
      } else {
        toast(`${payload.op} 失败：\n${r.output}`, 'err');
      }
      window.CodeView.gitChanged();
      await refreshLog();
    } catch (e) { errToast(e); }
  }

  // ---------------- 提交详情 ----------------
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
            diffBox.append(renderDiffRows(f.patch, {
              onOpenLine: f.change !== 'D' ? (ln) => window.CodeView.openFileAt(f.path, ln) : null,
            }));
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
}
