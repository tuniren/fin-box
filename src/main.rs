#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")] // Release 模式下隐藏控制台

mod app;
mod config;
mod core;
mod model;
mod theme;

use app::MyApp;
use eframe::egui;
use std::fs;

fn main() -> eframe::Result<()> {
// ... existing main logic ...
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_decorations(false)
            .with_always_on_top()
            .with_inner_size([240.0, 28.0]) // 尺寸
            .with_transparent(true)
            .with_resizable(false)
            .with_taskbar(false),
        ..Default::default()
    };

    eframe::run_native(
        "FinBox",
        options,
        Box::new(|cc| {
            // 配置字体
            setup_custom_fonts(&cc.egui_ctx);
            Ok(Box::new(MyApp::new()))
        }),
    )
}

fn setup_custom_fonts(ctx: &egui::Context) {
    let mut fonts = egui::FontDefinitions::default();

    // 候选字体列表 (包含 Windows, macOS, Linux 常见中文字体)
    let font_candidates = vec![
        // Windows
        "C:\\Windows\\Fonts\\msyh.ttc",
        "C:\\Windows\\Fonts\\msyh.ttf",
        "C:\\Windows\\Fonts\\simhei.ttf",
        // macOS
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
        // Linux (常见路径，各发行版可能不同)
        "/usr/share/fonts/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
    ];

    let mut font_data_loaded = false;
    
    for path in font_candidates {
        if let Ok(font_data) = fs::read(path) {
            println!("Loaded font from: {}", path);
            // 安装字体
            fonts.font_data.insert(
                "system_font".to_owned(),
                std::sync::Arc::new(egui::FontData::from_owned(font_data)),
            );

            // 将新字体设为 Proportional (默认) 和 Monospace 的首选
            if let Some(family) = fonts.families.get_mut(&egui::FontFamily::Proportional) {
                family.insert(0, "system_font".to_owned());
            }
            if let Some(family) = fonts.families.get_mut(&egui::FontFamily::Monospace) {
                family.insert(0, "system_font".to_owned());
            }

            font_data_loaded = true;
            break; // 找到一个就停止
        }
    }

    if font_data_loaded {
        // 应用配置
        ctx.set_fonts(fonts);
    } else {
        eprintln!("Failed to load any system font. Chinese characters may not display correctly.");
    }
}
