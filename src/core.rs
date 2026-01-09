use crate::config::ConfigManager;
use crate::model::{AppConfig, MarketData, StockStatus};
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
    pub last_update_time: Option<String>,
}

impl AppState {
    pub fn new(config: AppConfig) -> Self {
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
            last_update_time: None,
        }
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
        let config = config_manager.load_or_default();
        
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
                    Duration::from_secs(60)
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

    /// 核心刷新逻辑
    fn refresh_logic(
        client: &reqwest::blocking::Client,
        config_manager: &mut ConfigManager,
        state: &Arc<Mutex<AppState>>,
        force: bool,
    ) {
        let now = Local::now().format("%H:%M:%S");

        // 1. 检查配置更新
        let new_config_opt = if force {
            config_manager.force_reload()
        } else {
            config_manager.reload_if_changed()
        };

        if let Some(new_config) = new_config_opt {
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
        let codes: Vec<String> = {
            let lock = state.lock().unwrap();
            lock.config.stocks.iter().map(|s| s.code.clone()).collect()
        };

        // 3. 抓取数据
        if !codes.is_empty() {
            println!("[{}] Fetching data for {} stocks: {:?}", now, codes.len(), codes);
            let market_data_map = fetch_multiple_stocks(client, &codes);

            if let Ok(mut lock) = state.lock() {
                for stock in lock.stocks.iter_mut() {
                    if let Some(data) = market_data_map.get(&stock.config.code) {
                        stock.market = Some(data.clone());
                    }
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
    
    let mut result = HashMap::new();

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

    // 解析每一行
    for line in body.lines() {
        if let Some(eq_idx) = line.find('=') {
            let var_part = &line[..eq_idx]; // var hq_str_sz002594
            let val_part = &line[eq_idx+1..]; // "比亚迪,..."

            // 提取 code
            let code_start = if let Some(idx) = var_part.rfind('_') { idx + 1 } else { continue };
            let code = var_part[code_start..].trim();

            // 提取数据
            if let Some(start_quote) = val_part.find('"') {
                if let Some(end_quote) = val_part.rfind('"') {
                    if start_quote < end_quote {
                        let data_str = &val_part[start_quote+1..end_quote];
                        let parts: Vec<&str> = data_str.split(',').collect();
                        if parts.len() > 31 {
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
                            
                            result.insert(code.to_string(), market_data);
                        }
                    }
                }
            }
        }
    }

    result
}
