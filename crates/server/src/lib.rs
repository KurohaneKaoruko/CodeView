//! CodeView 服务端：axum HTTP API + 内嵌共享前端静态资源。
//! 同时被 `codeview`（终端 Web 版）与 `codeview-desktop`（Tauri 壳）复用。

use anyhow::{bail, Context, Result};
use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Query, State};
use axum::http::{header, HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use codeview_core::{deps, fsx, gitread, gitwrite, search};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use tokio::sync::oneshot;

mod ai;

// ---------------- 最近打开的项目 ----------------

fn home_dir() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .map(PathBuf::from)
}

fn recent_file() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".codeview").join("recent.json"))
}

fn load_recent() -> Vec<String> {
    let Some(f) = recent_file() else { return vec![] };
    std::fs::read_to_string(f)
        .ok()
        .and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok())
        .unwrap_or_default()
}

fn record_recent(path: &str) {
    let Some(f) = recent_file() else { return };
    if let Some(parent) = f.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut items = load_recent();
    items.retain(|p| !p.eq_ignore_ascii_case(path));
    items.insert(0, path.to_string());
    items.truncate(10);
    if let Ok(t) = serde_json::to_string_pretty(&items) {
        let _ = std::fs::write(f, t);
    }
}

#[derive(Serialize)]
struct RecentList {
    items: Vec<String>,
}

async fn recent() -> Response {
    Json(RecentList { items: load_recent() }).into_response()
}

// ---------------- 目录浏览（供路径下拉的文件夹选择器） ----------------

#[derive(Serialize)]
struct BrowseEntry {
    name: String,
    path: String,
    kind: String, // dir / drive
}

#[derive(Serialize)]
struct BrowseResult {
    current: String,
    parent: Option<String>,
    entries: Vec<BrowseEntry>,
}

fn clean_path(p: &Path) -> String {
    let s = p.to_string_lossy().to_string();
    s.strip_prefix(r"\\?\").map(|x| x.to_string()).unwrap_or(s)
}

async fn browse(Query(q): Query<HashMap<String, String>>) -> Response {
    let raw = q.get("path").cloned().unwrap_or_default();
    let result: Result<BrowseResult> = tokio::task::spawn_blocking(move || {
        if raw.is_empty() {
            // 根：Windows 列出盘符，其他平台列根目录
            let mut entries = Vec::new();
            #[cfg(windows)]
            {
                for c in b'A'..=b'Z' {
                    let drive = format!("{}:\\", c as char);
                    if Path::new(&drive).exists() {
                        entries.push(BrowseEntry {
                            name: format!("{}:", c as char),
                            path: drive.clone(),
                            kind: "drive".into(),
                        });
                    }
                }
            }
            #[cfg(not(windows))]
            {
                entries.push(BrowseEntry {
                    name: "/".into(),
                    path: "/".into(),
                    kind: "drive".into(),
                });
            }
            Ok(BrowseResult { current: String::new(), parent: None, entries })
        } else {
            let p = PathBuf::from(&raw);
            if !p.is_dir() {
                bail!("不是目录: {raw}");
            }
            let current = clean_path(&p);
            let parent = p.parent().map(|x| clean_path(x));
            let mut entries = Vec::new();
            let rd = std::fs::read_dir(&p).map_err(|e| anyhow::anyhow!("读取目录失败: {e}"))?;
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with('.') || name == "target" || name == "node_modules" {
                    continue;
                }
                if e.path().is_dir() {
                    entries.push(BrowseEntry {
                        name,
                        path: clean_path(&e.path()),
                        kind: "dir".into(),
                    });
                }
            }
            entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
            Ok(BrowseResult { current, parent, entries })
        }
    })
    .await
    .unwrap_or_else(|e| Err(anyhow::anyhow!("{e}")));
    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => json_err(format!("{e:#}")),
    }
}

// ---------------- 静态资源（内嵌共享前端） ----------------

#[derive(rust_embed::RustEmbed)]
#[folder = "../../assets"]
struct Assets;

fn mime_of(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        _ => "text/plain; charset=utf-8",
    }
}

async fn static_handler(uri: Uri) -> Response {
    let raw = uri.path().trim_start_matches('/');
    let path = percent_decode(raw);
    let path = if path.is_empty() { "index.html" } else { &path };
    if let Some(content) = Assets::get(path) {
        let mut resp = Response::new(Body::from(content.data.to_vec()));
        resp.headers_mut()
            .insert(header::CONTENT_TYPE, HeaderValue::from_static(mime_of(path)));
        resp.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        );
        return resp;
    }
    if path.starts_with("api/") {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    }
    // 其余路径回退到单页入口
    match Assets::get("index.html") {
        Some(content) => {
            let mut resp = Response::new(Body::from(content.data.to_vec()));
            resp.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("text/html; charset=utf-8"),
            );
            resp
        }
        None => (StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if let (Some(h), Some(l)) = (
                bytes.get(i + 1).and_then(|b| (*b as char).to_digit(16)),
                bytes.get(i + 2).and_then(|b| (*b as char).to_digit(16)),
            ) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

// ---------------- 应用状态 ----------------

/// 窗口动作回调（桌面端注入，Web 端为 None）
pub type WindowActionFn = std::sync::Arc<dyn Fn(&str) + Send + Sync>;

struct App {
    root: RwLock<PathBuf>,
    desktop: bool,
    window_action: Option<WindowActionFn>,
}

fn with_root<T>(app: &App, f: impl FnOnce(&Path) -> Result<T>) -> Result<T> {
    let root = app.root.read().unwrap().clone();
    f(&root)
}

async fn blocking<F>(f: F) -> Response
where
    F: FnOnce() -> Response + Send + 'static,
{
    let (tx, rx) = oneshot::channel();
    tokio::task::spawn_blocking(move || {
        let _ = tx.send(f());
    });
    rx.await.unwrap_or_else(|_| json_err("内部任务已取消".into()))
}

// ---------------- API 层 ----------------

#[derive(Serialize)]
struct Overview {
    root: String,
    name: String,
    is_git: bool,
    desktop: bool,
}

fn json_err(msg: String) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": msg }))).into_response()
}

fn api_result<T: Serialize, F>(f: F) -> Response
where
    F: FnOnce() -> Result<T>,
{
    match f() {
        Ok(v) => Json(v).into_response(),
        Err(e) => json_err(format!("{e:#}")),
    }
}

async fn overview(State(app): State<std::sync::Arc<App>>) -> Response {
    let root = app.root.read().unwrap().clone();
    let is_git = gitread::open(&root).is_ok();
    Json(Overview {
        root: clean_path(&root),
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| root.to_string_lossy().to_string()),
        is_git,
        desktop: app.desktop,
    })
    .into_response()
}

#[derive(Deserialize)]
struct OpenReq {
    path: String,
}

async fn open_project(State(app): State<std::sync::Arc<App>>, Json(req): Json<OpenReq>) -> Response {
    let p = PathBuf::from(&req.path);
    let p = match p.canonicalize() {
        Ok(p) => p,
        Err(e) => return json_err(format!("路径不存在: {}: {e}", req.path)),
    };
    if !p.is_dir() {
        return json_err("不是目录".into());
    }
    *app.root.write().unwrap() = p.clone();
    record_recent(&clean_path(&p));
    overview(State(app)).await
}

async fn tree(
    State(app): State<std::sync::Arc<App>>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    blocking(move || {
        api_result(|| {
            let path = q.get("path").cloned().unwrap_or_default();
            with_root(&app, |root| fsx::list_dir(root, &path))
        })
    })
    .await
}

async fn get_file(
    State(app): State<std::sync::Arc<App>>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    blocking(move || {
        api_result(|| {
            let path = q.get("path").cloned().unwrap_or_default();
            with_root(&app, |root| fsx::read_file(root, &path))
        })
    })
    .await
}

#[derive(Deserialize)]
struct WriteReq {
    path: String,
    content: String,
}

async fn put_file(State(app): State<std::sync::Arc<App>>, Json(req): Json<WriteReq>) -> Response {
    blocking(move || {
        api_result(|| with_root(&app, |root| fsx::write_file(root, &req.path, &req.content)))
    })
    .await
}

#[derive(Deserialize)]
struct PathReq {
    path: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    to: String,
}

async fn delete_file(State(app): State<std::sync::Arc<App>>, Json(req): Json<PathReq>) -> Response {
    blocking(move || api_result(|| with_root(&app, |root| fsx::delete_path(root, &req.path)))).await
}

async fn create_file(State(app): State<std::sync::Arc<App>>, Json(req): Json<PathReq>) -> Response {
    blocking(move || {
        api_result(|| with_root(&app, |root| fsx::create_path(root, &req.path, &req.kind)))
    })
    .await
}

async fn rename_file(State(app): State<std::sync::Arc<App>>, Json(req): Json<PathReq>) -> Response {
    blocking(move || {
        api_result(|| with_root(&app, |root| fsx::rename_path(root, &req.path, &req.to)))
    })
    .await
}

// ---------------- Git API ----------------

async fn git_status(State(app): State<std::sync::Arc<App>>) -> Response {
    blocking(move || {
        api_result(|| with_root(&app, |root| gitread::status(&gitread::open(root)?)))
    })
    .await
}

async fn git_refs(State(app): State<std::sync::Arc<App>>) -> Response {
    blocking(move || {
        api_result(|| with_root(&app, |root| gitread::refs(&gitread::open(root)?)))
    })
    .await
}

async fn git_log(
    State(app): State<std::sync::Arc<App>>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    blocking(move || {
        api_result(|| {
            with_root(&app, |root| {
                let repo = gitread::open(root)?;
                let limit: usize = q
                    .get("limit")
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(400)
                    .min(3000);
                let skip: usize = q.get("skip").and_then(|v| v.parse().ok()).unwrap_or(0);
                let filter = q.get("ref").filter(|s| !s.is_empty()).map(|s| {
                    if s.contains('/') && !s.starts_with("refs/") {
                        format!("refs/remotes/{s}")
                    } else if !s.contains('/') {
                        format!("refs/heads/{s}")
                    } else {
                        s.clone()
                    }
                });
                gitread::log(&repo, limit, skip, filter.as_deref())
            })
        })
    })
    .await
}

async fn git_file_diff(
    State(app): State<std::sync::Arc<App>>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    blocking(move || {
        api_result(|| {
            with_root(&app, |root| {
                let repo = gitread::open(root)?;
                let path = q.get("path").cloned().unwrap_or_default();
                let staged = q
                    .get("staged")
                    .map(|v| v == "1" || v == "true")
                    .unwrap_or(false);
                gitread::file_diff(&repo, &path, staged)
            })
        })
    })
    .await
}

async fn git_commit_detail(
    State(app): State<std::sync::Arc<App>>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    blocking(move || {
        api_result(|| {
            with_root(&app, |root| {
                let repo = gitread::open(root)?;
                let oid = q.get("oid").cloned().unwrap_or_default();
                gitread::commit_detail(&repo, &oid)
            })
        })
    })
    .await
}

async fn git_compare(
    State(app): State<std::sync::Arc<App>>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    blocking(move || {
        api_result(|| {
            with_root(&app, |root| {
                let repo = gitread::open(root)?;
                let from = q.get("from").cloned().unwrap_or_default();
                let to = q.get("to").cloned().unwrap_or_default();
                if from.is_empty() || to.is_empty() {
                    bail!("from 与 to 不能为空");
                }
                let mb = q.get("mb").map(|v| v == "1" || v == "true").unwrap_or(false);
                gitread::compare(&repo, &from, &to, mb)
            })
        })
    })
    .await
}

#[derive(Deserialize)]
struct PathsReq {
    #[serde(default)]
    paths: Vec<String>,
}

async fn git_stage(State(app): State<std::sync::Arc<App>>, Json(req): Json<PathsReq>) -> Response {
    blocking(move || {
        api_result(|| {
            with_root(&app, |root| {
                gitwrite::with_lock(|| gitwrite::stage(root, &req.paths))
            })
        })
    })
    .await
}

async fn git_unstage(State(app): State<std::sync::Arc<App>>, Json(req): Json<PathsReq>) -> Response {
    blocking(move || {
        api_result(|| {
            with_root(&app, |root| {
                gitwrite::with_lock(|| gitwrite::unstage(root, &req.paths))
            })
        })
    })
    .await
}

#[derive(Deserialize)]
struct CommitReq {
    message: String,
    #[serde(default)]
    amend: bool,
}

async fn git_commit(State(app): State<std::sync::Arc<App>>, Json(req): Json<CommitReq>) -> Response {
    blocking(move || {
        api_result(|| {
            with_root(&app, |root| {
                gitwrite::with_lock(|| gitwrite::commit(root, &req.message, req.amend))
            })
        })
    })
    .await
}

#[derive(Deserialize)]
struct ActionReq {
    op: String,
    #[serde(default)]
    target: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    action: String,
    #[serde(default)]
    mode: String,
    #[serde(default)]
    remote: String,
    #[serde(default)]
    branch: String,
    #[serde(default)]
    start: String,
    #[serde(default)]
    onto: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    index: Option<usize>,
    #[serde(default)]
    paths: Vec<String>,
    #[serde(default)]
    force: bool,
    #[serde(default)]
    set_upstream: bool,
    #[serde(default)]
    no_ff: bool,
    #[serde(default)]
    squash: bool,
    #[serde(default)]
    prune: bool,
    #[serde(default)]
    no_commit: bool,
    #[serde(default)]
    new_branch: bool,
}

async fn git_action(
    State(app): State<std::sync::Arc<App>>,
    Json(req): Json<ActionReq>,
) -> Response {
    blocking(move || {
        api_result(|| {
            with_root(&app, |root| {
                gitwrite::with_lock(|| {
                    let r = match req.op.as_str() {
                        "fetch" => gitwrite::fetch(root, &req.remote, req.prune)?,
                        "pull" => gitwrite::pull(root, &req.mode, &req.remote, &req.branch)?,
                        "push" => {
                            gitwrite::push(root, &req.remote, &req.branch, req.set_upstream, req.force)?
                        }
                        "checkout" => {
                            let target = if req.target.is_empty() {
                                req.branch.clone()
                            } else {
                                req.target.clone()
                            };
                            gitwrite::checkout(
                                root,
                                &target,
                                req.new_branch,
                                if req.start.is_empty() { None } else { Some(&req.start) },
                            )?
                        }
                        "branch" => gitwrite::branch(
                            root,
                            &req.action,
                            &req.name,
                            if req.start.is_empty() { None } else { Some(&req.start) },
                        )?,
                        "merge" => gitwrite::merge(root, &req.target, req.no_ff, req.squash)?,
                        "rebase" => gitwrite::rebase(
                            root,
                            &req.target,
                            if req.onto.is_empty() { None } else { Some(&req.onto) },
                        )?,
                        "continue" => gitwrite::continue_op(root, &req.action)?,
                        "abort" => gitwrite::abort_op(root, &req.action)?,
                        "revert" => gitwrite::revert(root, &req.target, req.no_commit)?,
                        "cherry-pick" => gitwrite::cherry_pick(root, &req.target)?,
                        "reset" => gitwrite::reset(root, &req.mode, &req.target)?,
                        "discard" => gitwrite::discard(root, &req.paths)?,
                        "stash" => gitwrite::stash(
                            root,
                            &req.action,
                            if req.message.is_empty() { None } else { Some(&req.message) },
                            req.index,
                        )?,
                        other => bail!("未知操作: {other}"),
                    };
                    Ok(r)
                })
            })
        })
    })
    .await
}

// ---------------- 搜索 API ----------------

async fn api_search(
    State(app): State<std::sync::Arc<App>>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    blocking(move || {
        api_result(|| {
            with_root(&app, |root| {
                let query = q.get("q").cloned().unwrap_or_default();
                let cs = q.get("cs").map(|v| v == "1" || v == "true").unwrap_or(false);
                let rx = q.get("re").map(|v| v == "1" || v == "true").unwrap_or(false);
                search::search(root, &query, cs, rx)
            })
        })
    })
    .await
}

// ---------------- AI API ----------------

async fn ai_get_config() -> Response {
    Json(ai::public_config(&ai::load_config())).into_response()
}

#[derive(Deserialize)]
struct AiConfigReq {
    base_url: String,
    model: String,
    #[serde(default)]
    api_key: String,
}

async fn ai_set_config(Json(req): Json<AiConfigReq>) -> Response {
    let mut cfg = ai::load_config();
    cfg.base_url = req.base_url.trim().to_string();
    cfg.model = req.model.trim().to_string();
    if !req.api_key.trim().is_empty() {
        cfg.api_key = req.api_key.trim().to_string();
    }
    match ai::save_config(&cfg) {
        Ok(()) => Json(ai::public_config(&cfg)).into_response(),
        Err(e) => json_err(format!("保存配置失败: {e:#}")),
    }
}

async fn ai_ask(State(app): State<std::sync::Arc<App>>, Json(req): Json<ai::AskReq>) -> Response {
    blocking(move || {
        api_result(|| {
            with_root(&app, |root| {
                let tree = if req.include_tree { Some(collect_tree(root)) } else { None };
                let git = if req.include_git { collect_git(root) } else { None };
                let answer = ai::ask(&req, tree, git)?;
                Ok(json!({ "answer": answer }))
            })
        })
    })
    .await
}

/// 收集项目结构（前两层目录 + 文件数）
fn collect_tree(root: &Path) -> String {
    use std::collections::BTreeMap;
    let walker = ignore::WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .build();
    let mut dirs: BTreeMap<String, usize> = BTreeMap::new();
    let mut files: Vec<String> = Vec::new();
    for e in walker.flatten() {
        if !e.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let rel = match e.path().strip_prefix(root) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        let parts: Vec<&str> = rel.split('/').collect();
        if parts.len() <= 1 {
            files.push(rel);
        } else {
            *dirs.entry(format!("{}/", parts[..parts.len() - 1].join("/"))).or_default() += 1;
            if files.len() < 400 {
                files.push(rel);
            }
        }
        if dirs.len() + files.len() > 600 {
            break;
        }
    }
    let mut out = String::new();
    for (d, n) in dirs.iter().take(150) {
        out.push_str(&format!("{d}  ({n} 个文件)\n"));
    }
    for f in files.iter().take(400) {
        out.push_str(f);
        out.push('\n');
    }
    out
}

/// 收集 git 摘要：当前分支、状态统计、最近 30 条提交
fn collect_git(root: &Path) -> Option<String> {
    let repo = gitread::open(root).ok()?;
    let st = gitread::status(&repo).ok()?;
    let refs = gitread::refs(&repo).ok()?;
    let log = gitread::log(&repo, 30, 0, None).unwrap_or_default();
    let mut out = String::new();
    out.push_str(&format!(
        "当前分支: {}\n",
        st.head_branch.clone().unwrap_or_else(|| "(detached)".into())
    ));
    out.push_str(&format!(
        "变更: 暂存 {} / 未暂存 {} / 未跟踪 {}\n",
        st.staged.len(),
        st.unstaged.len(),
        st.untracked.len()
    ));
    out.push_str(&format!("分支数: {}\n最近提交:\n", refs.locals.len()));
    for c in log.iter() {
        out.push_str(&format!("{} {}", &c.oid[..7.min(c.oid.len())], c.subject));
        out.push('\n');
    }
    Some(out)
}

// ---------------- 系统文件管理器 ----------------

/// 用操作系统自带的文件管理器打开目录（Windows 资源管理器 / macOS Finder / Linux 文件管理器）
async fn api_open_native(Query(q): Query<HashMap<String, String>>) -> Response {
    let path = q.get("path").cloned().unwrap_or_default();
    if path.is_empty() {
        return json_err("缺少 path 参数".into());
    }
    let p = PathBuf::from(&path);
    if !p.exists() {
        return json_err(format!("路径不存在: {path}"));
    }
    let target = if p.is_dir() { p.clone() } else {
        p.parent().map(|x| x.to_path_buf()).unwrap_or(p.clone())
    };
    let spawn = |program: &str, args: &[String]| -> Result<()> {
        std::process::Command::new(program)
            .args(args)
            .spawn()
            .with_context(|| format!("启动 {program} 失败"))?;
        Ok(())
    };
    let r = if cfg!(windows) {
        spawn("explorer.exe", &[target.to_string_lossy().to_string()])
    } else if cfg!(target_os = "macos") {
        spawn("open", &[target.to_string_lossy().to_string()])
    } else {
        spawn("xdg-open", &[target.to_string_lossy().to_string()])
    };
    match r {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(e) => json_err(format!("{e:#}")),
    }
}

// ---------------- 系统目录选择（原生对话框） ----------------

/// 弹出操作系统原生的目录选择对话框（rfd），返回用户选择的路径。
async fn api_pick_dir() -> Response {
    blocking(move || {
        api_result(|| {
            let picked = blocking_pick_folder();
            Ok(json!({ "path": picked.map(|p| clean_path(&p)) }))
        })
    })
    .await
}

fn blocking_pick_folder() -> Option<PathBuf> {
    rfd::FileDialog::new()
        .set_title("选择项目目录")
        .pick_folder()
}

// ---------------- 桌面窗口控制（经服务端转发到 AppHandle） ----------------

#[derive(Deserialize)]
struct WinActionReq {
    action: String,
}

async fn desktop_win(State(app): State<std::sync::Arc<App>>, Json(req): Json<WinActionReq>) -> Response {
    let Some(f) = app.window_action.clone() else {
        return json_err("非桌面模式".into());
    };
    f(&req.action);
    Json(json!({ "ok": true })).into_response()
}

// ---------------- 依赖分析 API ----------------

async fn deps_graph(State(app): State<std::sync::Arc<App>>) -> Response {
    blocking(move || api_result(|| with_root(&app, deps::graph))).await
}

async fn deps_symbols(
    State(app): State<std::sync::Arc<App>>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    blocking(move || {
        api_result(|| {
            with_root(&app, |root| {
                let path = q.get("path").cloned().unwrap_or_default();
                deps::symbols_in_file(root, &path)
            })
        })
    })
    .await
}

async fn deps_refs(
    State(app): State<std::sync::Arc<App>>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    blocking(move || {
        api_result(|| {
            with_root(&app, |root| {
                let path = q.get("path").cloned().unwrap_or_default();
                let symbol = q.get("symbol").cloned().unwrap_or_default();
                deps::symbol_refs(root, &path, &symbol)
            })
        })
    })
    .await
}

// ---------------- 路由 & 启动 ----------------

fn router(app: std::sync::Arc<App>) -> Router {
    Router::new()
        .route("/api/overview", get(overview))
        .route("/api/open", post(open_project))
        .route("/api/recent", get(recent))
        .route("/api/browse", get(browse))
        .route("/api/open_native", get(api_open_native))
        .route("/api/pick_dir", get(api_pick_dir))
        .route("/api/desktop/win", post(desktop_win))
        .route("/api/tree", get(tree))
        .route("/api/file", get(get_file).put(put_file))
        .route("/api/file/delete", post(delete_file))
        .route("/api/file/create", post(create_file))
        .route("/api/file/rename", post(rename_file))
        .route("/api/git/status", get(git_status))
        .route("/api/git/refs", get(git_refs))
        .route("/api/git/log", get(git_log))
        .route("/api/git/file_diff", get(git_file_diff))
        .route("/api/git/compare", get(git_compare))
        .route("/api/git/stage", post(git_stage))
        .route("/api/git/unstage", post(git_unstage))
        .route("/api/git/commit", get(git_commit_detail).post(git_commit))
        .route("/api/git/action", post(git_action))
        .route("/api/deps/graph", get(deps_graph))
        .route("/api/deps/symbols", get(deps_symbols))
        .route("/api/deps/refs", get(deps_refs))
        .route("/api/search", get(api_search))
        .route("/api/ai/config", get(ai_get_config).post(ai_set_config))
        .route("/api/ai/ask", post(ai_ask))
        .fallback(static_handler)
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
        .with_state(app)
}

/// 绑定端口并以后台任务方式启动 HTTP 服务，返回实际端口。
pub async fn start_server(
    root: PathBuf,
    port: u16,
    desktop: bool,
    window_action: Option<WindowActionFn>,
) -> Result<u16> {
    record_recent(&clean_path(&root));
    let app_state = std::sync::Arc::new(App {
        root: RwLock::new(root),
        desktop,
        window_action,
    });
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await;
    let listener = match listener {
        Ok(l) => l,
        Err(e) if port != 0 => {
            eprintln!("端口 {port} 被占用（{e}），尝试自动分配…");
            tokio::net::TcpListener::bind(("127.0.0.1", 0)).await?
        }
        Err(e) => return Err(e.into()),
    };
    let actual = listener.local_addr()?.port();
    let app = router(app_state);
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("HTTP 服务异常退出: {e:#}");
        }
    });
    Ok(actual)
}
