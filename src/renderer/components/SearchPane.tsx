import { ArrowLeft, Search, X } from "lucide-react";
import type { StockSearchResult } from "../../shared/types";

type SearchPaneProps = {
  query: string;
  results: StockSearchResult[];
  onQuery: (value: string) => void;
  onClose: () => void;
  onAdd: (stock: StockSearchResult) => void;
};

export function SearchPane({ query, results, onQuery, onClose, onAdd }: SearchPaneProps) {
  return (
    <section className="search-pane no-drag">
      <div className="search-title">
        <button className="icon-button" onClick={onClose} aria-label="Back">
          <ArrowLeft size={14} />
        </button>
        <div className="search-box">
          <Search size={14} />
          <input autoFocus value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Code, name, or pinyin" />
          {query && (
            <button className="clear-button" onClick={() => onQuery("")} aria-label="Clear">
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      <div className="search-results">
        {results.length === 0 ? (
          <div className="empty">No results</div>
        ) : (
          results.map((stock) => (
            <button key={`${stock.code}-${stock.name}`} onClick={() => onAdd(stock)}>
              <span>{stock.code}</span>
              <span>{stock.name}</span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
