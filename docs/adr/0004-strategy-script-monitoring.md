# 0004 策略脚本监控与事件提示

## 状态

草案。

## 背景

FinBox 当前已经具备自选股、行情刷新、分时/K线读取、持仓记录、个股笔记和 AI 分析入口。用户希望新增脚本能力，但当前最迫切目标不是接入 AI，也不是自动下单，而是利用本地 TS/JS 策略脚本持续监控股票数据变化，并在出现放量上涨、买入契机、卖出契机、是否适合做 T 等情况时给出提示。

该能力应优先服务交易纪律与盘中观察，降低情绪化决策，而不是替代交易执行。

## 决策

第一阶段实现“只读策略监控 + 单股脚本页面 + 事件提示”的脚本系统。

策略脚本运行在主进程托管的受控运行时中。脚本只能读取 FinBox 提供的结构化上下文，不能访问通用文件系统、通用网络、Electron 内部对象、shell、券商交易接口或自动下单能力。

脚本输出必须是结构化 `StrategySignal`，界面先在独立策略页面展示为提示记录。自然语言解释可以由脚本提供，也可以后续由 AI 作为数据流的一环补充，但 AI 不参与第一阶段核心判断链路。

第一版采用以下产品约束：

- 单独新增一个策略监控页面；
- 每次策略运行只面向单只股票；
- 用户可以自行新增、编辑、删除脚本；
- 每个脚本可以有用户可编辑参数；
- 提示先永久保留；
- 每条提示必须标注触发时间；
- 第一版不做多股批量扫描；
- 第一版不做系统通知和浮窗通知。

## 第一阶段提示类型

第一阶段脚本关注以下提示类型：

- 放量上涨；
- 放量下跌；
- 买入观察；
- 买入触发；
- 卖出观察；
- 卖出触发；
- 做 T 观察；
- 做 T 触发；
- 风险破位；
- 趋势修复；
- 主升确认候选。

## 第一阶段范围

- 支持新增、编辑、删除、启用、禁用策略脚本。
- 支持 JS 脚本直接执行。
- 支持 TS 脚本通过内置轻量转译后执行。
- 支持手动运行脚本。
- 支持行情刷新事件触发脚本。
- 支持每个脚本配置单只适用股票、冷却时间、提示级别和脚本参数。
- 支持脚本运行日志、错误日志、最近一次信号结果。
- 支持策略提示在独立策略监控页面展示。
- 支持每条提示展示触发时间、股票代码、脚本名称、信号类型、动作、原因和关键价位。

## 开发 TODO

- [x] 定义策略脚本共享类型：`StrategyScript`、`StrategyScriptParam`、`StrategyTrigger`、`StrategyContext`、`StrategySignal`、`StrategyRunLog`。
- [x] 实现主进程策略脚本存储：在 Electron `userData/strategy-monitoring/scripts.json` 下保存用户脚本、参数和启用状态。
- [x] 实现主进程策略提示存储：在 Electron `userData/strategy-monitoring/signals.json` 下永久保存提示记录。
- [x] 实现策略运行时：支持 JS 直接运行，支持 TS 轻量转译后运行，并限制脚本只能通过只读 `ctx` 返回结构化结果。
- [x] 实现脚本 CRUD IPC：列表、新增、更新、删除、启用/禁用。
- [x] 实现脚本运行 IPC：对单只股票手动运行指定脚本，并返回策略信号。
- [x] 实现提示记录 IPC：读取提示列表，手动删除提示。
- [x] 在 preload 暴露策略脚本 API，保持 renderer 无 Node 能力。
- [x] 新增独立策略监控页面：股票选择、脚本管理、参数编辑、手动运行、提示记录。
- [x] 接入行情刷新触发：启用脚本在冷却时间满足时自动运行。
- [x] 实现同一脚本、同一股票、同一信号在冷却时间内合并提示并累计触发次数。
- [x] 增加默认策略模板：放量上涨、风险破位、修复确认、做 T 观察。
- [x] 补充类型检查和构建验证。

## 暂不做

- 不自动下单。
- 不接入券商交易接口。
- 不允许脚本读取任意本地文件。
- 不允许脚本发起任意网络请求。
- 不把 AI 作为策略判断的必需组件。
- 不在第一阶段实现复杂回测。
- 不在第一阶段实现多账户真实交易联动。
- 不在第一阶段实现多股批量策略扫描。
- 不在第一阶段实现系统级通知。
- 不在第一阶段实现提示自动过期或自动删除。

## 领域模型

### StrategyScript

用户可编辑的策略脚本。包含脚本元数据、脚本文本、启用状态、适用范围和触发配置。

第一版脚本适用范围限定为单只股票。后续再扩展到标签、自选组或全市场扫描。

### StrategyScriptParam

策略脚本参数。用于把突破位、风险线、放量倍数、冷却时间、建议股数等可调整数值从脚本正文中分离出来。

参数由用户在界面中增删改，脚本通过 `ctx.params` 读取。

### StrategyTrigger

脚本运行原因。第一阶段至少包括：

- `manual`：用户手动运行；
- `market_refresh`：行情刷新后运行；
- `price_cross`：价格穿越阈值；
- `volume_spike`：成交量或成交额异常放大。

第一版可以先实现 `manual` 和 `market_refresh`。`price_cross` 与 `volume_spike` 可以作为第二步扩展，因为它们需要保存上一笔行情快照并判断穿越过程。

### StrategyContext

脚本运行时读取的只读上下文。包含当前股票行情、指数行情、持仓摘要、K线、分时、策略自身配置、脚本参数和触发原因。

### StrategySignal

脚本输出的结构化策略信号。包含信号类型、建议动作、置信度、原因、关键价位、风险线、建议观察时间和提示级别。

每条信号必须写入触发时间。触发时间使用脚本运行完成时的本地时间戳，并在界面展示为可读时间。

### StrategyRunLog

脚本运行记录。包含脚本 ID、股票代码、触发原因、开始时间、结束时间、状态、输出信号和错误信息。

第一版提示永久存在。删除提示必须由用户手动发起；系统不做自动过期清理。

## 建议的标准输出

```ts
export type StrategySignal = {
  id?: string;
  code: string;
  scriptId: string;
  generatedAt: number;
  signal:
    | "volume_up"
    | "volume_down"
    | "buy_watch"
    | "buy_trigger"
    | "sell_watch"
    | "sell_trigger"
    | "t_watch"
    | "t_trigger"
    | "risk_break"
    | "repairing"
    | "main_wave_candidate"
    | "none";
  action: "watch" | "small_buy" | "buy" | "hold" | "reduce" | "sell" | "ignore";
  confidence: number;
  severity: "info" | "notice" | "warning" | "critical";
  title: string;
  reasons: string[];
  levels?: {
    support?: number;
    resistance?: number;
    buyLow?: number;
    buyHigh?: number;
    breakout?: number;
    stopLoss?: number;
    takeProfit?: number;
    trailingActivation?: number;
    trailingDrawdownPercent?: number;
  };
  suggestedShares?: number;
  expiresAt?: number;
};
```

第一版中 `expiresAt` 可以保留为可选字段，但界面不按该字段自动删除提示。

## 脚本参数示例

```ts
export type StrategyScriptParam =
  | { key: string; label: string; type: "number"; value: number; min?: number; max?: number; step?: number }
  | { key: string; label: string; type: "string"; value: string }
  | { key: string; label: string; type: "boolean"; value: boolean };
```

示例参数：

```json
[
  { "key": "breakout", "label": "突破确认价", "type": "number", "value": 21.5, "step": 0.01 },
  { "key": "risk", "label": "风险线", "type": "number", "value": 20.3, "step": 0.01 },
  { "key": "volumeRatio", "label": "放量倍数", "type": "number", "value": 1.3, "step": 0.1 },
  { "key": "suggestedShares", "label": "建议股数", "type": "number", "value": 300, "step": 100 }
]
```

## 事件触发原则

行情刷新频率可以很高，但脚本不应每秒无约束运行。每个脚本和每只股票应具备独立冷却时间。

默认建议：

- `market_refresh` 冷却时间不低于 30 秒；
- 放量类脚本冷却时间不低于 60 秒；
- 卖出或破位类高优先级提示允许更短冷却，但不低于 10 秒；
- 同一脚本对同一股票生成相同信号时，应合并或更新，不重复刷屏。

第一版因提示永久存在，仍应保留冷却时间。默认处理方式是：同一脚本、同一股票、同一信号在冷却时间内只更新最近一条提示的更新时间和触发次数，不新增提示。

## 第一版页面

新增独立策略监控页面，建议包含四个区域：

1. 股票选择区：选择单只股票。
2. 脚本管理区：新增、编辑、删除、启用、禁用脚本。
3. 参数配置区：编辑当前脚本参数。
4. 提示记录区：永久展示策略信号，按触发时间倒序排列。

提示记录至少展示：

- 触发时间；
- 股票代码与名称；
- 脚本名称；
- 信号类型；
- 建议动作；
- 置信度；
- 提示级别；
- 触发原因；
- 关键价位；
- 触发次数。

第一版不要求把策略提示嵌入个股详情页。个股详情页集成可以后续再做。

## 安全边界

策略脚本是本地可编辑代码，因此默认视为高风险能力。第一阶段需要显式启用脚本功能，并在界面说明：

- 脚本只提供提示，不代表交易指令；
- 脚本不会自动下单；
- 脚本错误不会中断主行情刷新；
- 脚本运行结果必须可追溯；
- 任何未来交易接口接入都必须另行设计权限与确认机制。

## 后续扩展

- 策略模板库；
- 策略回测；
- 策略参数化 UI；
- AI 解释 `StrategySignal`；
- 策略信号复盘；
- 与交易逻辑库互相引用；
- 接入只读账户流水，用于更精确的做 T 和仓位提示。
