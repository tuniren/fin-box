import * as echarts from "echarts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { X } from "lucide-react";
import type { KLinePoint, MinutePoint, StockStatus, Theme } from "../../shared/types";
import { formatMaybe, formatSigned } from "../utils";

const api = window.finBox;
const DAILY_SCALE = 240;
const TRADING_MINUTES_PER_DAY = 240;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function MinutePanel({ stock, theme, onClose }: { stock: StockStatus; theme: Theme; onClose: () => void }) {
  const [points, setPoints] = useState<MinutePoint[]>([]);
  const [history, setHistory] = useState<KLinePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [panelSize, setPanelSize] = useState({ width: 520, height: 460 });
  const [markerInput, setMarkerInput] = useState("");
  const [activeWidget, setActiveWidget] = useState<MinuteWidgetKind>("volume");
  const [selectedMinuteIndex, setSelectedMinuteIndex] = useState<number>();

  useEffect(() => {
    setPoints([]);
    setLoading(false);
    setError("");
    setHistory([]);
    setPanelSize({ width: 520, height: 460 });
    setMarkerInput("");
    setActiveWidget("volume");
    setSelectedMinuteIndex(undefined);
  }, [stock.config.code]);

  useEffect(() => {
    let cancelled = false;
    setHistory([]);
    void api.fetchKLine(stock.config.code, DAILY_SCALE)
      .then((nextHistory) => {
        if (!cancelled) setHistory(nextHistory);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });

    return () => {
      cancelled = true;
    };
  }, [stock.config.code]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const loadMinuteData = () => {
      if (inFlight) return;
      inFlight = true;
      setError("");
      void api.fetchMinuteData(stock.config.code)
        .then((nextPoints) => {
          if (!cancelled) setPoints(nextPoints);
        })
        .catch((loadError) => {
          if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load minute data.");
        })
        .finally(() => {
          inFlight = false;
          if (!cancelled) setLoading(false);
        });
    };

    setLoading(true);
    loadMinuteData();
    const timer = window.setInterval(loadMinuteData, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [stock.config.code]);

  const markerPrice = markerInput.trim() === "" ? undefined : Number(markerInput);
  const selectedMinutePoint = isFiniteNumber(selectedMinuteIndex) ? points[selectedMinuteIndex] : undefined;

  const startResize = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = panelSize;

    const onMouseMove = (moveEvent: MouseEvent) => {
      setPanelSize({
        width: clamp(startSize.width + moveEvent.clientX - startX, 300, 920),
        height: clamp(startSize.height + moveEvent.clientY - startY, 330, 760)
      });
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <section className="minute-panel embedded-minute-panel" style={{ width: panelSize.width, height: panelSize.height }}>
      <div className="minute-title">
        <span>Minute</span>
        <div className="minute-actions">
          <label className="minute-marker-control" title="Prep line price">
            <span>Prep</span>
            <input
              type="number"
              step="0.001"
              value={markerInput}
              onChange={(event) => setMarkerInput(event.target.value)}
              placeholder="price"
            />
          </label>
          {markerInput && (
            <button className="icon-tool compact" onClick={() => setMarkerInput("")} aria-label="Clear prep line" title="Clear prep line">
              <X size={13} />
            </button>
          )}
          <button className="icon-tool compact" onClick={onClose} aria-label="Close minute chart" title="Close">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="minute-chart-shell">
        {error && <div className="save-error minute-error">{error}</div>}
        {loading && points.length === 0 ? (
          <div className="loading minute-loading">Loading...</div>
        ) : (
          <MinuteChart points={points} theme={theme} fill subtle markerPrice={isFiniteNumber(markerPrice) ? markerPrice : undefined} selectedIndex={selectedMinuteIndex} onSelectPoint={setSelectedMinuteIndex} />
        )}
      </div>
      <MinuteWidgetDeck points={points} history={history} theme={theme} hongKong={/^hk\d{5}$/i.test(stock.config.code)} activeWidget={activeWidget} selectedIndex={selectedMinuteIndex} selectedPoint={selectedMinutePoint} onActiveWidgetChange={setActiveWidget} onSelectPoint={setSelectedMinuteIndex} />
      <button className="minute-resize-handle embedded-minute-resize-handle" onMouseDown={startResize} aria-label="Resize minute chart" title="Resize" />
    </section>
  );
}

function MinuteChart({
  points,
  theme,
  fill = false,
  mini = false,
  subtle = false,
  markerPrice,
  selectedIndex,
  onSelectPoint
}: {
  points: MinutePoint[];
  theme: Theme;
  fill?: boolean;
  mini?: boolean;
  subtle?: boolean;
  markerPrice?: number;
  selectedIndex?: number;
  onSelectPoint?: (index: number) => void;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);
  const zoomRef = useRef<MinuteZoomState>({ start: 0, end: 100 });
  const onSelectPointRef = useRef(onSelectPoint);
  const timeLabelsRef = useRef<string[]>([]);

  useEffect(() => {
    onSelectPointRef.current = onSelectPoint;
  }, [onSelectPoint]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current, undefined, { renderer: "canvas" });
    instanceRef.current = chart;

    const rememberZoom = () => {
      const option = chart.getOption?.() as MinuteChartOption | undefined;
      const zoom = option?.dataZoom?.[0];
      if (isFiniteNumber(zoom?.start) && isFiniteNumber(zoom?.end)) {
        zoomRef.current = { start: zoom.start, end: zoom.end };
      }
    };

    const selectPoint = (params: MinuteChartSelectParam) => {
      const index = resolveMinuteSelectIndex(params, timeLabelsRef.current);
      if (isFiniteNumber(index)) onSelectPointRef.current?.(index);
    };

    chart.on("dataZoom", rememberZoom);
    chart.on("click", selectPoint);
    chart.on("updateAxisPointer", selectPoint);

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(chartRef.current);

    return () => {
      chart.off("dataZoom", rememberZoom);
      chart.off("click", selectPoint);
      chart.off("updateAxisPointer", selectPoint);
      resizeObserver.disconnect();
      chart.dispose();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = instanceRef.current;
    if (!chart) return;

    if (points.length === 0) {
      chart.clear();
      return;
    }

    const times = points.map((point) => point.time);
    timeLabelsRef.current = times;
    const prices = points.map((point) => point.price);
    const averagePrices = points.map((point) => point.avgPrice ?? point.price);
    const previousClose = points.find((point) => point.prevClose !== undefined)?.prevClose;
    const latest = points[points.length - 1];
    const selectedPoint = isFiniteNumber(selectedIndex) ? points[selectedIndex] : undefined;
    const delta = previousClose && latest ? latest.price - previousClose : 0;
    const trendColor = subtle ? "#69736f" : profitColor(theme, delta);
    const averageColor = subtle ? "rgba(224,169,48,0.42)" : "#e5a829";
    const subduedTextColor = subtle ? "#7b8581" : "#6a6a6a";
    const subduedAxisColor = subtle ? "rgba(128,139,134,0.24)" : "#d4d4d4";
    const priceAxisBounds = resolveMinutePriceAxisBounds(
      prices,
      averagePrices,
      previousClose,
      latest?.price,
      isFiniteNumber(markerPrice) ? markerPrice : undefined
    );
    const priceAxisInterval = isFiniteNumber(previousClose) && isFiniteNumber(priceAxisBounds.min) && isFiniteNumber(priceAxisBounds.max)
      ? (priceAxisBounds.max - priceAxisBounds.min) / 2
      : undefined;
    const zoom = zoomRef.current;
    const priceMarkLines = [
      previousClose
        ? {
            name: "Prev",
            yAxis: previousClose,
            label: { show: !mini && !subtle, formatter: "0.00 / Prev", color: subduedTextColor, fontSize: 10 },
            lineStyle: { color: subtle ? "rgba(104,116,111,0.26)" : "#9ca3af", type: "solid", width: 1 }
          }
        : undefined,
      latest
        ? {
            name: "Latest",
            yAxis: latest.price,
            label: {
              show: true,
              formatter: formatChartDecimal(latest.price),
              position: "insideEndTop",
              distance: 2,
              color: trendColor,
              backgroundColor: subtle ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.82)",
              borderColor: subtle ? "rgba(118,130,125,0.22)" : "rgba(148,163,184,0.62)",
              borderWidth: 1,
              borderRadius: 2,
              padding: [1, 3],
              fontSize: mini || subtle ? 9 : 10
            },
            lineStyle: { color: trendColor, type: "dashed", width: mini || subtle ? 1 : 1.2, opacity: subtle ? 0.34 : 0.72 }
          }
        : undefined,
      selectedPoint
        ? {
            name: "Selected",
            xAxis: selectedPoint.time,
            label: { show: false },
            lineStyle: { color: "rgba(31,31,31,0.26)", type: "dotted", width: 1 }
          }
        : undefined,
      isFiniteNumber(markerPrice)
        ? {
            name: "Prep",
            yAxis: markerPrice,
            label: {
              show: true,
              formatter: subtle ? "Prep" : `Prep ${formatChartDecimal(markerPrice)}`,
              position: "insideStartTop",
              distance: 2,
              color: subtle ? "#27332f" : "#5f6670",
              backgroundColor: subtle ? "rgba(246,247,241,0.88)" : "rgba(255,255,255,0.82)",
              borderColor: subtle ? "rgba(39,51,47,0.44)" : "rgba(107,114,128,0.42)",
              borderWidth: 1,
              borderRadius: 2,
              padding: [1, 3],
              fontSize: 10,
              fontWeight: subtle ? 600 : 400
            },
            lineStyle: { color: subtle ? "rgba(41,55,50,0.68)" : "#6b7280", type: "dotted", width: subtle ? 1.6 : 1.2, opacity: subtle ? 0.82 : 0.78 }
          }
        : undefined
    ].filter(Boolean);

    chart.setOption(
      {
        animation: false,
        backgroundColor: mini || subtle ? "transparent" : "#ffffff",
        color: [trendColor, averageColor],
        textStyle: {
          color: subtle ? "#737d79" : "#3f3f3f",
          fontFamily: "\"Segoe UI\", system-ui, sans-serif",
          fontSize: 11
        },
        tooltip: {
          trigger: "axis",
          triggerOn: "mousemove|click",
          axisPointer: {
            type: "line",
            axis: "x",
            lineStyle: { color: subtle ? "rgba(104,116,111,0.24)" : "#6b7280", width: 1, type: "dashed" }
          },
          borderColor: subtle ? "rgba(118,130,125,0.26)" : "#d4d4d4",
          borderWidth: 1,
          backgroundColor: subtle ? "rgba(246,247,241,0.9)" : "rgba(255,255,255,0.96)",
          textStyle: { color: subtle ? "#5f6965" : "#333333" },
          formatter: (params: MinuteTooltipParam | MinuteTooltipParam[]) => formatMinuteTooltip(params, previousClose)
        },
        axisPointer: {
          link: [{ xAxisIndex: [0] }],
          snap: true,
          label: {
            show: !subtle,
            backgroundColor: subtle ? "#89928e" : "#5666a5"
          }
        },
        grid: [
          mini
            ? { left: 6, right: 38, top: 6, bottom: 12 }
            : subtle
              ? { left: 12, right: 34, top: 10, bottom: 20 }
              : { left: 54, right: 48, top: 16, bottom: 34 }
        ],
        xAxis: [
          {
            type: "category",
            data: times,
            boundaryGap: false,
            axisLine: { show: !mini && !subtle, lineStyle: { color: subduedAxisColor } },
            axisTick: { show: false },
            axisLabel: { show: false },
            splitLine: { show: false },
            axisPointer: {
              show: true,
              label: { show: false }
            }
          }
        ],
        yAxis: [
          {
            scale: true,
            min: priceAxisBounds.min,
            max: priceAxisBounds.max,
            splitNumber: previousClose ? 2 : undefined,
            interval: priceAxisInterval,
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { show: false },
            splitLine: { show: false }
          },
          {
            scale: true,
            min: priceAxisBounds.min,
            max: priceAxisBounds.max,
            splitNumber: previousClose ? 2 : undefined,
            interval: priceAxisInterval,
            position: "right",
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: {
              show: !mini && !!previousClose,
              color: subduedTextColor,
              fontSize: subtle ? 9 : 10,
              formatter: (value: number) => formatMinuteEdgeChangePoint(value, previousClose, priceAxisBounds)
            },
            splitLine: { show: false }
          }
        ],
        dataZoom: [
          {
            type: "inside",
            xAxisIndex: [0],
            filterMode: "filter",
            zoomOnMouseWheel: true,
            moveOnMouseMove: true,
            moveOnMouseWheel: false,
            start: zoom.start,
            end: zoom.end,
            minSpan: 3
          },
          {
            type: "slider",
            show: !mini,
            xAxisIndex: [0],
            filterMode: "filter",
            height: subtle ? 8 : 16,
            bottom: 8,
            borderColor: subtle ? "rgba(209,213,219,0.44)" : "#d4d4d4",
            fillerColor: subtle ? "rgba(148,163,184,0.16)" : "rgba(0,122,204,0.14)",
            handleSize: subtle ? 7 : 12,
            moveHandleSize: subtle ? 3 : 5,
            start: zoom.start,
            end: zoom.end,
            minSpan: 3,
            textStyle: { color: subduedTextColor, fontSize: subtle ? 9 : 10 }
          }
        ],
        series: [
          {
            name: "Price",
            type: "line",
            xAxisIndex: 0,
            yAxisIndex: 0,
            data: prices,
            symbol: "none",
            lineStyle: { width: subtle ? 1.35 : mini ? 1.4 : 1.8, color: trendColor, opacity: subtle ? 0.58 : 1, cap: "round", join: "round" },
            connectNulls: true,
            markLine: {
              silent: true,
              symbol: "none",
              data: priceMarkLines
            }
          },
          {
            name: "Avg",
            type: "line",
            xAxisIndex: 0,
            yAxisIndex: 0,
            data: averagePrices,
            symbol: "none",
            lineStyle: { width: subtle ? 1 : 1.25, color: averageColor },
            opacity: subtle ? 0.34 : mini ? 0.78 : 1,
            connectNulls: true
          }
        ]
      },
      true
    );
  }, [points, theme, subtle, markerPrice, selectedIndex]);

  if (points.length === 0) return <div className="loading minute-loading">No minute data</div>;
  return <div className={`minute-chart ${fill ? "fill" : ""} ${mini ? "mini" : ""} ${subtle ? "subtle" : ""}`} ref={chartRef} role="img" aria-label="Minute chart" />;
}

type MinuteWidgetKind = "volume" | "ratio" | "macdfs";

const minuteWidgets: Array<{ value: MinuteWidgetKind; label: string }> = [
  { value: "volume", label: "\u5206\u65f6\u91cf" },
  { value: "ratio", label: "\u91cf\u6bd4" },
  { value: "macdfs", label: "MACDFS" }
];

function MinuteWidgetDeck({
  points,
  history,
  theme,
  hongKong,
  activeWidget,
  selectedIndex,
  selectedPoint,
  onActiveWidgetChange,
  onSelectPoint
}: {
  points: MinutePoint[];
  history: KLinePoint[];
  theme: Theme;
  hongKong: boolean;
  activeWidget: MinuteWidgetKind;
  selectedIndex?: number;
  selectedPoint?: MinutePoint;
  onActiveWidgetChange: (widget: MinuteWidgetKind) => void;
  onSelectPoint: (index: number) => void;
}) {
  const volumeStats = useMemo(() => calculateMinuteVolumeStats(history, points, hongKong), [history, points, hongKong]);
  const macd = useMemo(() => calculateMinuteMacd(points), [points]);
  const latestPoint = points[points.length - 1];
  const displayPoint = selectedPoint ?? latestPoint;
  const displayVolume = Math.max(0, displayPoint?.volume ?? 0);
  const displayHandVolume = Math.max(0, latestPoint?.volume ?? 0);

  return (
    <section className="minute-widget-deck" aria-label="Minute widgets">
      <div className="minute-widget-title">
        <select value={activeWidget} onChange={(event) => onActiveWidgetChange(event.target.value as MinuteWidgetKind)} aria-label="Minute widget">
          {minuteWidgets.map((widget) => (
            <option key={widget.value} value={widget.value}>{widget.label}</option>
          ))}
        </select>
        <span className="minute-widget-help" title="Switch minute widgets">?</span>
        <div className="minute-widget-summary">
          {activeWidget === "volume" && (
            <>
              {displayPoint && <span className="minute-widget-time">{displayPoint.time}</span>}
              <span>{"\u91cf: "}<strong style={{ color: theme.text_normal }}>{formatFullVolume(displayVolume)}</strong></span>
              <span>{"\u73b0\u624b: "}<strong style={{ color: theme.text_normal }}>{formatFullVolume(displayHandVolume)}</strong></span>
            </>
          )}
          {activeWidget === "ratio" && (
            <>
              <span>{"\u91cf\u6bd4: "}<strong>{isFiniteNumber(volumeStats.ratioToAverage) ? `${formatMaybe(volumeStats.ratioToAverage, 2)}x` : "--"}</strong></span>
              <span>{"\u8fdb\u5ea6: "}<strong>{Math.round(volumeStats.progress * 100)}%</strong></span>
            </>
          )}
          {activeWidget === "macdfs" && (
            <>
              <span>DIF: <strong>{formatSigned(macd?.dif ?? 0, 3)}</strong></span>
              <span>DEA: <strong>{formatSigned(macd?.dea ?? 0, 3)}</strong></span>
            </>
          )}
        </div>
      </div>
      <div className="minute-widget-body">
        {activeWidget === "volume" && <MinuteVolumeWidget points={points} selectedIndex={selectedIndex} onSelectPoint={onSelectPoint} />}
        {activeWidget === "ratio" && <MinuteRatioWidget stats={volumeStats} theme={theme} />}
        {activeWidget === "macdfs" && <MinuteMacdfsWidget macd={macd} theme={theme} />}
      </div>
    </section>
  );
}

function MinuteVolumeWidget({ points, selectedIndex, onSelectPoint }: { points: MinutePoint[]; selectedIndex?: number; onSelectPoint: (index: number) => void }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);
  const onSelectPointRef = useRef(onSelectPoint);
  const timeLabelsRef = useRef<string[]>([]);
  const hasPoints = points.length > 0;

  useEffect(() => {
    onSelectPointRef.current = onSelectPoint;
  }, [onSelectPoint]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current, undefined, { renderer: "canvas" });
    instanceRef.current = chart;

    const selectPoint = (params: MinuteChartSelectParam) => {
      const index = resolveMinuteSelectIndex(params, timeLabelsRef.current);
      if (isFiniteNumber(index)) onSelectPointRef.current(index);
    };

    chart.on("click", selectPoint);
    chart.on("updateAxisPointer", selectPoint);

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(chartRef.current);

    return () => {
      chart.off("click", selectPoint);
      chart.off("updateAxisPointer", selectPoint);
      resizeObserver.disconnect();
      chart.dispose();
      instanceRef.current = null;
    };
  }, [hasPoints]);

  useEffect(() => {
    const chart = instanceRef.current;
    if (!chart) return;
    if (points.length === 0) {
      chart.clear();
      return;
    }

    const times = points.map((point) => point.time);
    timeLabelsRef.current = times;
    const selectedPoint = isFiniteNumber(selectedIndex) ? points[selectedIndex] : undefined;
    const volumes = points.map((point, index) => [index, point.volume, index > 0 && point.price < points[index - 1].price ? -1 : 1] as [number, number, number]);

    chart.setOption(
      {
        animation: false,
        backgroundColor: "transparent",
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "line", lineStyle: { color: "rgba(104,116,111,0.28)", width: 1, type: "dashed" } },
          borderColor: "rgba(118,130,125,0.24)",
          borderWidth: 1,
          backgroundColor: "rgba(246,247,241,0.92)",
          textStyle: { color: "#5f6965", fontSize: 11 },
          formatter: (params: MinuteTooltipParam | MinuteTooltipParam[]) => formatVolumeTooltip(params)
        },
        grid: { left: 12, right: 38, top: 6, bottom: 4 },
        xAxis: {
          type: "category",
          data: times,
          boundaryGap: false,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false }
        },
        yAxis: {
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false }
        },
        series: [
          {
            name: "\u5206\u65f6\u91cf",
            type: "bar",
            barWidth: "62%",
            data: volumes,
            itemStyle: {
              color: (params: { data: [number, number, number]; dataIndex: number }) => params.dataIndex === selectedIndex ? "rgba(31,31,31,0.58)" : params.data[2] > 0 ? "rgba(31,31,31,0.34)" : "rgba(31,31,31,0.18)"
            },
            markLine: {
              silent: true,
              symbol: "none",
              data: selectedPoint
                ? [
                    {
                      name: "Selected",
                      xAxis: selectedPoint.time,
                      label: { show: false },
                      lineStyle: { color: "rgba(31,31,31,0.26)", type: "dotted", width: 1 }
                    }
                  ]
                : []
            }
          }
        ]
      },
      true
    );
  }, [points, selectedIndex]);

  if (points.length === 0) return <div className="minute-widget-empty">No minute volume</div>;
  return <div className="minute-volume-widget" ref={chartRef} role="img" aria-label="Minute volume" />;
}

function MinuteRatioWidget({ stats, theme }: { stats: MinuteVolumeStats; theme: Theme }) {
  const ratio = isFiniteNumber(stats.ratioToAverage) ? stats.ratioToAverage : 0;
  const width = `${Math.round(clamp(ratio / 3, 0, 1) * 100)}%`;

  return (
    <div className="minute-metric-widget">
      <div className="minute-meter"><span style={{ width, background: ratio >= 1 ? theme.color_up : theme.color_down }} /></div>
      <div className="minute-widget-grid">
        <MinuteWidgetMetric label={"\u5f53\u524d\u91cf"} value={formatVolume(stats.currentVolume)} />
        <MinuteWidgetMetric label={"\u4f30\u7b97\u91cf"} value={formatVolume(stats.projectedVolume)} />
        <MinuteWidgetMetric label={"\u5747\u91cf\u6bd4"} value={isFiniteNumber(stats.ratioToAverage) ? `${formatMaybe(stats.ratioToAverage, 2)}x` : "--"} />
        <MinuteWidgetMetric label={"\u6837\u672c"} value={stats.sampleSize ? `${stats.sampleSize}` : "--"} />
      </div>
    </div>
  );
}

function MinuteMacdfsWidget({ macd, theme }: { macd?: MinuteMacdPoint; theme: Theme }) {
  if (!macd) return <div className="minute-widget-empty">No MACDFS data</div>;
  const color = macd.macd >= 0 ? theme.color_up : theme.color_down;

  return (
    <div className="minute-metric-widget">
      <div className="minute-macd-line"><span style={{ width: `${Math.round(clamp(Math.abs(macd.macd) * 120, 4, 100))}%`, background: color }} /></div>
      <div className="minute-widget-grid">
        <MinuteWidgetMetric label="DIF" value={formatSigned(macd.dif, 3)} />
        <MinuteWidgetMetric label="DEA" value={formatSigned(macd.dea, 3)} />
        <MinuteWidgetMetric label="MACD" value={formatSigned(macd.macd, 3)} color={color} />
        <MinuteWidgetMetric label={"\u65b9\u5411"} value={macd.macd >= 0 ? "\u591a" : "\u7a7a"} color={color} />
      </div>
    </div>
  );
}

function MinuteWidgetMetric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="minute-widget-metric">
      <span>{label}</span>
      <strong style={{ color }}>{value}</strong>
    </div>
  );
}

type MinuteVolumeStats = {
  currentVolume: number;
  latestVolume: number;
  projectedVolume: number;
  ratioToAverage?: number;
  progress: number;
  sampleSize: number;
};

type MinuteMacdPoint = {
  dif: number;
  dea: number;
  macd: number;
};

function calculateMinuteVolumeStats(history: KLinePoint[], points: MinutePoint[], hongKong: boolean): MinuteVolumeStats {
  const currentVolume = points.reduce((sum, point) => sum + Math.max(0, point.volume), 0);
  const latestVolume = Math.max(0, points[points.length - 1]?.volume ?? 0);
  const progress = tradingProgress(points, hongKong);
  const projectedVolume = currentVolume > 0 ? currentVolume / progress : 0;
  const baseline = history.length > 1 ? history.slice(0, -1) : history;
  const historicalVolumes = baseline.map((point) => point.volume).filter((value) => Number.isFinite(value) && value > 0);
  const averageVolume = historicalVolumes.length > 0
    ? historicalVolumes.reduce((sum, value) => sum + value, 0) / historicalVolumes.length
    : undefined;

  return {
    currentVolume,
    latestVolume,
    projectedVolume,
    ratioToAverage: averageVolume && averageVolume > 0 ? projectedVolume / averageVolume : undefined,
    progress,
    sampleSize: historicalVolumes.length
  };
}

function calculateMinuteMacd(points: MinutePoint[]): MinuteMacdPoint | undefined {
  if (points.length < 2) return undefined;
  let ema12 = points[0].price;
  let ema26 = points[0].price;
  let dea = 0;
  let dif = 0;

  for (const point of points) {
    ema12 = ema12 * (11 / 13) + point.price * (2 / 13);
    ema26 = ema26 * (25 / 27) + point.price * (2 / 27);
    dif = ema12 - ema26;
    dea = dea * (8 / 10) + dif * (2 / 10);
  }

  return { dif, dea, macd: (dif - dea) * 2 };
}

function tradingProgress(points: MinutePoint[], hongKong: boolean): number {
  const latest = points[points.length - 1]?.time;
  const elapsed = latest ? elapsedTradingMinutes(latest, hongKong) : points.length;
  return clamp(elapsed / (hongKong ? 330 : TRADING_MINUTES_PER_DAY), 0.05, 1);
}

function elapsedTradingMinutes(time: string, hongKong: boolean): number {
  const match = time.match(/(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const value = hour * 60 + minute;
  const morningStart = 9 * 60 + 30;
  const morningEnd = hongKong ? 12 * 60 : 11 * 60 + 30;
  const morningMinutes = hongKong ? 150 : 120;
  const afternoonStart = 13 * 60;
  const afternoonEnd = hongKong ? 16 * 60 : 15 * 60;

  if (value <= morningStart) return 1;
  if (value <= morningEnd) return value - morningStart;
  if (value < afternoonStart) return morningMinutes;
  if (value <= afternoonEnd) return morningMinutes + value - afternoonStart;
  return hongKong ? 330 : TRADING_MINUTES_PER_DAY;
}

function formatFullVolume(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString() : "--";
}

function formatVolume(value: number): string {
  if (value >= 1000000000) return `${formatMaybe(value / 1000000000, 2)}B`;
  if (value >= 1000000) return `${formatMaybe(value / 1000000, 2)}M`;
  if (value >= 1000) return `${formatMaybe(value / 1000, 2)}K`;
  return Math.round(value).toLocaleString();
}

function formatVolumeTooltip(params: MinuteTooltipParam | MinuteTooltipParam[]): string {
  const item = Array.isArray(params) ? params[0] : params;
  const value = minuteTooltipValue(item ?? {});
  const time = item?.axisValueLabel ?? "";
  return `<div class="chart-tooltip"><div class="chart-tooltip-time">${escapeTooltipText(time)}</div><div class="chart-tooltip-row"><span>\u5206\u65f6\u91cf</span><b>${formatFullVolume(value)}</b></div></div>`;
}

type MinuteTooltipParam = {
  axisValueLabel?: string;
  dataIndex?: number;
  marker?: string;
  seriesName?: string;
  value?: number | [number, number, number];
};

type MinuteChartSelectParam = {
  axesInfo?: Array<{ value?: number | string }>;
  axisValue?: number | string;
  dataIndex?: number;
  name?: string;
};

type MinuteZoomState = {
  start: number;
  end: number;
};

function resolveMinuteSelectIndex(params: MinuteChartSelectParam, labels: string[]): number | undefined {
  if (labels.length === 0) return undefined;

  if (isFiniteNumber(params.dataIndex)) return clamp(Math.round(params.dataIndex), 0, labels.length - 1);

  const axisValue = params.axesInfo?.[0]?.value ?? params.axisValue ?? params.name;
  if (isFiniteNumber(axisValue)) return clamp(Math.round(axisValue), 0, labels.length - 1);
  if (typeof axisValue === "string") {
    const index = labels.indexOf(axisValue);
    return index >= 0 ? index : undefined;
  }

  return undefined;
}

type MinuteChartOption = {
  dataZoom?: Array<Partial<MinuteZoomState>>;
};

function formatMinuteTooltip(params: MinuteTooltipParam | MinuteTooltipParam[], previousClose?: number): string {
  const items = Array.isArray(params) ? params : [params];
  const time = items.find((item) => item.axisValueLabel)?.axisValueLabel ?? "";
  const rows = items
    .filter((item) => item.seriesName)
    .map((item) => {
      const value = minuteTooltipValue(item);
      const formatted = item.seriesName === "Volume" ? formatChartInteger(value) : formatChartDecimal(value);
      return `<div class="chart-tooltip-row">${item.marker ?? ""}<span>${escapeTooltipText(item.seriesName ?? "")}</span><b>${formatted}</b></div>`;
    })
    .join("");
  const price = minuteTooltipValue(items.find((item) => item.seriesName === "Price") ?? {});
  const change = previousClose && price ? ((price - previousClose) / previousClose) * 100 : undefined;
  const changeRow = change === undefined
    ? ""
    : `<div class="chart-tooltip-row"><span>Change %</span><b>${formatSigned(change, 2)}%</b></div>`;

  return `<div class="chart-tooltip"><div class="chart-tooltip-time">${escapeTooltipText(time)}</div>${rows}${changeRow}</div>`;
}

function minuteTooltipValue(item: MinuteTooltipParam): number {
  if (Array.isArray(item.value)) return Number(item.value[1]) || 0;
  return Number(item.value) || 0;
}

function formatChartDecimal(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "--";
}

function formatChartInteger(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString() : "--";
}

function formatMinuteChangePoints(value: number, previousClose?: number): string {
  if (!previousClose || !Number.isFinite(previousClose) || previousClose === 0) return "--";
  return `${formatSigned(((value - previousClose) / previousClose) * 100, 2)}%`;
}

function formatMinuteEdgeChangePoint(value: number, previousClose: number | undefined, bounds: { min?: number; max?: number }): string {
  if (!isFiniteNumber(previousClose) || !isFiniteNumber(bounds.min) || !isFiniteNumber(bounds.max)) return "";
  const range = bounds.max - bounds.min;
  const tolerance = Math.max(Math.abs(range) * 0.0001, 0.000001);
  const isEdge = Math.abs(value - bounds.max) <= tolerance || Math.abs(value - bounds.min) <= tolerance;
  return isEdge ? formatMinuteChangePoints(value, previousClose) : "";
}

function resolveMinutePriceAxisBounds(
  prices: number[],
  averagePrices: number[],
  previousClose?: number,
  latestPrice?: number,
  markerPrice?: number
): { min?: number; max?: number } {
  const candidates = [...prices, ...averagePrices];
  if (isFiniteNumber(latestPrice)) candidates.push(latestPrice);
  if (isFiniteNumber(markerPrice)) candidates.push(markerPrice);
  if (isFiniteNumber(previousClose)) candidates.push(previousClose);

  const finiteValues = candidates.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) return {};

  const dataMin = Math.min(...finiteValues);
  const dataMax = Math.max(...finiteValues);

  if (isFiniteNumber(previousClose) && previousClose !== 0) {
    const distance = Math.max(Math.abs(dataMax - previousClose), Math.abs(dataMin - previousClose));
    const padding = Math.max(distance * 0.1, Math.abs(previousClose) * 0.0015, 0.001);
    const span = distance + padding;
    return { min: previousClose - span, max: previousClose + span };
  }

  const valueSpan = dataMax - dataMin;
  const referenceValue = dataMax || dataMin;
  const padding = Math.max(valueSpan * 0.1, Math.abs(referenceValue) * 0.0015, 0.001);

  return { min: dataMin - padding, max: dataMax + padding };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function profitColor(theme: Theme, value?: number) {
  if (value === undefined || value === 0) return theme.text_normal;
  return value > 0 ? theme.color_up : theme.color_down;
}

function escapeTooltipText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
