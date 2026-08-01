import { Eye } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { dayProfit, displayName, effectivePrice, totalShares } from "../../shared/finance";
import { currentTheme, profitColor } from "../../shared/theme";
import type { AppState, StockNewsItem, StockStatus, Theme, WatchFloatColumn, WatchFloatConfig, WatchFloatStyle } from "../../shared/types";
import { useI18n } from "../i18n";
import { formatMaybe, formatSigned, stockPercent, themeStyle } from "../utils";
import { useFloatAppState, useVisibleStocks } from "./FloatingWindows";

const api = window.finBox;
const watchFloatWindowGutter = 4;
const watchFloatNewsPollMs = 10000;
const watchFloatNewsCatchupPageLimit = 5;
const watchFloatNewsPlaybackMs = 2500;
const watchFloatNewsSeenLimit = 200;
const watchFloatVerticalNewsWidth = 220;
let textMeasureCanvas: HTMLCanvasElement | undefined;

export function WatchlistFloatView() {
  const { t } = useI18n();
  const state = useFloatAppState();
  const shellRef = useRef<HTMLElement>(null);
  const lastSizeRef = useRef<{ width: number; height: number } | undefined>(undefined);
  const initializedHorizontalWidthRef = useRef(false);
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
  const showNews = Boolean(watchFloatConfig?.show_news);

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
      if (watchFloatConfig.layout === "horizontal") {
        if (!initializedHorizontalWidthRef.current) {
          initializedHorizontalWidthRef.current = true;
          lastSizeRef.current = { width, height };
          void api.resizeWindow(width, height);
          return;
        }
        if (lastSizeRef.current?.height === height) return;
        lastSizeRef.current = { width: window.innerWidth, height };
        void api.resizeWindowHeight(height);
        return;
      }
      initializedHorizontalWidthRef.current = false;
      if (lastSizeRef.current?.width === width && lastSizeRef.current.height === height) return;
      lastSizeRef.current = { width, height };
      void api.resizeWindow(width, height);
    };

    const frame = window.requestAnimationFrame(resizeToContent);
    const observer = new ResizeObserver(resizeToContent);
    observer.observe(shell);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [floatStocks, state?.config.watch_float.columns, showNews, watchFloatConfig?.layout, watchFloatConfig?.style]);

  return (
    <main className="watch-float-shell" style={shellStyle} ref={shellRef}>
      <div className="watch-float-body drag-region">
        {state && !floatStocks.length && !showNews ? (
          <div className="watch-float-empty watch-float-empty-action">
            <span>{t("float.addWatchlistSymbols")}</span>
            <button type="button" className="no-drag" onClick={() => void api.openWatchlistFloatSettings()}>
              {t("float.openWatchlistSettings")}
            </button>
          </div>
        ) : state ? (
          <WatchFloatContent
            stocks={floatStocks}
            selectedCode={selectedCode}
            theme={currentTheme(state.config)}
            config={state.config.watch_float}
          />
        ) : (
          <span className="muted">Loading...</span>
        )}
      </div>
    </main>
  );
}

function WatchFloatContent({
  stocks,
  selectedCode,
  theme,
  config
}: {
  stocks: StockStatus[];
  selectedCode?: string;
  theme: Theme;
  config: WatchFloatConfig;
}) {
  return (
    <div className={`watch-float-content ${config.layout} ${config.show_news ? "with-news" : ""}`}>
      <WatchFloatStockList
        stocks={stocks}
        selectedCode={selectedCode}
        theme={theme}
        columns={config.columns}
        layout={config.layout}
        style={config.style}
      />
      {config.show_news && <WatchFloatNewsItem layout={config.layout} />}
    </div>
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
    ? ({ "--watch-float-columns": watchFloatHorizontalGridColumns(safeColumns) } as CSSProperties)
    : ({
        "--watch-float-columns": watchFloatGridColumns(safeColumns)
      } as CSSProperties);

  if (!stocks.length) return <div className="watch-float-empty">No symbols</div>;

  if (layout === "horizontal") {
    return (
      <div className="watch-float-list horizontal" style={listStyle}>
        {stocks.map((stock) => (
          <div className="watch-float-row horizontal" key={stock.config.code}>
            {safeColumns.map((column) => (
              <WatchFloatCell column={column} stock={stock} theme={theme} styleConfig={style} key={`${stock.config.code}:${column}`} />
            ))}
          </div>
        ))}
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

function WatchFloatNewsItem({ layout }: { layout: WatchFloatConfig["layout"] }) {
  const { t } = useI18n();
  const [item, setItem] = useState<StockNewsItem>();
  const [queue, setQueue] = useState<StockNewsItem[]>([]);
  const [error, setError] = useState("");
  const seenNewsIdsRef = useRef<Set<string>>(new Set());
  const seenNewsOrderRef = useRef<string[]>([]);

  const markNewsSeen = (newsItem: StockNewsItem) => {
    if (seenNewsIdsRef.current.has(newsItem.id)) return;
    seenNewsIdsRef.current.add(newsItem.id);
    seenNewsOrderRef.current.push(newsItem.id);
    while (seenNewsOrderRef.current.length > watchFloatNewsSeenLimit) {
      const expiredId = seenNewsOrderRef.current.shift();
      if (expiredId) seenNewsIdsRef.current.delete(expiredId);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const loadLatest = async () => {
      try {
        const freshItems: StockNewsItem[] = [];
        let reachedSeenItem = false;

        for (let pageIndex = 1; pageIndex <= watchFloatNewsCatchupPageLimit && !reachedSeenItem; pageIndex += 1) {
          const page = await api.fetchStockNews("", pageIndex);
          if (cancelled) return;

          for (const newsItem of page.items) {
            if (!newsItem?.id || !newsItem.title) continue;
            if (seenNewsIdsRef.current.has(newsItem.id)) {
              reachedSeenItem = true;
              break;
            }
            freshItems.push(newsItem);
          }

          if (!page.hasMore || page.items.length === 0) break;
        }

        freshItems.forEach(markNewsSeen);
        if (freshItems.length) {
          setQueue((current) => [...current, ...freshItems]);
          setError("");
        }
      } catch {
        if (!cancelled) setError(t("error.loadNewsFailed"));
      }
    };

    void loadLatest();
    const timer = window.setInterval(loadLatest, watchFloatNewsPollMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [t]);

  useEffect(() => {
    if (!queue.length) return;
    const timer = window.setTimeout(() => {
      setQueue((current) => {
        const [nextItem, ...remainingItems] = current;
        if (nextItem) setItem(nextItem);
        return remainingItems;
      });
    }, item ? watchFloatNewsPlaybackMs : 0);
    return () => window.clearTimeout(timer);
  }, [item, queue.length]);

  const openDetail = async () => {
    if (!item) return;
    setError("");
    try {
      await api.openExternalUrl(item.url);
    } catch {
      setError(t("error.loadNewsFailed"));
    }
  };

  return (
    <section className={`watch-float-news ${layout}`}>
      <div className="watch-float-news-row">
        <div className="watch-float-news-main">
          <span className="watch-float-news-title">{item?.title ?? (error || t("news.noNews"))}</span>
        </div>
        {queue.length > 0 && <span className="watch-float-news-count">{queue.length}</span>}
        {item && (
          <button className="watch-float-news-action no-drag" type="button" onClick={openDetail} title={t("float.openNewsDetail")} aria-label={t("float.openNewsDetail")}>
            <Eye size={13} />
          </button>
        )}
      </div>
    </section>
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

function watchFloatHorizontalGridColumns(columns: WatchFloatColumn[]): string {
  return columns.map((column) => column === "name" ? "max-content" : "max-content").join(" ");
}

function measureWatchFloatContent(shell: HTMLElement, layout: AppState["config"]["watch_float"]["layout"]): { width: number; height: number } {
  const body = shell.querySelector<HTMLElement>(".watch-float-body");
  const extraWidth = horizontalPadding(shell) + horizontalPadding(body) + horizontalBorder(shell) + watchFloatWindowGutter;
  const extraHeight = verticalPadding(body) + verticalBorder(shell) + watchFloatWindowGutter;
  if (layout === "horizontal") {
    const content = shell.querySelector<HTMLElement>(".watch-float-content.horizontal");
    const row = shell.querySelector<HTMLElement>(".watch-float-row.horizontal");
    const target = content ?? row;
    if (!target) return { width: Math.max(160, window.innerWidth), height: 42 };
    return {
      width: Math.max(160, Math.ceil(measureWatchFloatHorizontalPreferredWidth(shell) + extraWidth)),
      height: Math.max(32, Math.ceil(Math.max(target.scrollHeight, target.getBoundingClientRect().height) + extraHeight))
    };
  }

  const content = shell.querySelector<HTMLElement>(".watch-float-content.with-news");
  if (content) {
    const rect = content.getBoundingClientRect();
    if (layout === "vertical") {
      const stockWidth = measureWatchFloatStockRowsWidth(shell);
      return {
        width: Math.max(160, Math.ceil(Math.max(stockWidth, watchFloatVerticalNewsWidth) + extraWidth)),
        height: Math.max(42, Math.ceil(Math.max(content.scrollHeight, rect.height) + extraHeight))
      };
    }
    return {
      width: Math.max(160, Math.ceil(rect.width + extraWidth)),
      height: Math.max(42, Math.ceil(Math.max(content.scrollHeight, rect.height) + extraHeight))
    };
  }

  const rows = [...shell.querySelectorAll<HTMLElement>(".watch-float-row:not(.horizontal)")];
  if (!rows.length) {
    const empty = shell.querySelector<HTMLElement>(".watch-float-empty");
    const rect = empty?.getBoundingClientRect();
    return {
      width: Math.max(128, Math.ceil(rect?.width ?? 128) + extraWidth),
      height: Math.max(48, Math.ceil(rect?.height ?? 48) + extraHeight)
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
    width: Math.max(96, Math.ceil(width + extraWidth)),
    height: Math.max(32, Math.ceil(height + extraHeight))
  };
}

function measureWatchFloatStockRowsWidth(shell: HTMLElement): number {
  const rows = [...shell.querySelectorAll<HTMLElement>(".watch-float-row:not(.horizontal)")];
  if (!rows.length) return 160;
  return rows.reduce((maxWidth, row) => {
    const cells = [...row.querySelectorAll<HTMLElement>(".watch-float-cell")];
    const gap = Number.parseFloat(window.getComputedStyle(row).columnGap) || 0;
    const contentWidth = cells.reduce((sum, cell) => sum + Math.ceil(measureElementTextWidth(cell)), 0) + Math.max(0, cells.length - 1) * gap;
    return Math.max(maxWidth, contentWidth + horizontalPadding(row));
  }, 0);
}

function measureWatchFloatHorizontalPreferredWidth(shell: HTMLElement): number {
  const rows = [...shell.querySelectorAll<HTMLElement>(".watch-float-row.horizontal")];
  const stockWidth = rows.reduce((sum, row) => sum + Math.ceil(row.getBoundingClientRect().width), 0);
  const rowGaps = Math.max(0, rows.length - 1) * 4;
  const news = shell.querySelector<HTMLElement>(".watch-float-news.horizontal");
  const newsWidth = news ? Math.ceil(news.getBoundingClientRect().width) : 0;
  return Math.min(Math.max(stockWidth + rowGaps + newsWidth, 180), Math.floor(window.screen.availWidth * 0.8));
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

function horizontalBorder(element: HTMLElement | null): number {
  if (!element) return 0;
  const style = window.getComputedStyle(element);
  return (Number.parseFloat(style.borderLeftWidth) || 0) + (Number.parseFloat(style.borderRightWidth) || 0);
}

function verticalBorder(element: HTMLElement | null): number {
  if (!element) return 0;
  const style = window.getComputedStyle(element);
  return (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0);
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
    backgroundColor: "transparent",
    border: 0,
    "--watch-float-background": backgroundColor,
    "--watch-float-border-color": style.show_border ? style.border_color : "transparent"
  } as CSSProperties;
}

function rgbaFromHex(hex: string, opacity: number) {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#ffffff";
  const alpha = Math.min(Math.max(opacity, 0), 1);
  const red = parseInt(normalized.slice(1, 3), 16);
  const green = parseInt(normalized.slice(3, 5), 16);
  const blue = parseInt(normalized.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
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
