import * as echarts from "echarts";
import { useEffect, useRef, useState } from "react";
import type { KLinePoint, KLineScale } from "../../shared/types";
import { scaleLabel } from "../utils";

const api = window.finBox;

type KLineViewProps = {
  code: string;
  name: string;
};

export function KLineView({ code, name }: KLineViewProps) {
  const [scale, setScale] = useState<KLineScale>(240);
  const [points, setPoints] = useState<KLinePoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void api.fetchKLine(code, scale)
      .then(setPoints)
      .finally(() => setLoading(false));
  }, [code, scale]);

  return (
    <main className="kline-view">
      <header>
        <h1>
          {name} - {code}
        </h1>
        <div className="scale-tabs">
          {([1, 5, 15, 30, 60, 240] as KLineScale[]).map((item) => (
            <button className={item === scale ? "active" : ""} key={item} onClick={() => setScale(item)}>
              {scaleLabel(item)}
            </button>
          ))}
        </div>
      </header>
      {loading ? <div className="loading">Loading...</div> : <EChartsCandles points={points} />}
    </main>
  );
}

function EChartsCandles({ points }: { points: KLinePoint[] }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current, undefined, { renderer: "canvas" });
    instanceRef.current = chart;

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(chartRef.current);

    return () => {
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

    const dates = points.map((point) => point.day);
    const candleData = points.map((point) => [point.open, point.close, point.low, point.high]);
    const volumes = points.map((point, index) => [index, point.volume, point.close >= point.open ? 1 : -1]);

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
          axisPointer: { type: "cross" },
          borderColor: "#d4d4d4",
          borderWidth: 1,
          backgroundColor: "rgba(255,255,255,0.96)",
          textStyle: { color: "#333333" }
        },
        axisPointer: {
          link: [{ xAxisIndex: "all" }]
        },
        grid: [
          { left: 54, right: 18, top: 18, height: "68%" },
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
            fillerColor: "rgba(0,122,204,0.14)",
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
              color: "#d73a49",
              color0: "#22863a",
              borderColor: "#d73a49",
              borderColor0: "#22863a"
            }
          },
          {
            name: "Volume",
            type: "bar",
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: volumes,
            itemStyle: {
              color: (params: { data: [number, number, number] }) => (params.data[2] > 0 ? "rgba(215,58,73,0.42)" : "rgba(34,134,58,0.42)")
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
