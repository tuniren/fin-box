# Linux 安装

FinBox Linux 安装包适用于 Ubuntu 26.04 及兼容发行版的 64 位 x86 系统。当前版本文件名为 `FinBox-1.3.2-linux-amd64.deb`。

## 安装

在项目的 `release` 目录运行：

```bash
sudo apt install ./release/FinBox-1.3.2-linux-amd64.deb
```

使用 `apt install ./...deb` 会安装本地软件包，并自动处理发行版仓库中可用的依赖。安装完成后，可在桌面应用菜单中搜索 **FinBox**，或从终端运行：

```bash
fin-box
```

如果通过文件管理器打开安装包，也可以使用系统的软件安装器完成安装。

## 验证安装

```bash
dpkg-query -W -f='${Status} ${Version}\n' fin-box
```

正常结果应包含 `install ok installed 1.3.2`。

## 卸载

```bash
sudo apt remove fin-box
```

应用配置和用户数据保存在用户目录中；移除软件包不会删除这些数据。

## KDE Wayland

在 KDE Plasma Wayland 下，FinBox 会在检测到 XWayland 时通过 XWayland 启动，以便窗口管理器处理浮窗置顶。请确保系统已安装并启用 XWayland。少数 Wayland 合成器可能仍会自行限制应用窗口置顶。
