//! 文件系统访问：目录树、读写文件，路径越界防护。

use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub kind: String, // "dir" | "file"
    pub ext: Option<String>,
    pub size: u64,
}

#[derive(Serialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub binary: bool,
    pub size: u64,
    pub line_count: usize,
}

/// 将请求的相对路径安全地解析到 root 内部，拒绝 `..` 越界。
pub fn resolve_safe(root: &Path, rel: &str) -> Result<PathBuf> {
    let rel = rel.trim().trim_start_matches('/').replace('\\', "/");
    if rel.split('/').any(|c| c == "..") || rel.contains(':') {
        bail!("非法路径: {rel}");
    }
    let p = root.join(&rel);
    let canonical_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    // 若文件存在则校验其真实位置仍在 root 内（防符号链接逃逸；失败时宽松处理）
    if let Ok(real) = p.canonicalize() {
        if !real.starts_with(&canonical_root) {
            bail!("路径越界: {rel}");
        }
    }
    Ok(p)
}

fn to_rel(root: &Path, p: &Path) -> String {
    p.strip_prefix(root)
        .unwrap_or(p)
        .to_string_lossy()
        .replace('\\', "/")
}

pub fn list_dir(root: &Path, rel: &str) -> Result<Vec<Entry>> {
    let dir = if rel.is_empty() || rel == "/" {
        root.to_path_buf()
    } else {
        resolve_safe(root, rel)?
    };
    if !dir.is_dir() {
        bail!("不是目录: {rel}");
    }
    let mut out: Vec<Entry> = Vec::new();
    for e in fs::read_dir(&dir).with_context(|| format!("读取目录失败: {}", dir.display()))? {
        let e = e?;
        let name = e.file_name().to_string_lossy().to_string();
        let p = e.path();
        let meta = e.metadata();
        if p.is_dir() {
            out.push(Entry {
                name: name.clone(),
                path: to_rel(root, &p),
                kind: "dir".into(),
                ext: None,
                size: 0,
            });
        } else {
            let ext = p
                .extension()
                .map(|x| x.to_string_lossy().to_lowercase())
                .filter(|x| !x.is_empty());
            out.push(Entry {
                name,
                path: to_rel(root, &p),
                kind: "file".into(),
                ext,
                size: meta.map(|m| m.len()).unwrap_or(0),
            });
        }
    }
    out.sort_by(|a, b| {
        a.kind
            .cmp(&b.kind)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

fn looks_binary(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(8192)];
    head.contains(&0) || head.iter().take(200).filter(|&&b| b < 9).count() > 3
}

pub fn read_file(root: &Path, rel: &str) -> Result<FileContent> {
    let p = resolve_safe(root, rel)?;
    let meta = fs::metadata(&p).with_context(|| format!("文件不存在: {rel}"))?;
    if meta.is_dir() {
        bail!("是目录: {rel}");
    }
    let bytes = fs::read(&p).with_context(|| format!("读取失败: {rel}"))?;
    let binary = looks_binary(&bytes);
    let content = if binary {
        String::new()
    } else {
        String::from_utf8_lossy(&bytes).to_string()
    };
    let line_count = content.lines().count();
    Ok(FileContent {
        path: rel.to_string(),
        content,
        binary,
        size: meta.len(),
        line_count,
    })
}

pub fn write_file(root: &Path, rel: &str, content: &str) -> Result<u64> {
    let p = resolve_safe(root, rel)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&p, content).with_context(|| format!("写入失败: {rel}"))?;
    Ok(content.len() as u64)
}

pub fn delete_path(root: &Path, rel: &str) -> Result<()> {
    let p = resolve_safe(root, rel)?;
    if p == root {
        bail!("不能删除项目根目录");
    }
    if p.is_dir() {
        fs::remove_dir_all(&p).with_context(|| format!("删除目录失败: {rel}"))?;
    } else {
        fs::remove_file(&p).with_context(|| format!("删除文件失败: {rel}"))?;
    }
    Ok(())
}

pub fn create_path(root: &Path, rel: &str, kind: &str) -> Result<()> {
    let p = resolve_safe(root, rel)?;
    if p.exists() {
        bail!("已存在: {rel}");
    }
    if kind == "dir" {
        fs::create_dir_all(&p).with_context(|| format!("创建目录失败: {rel}"))?;
    } else {
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&p, b"").with_context(|| format!("创建文件失败: {rel}"))?;
    }
    Ok(())
}

pub fn rename_path(root: &Path, rel: &str, new_rel: &str) -> Result<()> {
    let from = resolve_safe(root, rel)?;
    let to = resolve_safe(root, new_rel)?;
    if to.exists() {
        bail!("目标已存在: {new_rel}");
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(&from, &to).with_context(|| format!("重命名失败: {rel} -> {new_rel}"))?;
    Ok(())
}
