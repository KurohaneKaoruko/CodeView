# CodeView — 轻量项目代码查看器

用 Rust 编写的轻量级项目代码查看器，一套界面、两种形态：

- **`codeview`（Web 版）**：终端命令。在任意目录运行即启动本地服务并自动打开浏览器，默认打开当前目录的项目；也可以传参数指定项目路径，或启动后在界面里随时切换项目。
- **`codeview-desktop`（桌面版）**：Tauri 桌面应用，内嵌同一个本地服务，加载同一套界面，体验与 Web 版完全一致。

## 功能

### 1. 代码查看与编辑
- 文件树浏览（懒加载目录、git 状态着色、右键新建/重命名/删除）
- 多标签编辑器：阅读模式（语法高亮）/ 编辑模式一键切换；标签支持中键关闭
- 编辑增强：`Tab` / `Shift+Tab` 缩进与反缩进（支持多行选区）、回车自动保持缩进、括号 / 引号自动配对、状态栏实时显示光标行列
- `Ctrl+S` 保存（保存后保持光标位置）；未保存标记；支持 Rust / JS·TS / Python / C·C++ / Go / Java / JSON / Markdown 等
- 有未保存修改时关闭 / 刷新页面会弹出提醒

### 1.1 快速导航
- **快速打开（`Ctrl+P`）**：模糊匹配项目内任意文件，支持路径片段检索（如 `auth/ser`），命中字符高亮
- **命令面板（`Ctrl+Shift+P` / `F1`）**：分组列出全部视图切换与文件操作命令，支持中文 / 英文别名检索
- **文件内查找（`Ctrl+F`）**：匹配高亮 + 当前项突出、上一个 / 下一个（`Enter` / `Shift+Enter`）、区分大小写、实时计数
- **跳转到行（`Ctrl+G`）**、**快捷键帮助（`Ctrl+/`）**

### 1.2 全局搜索（左侧栏 · 搜索）
- 子串 / 正则双模式、大小写敏感可选
- 结果按文件分组、命中词高亮，点击直接跳转编辑器对应行

### 1.3 AI 分析（左侧栏 · AI）
- 可配置任意 OpenAI 兼容接口（base_url / 模型 / API Key，密钥仅存本机 `~/.codeview/ai.json`）
- 快捷分析：当前文件、项目概览、最近提交
- 自由提问，可按需附带上下文：当前文件内容、项目结构、git 摘要（分支/变更/最近 30 提交）
- 回答以轻量 Markdown 渲染

### 2. Git 管理（历史 + 工作区同屏）
左侧为工作区面板（默认收起，点击从左侧展开，VS Code SCM 风格的紧凑分组列表），右侧为整宽的**树状提交图**：
- **树状提交图**：Canvas 绘制，所有本地/远程分支与标签的关系一目了然；原生滚动条查看，分支头带高亮环与引用徽标
- 点击节点 → 详情从**右侧抽屉**滑出（提交信息 + 变更文件 + 带行号 diff，点击行跳转编辑器对应行）
- **大型视图**：横向大画布（时间从左到右），支持滚轮缩放与拖拽平移，点击节点弹出提交信息卡片
- 节点右键就地操作：检出、在此创建分支（内联输入）、Cherry-pick、Revert、Reset（soft/mixed/hard 直选）、设为对比 A/B
- 分支头节点额外：检出分支 / 合并此分支到当前分支 / 变基当前分支到此 / 重命名 / 删除（未合并可强制删除）

### 2.1 Git 可视化操作
- 工作区面板：提交（Ctrl+Enter）、amend、暂存/取消暂存/丢弃、未跟踪一键加入、diff 查看
- 紧凑分组：暂存的更改 / 更改 / 未跟踪 / 分支，可折叠，行内悬停操作
- 工具栏 Fetch / Pull / Push 一键操作（Pull 方式右键切换 merge/rebase/ff-only；Push 右键强制推送）
- Merge / Rebase / Reset / Stash 弹窗（低频复杂选项）
- **冲突处理流**：冲突横幅 → 点击冲突文件直接编辑 → 标记已解决 → 继续 / 中止
- 写操作通过系统 `git` CLI 执行，认证与 hooks 行为与真实 git 一致

### 2.2 提交 / 分支对比
- 活动栏「对比」视图：任选两个引用（本地/远程分支、标签、commit id、HEAD）做树级差异对比
- 支持「以共同祖先为基准」（merge-base，类似 GitHub PR 三点对比）与直接快照对比两种模式
- 行级差异：双侧行号列、新增/删除行高亮、hunk 头定位
- 点击 diff 中任意行，直接在编辑器打开工作区文件并跳转高亮到对应行
- Git 历史中右键提交可一键设为对比的 A / B 端；支持一键交换 A/B

### 3. 依赖可视化
- **文件级依赖图**：力导向图渲染，可拖拽、缩放、平移、搜索、高亮邻居
  - Rust（`mod` / `use crate::`）、JS/TS（import/require，含 `@/` 别名与扩展名探测）、Python（绝对/相对导入）、C/C++（#include）、Go（go.mod 模块映射）、Java（import）
- **符号级依赖**：提取文件内的函数/类/结构体，查看每个符号在全项目的引用位置（含所在函数）、本文件内调用关系
- 循环依赖检测（Tarjan SCC），一键高亮环上文件
- 解析为静态规则匹配（尽力而为），不追求编译器级精确

### 4. 压力测试仓库生成器
内置合成仓库生成命令，用于极限测试可视化：

```bash
codeview genstress D:\tmp\stress --files 240 --commits 70 --branches 14
```

生成包含庞大文件结构（Rust/TS/Python 混合、跨模块依赖、人为循环依赖）与混乱分支历史（长期落后分支、互相合并的网状关系、冲突自动解决）的仓库。

### 5. 待补充
预留扩展：文件监视自动刷新、编辑器 LSP / 自动补全、查找替换、多光标编辑等。

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
├── js/views/              # 文件树 / 编辑器 / Git 历史 / Git 工作区 / 依赖图谱
└── js/palette.js          # 快速打开 / 命令面板（模糊匹配 + 键盘导航）
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
