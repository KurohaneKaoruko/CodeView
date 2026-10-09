// AI 分析：独立视图 —— 顶部工具栏 / 对话流（空状态含快捷分析）/ 底部输入条；接口配置走弹窗
import { api } from '../api.js?v=3';
import { el, icon, toast, errToast, formModal, renderDiffRows } from '../ui.js?v=3';

const state = { history: [] };
const ctx = { file: true, tree: false, git: false };
const QUICK_ACTIONS = [
  ['当前文件', 'file'],
  ['项目结构', 'project'],
  ['代码质量', 'quality'],
  ['最近提交', 'git'],
];

export function render(host) {
  host.innerHTML = '';
  const view = el('div', { class: 'view ai-view' });
  host.append(view);

  // ---------------- 工具栏 ----------------
  const cfgBtn = el('button', { class: 'btn ghost mini', title: '接口配置', onclick: openCfg }, icon('sliders', 13), '接口配置');
  view.append(el('div', { class: 'view-toolbar' },
    el('span', { class: 'vtitle' }, icon('sparkles', 15), 'AI 分析'),
    el('span', { class: 'sep' }),
    el('span', { class: 'muted', style: { fontSize: '11.5px' } }, '只读分析：项目结构 · 代码质量 · 可输出总结文档（不会修改代码）'),
    el('span', { style: { flex: 1 } }),
    cfgBtn,
  ));

  // ---------------- 对话流 ----------------
  const streamWrap = el('div', { class: 'ai-stream-wrap' });
  const stream = el('div', { class: 'ai-stream' });
  streamWrap.append(stream);
  view.append(streamWrap);

  // ---------------- 底部输入条 ----------------
  const ctxFile = el('input', { type: 'checkbox' }); ctxFile.checked = ctx.file;
  const ctxTree = el('input', { type: 'checkbox' }); ctxTree.checked = ctx.tree;
  const ctxGit = el('input', { type: 'checkbox' }); ctxGit.checked = ctx.git;
  [ctxFile, ctxTree, ctxGit].forEach((c, i) => c.addEventListener('change', () => {
    ctx.file = ctxFile.checked; ctx.tree = ctxTree.checked; ctx.git = ctxGit.checked;
    void i;
  }));

  const ta = el('textarea', { class: 'ai-input', rows: 1, placeholder: '问点什么…（Ctrl+Enter 发送）' });
  const autoGrow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`; };
  ta.addEventListener('input', autoGrow);
  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); ask(ta.value); }
  });
  const sendBtn = el('button', { class: 'btn primary', title: '发送 (Ctrl+Enter)', onclick: () => ask(ta.value) }, icon('sparkles', 13));

  view.append(el('div', { class: 'ai-inputbar' },
    el('div', { class: 'ai-ctx' },
      el('label', { class: 'm-check' }, ctxFile, el('span', {}, '当前文件')),
      el('label', { class: 'm-check' }, ctxTree, el('span', {}, '项目结构')),
      el('label', { class: 'm-check' }, ctxGit, el('span', {}, 'git 摘要')),
    ),
    el('div', { class: 'ai-inputrow' }, ta, sendBtn),
  ));

  drawStream();

  // ---------------- 渲染对话流 ----------------
  function drawStream() {
    stream.innerHTML = '';
    if (!state.history.length) {
      stream.append(el('div', { class: 'ai-empty' },
        el('div', { class: 'big' }, '✦'),
        el('div', { class: 't' }, '一键分析，或直接提问'),
        el('div', { class: 'ai-empty-btns' },
          QUICK_ACTIONS.map(([label, kind]) => quickBtn(label, kind)),
        ),
        el('div', { class: 'muted', style: { fontSize: '11.5px' } }, '回答将显示在这里 · 上下文勾选在下方输入条'),
      ));
      return;
    }
    for (const item of state.history) {
      stream.append(el('div', { class: 'ai-q' }, item.q));
      stream.append(aBubble(item));
    }
    scrollBottom();
  }

  function quickBtn(label, kind) {
    return el('button', { class: 'btn mini', onclick: () => quickAsk(kind) }, label);
  }

  function aBubble(item) {
    const actions = !item.pending && !item.err ? el('span', { class: 'ai-actions' },
      el('button', {
        class: 'icon-btn', title: '保存为总结文档（docs/ai/）',
        onclick: () => saveDoc(item),
      }, icon('save', 12)),
      el('button', {
        class: 'icon-btn', title: '复制内容',
        onclick: () => navigator.clipboard.writeText(item.answer).then(() => toast('已复制', 'ok')),
      }, icon('copy', 12)),
    ) : null;
    if (item.pending) {
      return el('div', { class: 'ai-a' },
        el('span', { class: 'who' }, 'A'),
        el('div', { style: { flex: 1 } },
          el('span', { class: 'muted' }, el('span', { class: 'spin' }, '⠋'), ' AI 思考中…（可能需要 10~60 秒）')));
    }
    if (item.err) {
      return el('div', { class: 'ai-a' },
        el('span', { class: 'who' }, 'A'),
        el('div', { class: 'err-text' }, item.answer));
    }
    return el('div', { class: 'ai-a' },
      el('span', { class: 'who' }, 'A'),
      el('div', { class: 'md-wrap' }, renderMd(item.answer)),
      actions);
  }

  async function saveDoc(item) {
    const d = new Date();
    const p2 = (x) => String(x).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    const path = `docs/ai/AI分析-${stamp}.md`;
    const content = `# AI 分析报告\n\n> 时间：${d.toLocaleString()}\n> 问题：${item.q}\n\n---\n\n${item.answer}\n`;
    try {
      await api.saveFile(path, content);
      toast(`已保存到 ${path}`, 'ok');
      window.CodeView.gitChanged();
    } catch (e) { errToast(e); }
  }

  function scrollBottom() {
    streamWrap.scrollTop = streamWrap.scrollHeight;
  }

  // ---------------- 提问 ----------------
  async function ask(q) {
    const text = (q || '').trim();
    if (!text) { toast('请输入问题', 'err'); return; }
    ctx.file = ctxFile.checked; ctx.tree = ctxTree.checked; ctx.git = ctxGit.checked;
    const item = { q: text, answer: '', err: false, pending: true };
    state.history.push(item);
    ta.value = ''; autoGrow();
    drawStream();
    try {
      const payload = { question: text, include_tree: ctx.tree, include_git: ctx.git };
      if (ctx.file) {
        const path = window.CodeView.activeFile();
        if (path) {
          const f = await api.file(path);
          payload.file = { path, content: f.content };
        }
      }
      const r = await api.aiAsk(payload);
      item.answer = r.answer;
      item.pending = false;
    } catch (e) {
      item.err = true;
      item.answer = e.message;
      item.pending = false;
    }
    drawStream();
  }

  function quickAsk(kind) {
    const prompts = {
      file: '请分析当前文件：职责、结构、潜在 bug、代码质量问题与改进建议（附行号）。',
      project: '请分析这个项目的整体结构：模块划分、各部分职责、依赖关系与上手建议。',
      quality: '请评估这个项目的代码质量：命名与结构、重复代码、潜在缺陷、错误处理、测试情况，并给出改进优先级。',
      git: '请分析最近的提交活动：团队在做什么、值得关注的变化与潜在风险。',
    };
    ctxTree.checked = kind === 'project' || kind === 'quality';
    ctxGit.checked = kind === 'git' || kind === 'quality';
    drawStream();
    ask(prompts[kind]);
  }

  // ---------------- 接口配置（弹窗） ----------------
  async function openCfg() {
    const c = await api.aiConfig().catch(() => ({ base_url: '', model: '', has_key: false }));
    const r = await formModal({
      title: '接口配置（OpenAI 兼容）', icon: 'sliders',
      fields: [
        { key: 'base_url', label: '接口地址', value: c.base_url || '', placeholder: 'https://api.openai.com/v1' },
        { key: 'model', label: '模型', value: c.model || '', placeholder: '如 gpt-4o-mini' },
        { key: 'api_key', label: `API Key${c.has_key ? '（留空不修改）' : ''}`, type: 'password', placeholder: 'sk-…' },
      ],
      okText: '保存',
    });
    if (!r) return;
    try {
      const saved = await api.aiSetConfig({ base_url: r.base_url, model: r.model, api_key: r.api_key });
      cfgBtn.classList.add('primary');
      setTimeout(() => cfgBtn.classList.remove('primary'), 600);
      toast(`AI 配置已保存：${saved.model}${saved.has_key ? '' : '（未设置密钥）'}`, 'ok');
    } catch (e) { errToast(e); }
  }
}

// 极简 Markdown 渲染（标题/列表/粗体/行内代码/代码块）
function renderMd(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const span = (t) => { const s = el('span'); s.innerHTML = inline(t); return s; };
  const box = el('div', { class: 'md' });
  let inCode = false;
  for (const raw of String(md).split('\n')) {
    if (/^```/.test(raw.trim())) { inCode = !inCode; continue; }
    if (inCode) { box.append(el('pre', { class: 'md-code' }, raw)); continue; }
    const line = raw.replace(/\s+$/, '');
    if (/^#{1,4}\s/.test(line)) box.append(el('div', { class: 'md-h' }, span(line.replace(/^#{1,4}\s/, ''))));
    else if (/^\s*[-*]\s/.test(line)) box.append(el('div', { class: 'md-li' }, el('span', { class: 'bul' }, '•'), span(line.replace(/^\s*[-*]\s/, ''))));
    else if (/^\s*\d+\.\s/.test(line)) box.append(el('div', { class: 'md-li' }, el('span', { class: 'bul' }, '·'), span(line.replace(/^\s*\d+\.\s/, ''))));
    else if (!line.trim()) box.append(el('div', { style: { height: '6px' } }));
    else box.append(el('div', { class: 'md-p' }, span(line)));
  }
  return box;
}