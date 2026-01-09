use serde::{Deserialize, Serialize};

// ----------------------------------------------------------------------------
// 配置模型 (Configuration Models)
// ----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    /// 总投入资金 (用于计算总盈亏比例)
    pub total_investment: Option<f64>,
    /// 剩余可用资金 (用于计算当前总资产)
    pub cash: Option<f64>,
    /// 自选股列表
    pub stocks: Vec<StockConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockConfig {
    /// 股票代码 (如 sz002594)
    pub code: String,
    /// 自定义显示名称 (可选，未设置则使用 API 返回名称)
    pub alias: Option<String>,
    /// 持仓记录 (支持多账户/多次买入)
    #[serde(default)]
    pub positions: Vec<Position>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    /// 账户/备注 (如 "招商证券", "支付宝")
    pub account: Option<String>,
    /// 持股数量
    pub shares: i64,
    /// 成本单价
    pub cost: f64,
}

// ----------------------------------------------------------------------------
// 运行时模型 (Runtime Models)
// ----------------------------------------------------------------------------

#[derive(Debug, Clone, Default)]
pub struct MarketData {
    pub name: String,
    pub current_price: f64,
    pub prev_close: f64, // 昨日收盘价，用于计算当日盈亏
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub time: String,
}

#[derive(Debug, Clone)]
pub struct StockStatus {
    pub config: StockConfig,
    pub market: Option<MarketData>,
}

impl StockStatus {
    /// 计算该股票的总持仓数
    pub fn total_shares(&self) -> i64 {
        self.config.positions.iter().map(|p| p.shares).sum()
    }

    /// 计算该股票的总持仓成本
    pub fn total_cost(&self) -> f64 {
        self.config.positions.iter().map(|p| p.shares as f64 * p.cost).sum()
    }

    /// 计算该股票的当前市值
    pub fn market_value(&self) -> f64 {
        if let Some(market) = &self.market {
            self.total_shares() as f64 * market.current_price
        } else {
            0.0
        }
    }

    /// 计算总盈亏 (市值 - 成本)
    pub fn total_profit(&self) -> f64 {
        self.market_value() - self.total_cost()
    }

    /// 计算当日盈亏 ( (现价 - 昨收) * 持仓数 )
    pub fn day_profit(&self) -> f64 {
        if let Some(market) = &self.market {
            (market.current_price - market.prev_close) * self.total_shares() as f64
        } else {
            0.0
        }
    }
    
    /// 获取显示名称
    pub fn display_name(&self) -> String {
        if let Some(alias) = &self.config.alias {
            alias.clone()
        } else if let Some(market) = &self.market {
            market.name.clone()
        } else {
            self.config.code.clone()
        }
    }
}
