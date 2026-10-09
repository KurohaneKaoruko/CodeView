//! 压力测试仓库生成器：生成庞大文件结构、复杂依赖关系与混乱分支历史的合成项目。
//! 用法: codeview genstress <路径> [--files N] [--commits N] [--branches N]

use anyhow::{bail, Result};
use std::path::Path;
use std::process::Command;

// 确定性随机（LCG），保证可复现
struct Rng(u64);
impl Rng {
    fn new(seed: u64) -> Self {
        Rng(seed | 1)
    }
    fn next_u64(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0
    }
    fn range(&mut self, n: usize) -> usize {
        if n == 0 { 0 } else { (self.next_u64() % n as u64) as usize }
    }
}

fn git(root: &Path, args: &[&str], date: Option<i64>) -> Result<String> {
    let mut cmd = Command::new("git");
    cmd.current_dir(root).arg("-C").arg(root).args(args);
    if let Some(d) = date {
        let ds = format!("{d} +0800");
        cmd.env("GIT_AUTHOR_DATE", &ds).env("GIT_COMMITTER_DATE", &ds);
    }
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    let out = cmd.output()?;
    if !out.status.success() {
        bail!(
            "git {} 失败: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr)
        );
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

const PKG_NAMES: &[&str] = &[
    "core", "net", "storage", "auth", "query", "media", "jobs", "ui", "infra", "codec",
    "search", "sync",
];
const MOD_NAMES: &[&str] = &[
    "handler", "service", "model", "cache", "client", "config", "events", "router", "store",
    "worker", "types", "util",
];
const MSG_PREFIX: &[&str] = &["feat", "fix", "refactor", "perf", "chore", "docs"];

struct FileSpec {
    rel: String,      // 相对仓库根
    lang: Lang,       // 语言
    deps: Vec<usize>, // 依赖的其他文件（同语言）
    seed: u64,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Lang {
    Rust,
    Ts,
    Py,
}

impl Lang {
    // 当前仅用于扩展名判断（文件生成时直接内联）
}

fn ident(seed: u64) -> String {
    const A: &[&str] = &["parse", "encode", "fetch", "flush", "resolve", "merge", "diff", "index", "stream", "batch", "cache", "dispatch"];
    const B: &[&str] = &["payload", "record", "frame", "packet", "entry", "cursor", "token", "buffer", "slice", "window", "signal", "chunk"];
    let mut r = Rng(seed);
    format!("{}_{}", A[r.range(A.len())], B[r.range(B.len())])
}

/// 生成单个文件的内容（含对其 deps 的 import 语句与若干符号定义）
fn file_content(spec: &FileSpec, all: &[FileSpec], revision: usize) -> String {
    let mut r = Rng(spec.seed ^ ((revision as u64) << 8));
    let name = ident(spec.seed);
    let mut imports = String::new();
    for &d in &spec.deps {
        let dep = &all[d];
        let stem = dep_fn_ident(dep.seed);
        match (spec.lang, dep.lang) {
            (Lang::Rust, Lang::Rust) => {
                // 依赖路径：rust-app/src 下 crate::pkg::mod
                let rel = dep.rel.trim_start_matches("rust-app/src/");
                let path = rel.trim_end_matches(".rs").replace('/', "::");
                imports.push_str(&format!("use crate::{path}::{{{stem}_0}};\n"));
            }
            (Lang::Ts, Lang::Ts) => {
                // 相对路径导入
                let from_dir = spec
                    .rel
                    .rsplit_once('/')
                    .map(|x| x.0)
                    .unwrap_or("");
                let to = &dep.rel;
                let relp = common_rel(&from_dir.to_string(), to);
                imports.push_str(&format!("import {{ {stem}_0 }} from '{relp}';\n"));
            }
            (Lang::Py, Lang::Py) => {
                let stem_mod = dep
                    .rel
                    .trim_end_matches(".py")
                    .replace('/', ".");
                imports.push_str(&format!("from {stem_mod} import {stem}_0\n"));
            }
            _ => {}
        }
    }

    let mut body = String::new();
    match spec.lang {
        Lang::Rust => {
            body.push_str(&format!("// 模块：{name} (rev {revision})\n"));
            for i in 0..(4 + r.range(6)) {
                let fname = format!("{name}_{i}");
                body.push_str(&format!(
                    "\npub fn {fname}(x: usize) -> usize {{\n    let base = x.wrapping_add({});\n",
                    r.range(1000)
                ));
                if !spec.deps.is_empty() && i == 0 {
                    body.push_str("    let mixed = " );
                    let calls: Vec<String> = spec
                        .deps
                        .iter()
                        .map(|d| format!("{}_0(base)", dep_fn_ident(all[*d].seed)))
                        .collect();
                    body.push_str(&calls.join(".wrapping_add("));
                    body.push_str(&")".repeat(spec.deps.len().saturating_sub(1)));
                    body.push_str(";\n    base ^ mixed\n");
                } else {
                    body.push_str("    base\n");
                }
                body.push_str("}\n");
            }
            body.push_str(&format!(
                "\npub struct {Name} {{\n    pub value: usize,\n}}\n\nimpl {Name} {{\n    pub fn new(v: usize) -> Self {{ Self {{ value: v }} }}\n    pub fn get(&self) -> usize {{ self.value }}\n}}\n",
                Name = camel(&name)
            ));
        }
        Lang::Ts => {
            body.push_str(&format!("// module: {name} (rev {revision})\n"));
            for i in 0..(4 + r.range(6)) {
                body.push_str(&format!(
                    "\nexport function {name}_{i}(x: number): number {{\n  return x * {} + {};\n}}\n",
                    2 + r.range(9),
                    r.range(500)
                ));
            }
            body.push_str(&format!(
                "\nexport class {Name} {{\n  constructor(public value: number) {{}}\n  get(): number {{ return this.value; }}\n}}\n",
                Name = camel(&name)
            ));
        }
        Lang::Py => {
            body.push_str(&format!("# module: {name} (rev {revision})\n\n\n"));
            for i in 0..(4 + r.range(6)) {
                body.push_str(&format!(
                    "def {name}_{i}(x):\n    return x * {} + {}\n\n\n",
                    2 + r.range(9),
                    r.range(500)
                ));
            }
            body.push_str(&format!(
                "class {Name}:\n    def __init__(self, value):\n        self.value = value\n\n    def get(self):\n        return self.value\n",
                Name = camel(&name)
            ));
        }
    }

    let header = match spec.lang {
        Lang::Rust => imports,
        Lang::Ts => imports,
        Lang::Py => {
            // Python import 需在文件顶部
            return format!("{imports}\n{body}");
        }
    };
    format!("{header}\n{body}")
}

fn dep_fn_ident(seed: u64) -> String {
    ident(seed)
}

fn camel(s: &str) -> String {
    s.split('_')
        .map(|p| {
            let mut c = p.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect()
}

/// 计算 TS 相对导入路径
fn common_rel(from_dir: &str, to_file: &str) -> String {
    let to_dir = to_file.rsplit_once('/').map(|x| x.0).unwrap_or("");
    let fname = to_file.rsplit_once('/').map(|x| x.1).unwrap_or(to_file);
    let a: Vec<&str> = from_dir.split('/').filter(|s| !s.is_empty()).collect();
    let b: Vec<&str> = to_dir.split('/').filter(|s| !s.is_empty()).collect();
    let mut i = 0;
    while i < a.len() && i < b.len() && a[i] == b[i] {
        i += 1;
    }
    let mut parts: Vec<String> = Vec::new();
    for _ in i..a.len() {
        parts.push("..".into());
    }
    for seg in &b[i..] {
        parts.push((*seg).to_string());
    }
    parts.push(fname.to_string());
    if parts.is_empty() {
        format!("./{fname}")
    } else {
        let p = parts.join("/");
        if p.starts_with('.') {
            p
        } else {
            format!("./{p}")
        }
    }
}

/// 生成合成仓库。root 必须为空或不存在。
pub fn generate(root: &Path, target_files: usize, target_commits: usize, target_branches: usize) -> Result<()> {
    if root.exists() && std::fs::read_dir(root)?.next().is_some() {
        bail!("目标目录非空: {}", root.display());
    }
    std::fs::create_dir_all(root)?;
    let mut rng = Rng::new(0xC0FF_EE01);

    println!("▸ git init …");
    git(root, &["init", "-b", "main"], None)?;
    git(root, &["config", "user.email", "stress@local"], None)?;
    git(root, &["config", "user.name", "StressBot"], None)?;

    // ---------- 文件结构 ----------
    println!("▸ 生成文件结构（目标 {target_files} 个文件）…");
    let mut specs: Vec<FileSpec> = Vec::new();
    // lang -> (pkg, mod) 索引（保留结构语义）
    let mut pkg_mods: std::collections::HashMap<Lang, Vec<(String, String)>> = Default::default();
    let mut idx = 0usize;
    'outer: for pkg in PKG_NAMES {
        for m in MOD_NAMES {
            for li in 0..3 {
                let lang = [Lang::Rust, Lang::Ts, Lang::Py][li];
                let rel = match lang {
                    Lang::Rust => format!("rust-app/src/{pkg}/{m}.rs"),
                    Lang::Ts => format!("web-src/packages/{pkg}/{m}.ts"),
                    Lang::Py => format!("tools/{pkg}_{m}.py"),
                };
                pkg_mods.entry(lang).or_default().push(((*pkg).to_string(), m.to_string()));
                specs.push(FileSpec {
                    rel,
                    lang,
                    deps: Vec::new(),
                    seed: rng.next_u64(),
                });
                idx += 1;
                if idx >= target_files {
                    break 'outer;
                }
            }
        }
    }

    // 骨架文件（Rust mod.rs / lib.rs，保证 use crate:: 路径真实存在）
    let rust_pkgs: Vec<String> = {
        let mut set = std::collections::BTreeSet::new();
        for s in specs.iter().filter(|s| s.lang == Lang::Rust) {
            let rel = s.rel.trim_start_matches("rust-app/src/");
            if let Some((pkg, _)) = rel.split_once('/') {
                set.insert(pkg.to_string());
            }
        }
        set.into_iter().collect()
    };
    let mut lib = String::new();
    let rust_src = root.join("rust-app/src");
    std::fs::create_dir_all(&rust_src)?;
    for pkg in &rust_pkgs {
        lib.push_str(&format!("pub mod {pkg};\n"));
        let pkg_dir = rust_src.join(pkg);
        std::fs::create_dir_all(&pkg_dir)?;
        let mut mods = String::new();
        for s in specs.iter().filter(|s| s.lang == Lang::Rust && s.rel.starts_with(&format!("rust-app/src/{pkg}/"))) {
            let m = s.rel.rsplit_once('/').unwrap().1.trim_end_matches(".rs");
            mods.push_str(&format!("pub mod {m};\n"));
        }
        let _ = std::fs::write(pkg_dir.join("mod.rs"), format!("// package {pkg}\n{mods}"));
    }
    let _ = std::fs::write(rust_src.join("lib.rs"), lib);
    let _ = std::fs::write(
        root.join("rust-app/Cargo.toml"),
        "[package]\nname = \"stress-app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
    );

    // 依赖连边：同语言随机 2~5 个依赖（自然成环），外加少量跨包长依赖
    for i in 0..specs.len() {
        let same: Vec<usize> = (0..specs.len())
            .filter(|&j| j != i && specs[j].lang == specs[i].lang)
            .collect();
        if same.is_empty() {
            continue;
        }
        let n = 2 + rng.range(4);
        let mut deps = std::collections::BTreeSet::new();
        for _ in 0..n {
            deps.insert(same[rng.range(same.len())]);
        }
        // 少量确定性环：i -> (i+7) % len
        if !specs.is_empty() {
            let cyc = (i + 7) % specs.len();
            if specs[cyc].lang == specs[i].lang {
                deps.insert(cyc);
            }
        }
        specs[i].deps = deps.into_iter().collect();
    }

    for s in specs.iter() {
        let p = root.join(&s.rel);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&p, file_content(s, &specs, 0))?;
    }

    // 工程杂项文件
    let _ = std::fs::write(
        root.join("package.json"),
        "{\n  \"name\": \"stress-web\",\n  \"private\": true,\n  \"type\": \"module\"\n}\n",
    );
    let _ = std::fs::write(root.join(".gitignore"), "target/\nnode_modules/\n__pycache__/\n");

    let mut date: i64 = 1_735_689_600; // 2025-01-01
    let mut tick = |root: &Path, git_args: &[&str], is_commit: bool| -> Result<String> {
        date += 3600 + (date % 7200);
        if is_commit {
            git(root, git_args, Some(date))?;
        }
        git(root, &["rev-parse", "HEAD"], None).map(|s| s.trim().to_string())
    };

    // ---------- 主线历史 ----------
    println!("▸ 生成主线提交（{target_commits} 个）…");
    git(root, &["add", "-A"], None)?;
    tick(root, &["commit", "-m", "init: 项目骨架"], true)?;
    let mut main_oids: Vec<String> = vec![git(root, &["rev-parse", "HEAD"], None)?.trim().to_string()];

    for c in 1..target_commits {
        // 随机改 1~4 个文件
        let n = 1 + rng.range(4);
        for _ in 0..n {
            let i = rng.range(specs.len());
            let rev = 1 + c;
            let content = file_content(&specs[i], &specs, rev);
            let _ = std::fs::write(root.join(&specs[i].rel), content);
        }
        git(root, &["add", "-A"], None)?;
        let msg = format!("{}: 变更 #{}", MSG_PREFIX[rng.range(MSG_PREFIX.len())], c);
        tick(root, &["commit", "-m", &msg], true)?;
        main_oids.push(git(root, &["rev-parse", "HEAD"], None)?.trim().to_string());
    }

    // ---------- 混乱分支 ----------
    println!("▸ 生成分支网络（{target_branches} 条）…");
    let branch_pool = [
        "feature/login", "feature/dashboard", "feature/api-v2", "feature/search",
        "feature/export", "fix/memory-leak", "fix/import-cycle", "hotfix/crash",
        "experiment/rust-rewrite", "experiment/wasm", "spike/new-cache",
        "refactor/storage", "chore/deps-bump", "docs/architecture", "release/1.0",
        "feature/plugin-system",
    ];
    let mut live_branches: Vec<String> = Vec::new();
    for (i, name) in branch_pool.iter().enumerate().take(target_branches) {
        // 从随机主线位置拉出（有的很早 → 长期落后；有的接近 HEAD）
        let bias = if i % 4 == 0 {
            0 // 从主线早期分叉
        } else {
            main_oids.len() - 1 - rng.range(main_oids.len() / 2 + 1)
        };
        let base = &main_oids[bias.min(main_oids.len() - 1)];
        git(root, &["checkout", "-b", name, base], None)?;
        let n_commits = 2 + rng.range(9);
        for c in 0..n_commits {
            let n = 1 + rng.range(3);
            for _ in 0..n {
                let fi = rng.range(specs.len());
                let content = file_content(&specs[fi], &specs, 100 + i * 20 + c);
                let _ = std::fs::write(root.join(&specs[fi].rel), content);
            }
            git(root, &["add", "-A"], None)?;
            let msg = format!("{}({}): 变更 {}", MSG_PREFIX[rng.range(MSG_PREFIX.len())], short(name), c + 1);
            tick(root, &["commit", "-m", &msg], true)?;
        }
        let action = rng.range(10);
        if action < 6 {
            // 合并回主线（一半用 -X ours 模拟冲突自动解决）
            git(root, &["checkout", "main"], None)?;
            if action < 3 {
                git(root, &["merge", "--no-edit", "-X", "ours", name], None)?;
            } else {
                // 直接合并；冲突则用 ours 策略兜底
                if git(root, &["merge", "--no-edit", name], None).is_err() {
                    let _ = git(root, &["merge", "--abort"], None);
                    let _ = git(root, &["merge", "--no-edit", "-X", "ours", name], None);
                }
            }
            main_oids.push(git(root, &["rev-parse", "HEAD"], None)?.trim().to_string());
        } else if action < 8 {
            // 与主线同步（把 main 合进分支），保持独立演进
            if git(root, &["merge", "--no-edit", "-X", "theirs", "main"], None).is_err() {
                let _ = git(root, &["merge", "--abort"], None);
            }
            live_branches.push((*name).to_string());
        } else {
            live_branches.push((*name).to_string());
        }
    }

    // 交叉合并：两个存活分支互相合并，制造网状关系
    if live_branches.len() >= 2 {
        let a = &live_branches[0];
        let b = &live_branches[1];
        git(root, &["checkout", a], None)?;
        let _ = git(root, &["merge", "--no-edit", "-X", "ours", b], None);
        git(root, &["checkout", "main"], None)?;
    }

    // 标签
    if let Some(mid) = main_oids.get(main_oids.len() / 2) {
        let _ = git(root, &["tag", "v0.1.0", mid], None);
    }
    let _ = git(root, &["tag", "v0.2.0"], None);
    git(root, &["checkout", "main"], None)?;

    let total = git(root, &["rev-list", "--all", "--count"], None)?.trim().to_string();
    println!("✓ 完成：{} 个文件，{} 个提交，{} 条分支", specs.len(), total, branch_pool.iter().take(target_branches).count());
    Ok(())
}

fn short(name: &str) -> &str {
    name.rsplit('/').next().unwrap_or(name)
}
