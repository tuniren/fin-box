import * as echarts from "echarts";
import "antd/dist/reset.css";
import { Form, Input } from "antd";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { KLinePoint } from "../../shared/types";
import { formatMaybe } from "../utils";

const api = window.finBox;
const DAILY_SCALE = 240;
const DEFAULT_CHART_HEIGHT = 560;
const MIN_CHART_WIDTH = 520;
const MIN_CHART_HEIGHT = 360;
const MAX_CHART_HEIGHT = 1200;
const kLineViews = [
  { key: "daily", label: "日K" },
  { key: "weekly", label: "周K" },
  { key: "monthly", label: "月K" },
  { key: "five-day", label: "五日K" }
] as const;
const movingAveragePeriods = [5, 10, 20, 30, 60] as const;

const movingAverageColors: Record<(typeof movingAveragePeriods)[number], string> = {
  5: "#d18f00",
  10: "#7a4fd3",
  20: "#208a72",
  30: "#c45050",
  60: "#3c78c2"
};

type KLineViewProps = {
  code: string;
  name: string;
};

type KLineViewScale = (typeof kLineViews)[number]["key"];
type ChartResizeCorner = "nw" | "ne" | "sw" | "se";
type ChartFrameSize = { width?: number; height: number };

export function KLineView({ code, name }: KLineViewProps) {
  const [viewScale, setViewScale] = useState<KLineViewScale>("daily");
  const [points, setPoints] = useState<KLinePoint[]>([]);
  const [hoverIndex, setHoverIndex] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [chartFrameSize, setChartFrameSize] = useState<ChartFrameSize>({ height: DEFAULT_CHART_HEIGHT });

  const loadKLine = useCallback((force = false) => {
    setLoading(true);
    setHoverIndex(undefined);
    void api.fetchKLine(code, DAILY_SCALE, force)
      .then(setPoints)
      .finally(() => setLoading(false));
  }, [code]);

  useEffect(() => {
    loadKLine();
  }, [loadKLine]);

  const chartPoints = useMemo(() => aggregateKLinePoints(points, viewScale), [points, viewScale]);
  const chartFrameStyle = useMemo<CSSProperties>(() => ({
    height: `${chartFrameSize.height}px`,
    width: chartFrameSize.width ? `${chartFrameSize.width}px` : undefined
  }), [chartFrameSize]);

  const startChartResize = useCallback((corner: ChartResizeCorner, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const frame = event.currentTarget.closest(".kline-chart-frame") as HTMLElement | null;
    const rect = frame?.getBoundingClientRect();
    if (!frame || !rect) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = rect.width;
    const startHeight = rect.height;
    const maxWidth = Math.max(MIN_CHART_WIDTH, frame.parentElement?.clientWidth ?? startWidth);

    const resize = (moveEvent: PointerEvent) => {
      const xDelta = moveEvent.clientX - startX;
      const yDelta = moveEvent.clientY - startY;
      const width = startWidth + (corner.endsWith("e") ? xDelta : -xDelta);
      const height = startHeight + (corner.endsWith("s") ? yDelta : -yDelta);
      setChartFrameSize({
        width: clamp(Math.round(width), MIN_CHART_WIDTH, maxWidth),
        height: clamp(Math.round(height), MIN_CHART_HEIGHT, MAX_CHART_HEIGHT)
      });
    };

    const stop = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };

    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }, []);

  return (
    <main className="kline-view">
      <KLineQuotePanel points={chartPoints} hoverIndex={hoverIndex} />
      <header>
        <h1>
          {name} - {code}
        </h1>
        <div className="kline-header-actions">
          <div className="scale-tabs">
            {kLineViews.map((item) => (
              <button className={item.key === viewScale ? "active" : ""} key={item.key} onClick={() => { setViewScale(item.key); setHoverIndex(undefined); }}>
                {item.label}
              </button>
            ))}
          </div>
          <button className="tool-button compact-text" onClick={() => loadKLine(true)} disabled={loading} title="刷新K线" aria-label="刷新K线">
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
      </header>
      <section className="kline-body">
        <div className="kline-chart-frame" style={chartFrameStyle}>
          {loading ? <div className="loading">Loading...</div> : <EChartsCandles points={chartPoints} onHoverIndex={setHoverIndex} />}
          <ChartResizeHandle corner="nw" onResizeStart={startChartResize} />
          <ChartResizeHandle corner="ne" onResizeStart={startChartResize} />
          <ChartResizeHandle corner="sw" onResizeStart={startChartResize} />
          <ChartResizeHandle corner="se" onResizeStart={startChartResize} />
        </div>
      </section>
    </main>
  );
}

function ChartResizeHandle({ corner, onResizeStart }: { corner: ChartResizeCorner; onResizeStart: (corner: ChartResizeCorner, event: ReactPointerEvent<HTMLButtonElement>) => void }) {
  return (
    <button
      type="button"
      className={`kline-chart-resize-handle ${corner}`}
      onPointerDown={(event) => onResizeStart(corner, event)}
      aria-label="调整K线图大小"
      title="调整K线图大小"
    />
  );
}

function EChartsCandles({ points, onHoverIndex }: { points: KLinePoint[]; onHoverIndex: (index: number | undefined) => void }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);
  const onHoverIndexRef = useRef(onHoverIndex);
  const datesRef = useRef<string[]>([]);

  useEffect(() => {
    onHoverIndexRef.current = onHoverIndex;
  }, [onHoverIndex]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current, undefined, { renderer: "canvas" });
    instanceRef.current = chart;

    const selectPoint = (params: unknown) => {
      onHoverIndexRef.current(resolveKLineHoverIndex(params as KLineChartSelectParam, datesRef.current));
    };
    const clearPoint = () => onHoverIndexRef.current(undefined);

    chart.on("updateAxisPointer", selectPoint);
    chart.on("globalout", clearPoint);

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(chartRef.current);

    return () => {
      chart.off("updateAxisPointer", selectPoint);
      chart.off("globalout", clearPoint);
      resizeObserver.disconnect();
      chart.dispose();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = instanceRef.current;
    if (!chart) return;

    if (points.length === 0) {
      datesRef.current = [];
      chart.clear();
      return;
    }

    const dates = points.map((point) => point.day);
    datesRef.current = dates;
    const candleData = points.map((point) => [point.open, point.close, point.low, point.high]);
    const volumes = points.map((point, index) => [index, point.volume, point.close >= point.open ? 1 : -1]);
    const movingAverageSeries = movingAveragePeriods.map((period) => ({
      name: `MA${period}`,
      type: "line" as const,
      data: calculateMovingAverage(points, period),
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 1, color: movingAverageColors[period] },
      itemStyle: { color: movingAverageColors[period] },
      emphasis: { disabled: true }
    }));

    chart.setOption(
      {
        animation: false,
        backgroundColor: "#ffffff",
        textStyle: {
          color: "#3f3f3f",
          fontFamily: "\"Segoe UI\", system-ui, sans-serif",
          fontSize: 11
        },
        tooltip: {
          trigger: "axis",
          showContent: false,
          axisPointer: { type: "cross" },
          borderColor: "#d4d4d4",
          borderWidth: 1,
          backgroundColor: "rgba(255,255,255,0.96)",
          textStyle: { color: "#333333" }
        },
        legend: {
          top: 4,
          left: 54,
          itemWidth: 12,
          itemHeight: 2,
          textStyle: { color: "#4f4f4f", fontSize: 10 },
          data: ["Price", "MA5", "MA10", "MA20", "MA30", "MA60"]
        },
        axisPointer: {
          link: [{ xAxisIndex: "all" }]
        },
        grid: [
          { left: 54, right: 18, top: 28, height: "64%" },
          { left: 54, right: 18, bottom: 24, height: "14%" }
        ],
        xAxis: [
          {
            type: "category",
            data: dates,
            boundaryGap: true,
            axisLine: { lineStyle: { color: "#d4d4d4" } },
            axisTick: { show: false },
            axisLabel: { show: false },
            splitLine: { show: false }
          },
          {
            type: "category",
            gridIndex: 1,
            data: dates,
            boundaryGap: true,
            axisLine: { lineStyle: { color: "#d4d4d4" } },
            axisTick: { show: false },
            axisLabel: { color: "#6a6a6a", fontSize: 10 },
            splitLine: { show: false }
          }
        ],
        yAxis: [
          {
            scale: true,
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { color: "#6a6a6a", fontSize: 10 },
            splitLine: { lineStyle: { color: "#eeeeee" } }
          },
          {
            scale: true,
            gridIndex: 1,
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { show: false },
            splitLine: { show: false }
          }
        ],
        dataZoom: [
          { type: "inside", xAxisIndex: [0, 1], start: 55, end: 100 },
          {
            type: "slider",
            xAxisIndex: [0, 1],
            height: 14,
            bottom: 4,
            borderColor: "#d4d4d4",
            fillerColor: "rgba(32,32,32,0.12)",
            handleSize: 0,
            textStyle: { color: "#6a6a6a", fontSize: 10 }
          }
        ],
        series: [
          {
            name: "Price",
            type: "candlestick",
            data: candleData,
            itemStyle: {
              color: "#202020",
              color0: "#ffffff",
              borderColor: "#202020",
              borderColor0: "#6f6f6f"
            }
          },
          ...movingAverageSeries,
          {
            name: "Volume",
            type: "bar",
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: volumes,
            itemStyle: {
              color: (params: { data: [number, number, number] }) => (params.data[2] > 0 ? "rgba(38,38,38,0.58)" : "rgba(158,158,158,0.38)")
            }
          }
        ]
      },
      true
    );
  }, [points]);

  if (points.length === 0) return <div className="loading">No data</div>;
  return <div className="candles" ref={chartRef} role="img" aria-label="Candlestick chart" />;
}

function KLineQuotePanel({ points, hoverIndex }: { points: KLinePoint[]; hoverIndex: number | undefined }) {
  const index = hoverIndex === undefined ? points.length - 1 : hoverIndex;
  const point = points[index];
  if (!point) return <section className="kline-quote-panel muted">--</section>;

  const previous = index > 0 ? points[index - 1] : undefined;
  const change = previous ? point.close - previous.close : undefined;
  const changePercent = previous && previous.close > 0 && change !== undefined ? (change / previous.close) * 100 : undefined;
  const fields = [
    { label: "收", value: formatPrice(point.close) },
    { label: "涨", value: change === undefined ? "--" : formatSignedPlain(change, 2) },
    { label: "幅", value: changePercent === undefined ? "--" : `${formatSignedPlain(changePercent, 2)}%` },
    { label: "高", value: formatPrice(point.high) },
    { label: "开", value: formatPrice(point.open) },
    { label: "量", value: formatVolume(point.volume) },
    { label: "低", value: formatPrice(point.low) },
    { label: "换", value: "--" },
    { label: "额", value: "--" },
    { label: "日期", value: point.day },
    ...movingAveragePeriods.map((period) => ({
      label: `MA${period}`,
      value: formatPrice(calculateMovingAverageAt(points, period, index))
    }))
  ];

  return (
    <section className="kline-quote-panel" aria-label="K line quote">
      <Form className="kline-quote-form" layout="inline" size="small" colon={false} component="div">
        {fields.map((field) => (
          <KLineQuoteField key={field.label} label={field.label} value={field.value} />
        ))}
      </Form>
    </section>
  );
}

function KLineQuoteField({ label, value }: { label: string; value: string }) {
  return (
    <Form.Item className="kline-quote-field" label={label}>
      <Input readOnly value={value} />
    </Form.Item>
  );
}

function aggregateKLinePoints(points: KLinePoint[], scale: KLineViewScale): KLinePoint[] {
  if (scale === "daily") return points;
  if (scale === "five-day") return aggregateByChunk(points, 5);
  return aggregateByKey(points, (point) => scale === "weekly" ? weekKey(point.day) : monthKey(point.day));
}

function aggregateByChunk(points: KLinePoint[], size: number): KLinePoint[] {
  const result: KLinePoint[] = [];
  for (let index = 0; index < points.length; index += size) {
    result.push(mergeKLineGroup(points.slice(index, index + size)));
  }
  return result;
}

function aggregateByKey(points: KLinePoint[], keyOf: (point: KLinePoint) => string): KLinePoint[] {
  const result: KLinePoint[] = [];
  let group: KLinePoint[] = [];
  let currentKey = "";

  for (const point of points) {
    const key = keyOf(point);
    if (group.length > 0 && key !== currentKey) {
      result.push(mergeKLineGroup(group));
      group = [];
    }
    currentKey = key;
    group.push(point);
  }

  if (group.length > 0) result.push(mergeKLineGroup(group));
  return result;
}

function mergeKLineGroup(group: KLinePoint[]): KLinePoint {
  const first = group[0];
  const last = group[group.length - 1];
  return {
    day: last.day,
    open: first.open,
    high: Math.max(...group.map((point) => point.high)),
    low: Math.min(...group.map((point) => point.low)),
    close: last.close,
    volume: group.reduce((sum, point) => sum + point.volume, 0)
  };
}

function weekKey(value: string): string {
  const date = parseKLineDate(value);
  const monday = new Date(date);
  const day = monday.getDay() || 7;
  monday.setDate(monday.getDate() - day + 1);
  return dateKey(monday);
}

function monthKey(value: string): string {
  return value.slice(0, 7);
}

function parseKLineDate(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

function calculateMovingAverage(points: KLinePoint[], period: number): Array<number | "-"> {
  return points.map((_, index) => {
    if (index < period - 1) return "-";
    const total = points.slice(index - period + 1, index + 1).reduce((sum, point) => sum + point.close, 0);
    return Number((total / period).toFixed(3));
  });
}

function calculateMovingAverageAt(points: KLinePoint[], period: number, index: number): number | undefined {
  if (index < period - 1) return undefined;
  const total = points.slice(index - period + 1, index + 1).reduce((sum, point) => sum + point.close, 0);
  return Number((total / period).toFixed(3));
}

function formatPrice(value: number | undefined): string {
  return value === undefined ? "--" : formatMaybe(value, 3);
}

function formatVolume(value: number): string {
  if (value >= 100000000) return `${formatMaybe(value / 100000000, 2)}\u4ebf`;
  if (value >= 10000) return `${formatMaybe(value / 10000, 2)}\u4e07`;
  return Math.round(value).toLocaleString();
}

function formatSignedPlain(value: number, digits: number): string {
  return `${value > 0 ? "+" : ""}${formatMaybe(value, digits)}`;
}

type KLineChartSelectParam = {
  axesInfo?: Array<{ value?: number | string }>;
  axisValue?: number | string;
  dataIndex?: number;
  name?: string;
};

function resolveKLineHoverIndex(params: KLineChartSelectParam, labels: string[]): number | undefined {
  if (labels.length === 0) return undefined;
  if (typeof params.dataIndex === "number" && Number.isFinite(params.dataIndex)) return clamp(Math.round(params.dataIndex), 0, labels.length - 1);

  const axisValue = params.axesInfo?.find((info) => info.value !== undefined)?.value ?? params.axisValue ?? params.name;
  if (typeof axisValue === "number" && Number.isFinite(axisValue)) return clamp(Math.round(axisValue), 0, labels.length - 1);
  if (typeof axisValue === "string") {
    const numericValue = Number(axisValue);
    if (Number.isFinite(numericValue) && !labels.includes(axisValue)) return clamp(Math.round(numericValue), 0, labels.length - 1);
    const index = labels.indexOf(axisValue);
    return index >= 0 ? index : undefined;
  }

  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
