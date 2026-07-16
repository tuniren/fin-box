import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { dayProfit, displayName, effectivePrice, totalShares } from "../../shared/finance";
import { currentTheme, profitColor } from "../../shared/theme";
import type { AppState, MottoConfig, StockStatus, Theme, WatchFloatColumn, WatchFloatStyle } from "../../shared/types";
import { useI18n } from "../i18n";
import { formatMaybe, formatSigned, stockPercent, themeStyle } from "../utils";
import { TickerSummary } from "./TickerSummary";

const api = window.finBox;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
let textMeasureCanvas: HTMLCanvasElement | undefined;

const defaultMotto: MottoConfig = {
  text: "\u51b7\u9759\uff0c\u8010\u5fc3\uff0c\u53ea\u505a\u770b\u5f97\u61c2\u7684\u51b3\u5b9a\u3002",
  font_family: "Microsoft YaHei",
  font_size: 14,
  color: "#f8fafc"
};

function useFloatAppState() {
  const [state, setState] = useState<AppState>();

  useEffect(() => {
    let cancelled = false;
    void api.getState().then((nextState) => {
      if (!cancelled) setState(nextState);
    });
    const unsubscribe = api.onState(setState);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return state;
}

function useVisibleStocks(state?: AppState) {
  return useMemo(() => {
    if (!state) return [];
    return state.stocks.filter((stock) => !state.config.hide_zero_shares || totalShares(stock) !== 0);
  }, [state]);
}

function hasHoldTag(stock: StockStatus) {
  return stock.config.tags.some((tag) => tag.trim().toLowerCase() === "hold");
}

function useHoldStocks(stocks: StockStatus[]) {
  return useMemo(() => stocks.filter(hasHoldTag), [stocks]);
}

export function CamouflageFloatView() {
  const state = useFloatAppState();
  const visibleStocks = useVisibleStocks(state);
  const holdStocks = useHoldStocks(visibleStocks);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [, setNow] = useState(Date.now());
  const shellRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const offCycle = api.onCycleStock(() => {
      setSelectedIndex((index) => {
        if (!holdStocks.length) return index;
        const currentCode = visibleStocks[index]?.config.code;
        const holdIndex = holdStocks.findIndex((stock) => stock.config.code === currentCode);
        const nextHold = holdStocks[holdIndex === -1 ? 0 : (holdIndex + 1) % holdStocks.length];
        return Math.max(0, visibleStocks.findIndex((stock) => stock.config.code === nextHold.config.code));
      });
    });
    return () => {
      offCycle();
    };
  }, [holdStocks, visibleStocks]);

  useEffect(() => {
    if (selectedIndex >= visibleStocks.length) setSelectedIndex(0);
  }, [selectedIndex, visibleStocks.length]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || !state) return;
    const rect = shell.getBoundingClientRect();
    void api.resizeWindow(Math.ceil(rect.width), Math.ceil(rect.height));
  }, [state, selectedIndex, visibleStocks.length]);

  const theme = state ? currentTheme(state.config) : undefined;
  const selectedStock = visibleStocks[selectedIndex];

  return (
    <main ref={shellRef} className="ticker-shell drag-region" style={themeStyle(theme)}>
      {state && selectedStock ? <TickerSummary state={state} stock={selectedStock} compactRefreshBars /> : <span className="muted">No symbols</span>}
    </main>
  );
}

export function WatchlistFloatView() {
  const { t } = useI18n();
  const state = useFloatAppState();
  const shellRef = useRef<HTMLElement>(null);
  const lastSizeRef = useRef<{ width: number; height: number } | undefined>(undefined);
  const visibleStocks = useVisibleStocks(state);
  const watchFloatConfig = state?.config.watch_float;
  const floatStocks = useMemo(() => {
    const configuredCodes = watchFloatConfig?.stock_codes ?? [];
    const byCode = new Map(visibleStocks.map((stock) => [stock.config.code.toLowerCase(), stock]));
    return configuredCodes
      .map((code) => byCode.get(code.toLowerCase()))
      .filter((stock): stock is StockStatus => Boolean(stock));
  }, [visibleStocks, watchFloatConfig?.stock_codes]);
  const [selectedCode, setSelectedCode] = useState<string>();
  const theme = state ? currentTheme(state.config) : undefined;
  const shellStyle = watchFloatShellStyle(theme, watchFloatConfig?.style);

  useEffect(() => {
    if (!floatStocks.length) {
      setSelectedCode(undefined);
      return;
    }
    if (!selectedCode || !floatStocks.some((stock) => stock.config.code === selectedCode)) {
      setSelectedCode(floatStocks[0].config.code);
    }
  }, [floatStocks, selectedCode]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || !watchFloatConfig) return;

    const resizeToContent = () => {
      const size = measureWatchFloatContent(shell, watchFloatConfig.layout);
      const width = Math.min(size.width, Math.floor(window.screen.availWidth));
      const height = Math.min(size.height, Math.floor(window.screen.availHeight));
      if (lastSizeRef.current?.width === width && lastSizeRef.current.height === height) return;
      lastSizeRef.current = { width, height };
      void api.resizeWindow(width, height);
    };

    const frame = window.requestAnimationFrame(resizeToContent);
    return () => window.cancelAnimationFrame(frame);
  }, [floatStocks, state?.config.watch_float.columns, watchFloatConfig?.layout, watchFloatConfig?.style]);

  return (
    <main className="watch-float-shell drag-region" style={shellStyle} ref={shellRef}>
      <div className="watch-float-body">
        {state && !floatStocks.length ? (
          <div className="watch-float-empty watch-float-empty-action">
            <span>{t("float.addWatchlistSymbols")}</span>
            <button type="button" className="no-drag" onClick={() => void api.openWatchlistFloatSettings()}>
              {t("float.openWatchlistSettings")}
            </button>
          </div>
        ) : state ? (
          <WatchFloatStockList
            stocks={floatStocks}
            selectedCode={selectedCode}
            theme={currentTheme(state.config)}
            columns={state.config.watch_float.columns}
            layout={state.config.watch_float.layout}
            style={state.config.watch_float.style}
          />
        ) : (
          <span className="muted">Loading...</span>
        )}
      </div>
    </main>
  );
}

function WatchFloatStockList({
  stocks,
  selectedCode,
  theme,
  columns,
  layout,
  style
}: {
  stocks: StockStatus[];
  selectedCode?: string;
  theme: Theme;
  columns: WatchFloatColumn[];
  layout: AppState["config"]["watch_float"]["layout"];
  style: WatchFloatStyle;
}) {
  const safeColumns: WatchFloatColumn[] = columns.length ? columns : ["name", "change"];
  const listStyle = layout === "horizontal"
    ? ({ "--watch-float-columns": watchFloatHorizontalGridColumns(stocks.length, safeColumns) } as CSSProperties)
    : ({
        "--watch-float-columns": watchFloatGridColumns(safeColumns)
      } as CSSProperties);

  if (!stocks.length) return <div className="watch-float-empty">No symbols</div>;

  if (layout === "horizontal") {
    return (
      <div className="watch-float-list horizontal" style={listStyle}>
        <div className="watch-float-row horizontal">
        {stocks.flatMap((stock) => safeColumns.map((column) => (
          <WatchFloatCell column={column} stock={stock} theme={theme} styleConfig={style} key={`${stock.config.code}:${column}`} />
        )))}
      </div>
      </div>
    );
  }

  const renderRows = (suffix: string) => stocks.map((stock) => (
    <div
      className={`watch-float-row ${stock.config.code === selectedCode ? "active" : ""}`}
      key={`${suffix}:${stock.config.code}`}
      aria-hidden={suffix === "copy"}
    >
      {safeColumns.map((column) => (
        <WatchFloatCell column={column} stock={stock} theme={theme} styleConfig={style} key={column} />
      ))}
    </div>
  ));

  return (
    <div className="watch-float-list" style={listStyle}>
      {renderRows("main")}
    </div>
  );
}

function WatchFloatCell({ column, stock, theme, styleConfig }: { column: WatchFloatColumn; stock: StockStatus; theme: Theme; styleConfig: WatchFloatStyle }) {
  const color = styleConfig.column_colors[column];
  if (column === "name") return <span className="watch-float-cell stock-name" style={{ color }}>{displayName(stock)}</span>;
  if (column === "price") return <span className="watch-float-cell stock-price" style={{ color }}>{formatMaybe(effectivePrice(stock.market), 2)}</span>;
  if (column === "day_profit") return <span className="watch-float-cell"><SignedMetric value={dayProfit(stock)} digits={0} theme={theme} colors={styleConfig.metric_colors.day_profit} /></span>;
  return <span className="watch-float-cell"><SignedMetric value={stockPercent(stock)} digits={2} theme={theme} colors={styleConfig.metric_colors.change} /></span>;
}

function watchFloatGridColumns(columns: WatchFloatColumn[]): string {
  return columns.map((column) => column === "name" ? "minmax(42px, 1fr)" : "max-content").join(" ");
}

function watchFloatHorizontalGridColumns(stockCount: number, columns: WatchFloatColumn[]): string {
  const stockColumns = columns.map(() => "max-content").join(" ");
  return Array.from({ length: stockCount }, () => stockColumns).join(" ");
}

function measureWatchFloatContent(shell: HTMLElement, layout: AppState["config"]["watch_float"]["layout"]): { width: number; height: number } {
  const body = shell.querySelector<HTMLElement>(".watch-float-body");
  if (layout === "horizontal") {
    const row = shell.querySelector<HTMLElement>(".watch-float-row.horizontal");
    if (!row) return { width: 160, height: 42 };
    return {
      width: Math.max(64, Math.ceil(row.scrollWidth + horizontalPadding(shell) + 2)),
      height: Math.max(32, Math.ceil(row.getBoundingClientRect().height + verticalPadding(body) + 2))
    };
  }

  const rows = [...shell.querySelectorAll<HTMLElement>(".watch-float-row:not(.horizontal)")];
  if (!rows.length) {
    const empty = shell.querySelector<HTMLElement>(".watch-float-empty");
    const rect = empty?.getBoundingClientRect();
    return {
      width: Math.max(128, Math.ceil(rect?.width ?? 128) + horizontalPadding(shell) + 2),
      height: Math.max(48, Math.ceil(rect?.height ?? 48) + verticalPadding(body) + 2)
    };
  }

  const width = rows.reduce((maxWidth, row) => {
    const cells = [...row.querySelectorAll<HTMLElement>(".watch-float-cell")];
    const gap = Number.parseFloat(window.getComputedStyle(row).columnGap) || 0;
    const contentWidth = cells.reduce((sum, cell) => sum + Math.ceil(measureElementTextWidth(cell)), 0) + Math.max(0, cells.length - 1) * gap;
    return Math.max(maxWidth, contentWidth + horizontalPadding(row));
  }, 0);
  const height = rows.reduce((sum, row) => sum + Math.ceil(row.getBoundingClientRect().height), 0);
  return {
    width: Math.max(96, Math.ceil(width + horizontalPadding(shell) + 2)),
    height: Math.max(32, Math.ceil(height + verticalPadding(body) + 2))
  };
}

function horizontalPadding(element: HTMLElement | null): number {
  if (!element) return 0;
  const style = window.getComputedStyle(element);
  return (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
}

function verticalPadding(element: HTMLElement | null): number {
  if (!element) return 0;
  const style = window.getComputedStyle(element);
  return (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
}

function measureElementTextWidth(element: HTMLElement): number {
  const style = window.getComputedStyle(element);
  const canvas = textMeasureCanvas ?? document.createElement("canvas");
  textMeasureCanvas = canvas;
  const context = canvas.getContext("2d");
  if (!context) return element.scrollWidth;
  context.font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;
  return context.measureText(element.textContent ?? "").width;
}

function watchFloatShellStyle(theme: Theme | undefined, style: WatchFloatStyle | undefined): CSSProperties | undefined {
  const base = themeStyle(theme) ?? {};
  if (!style) return base;
  const backgroundColor = rgbaFromHex(style.background_color, style.background_opacity);
  return {
    ...base,
    color: style.text_color,
    fontFamily: style.font_family,
    fontSize: `${style.font_size}px`,
    backgroundColor,
    border: style.show_border ? `1px solid ${style.border_color}` : "1px solid transparent"
  };
}

function rgbaFromHex(hex: string, opacity: number) {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#ffffff";
  const alpha = Math.min(Math.max(opacity, 0), 1);
  const red = parseInt(normalized.slice(1, 3), 16);
  const green = parseInt(normalized.slice(3, 5), 16);
  const blue = parseInt(normalized.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function MottoFloatView() {
  const state = useFloatAppState();
  const shellRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  const startMottoResize = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = window.innerWidth;
    const startHeight = window.innerHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const width = clamp(startWidth + moveEvent.clientX - startX, 120, 720);
      const height = clamp(startHeight + moveEvent.clientY - startY, 42, 420);
      void api.resizeWindow(width, height);
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const motto = state?.config.motto ?? defaultMotto;

  useEffect(() => {
    const shell = shellRef.current;
    const text = textRef.current;
    if (!shell || !text) return;

    const width = clamp(Math.ceil(text.scrollWidth + 36), 120, 520);
    const height = clamp(Math.ceil(text.scrollHeight + 22), 42, 260);
    void api.resizeWindow(width, height);
  }, [motto.text, motto.font_family, motto.font_size, motto.color]);

  return (
    <main className="motto-window drag-region" ref={shellRef}>
      <button className="motto-close no-drag" onClick={() => void api.closeWindow()} aria-label="Close motto window" title="Close">
        <X size={13} />
      </button>
      <div
        className="motto-text"
        ref={textRef}
        style={{ color: motto.color, fontFamily: motto.font_family, fontSize: `${motto.font_size}px` }}
      >
        {motto.text}
      </div>
      <button className="motto-resize-handle no-drag" onMouseDown={startMottoResize} aria-label="Resize motto window" title="Resize" />
    </main>
  );
}

function SignedMetric({
  value,
  digits,
  suffix = "",
  theme,
  colors
}: {
  value: number | undefined;
  digits: number;
  suffix?: string;
  theme: Pick<Theme, "color_up" | "color_down">;
  colors?: { up: string; down: string };
}) {
  if (value === undefined) return <span className="muted">--</span>;
  return <span style={{ color: colors ? (value >= 0 ? colors.up : colors.down) : profitColor(theme, value) }}>{formatSigned(value, digits)}{suffix}</span>;
}
