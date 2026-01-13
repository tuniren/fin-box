请帮我用 Rust 创建一个极简的原生桌面悬浮窗应用。

基本要求：
- 每次问题回答或编写代码前都要阅读一遍规则文件。

我的环境：

- 操作系统：Windows 10

技术栈要求：

- 语言：Rust
- GUI 库： eframe (基于 egui)， 不要 使用 Tauri、Electron 或任何 Webview 方案。
核心功能需求：

1. 外观 ：无系统边框 ( decorations: false )，尺寸极小（约 120x28 像素），类似搜狗输入法状态栏。
2. 层级 ：窗口必须永远置顶 ( always_on_top )。
3. 交互 ： 全窗口拖拽 。不要标题栏，鼠标按住窗口内任意空白区域即可拖动窗口（使用 ctx.send_viewport_cmd(ViewportCommand::StartDrag) 实现原生流畅拖拽）。
4. 样式 ：背景支持透明或圆角，UI 简洁（例如显示一个计数器或状态文本）。
输出要求：

- 请提供完整的 Cargo.toml 依赖配置。
- 请提供完整的 src/main.rs 代码。