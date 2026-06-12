import { useEffect, useState } from "react";
import { accountTotalProfit, dayProfit, effectivePrice, marketValue } from "../../shared/finance";
import { profitColor } from "../../shared/theme";
import type { AppState, StockStatus, Theme } from "../../shared/types";
import { formatMaybe, formatSigned } from "../utils";

const api = window.finBox;

export function MarketStatusBar({ state, theme }: { state: AppState; theme: Theme }) {
  return (
    <footer className="status-bar">
      <MarketTile label="SH Index" value={formatMaybe(effectivePrice(state.sh_index), 2)} delta={marketPercent(state.sh_index)} theme={theme} />
      <MarketTile label="Day P/L" value={formatSigned(sumDayProfit(state.stocks), 0)} delta={sumDayProfit(state.stocks)} theme={theme} />
      <MarketTile label="Account P/L" value={formatOptionalSigned(accountTotalProfit(state.config, state.stocks), 0)} delta={accountTotalProfit(state.config, state.stocks)} theme={theme} />
      <MarketTile label="Market Value" value={formatMaybe(sumMarketValue(state.stocks), 0)} theme={theme} />
      <MarketTile label="Refresh" value="3-5s" theme={theme} />
      <AccountConfigPanel state={state} />
    </footer>
  );
}

function MarketTile({ label, value, delta, theme }: { label: string; value: string; delta?: number; theme: Theme }) {
  return (
    <div className="market-tile">
      <span>{label}</span>
      <span className="market-value" style={{ color: delta === undefined ? undefined : profitColor(theme, delta) }}>{value}</span>
    </div>
  );
}

function AccountConfigPanel({ state }: { state: AppState }) {
  const [investmentDraft, setInvestmentDraft] = useState(() => formatConfigDraft(state.config.total_investment));
  const [cashDraft, setCashDraft] = useState(() => formatConfigDraft(state.config.cash));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setInvestmentDraft(formatConfigDraft(state.config.total_investment));
    setCashDraft(formatConfigDraft(state.config.cash));
    setError("");
  }, [state.config.total_investment, state.config.cash]);

  const dirty = investmentDraft !== formatConfigDraft(state.config.total_investment) || cashDraft !== formatConfigDraft(state.config.cash);

  const reset = () => {
    setInvestmentDraft(formatConfigDraft(state.config.total_investment));
    setCashDraft(formatConfigDraft(state.config.cash));
    setError("");
  };

  const save = async () => {
    const totalInvestment = parseOptionalConfigNumber(investmentDraft);
    const cash = parseOptionalConfigNumber(cashDraft);
    if (totalInvestment === null || cash === null) {
      setError("Enter valid numbers.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await api.updateAccountConfig({ total_investment: totalInvestment, cash });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save account config.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="account-config-panel" aria-label="Account config">
      <label>
        <span>Total Investment</span>
        <input
          type="number"
          step="0.01"
          value={investmentDraft}
          onChange={(event) => setInvestmentDraft(event.target.value)}
        />
      </label>
      <label>
        <span>Cash</span>
        <input
          type="number"
          step="0.01"
          value={cashDraft}
          onChange={(event) => setCashDraft(event.target.value)}
        />
      </label>
      <button className="tool-button" onClick={reset} disabled={!dirty || saving}>Cancel</button>
      <button className="tool-button accent" onClick={() => void save()} disabled={!dirty || saving}>{saving ? "Saving..." : "Save"}</button>
      {error && <span className="save-error">{error}</span>}
    </div>
  );
}

function sumDayProfit(stocks: StockStatus[]) {
  return stocks.reduce((sum, stock) => sum + dayProfit(stock), 0);
}

function sumMarketValue(stocks: StockStatus[]) {
  let total = 0;
  for (const stock of stocks) {
    const value = marketValue(stock);
    if (value !== undefined) total += value;
  }
  return total;
}

function marketPercent(market: AppState["sh_index"]) {
  const price = effectivePrice(market);
  if (!market || price === undefined || market.prev_close <= 0) return undefined;
  return ((price - market.prev_close) / market.prev_close) * 100;
}

function formatOptionalSigned(value: number | undefined, digits: number, suffix = "") {
  return value === undefined ? "--" : `${formatSigned(value, digits)}${suffix}`;
}

function formatConfigDraft(value: number | undefined) {
  return value === undefined ? "" : String(value);
}

function parseOptionalConfigNumber(value: string): number | undefined | null {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numberValue = Number(trimmed);
  return Number.isFinite(numberValue) ? numberValue : null;
}
