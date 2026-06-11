import type { AppConfig, MarketData, StockStatus } from "./types";

export function effectivePrice(market?: MarketData): number | undefined {
  if (!market) return undefined;
  return market.current_price > 0 ? market.current_price : market.prev_close;
}

export function totalShares(stock: StockStatus): number {
  return stock.config.positions.reduce((sum, position) => sum + position.shares, 0);
}

export function totalCost(stock: StockStatus): number {
  return stock.config.positions.reduce((sum, position) => sum + position.shares * position.cost, 0);
}

export function marketValue(stock: StockStatus): number | undefined {
  const price = effectivePrice(stock.market);
  return price === undefined ? undefined : totalShares(stock) * price;
}

export function totalProfit(stock: StockStatus): number | undefined {
  if (stock.config.positions.length === 0) return undefined;
  const shares = totalShares(stock);
  if (shares === 0) return -totalCost(stock);
  const value = marketValue(stock);
  return value === undefined ? undefined : value - totalCost(stock);
}

export function totalProfitPoints(stock: StockStatus): number | undefined {
  const shares = totalShares(stock);
  if (shares === 0) return undefined;
  const averageCost = totalCost(stock) / shares;
  const price = effectivePrice(stock.market);
  if (!averageCost || price === undefined) return undefined;
  return ((price - averageCost) / averageCost) * 100;
}

// Intraday profit/loss.
export function dayProfit(stock: StockStatus): number {
  const price = effectivePrice(stock.market);
  if (!stock.market || price === undefined || stock.market.prev_close <= 0) return 0;
  return (price - stock.market.prev_close) * totalShares(stock);
}

// Account-level profit/loss.
export function accountTotalProfit(config: AppConfig, stocks: StockStatus[]): number | undefined {
  if (config.total_investment === undefined) return undefined;
  let stockValue = 0;
  for (const stock of stocks) {
    if (totalShares(stock) === 0) continue;
    const value = marketValue(stock);
    if (value === undefined) return undefined;
    stockValue += value;
  }
  return stockValue + (config.cash ?? 0) - config.total_investment;
}

export function displayName(stock: StockStatus): string {
  return stock.config.alias || stock.market?.name || stock.config.code;
}
