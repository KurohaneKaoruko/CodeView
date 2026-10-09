// 提交/分支对比：任选两个引用（分支、标签、commit id）查看树级差异，行级定位
import { api } from '../api.js?v=3';
import { el, icon, errToast, toast, renderDiffRows, shortOid } from '../ui.js?v=3';

const state = {
  result: null,
  selectedFile: null,
  lastRoot: null,
};

export function render(content) {
  if (state.lastRoot !== window.__rootStamp) {
    state.result = null;
    state.selectedFile = null;
    state.lastRoot = window.__rootStamp;
  }
  content.innerHTML = '';
  const wrap = el('div', { class: 'work-wrap' });
  content.append(wrap);

  // 预填（来自 Git 历史右键）
  const prefill = window.__cmpPrefill || {};
  window.__cmpPrefill = null;

  // ---- 工具栏 ----
  // 引用选择：自绘下拉建议（本地/远程分支、标签、HEAD），不再使用原生 datalist
  let refItems = [];
  api.gitRefs().then((refs) => {
    refItems = [
      ...refs.locals.map((b) => ({ value: b.name, kind: b.is_head ? '本地分支 ✓' : '本地分支' })),
      ...refs.remote_branches.map((b) => ({ value: b.name, kind: '远程分支' })),
      ...refs.tags.map((t) => ({ value: t.name, kind: '标签' })),
      { value: 'HEAD', kind: '当前 HEAD' },
    ];
    refreshDropA && refreshDropA();
    refreshDropB && refreshDropB();
    if (prefill.a || prefill.b) doCompare();
  }).catch(() => {});

  function makeRefCombo(placeholder, initial) {
    const wrap = el('div', { class: 'ref-combo' });
    const input = el('input', { type: 'text', value: initial || '', placeholder, spellcheck: 'false', style: { width: '220px', fontFamily: 'var(--mono)' } });
    const drop = el('div', { class: 'ref-drop', style: { display: 'none' } });
    wrap.append(input, drop);
    let refreshDrop = () => {};
    const renderDrop = () => {
      const q = input.value.trim().toLowerCase();
      const items = refItems.filter((r) => !q || r.value.toLowerCase().includes(q));
      drop.innerHTML = '';
      if (!items.length) { drop.append(el('div', { class: 'ref-empty' }, '无匹配引用')); return; }
      for (const it of items.slice(0, 200)) {
        drop.append(el('div', { class: 'ref-item', onclick: () => { input.value = it.value; drop.style.display = 'none'; doCompare(); } },
          el('span', { class: 'mono' }, it.value),
          el('span', { class: 'dim' }, it.kind),
        ));
      }
    };
    refreshDrop = renderDrop;
    const openDrop = () => { renderDrop(); drop.style.display = ''; };
    input.addEventListener('focus', openDrop);
    input.addEventListener('click', openDrop);
    input.addEventListener('input', renderDrop);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { drop.style.display = 'none'; doCompare(); }
      if (e.key === 'Escape') drop.style.display = 'none';
    });
    setTimeout(() => document.addEventListener('mousedown', (e) => {
      if (!wrap.contains(e.target)) drop.style.display = 'none';
    }, true), 0);
    return { el: wrap, input, refreshDrop };
  }

  const comboA = makeRefCombo('A：分支 / 标签 / commit id', prefill.a || '');
  const inputA = comboA.input;
  const comboB = makeRefCombo('B：分支 / 标签 / commit id', prefill.b || '');
  const inputB = comboB.input;
  const refreshDropA = () => comboA.refreshDrop();
  const refreshDropB = () => comboB.refreshDrop();
  const mbCheck = el('input', { type: 'checkbox' });
  mbCheck.checked = false;
  const statsSpan = el('span', { class: 'muted', style: { fontSize: '11.5px' } });

  const doCompare = () => runCompare();
  inputA.addEventListener('keydown', (e) => { if (e.key === 'Enter') doCompare(); });
  inputB.addEventListener('keydown', (e) => { if (e.key === 'Enter') doCompare(); });

  const toolbar = el('div', { class: 'view-toolbar' },
    el('span', { class: 'vtitle' }, icon('compare', 15), '对比'),
    el('span', { class: 'sep' }),
    comboA.el,
    el('button', {
      class: 'btn ghost mini', title: '交换 A / B',
      onclick: () => { const t = inputA.value; inputA.value = inputB.value; inputB.value = t; if (state.result) doCompare(); },
    }, icon('swap', 13)),
    comboB.el,
    el('label', { class: 'm-check', title: '以两个引用的共同祖先（merge-base）为基准，效果类似 GitHub PR 的三点对比' },
      mbCheck, el('span', {}, '以共同祖先为基准')),
    el('button', { class: 'btn primary mini', onclick: doCompare }, icon('compare', 12), '对比'),
    statsSpan,
    el('span', { style: { flex: 1 } }),
  );
  wrap.append(toolbar);

  // ---- 主体 ----
  const body = el('div', { class: 'work-body' });
  wrap.append(body);
  const filesCard = el('div', { class: 'card', style: { flex: '0 0 360px', alignSelf: 'flex-start', margin: '12px', maxHeight: 'calc(100% - 24px)', display: 'flex', flexDirection: 'column' } },
    el('div', { class: 'card-h' }, icon('file', 13), '变更文件', el('span', { class: 'count', id: 'cmp-file-count' }, '0')),
    el('div', { id: 'cmp-files', class: 'card-b', style: { padding: '6px 8px', overflow: 'auto' } },
      el('div', { class: 'empty-hint' }, el('span', { class: 'big' }, '⇆'),
        el('span', {}, '输入两个分支、标签或 commit id 后点击「对比」', el('br'),
          '也可以在 Git 历史中右键提交，设为对比的 A / B 端'))),
  );
  const diffPane = el('div', { style: { flex: 1, minWidth: 0, margin: '12px 12px 12px 0', overflow: 'auto' } },
    el('div', { class: 'empty-hint' }, el('span', { class: 'big' }, '≡'), '点击左侧文件查看行级差异'));
  body.append(filesCard, diffPane);

  if (inputA.value && inputB.value) doCompare();

  async function runCompare() {
    const from = inputA.value.trim();
    const to = inputB.value.trim();
    if (!from || !to) { toast('请填写 A 与 B 两个引用', 'err'); return; }
    statsSpan.textContent = '对比中…';
    try {
      state.result = await api.gitCompare(from, to, mbCheck.checked);
      drawSummary(from, to);
      drawFileList();
    } catch (e) {
      statsSpan.textContent = '';
      errToast(e);
    }
  }

  function drawSummary(from, to) {
    const r = state.result;
    const baseNote = r.base_oid ? ` · 基准 ${shortOid(r.base_oid)}` : (mbCheck.checked ? ' · 无共同祖先，退化为直接对比' : '');
    statsSpan.innerHTML = '';
    statsSpan.append(
      el('span', { class: 'mono' }, `${shortOid(r.from_oid)} → ${shortOid(r.to_oid)}`),
      `　B 领先 ${r.ahead} 个提交、落后 ${r.behind} 个`,
      `　+${r.insertions} −${r.deletions}`,
      el('span', { class: 'muted' }, baseNote),
    );
  }

  function drawFileList() {
    const box = document.getElementById('cmp-files');
    const count = document.getElementById('cmp-file-count');
    const r = state.result;
    count.textContent = r.files.length;
    box.innerHTML = '';
    if (!r.files.length) {
      box.append(el('div', { class: 'empty-hint' }, '两个版本内容完全一致 🎉'));
      return;
    }
    for (const f of r.files) {
      box.append(el('div', {
        class: 'detail-file',
        style: state.selectedFile === f.path ? { background: 'var(--active)' } : {},
        onclick: () => showFileDiff(f),
      },
      el('span', { class: `chg-${f.change}` }, f.change),
      el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: f.old_path ? `${f.old_path} → ${f.path}` : f.path },
        f.old_path ? `${f.old_path} → ${f.path}` : f.path),
      el('span', { class: 'muted', style: { marginLeft: 'auto', fontSize: '10.5px', flex: '0 0 auto' } },
        `+${f.additions} −${f.deletions}`),
      ));
    }
  }

  function showFileDiff(f) {
    state.selectedFile = f.path;
    drawFileList();
    diffPane.innerHTML = '';
    const card = el('div', { class: 'card' },
      el('div', { class: 'card-h' },
        el('span', { class: `chg-${f.change}` }, f.change),
        el('span', { style: { textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--mono)', fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: f.path }, f.path),
        el('span', { style: { flex: 1 } }),
        f.change !== 'D' ? el('button', {
          class: 'btn mini ghost', title: '在编辑器中打开工作区文件',
          onclick: () => window.CodeView.openFile(f.path),
        }, icon('file', 12), '打开文件') : null,
      ),
      el('div', { class: 'card-b', style: { padding: 0 } }),
    );
    const host = card.querySelector('.card-b');
    host.append(el('div', { class: 'empty-hint' }, el('span', { class: 'spin' }, '⠋'), ' 加载差异…'));
    diffPane.append(card);
    // patch 已随对比结果返回，直接渲染
    setTimeout(() => {
      host.innerHTML = '';
      const grid = renderDiffRows(f.patch, {
        onOpenLine: f.change !== 'D'
          ? (ln) => window.CodeView.openFileAt(f.path, ln)
          : null,
      });
      host.append(grid);
    }, 0);
  }
}
