import { contextBridge, ipcRenderer } from "electron";
import type { AiAnalysisConfig, AiAnalysisProcessLog, AppState, FinBoxApi, KLineScale, MottoConfig, RequestLogItem, UpdateStatus, WatchFloatColumn, WatchFloatConfig } from "./shared/types";

// Expose only the FinBox IPC surface to the renderer.
// React can still manage windows and market state while contextIsolation stays on.
const api: FinBoxApi = {
  getState: () => ipcRenderer.invoke("get-state"),
  forceRefresh: () => ipcRenderer.invoke("force-refresh"),
  getUpdateStatus: () => ipcRenderer.invoke("get-update-status"),
  getRequestLogs: () => ipcRenderer.invoke("get-request-logs"),
  clearRequestLogs: () => ipcRenderer.invoke("clear-request-logs"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  openConfigFile: () => ipcRenderer.invoke("open-config-file"),
  openConfigDir: () => ipcRenderer.invoke("open-config-dir"),
  quit: () => ipcRenderer.invoke("quit"),
  searchStocks: (query: string) => ipcRenderer.invoke("search-stocks", query),
  addStock: (code: string, alias?: string) => ipcRenderer.invoke("add-stock", code, alias),
  removeStock: (code: string) => ipcRenderer.invoke("remove-stock", code),
  updateAccountConfig: (patch) => ipcRenderer.invoke("update-account-config", patch),
  updateMotto: (motto: MottoConfig) => ipcRenderer.invoke("update-motto", motto),
  updateWatchFloatConfig: (config: WatchFloatConfig) => ipcRenderer.invoke("update-watch-float-config", config),
  updateWatchTreeColumns: (columns: WatchFloatColumn[]) => ipcRenderer.invoke("update-watch-tree-columns", columns),
  updateAiAnalysisConfig: (config: AiAnalysisConfig) => ipcRenderer.invoke("update-ai-analysis-config", config),
  updateTradingRefreshInterval: (intervalMs: number) => ipcRenderer.invoke("update-trading-refresh-interval", intervalMs),
  updateWindowCloseBehavior: (behavior) => ipcRenderer.invoke("update-window-close-behavior", behavior),
  updateTheme: (themeName: string) => ipcRenderer.invoke("update-theme", themeName),
  updateStockAlias: (code: string, alias?: string) => ipcRenderer.invoke("update-stock-alias", code, alias),
  updateStockTags: (code: string, tags: string[]) => ipcRenderer.invoke("update-stock-tags", code, tags),
  updateStockGroups: (groups: string[]) => ipcRenderer.invoke("update-stock-groups", groups),
  updateStockGroupOrder: (tag: string, codes: string[]) => ipcRenderer.invoke("update-stock-group-order", tag, codes),
  updateStockPositions: (code: string, positions) => ipcRenderer.invoke("update-stock-positions", code, positions),
  fetchKLine: (code: string, scale: KLineScale, force?: boolean) => ipcRenderer.invoke("fetch-kline", code, scale, force),
  getStockJournal: (code: string) => ipcRenderer.invoke("get-stock-journal", code),
  startStockJournal: (code: string, followedAt: string) => ipcRenderer.invoke("start-stock-journal", code, followedAt),
  saveStockJournalNote: (code, note) => ipcRenderer.invoke("save-stock-journal-note", code, note),
  archiveDailyKLine: (code, points) => ipcRenderer.invoke("archive-daily-kline", code, points),
  fetchMinuteData: (code: string) => ipcRenderer.invoke("fetch-minute-data", code),
  fetchFiveDayMinuteData: (code: string) => ipcRenderer.invoke("fetch-five-day-minute-data", code),
  fetchStockNews: (code: string, page: number, keyword?: string) => ipcRenderer.invoke("fetch-stock-news", code, page, keyword),
  fetchStockNewsArticle: (url: string) => ipcRenderer.invoke("fetch-stock-news-article", url),
  openExternalUrl: (url: string) => ipcRenderer.invoke("open-external-url", url),
  fetchStockComments: (code: string, page: number) => ipcRenderer.invoke("fetch-stock-comments", code, page),
  getAiAnalysisHistory: (code: string) => ipcRenderer.invoke("get-ai-analysis-history", code),
  getAiAnalysisProcess: (code: string) => ipcRenderer.invoke("get-ai-analysis-process", code),
  runAiAnalysis: (code: string) => ipcRenderer.invoke("run-ai-analysis", code),
  listNotes: () => ipcRenderer.invoke("list-notes"),
  readNote: (notePath: string) => ipcRenderer.invoke("read-note", notePath),
  saveNote: (notePath: string, content: string) => ipcRenderer.invoke("save-note", notePath, content),
  createNote: (parentPath: string, type: "file" | "directory", name: string) => ipcRenderer.invoke("create-note", parentPath, type, name),
  renameNote: (notePath: string, name: string) => ipcRenderer.invoke("rename-note", notePath, name),
  deleteNote: (notePath: string) => ipcRenderer.invoke("delete-note", notePath),
  openNotesDir: () => ipcRenderer.invoke("open-notes-dir"),
  resizeWindow: (width: number, height: number) => ipcRenderer.invoke("resize-window", width, height),
  resizeWindowHeight: (height: number) => ipcRenderer.invoke("resize-window-height", height),
  startDrag: () => ipcRenderer.invoke("start-drag"),
  openKLineWindow: (code: string, name: string) => ipcRenderer.invoke("open-kline-window", code, name),
  toggleCamouflageFloatWindow: () => ipcRenderer.invoke("toggle-camouflage-float-window"),
  toggleWatchlistFloatWindow: () => ipcRenderer.invoke("toggle-watchlist-float-window"),
  toggleMottoFloatWindow: () => ipcRenderer.invoke("toggle-motto-float-window"),
  openWatchlistFloatSettings: () => ipcRenderer.invoke("open-watchlist-float-settings"),
  minimizeWindow: () => ipcRenderer.invoke("window-minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window-toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window-close"),
  onState: (callback: (state: AppState) => void) => {
    // Subscription helpers return unsubscribe functions to avoid duplicate listeners.
    const listener = (_event: Electron.IpcRendererEvent, state: AppState) => callback(state);
    ipcRenderer.on("state", listener);
    return () => ipcRenderer.off("state", listener);
  },
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => callback(status);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.off("update-status", listener);
  },
  onRequestLogs: (callback: (logs: RequestLogItem[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, logs: RequestLogItem[]) => callback(logs);
    ipcRenderer.on("request-logs", listener);
    return () => ipcRenderer.off("request-logs", listener);
  },
  onAiAnalysisProcess: (callback: (log: AiAnalysisProcessLog) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, log: AiAnalysisProcessLog) => callback(log);
    ipcRenderer.on("ai-analysis-process", listener);
    return () => ipcRenderer.off("ai-analysis-process", listener);
  },
  onCycleStock: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("cycle-stock", listener);
    return () => ipcRenderer.off("cycle-stock", listener);
  },
  onToggleExpand: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("toggle-expand", listener);
    return () => ipcRenderer.off("toggle-expand", listener);
  },
  onOpenWatchlistFloatSettings: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("open-watchlist-float-settings", listener);
    return () => ipcRenderer.off("open-watchlist-float-settings", listener);
  }
};

contextBridge.exposeInMainWorld("finBox", api);
