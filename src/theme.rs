use serde::{Deserialize, Serialize};
use eframe::egui;

// ----------------------------------------------------------------------------
// 主题模型 (Theme Models)
// ----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Theme {
    /// 窗口背景色 (Hex)
    pub background: String,
    /// 边框颜色 (Hex)
    pub border: String,
    /// 普通文字颜色 (Hex)
    pub text_normal: String,
    /// 白色/高亮文字颜色 (Hex)
    pub text_white: String,
    /// 灰色/次要文字颜色 (Hex)
    pub text_gray: String,
    /// 上涨颜色 (Hex)
    pub color_up: String,
    /// 下跌颜色 (Hex)
    pub color_down: String,
    /// 强调色 (Hex)
    pub accent: String,
    /// 菜单背景色 (Hex)
    pub menu_bg: String,
    /// 圆角大小
    pub rounding: f32,
    /// 边框宽度
    pub border_width: f32,
}

impl Default for Theme {
    fn default() -> Self {
        // 默认暗色主题
        Self {
            background: "#141414E6".to_string(), // rgba(20, 20, 20, 230)
            border: "#3C3C3C".to_string(),        // gray(60)
            text_normal: "#D3D3D3".to_string(),   // LightGray
            text_white: "#FFFFFF".to_string(),
            text_gray: "#808080".to_string(),
            color_up: "#FF6464".to_string(),      // rgb(255, 100, 100)
            color_down: "#64FF64".to_string(),    // rgb(100, 255, 100)
            accent: "#FFA500".to_string(),        // Orange
            menu_bg: "#232323".to_string(),
            rounding: 8.0,
            border_width: 1.0,
        }
    }
}

impl Theme {
    /// 解析 Hex 颜色字符串
    pub fn parse_color(hex: &str) -> egui::Color32 {
        let hex = hex.trim_start_matches('#');
        if hex.len() == 6 {
            let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0);
            let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0);
            let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0);
            egui::Color32::from_rgb(r, g, b)
        } else if hex.len() == 8 {
            let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0);
            let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0);
            let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0);
            let a = u8::from_str_radix(&hex[6..8], 16).unwrap_or(255);
            egui::Color32::from_rgba_premultiplied(r, g, b, a)
        } else {
            egui::Color32::WHITE // Default fallback
        }
    }

    /// 获取盈亏颜色
    pub fn get_profit_color(&self, profit: f64) -> egui::Color32 {
        if profit >= 0.0 { 
            Self::parse_color(&self.color_up) 
        } else { 
            Self::parse_color(&self.color_down) 
        }
    }

    /// 生成面板 Frame 样式
    pub fn panel_frame(&self) -> egui::Frame {
        egui::Frame {
            fill: Self::parse_color(&self.background),
            rounding: egui::Rounding::same(self.rounding),
            stroke: egui::Stroke::new(self.border_width, Self::parse_color(&self.border)),
            inner_margin: egui::Margin::symmetric(8.0, 4.0),
            ..Default::default()
        }
    }

    /// 预设赛博朋克主题
    pub fn cyberpunk() -> Self {
        Self {
            background: "#0A0A10F0".to_string(), // Very dark blue/black
            border: "#00F0FF".to_string(),        // Neon Cyan
            text_normal: "#00F0FF".to_string(),   // Neon Cyan
            text_white: "#DCF5FF".to_string(),    // Ice White
            text_gray: "#647882".to_string(),     // Blueish Gray
            color_up: "#FF2828".to_string(),      // Neon Red
            color_down: "#28FF28".to_string(),    // Neon Green
            accent: "#FF00FF".to_string(),        // Neon Magenta
            menu_bg: "#0F0F19".to_string(),       // Dark Blueish Black
            rounding: 2.0,
            border_width: 1.0,
        }
    }

    /// 预设浅色主题
    pub fn light() -> Self {
        Self {
            background: "#F5F5F7F2".to_string(), // 类似 macOS 浅色窗口背景
            border: "#D1D1D6".to_string(),        // 浅灰边框
            text_normal: "#1D1D1F".to_string(),   // 深灰/接近黑色文字
            text_white: "#000000".to_string(),    // 纯黑高亮
            text_gray: "#86868B".to_string(),     // 中性灰辅助文本
            color_up: "#EA4C89".to_string(),      // 柔和红
            color_down: "#4CAF50".to_string(),    // 材质绿
            accent: "#007AFF".to_string(),        // 系统蓝
            menu_bg: "#FFFFFF".to_string(),       // 纯白菜单背景
            rounding: 6.0,
            border_width: 1.0,
        }
    }

    /// 预设 Sublime 风格主题
    pub fn sublime() -> Self {
        Self {
            background: "#272822F0".to_string(), // Monokai 背景
            border: "#171814".to_string(),       // 深色边框
            text_normal: "#F8F8F2".to_string(),  // Monokai 前景
            text_white: "#FFFFFF".to_string(),
            text_gray: "#75715E".to_string(),    // Monokai 注释
            color_up: "#F92672".to_string(),     // Monokai Pink (红)
            color_down: "#A6E22E".to_string(),   // Monokai Green (绿)
            accent: "#66D9EF".to_string(),       // Monokai Blue
            menu_bg: "#272822".to_string(),
            rounding: 4.0,
            border_width: 1.0,
        }
    }
}
