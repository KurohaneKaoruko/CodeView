//! CodeView 桌面版：Tauri 壳 + 内嵌本地 axum 服务。
//! WebView 直接加载 http://127.0.0.1:<随机端口>/，与 Web 版共享同一套界面与 API。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    let root = std::env::args()
        .nth(1)
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .and_then(|p| p.canonicalize().ok())
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    tauri::Builder::default()
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
            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("CodeView")
                .inner_size(1440.0, 920.0)
                .min_inner_size(960.0, 600.0)
                .build()?;
            let _ = win.set_focus();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("CodeView 启动失败");
}
