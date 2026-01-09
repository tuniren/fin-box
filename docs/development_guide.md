# 开发指南 (Development Guide)

本指南包含项目的编译、运行、调试和打包流程。

## 1. 环境准备
- 操作系统: Windows 10/11 (由于使用了 Windows 系统字体和特定的 GUI 配置)
- 工具链: Rust (Cargo)

## 2. 编译与运行 (Compile & Run)

### 开发模式运行
在开发过程中，使用以下命令快速编译并运行：
```bash
cargo run
```

### 仅检查编译错误
如果不需要运行，只需检查代码是否有误：
```bash
cargo check
```

## 3. 调试 (Debugging)
推荐使用 **VS Code** 配合 **CodeLLDB** 或 **Rust-Analyzer** 插件。
- 可以在代码中打断点，直接通过 VS Code 的 "Run and Debug" 面板启动调试会话。
- 注意：由于应用是“置顶”的，断点命中时 VS Code 可能会被悬浮窗遮挡，建议调试时暂时关闭 `always_on_top` 或将窗口移开。

## 4. 打包与发布 (Build & Release)

### 构建 Release 版本
生成优化后的可执行文件：
```bash
cargo build --release
```

### 产物位置
构建完成后，可执行文件位于：
`target/release/fin-box.exe`

### 分发说明
- 将 `fin-box.exe` 复制到任意位置即可运行。
- **依赖项**: 本项目目前依赖系统自带的微软雅黑字体 (`C:\Windows\Fonts\msyh.ttc`)，在标准中文 Windows 环境下可直接运行。
- **注意**: 这是一个无控制台窗口的 GUI 应用（但在开发构建中可能会看到控制台，Release 构建通常也会保留控制台除非配置了 `#![windows_subsystem = "windows"]`，本项目目前未强制隐藏控制台，若需完全隐藏，可在 `main.rs` 顶部添加该属性）。

## 5. 常见问题
- **中文乱码**: 确保系统存在 `msyh.ttc` 字体文件。
- **编译错误 (Linker)**: 如果遇到链接错误，尝试运行 `cargo clean` 后重试。
