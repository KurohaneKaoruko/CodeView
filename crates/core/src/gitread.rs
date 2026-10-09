//! Git 读取层（git2 / libgit2）：提交历史、引用、状态、diff。

use anyhow::{Context, Result};
use git2::{BranchType, Delta, DiffFormat, DiffOptions, Repository, Sort, Status, StatusOptions};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Serialize, Clone)]
pub struct RefLabel {
    pub name: String,
    pub kind: String, // "head" | "remote" | "tag"
    pub current: bool,
}

#[derive(Serialize, Clone)]
pub struct CommitInfo {
    pub oid: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub subject: String,
    pub refs: Vec<RefLabel>,
}

#[derive(Serialize, Default)]
pub struct RefsInfo {
    pub head_branch: Option<String>,
    pub head_oid: Option<String>,
    pub detached: bool,
    pub locals: Vec<BranchInfo>,
    pub remote_branches: Vec<BranchInfo>,
    pub tags: Vec<TagInfo>,
    pub remotes: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct BranchInfo {
    pub name: String,
    pub oid: Option<String>,
    pub is_head: bool,
    pub upstream: Option<String>,
    pub ahead: Option<i64>,
    pub behind: Option<i64>,
}

#[derive(Serialize, Clone)]
pub struct TagInfo {
    pub name: String,
    pub oid: String,
}

#[derive(Serialize)]
pub struct FileStatus {
    pub path: String,
    pub code: String, // M / A / D / R
    pub renamed_to: Option<String>,
}

#[derive(Serialize, Default)]
pub struct StatusInfo {
    pub head_branch: Option<String>,
    pub head_oid: Option<String>,
    pub detached: bool,
    pub in_progress: Option<String>, // merge / rebase / cherry-pick / revert
    pub staged: Vec<FileStatus>,
    pub unstaged: Vec<FileStatus>,
    pub untracked: Vec<FileStatus>,
    pub conflicted: Vec<String>,
}

#[derive(Serialize)]
pub struct CommitFile {
    pub path: String,
    pub old_path: Option<String>,
    pub change: String, // A / M / D / R
    pub additions: u32,
    pub deletions: u32,
    pub patch: String,
}

#[derive(Serialize)]
pub struct CommitDetail {
    pub commit: CommitInfo,
    pub files: Vec<CommitFile>,
    pub insertions: u32,
    pub deletions: u32,
}

pub fn open(root: &Path) -> Result<Repository> {
    Repository::discover(root).with_context(|| format!("不是 git 仓库: {}", root.display()))
}

fn oid_str(o: git2::Oid) -> String {
    o.to_string()
}

/// 读取所有引用，按其指向的 commit 建立 oid -> labels 映射。
fn collect_refs(repo: &Repository) -> Result<(BTreeMap<String, Vec<RefLabel>>, RefsInfo)> {
    let mut map: BTreeMap<String, Vec<RefLabel>> = BTreeMap::new();
    let mut info = RefsInfo::default();

    let head = repo.head().ok();
    let head_branch = head
        .as_ref()
        .filter(|_h| !repo.head_detached().unwrap_or(false))
        .and_then(|h| h.shorthand().map(|s| s.to_string()));
    let head_oid = head.as_ref().and_then(|h| h.target()).map(oid_str);
    let detached = repo.head_detached().unwrap_or(false);
    info.head_branch = head_branch.clone();
    info.head_oid = head_oid.clone();
    info.detached = detached;

    if let Ok(branches) = repo.branches(Some(BranchType::Local)) {
        for b in branches.flatten() {
            let name = b.0.name().unwrap_or_default().unwrap_or_default().to_string();
            if name.is_empty() {
                continue;
            }
            let oid = b.0.get().target().map(oid_str);
            let sync: Option<(i64, i64)> = (|| -> Option<(i64, i64)> {
                let up = b.0.upstream().ok()?;
                let (a, bh) = repo
                    .graph_ahead_behind(b.0.get().target()?, up.get().target()?)
                    .ok()?;
                Some((a as i64, bh as i64))
            })();
            let upstream = b
                .0
                .upstream()
                .ok()
                .and_then(|u| u.name().ok().flatten().map(|s| s.to_string()));
            info.locals.push(BranchInfo {
                name: name.clone(),
                oid: oid.clone(),
                is_head: head_branch.as_deref() == Some(name.as_str()),
                upstream,
                ahead: sync.map(|s| s.0),
                behind: sync.map(|s| s.1),
            });
            if let Some(oid) = oid {
                map.entry(oid).or_default().push(RefLabel {
                    name,
                    kind: "head".into(),
                    current: false,
                });
            }
        }
        for b in info.locals.iter_mut() {
            if b.is_head {
                if let Some(labels) = map.get_mut(b.oid.as_deref().unwrap_or_default()) {
                    for l in labels.iter_mut() {
                        if l.kind == "head" && l.name == b.name {
                            l.current = true;
                        }
                    }
                }
            }
        }
    }
    if let Ok(branches) = repo.branches(Some(BranchType::Remote)) {
        for b in branches.flatten() {
            let full = b.0.name().unwrap_or_default().unwrap_or_default().to_string();
            let name = full.strip_prefix("refs/remotes/").unwrap_or(&full).to_string();
            if name.is_empty() || name.ends_with("/HEAD") {
                continue;
            }
            if let Some(oid) = b.0.get().target() {
                info.remote_branches.push(BranchInfo {
                    name: name.clone(),
                    oid: Some(oid_str(oid)),
                    is_head: false,
                    upstream: None,
                    ahead: None,
                    behind: None,
                });
                map.entry(oid_str(oid)).or_default().push(RefLabel {
                    name,
                    kind: "remote".into(),
                    current: false,
                });
            }
        }
    }
    if let Ok(tags) = repo.references_glob("refs/tags/*") {
        for t in tags.flatten() {
            let name = t
                .name()
                .unwrap_or_default()
                .trim_start_matches("refs/tags/")
                .to_string();
            if let Ok(c) = t.peel_to_commit() {
                let oid = oid_str(c.id());
                map.entry(oid.clone()).or_default().push(RefLabel {
                    name: name.clone(),
                    kind: "tag".into(),
                    current: false,
                });
                info.tags.push(TagInfo { name, oid });
            }
        }
    }
    if let Ok(remotes) = repo.remotes() {
        for r in remotes.iter().flatten() {
            info.remotes.push(r.to_string());
        }
    }
    Ok((map, info))
}

pub fn log(repo: &Repository, limit: usize, skip: usize, filter_ref: Option<&str>) -> Result<Vec<CommitInfo>> {
    let (refmap, _) = collect_refs(repo)?;
    let mut rw = repo.revwalk()?;
    rw.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
    match filter_ref {
        Some(r) if !r.is_empty() => {
            rw.push_ref(r).or_else(|_| rw.push(repo.revparse_single(r)?.id()))?;
        }
        _ => {
            rw.push_glob("refs/heads/*").ok();
            rw.push_glob("refs/remotes/*").ok();
            rw.push_glob("refs/tags/*").ok();
            // 至少包含 HEAD（例如全新克隆尚未检查出分支、或处于游离 HEAD）
            if let Ok(h) = repo.head() {
                if let Some(t) = h.target() {
                    rw.push(t).ok();
                }
            }
        }
    }
    let mut out = Vec::new();
    for (i, oid) in rw.enumerate() {
        if i < skip {
            continue;
        }
        if out.len() >= limit {
            break;
        }
        let oid = oid?;
        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let sig = commit.author();
        out.push(CommitInfo {
            oid: oid_str(oid),
            parents: (0..commit.parent_count())
                .filter_map(|i| commit.parent_id(i).ok().map(oid_str))
                .collect(),
            author: sig.name().unwrap_or("?").to_string(),
            email: sig.email().unwrap_or("").to_string(),
            time: commit.time().seconds(),
            subject: commit.summary().unwrap_or("").to_string(),
            refs: refmap.get(&oid_str(oid)).cloned().unwrap_or_default(),
        });
    }
    Ok(out)
}

pub fn refs(repo: &Repository) -> Result<RefsInfo> {
    Ok(collect_refs(repo)?.1)
}

fn code_of(s: Status) -> &'static str {
    if s.contains(Status::INDEX_RENAMED) || s.contains(Status::WT_RENAMED) {
        "R"
    } else if s.contains(Status::INDEX_NEW) || s.contains(Status::WT_NEW) {
        "A"
    } else if s.contains(Status::INDEX_DELETED) || s.contains(Status::WT_DELETED) {
        "D"
    } else if s.contains(Status::INDEX_TYPECHANGE) || s.contains(Status::WT_TYPECHANGE) {
        "T"
    } else {
        "M"
    }
}

fn in_progress(repo: &Repository) -> Option<String> {
    let dot = repo.path(); // .git 目录
    if dot.join("MERGE_HEAD").exists() {
        Some("merge".into())
    } else if dot.join("rebase-merge").exists() || dot.join("rebase-apply").exists() {
        Some("rebase".into())
    } else if dot.join("CHERRY_PICK_HEAD").exists() {
        Some("cherry-pick".into())
    } else if dot.join("REVERT_HEAD").exists() {
        Some("revert".into())
    } else {
        None
    }
}

pub fn status(repo: &Repository) -> Result<StatusInfo> {
    let refs = collect_refs(repo)?.1;
    let mut info = StatusInfo {
        head_branch: refs.head_branch,
        head_oid: refs.head_oid,
        detached: refs.detached,
        ..Default::default()
    };
    info.in_progress = in_progress(repo);

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .exclude_submodules(false);
    let statuses = repo.statuses(Some(&mut opts))?;
    for e in statuses.iter() {
        let s = e.status();
        let Some(path) = e.path() else { continue };
        let path = path.replace('\\', "/");
        if s.is_conflicted() {
            info.conflicted.push(path);
            continue;
        }
        if s.is_ignored() {
            continue;
        }
        let head_to_index = s.intersects(
            Status::INDEX_NEW
                | Status::INDEX_MODIFIED
                | Status::INDEX_DELETED
                | Status::INDEX_RENAMED
                | Status::INDEX_TYPECHANGE,
        );
        let index_to_wt = s.intersects(
            Status::WT_MODIFIED
                | Status::WT_DELETED
                | Status::WT_TYPECHANGE
                | Status::WT_RENAMED,
        );
        if head_to_index {
            info.staged.push(FileStatus {
                path: path.clone(),
                code: code_of(s).into(),
                renamed_to: e.head_to_index().and_then(|d| {
                    d.new_file().path().map(|p| p.to_string_lossy().replace('\\', "/"))
                }),
            });
        }
        if s.contains(Status::WT_NEW) {
            info.untracked.push(FileStatus { path, code: "A".into(), renamed_to: None });
        } else if index_to_wt {
            info.unstaged.push(FileStatus {
                path,
                code: code_of(s).into(),
                renamed_to: e.index_to_workdir().and_then(|d| {
                    d.new_file().path().map(|p| p.to_string_lossy().replace('\\', "/"))
                }),
            });
        }
    }
    Ok(info)
}

fn head_tree(repo: &Repository) -> Result<Option<git2::Tree<'_>>> {
    let head = repo.head().ok();
    let tree = match head {
        Some(h) => {
            let c = repo.find_commit(h.target().context("HEAD 无指向")?)?;
            Some(c.tree()?)
        }
        None => None,
    };
    Ok(tree)
}

/// 单个文件的工作区/暂存区 diff（unified patch 文本）。
pub fn file_diff(repo: &Repository, path: &str, staged: bool) -> Result<String> {
    let mut opts = DiffOptions::new();
    opts.pathspec(path).context_lines(6);
    let diff = if staged {
        let tree = head_tree(repo)?;
        repo.diff_tree_to_index(tree.as_ref(), None, Some(&mut opts))?
    } else {
        repo.diff_index_to_workdir(None, Some(&mut opts))?
    };
    let mut out = String::new();
    diff.print(DiffFormat::Patch, |_d, _h, line| {
        match line.origin() {
            '+' | '-' | ' ' => out.push(line.origin()),
            _ => {}
        }
        out.push_str(&String::from_utf8_lossy(line.content()));
        true
    })?;
    Ok(out)
}

fn change_letter(d: Delta) -> &'static str {
    match d {
        Delta::Added => "A",
        Delta::Deleted => "D",
        Delta::Renamed => "R",
        Delta::Typechange => "T",
        Delta::Modified => "M",
        _ => "M",
    }
}

/// 从 diff 中提取逐文件 patch 与增删统计。
fn files_from_diff(diff: &git2::Diff) -> Result<(Vec<CommitFile>, u32, u32)> {
    let stats = diff.stats()?;
    let mut files: Vec<CommitFile> = Vec::new();
    let delta_count = diff.deltas().count();
    for i in 0..delta_count {
        let delta = diff.get_delta(i).context("delta 不存在")?;
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        files.push(CommitFile {
            path,
            old_path: if delta.status() == Delta::Renamed {
                delta.old_file().path().map(|p| p.to_string_lossy().replace('\\', "/"))
            } else {
                None
            },
            change: change_letter(delta.status()).into(),
            additions: 0,
            deletions: 0,
            patch: String::new(),
        });
    }

    // 逐文件收集 patch
    let mut patches: Vec<String> = vec![String::new(); files.len()];
    let mut current: Option<usize> = None;
    diff.print(DiffFormat::Patch, |delta, _h, line| {
        let p = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p: &std::path::Path| p.to_string_lossy().replace('\\', "/"));
        if let Some(p) = p {
            let idx = files.iter().position(|f| f.path == p);
            if idx != current {
                current = idx;
            }
        }
        if let Some(i) = current {
            let buf = &mut patches[i];
            match line.origin() {
                'F' => {} // 文件头不需要
                'H' => {
                    // hunk 头（@@ -a,b +c,d @@）：前端解析行号需要
                    buf.push_str(&String::from_utf8_lossy(line.content()));
                }
                o @ ('+' | '-' | ' ') => {
                    buf.push(o);
                    buf.push_str(&String::from_utf8_lossy(line.content()));
                }
                _ => {}
            }
        }
        true
    })?;
    for (i, p) in patches.into_iter().enumerate() {
        files[i].patch = p;
    }
    // 每文件增删行数（简化统计）
    for f in files.iter_mut() {
        f.additions = f.patch.lines().filter(|l| l.starts_with('+') && !l.starts_with("+++")).count() as u32;
        f.deletions = f.patch.lines().filter(|l| l.starts_with('-') && !l.starts_with("---")).count() as u32;
    }
    Ok((files, stats.insertions() as u32, stats.deletions() as u32))
}

/// 提交详情：相对第一父提交的变更文件列表与逐文件 patch。
pub fn commit_detail(repo: &Repository, oid_str_param: &str) -> Result<CommitDetail> {
    let oid = git2::Oid::from_str(oid_str_param)?;
    let commit = repo.find_commit(oid)?;
    let sig = commit.author();

    // CommitInfo（含引用标记）
    let (refmap, _) = collect_refs(repo)?;
    let info = CommitInfo {
        oid: oid_str(oid),
        parents: (0..commit.parent_count())
            .filter_map(|i| commit.parent_id(i).ok().map(oid_str))
            .collect(),
        author: sig.name().unwrap_or("?").to_string(),
        email: sig.email().unwrap_or("").to_string(),
        time: commit.time().seconds(),
        subject: commit.summary().unwrap_or("").to_string(),
        refs: refmap.get(&oid_str(oid)).cloned().unwrap_or_default(),
    };

    let mut opts = DiffOptions::new();
    opts.context_lines(6);
    let diff = if commit.parent_count() == 0 {
        repo.diff_tree_to_tree(None, Some(&commit.tree()?), Some(&mut opts))?
    } else {
        let parent_tree = commit.parent(0)?.tree()?;
        repo.diff_tree_to_tree(Some(&parent_tree), Some(&commit.tree()?), Some(&mut opts))?
    };

    let (files, insertions, deletions) = files_from_diff(&diff)?;

    Ok(CommitDetail {
        commit: info,
        files,
        insertions,
        deletions,
    })
}

#[derive(Serialize)]
pub struct CompareResult {
    pub from_oid: String,
    pub to_oid: String,
    pub base_oid: Option<String>, // merge-base（启用且存在时）
    pub ahead: i64,               // TO 相对 FROM 领先的提交数
    pub behind: i64,              // TO 相对 FROM 落后的提交数
    pub insertions: u32,
    pub deletions: u32,
    pub files: Vec<CommitFile>,
}

/// 对比两个引用（分支/标签/commit id）：树对树的完整差异。
pub fn compare(repo: &Repository, from: &str, to: &str, use_merge_base: bool) -> Result<CompareResult> {
    let from_c = repo.revparse_single(from)?.peel_to_commit()?;
    let to_c = repo.revparse_single(to)?.peel_to_commit()?;

    let mut base_oid = None;
    let from_tree_c = if use_merge_base {
        match repo.merge_base(from_c.id(), to_c.id()).ok().and_then(|o| repo.find_commit(o).ok()) {
            Some(base) => {
                base_oid = Some(oid_str(base.id()));
                base
            }
            None => from_c.clone(),
        }
    } else {
        from_c.clone()
    };

    let mut opts = DiffOptions::new();
    opts.context_lines(4);
    let diff = repo.diff_tree_to_tree(Some(&from_tree_c.tree()?), Some(&to_c.tree()?), Some(&mut opts))?;
    let (files, insertions, deletions) = files_from_diff(&diff)?;
    let (ahead, behind) = repo.graph_ahead_behind(to_c.id(), from_c.id()).unwrap_or((0, 0));

    Ok(CompareResult {
        from_oid: oid_str(from_c.id()),
        to_oid: oid_str(to_c.id()),
        base_oid,
        ahead: ahead as i64,
        behind: behind as i64,
        insertions,
        deletions,
        files,
    })
}
