import { RefreshCw } from "lucide-react";
import type { AppState, StockStatus } from "../../shared/types";
import { TickerSummary } from "./TickerSummary";

type TickerTopBarProps = {
  state?: AppState;
  selectedStock?: StockStatus;
  onToggleExpanded: () => void;
  onRefresh: () => void;
};

export function TickerTopBar({ state, selectedStock, onToggleExpanded, onRefresh }: TickerTopBarProps) {
  return (
    <div className="top-row">
      <button className="hot-zone no-drag" onClick={onToggleExpanded} aria-label="Toggle expanded" />
      <div className="summary">
        {state && selectedStock ? <TickerSummary state={state} stock={selectedStock} /> : <span className="muted">No symbols</span>}
      </div>
      <button className="icon-button no-drag" onClick={onRefresh} aria-label="Refresh">
        <RefreshCw size={14} />
      </button>
    </div>
  );
}
