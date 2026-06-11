import { ArrowDown, ArrowUp } from "lucide-react";
import { dayProfit, effectivePrice, totalShares } from "../../shared/finance";
import { currentTheme, profitColor } from "../../shared/theme";
import type { AppState, StockStatus } from "../../shared/types";
import { formatSigned } from "../utils";

type TickerSummaryProps = {
  state: AppState;
  stock: StockStatus;
  compactRefreshBars?: boolean;
};

export function TickerSummary({ state, stock, compactRefreshBars = false }: TickerSummaryProps) {
  const theme = currentTheme(state.config);
  const floatDirectionColor = (value: number) => (value >= 0 ? "#60a5fa" : "#fbbf24");
  const price = effectivePrice(stock.market);
  const priceChangePercent =
    stock.market && stock.market.prev_close > 0 && price !== undefined
      ? ((price - stock.market.prev_close) / stock.market.prev_close) * 100
      : 0;
  const totalDay = state.stocks
    .filter((item) => totalShares(item) !== 0)
    .reduce((sum, item) => sum + dayProfit(item), 0);

  const nextRefresh = state.next_market_refresh ?? (state.last_market_update ? state.last_market_update + 15000 : undefined);
  const refreshDuration = Math.max(1000, nextRefresh && state.last_market_update ? nextRefresh - state.last_market_update : 15000);
  const remaining = nextRefresh ? Math.max(0, nextRefresh - Date.now()) : 0;
  const seconds = nextRefresh ? Math.max(0, Math.ceil(remaining / 1000)) : 0;
  const refreshLevel = nextRefresh ? Math.max(0, Math.min(4, Math.ceil((remaining / refreshDuration) * 4))) : 0;

  if (compactRefreshBars) {
    return (
      <span className="float-widget">
        <span className="float-widget-head">
          <RefreshBars level={refreshLevel} />
          <span>System Monitor</span>
        </span>
        <span className="float-widget-metrics">
          <span className="float-widget-metric">
            <span>MEM</span>
            <span>{price === undefined ? "--" : `${price.toFixed(2)} GB`}</span>
          </span>
          <span className="float-widget-metric">
            <span>NET</span>
            <SignedIconMetric value={priceChangePercent} digits={2} suffix=" Mb/s" color={floatDirectionColor(priceChangePercent)} />
          </span>
        </span>
        <span className="float-widget-profit">
          I/O <SignedIconMetric value={totalDay} digits={0} suffix=" KB/s" color={floatDirectionColor(totalDay)} />
        </span>
      </span>
    );
  }

  return (
    <>
      <span>{price === undefined ? "--" : price.toFixed(2)}</span>
      <span style={{ color: profitColor(theme, priceChangePercent) }}> {formatMoodValue(priceChangePercent, 2, false)}</span>
      <span className="muted"> {seconds}</span>
      <span style={{ color: profitColor(theme, totalDay) }}> {formatMoodValue(totalDay, 0, false)}</span>
    </>
  );
}

function formatMoodValue(value: number, digits: number, mood: boolean): string {
  if (!mood) return formatSigned(value, digits);
  return formatSigned(value, digits);
}

function SignedIconMetric({ value, digits, suffix, color }: { value: number; digits: number; suffix: string; color: string }) {
  const Icon = value >= 0 ? ArrowUp : ArrowDown;
  return (
    <span className="float-signed" style={{ color }}>
      <Icon size={10} aria-hidden="true" />
      <span>{Math.abs(value).toFixed(digits)}{suffix}</span>
    </span>
  );
}

function RefreshBars({ level }: { level: number }) {
  return (
    <span className="refresh-bars" aria-label={`Refresh countdown ${level}`}>
      {[0, 1, 2, 3].map((item) => (
        <span className={item < level ? "active" : ""} key={item} />
      ))}
    </span>
  );
}
