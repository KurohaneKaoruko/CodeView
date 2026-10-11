// API 封装
async function handle(resp) {
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try {
      const j = await resp.json();
      if (j && j.error) msg = j.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return resp.json();
}

export const api = {
  overview: () => fetch('/api/overview').then(handle),
  openProject: (path) =>
    fetch('/api/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) }).then(handle),
  recent: () => fetch('/api/recent').then(handle),
  browse: (path = '') => fetch(`/api/browse?path=${encodeURIComponent(path)}`).then(handle),
  tree: (path = '') => fetch(`/api/tree?path=${encodeURIComponent(path)}`).then(handle),
  file: (path) => fetch(`/api/file?path=${encodeURIComponent(path)}`).then(handle),
  saveFile: (path, content) =>
    fetch('/api/file', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content }) }).then(handle),
  createFile: (path, kind) =>
    fetch('/api/file/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, kind }) }).then(handle),
  deleteFile: (path) =>
    fetch('/api/file/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) }).then(handle),
  renameFile: (path, to) =>
    fetch('/api/file/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, to }) }).then(handle),

  gitStatus: () => fetch('/api/git/status').then(handle),
  gitRefs: () => fetch('/api/git/refs').then(handle),
  gitLog: (limit = 400, skip = 0, ref = '') =>
    fetch(`/api/git/log?limit=${limit}&skip=${skip}&ref=${encodeURIComponent(ref)}`).then(handle),
  gitFileDiff: (path, staged = false) =>
    fetch(`/api/git/file_diff?path=${encodeURIComponent(path)}&staged=${staged ? 1 : 0}`).then((r) => r.text()),
  gitCommit: (oid) => fetch(`/api/git/commit?oid=${encodeURIComponent(oid)}`).then(handle),
  gitStats: (limit = 300, ref = '') =>
    fetch(`/api/git/stats?limit=${limit}&ref=${encodeURIComponent(ref)}`).then(handle),
  gitCompare: (from, to, mb = false) =>
    fetch(`/api/git/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&mb=${mb ? 1 : 0}`).then(handle),
  gitStage: (paths) =>
    fetch('/api/git/stage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths }) }).then(handle),
  gitUnstage: (paths) =>
    fetch('/api/git/unstage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths }) }).then(handle),
  gitCommitMsg: (message, amend = false) =>
    fetch('/api/git/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, amend }) }).then(handle),
  gitAction: (payload) =>
    fetch('/api/git/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(handle),

  depsGraph: () => fetch('/api/deps/graph').then(handle),
  depsSymbols: (path) => fetch(`/api/deps/symbols?path=${encodeURIComponent(path)}`).then(handle),
  depsRefs: (path, symbol) => fetch(`/api/deps/refs?path=${encodeURIComponent(path)}&symbol=${encodeURIComponent(symbol)}`).then(handle),

  search: (q, cs = false, re = false) =>
    fetch(`/api/search?q=${encodeURIComponent(q)}&cs=${cs ? 1 : 0}&re=${re ? 1 : 0}`).then(handle),
  files: () => fetch('/api/files').then(handle),

  pickDir: () => fetch('/api/pick_dir').then(handle),

  aiConfig: () => fetch('/api/ai/config').then(handle),
  aiSetConfig: (cfg) =>
    fetch('/api/ai/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) }).then(handle),
  aiAsk: (payload) =>
    fetch('/api/ai/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(handle),
};
