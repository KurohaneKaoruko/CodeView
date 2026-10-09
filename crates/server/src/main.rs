//! `codeview` 终端命令入口。
//!
//! 用法：
//!   codeview [路径] [--port N] [--no-open]   启动服务并打开浏览器
//!   codeview install                          将命令注册到用户 PATH
//!   codeview uninstall                        移除注册

use anyhow::{anyhow, bail, Context, Result};
use std::path::PathBuf;

mod genstress;

fn install() -> Result<()> {
    let exe = std::env::current_exe()?;
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .map_err(|_| anyhow!("无法定位用户目录"))?;
    let bin_dir = home.join(".codeview").join("bin");
    std::fs::create_dir_all(&bin_dir)?;
    let file_name = exe.file_name().unwrap_or_default().to_owned();
    let target = bin_dir.join(&file_name);
    std::fs::copy(&exe, &target).context("复制可执行文件失败")?;
    let dir_str = bin_dir.to_string_lossy().replace('/', "\\");
    let script = format!(
        "$d='{d}'; $p=[Environment]::GetEnvironmentVariable('Path','User'); \
         if ($null -eq $p) {{ $p='' }}; \
         if (($p -split ';') -notcontains $d) {{ \
           [Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';') + ';' + $d), 'User'); \
           Write-Output 'PATH-UPDATED' \
         }} else {{ Write-Output 'PATH-EXISTS' }}",
        d = dir_str
    );
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .context("执行 PowerShell 失败")?;
    let msg = String::from_utf8_lossy(&out.stdout);
    println!("已安装到: {}", target.display());
    if msg.contains("PATH-UPDATED") {
        println!("已添加到用户 PATH。请重新打开终端后，即可在任意位置使用 `codeview` 命令。");
    } else if msg.contains("PATH-EXISTS") {
        println!("PATH 中已存在该目录，无需重复添加。");
    } else {
        println!(
            "未能自动修改 PATH，请手动将以下目录加入 PATH：\n  {dir_str}\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    Ok(())
}

fn uninstall() -> Result<()> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .map_err(|_| anyhow!("无法定位用户目录"))?;
    let bin_dir = home.join(".codeview");
    let dir_str = bin_dir.to_string_lossy().replace('/', "\\");
    let script = format!(
        "$d='{d}'; $p=[Environment]::GetEnvironmentVariable('Path','User'); \
         if ($null -ne $p) {{ \
           $np=($p -split ';' | Where-Object {{ $_ -ne $d -and $_ -ne '' }}) -join ';'; \
           [Environment]::SetEnvironmentVariable('Path', $np, 'User'); Write-Output 'PATH-CLEANED' \
         }}",
        d = dir_str
    );
    let _ = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output();
    if bin_dir.exists() {
        std::fs::remove_dir_all(&bin_dir).context("删除安装目录失败")?;
        println!("已删除: {}", bin_dir.display());
    }
    println!("已从用户 PATH 移除（若之前添加过）。重新打开终端后生效。");
    Ok(())
}

fn print_help() {
    println!(
        "CodeView — 轻量项目代码查看器\n\n\
         用法: codeview [路径] [选项]\n\
         \x20 codeview                在当前目录启动（默认浏览器自动打开）\n\
         \x20 codeview <项目路径>      打开指定项目\n\
         \x20 codeview install        注册 `codeview` 命令到用户 PATH\n\
         \x20 codeview uninstall      移除注册\n\n\
         选项:\n\
         \x20 --port <N>   指定端口（默认 7878，被占用时自动顺延）\n\
         \x20 --no-open    不自动打开浏览器\n\
         \x20 --help       显示帮助"
    );
}

fn parse_args(args: &[String]) -> Result<(Option<PathBuf>, u16, bool)> {
    let mut path: Option<PathBuf> = None;
    let mut port = 7878u16;
    let mut open = true;
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        match a.as_str() {
            "--port" => {
                i += 1;
                port = args
                    .get(i)
                    .context("--port 缺少参数")?
                    .parse()
                    .context("端口必须是数字")?;
            }
            "--no-open" => open = false,
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            other => {
                if !other.starts_with('-') && path.is_none() {
                    path = Some(PathBuf::from(other));
                }
            }
        }
        i += 1;
    }
    Ok((path, port, open))
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(|s| s.as_str()) == Some("install") {
        return install();
    }
    if args.first().map(|s| s.as_str()) == Some("uninstall") {
        return uninstall();
    }
    if args.first().map(|s| s.as_str()) == Some("genstress") {
        let mut path = None;
        let mut files = 240usize;
        let mut commits = 60usize;
        let mut branches = 12usize;
        let mut it = args.iter().skip(1);
        while let Some(a) = it.next() {
            match a.as_str() {
                "--files" => files = it.next().context("--files 缺参数")?.parse()?,
                "--commits" => commits = it.next().context("--commits 缺参数")?.parse()?,
                "--branches" => branches = it.next().context("--branches 缺参数")?.parse()?,
                p if !p.starts_with('-') => path = Some(PathBuf::from(p)),
                _ => {}
            }
        }
        let p = path.context("genstress 需要目标路径，例如: codeview genstress D:\\tmp\\stress")?;
        return genstress::generate(&p, files, commits, branches);
    }
    let (path_arg, port, open_browser) = parse_args(&args)?;

    let root = path_arg.unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let root = root
        .canonicalize()
        .with_context(|| format!("路径不存在: {}", root.display()))?;
    if !root.is_dir() {
        bail!("不是目录: {}", root.display());
    }

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let actual = rt.block_on(codeview_server::start_server(root.clone(), port, false, None))?;
    let url = format!("http://127.0.0.1:{actual}/");
    println!("CodeView 已启动: {url}");
    println!("项目: {}", root.display());
    println!("按 Ctrl+C 退出");
    if open_browser {
        let _ = open::that_detached(&url);
    }
    // 服务以后台任务运行，这里驻留主线程
    loop {
        std::thread::sleep(std::time::Duration::from_secs(3600));
    }
}
