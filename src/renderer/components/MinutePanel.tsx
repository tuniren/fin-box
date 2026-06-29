import * as echarts from "echarts";
import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { X } from "lucide-react";
import type { MinutePoint, StockStatus, Theme } from "../../shared/types";
import { formatSigned } from "../utils";

const api = window.finBox;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function MinutePanel({ stock, theme, onClose }: { stock: StockStatus; theme: Theme; onClose: () => void }) {
  const [points, setPoints] = useState<MinutePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [panelSize, setPanelSize] = useState({ width: 520, height: 360 });
  const [markerInput, setMarkerInput] = useState("");

  useEffect(() => {
    setPoints([]);
    setLoading(false);
    setError("");
    setPanelSize({ width: 520, height: 360 });
    setMarkerInput("");
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

  const startResize = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = panelSize;

    const onMouseMove = (moveEvent: MouseEvent) => {
      setPanelSize({
        width: clamp(startSize.width + moveEvent.clientX - startX, 300, 920),
        height: clamp(startSize.height + moveEvent.clientY - startY, 220, 720)
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
          <MinuteChart points={points} theme={theme} fill subtle markerPrice={isFiniteNumber(markerPrice) ? markerPrice : undefined} />
        )}
      </div>
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
  markerPrice
}: {
  points: MinutePoint[];
  theme: Theme;
  fill?: boolean;
  mini?: boolean;
  subtle?: boolean;
  markerPrice?: number;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);
  const zoomRef = useRef<MinuteZoomState>({ start: 0, end: 100 });

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

    chart.on("dataZoom", rememberZoom);

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(chartRef.current);

    return () => {
      chart.off("dataZoom", rememberZoom);
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
    const prices = points.map((point) => point.price);
    const averagePrices = points.map((point) => point.avgPrice ?? point.price);
    const volumes = points.map((point, index) => [index, point.volume, index > 0 && point.price < points[index - 1].price ? -1 : 1] as [number, number, number]);
    const previousClose = points.find((point) => point.prevClose !== undefined)?.prevClose;
    const latest = points[points.length - 1];
    const delta = previousClose && latest ? latest.price - previousClose : 0;
    const trendColor = subtle ? "#69736f" : profitColor(theme, delta);
    const averageColor = subtle ? "rgba(224,169,48,0.42)" : "#e5a829";
    const volumeColor = subtle ? "rgba(99,112,107,0.13)" : "rgba(0,122,204,0.34)";
    const subduedTextColor = subtle ? "#7b8581" : "#6a6a6a";
    const subduedAxisColor = subtle ? "rgba(128,139,134,0.24)" : "#d4d4d4";
    const priceAxisBounds = resolveMinutePriceAxisBounds(
      prices,
      averagePrices,
      previousClose,
      latest?.price,
      isFiniteNumber(markerPrice) ? markerPrice : undefined
    );
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
        color: [trendColor, averageColor, volumeColor],
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
          link: [{ xAxisIndex: [0, 1] }],
          snap: true,
          label: {
            show: !subtle,
            backgroundColor: subtle ? "#89928e" : "#5666a5"
          }
        },
        grid: [
          mini
            ? { left: 6, right: 38, top: 6, height: "68%" }
            : subtle
              ? { left: 12, right: 34, top: 10, height: "63%" }
              : { left: 54, right: 48, top: 16, height: "57%" },
          mini
            ? { left: 6, right: 38, top: "79%", height: "13%" }
            : subtle
              ? { left: 12, right: 34, top: "80%", height: "9%" }
              : { left: 54, right: 48, top: "72%", height: "17%" }
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
          },
          {
            type: "category",
            gridIndex: 1,
            data: times,
            boundaryGap: false,
            axisLine: { show: !mini && !subtle, lineStyle: { color: subduedAxisColor } },
            axisTick: { show: false },
            axisLabel: { show: !mini && !subtle, color: subduedTextColor, fontSize: 10 },
            splitLine: { show: false },
            axisPointer: {
              show: true,
              label: { show: true }
            }
          }
        ],
        yAxis: [
          {
            scale: true,
            min: priceAxisBounds.min,
            max: priceAxisBounds.max,
            splitNumber: previousClose ? 4 : undefined,
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { show: false },
            splitLine: { show: false }
          },
          {
            scale: true,
            min: priceAxisBounds.min,
            max: priceAxisBounds.max,
            splitNumber: previousClose ? 4 : undefined,
            position: "right",
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: {
              show: !mini && !subtle && !!previousClose,
              color: subduedTextColor,
              fontSize: 10,
              formatter: (value: number) => formatMinuteChangePoints(value, previousClose)
            },
            splitLine: { show: false }
          },
          {
            gridIndex: 1,
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { show: false },
            splitLine: { show: false }
          }
        ],
        dataZoom: [
          {
            type: "inside",
            xAxisIndex: [0, 1],
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
            xAxisIndex: [0, 1],
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
            areaStyle: { color: subtle ? "rgba(83,96,91,0.035)" : mini ? "rgba(0,122,204,0.1)" : "rgba(0,122,204,0.08)" },
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
          },
          {
            name: "Volume",
            type: "bar",
            xAxisIndex: 1,
            yAxisIndex: 2,
            barWidth: "58%",
            data: volumes,
            itemStyle: {
              color: (params: { data: [number, number, number] }) => subtle ? "rgba(96,108,103,0.12)" : params.data[2] > 0 ? "rgba(215,58,73,0.46)" : "rgba(34,134,58,0.46)"
            }
          }
        ]
      },
      true
    );
  }, [points, theme, subtle, markerPrice]);

  if (points.length === 0) return <div className="loading minute-loading">No minute data</div>;
  return <div className={`minute-chart ${fill ? "fill" : ""} ${mini ? "mini" : ""} ${subtle ? "subtle" : ""}`} ref={chartRef} role="img" aria-label="Minute chart" />;
}

type MinuteTooltipParam = {
  axisValueLabel?: string;
  dataIndex?: number;
  marker?: string;
  seriesName?: string;
  value?: number | [number, number, number];
};

type MinuteZoomState = {
  start: number;
  end: number;
};

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
  return formatSigned(((value - previousClose) / previousClose) * 100, 2);
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

  const valueSpan = dataMax - dataMin;
  const referenceValue = isFiniteNumber(previousClose) && previousClose !== 0 ? previousClose : dataMax || dataMin;
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
