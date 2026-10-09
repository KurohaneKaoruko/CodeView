// AI 分析：独立主视图（左侧快捷与配置，右侧问答流）
import { api } from '../api.js?v=3';
import { el, icon, toast, errToast } from '../ui.js?v=3';

const state = { history: [] }; // {q, answer, err}

export function render(host) {
  host.innerHTML = '';
  const view = el('div', { class: 'view ai-view' });
  host.append(view);

  // ---------------- 顶部条 ----------------
  const cfgStatus = el('span', { class: 'muted', style: { fontSize: '11.5px' } });
  view.append(el('div', { class: 'view-toolbar' },
    el('span', { class: 'vtitle' }, icon('sparkles', 15), 'AI 分析'),
    el('span', { class: 'sep' }),
    el('span', { class: 'muted', style: { fontSize: '11.5px' } },
      '配置任意 OpenAI 兼容接口；可附带当前文件 / 项目结构 / git 摘要作为上下文'),
    el('span', { style: { flex: 1 } }),
    cfgStatus,
  ));

  // ---------------- 主体 ----------------
  const body = el('div', { class: 'ai-body' });
  view.append(body);

  // 左：快捷 / 上下文 / 提问 / 配置
  const left = el('div', { class: 'ai-side' });
  const right = el('div', { class: 'ai-main' });
  body.append(left, right);

  const ctxFile = el('input', { type: 'checkbox' });
  const ctxTree = el('input', { type: 'checkbox' });
  const ctxGit = el('input', { type: 'checkbox' });
  ctxFile.checked = true;

  const answerBox = el('div', { class: 'ai-stream' });
  drawStream();

  const question = el('textarea', { rows: 3, placeholder: '问点什么…（Ctrl+Enter 发送）', style: { width: '100%', resize: 'vertical' } });
  const sendBtn = el('button', { class: 'btn primary', onclick: () => ask(question.value) }, icon('sparkles', 12), '提问');
  question.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') ask(question.value);
  });

  left.append(
    el('div', { class: 'ai-block' },
      el('div', { class: 'sec-title' }, icon('play', 12), '快捷分析'),
      el('div', { class: 'work-actions' },
        el('button', { class: 'btn mini', onclick: () => quickAsk('file') }, '当前文件'),
        el('button', { class: 'btn mini', onclick: () => quickAsk('project') }, '项目概览'),
        el('button', { class: 'btn mini', onclick: () => quickAsk('git') }, '最近提交'),
      ),
    ),
    el('div', { class: 'ai-block' },
      el('div', { class: 'sec-title' }, '上下文'),
      el('div', { style: { display: 'flex', gap: '14px', flexWrap: 'wrap', padding: '2px 2px 4px' } },
        el('label', { class: 'm-check' }, ctxFile, el('span', {}, '当前文件')),
        el('label', { class: 'm-check' }, ctxTree, el('span', {}, '项目结构')),
        el('label', { class: 'm-check' }, ctxGit, el('span', {}, 'git 摘要')),
      ),
    ),
    el('div', { class: 'ai-block' },
      el('div', { class: 'sec-title' }, '提问'),
      question,
      el('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '6px' } }, sendBtn),
    ),
    cfgBlock(cfgStatus),
  );

  function drawStream() {
    answerBox.innerHTML = '';
    if (!state.history.length) {
      answerBox.append(el('div', { class: 'empty-hint' },
        el('span', { class: 'big' }, '✦'),
        '左侧一键分析，或直接提问；回答会显示在这里'));
      return;
    }
    for (const item of state.history) {
      answerBox.append(el('div', { class: 'ai-q' }, el('span', { class: 'who' }, 'Q'), item.q));
      answerBox.append(el('div', { class: 'ai-a' },
        el('span', { class: 'who' }, 'A'),
        item.err
          ? el('div', { class: 'err-text' }, item.answer)
          : renderMd(item.answer),
      ));
    }
    right.scrollTop = right.scrollHeight;
  }

  async function ask(q) {
    const text = (q || '').trim();
    if (!text) { toast('请输入问题', 'err'); return; }
    state.history.push({ q: text, answer: '', err: false });
    const last = state.history[state.history.length - 1];
    drawStream();
    question.value = '';
    sendBtn.disabled = true;
    // 流式占位
    last.answer = el('span', {}, '').textContent || '思考中…';
    const ph = el('div', { class: 'ai-a' },
      el('span', { class: 'who' }, 'A'),
      el('span', { class: 'muted' }, el('span', { class: 'spin' }, '⠋'), ' AI 思考中…（网络请求，可能需要 10~60 秒）'));
    answerBox.append(ph);
    right.scrollTop = right.scrollHeight;
    try {
      const payload = { question: text, include_tree: ctxTree.checked, include_git: ctxGit.checked };
      if (ctxFile.checked) {
        const path = window.CodeView.activeFile();
        if (path) {
          const f = await api.file(path);
          payload.file = { path, content: f.content };
        }
      }
      const r = await api.aiAsk(payload);
      last.answer = r.answer;
      ph.remove();
      drawStream();
    } catch (e) {
      last.err = true;
      last.answer = e.message;
      ph.remove();
      drawStream();
    } finally {
      sendBtn.disabled = false;
    }
  }

  function quickAsk(kind) {
    const prompts = {
      file: '请分析这个文件：职责、结构、依赖与被依赖、潜在问题与改进建议（附行号）。',
      project: '请分析这个项目：整体结构、各部分职责、关键模块、数据流与上手建议。',
      git: '请分析最近的提交活动：团队在做什么、值得关注的变化与潜在风险。',
    };
    ctxTree.checked = kind === 'project';
    ctxGit.checked = kind === 'git';
    ask(prompts[kind]);
  }

  function cfgBlock(statusEl) {
    const baseUrl = el('input', { type: 'text', placeholder: 'https://api.openai.com/v1', style: { width: '100%' }, spellcheck: 'false' });
    const model = el('input', { type: 'text', placeholder: '模型名，如 gpt-4o-mini', style: { width: '100%' }, spellcheck: 'false' });
    const apiKey = el('input', { type: 'password', placeholder: 'API Key（留空不修改）', style: { width: '100%' }, spellcheck: 'false' });
    api.aiConfig().then((c) => {
      baseUrl.value = c.base_url || '';
      model.value = c.model || '';
      statusEl.textContent = c.has_key ? '密钥已设置' : '未配置密钥';
    }).catch(() => {});
    return el('div', { class: 'ai-block' },
      el('div', { class: 'sec-title' }, icon('edit', 12), '接口配置', el('span', { style: { flex: 1 } }), statusEl),
      baseUrl, model, apiKey,
      el('button', {
        class: 'btn mini primary', style: { marginTop: '6px', alignSelf: 'flex-start' },
        onclick: async () => {
          try {
            const r = await api.aiSetConfig({ base_url: baseUrl.value, model: model.value, api_key: apiKey.value });
            statusEl.textContent = `已保存：${r.model}`;
            toast('AI 配置已保存', 'ok');
          } catch (e) { errToast(e); }
        },
      }, '保存配置'),
    );
  }
}

// 极简 Markdown 渲染
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