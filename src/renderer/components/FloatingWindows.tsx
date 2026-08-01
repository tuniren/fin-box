import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { totalShares } from "../../shared/finance";
import { currentTheme } from "../../shared/theme";
import type { AppState, MottoConfig, StockStatus } from "../../shared/types";
import { themeStyle } from "../utils";
import { TickerSummary } from "./TickerSummary";

const api = window.finBox;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const defaultMotto: MottoConfig = {
  text: "\u51b7\u9759\uff0c\u8010\u5fc3\uff0c\u53ea\u505a\u770b\u5f97\u61c2\u7684\u51b3\u5b9a\u3002",
  font_family: "Microsoft YaHei",
  font_size: 14,
  color: "#f8fafc"
};

export function useFloatAppState() {
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

export function useVisibleStocks(state?: AppState) {
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

export { WatchlistFloatView } from "./WatchlistFloatWindow";

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
