# FinBox Electron + React 版本

这是 FinBox 的 Electron + React + TypeScript 重写版本，位于独立目录 `electron-react`，不影响仓库根目录下现有 Rust 工程。

## 下载
https://github.com/tuniren/fin-box/releases/tag/electron-v1.0.0

## 技术栈

- Electron `42.2.0`
- React + TypeScript
- Vite
- esbuild
- YAML 配置文件

## 环境要求

- Node.js 22 或更高版本
- npm 10 或更高版本

当前机器已验证：

```bash
node --version
npm --version
```

## 安装依赖

进入新项目目录：

```bash
cd electron-react
npm install
```

如果遇到 npm 用户缓存目录权限问题，可以使用项目内缓存：

```bash
npm install --cache ./.npm-cache
```

## 调试运行

开发模式会先编译 Electron 主进程和 preload，然后启动 Vite，再启动 Electron：

```bash
npm run dev
```

调试时涉及三部分：

- Electron 主进程：`src/main`
- preload 安全桥：`src/preload.ts`
- React 渲染层：`src/renderer`

常见改动位置：

- 行情接口、搜索、K 线：`src/main/sina.ts`
- 配置文件读写：`src/main/config.ts`
- 核心状态与刷新逻辑：`src/main/core.ts`
- 窗口、快捷键、IPC：`src/main/main.ts`
- 悬浮窗和 K 线界面：`src/renderer/App.tsx`
- 样式：`src/renderer/App.css`
- 共享类型、盈亏计算、主题：`src/shared`

## 配置文件

Electron 版和 Rust 版使用同一个用户配置文件。

在 Windows 上通常位于：

```text
%APPDATA%\fin-box\config.yaml
```

其他系统通常位于：

```text
macOS: ~/Library/Application Support/fin-box/config.yaml
Linux: ~/.config/fin-box/config.yaml
```

应用首次启动会自动生成默认配置。也可以在应用右键菜单中点击“打开配置”或“打开目录”。

## 类型检查

```bash
npm run typecheck
```

## 构建

```bash
npm run build
```

构建产物：

- React 前端：`dist`
- Electron 主进程和 preload：`dist-electron`

这个命令只生成 Electron 可加载的生产文件，不会生成 `.exe`、`.dmg`、`.AppImage` 等平台可执行程序。

## 打包为平台可执行程序

项目使用 `electron-builder` 打包。首次使用前先安装依赖：

```bash
npm install
```

只生成当前平台的解包目录，适合快速检查打包内容：

```bash
npm run pack
```

生成当前平台的安装包/可执行程序：

```bash
npm run dist
```

按指定平台打包：

```bash
npm run dist:win
npm run dist:mac
npm run dist:linux
```

打包产物默认输出到 `release` 目录。

常见产物：

- Windows：`FinBox-1.0.0-win-x64.exe`，包含 NSIS 安装包和 portable 可执行程序
- macOS：`.dmg` 和 `.zip`
- Linux：`.AppImage` 和 `.deb`

注意：

- 通常只能在当前系统上稳定打包当前平台。Windows 上适合打包 Windows，macOS 上适合打包 macOS。
- macOS 签名、公证，以及 Windows 代码签名需要额外证书配置；未配置时仍可生成本地测试包，但系统可能提示未知开发者。
- 如果修改版本号，产物文件名中的版本会跟随 `package.json` 的 `version`。

## 启动构建后的应用

先构建：

```bash
npm run build
```

再启动：

```bash
npm start
```

## 当前已迁移功能

- 无边框、透明、置顶悬浮窗
- 配置 YAML 自动生成、读取、保存和热刷新
- 新浪实时行情批量拉取
- 股票搜索与添加
- 持仓、市值、当日盈亏、总盈亏、盈亏点数计算
- 展开列表和右键菜单
- `Ctrl + Alt + 8` 切换股票
- `Ctrl + Alt + 9` 展开/收起
- 独立 K 线窗口
- 内置主题兼容

## 注意事项

- 打包配置位于 `package.json` 的 `build` 字段。
- 行情和搜索依赖新浪接口，网络不可用或接口变更时会影响数据。
- 新目录是完整重写版本，根目录 Rust 代码没有被删除或替换。
