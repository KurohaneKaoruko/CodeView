//! CodeView 桌面版：Tauri 壳 + 内嵌本地 axum 服务。
//! WebView 直接加载 http://127.0.0.1:<随机端口>/，与 Web 版共享同一套界面与 API。
//! 窗口为无边框自绘（HTML 标题栏 + data-tauri-drag-region），任何构建都不弹终端。

#![cfg_attr(windows, windows_subsystem = "windows")]

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn main() {
    let root = std::env::args()
        .nth(1)
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .and_then(|p| p.canonicalize().ok())
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let root = root.clone();
            let (tx, rx) = std::sync::mpsc::channel::<u16>();
            std::thread::spawn(move || {
                let rt = tokio::runtime::Builder::new_multi_thread()
                    .enable_all()
                    .build()
                    .expect("tokio runtime");
                let actual = rt
                    .block_on(codeview_server::start_server(root, 0))
                    .expect("启动内嵌服务失败");
                let _ = tx.send(actual);
                // 保持 runtime 存活
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(3600));
                }
            });
            let port = rx.recv().expect("服务端口");
            let url: tauri::Url = format!("http://127.0.0.1:{port}/")
                .parse()
                .expect("解析 URL");
            // 无边框窗口：标题栏、圆角边框由 HTML 侧自绘（见 assets/topbar）
            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("CodeView")
                .inner_size(1440.0, 920.0)
                .min_inner_size(900.0, 560.0)
                .decorations(false)
                .shadow(true)
                .resizable(true)
                .build()?;
            let _ = win.set_focus();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("CodeView 启动失败");
}
