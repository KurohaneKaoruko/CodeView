//! 全局文本搜索：遍历项目（遵循 .gitignore），按子串或正则匹配行。

use anyhow::{bail, Result};
use serde::Serialize;
use std::path::Path;

const MAX_TOTAL: usize = 500;
const MAX_PER_FILE: usize = 50;
const MAX_FILE_BYTES: u64 = 1024 * 1024;
const MAX_FILES: usize = 20000;

#[derive(Serialize)]
pub struct SearchHit {
    pub line: usize, // 1-based
    pub col: usize,  // 1-based 匹配起始列
    pub text: String,
    pub len: usize, // 匹配长度（字符数，用于前端高亮）
}

#[derive(Serialize)]
pub struct FileHits {
    pub file: String,
    pub hits: Vec<SearchHit>,
}

#[derive(Serialize)]
pub struct SearchResult {
    pub total: usize,
    pub truncated: bool,
    pub files: Vec<FileHits>,
}

pub fn search(root: &Path, query: &str, case_sensitive: bool, use_regex: bool) -> Result<SearchResult> {
    if query.trim().is_empty() {
        bail!("搜索内容不能为空");
    }
    let matcher = if use_regex {
        let pattern = if case_sensitive {
            query.to_string()
        } else {
            format!("(?i){query}")
        };
        Some(regex::Regex::new(&pattern).map_err(|e| anyhow::anyhow!("正则无效: {e}"))?)
    } else {
        None
    };
    let needle = if case_sensitive || matcher.is_some() {
        query.to_string()
    } else {
        query.to_lowercase()
    };

    let walker = ignore::WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .parents(true)
        .build();

    let mut result = SearchResult { total: 0, truncated: false, files: Vec::new() };
    let mut scanned = 0usize;

    for entry in walker.flatten() {
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        if result.truncated {
            break;
        }
        scanned += 1;
        if scanned > MAX_FILES {
            result.truncated = true;
            break;
        }
        let p = entry.path();
        if let Ok(meta) = p.metadata() {
            if meta.len() == 0 || meta.len() > MAX_FILE_BYTES {
                continue;
            }
        }
        let Ok(bytes) = std::fs::read(p) else { continue };
        if bytes.contains(&0) {
            continue; // 二进制
        }
        let Ok(content) = std::str::from_utf8(&bytes) else { continue };
        let rel = match p.strip_prefix(root) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };

        let mut hits: Vec<SearchHit> = Vec::new();
        for (i, line) in content.lines().enumerate() {
            if hits.len() >= MAX_PER_FILE {
                break;
            }
            if let Some(re) = &matcher {
                if let Some(m) = re.find(line) {
                    hits.push(SearchHit {
                        line: i + 1,
                        col: m.start() + 1,
                        text: line.to_string(),
                        len: m.end() - m.start(),
                    });
                }
            } else {
                let hay = if case_sensitive { line } else { &line.to_lowercase()[..] };
                if let Some(pos) = hay.find(&needle) {
                    hits.push(SearchHit {
                        line: i + 1,
                        col: pos + 1,
                        text: line.to_string(),
                        len: query.chars().count(),
                    });
                }
            }
        }
        if !hits.is_empty() {
            result.total += hits.len();
            result.files.push(FileHits { file: rel, hits });
            if result.total >= MAX_TOTAL {
                result.truncated = true;
                result.files.last_mut().unwrap().hits.truncate(MAX_PER_FILE);
                break;
            }
        }
    }
    Ok(result)
}
