//! 依赖分析：文件级依赖图（import/include/mod 解析）+ 符号级引用/调用图。
//! 采用轻量正则解析，属于“尽力而为”：不追求编译器级精确，但覆盖常见语言的主要场景。

use anyhow::Result;
use regex::Regex;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};

const MAX_FILES: usize = 3000;
const MAX_FILE_BYTES: u64 = 400 * 1024;
const MAX_NODES: usize = 1500;

#[derive(Serialize, Clone)]
pub struct FileNode {
    pub id: String,   // 相对路径
    pub lang: String,
    pub ext: String,
    pub symbols: usize,
}

#[derive(Serialize, Clone)]
pub struct DepEdge {
    pub from: String,
    pub to: String,
}

#[derive(Serialize)]
pub struct DepGraph {
    pub nodes: Vec<FileNode>,
    pub edges: Vec<DepEdge>,
    pub cycles: Vec<Vec<String>>,
    pub truncated: bool,
}

#[derive(Serialize, Clone)]
pub struct Symbol {
    pub name: String,
    pub kind: String, // fn / class / struct / interface / impl / type / module ...
    pub line: usize,  // 1-based
}

#[derive(Serialize)]
pub struct SymbolRefItem {
    pub file: String,
    pub line: usize,
    pub text: String,
    pub enclosing: Option<String>,
}

#[derive(Serialize)]
pub struct SymbolInfo {
    pub name: String,
    pub kind: String,
    pub file: String,
    pub line: usize,
    pub references: Vec<SymbolRefItem>,
    pub callees: Vec<SymbolRefItem>, // 本文件内调用的其他符号
}

pub fn lang_of(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "rs" => "rust",
        "js" | "mjs" | "cjs" | "jsx" => "js",
        "ts" | "mts" | "cts" | "tsx" => "ts",
        "py" => "py",
        "c" | "h" => "c",
        "cc" | "cpp" | "cxx" | "hpp" | "hh" | "hxx" => "cpp",
        "go" => "go",
        "java" => "java",
        _ => return None,
    })
}

struct Indexed {
    /// rel_path(lower) -> rel_path(原样, '/')
    files: HashMap<String, String>,
    /// rel_path -> (lang, content)
    contents: HashMap<String, (String, String)>,
    truncated: bool,
}

fn walk_files(root: &Path) -> Result<Indexed> {
    let mut idx = Indexed {
        files: HashMap::new(),
        contents: HashMap::new(),
        truncated: false,
    };
    let walker = ignore::WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_global(false)
        .parents(true)
        .build();
    let mut count = 0usize;
    for e in walker.flatten() {
        if !e.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let p = e.path();
        let rel = match p.strip_prefix(root) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        let ext = p
            .extension()
            .map(|x| x.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let Some(lang) = lang_of(&ext) else { continue };
        count += 1;
        if count > MAX_FILES {
            idx.truncated = true;
            break;
        }
        idx.files.insert(rel.to_lowercase(), rel.clone());
        if let Ok(meta) = p.metadata() {
            if meta.len() <= MAX_FILE_BYTES {
                if let Ok(bytes) = std::fs::read(p) {
                    if !bytes.contains(&0) {
                        let content = String::from_utf8_lossy(&bytes).to_string();
                        idx.contents.insert(rel, (lang.to_string(), content));
                    }
                }
            }
        }
    }
    Ok(idx)
}

fn exists(idx: &Indexed, rel: &str) -> Option<String> {
    idx.files.get(&rel.to_lowercase()).cloned()
}

/// 解析路径片段为候选相对路径，探测各种扩展名组合。
fn resolve_spec(idx: &Indexed, from_dir: &str, spec: &str, roots: &[String], langs: &[&str]) -> Option<String> {
    let spec = spec.trim();
    let exts: Vec<&str> = langs
        .iter()
        .flat_map(|l| match *l {
            "js" => vec!["js", "jsx", "mjs", "cjs", "ts", "tsx"],
            "ts" => vec!["ts", "tsx", "js", "jsx"],
            "py" => vec!["py"],
            _ => vec![],
        })
        .collect();

    let make_candidates = |base: &str, seg: &str| -> Vec<String> {
        let joined = if seg.is_empty() {
            base.trim_end_matches('/').to_string()
        } else if base.is_empty() {
            seg.to_string()
        } else {
            format!("{}/{}", base.trim_end_matches('/'), seg)
        };
        let mut cands = vec![joined.clone()];
        for e in &exts {
            cands.push(format!("{joined}.{e}"));
        }
        for e in &exts {
            cands.push(format!("{joined}/index.{e}"));
        }
        cands
    };

    // 相对导入
    let normalized: String = {
        // 处理 ./ ../ 归一化
        let mut parts: Vec<&str> = Vec::new();
        let abs = spec.starts_with('/');
        let mut depth = 0usize;
        for seg in spec.split('/') {
            match seg {
                "." | "" => {}
                ".." => {
                    if let Some(last_non_dot) = parts.last() {
                        if *last_non_dot != ".." {
                            parts.pop();
                            continue;
                        }
                    }
                    depth += 1;
                    parts.push("..");
                }
                s => parts.push(s),
            }
            let _ = abs;
            let _ = depth;
        }
        parts.join("/")
    };

    let bases: Vec<String> = if spec.starts_with('.') {
        vec![from_dir.to_string()]
    } else {
        roots.to_vec()
    };
    // “@/” 别名 → 常见 src 根
    let aliases: Vec<String> = if let Some(rest) = spec.strip_prefix("@/") {
        vec![format!("src/{rest}"), rest.to_string()]
    } else if spec.starts_with("~/") {
        vec![format!("src/{}", &spec[2..])]
    } else {
        vec![]
    };

    for base in bases.iter().chain(aliases.iter()) {
        for cand in make_candidates(base, &normalized) {
            if let Some(hit) = exists(idx, &cand) {
                return Some(hit);
            }
        }
    }
    None
}

fn extract_edges(idx: &Indexed, rel: &str, lang: &str, content: &str, root: &Path) -> Vec<String> {
    let from_dir = {
        let d = match rel.rfind('/') {
            Some(i) => &rel[..i],
            None => "",
        };
        d.to_string()
    };
    let mut out: BTreeSet<String> = BTreeSet::new();
    let push = |out: &mut BTreeSet<String>, t: Option<String>| {
        if let Some(t) = t {
            if t != rel {
                out.insert(t);
            }
        }
    };

    match lang {
        "rust" => {
            // mod x;  -> 相对当前文件目录
            let re = Regex::new(r"(?m)^\s*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;").unwrap();
            for c in re.captures_iter(content) {
                let m = &c[1];
                push(&mut out, exists(idx, &format!("{from_dir}/{m}.rs")));
                push(&mut out, exists(idx, &format!("{from_dir}/{m}/mod.rs")));
            }
            // use crate::a::b  -> 从 src 根解析各前缀
            let src_root = if root.join("src").is_dir() {
                "src".to_string()
            } else {
                String::new()
            };
            let re = Regex::new(r"(?m)^\s*use\s+(?:pub(?:\([^)]*\))?\s+)?crate\s*::\s*([A-Za-z0-9_:]+)").unwrap();
            for c in re.captures_iter(content) {
                let segs: Vec<&str> = c[1].split("::").collect();
                for k in 1..=segs.len() {
                    let path = segs[..k].join("/");
                    if !src_root.is_empty() {
                        push(&mut out, exists(idx, &format!("{src_root}/{path}.rs")));
                        push(&mut out, exists(idx, &format!("{src_root}/{path}/mod.rs")));
                    }
                    push(&mut out, exists(idx, &format!("{path}.rs")));
                    push(&mut out, exists(idx, &format!("{path}/mod.rs")));
                }
            }
        }
        "js" | "ts" => {
            let langs: &[&str] = if lang == "ts" { &["ts"] } else { &["js"] };
            let roots = vec!["".to_string(), "src".to_string()];
            let res = |out: &mut BTreeSet<String>, spec: &str| {
                push(out, resolve_spec(idx, &from_dir, spec, &roots, langs));
            };
            let re_from = Regex::new(r#"from\s*['"]([^'"]+)['"]"#).unwrap();
            for c in re_from.captures_iter(content) {
                res(&mut out, &c[1]);
            }
            let re_bare = Regex::new(r#"(?:import\s+|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]"#).unwrap();
            for c in re_bare.captures_iter(content) {
                res(&mut out, &c[1]);
            }
        }
        "py" => {
            // 顶层包解析：尝试项目根；再尝试当前目录向上到根的每一级
            let mut roots: Vec<String> = vec![String::new()];
            let mut dir = from_dir.clone();
            while !dir.is_empty() {
                dir = match dir.rfind('/') {
                    Some(i) => dir[..i].to_string(),
                    None => String::new(),
                };
                roots.push(dir.clone());
                if dir.is_empty() {
                    break;
                }
            }
            let re_from = Regex::new(r"(?m)^\s*from\s+(\.+[A-Za-z0-9_.]*|[A-Za-z0-9_.]+)\s+import").unwrap();
            for c in re_from.captures_iter(content) {
                let raw = &c[1];
                let (dots, rest) = {
                    let n = raw.chars().take_while(|&ch| ch == '.').count();
                    (n, &raw[n..])
                };
                // 相对导入基准目录 = 回退 dots-1 级
                let base = if dots > 0 {
                    let mut segs: Vec<&str> = from_dir.split('/').collect();
                    for _ in 1..dots {
                        segs.pop();
                    }
                    segs.join("/")
                } else {
                    String::new()
                };
                let mut bases: Vec<String> = Vec::new();
                if dots > 0 {
                    bases.push(base);
                } else {
                    bases.extend(roots.iter().cloned());
                }
                let target = if rest.is_empty() { String::new() } else { rest.replace('.', "/") };
                for b in &bases {
                    if target.is_empty() {
                        // from . import x -> 包 __init__
                        push(&mut out, exists(idx, &format!("{b}/__init__.py")));
                        continue;
                    }
                    push(&mut out, exists(idx, &format!("{b}/{target}.py")));
                    push(&mut out, exists(idx, &format!("{b}/{target}/__init__.py")));
                }
            }
            let re_imp = Regex::new(r"(?m)^\s*import\s+([A-Za-z0-9_.]+(?:\s*,\s*[A-Za-z0-9_.]+)*)").unwrap();
            for c in re_imp.captures_iter(content) {
                for m in c[1].split(',') {
                    let m = m.trim().replace('.', "/");
                    for b in &roots {
                        push(&mut out, exists(idx, &format!("{b}/{m}.py")));
                        push(&mut out, exists(idx, &format!("{b}/{m}/__init__.py")));
                    }
                }
            }
        }
        "c" | "cpp" => {
            let re_q = Regex::new(r#"(?m)^\s*#\s*include\s*"([^"]+)""#).unwrap();
            let re_a = Regex::new(r#"(?m)^\s*#\s*include\s*<([^>]+)>"#).unwrap();
            let include_roots = vec![
                from_dir.clone(),
                String::new(),
                "include".into(),
                "src".into(),
                "lib".into(),
            ];
            for c in re_q.captures_iter(content) {
                for b in &include_roots {
                    let cand = if b.is_empty() { c[1].replace('\\', "/") } else { format!("{b}/{}", c[1].replace('\\', "/")) };
                    if let Some(hit) = exists(idx, &cand) {
                        push(&mut out, Some(hit));
                        break;
                    }
                }
            }
            for c in re_a.captures_iter(content) {
                for b in ["include", "", "src"] {
                    let cand = if b.is_empty() { c[1].replace('\\', "/") } else { format!("{b}/{}", c[1].replace('\\', "/")) };
                    if let Some(hit) = exists(idx, &cand) {
                        push(&mut out, Some(hit));
                        break;
                    }
                }
            }
        }
        "go" => {
            // 通过 go.mod 的 module 前缀映射包目录 -> 该目录下 go 文件
            let module = std::fs::read_to_string(root.join("go.mod"))
                .ok()
                .and_then(|t| {
                    t.lines().find_map(|l| {
                        let l = l.trim();
                        l.strip_prefix("module ").map(|m| m.trim().to_string())
                    })
                });
            let re_block = Regex::new(r"(?s)import\s*\((.*?)\)").unwrap();
            let re_str = Regex::new(r#""([^"]+)""#).unwrap();
            let mut imports: Vec<String> = Vec::new();
            if let Some(c) = re_block.captures(content) {
                for m in re_str.captures_iter(&c[1]) {
                    imports.push(m[1].to_string());
                }
            }
            let re_single = Regex::new(r#"(?m)^\s*import\s+(?:[_\w]+\s+)?"([^"]+)""#).unwrap();
            for m in re_single.captures_iter(content) {
                imports.push(m[1].to_string());
            }
            if let Some(mod_name) = module {
                for imp in imports {
                    if let Some(sub) = imp.strip_prefix(&mod_name) {
                        let dir = sub.trim_start_matches('/');
                        for (p, (l, _)) in idx.contents.iter() {
                            if *l == "go" {
                                let pd = match p.rfind('/') {
                                    Some(i) => &p[..i],
                                    None => "",
                                };
                                if pd == dir {
                                    out.insert(p.clone());
                                }
                            }
                        }
                    }
                }
            }
        }
        "java" => {
            let re = Regex::new(r"(?m)^\s*import\s+(?:static\s+)?([\w.]+)\s*;").unwrap();
            for c in re.captures_iter(content) {
                let path = c[1].replace('.', "/");
                push(&mut out, exists(idx, &format!("{path}.java")));
            }
        }
        _ => {}
    }
    out.into_iter().collect()
}

/// Tarjan SCC（迭代版），返回大小 > 1 的强连通分量（环）。
fn find_cycles(n: usize, adj: &[Vec<usize>]) -> Vec<Vec<usize>> {
    #[derive(Clone, Copy, PartialEq)]
    enum St {
        Unvisited,
        InStack,
        Done,
    }
    let mut index = vec![usize::MAX; n];
    let mut low = vec![0usize; n];
    let mut state = vec![St::Unvisited; n];
    let mut on_stack: Vec<bool> = vec![false; n];
    let mut stack: Vec<usize> = Vec::new();
    let mut sccs: Vec<Vec<usize>> = Vec::new();
    let mut counter = 0usize;

    for start in 0..n {
        if state[start] != St::Unvisited {
            continue;
        }
        // 显式栈: (节点, 下一个子边索引)
        let mut call: Vec<(usize, usize)> = vec![(start, 0)];
        while let Some(&mut (v, ref mut ci)) = call.last_mut() {
            if *ci == 0 {
                index[v] = counter;
                low[v] = counter;
                counter += 1;
                stack.push(v);
                on_stack[v] = true;
                state[v] = St::InStack;
            }
            if *ci < adj[v].len() {
                let w = adj[v][*ci];
                *ci += 1;
                match state[w] {
                    St::Unvisited => call.push((w, 0)),
                    St::InStack => low[v] = low[v].min(index[w]),
                    St::Done => {}
                }
            } else {
                call.pop();
                if let Some(&(p, _)) = call.last() {
                    low[p] = low[p].min(low[v]);
                }
                if low[v] == index[v] {
                    let mut comp = Vec::new();
                    while let Some(w) = stack.pop() {
                        on_stack[w] = false;
                        state[w] = St::Done;
                        comp.push(w);
                        if w == v {
                            break;
                        }
                    }
                    if comp.len() > 1 {
                        sccs.push(comp);
                    }
                }
            }
        }
    }
    sccs
}

pub fn graph(root: &Path) -> Result<DepGraph> {
    let idx = walk_files(root)?;
    let mut names: Vec<String> = idx.contents.keys().cloned().collect();
    names.sort();
    let truncated = idx.truncated || names.len() > MAX_NODES;
    if names.len() > MAX_NODES {
        names.truncate(MAX_NODES);
    }
    let index_of: HashMap<&String, usize> = names.iter().enumerate().map(|(i, n)| (n, i)).collect();

    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); names.len()];
    let mut edges: Vec<DepEdge> = Vec::new();
    for rel in &names {
        let (lang, content) = &idx.contents[rel];
        for target in extract_edges(&idx, rel, lang, content, root) {
            if let (Some(&a), Some(&b)) = (index_of.get(rel), index_of.get(&target)) {
                adj[a].push(b);
                edges.push(DepEdge {
                    from: rel.clone(),
                    to: target.clone(),
                });
            }
        }
    }

    let sccs = find_cycles(names.len(), &adj);
    let cycles: Vec<Vec<String>> = sccs
        .into_iter()
        .take(20)
        .map(|c| c.into_iter().map(|i| names[i].clone()).collect())
        .collect();

    let nodes: Vec<FileNode> = names
        .iter()
        .map(|rel| {
            let (lang, content) = &idx.contents[rel];
            FileNode {
                id: rel.clone(),
                lang: lang.clone(),
                ext: rel.rsplit('.').next().unwrap_or("").to_string(),
                symbols: extract_symbols(lang, content).len(),
            }
        })
        .collect();

    Ok(DepGraph {
        nodes,
        edges,
        cycles,
        truncated,
    })
}

// ---------------- 符号提取 ----------------

fn line_of(content: &str, pos: usize) -> usize {
    content[..pos.min(content.len())].bytes().filter(|&b| b == b'\n').count() + 1
}

fn extract_text_at(content: &str, line: usize) -> String {
    content.lines().nth(line.saturating_sub(1)).unwrap_or("").trim().to_string()
}

pub fn extract_symbols(lang: &str, content: &str) -> Vec<Symbol> {
    let mut out: BTreeMap<(usize, String), Symbol> = BTreeMap::new();
    let add = |out: &mut BTreeMap<(usize, String), Symbol>, content: &str, m: &regex::Captures, g: usize, kind: &str| {
        let name = m[g].to_string();
        let line = line_of(content, m.get(0).unwrap().start());
        out.entry((line, name.clone())).or_insert(Symbol {
            name,
            kind: kind.into(),
            line,
        });
    };
    match lang {
        "rust" => {
            let re_fn = Regex::new(r#"(?m)^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?(?:default[ \t]+)?(?:const[ \t]+)?(?:async[ \t]+)?(?:unsafe[ \t]+)?(?:extern[ \t]+"[^"]+"[ \t]+)?fn[ \t]+([A-Za-z_][A-Za-z0-9_]*)"#).unwrap();
            for m in re_fn.captures_iter(content) {
                add(&mut out, content, &m, 1, "fn");
            }
            let re_ty = Regex::new(r"(?m)^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?(struct|enum|trait|union|type)[ \t]+([A-Za-z_][A-Za-z0-9_]*)").unwrap();
            for m in re_ty.captures_iter(content) {
                add(&mut out, content, &m, 2, &m[1]);
            }
            let re_impl = Regex::new(r"(?m)^[ \t]*impl(?:<[^{>]*>)?[ \t]+(?:[^{]+?[ \t]+for[ \t]+)?([A-Za-z_][A-Za-z0-9_:]*)[ \t]*\{").unwrap();
            for m in re_impl.captures_iter(content) {
                let name = m[1].rsplit("::").next().unwrap_or(&m[1]).to_string();
                let line = line_of(content, m.get(0).unwrap().start());
                out.entry((line, format!("impl {name}"))).or_insert(Symbol {
                    name: format!("impl {name}"),
                    kind: "impl".into(),
                    line,
                });
            }
        }
        "js" | "ts" => {
            let re_fn = Regex::new(r"(?m)^[ \t]*(?:export[ \t]+)?(?:default[ \t]+)?(?:async[ \t]+)?function[ \t]*\*?[ \t]*([A-Za-z_$][A-Za-z0-9_$]*)").unwrap();
            for m in re_fn.captures_iter(content) {
                add(&mut out, content, &m, 1, "fn");
            }
            let re_cls = Regex::new(r"(?m)^[ \t]*(?:export[ \t]+)?(?:abstract[ \t]+)?class[ \t]+([A-Za-z_$][A-Za-z0-9_$]*)").unwrap();
            for m in re_cls.captures_iter(content) {
                add(&mut out, content, &m, 1, "class");
            }
            let re_arrow = Regex::new(r"(?m)^[ \t]*(?:export[ \t]+)?(?:const|let|var)[ \t]+([A-Za-z_$][A-Za-z0-9_$]*)[ \t]*(?::[^=\n]+)?=[ \t]*(?:async[ \t]+)?(?:function|\([^)]*\)[ \t]*(?::[^=\n]+)?=>|[A-Za-z_$][A-Za-z0-9_$]*[ \t]*=>)").unwrap();
            for m in re_arrow.captures_iter(content) {
                add(&mut out, content, &m, 1, "fn");
            }
            let re_i = Regex::new(r"(?m)^[ \t]*(?:export[ \t]+)?(interface|type)[ \t]+([A-Za-z_$][A-Za-z0-9_$]*)").unwrap();
            for m in re_i.captures_iter(content) {
                add(&mut out, content, &m, 2, &m[1]);
            }
        }
        "py" => {
            let re_fn = Regex::new(r"(?m)^[ \t]*(?:async[ \t]+)?def[ \t]+([A-Za-z_][A-Za-z0-9_]*)").unwrap();
            for m in re_fn.captures_iter(content) {
                add(&mut out, content, &m, 1, "fn");
            }
            let re_cls = Regex::new(r"(?m)^[ \t]*class[ \t]+([A-Za-z_][A-Za-z0-9_]*)").unwrap();
            for m in re_cls.captures_iter(content) {
                add(&mut out, content, &m, 1, "class");
            }
        }
        "c" | "cpp" => {
            let re_f = Regex::new(r"(?m)^[ \t]*(?:[A-Za-z_][A-Za-z0-9_]*[\w\*]*[ \t\*]+)+\**([A-Za-z_][A-Za-z0-9_]*)[ \t]*\([^;{]*\)[ \t]*\{").unwrap();
            for m in re_f.captures_iter(content) {
                add(&mut out, content, &m, 1, "fn");
            }
            let re_t = Regex::new(r"\b(class|struct)[ \t]+([A-Za-z_][A-Za-z0-9_]*)").unwrap();
            for m in re_t.captures_iter(content) {
                add(&mut out, content, &m, 2, &m[1]);
            }
        }
        "go" => {
            let re_f = Regex::new(r"(?m)^func[ \t]+(?:\([^)]*\)[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)").unwrap();
            for m in re_f.captures_iter(content) {
                add(&mut out, content, &m, 1, "fn");
            }
            let re_t = Regex::new(r"(?m)^type[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]+(struct|interface)").unwrap();
            for m in re_t.captures_iter(content) {
                add(&mut out, content, &m, 1, &m[2]);
            }
        }
        _ => {}
    }
    out.into_values().collect()
}

pub fn symbols_in_file(root: &Path, rel: &str) -> Result<Vec<Symbol>> {
    let p = crate::fsx::resolve_safe(root, rel)?;
    let content = std::fs::read_to_string(&p).map_err(|e| anyhow::anyhow!("读取失败: {rel}: {e}"))?;
    let ext = rel.rsplit('.').next().unwrap_or("");
    let lang = lang_of(ext).unwrap_or("");
    Ok(extract_symbols(lang, &content))
}

/// 符号引用查询：全项目同名引用 + 本文件内调用（粗粒度，按词边界匹配）。
pub fn symbol_refs(root: &Path, rel: &str, symbol: &str) -> Result<SymbolInfo> {
    let p = crate::fsx::resolve_safe(root, rel)?;
    let content = std::fs::read_to_string(&p)?;
    let ext = rel.rsplit('.').next().unwrap_or("");
    let lang = lang_of(ext).unwrap_or("").to_string();
    let syms = extract_symbols(&lang, &content);
    let sym = syms
        .iter()
        .find(|s| s.name == symbol)
        .ok_or_else(|| anyhow::anyhow!("符号不存在: {symbol}"))?
        .clone();

    // 符号所在行区间（到下一个“顶层”符号前）
    let mut starts: Vec<usize> = syms.iter().map(|s| s.line).collect();
    starts.sort_unstable();
    let end_line = starts
        .iter()
        .find(|&&l| l > sym.line)
        .map(|l| l - 1)
        .unwrap_or(content.lines().count());

    let word_re = Regex::new(&format!(r"\b{}", regex::escape(symbol))).unwrap();

    // 本文件内：区间内的其他符号引用 = callees
    let mut callees: Vec<SymbolRefItem> = Vec::new();
    for (i, line_text) in content.lines().enumerate() {
        let ln = i + 1;
        if ln <= sym.line || ln > end_line {
            continue;
        }
        if word_re.is_match(line_text) {
            for s in &syms {
                if s.name != symbol && word_re.is_match(line_text) {
                    callees.push(SymbolRefItem {
                        file: rel.to_string(),
                        line: ln,
                        text: line_text.trim().to_string(),
                        enclosing: Some(s.name.clone()),
                    });
                    break;
                }
            }
        }
    }

    // 全项目引用
    let idx = walk_files(root)?;
    let mut references: Vec<SymbolRefItem> = Vec::new();
    let mut by_file: BTreeMap<String, Vec<(usize, String)>> = BTreeMap::new();
    for (f, (l, c)) in idx.contents.iter() {
        for (i, line_text) in c.lines().enumerate() {
            if word_re.is_match(line_text) {
                by_file
                    .entry(f.clone())
                    .or_default()
                    .push((i + 1, line_text.trim().to_string()));
            }
        }
        let _ = l;
    }
    // 计算引用行的“所在函数”
    for (f, hits) in by_file.iter() {
        let file_syms = {
            let (l, c) = &idx.contents[f];
            extract_symbols(l, c)
        };
        for (ln, text) in hits.iter().take(40) {
            let enclosing = file_syms
                .iter()
                .filter(|s| s.line <= *ln)
                .max_by_key(|s| s.line)
                .map(|s| s.name.clone());
            references.push(SymbolRefItem {
                file: f.clone(),
                line: *ln,
                text: text.clone(),
                enclosing,
            });
            if references.len() >= 400 {
                break;
            }
        }
        if references.len() >= 400 {
            break;
        }
    }
    references.sort_by(|a, b| a.file.cmp(&b.file).then(a.line.cmp(&b.line)));

    Ok(SymbolInfo {
        name: sym.name.clone(),
        kind: sym.kind.clone(),
        file: rel.to_string(),
        line: sym.line,
        references,
        callees,
    })
}

/// 供前端“打开文件并跳转到行”的工具函数。
pub fn read_text_at(root: &Path, rel: &str, line: usize) -> Result<String> {
    let p = crate::fsx::resolve_safe(root, rel)?;
    let content = std::fs::read_to_string(&p)?;
    Ok(extract_text_at(&content, line))
}

#[allow(dead_code)]
fn _unused(_p: PathBuf) {}
