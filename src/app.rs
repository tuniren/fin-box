use eframe::egui;
use crate::core::AppCore;
use chrono::{Local, Datelike};
use global_hotkey::{GlobalHotKeyManager, hotkey::{HotKey, Modifiers, Code}, GlobalHotKeyEvent};

pub struct MyApp {
    core: AppCore,
    is_expanded: bool,
    last_window_size: Option<egui::Vec2>,
    show_profit: bool, // false: 显示时间, true: 显示盈亏
    show_menu: bool,   // 是否显示右键菜单
    hotkey_manager: GlobalHotKeyManager,
    toggle_hotkey: HotKey,
}

impl MyApp {
    pub fn new() -> Self {
        let manager = GlobalHotKeyManager::new().unwrap();
        let toggle_hotkey = HotKey::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Digit8);
        if let Err(e) = manager.register(toggle_hotkey) {
            eprintln!("Failed to register hotkey: {:?}", e);
        }

        Self {
            core: AppCore::new(),
            is_expanded: false,
            last_window_size: None,
            show_profit: false,
            show_menu: false,
            hotkey_manager: manager,
            toggle_hotkey,
        }
    }

    fn render_ui(&mut self, ctx: &egui::Context) {
        let state = self.core.get_state();
        
        // 基础高度
        let base_height = 28.0;
        
        // 计算内容高度
        let list_height = if self.is_expanded {
            24.0 + (state.stocks.len() as f32 * 24.0) + 10.0
        } else {
            0.0
        };

        let menu_height = 80.0; // 菜单高度

        let mut content_height = base_height;
        
        // 如果显示菜单，增加菜单高度
        if self.show_menu {
            content_height += menu_height;
        }

        // 如果展开了详情，增加列表高度
        if self.is_expanded {
            content_height += list_height;
        }
        
        // 稍微加宽一点窗口以容纳更多信息
        let width = if self.is_expanded { 260.0 } else { 240.0 };
        let new_size = egui::vec2(width, content_height);

        // 仅当尺寸发生变化时发送调整指令
        if self.last_window_size != Some(new_size) {
            ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(new_size));
            self.last_window_size = Some(new_size);
        }

        let panel_frame = egui::Frame {
            fill: egui::Color32::from_rgba_premultiplied(20, 20, 20, 230),
            rounding: egui::Rounding::same(8.0),
            stroke: egui::Stroke::new(1.0, egui::Color32::from_gray(60)),
            inner_margin: egui::Margin::symmetric(8.0, 4.0),
            ..Default::default()
        };

        egui::CentralPanel::default()
            .frame(panel_frame)
            .show(ctx, |ui| {
                // 全局右键检测 (在 CentralPanel 内)
                // 使用 interact 检测整个区域的点击
                let response = ui.interact(ui.max_rect(), ui.id().with("bg"), egui::Sense::click());
                
                // 悬浮时显示抓取图标，提示可拖拽
                if response.hovered() {
                    ui.ctx().set_cursor_icon(egui::CursorIcon::Grab);
                }

                if response.clicked_by(egui::PointerButton::Secondary) {
                    self.show_menu = !self.show_menu;
                }

                // 1. 顶部栏：总览 + 展开按钮
                ui.horizontal(|ui| {
                    // 展开/收起按钮
                    let icon = if self.is_expanded { "▼" } else { "▶" };
                    if ui.add(egui::Button::new(egui::RichText::new(icon).color(egui::Color32::from_rgb(255, 165, 0))).frame(false).small()).clicked() {
                        self.is_expanded = !self.is_expanded;
                    }

                    // 右侧区域 (包含刷新按钮，以及剩余空间用于居中显示中间内容)
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.add_space(4.0); // 右边距

                        // 刷新按钮 (⟳)
                        if ui.add(egui::Button::new(egui::RichText::new("⟳").color(egui::Color32::from_rgb(255, 165, 0))).frame(false).small()).clicked() {
                            self.core.force_refresh();
                        }

                        // 切换按钮 (↔)
                        if ui.add(egui::Button::new(egui::RichText::new("↔").color(egui::Color32::from_rgb(255, 165, 0))).frame(false).small()).clicked() {
                            self.show_profit = !self.show_profit;
                        }

                        // 中间区域 (剩余空间)
                        ui.centered_and_justified(|ui| {
                            // 中间显示区域 (时间 或 盈亏)
                            if self.show_profit {
                                // 显示总盈亏 | 今日盈亏
                                let total_profit = state.total_profit();
                                let day_profit = state.total_day_profit();
                                
                                let get_color = |profit: f64| {
                                    if profit >= 0.0 {
                                        egui::Color32::from_rgb(255, 100, 100) // 红涨
                                    } else {
                                        egui::Color32::from_rgb(100, 255, 100) // 绿跌
                                    }
                                };
        
                                let mut job = egui::text::LayoutJob::default();
                                
                                // 总盈亏
                                job.append(
                                    &format!("{:+.0}", total_profit),
                                    0.0,
                                    egui::TextFormat {
                                        color: get_color(total_profit),
                                        font_id: egui::FontId::proportional(13.0),
                                        ..Default::default()
                                    },
                                );
                                
                                // 分隔符
                                job.append(
                                    "|",
                                    0.0,
                                    egui::TextFormat {
                                        color: egui::Color32::GRAY,
                                        font_id: egui::FontId::proportional(13.0),
                                        ..Default::default()
                                    },
                                );
                                
                                // 今日盈亏
                                job.append(
                                    &format!("{:+.0}", day_profit),
                                    0.0,
                                    egui::TextFormat {
                                        color: get_color(day_profit),
                                        font_id: egui::FontId::proportional(13.0),
                                        ..Default::default()
                                    },
                                );
                                
                                let response = ui.add(egui::Label::new(job).sense(egui::Sense::drag()));
                                if response.hovered() {
                                    ui.ctx().set_cursor_icon(egui::CursorIcon::Grab);
                                }
                                if response.drag_started() {
                                    ctx.send_viewport_cmd(egui::ViewportCommand::StartDrag);
                                }
                            } else {
                                // 显示系统时间: 02-29 20:13 星期x
                                let now = Local::now();
                                let weekday_str = match now.weekday() {
                                    chrono::Weekday::Mon => "一",
                                    chrono::Weekday::Tue => "二",
                                    chrono::Weekday::Wed => "三",
                                    chrono::Weekday::Thu => "四",
                                    chrono::Weekday::Fri => "五",
                                    chrono::Weekday::Sat => "六",
                                    chrono::Weekday::Sun => "日",
                                };
                                let time_str = format!("{} 星期{}", now.format("%m-%d %H:%M"), weekday_str);
                                let response = ui.add(egui::Label::new(
                                    egui::RichText::new(time_str)
                                        .size(13.0)
                                        .color(egui::Color32::LIGHT_GRAY)
                                        .strong()
                                ).sense(egui::Sense::drag()));
                                
                                if response.hovered() {
                                    ui.ctx().set_cursor_icon(egui::CursorIcon::Grab);
                                }
                                if response.drag_started() {
                                    ctx.send_viewport_cmd(egui::ViewportCommand::StartDrag);
                                }
                            }
                        });
                    });
                });

                // 2. 菜单区域 (插入到顶部栏和列表之间)
                if self.show_menu {
                    ui.separator();
                    
                    // 菜单容器
                    egui::Frame::none()
                        .fill(egui::Color32::from_rgb(35, 35, 35))
                        .rounding(4.0)
                        .inner_margin(4.0)
                        .show(ui, |ui| {
                            ui.set_width(ui.available_width());
                            ui.vertical_centered(|ui| {
                                if ui.add(egui::Button::new(egui::RichText::new(" 🛠 打开配置 ").color(egui::Color32::from_rgb(255, 165, 0))).frame(false)).clicked() {
                                    self.core.open_config_file();
                                    self.show_menu = false;
                                }
                                ui.add_space(2.0);
                                ui.separator();
                                ui.add_space(2.0);
                                if ui.add(egui::Button::new(egui::RichText::new(" ❌ 退出程序 ").color(egui::Color32::from_rgb(255, 165, 0))).frame(false)).clicked() {
                                    ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                                }
                            });
                        });
                }

                // 3. 展开详情区域
                if self.is_expanded {
                    if !self.show_menu {
                        ui.separator();
                    } else {
                         ui.add_space(4.0); // 如果有菜单，增加一点间距
                    }
                    
                    // 显示资金概览
                    ui.horizontal(|ui| {
                        ui.label(egui::RichText::new(format!("总资: {:.0}", state.total_assets())).size(11.0).color(egui::Color32::GRAY));
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            ui.label(egui::RichText::new(format!("当日: {:+.0}", state.total_day_profit())).size(11.0).color(egui::Color32::GRAY));
                        });
                    });
                    
                    ui.add_space(2.0);

                    // 股票列表
                    egui::ScrollArea::vertical().show(ui, |ui| {
                        for stock in &state.stocks {
                            ui.horizontal(|ui| {
                                ui.label(
                                    egui::RichText::new(stock.display_name())
                                        .size(12.0)
                                        .color(egui::Color32::WHITE)
                                );
                                
                                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                    let total_profit = stock.total_profit();
                                    let day_profit = stock.day_profit();
                                    
                                    let get_color = |profit: f64| {
                                        if profit >= 0.0 {
                                            egui::Color32::from_rgb(255, 100, 100)
                                        } else {
                                            egui::Color32::from_rgb(100, 255, 100)
                                        }
                                    };

                                    // 1. 总盈亏 (最右侧)
                                    ui.label(
                                        egui::RichText::new(format!("{:+.0}", total_profit))
                                            .size(12.0)
                                            .color(get_color(total_profit))
                                    );
                                    
                                    // 2. 当日盈亏
                                    ui.label(
                                        egui::RichText::new(format!("{:+.0}", day_profit))
                                            .size(12.0)
                                            .color(get_color(day_profit))
                                    );
                                    
                                    ui.add_space(2.0);

                                    // 3. 现价
                                    if let Some(market) = &stock.market {
                                        ui.label(
                                            egui::RichText::new(format!("{:.2}", market.current_price))
                                                .size(12.0)
                                                .color(egui::Color32::LIGHT_GRAY)
                                        );
                                    } else {
                                        ui.label("--");
                                    }
                                });
                            });
                        }
                    });
                }
            });
            
        // 全窗口拖拽逻辑
        // 检测鼠标按下，且没有与 egui 的其他控件交互（interact 可能会捕获，所以这里要小心）
        // 实际上，如果 interact(..., Sense::click()) 被使用了，它会捕获点击。
        // 但 eframe 的拖拽通常需要 PointerButton::Primary。
        // 我们可以只在非 Button 区域允许拖拽。
        // 简单方案：如果鼠标在窗口内，且按住左键，发送 StartDrag。
        // 但这会影响按钮点击吗？Button 响应点击是在 Release 时，或者 click 逻辑。
        // StartDrag 会导致系统接管鼠标，可能导致 egui 失去 focus。
        // 最好是：如果 egui 没有消耗 pointer input，才拖拽。
        if ctx.input(|i| i.pointer.press_origin().is_some() && i.pointer.button_down(egui::PointerButton::Primary)) {
             // 检查鼠标下是否有 Widget
             if !ctx.is_using_pointer() {
                 ctx.send_viewport_cmd(egui::ViewportCommand::StartDrag);
             }
        }
    }
}

impl eframe::App for MyApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // 0. 检查全局热键
        if let Ok(event) = GlobalHotKeyEvent::receiver().try_recv() {
            if event.id == self.toggle_hotkey.id() && event.state == global_hotkey::HotKeyState::Released {
                self.show_profit = !self.show_profit;
                ctx.request_repaint();
            }
        }

        // 1. 执行业务逻辑
        if self.core.tick() {
            ctx.request_repaint();
        }

        // 2. 渲染 UI
        self.render_ui(ctx);

        // 3. 智能休眠
        let time_since_last = self.core.last_update().elapsed();
        let interval = self.core.update_interval();
        
        if time_since_last < interval {
            ctx.request_repaint_after(interval - time_since_last);
        } else {
            ctx.request_repaint();
        }
    }

    fn clear_color(&self, _visuals: &egui::Visuals) -> [f32; 4] {
        egui::Rgba::TRANSPARENT.to_array()
    }
}
