use crate::config::ConfigManager;
use crate::model::{AppConfig, MarketData, StockStatus};
use crate::theme::Theme;
use chrono::{Datelike, Local, Timelike, Weekday};
use std::collections::HashMap;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

/// 负责核心业务状态的管理
pub struct AppCore {
    /// 共享的状态数据 (Thread-safe)
    state: Arc<Mutex<AppState>>,
    last_ui_update: Instant,
    update_interval: Duration,
    /// 发送指令到后台线程
    command_tx: mpsc::Sender<CoreCommand>,
}

pub enum CoreCommand {
    ForceRefresh,
}

#[derive(Debug)]
pub struct AppState {
    pub config: AppConfig,
    pub stocks: Vec<StockStatus>,
    pub sh_index: Option<MarketData>,
    pub last_update_time: Option<String>,
}

impl AppState {
    pub fn new(mut config: AppConfig) -> Self {
        // 确保包含默认主题 (内存兜底)
        if !config.themes.contains_key("default") {
            config.themes.insert("default".to_string(), Theme::default());
        }

        let stocks = config
            .stocks
            .iter()
            .map(|s| StockStatus {
                config: s.clone(),
                market: None,
            })
            .collect();
        Self {
            config,
            stocks,
            sh_index: None,
            last_update_time: None,
        }
    }

    /// 获取当前主题
    pub fn current_theme(&self) -> &Theme {
        self.config
            .themes
            .get(&self.config.current_theme)
            .or_else(|| self.config.themes.get("default"))
            .unwrap_or_else(|| self.config.themes.values().next().expect("No themes available"))
    }

    
    // ... (rest of methods)
    /// 计算总投入资金
    pub fn total_investment(&self) -> f64 {
        self.config.total_investment.unwrap_or(0.0)
    }

    /// 计算当前总资产 (剩余现金 + 所有持仓市值)
    pub fn total_assets(&self) -> f64 {
        let cash = self.config.cash.unwrap_or(0.0);
        let market_value: f64 = self.stocks.iter().map(|s| s.market_value()).sum();
        cash + market_value
    }

    /// 计算总盈亏 (总资产 - 总投入)
    pub fn total_profit(&self) -> f64 {
        self.total_assets() - self.total_investment()
    }

    /// 计算当日总盈亏
    pub fn total_day_profit(&self) -> f64 {
        self.stocks.iter().map(|s| s.day_profit()).sum()
    }
}

impl AppCore {
    pub fn new() -> Self {
        // 1. 加载配置
        let mut config_manager = ConfigManager::new();
        let mut config = config_manager.load_or_default();
        
        // 检查并自动填充预设主题
        if Self::ensure_default_themes(&mut config) {
            if let Err(e) = config_manager.save(&config) {
                eprintln!("[Warning] Failed to save default themes to config: {}", e);
            } else {
                println!("[Init] Missing themes injected into config file.");
            }
        }
        
        println!("[Init] Config loaded from {:?}", config_manager.config_path());
        
        let state = Arc::new(Mutex::new(AppState::new(config.clone())));
        let state_clone = state.clone();

        let (tx, rx) = mpsc::channel();

        // 2. 启动后台线程抓取数据
        thread::spawn(move || {
            let client = reqwest::blocking::Client::new();
            
            // 首次运行，先执行一次
            Self::refresh_logic(&client, &mut config_manager, &state_clone, false);

            loop {
                // 根据是否休市调整请求间隔
                let interval = if is_trading_time() {
                    Duration::from_secs(5)
                } else {
                    Duration::from_secs(6000)
                };

                // 等待超时或接收到指令
                match rx.recv_timeout(interval) {
                    Ok(CoreCommand::ForceRefresh) => {
                        // 强制刷新
                        println!("[Command] Force refresh triggered");
                        Self::refresh_logic(&client, &mut config_manager, &state_clone, true);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        // 超时，执行常规刷新
                        Self::refresh_logic(&client, &mut config_manager, &state_clone, false);
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        println!("[Thread] Disconnected, exiting loop");
                        break;
                    }
                }
            }
        });

        Self {
            state,
            last_ui_update: Instant::now(),
            update_interval: Duration::from_secs(1),
            command_tx: tx,
        }
    }

    /// 确保配置中包含默认主题，如果添加了新主题返回 true
    fn ensure_default_themes(config: &mut AppConfig) -> bool {
        let mut changed = false;
        if !config.themes.contains_key("default") {
            config.themes.insert("default".to_string(), Theme::default());
            changed = true;
        }
        if !config.themes.contains_key("cyberpunk") {
            config.themes.insert("cyberpunk".to_string(), Theme::cyberpunk());
            changed = true;
        }
        if !config.themes.contains_key("light") {
            config.themes.insert("light".to_string(), Theme::light());
            changed = true;
        }
        if !config.themes.contains_key("sublime") {
            config.themes.insert("sublime".to_string(), Theme::sublime());
            changed = true;
        }
        changed
    }

    /// 核心刷新逻辑
    fn refresh_logic(
        client: &reqwest::blocking::Client,
        config_manager: &mut ConfigManager,
        state: &Arc<Mutex<AppState>>,
        force: bool,
    ) {
        const INDEX_CODE: &str = "sh000001";
        let now = Local::now().format("%H:%M:%S");

        // 1. 检查配置更新
        let new_config_opt = if force {
            config_manager.force_reload()
        } else {
            config_manager.reload_if_changed()
        };

        if let Some(new_config) = new_config_opt {
             if !new_config.themes.contains_key(&new_config.current_theme) {
                 println!("[Warning] Theme '{}' not found, falling back to default.", new_config.current_theme);
             }

             println!("[{}] Config reloaded", now);
             if let Ok(mut lock) = state.lock() {
                 let old_market_data: HashMap<String, MarketData> = lock.stocks.iter()
                    .filter_map(|s| s.market.clone().map(|m| (s.config.code.clone(), m)))
                    .collect();
                    
                 let new_stocks: Vec<StockStatus> = new_config.stocks.iter()
                    .map(|s| StockStatus {
                        config: s.clone(),
                        market: old_market_data.get(&s.code).cloned(),
                    })
                    .collect();
                    
                 lock.config = new_config;
                 lock.stocks = new_stocks;
             }
        }

        // 2. 获取需要更新的股票代码列表
        let mut codes: Vec<String> = {
            let lock = state.lock().unwrap();
            lock.config.stocks.iter().map(|s| s.code.clone()).collect()
        };
        // 添加上证指数代码
        codes.push(INDEX_CODE.to_string());

        // 3. 抓取数据
        if !codes.is_empty() {
            // println!("[{}] Fetching data for {} stocks: {:?}", now, codes.len(), codes);
            let market_data_map = fetch_multiple_stocks(client, &codes);

            if let Ok(mut lock) = state.lock() {
                for stock in lock.stocks.iter_mut() {
                    // 统一使用小写进行匹配
                    if let Some(data) = market_data_map.get(&stock.config.code.to_lowercase()) {
                        stock.market = Some(data.clone());
                    }
                }
                // 更新上证指数
                if let Some(data) = market_data_map.get(INDEX_CODE) {
                    lock.sh_index = Some(data.clone());
                }
                lock.last_update_time = Some(Local::now().format("%H:%M:%S").to_string());
            }
        } else {
            println!("[{}] No stocks configured", now);
        }
    }

    /// 触发强制刷新
    pub fn force_refresh(&self) {
        let _ = self.command_tx.send(CoreCommand::ForceRefresh);
    }
    
    /// 使用 VS Code 打开配置文件
    pub fn open_config_file(&self) {
        // 重新获取路径 (ConfigManager::new 开销很小)
        let config_manager = ConfigManager::new();
        let path = config_manager.config_path();
        
        println!("[UI] Opening config file: {:?}", path);
        // 尝试用 code 打开，如果失败则尝试用 notepad (记事本)
        if std::process::Command::new("code").arg(&path).spawn().is_err() {
            let _ = std::process::Command::new("notepad").arg(&path).spawn();
        }
    }

    /// 打开配置文件所在目录
    pub fn open_config_dir(&self) {
        let config_manager = ConfigManager::new();
        let path = config_manager.config_path();
        if let Some(parent) = path.parent() {
             println!("[UI] Opening config dir: {:?}", parent);
             // Windows 下使用 explorer 打开目录
             let _ = std::process::Command::new("explorer").arg(parent).spawn();
        }
    }

    pub fn tick(&mut self) -> bool {
        if self.last_ui_update.elapsed() >= self.update_interval {
            self.last_ui_update = Instant::now();
            true
        } else {
            false
        }
    }

    pub fn get_state(&self) -> AppState {
        let lock = self.state.lock().unwrap();
        AppState {
            config: lock.config.clone(),
            stocks: lock.stocks.clone(),
            sh_index: lock.sh_index.clone(),
            last_update_time: lock.last_update_time.clone(),
        }
    }

    pub fn last_update(&self) -> Instant {
        self.last_ui_update
    }

    pub fn update_interval(&self) -> Duration {
        self.update_interval
    }
}

/// 判断当前是否为 A 股交易时间
fn is_trading_time() -> bool {
    let now = Local::now();
    let weekday = now.weekday();

    // 周末休市
    if weekday == Weekday::Sat || weekday == Weekday::Sun {
        return false;
    }

    let hour = now.hour();
    let minute = now.minute();
    let time_val = hour * 100 + minute;

    // 上午：09:15 - 11:30
    let am_trading = time_val >= 915 && time_val <= 1130;
    // 下午：13:00 - 15:00
    let pm_trading = time_val >= 1300 && time_val <= 1500;

    am_trading || pm_trading
}

/// 批量获取股票数据
fn fetch_multiple_stocks(client: &reqwest::blocking::Client, codes: &[String]) -> HashMap<String, MarketData> {
    let list_param = codes.join(",");
    let url = format!("http://hq.sinajs.cn/list={}", list_param);
    
    let result = HashMap::new();

    let resp = match client
        .get(&url)
        .header("Referer", "https://finance.sina.com.cn/")
        .header("User-Agent", "Mozilla/5.0")
        .send() {
            Ok(r) => r,
            Err(e) => {
                println!("[Error] Request failed: {}", e);
                return result;
            }
        };

    let bytes = match resp.bytes() {
        Ok(b) => b,
        Err(e) => {
            println!("[Error] Failed to read bytes: {}", e);
            return result;
        }
    };
    
    let (cow, _, _) = encoding_rs::GBK.decode(&bytes);
    let body = cow.to_string();

    parse_sina_response(&body)
}

fn parse_sina_response(body: &str) -> HashMap<String, MarketData> {
    let mut result = HashMap::new();

    // 解析每一行
    for line in body.lines() {
        let eq_idx: usize = match line.find('=') {
            Some(idx) => idx,
            None => continue,
        };

        let var_part: &str = &line[..eq_idx]; // var hq_str_sz002594
        let val_part: &str = &line[eq_idx+1..]; // "比亚迪,..."

        // 提取 code
        let code_start: usize = match var_part.rfind('_') {
            Some(idx) => idx + 1,
            None => continue,
        };
        let code = var_part[code_start..].trim().to_lowercase();

        // 提取数据范围
        let start_quote = match val_part.find('"') {
            Some(idx) => idx,
            None => continue,
        };
        let end_quote = match val_part.rfind('"') {
            Some(idx) => idx,
            None => continue,
        };

        if start_quote >= end_quote {
            continue;
        }

        let data_str = &val_part[start_quote+1..end_quote];
        let parts: Vec<&str> = data_str.split(',').collect();

        // 数据字段校验
        if parts.len() <= 31 {
            continue;
        }

        let name = parts[0].to_string();
        let open = parts[1].parse().unwrap_or(0.0);
        let prev_close = parts[2].parse().unwrap_or(0.0);
        let current_price = parts[3].parse().unwrap_or(0.0);
        let high = parts[4].parse().unwrap_or(0.0);
        let low = parts[5].parse().unwrap_or(0.0);
        let date = parts[30];
        let time = parts[31];
        
        let market_data = MarketData {
            name,
            current_price,
            prev_close,
            open,
            high,
            low,
            time: format!("{} {}", date, time),
        };
        
        result.insert(code, market_data);
    }

    result
}
