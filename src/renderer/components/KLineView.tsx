import * as echarts from "echarts";
import { useEffect, useRef, useState } from "react";
import type { KLinePoint, KLineScale, StockJournal, StockJournalNote } from "../../shared/types";
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
  const [journal, setJournal] = useState<StockJournal>();
  const [journalLoading, setJournalLoading] = useState(true);
  const [journalError, setJournalError] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [selectedDate, setSelectedDate] = useState<string>();
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setJournalLoading(true);
    setJournalError("");
    setJournal(undefined);
    setNoteDraft("");
    setSelectedDate(undefined);
    void api.getStockJournal(code)
      .then((item) => {
        if (!cancelled) setJournal(item);
      })
      .catch((error) => {
        if (!cancelled) setJournalError(error instanceof Error ? error.message : "Failed to load journal.");
      })
      .finally(() => {
        if (!cancelled) setJournalLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    setLoading(true);
    void api.fetchKLine(code, scale)
      .then(setPoints)
      .finally(() => setLoading(false));
  }, [code, scale]);

  useEffect(() => {
    if (scale !== 240 || points.length === 0 || !journal?.followedAt) return;
    let cancelled = false;
    void api.archiveDailyKLine(code, points)
      .then((item) => {
        if (!cancelled) setJournal(item);
      })
      .catch((error) => {
        if (!cancelled) setJournalError(error instanceof Error ? error.message : "Failed to archive daily K line.");
      });

    return () => {
      cancelled = true;
    };
  }, [code, points, journal?.followedAt, scale]);

  const chartNotes = journal?.notes.filter((note) => note.date) ?? [];
  const selectedNote = selectedDate ? journal?.notes.find((note) => note.date === selectedDate) : undefined;
  const stockNote = journal?.notes.find((note) => !note.date);
  const archivedCount = journal?.dailyKLine.length ?? 0;

  const startJournal = async () => {
    setJournalError("");
    try {
      setJournal(await api.startStockJournal(code, todayDate()));
    } catch (error) {
      setJournalError(error instanceof Error ? error.message : "Failed to start tracking.");
    }
  };

  const saveNote = async (date?: string) => {
    const content = date ? noteDraft : window.prompt("Stock note", stockNote?.content ?? "")?.trim();
    if (content === undefined) return;
    setSavingNote(true);
    setJournalError("");
    try {
      setJournal(await api.saveStockJournalNote(code, {
        id: date ? `day-${date}` : "stock-note",
        date,
        content
      }));
      if (date) setNoteDraft(content);
    } catch (error) {
      setJournalError(error instanceof Error ? error.message : "Failed to save note.");
    } finally {
      setSavingNote(false);
    }
  };

  const selectChartDate = (date: string) => {
    setSelectedDate(date);
    setNoteDraft(journal?.notes.find((note) => note.date === date)?.content ?? "");
  };

  return (
    <main className="kline-view">
      <header>
        <h1>
          {name} - {code}
        </h1>
        <div className="kline-header-actions">
          {scale === 240 && !journalLoading && !journal?.followedAt && (
            <button className="tool-button accent compact-text" onClick={() => void startJournal()}>
              Start Tracking
            </button>
          )}
          <div className="scale-tabs">
            {([1, 5, 15, 30, 60, 240] as KLineScale[]).map((item) => (
              <button className={item === scale ? "active" : ""} key={item} onClick={() => setScale(item)}>
                {scaleLabel(item)}
              </button>
            ))}
          </div>
        </div>
      </header>
      <section className={`kline-body ${scale === 240 ? "" : "no-journal"}`}>
        {loading ? (
          <div className="loading">Loading...</div>
        ) : (
          <EChartsCandles points={points} journal={journal} notes={chartNotes} onSelectDate={selectChartDate} />
        )}
        {scale === 240 && (
          <JournalPanel
            journal={journal}
            stockNote={stockNote}
            selectedDate={selectedDate}
            selectedNote={selectedNote}
            noteDraft={noteDraft}
            archivedCount={archivedCount}
            loading={journalLoading}
            saving={savingNote}
            error={journalError}
            onStart={() => void startJournal()}
            onSaveStockNote={() => void saveNote()}
            onNoteDraft={setNoteDraft}
            onSaveDateNote={() => selectedDate ? void saveNote(selectedDate) : undefined}
          />
        )}
      </section>
    </main>
  );
}

function EChartsCandles({ points, journal, notes, onSelectDate }: { points: KLinePoint[]; journal?: StockJournal; notes: StockJournalNote[]; onSelectDate: (date: string) => void }) {
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
    const noteData = notes
      .map((note) => {
        const index = dates.indexOf(note.date ?? "");
        if (index === -1) return undefined;
        const point = points[index];
        return { value: [index, point.high], date: note.date, note };
      })
      .filter((item): item is { value: [number, number]; date: string; note: StockJournalNote } => item !== undefined && item.date !== undefined);

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
            markLine: journal?.followedAt && dates.includes(journal.followedAt) ? {
              symbol: "none",
              label: { formatter: "Follow", color: "#6a6a6a" },
              lineStyle: { color: "#d28721", type: "dashed" },
              data: [{ xAxis: journal.followedAt }]
            } : undefined,
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
          },
          {
            name: "Notes",
            type: "scatter",
            data: noteData,
            symbol: "pin",
            symbolSize: 22,
            itemStyle: { color: "#007acc" },
            tooltip: {
              formatter: (params: { data?: { note?: StockJournalNote } }) => escapeHtml(params.data?.note?.content ?? "")
            }
          }
        ]
      },
      true
    );
  }, [journal?.followedAt, notes, points]);

  useEffect(() => {
    const chart = instanceRef.current;
    if (!chart) return;
    const handleClick = (params: { componentType?: string; dataIndex?: number; data?: { date?: string } }) => {
      if (params.componentType !== "series" || params.dataIndex === undefined) return;
      if (params.data?.date) {
        onSelectDate(params.data.date);
        return;
      }
      const point = points[params.dataIndex];
      if (point) onSelectDate(point.day);
    };
    chart.on("click", handleClick);
    return () => {
      chart.off("click", handleClick);
    };
  }, [onSelectDate, points]);

  if (points.length === 0) return <div className="loading">No data</div>;
  return <div className="candles" ref={chartRef} role="img" aria-label="Candlestick chart" />;
}

function JournalPanel({
  journal,
  stockNote,
  selectedDate,
  selectedNote,
  noteDraft,
  archivedCount,
  loading,
  saving,
  error,
  onStart,
  onSaveStockNote,
  onNoteDraft,
  onSaveDateNote
}: {
  journal?: StockJournal;
  stockNote?: StockJournalNote;
  selectedDate?: string;
  selectedNote?: StockJournalNote;
  noteDraft: string;
  archivedCount: number;
  loading: boolean;
  saving: boolean;
  error: string;
  onStart: () => void;
  onSaveStockNote: () => void;
  onNoteDraft: (value: string) => void;
  onSaveDateNote: () => void;
}) {
  return (
    <aside className="journal-panel">
      <div className="journal-title">
        <span>Journal</span>
        {journal?.followedAt && <small>Since {journal.followedAt}</small>}
      </div>
      {loading ? <div className="journal-state">Loading...</div> : (
        <>
          {!journal?.followedAt && (
            <div className="journal-empty">
              <span>Not tracking yet</span>
              <button className="tool-button accent compact-text" onClick={onStart}>Start Tracking</button>
            </div>
          )}
          <div className="journal-meta">
            <span>{archivedCount} daily bars archived</span>
            <button className="tool-button compact-text" onClick={onSaveStockNote}>Stock Note</button>
          </div>
          {stockNote && <div className="journal-stock-note">{stockNote.content}</div>}
          <div className="journal-date-title">{selectedDate ? `K note ${selectedDate}` : "Click a daily candle"}</div>
          <textarea
            value={noteDraft}
            onChange={(event) => onNoteDraft(event.target.value)}
            disabled={!selectedDate || !journal?.followedAt}
            placeholder={journal?.followedAt ? "Record your thought for this K-line date" : "Start tracking first"}
          />
          <div className="journal-actions">
            {selectedNote && <span>Saved {new Date(selectedNote.updatedAt).toLocaleString()}</span>}
            <button className="tool-button accent compact-text" onClick={onSaveDateNote} disabled={!selectedDate || saving || !journal?.followedAt}>{saving ? "Saving..." : "Save"}</button>
          </div>
        </>
      )}
      {error && <div className="save-error journal-error">{error}</div>}
    </aside>
  );
}

function todayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
