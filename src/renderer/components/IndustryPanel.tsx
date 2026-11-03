import { useEffect, useId, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { selectedIndustry, chinaDate } from "../../shared/sector";
import { profitColor } from "../../shared/theme";
import type { AppState, IndustryPatch, SectorMinute, SectorQuote, StockStatus, Theme } from "../../shared/types";
import { useI18n } from "../i18n";
import { formatSigned } from "../utils";

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);
const api = window.finBox;

export function useSectorInterest(codes: string[], chartCodes: string[] = []): void {
  const key = useId();
  const signature = JSON.stringify([codes, chartCodes]);
  useEffect(() => {
    const [stocks, charts] = JSON.parse(signature) as [string[], string[]];
    const update = () => void api.setSectorInterest(key, document.hidden
      ? { codes: [], chart_codes: [] } : { codes: stocks, chart_codes: charts }).catch(console.error);
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      void api.setSectorInterest(key, { codes: [], chart_codes: [] }).catch(console.error);
    };
  }, [key, signature]);
}

export function SectorBadge({ state, stock, theme, mode = "main", colors }: {
  state: AppState; stock: StockStatus; theme: Theme; mode?: "main" | "float"; colors?: { up: string; down: string };
}) {
  const { t } = useI18n();
  const sector = selectedIndustry(stock.config);
  const enabled = mode === "float" ? stock.config.industry?.show_in_float : stock.config.industry?.show_near_price;
  useSectorInterest(enabled && sector ? [stock.config.code] : []);
  if (!enabled) return null;
  const quote = sector ? state.sector_quotes?.[sector.id] : undefined;
  const error = sector ? state.sector_errors?.[`q:${sector.id}`] : undefined;
  const stale = Boolean(quote && (!quote.time.startsWith(chinaDate().replaceAll("-", "")) || error));
  const title = [quote?.time ? `${t("sector.quoteTime")}: ${quote.time}` : "", error, stale ? t("sector.cached") : ""].filter(Boolean).join("\n");
  return <span className={`sector-badge ${mode} ${stale ? "stale" : ""}`} title={title}>
    <span style={{ color: quote ? (colors ? (quote.change_percent >= 0 ? colors.up : colors.down) : profitColor(theme, quote.change_percent)) : undefined }}>
      {quote ? formatSigned(quote.change_percent, 2) : "--"}
    </span>
  </span>;
}

export function IndustryPanel({ state, stock, theme }: { state: AppState; stock: StockStatus; theme: Theme }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chartOpen, setChartOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const sector = selectedIndustry(stock.config);
  const industry = stock.config.industry;
  useSectorInterest(sector ? [stock.config.code] : [], chartOpen && sector ? [stock.config.code] : []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setChartOpen(false);
    void api.openStockIndustry(stock.config.code)
      .catch((reason) => { if (!cancelled) setError(String(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [stock.config.code]);

  const save = async (patch: IndustryPatch) => {
    setSaving(true); setError("");
    try { await api.updateStockIndustry(stock.config.code, patch); }
    catch (reason) { setError(String(reason)); }
    finally { setSaving(false); }
  };
  const quote = sector ? state.sector_quotes?.[sector.id] : undefined;
  const minute = sector ? state.sector_minutes?.[sector.id] : undefined;
  const membershipError = state.industry_errors?.[stock.config.code.toLowerCase()];
  const quoteError = sector ? state.sector_errors?.[`q:${sector.id}`] : undefined;
  const minuteError = sector ? state.sector_errors?.[`m:${sector.id}`] : undefined;
  const supported = /^(sh|sz|bj)\d{6}$/i.test(stock.config.code);
  return <section className="industry-panel">
    <div className="industry-toolbar">
      <strong>{t("sector.title")}</strong>
      <select aria-label={t("sector.select")} value={sector?.id ?? ""} disabled={!industry?.sectors.length || saving}
        onChange={(event) => void save({ selected_id: event.target.value })}>
        {!industry?.sectors.length && <option value="">{loading ? t("common.loading") : "--"}</option>}
        {industry?.sectors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <span className="industry-current" style={{ color: quote ? profitColor(theme, quote.change_percent) : undefined }}>
        {quote ? formatSigned(quote.change_percent, 2) : "--"}
      </span>
      <button className="tool-button" disabled={!sector} aria-expanded={chartOpen} onClick={() => setChartOpen((value) => !value)}>
        {chartOpen ? t("sector.closeTrend") : t("sector.openTrend")}
      </button>
    </div>
    <div className="industry-options">
      <label><input type="checkbox" checked={industry?.show_near_price ?? false} disabled={saving || !supported}
        onChange={(event) => void save({ show_near_price: event.target.checked })} />{t("sector.nearPrice")}</label>
      <label><input type="checkbox" checked={industry?.show_in_float ?? false} disabled={saving || !supported}
        onChange={(event) => void save({ show_in_float: event.target.checked })} />{t("sector.inFloat")}</label>
    </div>
    <div className="industry-hint muted">{!supported ? t("sector.unsupported") : loading ? t("common.loading")
      : !industry?.sectors.length ? t("sector.noIndustry") : t("sector.refreshHint")}</div>
    {industry?.updated_on && <div className="industry-hint muted">{t("sector.membershipUpdated")}: {industry.updated_on}</div>}
    {(error || membershipError || quoteError) && <div className="save-error">{error || membershipError || quoteError}</div>}
    {industry?.attempted_on && industry.updated_on !== industry.attempted_on && !loading && supported
      && <div className="industry-hint muted">{t("sector.membershipFailed")}</div>}
    {chartOpen && sector && <>
      {minuteError && <div className="save-error">{minuteError}</div>}
      <IndustryChart minute={minute} quote={quote} theme={theme} />
      <div className="industry-hint muted">{t("sector.quoteTime")}: {quote?.time || "--"}
        {minute ? ` · ${t("sector.chartDate")}: ${minute.date} · ${t("sector.updated")}: ${new Date(minute.fetched_at).toLocaleTimeString()}` : ""}</div>
    </>}
  </section>;
}

function IndustryChart({ minute, quote, theme }: { minute?: SectorMinute; quote?: SectorQuote; theme: Theme }) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | undefined>(undefined);
  useEffect(() => {
    if (!host.current) return;
    const instance = echarts.init(host.current);
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(host.current);
    return () => { observer.disconnect(); instance.dispose(); chart.current = undefined; };
  }, []);
  useEffect(() => {
    const points = minute?.points ?? [];
    // A previous-session curve must not be normalized by today's previous close.
    const sameDate = quote?.time.slice(0, 8) === minute?.date;
    const previous = sameDate ? quote?.previous_close : undefined;
    chart.current?.setOption({
      animation: false,
      grid: { left: 68, right: 18, top: 20, bottom: 34 },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", boundaryGap: false, data: points.map((point) => point.time), axisLabel: { color: theme.text_gray } },
      yAxis: { type: "value", scale: true, axisLabel: { color: theme.text_gray, formatter: previous ? "{value}%" : "{value}" }, splitLine: { lineStyle: { color: theme.text_gray, opacity: 0.15 } } },
      series: [{ name: previous ? t("sector.change") : t("sector.index"), type: "line", showSymbol: false,
        data: points.map((point) => previous ? Number(((point.price / previous - 1) * 100).toFixed(3)) : point.price),
        lineStyle: { width: 1.5, color: theme.accent } }]
    }, true);
  }, [minute, quote, theme, t]);
  return <div className="industry-chart-shell">
    <div ref={host} className="industry-chart" role="img" aria-label={t("sector.openTrend")} />
    {!minute?.points.length && <div className="industry-chart-empty muted">{minute ? t("sector.noPoints") : t("common.loading")}</div>}
  </div>;
}
