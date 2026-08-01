import { Bot } from "lucide-react";
import { useEffect, useState } from "react";
import type { AiAnalysisProcessLog, AiAnalysisResult, StockStatus } from "../../shared/types";
import { displayName } from "../../shared/finance";
import { useI18n } from "../i18n";

const api = window.finBox;

export function AiAnalysisPanel({ stock, enabled, onOpenSettings }: { stock?: StockStatus; enabled: boolean; onOpenSettings: () => void }) {
  const { locale, t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AiAnalysisResult>();
  const [history, setHistory] = useState<AiAnalysisResult[]>([]);
  const [processLog, setProcessLog] = useState<AiAnalysisProcessLog>();

  useEffect(() => {
    setLoading(false);
    setError("");
    setResult(undefined);
    setHistory([]);
    setProcessLog(undefined);
  }, [stock?.config.code]);

  useEffect(() => {
    let cancelled = false;
    if (!stock || !enabled) return;
    void Promise.all([
      api.getAiAnalysisHistory(stock.config.code),
      api.getAiAnalysisProcess(stock.config.code)
    ]).then(([items, log]) => {
      if (cancelled) return;
      setHistory(items);
      setResult(items[0]);
      setProcessLog(log);
      setLoading(log?.status === "running");
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [stock?.config.code, enabled]);

  useEffect(() => {
    if (!stock || !enabled) return;
    return api.onAiAnalysisProcess((log) => {
      if (log.code.toLowerCase() !== stock.config.code.toLowerCase()) return;
      setProcessLog(log);
      setLoading(log.status === "running");
    });
  }, [stock?.config.code, enabled]);

  const runAnalysis = async () => {
    if (!stock || !enabled) return;
    setLoading(true);
    setError("");
    try {
      const next = await api.runAiAnalysis(stock.config.code);
      setResult(next);
      setHistory((items) => [next, ...items.filter((item) => item.id !== next.id)]);
    } catch (error) {
      setError(error instanceof Error ? error.message : t("error.aiAnalysisFailed"));
    } finally {
      setLoading(false);
    }
  };

  if (!stock) {
    return (
      <div className="stock-notes-empty">
        <strong>{t("detail.aiAnalysis")}</strong>
        <span>{t("detail.selectSymbol")}</span>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="stock-ai-panel disabled">
        <div className="stock-ai-disabled">
          <strong>{t("detail.aiDisabledTitle")}</strong>
          <span>{t("detail.aiDisabledHint")}</span>
          <button className="tool-button" type="button" onClick={onOpenSettings}>
            {t("detail.openAiSettings")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stock-ai-panel">
      <header className="stock-notes-header">
        <div>
          <strong>{t("detail.aiAnalysis")}</strong>
          <span>{displayName(stock)} · {stock.config.code}</span>
        </div>
        <button className="tool-button compact-text" onClick={() => void runAnalysis()} disabled={!enabled || loading}>
          <Bot size={13} />
          {t(loading ? "detail.aiAnalyzing" : "detail.aiAnalysis")}
        </button>
      </header>
      {error && <div className="save-error stock-notes-error">{error}</div>}
      <section className="stock-ai-section">
        <div className="stock-ai-title">
          <span>{t("detail.aiHistory")}</span>
          {result && <small>{formatAiAnalysisMeta(result, locale)}</small>}
        </div>
        {result ? <pre>{result.content}</pre> : <div className="news-state">{history.length ? t("common.loading") : "--"}</div>}
      </section>
      <section className="stock-ai-section">
        <div className={`ai-process-status ${processLog?.status ?? ""}`}>
          <span>{t("detail.aiProcess")}</span>
          {processLog && <small>{formatAiProcessMeta(processLog, locale)}</small>}
        </div>
        <pre>{processLog?.output || "--"}</pre>
        {processLog?.error && <div className="save-error">{processLog.error}</div>}
      </section>
      <small className="ai-analysis-risk">{t("detail.aiRiskNotice")}</small>
    </div>
  );
}

function formatAiAnalysisMeta(result: AiAnalysisResult, locale: string) {
  const generated = new Date(result.generatedAt).toLocaleString(locale, { hour12: false });
  const updated = result.dataUpdatedAt ? new Date(result.dataUpdatedAt).toLocaleTimeString(locale, { hour12: false }) : "--";
  return `${generated} / ${updated}`;
}

function formatAiProcessMeta(log: AiAnalysisProcessLog, locale: string) {
  const updated = new Date(log.updatedAt).toLocaleString(locale, { hour12: false });
  return `${log.status} / ${updated}`;
}
