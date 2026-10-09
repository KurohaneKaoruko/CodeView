# CodeView — 轻量项目代码查看器

用 Rust 编写的轻量级项目代码查看器，一套界面、两种形态：

- **`codeview`（Web 版）**：终端命令。在任意目录运行即启动本地服务并自动打开浏览器，默认打开当前目录的项目；也可以传参数指定项目路径，或启动后在界面里随时切换项目。
- **`codeview-desktop`（桌面版）**：Tauri 桌面应用，内嵌同一个本地服务，加载同一套界面，体验与 Web 版完全一致。

## 功能

### 1. 代码查看与编辑
- 文件树浏览（懒加载目录、git 状态着色、右键新建/重命名/删除）
- 多标签编辑器：阅读模式（语法高亮）/ 编辑模式一键切换
- `Ctrl+S` 保存；未保存标记；支持 Rust / JS·TS / Python / C·C++ / Go / Java / JSON / Markdown 等常见语言

### 2. Git 可视化
- 完整的分叉历史图（泳道算法渲染，覆盖所有本地/远程分支与标签）
- 分支筛选、提交搜索、滚动分页加载
- 提交详情：变更文件列表 + 逐文件 diff
- 提交右键菜单：复制 hash、检出、cherry-pick、revert、reset、在此创建分支

### 2.1 Git 可视化操作
- 暂存 / 取消暂存 / 丢弃改动 / 提交 / amend
- Fetch / Pull（merge、rebase、ff-only 三种模式）/ Push（-u、force-with-lease）
- 分支：新建（可立即切换）/ 切换 / 删除（含 -D）
- Merge（no-ff、squash）、Rebase（可选 onto）
- Revert（反向提交）、Cherry-pick、Reset（soft/mixed/hard）、Stash（push/pop/apply/drop）
- **冲突处理流**：冲突横幅 → 点击冲突文件直接编辑 → 标记已解决 → 继续 / 中止，全程可视化
- 所有写操作通过系统 `git` CLI 执行，认证、hooks 行为与真实 git 完全一致

### 3. 依赖可视化
- **文件级依赖图**：力导向图渲染，可拖拽、缩放、平移、搜索、高亮邻居
  - Rust（`mod` / `use crate::`）、JS/TS（import/require，含 `@/` 别名与扩展名探测）、Python（绝对/相对导入）、C/C++（#include）、Go（go.mod 模块映射）、Java（import）
- **符号级依赖**：提取文件内的函数/类/结构体，查看每个符号在全项目的引用位置（含所在函数）、本文件内调用关系
- 循环依赖检测（Tarjan SCC），一键高亮环上文件
- 解析为静态规则匹配（尽力而为），不追求编译器级精确

### 4. 待补充
预留扩展：全局文本搜索、文件监视自动刷新、diff 对比视图、编辑器 LSP 等。

## 构建与使用

环境要求：Rust 1.75+（MSVC 工具链）、git（写操作需要）、桌面版需要 WebView2（Win10/11 自带）。

```bash
# 只构建 Web 版（默认，桌面端不参与默认编译）
cargo build --release

# 构建桌面版
cargo build --release -p codeview-desktop
```

### Web 版

```bash
# 方式一：直接运行
./target/release/codeview.exe              # 打开当前目录的项目
./target/release/codeview.exe D:\path\to\project --port 8080

# 方式二：注册为终端命令（复制到 %USERPROFILE%\.codeview\bin 并加入用户 PATH）
codeview install
# 之后任意终端：
codeview                    # 打开当前目录项目
codeview ..\other-project   # 打开指定项目
codeview uninstall          # 移除注册
```

启动后自动打开 `http://127.0.0.1:7878/`（端口被占用时自动顺延）；`--no-open` 可禁止自动开浏览器。

### 桌面版

```bash
cargo run -p codeview-desktop              # 以当前目录为项目启动
cargo run -p codeview-desktop -- D:\path   # 指定项目
```

## 架构

```
Cargo.toml                 # workspace（default-members 不含 desktop，普通 cargo build 更快）
assets/                    # 共享前端：原生 HTML/JS/CSS，零构建，由服务端内嵌
└── js/views/              # 文件树 / 编辑器 / Git 历史 / Git 工作区 / 依赖图谱
crates/
├── core/                  # 业务核心（纯库）
│   ├── fsx.rs             #   文件树/读写，路径越界防护
│   ├── gitread.rs         #   git2 读：log / refs / status / diff
│   ├── gitwrite.rs        #   git CLI 写：全量 git 操作 + 冲突检测
│   └── deps.rs            #   依赖分析：import 解析 / 符号提取 / SCC 找环
├── server/                # axum 服务（lib 供复用 + bin 即 codeview 命令）
└── desktop/               # Tauri 壳：启动内嵌服务并加载 127.0.0.1:<随机端口>
```

设计要点：
- **一套 API 两种壳**：桌面版 WebView 直接加载内嵌服务的地址，前后端只有 HTTP 一种通信方式，无 IPC 胶水。
- **git2 读 + CLI 写**：读取（历史/状态/diff）走 libgit2 高性能通道；一切变更操作走系统 git，凭据管理器、hooks、复杂 rebase 行为与命令行完全一致。
- **安全**：服务只绑定 `127.0.0.1`；所有文件路径经越界校验；git 引用名经校验后传给 CLI。

## 已知限制

- 依赖分析为正则级静态解析，宏生成代码、复杂别名等场景识别不到。
- 符号引用按词边界匹配，跨语言同名符号会互相命中（如 Rust 与 Python 的 `main`）。
- Push/Pull 需要系统 git 凭据可用（已设置 `GIT_TERMINAL_PROMPT=0` 防止挂起，未保存凭据时会快速失败并提示）。
