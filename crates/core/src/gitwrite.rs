//! Git 写入层：通过系统 git CLI 执行变更类操作，保证与真实 git
//! 的认证、hooks、冲突处理行为完全一致。

use anyhow::{anyhow, bail, Context, Result};
use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Serialize, Clone, Debug)]
pub struct OpResult {
    pub ok: bool,
    pub code: i32,
    pub op: String,
    pub output: String,
    pub conflict: bool,
    pub conflicts: Vec<String>,
    pub in_progress: Option<String>,
}

impl OpResult {
    fn plain(op: &str, out: String, code: i32) -> Self {
        OpResult {
            ok: code == 0,
            code,
            op: op.to_string(),
            output: out,
            conflict: false,
            conflicts: vec![],
            in_progress: None,
        }
    }
}

const TIMEOUT_HINT: &str = "提示：push/pull 需要网络与凭据，本工具已禁用终端交互提示（GIT_TERMINAL_PROMPT=0），请先在系统 git 凭据管理器中保存凭据。";

/// 运行 git 子命令（自动加 -C root），返回合并后的输出。
pub fn run(root: &Path, op: &str, args: &[&str]) -> Result<OpResult> {
    if !root.is_dir() {
        bail!("项目目录不存在: {}", root.display());
    }
    let mut cmd = Command::new("git");
    cmd.current_dir(root)
        .arg("-C")
        .arg(root)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .args(args);
    let out = cmd
        .output()
        .map_err(|e| anyhow!("无法启动 git（请确认已安装并在 PATH 中）: {e}"))?;
    let mut text = String::new();
    text.push_str(&String::from_utf8_lossy(&out.stdout));
    let err = String::from_utf8_lossy(&out.stderr);
    if !err.trim().is_empty() {
        if !text.trim().is_empty() {
            text.push('\n');
        }
        text.push_str(&err);
    }
    let mut r = OpResult::plain(op, text, out.status.code().unwrap_or(-1));
    if !r.ok && looks_like_auth_problem(&r.output) {
        r.output.push('\n');
        r.output.push_str(TIMEOUT_HINT);
    }
    Ok(r)
}

fn looks_like_auth_problem(out: &str) -> bool {
    let o = out.to_lowercase();
    ["authentication", "could not read from remote", "terminal prompts disabled", "permission denied (publickey", "fatal: could not read username"]
        .iter()
        .any(|k| o.contains(k))
}

/// 执行“可能产生冲突”的操作后，检测冲突文件与进行中的操作状态。
fn finish(root: &Path, mut r: OpResult) -> Result<OpResult> {
    let repo = match crate::gitread::open(root) {
        Ok(repo) => repo,
        Err(_) => return Ok(r),
    };
    let st = crate::gitread::status(&repo).unwrap_or_default();
    r.conflicts = st.conflicted;
    r.in_progress = st.in_progress;
    r.conflict = !r.conflicts.is_empty();
    Ok(r)
}

// ---------- 基础操作 ----------

pub fn stage(root: &Path, paths: &[String]) -> Result<OpResult> {
    let refs: Vec<String> = paths.iter().map(|p| p.replace('\\', "/")).collect();
    if refs.is_empty() {
        return run(root, "stage", &["add", "-A"]);
    }
    let mut args: Vec<&str> = vec!["add", "--"];
    for p in &refs {
        args.push(p);
    }
    run(root, "stage", &args)
}

pub fn unstage(root: &Path, paths: &[String]) -> Result<OpResult> {
    if paths.is_empty() {
        return run(root, "unstage", &["reset"]);
    }
    let refs: Vec<String> = paths.iter().map(|p| p.replace('\\', "/")).collect();
    let mut args: Vec<&str> = vec!["reset", "--"];
    for p in &refs {
        args.push(p);
    }
    run(root, "unstage", &args)
}

pub fn discard(root: &Path, paths: &[String]) -> Result<OpResult> {
    // 丢弃工作区改动（含未跟踪文件删除）
    let refs: Vec<String> = paths.iter().map(|p| p.replace('\\', "/")).collect();
    let mut args: Vec<&str> = vec!["checkout", "--"];
    for p in &refs {
        args.push(p);
    }
    let r = run(root, "discard", &args)?;
    // 未跟踪文件单独删除
    for p in &refs {
        let full = root.join(p);
        if full.is_file() {
            let _ = std::fs::remove_file(&full);
        }
    }
    Ok(r)
}

pub fn commit(root: &Path, message: &str, amend: bool) -> Result<OpResult> {
    if message.trim().is_empty() && !amend {
        bail!("提交信息不能为空");
    }
    let mut args: Vec<&str> = vec!["commit", "-m", message];
    if amend {
        args.push("--amend");
        args.push("--no-edit");
    }
    let r = run(root, "commit", &args)?;
    finish(root, r)
}

// ---------- 分支 ----------

pub fn checkout(root: &Path, target: &str, new_branch: bool, start: Option<&str>) -> Result<OpResult> {
    let mut args: Vec<String> = vec!["checkout".into()];
    if new_branch {
        args.push("-b".into());
    }
    args.push(target.into());
    if let Some(s) = start {
        args.push(s.into());
    }
    let r = run(root, "checkout", &args.iter().map(|s| s.as_str()).collect::<Vec<_>>())?;
    finish(root, r)
}

pub fn branch(root: &Path, action: &str, name: &str, start: Option<&str>) -> Result<OpResult> {
    let op = format!("branch-{action}");
    match action {
        "create" => {
            let mut args = vec!["branch", name];
            if let Some(s) = start {
                args.push(s);
            }
            run(root, &op, &args)
        }
        "delete" => run(root, &op, &["branch", "-d", name]),
        "force-delete" => run(root, &op, &["branch", "-D", name]),
        "rename" => run(root, &op, &["branch", "-m", name]),
        _ => bail!("未知分支操作: {action}"),
    }
}

// ---------- 远程同步 ----------

pub fn fetch(root: &Path, remote: &str, prune: bool) -> Result<OpResult> {
    let mut args: Vec<&str> = vec!["fetch", remote];
    if prune {
        args.push("--prune");
    }
    finish(root, run(root, "fetch", &args)?)
}

pub fn pull(root: &Path, mode: &str, remote: &str, branch: &str) -> Result<OpResult> {
    let mut args: Vec<String> = vec!["pull".into()];
    match mode {
        "ff-only" => args.push("--ff-only".into()),
        "rebase" => args.push("--rebase".into()),
        _ => {}
    }
    args.push(remote.into());
    args.push(branch.into());
    let r = run(root, "pull", &args.iter().map(|s| s.as_str()).collect::<Vec<_>>())?;
    finish(root, r)
}

pub fn push(root: &Path, remote: &str, branch: &str, set_upstream: bool, force: bool) -> Result<OpResult> {
    let mut args: Vec<String> = vec!["push".into()];
    if force {
        args.push("--force-with-lease".into());
    }
    if set_upstream {
        args.push("-u".into());
    }
    args.push(remote.into());
    args.push(branch.into());
    let r = run(root, "push", &args.iter().map(|s| s.as_str()).collect::<Vec<_>>())?;
    finish(root, r)
}

// ---------- 合并 / 变基 / 撤销 ----------

pub fn merge(root: &Path, refname: &str, no_ff: bool, squash: bool) -> Result<OpResult> {
    let mut args: Vec<&str> = vec!["merge"];
    if no_ff {
        args.push("--no-ff");
    }
    if squash {
        args.push("--squash");
    }
    args.push("--no-edit");
    args.push(refname);
    let r = run(root, "merge", &args)?;
    finish(root, r)
}

pub fn rebase(root: &Path, upstream: &str, onto: Option<&str>) -> Result<OpResult> {
    let mut args: Vec<&str> = vec!["rebase", upstream];
    if let Some(o) = onto {
        args.push("--onto");
        args.push(o);
    }
    let r = run(root, "rebase", &args)?;
    finish(root, r)
}

pub fn continue_op(root: &Path, op: &str) -> Result<OpResult> {
    // 使用 core.editor=true 避免继续时弹出编辑器
    let op = op.to_string();
    let args: Vec<&str> = match op.as_str() {
        "merge" => vec!["-c", "core.editor=true", "merge", "--continue"],
        "rebase" => vec!["-c", "core.editor=true", "rebase", "--continue"],
        "cherry-pick" => vec!["-c", "core.editor=true", "cherry-pick", "--continue"],
        "revert" => vec!["-c", "core.editor=true", "revert", "--continue"],
        _ => bail!("不支持继续的操作: {op}"),
    };
    let r = run(root, &format!("{op}-continue"), &args)?;
    finish(root, r)
}

pub fn abort_op(root: &Path, op: &str) -> Result<OpResult> {
    let op = op.to_string();
    let args: Vec<&str> = match op.as_str() {
        "merge" => vec!["merge", "--abort"],
        "rebase" => vec!["rebase", "--abort"],
        "cherry-pick" => vec!["cherry-pick", "--abort"],
        "revert" => vec!["revert", "--abort"],
        _ => bail!("不支持中止的操作: {op}"),
    };
    let r = run(root, &format!("{op}-abort"), &args)?;
    finish(root, r)
}

pub fn revert(root: &Path, oid: &str, no_commit: bool) -> Result<OpResult> {
    let mut args: Vec<&str> = vec!["revert", "--no-edit"];
    if no_commit {
        args.push("--no-commit");
    }
    args.push(oid);
    let r = run(root, "revert", &args)?;
    finish(root, r)
}

pub fn cherry_pick(root: &Path, oid: &str) -> Result<OpResult> {
    let r = run(root, "cherry-pick", &["cherry-pick", oid])?;
    finish(root, r)
}

pub fn reset(root: &Path, mode: &str, target: &str) -> Result<OpResult> {
    let m = match mode {
        "soft" => "--soft",
        "hard" => "--hard",
        _ => "--mixed",
    };
    let r = run(root, "reset", &["reset", m, target])?;
    finish(root, r)
}

// ---------- Stash ----------

pub fn stash(root: &Path, action: &str, message: Option<&str>, index: Option<usize>) -> Result<OpResult> {
    let op = format!("stash-{action}");
    match action {
        "push" => {
            let mut args: Vec<&str> = vec!["stash", "push"];
            let owned;
            if let Some(m) = message {
                if !m.trim().is_empty() {
                    owned = m.to_string();
                    args.push("-m");
                    args.push(&owned);
                }
            }
            run(root, &op, &args)
        }
        "list" => run(root, &op, &["stash", "list", "--format=%gd|%s"]),
        "pop" | "apply" => {
            let sub = if action == "pop" { "pop" } else { "apply" };
            let owned = index.map(|i| format!("stash@{{{i}}}"));
            let mut args: Vec<&str> = vec!["stash", sub];
            if let Some(o) = &owned {
                args.push(o);
            }
            let r = run(root, &op, &args)?;
            finish(root, r)
        }
        "drop" => {
            let owned = index.map(|i| format!("stash@{{{i}}}"));
            let mut args: Vec<&str> = vec!["stash", "drop"];
            if let Some(o) = &owned {
                args.push(o);
            }
            run(root, &op, &args)
        }
        _ => bail!("未知 stash 操作: {action}"),
    }
}

/// 简单的并发保护：同一时间只允许一个写操作（跨线程互斥）。
static OP_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
pub fn with_lock<T>(f: impl FnOnce() -> T) -> T {
    let _g = OP_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    f()
}

/// 校验一个 git 引用名是否被 CLI 拒绝（避免注入多余参数）。
pub fn validate_ref(name: &str) -> Result<()> {
    if name.is_empty()
        || name.len() > 256
        || name.starts_with('-')
        || name.contains("..")
        || name.contains(' ')
        || name.contains('\n')
        || name.contains("..\\")
    {
        bail!("非法引用名: {name}");
    }
    Ok(())
}

pub fn ensure_repo(root: &Path) -> Result<()> {
    crate::gitread::open(root).map(|_| ()).map_err(|e| anyhow!("{e}")).context("git")
}
