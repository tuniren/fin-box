# FinBox Electron + React 版本

FinBox 盯盘软件

## 下载
https://github.com/tuniren/fin-box/releases

1. FinBox-Portable-x.x.x-win-x64.exe（便携免安装版）
作用：这是一个绿色免安装的独立可执行文件。

特点：下载后双击即可直接运行，不会写入 Windows 注册表，也不会在系统盘（C盘）生成配置文件。所有用户数据通常保存在该文件同级的文件夹或用户目录下。

适用场景：适合想快速试用、不喜欢在系统里留痕迹，或者需要放在 U 盘里随时带走的用户。

2. FinBox-Setup-x.x.x-win-x64.exe（标准安装版）（推荐安装）
作用：这是标准的 Windows 安装程序（NSIS 或类似打包工具）。

特点：运行后会引导你选择安装目录，将程序文件释放到指定位置，自动创建桌面快捷方式和开始菜单图标，并将相关信息写入注册表（用于“卸载程序”列表和文件关联）。

适用场景：适合长期固定使用，软件更新时通常支持增量更新，且卸载更干净。

## 版本号说明

版本号采用 `x.y.z` 格式：

- `x`：大版本号，表示存在重大功能、架构或兼容性变化。
- `y`：功能版本号，表示新增功能，并保持向后兼容。
- `z`：Bug 修复版本号，表示修复问题，并保持向后兼容。

## 版本规划

### 1.1.0

- [ ] 个股执行策略笔记。
- [ ] 持股支持输入购入日期，该日期为可选项，不填写也可以。
- [ ] 支持在个股中记录日常笔记。

## 技术栈

- Electron `42.2.0`
- React + TypeScript
- Vite
- esbuild
- YAML 配置文件

## 环境要求

- Node.js 22 或更高版本
- npm 10 或更高版本

当前开发机器已验证版本：

- Node.js `v22.21.1`
- npm `11.15.0`

## 安装依赖

进入项目目录：

```bash
cd fin-box
npm install
```

## 配置文件

在 Windows 上通常位于：

```text
%APPDATA%\fin-box\config.yaml
```

其他系统通常位于：

```text
macOS: ~/Library/Application Support/fin-box/config.yaml
Linux: ~/.config/fin-box/config.yaml
```

应用首次启动会自动生成默认配置。也可以在应用中打开File -> open config。

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

