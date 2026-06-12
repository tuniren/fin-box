import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { KLinePoint, MinutePoint, StockStatus, Theme } from "../../shared/types";
import { formatMaybe } from "../utils";

const api = window.finBox;
const DAILY_SCALE = 240;
const TRADING_MINUTES_PER_DAY = 240;

type IntensityStats = {
  currentVolume: number;
  projectedVolume: number;
  percentile: number;
  ratioToAverage: number;
  sampleSize: number;
  progress: number;
};

export function TradingIntensityPanel({ stock, theme }: { stock: StockStatus; theme: Theme }) {
  const [expanded, setExpanded] = useState(false);
  const [loadedCode, setLoadedCode] = useState("");
  const [history, setHistory] = useState<KLinePoint[]>([]);
  const [minutes, setMinutes] = useState<MinutePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!expanded || loadedCode === stock.config.code) return;

    let cancelled = false;
    setLoading(true);
    setError("");
    setHistory([]);
    setMinutes([]);

    Promise.all([
      api.fetchKLine(stock.config.code, DAILY_SCALE),
      api.fetchMinuteData(stock.config.code)
    ])
      .then(([nextHistory, nextMinutes]) => {
        if (cancelled) return;
        setHistory(nextHistory);
        setMinutes(nextMinutes);
        setLoadedCode(stock.config.code);
      })
      .catch((fetchError) => {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : "Failed to load intensity data.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [expanded, loadedCode, stock.config.code]);

  const stats = useMemo(() => calculateIntensity(history, minutes), [history, minutes]);

  if (!expanded) {
    return (
      <section className="intensity-panel collapsed" aria-label="Trading intensity">
        <button className="intensity-toggle" onClick={() => setExpanded(true)} aria-expanded="false">
          <span>Trading Intensity</span>
          <strong>Expand</strong>
        </button>
      </section>
    );
  }

  if (loading && !stats) {
    return (
      <section className="intensity-panel" aria-label="Trading intensity">
        <IntensityHeader onCollapse={() => setExpanded(false)} />
        <span className="muted">Loading trading intensity...</span>
      </section>
    );
  }
  if (error) {
    return (
      <section className="intensity-panel" aria-label="Trading intensity">
        <IntensityHeader onCollapse={() => setExpanded(false)} />
        <span className="save-error">{error}</span>
      </section>
    );
  }
  if (!stats) {
    return (
      <section className="intensity-panel" aria-label="Trading intensity">
        <IntensityHeader onCollapse={() => setExpanded(false)} />
        <span className="muted">No trading intensity data</span>
      </section>
    );
  }

  return (
    <section className="intensity-panel" aria-label="Trading intensity">
      <IntensityHeader onCollapse={() => setExpanded(false)}>
        <strong style={{ color: intensityColor(stats.percentile, theme) }}>{intensityLabel(stats.percentile)}</strong>
      </IntensityHeader>
      <div className="intensity-meter" aria-label={`Volume percentile ${Math.round(stats.percentile)} percent`}>
        <span style={{ width: `${Math.round(stats.percentile)}%`, background: intensityColor(stats.percentile, theme) }} />
      </div>
      <div className="intensity-grid">
        <IntensityItem label="Current Vol" value={formatVolume(stats.currentVolume)} />
        <IntensityItem label="Projected" value={formatVolume(stats.projectedVolume)} />
        <IntensityItem label="History Rank" value={`Top ${Math.max(1, Math.round(100 - stats.percentile))}%`} />
        <IntensityItem label="Avg Ratio" value={`${formatMaybe(stats.ratioToAverage, 2)}x`} />
      </div>
      <div className="intensity-note">
        Based on {stats.sampleSize} daily bars, adjusted by {Math.round(stats.progress * 100)}% of trading session.
      </div>
    </section>
  );
}

function IntensityHeader({ children, onCollapse }: { children?: ReactNode; onCollapse: () => void }) {
  return (
    <div className="intensity-title">
      <span>Trading Intensity</span>
      <button className="intensity-collapse" onClick={onCollapse} aria-expanded="true">
        {children ?? <strong>Collapse</strong>}
      </button>
    </div>
  );
}

function IntensityItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="intensity-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function calculateIntensity(history: KLinePoint[], minutes: MinutePoint[]): IntensityStats | undefined {
  const baseline = history.length > 1 ? history.slice(0, -1) : history;
  const historicalVolumes = baseline
    .map((point) => point.volume)
    .filter((volume) => Number.isFinite(volume) && volume > 0);
  const currentVolume = minutes.reduce((sum, point) => sum + Math.max(0, point.volume), 0);
  if (historicalVolumes.length < 5 || currentVolume <= 0) return undefined;

  const progress = tradingProgress(minutes);
  const projectedVolume = currentVolume / progress;
  const belowOrEqual = historicalVolumes.filter((volume) => volume <= projectedVolume).length;
  const percentile = clamp((belowOrEqual / historicalVolumes.length) * 100, 0, 100);
  const average = historicalVolumes.reduce((sum, volume) => sum + volume, 0) / historicalVolumes.length;

  return {
    currentVolume,
    projectedVolume,
    percentile,
    ratioToAverage: average > 0 ? projectedVolume / average : 0,
    sampleSize: historicalVolumes.length,
    progress
  };
}

function tradingProgress(minutes: MinutePoint[]): number {
  const latest = minutes[minutes.length - 1]?.time;
  const elapsed = latest ? elapsedTradingMinutes(latest) : minutes.length;
  return clamp(elapsed / TRADING_MINUTES_PER_DAY, 0.05, 1);
}

function elapsedTradingMinutes(time: string): number {
  const match = time.match(/(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const value = hour * 60 + minute;
  const morningStart = 9 * 60 + 30;
  const morningEnd = 11 * 60 + 30;
  const afternoonStart = 13 * 60;
  const afternoonEnd = 15 * 60;

  if (value <= morningStart) return 1;
  if (value <= morningEnd) return value - morningStart;
  if (value < afternoonStart) return 120;
  if (value <= afternoonEnd) return 120 + value - afternoonStart;
  return TRADING_MINUTES_PER_DAY;
}

function intensityLabel(percentile: number): string {
  if (percentile >= 90) return "Extreme";
  if (percentile >= 75) return "Hot";
  if (percentile >= 50) return "Active";
  if (percentile >= 25) return "Normal";
  return "Quiet";
}

function intensityColor(percentile: number, theme: Theme): string {
  if (percentile >= 75) return theme.color_up;
  if (percentile >= 50) return theme.accent;
  if (percentile >= 25) return "#d28721";
  return theme.color_down;
}

function formatVolume(value: number): string {
  if (value >= 1000000000) return `${formatMaybe(value / 1000000000, 2)}B`;
  if (value >= 1000000) return `${formatMaybe(value / 1000000, 2)}M`;
  if (value >= 1000) return `${formatMaybe(value / 1000, 2)}K`;
  return Math.round(value).toLocaleString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
