import { useEffect, useState } from "react";
import { accountTotalProfit, dayProfit, effectivePrice, marketValue } from "../../shared/finance";
import { profitColor } from "../../shared/theme";
import type { AppState, StockStatus, Theme } from "../../shared/types";
import { formatMaybe, formatSigned } from "../utils";
import { useI18n } from "../i18n";

const api = window.finBox;

export function MarketStatusBar({ state, theme }: { state: AppState; theme: Theme }) {
  const { t } = useI18n();
  return (
    <footer className="status-bar">
      <MarketTile label={t("status.shIndex")} value={formatMaybe(effectivePrice(state.sh_index), 2)} delta={marketPercent(state.sh_index)} theme={theme} />
      <MarketTile label={t("detail.dayProfitLoss")} value={formatSigned(sumDayProfit(state.stocks), 0)} delta={sumDayProfit(state.stocks)} theme={theme} />
      <MarketTile label={t("status.accountProfitLoss")} value={formatOptionalSigned(accountTotalProfit(state.config, state.stocks), 0)} delta={accountTotalProfit(state.config, state.stocks)} theme={theme} />
      <MarketTile label={t("detail.marketValue")} value={formatMaybe(sumMarketValue(state.stocks), 0)} theme={theme} />
      <MarketTile label={t("status.refreshInterval")} value="3-5s" theme={theme} />
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
  const { t } = useI18n();
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
      setError(t("error.invalidNumbers"));
      return;
    }

    setSaving(true);
    setError("");
    try {
      await api.updateAccountConfig({ total_investment: totalInvestment, cash });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("error.saveAccountFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="account-config-panel" aria-label={t("status.accountConfig")}>
      <label>
        <span>{t("status.totalInvestment")}</span>
        <input
          type="number"
          step="0.01"
          value={investmentDraft}
          onChange={(event) => setInvestmentDraft(event.target.value)}
        />
      </label>
      <label>
        <span>{t("status.cash")}</span>
        <input
          type="number"
          step="0.01"
          value={cashDraft}
          onChange={(event) => setCashDraft(event.target.value)}
        />
      </label>
      <button className="tool-button" onClick={reset} disabled={!dirty || saving}>{t("common.cancel")}</button>
      <button className="tool-button accent" onClick={() => void save()} disabled={!dirty || saving}>{t(saving ? "common.saving" : "common.save")}</button>
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
