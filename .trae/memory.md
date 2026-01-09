# FinBox Development Memory

This document records the development journey of FinBox (formerly f-box), a minimal desktop stock monitoring widget.

## 1. Project Inception
- **Goal**: Create a minimal, always-on-top, borderless desktop widget for monitoring A-share stocks.
- **Tech Stack**: Rust, eframe (egui), reqwest (blocking), serde.
- **Initial Features**:
    - Small window (approx. 240x28px).
    - Draggable anywhere.
    - Transparent/rounded background.
    - Displays time by default.

## 2. Core Feature Implementation
- **Stock Monitoring**: Integrated Sina Finance API to fetch real-time data for configured stocks.
- **Config Management**: Implemented YAML-based configuration (`config.yaml`) stored in user directories.
- **Display Modes**:
    - **Time Mode**: Shows current date/time.
    - **Profit Mode**: Shows Total Profit | Day Profit.
- **Expandable UI**:
    - Click `▶` button to expand a list of monitored stocks.
    - Dynamic window height adjustment based on content.

## 3. UI/UX Refinements
- **Right-Click Menu**:
    - Initially a native popup, later refactored to a custom **embedded overlay** to ensure visibility within the borderless window.
    - Options: "Open Config", "Exit Program".
    - **Optimization**: Moved menu to be in-flow (inserted between header and list) for better layout stability.
- **Visuals**:
    - Orange accent colors for buttons/icons.
    - Red/Green color coding for profits (Red = Gain, Green = Loss).
    - **Grab Cursor**: Added `CursorIcon::Grab` when hovering over the background to indicate draggability.
- **Toggle Mechanism Evolution**:
    1.  Added a specific toggle button (`⇄` then `↔`).
    2.  Removed button, enabled "Click Text to Toggle".
    3.  Implemented Global Hotkey (`Ctrl + 0`).
    4.  Changed Global Hotkey to `Ctrl + Alt + 8`.
    5.  Restored Toggle Button (`↔`) alongside the hotkey, while disabling "Click Text to Toggle" to prevent accidental clicks during dragging.
    6.  **Final State**: Toggle via `↔` button OR `Ctrl + Alt + 8`.

## 4. Technical Improvements & Bug Fixes
- **Cross-Platform Fonts**: Implemented a font loading strategy that searches for system fonts on Windows (`msyh`), macOS (`PingFang`), and Linux (`NotoSans`) to fix Chinese character rendering.
- **High DPI/Height Issues**:
    - Fixed an issue where initial window height didn't match the collapsed height by adjusting internal margins (`4.0` -> `2.0` -> reverted to `4.0` with base height `28.0`).
- **Performance**:
    - Cached window size to prevent unnecessary `send_viewport_cmd` calls.
    - Implemented smart refresh intervals (5s trading time, 60s idle).
- **Draggability**:
    - Enabled dragging on text labels to improve usability.

## 5. Project Renaming & release
- **Renaming**: Renamed project from `f-box` to **`fin-box` (FinBox)** to better reflect its financial purpose.
- **Documentation**:
    - Created `LICENSE` (Apache 2.0).
    - Consolidated user manual into `README.md`.
    - Updated `requirements.md` to reflect completed status.
- **Release**:
    - Successfully built `target/release/fin-box.exe`.

## 6. Current State (v1.0)
- **Executable**: `fin-box.exe`
- **Configuration**: `%APPDATA%\zeicm\fin-box\config.yaml`
- **Shortcuts**: `Ctrl + Alt + 8` to toggle display mode.
- **Interaction**: Drag anywhere, Right-click for menu.
