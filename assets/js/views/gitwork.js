// Git 工作区：暂存/提交、远程同步、分支、合并/变基/回退、stash、冲突解决
import { api } from '../api.js';
import { el, icon, formModal, confirmDlg, toast, errToast, renderDiffRows } from '../ui.js';

const state = {
  status: null,
  refs: null,
  output: '',
  selectedDiff: null,
};

export function render(content) {
  content.innerHTML = '';
  const wrap = el('div', { class: 'work-wrap' });
  content.append(wrap);
  refresh();
  window.CodeView._workRefresh = refresh;

  async function refresh() {
    try {
      [state.status, state.refs] = await Promise.all([api.gitStatus(), api.gitRefs()]);
    } catch (e) {
      wrap.innerHTML = '';
      wrap.append(el('div', { class: 'empty-hint' },
        el('span', { class: 'big' }, '⚠'),
        `加载失败：${e.message}`, el('br'), '当前项目可能不是 git 仓库'));
      return;
    }
    draw();
  }

  function draw() {
    wrap.innerHTML = '';
    const st = state.status;

    // 工具栏
    wrap.append(el('div', { class: 'view-toolbar' },
      el('span', { class: 'vtitle' }, icon('branch', 15), 'Git 工作区'),
      el('span', { class: 'sep' }),
      el('span', { class: 'muted' }, remoteSyncBar()),
    ));

    // 冲突横幅
    if (st.in_progress || st.conflicted.length) {
      wrap.append(el('div', { class: 'conflict-banner' },
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

    const body = el('div', { class: 'work-body' });
    wrap.append(body);
    body.append(leftPanel(), rightPanel());
  }

  function remoteSyncBar() {
    const st = state.status;
    const sync = st.detached ? '（游离 HEAD）' : '';
    return el('span', { style: { display: 'inline-flex', gap: '6px', flexWrap: 'wrap' } },
      el('button', { class: 'btn ghost mini', onclick: modalFetch }, icon('arrow-down', 12), 'Fetch'),
      el('button', { class: 'btn ghost mini', onclick: modalPull }, icon('arrow-down', 12), 'Pull'),
      el('button', { class: 'btn ghost mini', onclick: modalPush }, icon('arrow-up', 12), 'Push'),
      el('span', { class: 'sep', style: { width: '1px', height: '16px', background: 'var(--border-strong)', alignSelf: 'center' } }),
      el('button', { class: 'btn ghost mini', onclick: modalBranchNew }, icon('branch', 12), '新建分支'),
      el('button', { class: 'btn ghost mini', onclick: modalBranchSwitch }, icon('play', 12), '切换'),
      el('button', { class: 'btn ghost mini', onclick: modalBranchDelete }, icon('trash', 12), '删除分支'),
      el('button', { class: 'btn ghost mini', onclick: modalMerge }, icon('merge', 12), 'Merge'),
      el('button', { class: 'btn ghost mini', onclick: modalRebase }, icon('history', 12), 'Rebase'),
      el('button', { class: 'btn ghost mini', onclick: modalRevert }, icon('revert', 12), 'Revert'),
      el('button', { class: 'btn ghost mini', onclick: modalCherry }, icon('cherry', 12), 'Cherry-pick'),
      el('button', { class: 'btn ghost mini', onclick: modalReset }, icon('reset', 12), 'Reset'),
      el('button', { class: 'btn ghost mini', onclick: modalStashPush }, icon('stash', 12), 'Stash'),
      el('button', { class: 'btn ghost mini', title: sync, onclick: loadStash }, icon('dots', 12), 'Stash 列表'),
    );
  }

  // ---------------- 左侧 ----------------
  function leftPanel() {
    const st = state.status;
    const refs = state.refs;
    const left = el('div', { class: 'work-left' });

    // 提交卡片
    const msg = el('textarea', { rows: 3, placeholder: '提交信息（commit message）…', style: { width: '100%', resize: 'vertical' } });
    const amend = el('input', { type: 'checkbox' });
    left.append(el('div', { class: 'card' },
      el('div', { class: 'card-h' }, icon('commit', 13), '提交', el('span', { style: { flex: 1 } }),
        el('label', { class: 'm-check', style: { textTransform: 'none', letterSpacing: 0, fontWeight: 400 } },
          amend, el('span', {}, 'amend'))),
      el('div', { class: 'card-b' },
        msg,
        el('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '8px' } },
          el('button', {
            class: 'btn primary',
            onclick: async () => {
              if (!msg.value.trim() && !amend.checked) { toast('请填写提交信息', 'err'); return; }
              try {
                const r = await api.gitCommitMsg(msg.value, amend.checked);
                showOut(r);
                if (r.ok) { msg.value = ''; amend.checked = false; toast('✓ 提交成功', 'ok'); }
                refresh();
                window.CodeView.gitChanged();
              } catch (e) { errToast(e); }
            },
          }, icon('check', 13), '提交 (Commit)'),
        ),
      ),
    ));

    // 变更卡片（显式 staged 标志，避免标题字符串误判）
    const section = (title, iconName, files, actions, staged) => {
      const box = el('div', { class: 'card' });
      box.append(el('div', { class: 'card-h' }, icon(iconName, 13), title, el('span', { class: 'count' }, files.length),
        el('span', { style: { flex: 1 } }),
        actions?.header || null,
      ));
      const b = el('div', { class: 'card-b', style: { padding: '6px 8px' } });
      for (const f of files) {
        b.append(el('div', { class: 'file-line' },
          el('span', { class: `chg-${f.code}`, style: { fontWeight: 700 } }, f.code),
          el('span', {
            class: 'path', title: '点击查看差异',
            onclick: () => { state.selectedDiff = { path: f.path, staged: !!staged }; refreshDiff(); },
          }, f.path),
          ...(actions?.row ? actions.row(f) : []),
        ));
      }
      if (!files.length) b.append(el('div', { class: 'muted', style: { padding: '4px 8px', fontSize: '12px' } }, '（空）'));
      box.append(b);
      return box;
    };

    left.append(
      section('暂存的更改', 'check', st.staged, {
        header: el('button', { class: 'icon-btn', title: '全部取消暂存', onclick: () => act(() => api.gitUnstage([])) }, icon('revert', 13)),
        row: (f) => [el('button', { class: 'icon-btn', title: '取消暂存', onclick: () => act(() => api.gitUnstage([f.path])) }, icon('x', 12))],
      }, true),
      section('未暂存的更改', 'edit', st.unstaged, {
        header: el('button', { class: 'icon-btn', title: '全部暂存', onclick: () => act(() => api.gitStage([]), '已全部暂存') }, icon('plus', 13)),
        row: (f) => [
          el('button', { class: 'icon-btn', title: '暂存', onclick: () => act(() => api.gitStage([f.path])) }, icon('plus', 12)),
          el('button', { class: 'icon-btn danger', title: '丢弃改动', onclick: () => discardOne(f) }, icon('revert', 12)),
        ],
      }, false),
      section('未跟踪', 'file', st.untracked, {
        header: el('button', { class: 'icon-btn', title: '全部暂存', onclick: () => act(() => api.gitStage([])) }, icon('plus', 13)),
        row: (f) => [el('button', { class: 'icon-btn', title: '加入版本控制', onclick: () => act(() => api.gitStage([f.path])) }, icon('plus', 12))],
      }, false),
      el('div', { class: 'work-actions' },
        el('button', { class: 'btn mini', onclick: () => act(() => api.gitStage([]), '已全部暂存') }, '全部暂存 +'),
        el('button', { class: 'btn mini', onclick: () => act(() => api.gitUnstage([])) }, '全部取消暂存 −'),
      ),
    );

    // 分支卡片
    if (refs && refs.locals.length) {
      left.append(el('div', { class: 'card' },
        el('div', { class: 'card-h' }, icon('branch', 13), '分支', el('span', { class: 'count' }, refs.locals.length)),
        el('div', { class: 'card-b', style: { padding: '6px 8px' } },
          refs.locals.map((b) => el('div', { class: 'file-line' },
            el('span', { style: { color: b.is_head ? 'var(--green)' : 'var(--fg-faint)' } }, b.is_head ? '✓' : '○'),
            el('span', { class: 'mono', style: { fontSize: '12px' } }, b.name),
            b.upstream ? el('span', { class: 'muted', style: { fontSize: '10.5px' } },
              `↑${b.ahead ?? 0} ↓${b.behind ?? 0}`) : null,
            b.is_head ? el('span', { style: { marginLeft: 'auto' }, class: 'badge head' }, '当前') : el('button', {
              class: 'btn mini ghost', style: { marginLeft: 'auto' },
              onclick: () => run({ op: 'checkout', branch: b.name }),
            }, '切换'),
          ))),
      ));
    }

    return left;
  }

  // ---------------- 右侧 ----------------
  function rightPanel() {
    const right = el('div', { class: 'work-right' });

    const diffCard = el('div', { class: 'card', style: { flex: '0 0 auto' } },
      el('div', { class: 'card-h' }, icon('code', 13), '差异预览',
        el('span', { id: 'diff-title', class: 'muted', style: { textTransform: 'none', letterSpacing: 0, fontWeight: 400 } })),
      el('div', { id: 'diff-host', style: { minHeight: '100px' } },
        el('div', { class: 'empty-hint' }, '点击左侧文件查看差异')),
    );
    right.append(diffCard);

    const outCard = el('div', { class: 'card', style: { display: state.output ? '' : 'none' } },
      el('div', { class: 'card-h' }, icon('terminal', 13), '操作输出', el('span', { style: { flex: 1 } }),
        el('button', { class: 'icon-btn', onclick: () => { state.output = ''; outCard.style.display = 'none'; } }, icon('x', 12))),
      el('div', { class: 'card-b' }, el('pre', { class: 'console', style: { border: 'none', maxHeight: '300px', margin: 0 } }, state.output)),
    );
    right.append(outCard);

    window.CodeView._refreshDiff = refreshDiff;
    if (state.selectedDiff) refreshDiff();
    return right;

    async function refreshDiff() {
      if (!state.selectedDiff) return;
      const { path, staged } = state.selectedDiff;
      const host = document.getElementById('diff-host');
      const title = document.getElementById('diff-title');
      if (title) title.textContent = `${staged ? '[暂存区] ' : ''}${path}`;
      host.innerHTML = '';
      try {
        const patch = await api.gitFileDiff(path, staged);
        if (!patch.trim()) {
          host.append(el('div', { class: 'empty-hint' }, '（无差异，可能是新文件）'));
        } else {
          const box = el('div', { class: 'diff-box', style: { margin: '10px', maxHeight: '60vh' } });
          box.append(renderDiffRows(patch, {
            onOpenLine: (ln) => window.CodeView.openFileAt(path, ln),
          }));
          host.append(box);
        }
      } catch (e) {
        host.append(el('div', { class: 'empty-hint' }, e.message));
      }
    }
  }

  // ---------------- 杂项 ----------------
  function opLabel(op) {
    return { merge: '合并 (merge)', rebase: '变基 (rebase)', 'cherry-pick': '拣选 (cherry-pick)', revert: '还原 (revert)' }[op] || op || '冲突解决';
  }

  function showOut(r) {
    state.output = `[${r.op}] ${r.ok ? '成功' : `失败 (exit ${r.code})`}\n${r.output || '(无输出)'}${r.conflict ? `\n⚠ 检测到 ${r.conflicts.length} 个冲突文件` : ''}`;
    const outCard = document.querySelectorAll('.work-right .card')[1];
    if (outCard) {
      outCard.style.display = '';
      const pre = outCard.querySelector('.console');
      if (pre) pre.textContent = state.output;
    }
  }

  async function act(promiseOrFn, okMsg) {
    try {
      const r = await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn);
      if (r && r.output !== undefined) showOut(r);
      if (okMsg && (!r || r.ok)) toast(okMsg, 'ok');
      refresh();
      window.CodeView.gitChanged();
      return r;
    } catch (e) { errToast(e); }
  }

  async function run(payload) {
    try {
      const r = await api.gitAction(payload);
      showOut(r);
      if (r.conflict) {
        toast(`⚠ 有 ${r.conflicts.length} 个冲突文件，请解决后点「继续」`, 'err');
      } else if (r.ok) {
        toast(`✓ ${payload.op} 成功`, 'ok');
      } else {
        toast(`${payload.op} 失败：\n${r.output}`, 'err');
      }
      refresh();
      window.CodeView.gitChanged();
      window.CodeView.refreshStatusbar();
      return r;
    } catch (e) { errToast(e); }
  }

  const branchOptions = () => (state.refs ? state.refs.locals.map((b) => b.name) : []);
  const allRefOptions = () => {
    if (!state.refs) return [];
    return [...state.refs.locals.map((b) => b.name), ...state.refs.tags.map((t) => t.name)];
  };
  const remoteOptions = () => (state.refs && state.refs.remotes.length ? state.refs.remotes : ['origin']);
  const curBranch = () => (state.status && state.status.head_branch) || '';

  // ---------------- 操作弹窗 ----------------
  async function modalFetch() {
    const r = await formModal({
      title: 'Fetch 拉取远程更新（不合并）', icon: 'arrow-down',
      fields: [
        { key: 'remote', type: 'select', label: '远程仓库', options: remoteOptions() },
        { key: 'prune', type: 'checkbox', label: 'prune：清理已删除的远程分支引用', value: false },
      ],
      okText: 'Fetch',
    });
    if (r) run({ op: 'fetch', remote: r.remote, prune: r.prune });
  }

  async function modalPull() {
    const r = await formModal({
      title: `Pull 拉取并整合到 ${curBranch()}`, icon: 'arrow-down',
      fields: [
        { key: 'remote', type: 'select', label: '远程仓库', options: remoteOptions() },
        { key: 'branch', type: 'text', label: '远程分支', value: curBranch() },
        { key: 'mode', type: 'select', label: '整合方式', value: 'merge', options: [
          { value: 'merge', label: 'merge（默认，产生合并提交）' },
          { value: 'rebase', label: 'rebase（变基到远程之上）' },
          { value: 'ff-only', label: 'ff-only（仅快进）' },
        ] },
      ],
      okText: 'Pull',
    });
    if (r) run({ op: 'pull', remote: r.remote, branch: r.branch, mode: r.mode });
  }

  async function modalPush() {
    const r = await formModal({
      title: 'Push 推送到远程', icon: 'arrow-up',
      fields: [
        { key: 'remote', type: 'select', label: '远程仓库', options: remoteOptions() },
        { key: 'branch', type: 'text', label: '分支', value: curBranch() },
        { key: 'set_upstream', type: 'checkbox', label: '设置上游 (-u)（首次推送勾选）', value: false },
        { key: 'force', type: 'checkbox', label: '强制推送 --force-with-lease（危险）', value: false },
      ],
      okText: 'Push',
    });
    if (r) run({ op: 'push', remote: r.remote, branch: r.branch, set_upstream: r.set_upstream, force: r.force });
  }

  async function modalBranchNew() {
    const r = await formModal({
      title: '新建分支', icon: 'branch',
      fields: [
        { key: 'name', label: '分支名', placeholder: 'feature/my-branch' },
        { key: 'start', type: 'select', label: '起点（默认当前 HEAD）', options: [''].concat(allRefOptions()) },
        { key: 'new_branch', type: 'checkbox', label: '创建后立即切换 (checkout -b)', value: true },
      ],
      okText: '创建',
    });
    if (r && r.name) {
      if (r.new_branch) run({ op: 'checkout', new_branch: true, target: r.name, start: r.start });
      else run({ op: 'branch', action: 'create', name: r.name, start: r.start });
    }
  }

  async function modalBranchSwitch() {
    const opts = branchOptions().filter((b) => b !== curBranch());
    if (!opts.length) { toast('没有其他本地分支', 'err'); return; }
    const r = await formModal({
      title: '切换分支', icon: 'play',
      fields: [{ key: 'branch', type: 'select', label: '目标分支', options: opts }],
      okText: '切换',
    });
    if (r) run({ op: 'checkout', branch: r.branch });
  }

  async function modalBranchDelete() {
    const opts = branchOptions().filter((b) => b !== curBranch());
    if (!opts.length) { toast('没有可删除的分支', 'err'); return; }
    const r = await formModal({
      title: '删除分支', icon: 'trash',
      fields: [
        { key: 'name', type: 'select', label: '分支', options: opts },
        { key: 'force', type: 'checkbox', label: '强制删除（未合并也删，-D）', value: false },
      ],
      okText: '删除', danger: true,
    });
    if (r) run({ op: 'branch', action: r.force ? 'force-delete' : 'delete', name: r.name });
  }

  async function modalMerge() {
    const others = allRefOptions().filter((b) => b !== curBranch());
    if (!others.length) { toast('没有可合并的分支', 'err'); return; }
    const r = await formModal({
      title: `Merge：把所选分支合并进 ${curBranch()}`, icon: 'merge',
      fields: [
        { key: 'target', type: 'select', label: '来源分支', options: others },
        { key: 'no_ff', type: 'checkbox', label: 'no-ff：强制生成合并提交（保留分支形状）', value: false },
        { key: 'squash', type: 'checkbox', label: 'squash：压扁为单个提交', value: false },
      ],
      okText: 'Merge',
    });
    if (r && r.target) run({ op: 'merge', target: r.target, no_ff: r.no_ff, squash: r.squash });
  }

  async function modalRebase() {
    const others = allRefOptions().filter((b) => b !== curBranch());
    if (!others.length) { toast('没有可变基的上游', 'err'); return; }
    const r = await formModal({
      title: `Rebase：把 ${curBranch()} 变基到所选上游之上`, icon: 'history',
      fields: [
        { key: 'target', type: 'select', label: '上游 (upstream)', options: others },
        { key: 'onto', type: 'select', label: 'onto（可选，一般留默认）', options: [''].concat(allRefOptions()) },
      ],
      okText: 'Rebase', danger: true,
    });
    if (r && r.target) run({ op: 'rebase', target: r.target, onto: r.onto });
  }

  async function modalRevert() {
    const r = await formModal({
      title: 'Revert 生成反向提交（安全回退）', icon: 'revert',
      fields: [
        { key: 'target', label: 'commit id（可在 Git 历史 右键复制）', placeholder: 'a1b2c3d…' },
        { key: 'no_commit', type: 'checkbox', label: '只还原不自动提交', value: false },
      ],
      okText: 'Revert',
    });
    if (r && r.target) run({ op: 'revert', target: r.target.trim(), no_commit: r.no_commit });
  }

  async function modalCherry() {
    const r = await formModal({
      title: 'Cherry-pick 摘取单个提交到当前分支', icon: 'cherry',
      fields: [{ key: 'target', label: 'commit id', placeholder: 'a1b2c3d…' }],
      okText: 'Cherry-pick',
    });
    if (r && r.target) run({ op: 'cherry-pick', target: r.target.trim() });
  }

  async function modalReset() {
    const r = await formModal({
      title: 'Reset 重置当前分支', icon: 'reset',
      fields: [
        { key: 'target', type: 'select', label: '目标', options: allRefOptions() },
        { key: 'mode', type: 'select', label: '模式', value: 'mixed', options: [
          { value: 'soft', label: 'soft — 保留改动在暂存区' },
          { value: 'mixed', label: 'mixed — 保留改动在工作区' },
          { value: 'hard', label: 'hard — 完全丢弃（危险）' },
        ] },
      ],
      okText: '重置', danger: true,
    });
    if (r && r.target) {
      if (r.mode === 'hard') {
        const ok = await confirmDlg('hard reset 会丢弃工作区与暂存区的所有改动，确定继续？', '确认');
        if (!ok) return;
      }
      run({ op: 'reset', mode: r.mode, target: r.target });
    }
  }

  async function modalStashPush() {
    const r = await formModal({
      title: 'Stash 收藏当前改动', icon: 'stash',
      fields: [{ key: 'message', label: '备注（可选）', placeholder: 'WIP: 描述' }],
      okText: 'Stash',
    });
    if (r) run({ op: 'stash', action: 'push', message: r.message });
  }

  async function loadStash() {
    try {
      const r = await api.gitAction({ op: 'stash', action: 'list' });
      showOut(r);
      let box = document.getElementById('stash-list');
      if (!box) {
        box = el('div', { id: 'stash-list' });
        document.querySelector('.work-left').append(box);
      }
      box.innerHTML = '';
      const items = (r.output || '').split('\n').filter((l) => l.includes('|'));
      const card = el('div', { class: 'card', style: { marginTop: '10px' } },
        el('div', { class: 'card-h' }, icon('stash', 13), `Stash 列表 (${items.length})`, el('span', { style: { flex: 1 } }),
          el('button', { class: 'icon-btn', title: '关闭', onclick: () => { box.innerHTML = ''; } }, icon('x', 12))),
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
    if (state.status.conflicted.length) {
      toast('仍有未解决的冲突文件，请先解决并标记', 'err');
      return;
    }
    await run({ op: 'continue', action: op });
  }

  async function doAbort() {
    const op = state.status.in_progress;
    if (!op) { toast('没有进行中的操作', 'err'); return; }
    const ok = await confirmDlg(`确认中止当前 ${opLabel(op)}？工作区将恢复到操作前的状态。`, '中止');
    if (ok) await run({ op: 'abort', action: op });
  }

  async function discardOne(f) {
    const ok = await confirmDlg(`丢弃 ${f.path} 的工作区改动？此操作不可撤销。`, '丢弃');
    if (!ok) return;
    await run({ op: 'discard', paths: [f.path] });
  }
}
