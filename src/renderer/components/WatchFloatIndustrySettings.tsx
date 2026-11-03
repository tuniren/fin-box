import { useState } from "react";
import { selectedIndustry } from "../../shared/sector";
import { displayName } from "../../shared/finance";
import type { IndustryPatch, StockStatus, WatchFloatConfig } from "../../shared/types";
import { useI18n } from "../i18n";

/** Configuration only: opening this panel must never query membership or subscribe to quotes. */
export function WatchFloatIndustrySettings({ stocks, config, onConfigChange }: {
  stocks: StockStatus[];
  config: WatchFloatConfig;
  onConfigChange: (patch: Partial<WatchFloatConfig>) => void;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const update = async (code: string, patch: IndustryPatch) => {
    setError("");
    setSaving((current) => new Set(current).add(code));
    try { await window.finBox.updateStockIndustry(code, patch); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving((current) => { const next = new Set(current); next.delete(code); return next; }); }
  };
  return <div className="watch-float-settings-block watch-float-industry-settings">
    <span className="watch-float-settings-label">{t("sector.title")}</span>
    <label className="settings-check-row">
      <input type="checkbox" checked={config.show_industry !== false}
        onChange={(event) => onConfigChange({ show_industry: event.target.checked })} />
      <span>{t("sector.watchFloatShow")}</span>
    </label>
    <div className="industry-hint muted">{t("sector.watchFloatHint")}</div>
    {!stocks.length && <span className="muted">{t("settings.noWatchlistSymbols")}</span>}
    <div className="watch-float-industry-rows">
      {stocks.map((stock) => {
        const code = stock.config.code;
        const industry = stock.config.industry;
        const sector = selectedIndustry(stock.config);
        const busy = saving.has(code);
        return <div className="watch-float-industry-row" key={code}>
          <span className="watch-float-industry-stock">{displayName(stock)} <small className="muted">{code}</small></span>
          <label className="settings-check-row compact">
            <input type="checkbox" checked={industry?.show_in_float ?? false} disabled={busy || !industry?.sectors.length}
              aria-label={`${displayName(stock)} ${t("sector.inFloat")}`}
              onChange={(event) => void update(code, { show_in_float: event.target.checked })} />
            <span>{t("sector.inFloat")}</span>
          </label>
          <select value={sector?.id ?? ""} disabled={busy || !industry?.sectors.length}
            aria-label={`${displayName(stock)} ${t("sector.select")}`}
            onChange={(event) => void update(code, { selected_id: event.target.value })}>
            {!industry?.sectors.length && <option value="">{t("sector.openDetailFirst")}</option>}
            {industry?.sectors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>;
      })}
    </div>
    {error && <div className="save-error" role="alert">{error}</div>}
  </div>;
}
