import { BrowserWindow, shell } from "electron";
import { ConfigManager } from "./config";
import { fetchKLineData, fetchMultipleStocks, fetchStockComments as fetchThsStockComments, fetchStockNews as fetchSinaStockNews, fetchStockNewsArticle as fetchSinaStockNewsArticle, fetchTencentMinuteData, searchStocks } from "./sina";
import type { AppConfig, AppState, KLineScale, Position, StockConfig } from "../shared/types";

const INDEX_CODE = "sh000001";
const TRADING_REFRESH_MIN_MS = 3000;
const TRADING_REFRESH_JITTER_MS = 2000;
const OFF_HOURS_REFRESH_MS = 300000;

export class AppCore {
  private readonly configManager = new ConfigManager();
  private state: AppState;
  private timer?: NodeJS.Timeout;

  constructor(private readonly getWindows: () => BrowserWindow[]) {
    const config = this.configManager.loadOrDefault();
    this.state = createState(config);
  }

  start(): void {
    void this.refresh(false).finally(() => this.scheduleNextRefresh());
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  getState(): AppState {
    return structuredClone(this.state);
  }

  async forceRefresh(): Promise<void> {
    await this.refresh(true);
    this.scheduleNextRefresh();
  }

  openConfigFile(): void {
    void shell.openPath(this.configManager.path());
  }

  openConfigDir(): void {
    void shell.openPath(this.configManager.dir());
  }

  async searchStocks(query: string) {
    return searchStocks(query);
  }

  addStock(code: string, alias?: string): void {
    const config = this.configManager.loadOrDefault();
    if (config.stocks.some((stock) => stock.code.toLowerCase() === code.toLowerCase())) return;

    const stock: StockConfig = {
      code,
      alias,
      tags: ["watchlist"],
      positions: [{ account: "Default", shares: 0, cost: 0 } as Position]
    };
    config.stocks.push(stock);
    this.configManager.save(config);
    void this.forceRefresh();
  }

  updateStockAlias(code: string, alias?: string): void {
    const config = this.configManager.loadOrDefault();
    const stock = config.stocks.find((item) => item.code.toLowerCase() === code.toLowerCase());
    if (!stock) return;

    const normalizedAlias = alias?.trim();
    stock.alias = normalizedAlias || undefined;

    this.configManager.save(config);
    this.applyConfig(config);
  }

  updateStockTags(code: string, tags: string[]): void {
    const config = this.configManager.loadOrDefault();
    const stock = config.stocks.find((item) => item.code.toLowerCase() === code.toLowerCase());
    if (!stock) return;

    stock.tags = normalizeTags(tags);

    this.configManager.save(config);
    this.applyConfig(config);
  }

  updateStockPositions(code: string, positions: Position[]): void {
    const config = this.configManager.loadOrDefault();
    const stock = config.stocks.find((item) => item.code.toLowerCase() === code.toLowerCase());
    if (!stock) return;

    stock.positions = positions
      .map((position) => ({
        account: position.account?.trim() || undefined,
        shares: Number(position.shares) || 0,
        cost: Number(position.cost) || 0
      }))
      .filter((position) => position.account || position.shares !== 0 || position.cost !== 0);

    this.configManager.save(config);
    this.applyConfig(config);
    void this.forceRefresh();
  }

  fetchKLine(code: string, scale: KLineScale) {
    return fetchKLineData(code, scale);
  }

  fetchMinuteData(code: string) {
    return fetchTencentMinuteData(code);
  }

  fetchStockNews(code: string, page: number, keyword?: string) {
    return fetchSinaStockNews(code, page, keyword);
  }

  fetchStockNewsArticle(url: string) {
    return fetchSinaStockNewsArticle(url);
  }

  fetchStockComments(code: string, page: number) {
    return fetchThsStockComments(code, page);
  }

  private scheduleNextRefresh(): void {
    if (this.timer) clearTimeout(this.timer);
    const interval = dataRefreshIntervalMs();
    this.state.next_market_refresh = Date.now() + interval;
    this.broadcast();
    this.timer = setTimeout(() => {
      void this.refresh(false).finally(() => this.scheduleNextRefresh());
    }, interval);
  }

  private async refresh(force: boolean): Promise<void> {
    const config = force ? this.configManager.forceReload() : this.configManager.reloadIfChanged();
    if (config) this.applyConfig(config);

    const codes = [...this.state.config.stocks.map((stock) => stock.code), INDEX_CODE];
    try {
      const marketData = await fetchMultipleStocks(codes);
      this.state.stocks = this.state.stocks.map((stock) => ({
        ...stock,
        market: marketData.get(stock.config.code.toLowerCase()) ?? stock.market
      }));
      this.state.sh_index = marketData.get(INDEX_CODE) ?? this.state.sh_index;
      this.state.last_market_update = Date.now();
      this.broadcast();
    } catch (error) {
      console.error("[FinBox] Failed to refresh market data", error);
    }
  }

  private applyConfig(config: AppConfig): void {
    const oldMarket = new Map(this.state.stocks.map((stock) => [stock.config.code.toLowerCase(), stock.market]));
    this.state = {
      ...this.state,
      config,
      stocks: config.stocks.map((stock) => ({
        config: stock,
        market: oldMarket.get(stock.code.toLowerCase())
      }))
    };
    this.broadcast();
  }

  private broadcast(): void {
    const state = this.getState();
    for (const win of this.getWindows()) {
      if (!win.isDestroyed()) win.webContents.send("state", state);
    }
  }

}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function createState(config: AppConfig): AppState {
  return {
    config,
    stocks: config.stocks.map((stock) => ({ config: stock })),
    sh_index: undefined,
    last_market_update: undefined,
    next_market_refresh: undefined
  };
}

function dataRefreshIntervalMs(): number {
  if (!isTradingTime()) return OFF_HOURS_REFRESH_MS;
  return TRADING_REFRESH_MIN_MS + Math.floor(Math.random() * TRADING_REFRESH_JITTER_MS);
}

function isTradingTime(): boolean {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const value = now.getHours() * 100 + now.getMinutes();
  return (value >= 915 && value <= 1130) || (value >= 1300 && value <= 1500);
}
