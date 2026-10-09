//! CodeView 服务端：axum HTTP API + 内嵌共享前端静态资源。
//! 同时被 `codeview`（终端 Web 版）与 `codeview-desktop`（Tauri 壳）复用。

use anyhow::{bail, Result};
use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Query, State};
use axum::http::{header, HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use codeview_core::{deps, fsx, gitread, gitwrite};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use tokio::sync::oneshot;

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

struct App {
    root: RwLock<PathBuf>,
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

fn clean_path(p: &Path) -> String {
    let s = p.to_string_lossy().to_string();
    s.strip_prefix(r"\\?\").map(|x| x.to_string()).unwrap_or(s)
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
    *app.root.write().unwrap() = p;
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
        .route("/api/tree", get(tree))
        .route("/api/file", get(get_file).put(put_file))
        .route("/api/file/delete", post(delete_file))
        .route("/api/file/create", post(create_file))
        .route("/api/file/rename", post(rename_file))
        .route("/api/git/status", get(git_status))
        .route("/api/git/refs", get(git_refs))
        .route("/api/git/log", get(git_log))
        .route("/api/git/file_diff", get(git_file_diff))
        .route("/api/git/stage", post(git_stage))
        .route("/api/git/unstage", post(git_unstage))
        .route("/api/git/commit", get(git_commit_detail).post(git_commit))
        .route("/api/git/action", post(git_action))
        .route("/api/deps/graph", get(deps_graph))
        .route("/api/deps/symbols", get(deps_symbols))
        .route("/api/deps/refs", get(deps_refs))
        .fallback(static_handler)
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
        .with_state(app)
}

/// 绑定端口并以后台任务方式启动 HTTP 服务，返回实际端口。
pub async fn start_server(root: PathBuf, port: u16) -> Result<u16> {
    let app_state = std::sync::Arc::new(App {
        root: RwLock::new(root),
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
