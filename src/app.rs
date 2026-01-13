use crate::core::{AppCore, AppState};
use crate::model::StockStatus;
use crate::theme::Theme;
use eframe::egui;
use chrono::{Local, Datelike};
use global_hotkey::{GlobalHotKeyManager, hotkey::{HotKey, Modifiers, Code}, GlobalHotKeyEvent};

// --- Constants ---
mod consts {
    pub const WINDOW_WIDTH_COLLAPSED: f32 = 240.0;
    pub const WINDOW_WIDTH_EXPANDED: f32 = 260.0;
    pub const BASE_HEIGHT: f32 = 28.0;
    pub const ITEM_HEIGHT: f32 = 24.0;
    pub const MENU_HEIGHT: f32 = 120.0;
}

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
            is_expanded: true,
            last_window_size: None,
            show_profit: false,
            show_menu: false,
            hotkey_manager: manager,
            toggle_hotkey,
        }
    }

    /// 计算窗口目标尺寸
    fn calculate_window_size(&self, stock_count: usize) -> egui::Vec2 {
        let list_height = if self.is_expanded {
            consts::ITEM_HEIGHT + (stock_count as f32 * consts::ITEM_HEIGHT) + 10.0
        } else {
            0.0
        };

        let mut content_height = consts::BASE_HEIGHT;
        
        if self.show_menu {
            content_height += consts::MENU_HEIGHT;
        }

        if self.is_expanded {
            content_height += list_height;
        }
        
        let width = if self.is_expanded { consts::WINDOW_WIDTH_EXPANDED } else { consts::WINDOW_WIDTH_COLLAPSED };
        egui::vec2(width, content_height)
    }

    /// 处理窗口拖拽
    fn handle_window_drag(&self, ctx: &egui::Context) {
        // 仅当鼠标按下且未与 UI 控件交互时触发拖拽
        if ctx.input(|i| i.pointer.press_origin().is_some() && i.pointer.button_down(egui::PointerButton::Primary)) {
             if !ctx.is_using_pointer() {
                 ctx.send_viewport_cmd(egui::ViewportCommand::StartDrag);
             }
        }
    }

    /// 渲染顶部栏 (时间/盈亏 + 操作按钮)
    fn render_top_bar(&mut self, ui: &mut egui::Ui, state: &AppState) {
        let theme = state.current_theme();

        ui.horizontal(|ui| {
            // 展开/收起按钮
            let icon = if self.is_expanded { "▼" } else { "▶" };
            if ui.add(egui::Button::new(egui::RichText::new(icon).color(Theme::parse_color(&theme.accent))).frame(false).small()).clicked() {
                self.is_expanded = !self.is_expanded;
            }

            // 右侧区域
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.add_space(4.0);

                // 刷新按钮 (⟳)
                if ui.add(egui::Button::new(egui::RichText::new("⟳").color(Theme::parse_color(&theme.accent))).frame(false).small()).clicked() {
                    self.core.force_refresh();
                }

                // 切换按钮 (↔)
                if ui.add(egui::Button::new(egui::RichText::new("↔").color(Theme::parse_color(&theme.accent))).frame(false).small()).clicked() {
                    self.show_profit = !self.show_profit;
                }

                // 中间信息区域
                ui.centered_and_justified(|ui| {
                    self.render_center_info(ui, state);
                });
            });
        });
    }

    /// 渲染中间信息 (时间 或 盈亏概览)
    fn render_center_info(&mut self, ui: &mut egui::Ui, state: &AppState) {
        if self.show_profit {
            self.render_profit_info(ui, state);
        } else {
            self.render_time_info(ui, state);
        }
    }

    /// 渲染盈亏概览
    fn render_profit_info(&mut self, ui: &mut egui::Ui, state: &AppState) {
        let theme = state.current_theme();
        let total_profit = state.total_profit();
        let day_profit = state.total_day_profit();
        
        let mut job = egui::text::LayoutJob::default();
        
        // 总盈亏
        job.append(
            &format!("{:+.0}", total_profit),
            0.0,
            egui::TextFormat {
                color: theme.get_profit_color(total_profit),
                font_id: egui::FontId::proportional(13.0),
                ..Default::default()
            },
        );
        
        // 分隔符
        job.append(
            "|",
            0.0,
            egui::TextFormat {
                color: Theme::parse_color(&theme.text_gray),
                font_id: egui::FontId::proportional(13.0),
                ..Default::default()
            },
        );
        
        // 今日盈亏
        job.append(
            &format!("{:+.0}", day_profit),
            0.0,
            egui::TextFormat {
                color: theme.get_profit_color(day_profit),
                font_id: egui::FontId::proportional(13.0),
                ..Default::default()
            },
        );
        
        self.render_draggable_text(ui, job);
    }

    /// 渲染系统时间
    fn render_time_info(&mut self, ui: &mut egui::Ui, state: &AppState) {
        let theme = state.current_theme();
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
        
        self.render_draggable_text(ui, 
            egui::RichText::new(time_str)
                .size(13.0)
                .color(Theme::parse_color(&theme.text_normal))
                .strong()
        );
    }

    /// 渲染可拖拽的文本组件 (禁用选择，启用拖拽，支持右键菜单)
    fn render_draggable_text(&mut self, ui: &mut egui::Ui, text: impl Into<egui::WidgetText>) {
        // 显式禁用 selectable，防止双击或拖拽时出现文本选中高亮
        // 使用 click_and_drag 以同时支持拖拽和点击检测
        let response = ui.add(egui::Label::new(text).selectable(false).sense(egui::Sense::click_and_drag()));
        
        if response.hovered() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::Grab);
        }
        
        // 处理拖拽
        if response.drag_started() {
            ui.ctx().send_viewport_cmd(egui::ViewportCommand::StartDrag);
        }
        
        // 处理右键点击 -> 切换菜单
        if response.clicked_by(egui::PointerButton::Secondary) {
            self.show_menu = !self.show_menu;
        }
    }

    /// 渲染菜单
    fn render_menu(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        if !self.show_menu { return; }

        let state = self.core.get_state();
        let theme = state.current_theme();

        ui.separator();
        
        egui::Frame::none()
            .fill(Theme::parse_color(&theme.menu_bg))
            .rounding(theme.rounding)
            .inner_margin(4.0)
            .show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.vertical_centered(|ui| {
                    if ui.add(egui::Button::new(egui::RichText::new(" 🛠 打开配置 ").color(Theme::parse_color(&theme.accent))).frame(false)).clicked() {
                        self.core.open_config_file();
                        self.show_menu = false;
                    }
                    ui.add_space(2.0);
                    if ui.add(egui::Button::new(egui::RichText::new(" 📂 打开目录 ").color(Theme::parse_color(&theme.accent))).frame(false)).clicked() {
                        self.core.open_config_dir();
                        self.show_menu = false;
                    }
                    ui.add_space(2.0);
                    ui.separator();
                    ui.add_space(2.0);
                    if ui.add(egui::Button::new(egui::RichText::new(" ❌ 退出程序 ").color(Theme::parse_color(&theme.accent))).frame(false)).clicked() {
                        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                    }
                });
            });
    }

    /// 渲染展开的内容 (指数 + 股票列表)
    fn render_expanded_content(&mut self, ui: &mut egui::Ui, state: &AppState) {
        if !self.is_expanded { return; }

        let theme = state.current_theme();

        if !self.show_menu {
            ui.separator();
        } else {
             ui.add_space(4.0);
        }
        
        // 1. 指数与资金概览
        ui.horizontal(|ui| {
            // 上证指数
            if let Some(sh_index) = &state.sh_index {
                let change_percent = (sh_index.current_price - sh_index.prev_close) / sh_index.prev_close * 100.0;
                self.render_draggable_text(ui, 
                    egui::RichText::new(format!("上证: {:.2} {:+.2}%", sh_index.current_price, change_percent))
                        .size(11.0)
                        .color(theme.get_profit_color(change_percent))
                );
            } else {
                self.render_draggable_text(ui, egui::RichText::new("上证: --").size(11.0).color(Theme::parse_color(&theme.text_gray)));
            }

            // 当日盈亏 (右对齐)
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                self.render_draggable_text(ui, 
                    egui::RichText::new(format!("当日: {:+.0}", state.total_day_profit()))
                        .size(11.0)
                        .color(Theme::parse_color(&theme.text_gray))
                );
            });
        });
        
        ui.add_space(2.0);

        // 2. 股票列表
        egui::ScrollArea::vertical().show(ui, |ui| {
            egui::Grid::new("stock_list_grid")
                .num_columns(5)
                .spacing([10.0, 6.0]) // 列间距 10, 行间距 6
                .min_col_width(0.0)
                .show(ui, |ui| {
                    for stock in &state.stocks {
                        self.render_stock_grid_row(ui, stock);
                    }
                });
        });
    }

    /// 渲染单行股票信息 (Grid Row)
    fn render_stock_grid_row(&mut self, ui: &mut egui::Ui, stock: &StockStatus) {
        let state = self.core.get_state();
        let theme = state.current_theme();

        // 1. 名称
        self.render_draggable_text(ui, 
            egui::RichText::new(stock.display_name())
                .size(12.0)
                .color(Theme::parse_color(&theme.text_white))
        );

        // 2. 持仓
        let shares = stock.total_shares();
        let shares_text = if shares > 0 {
             egui::RichText::new(format!("{}", shares))
                .size(12.0)
                .color(Theme::parse_color(&theme.text_normal))
        } else {
             egui::RichText::new("--").size(12.0).color(Theme::parse_color(&theme.text_gray))
        };
        self.render_draggable_text(ui, shares_text);

        // 3. 现价
        let price_text = if let Some(market) = &stock.market {
            egui::RichText::new(format!("{:.2}", market.current_price))
                .size(12.0)
                .color(Theme::parse_color(&theme.text_normal))
        } else {
            egui::RichText::new("--").size(12.0).color(Theme::parse_color(&theme.text_normal))
        };
        self.render_draggable_text(ui, price_text);

        // 4. 当日盈亏
        let day_profit = stock.day_profit();
        let day_text = if stock.total_shares() > 0 {
             egui::RichText::new(format!("{:+.0}", day_profit))
                .size(12.0)
                .color(theme.get_profit_color(day_profit))
        } else {
             egui::RichText::new("--").size(12.0).color(Theme::parse_color(&theme.text_gray))
        };
        self.render_draggable_text(ui, day_text);

        // 5. 总盈亏
        let total_profit = stock.total_profit();
        let total_text = if stock.total_shares() > 0 {
             egui::RichText::new(format!("{:+.0}", total_profit))
                .size(12.0)
                .color(theme.get_profit_color(total_profit))
        } else {
             egui::RichText::new("--").size(12.0).color(Theme::parse_color(&theme.text_gray))
        };
        self.render_draggable_text(ui, total_text);

        ui.end_row();
    }

    /// 主渲染逻辑
    fn render_ui(&mut self, ctx: &egui::Context) {
        let state = self.core.get_state();
        let theme = state.current_theme();
        
        // 1. 调整窗口尺寸
        let new_size = self.calculate_window_size(state.stocks.len());
        if self.last_window_size != Some(new_size) {
            ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(new_size));
            self.last_window_size = Some(new_size);
        }

        // 2. 绘制面板
        egui::CentralPanel::default()
            .frame(theme.panel_frame())
            .show(ctx, |ui| {
                // 根据背景色亮度自动调整全局 Visuals (Dark/Light)
                // 简单的亮度计算：(0.299*R + 0.587*G + 0.114*B)
                let bg_color = Theme::parse_color(&theme.background);
                let luminance = 0.299 * bg_color.r() as f32 + 0.587 * bg_color.g() as f32 + 0.114 * bg_color.b() as f32;
                if luminance > 128.0 {
                     ui.ctx().set_visuals(egui::Visuals::light());
                } else {
                     ui.ctx().set_visuals(egui::Visuals::dark());
                }
                
                // 全局交互检测
                let response = ui.interact(ui.max_rect(), ui.id().with("bg"), egui::Sense::click());
                
                if response.hovered() {
                    ui.ctx().set_cursor_icon(egui::CursorIcon::Grab);
                }
                if response.clicked_by(egui::PointerButton::Secondary) {
                    self.show_menu = !self.show_menu;
                }

                // 3. 渲染各个部分
                self.render_top_bar(ui, &state);
                self.render_menu(ui, ctx);
                self.render_expanded_content(ui, &state);
            });
            
        // 3. 处理全局拖拽
        self.handle_window_drag(ctx);
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
