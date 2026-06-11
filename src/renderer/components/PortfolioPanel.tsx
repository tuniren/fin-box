import {
  accountTotalProfit,
  dayProfit,
  displayName,
  effectivePrice,
  totalProfit,
  totalProfitPoints,
  totalShares
} from "../../shared/finance";
import { currentTheme, profitColor } from "../../shared/theme";
import type { AppState, StockStatus, Theme } from "../../shared/types";
import { formatMaybe, formatSigned, stockPercent } from "../utils";

type PortfolioPanelProps = {
  state: AppState;
  stocks: StockStatus[];
  onOpenKline: (stock: StockStatus) => void;
};

// Portfolio panel for the floating window.
export function PortfolioPanel({ state, stocks, onOpenKline }: PortfolioPanelProps) {
  const theme = currentTheme(state.config);
  const shPrice = effectivePrice(state.sh_index);
  const shPercent =
    state.sh_index && shPrice !== undefined && state.sh_index.prev_close > 0
      ? ((shPrice - state.sh_index.prev_close) / state.sh_index.prev_close) * 100
      : undefined;
  const totalDay = state.stocks.reduce((sum, stock) => sum + dayProfit(stock), 0);
  const accountProfit = accountTotalProfit(state.config, state.stocks);

  return (
    <section className="expanded-pane no-drag">
      <div className="market-row">
        <span style={{ color: shPercent === undefined ? "var(--muted)" : profitColor(theme, shPercent) }}>
          sh: {shPrice === undefined ? "--" : shPrice.toFixed(2)}{" "}
          {shPercent === undefined ? "" : `${formatSigned(shPercent, 2)}%`}
        </span>
        <span>
          <span style={{ color: profitColor(theme, totalDay) }}>{formatSigned(totalDay, 0)}</span>
          <span className="muted"> | </span>
          <span style={{ color: accountProfit === undefined ? "var(--muted)" : profitColor(theme, accountProfit) }}>
            {accountProfit === undefined ? "--" : formatSigned(accountProfit, 0)}
          </span>
        </span>
      </div>
      <StockList stocks={stocks} theme={theme} onOpenKline={onOpenKline} />
    </section>
  );
}

function StockList({ stocks, theme, onOpenKline }: { stocks: StockStatus[]; theme: Theme; onOpenKline: (stock: StockStatus) => void }) {
  return (
    <div className="stock-grid">
      {stocks.map((stock) => (
        // Keep the floating window light; open charts in a separate window.
        <button className="stock-row" key={stock.config.code} onClick={() => onOpenKline(stock)}>
          <span className="strong">{displayName(stock)}</span>
          <span className="stock-metric-stack">
            <span className="stock-position">{totalShares(stock) || "--"}</span>
            <span>{formatMaybe(effectivePrice(stock.market), 2)}</span>
          </span>
          <span className="stock-metric-stack">
            <SignedMetric value={stockPercent(stock)} digits={2} theme={theme} />
            <SignedMetric value={dayProfit(stock)} digits={0} theme={theme} />
          </span>
          <span className="stock-metric-stack">
            <SignedMetric value={totalProfitPoints(stock)} digits={2} theme={theme} />
            <SignedMetric value={totalProfit(stock)} digits={0} theme={theme} />
          </span>
        </button>
      ))}
    </div>
  );
}

// SignedMetric keeps empty values, signs, precision, and P/L coloring consistent.
function SignedMetric({ value, digits, theme }: { value: number | undefined; digits: number; theme: Pick<Theme, "color_up" | "color_down"> }) {
  if (value === undefined) return <span className="muted">--</span>;
  return <span style={{ color: profitColor(theme, value) }}>{formatSigned(value, digits)}</span>;
}
