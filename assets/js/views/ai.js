// 侧栏 · AI 分析：可配置 OpenAI 兼容接口，内置快捷分析（当前文件 / 项目概览 / 最近提交）
import { api } from '../api.js';
import { el, icon, toast, errToast } from '../ui.js';

export function render(host) {
  host.innerHTML = '';

  // ---- 配置区（默认折叠）----
  const cfgBox = el('div', { class: 'ai-cfg', style: { display: 'none' } });
  const baseUrl = el('input', { type: 'text', placeholder: 'https://api.openai.com/v1', style: { width: '100%' }, spellcheck: 'false' });
  const model = el('input', { type: 'text', placeholder: '模型名，如 gpt-4o-mini', style: { width: '100%' }, spellcheck: 'false' });
  const apiKey = el('input', { type: 'password', placeholder: 'API Key（留空不修改）', style: { width: '100%' }, spellcheck: 'false' });
  const cfgStatus = el('div', { class: 'muted', style: { fontSize: '11px' } });
  const cfgBtn = el('button', { class: 'btn mini ghost', style: { margin: '0 10px' }, onclick: async () => {
    const show = cfgBox.style.display === 'none';
    cfgBox.style.display = show ? '' : 'none';
    cfgBtn.classList.toggle('primary', show);
    if (show) {
      try {
        const c = await api.aiConfig();
        baseUrl.value = c.base_url || '';
        model.value = c.model || '';
        cfgStatus.textContent = c.has_key ? '密钥已设置（留空不修改）' : '尚未设置密钥';
      } catch { /* ignore */ }
    }
  } }, icon('edit', 12), '配置接口');
  cfgBox.append(el('div', { style: { padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' } },
    el('div', {}, el('div', { class: 'muted', style: { fontSize: '11px', marginBottom: '3px' } }, '接口地址'), baseUrl),
    el('div', {}, el('div', { class: 'muted', style: { fontSize: '11px', marginBottom: '3px' } }, '模型'), model),
    el('div', {}, el('div', { class: 'muted', style: { fontSize: '11px', marginBottom: '3px' } }, 'API Key'), apiKey),
    cfgStatus,
    el('button', {
      class: 'btn mini primary',
      onclick: async () => {
        try {
          const r = await api.aiSetConfig({ base_url: baseUrl.value, model: model.value, api_key: apiKey.value });
          toast('AI 配置已保存', 'ok');
          cfgStatus.textContent = `已保存：${r.model}（密钥${r.has_key ? '已设置' : '缺失'}）`;
        } catch (e) { errToast(e); }
      },
    }, '保存配置'),
  ));

  // ---- 快捷分析 ----
  const answerBox = el('div', { class: 'ai-answer' },
    el('div', { class: 'empty-hint' }, el('span', { class: 'big' }, '✦'), '配置接口后即可一键分析或提问'));

  const ask = async (questionText) => {
    if (!questionText || !questionText.trim()) { toast('请输入问题', 'err'); return; }
    answerBox.innerHTML = '';
    answerBox.append(el('div', { class: 'empty-hint' }, el('span', { class: 'spin' }, '⠋'), ' AI 思考中…（可能需要 10~60 秒）'));
    try {
      const payload = { question: questionText, include_tree: ctxTree.checked, include_git: ctxGit.checked };
      if (ctxFile.checked) {
        const path = window.CodeView.activeFile();
        if (path) {
          const f = await api.file(path);
          payload.file = { path, content: f.content };
        }
      }
      const r = await api.aiAsk(payload);
      answerBox.innerHTML = '';
      answerBox.append(renderMd(r.answer));
    } catch (e) {
      answerBox.innerHTML = '';
      answerBox.append(el('div', { class: 'empty-hint', style: { color: 'var(--red)', wordBreak: 'break-all' } }, e.message));
    }
  };

  const quickAsk = (kind) => {
    const prompts = {
      file: '请分析这个文件：它的职责、结构、依赖与被依赖关系、潜在问题与改进建议（请附行号）。',
      project: '请分析这个项目：整体结构、各部分职责、关键模块、数据流与上手建议。',
      git: '请分析最近的提交活动：团队在做什么、有哪些值得关注的变化与潜在风险。',
    };
    ctxTree.checked = kind === 'project';
    ctxGit.checked = kind === 'git';
    ask(prompts[kind]);
  };

  // ---- 自由提问 ----
  const question = el('textarea', { rows: 3, placeholder: '问点什么…（如：这个模块的职责？哪里有 bug？）', style: { width: '100%', resize: 'vertical' } });
  const ctxFile = el('input', { type: 'checkbox' });
  const ctxTree = el('input', { type: 'checkbox' });
  const ctxGit = el('input', { type: 'checkbox' });
  ctxFile.checked = true;
  question.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') ask(question.value);
  });

  host.append(
    el('div', { class: 'ai-quick' },
      el('button', { class: 'btn mini', onclick: () => quickAsk('file') }, '当前文件'),
      el('button', { class: 'btn mini', onclick: () => quickAsk('project') }, '项目概览'),
      el('button', { class: 'btn mini', onclick: () => quickAsk('git') }, '最近提交'),
    ),
    cfgBtn,
    cfgBox,
    el('div', { style: { padding: '10px' } },
      question,
      el('div', { style: { display: 'flex', gap: '10px', marginTop: '6px', flexWrap: 'wrap', alignItems: 'center' } },
        el('label', { class: 'm-check' }, ctxFile, el('span', {}, '当前文件')),
        el('label', { class: 'm-check' }, ctxTree, el('span', {}, '项目结构')),
        el('label', { class: 'm-check' }, ctxGit, el('span', {}, 'git 摘要')),
        el('span', { style: { flex: 1 } }),
        el('button', { class: 'btn mini primary', onclick: () => ask(question.value) }, icon('sparkles', 11), '提问'),
      ),
    ),
    answerBox,
  );
}

// 极简 Markdown 渲染（标题/列表/粗体/行内代码/代码块）
function renderMd(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const span = (htmlText) => {
    const s = el('span');
    s.innerHTML = inline(htmlText);
    return s;
  };
  const box = el('div', { class: 'md' });
  let inCode = false;
  for (const raw of String(md).split('\n')) {
    if (/^```/.test(raw.trim())) { inCode = !inCode; continue; }
    if (inCode) { box.append(el('pre', { class: 'md-code' }, raw)); continue; }
    const line = raw.replace(/\s+$/, '');
    if (/^#{1,4}\s/.test(line)) {
      box.append(el('div', { class: 'md-h' }, span(line.replace(/^#{1,4}\s/, ''))));
    } else if (/^\s*[-*]\s/.test(line)) {
      box.append(el('div', { class: 'md-li' }, el('span', { class: 'bul' }, '•'), span(line.replace(/^\s*[-*]\s/, ''))));
    } else if (/^\s*\d+\.\s/.test(line)) {
      box.append(el('div', { class: 'md-li' }, el('span', { class: 'bul' }, '·'), span(line.replace(/^\s*\d+\.\s/, ''))));
    } else if (!line.trim()) {
      box.append(el('div', { style: { height: '6px' } }));
    } else {
      box.append(el('div', { class: 'md-p' }, span(line)));
    }
  }
  return box;
}