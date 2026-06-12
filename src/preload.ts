import { contextBridge, ipcRenderer } from "electron";
import type { AppState, FinBoxApi, KLineScale } from "./shared/types";

// Expose only the FinBox IPC surface to the renderer.
// React can still manage windows and market state while contextIsolation stays on.
const api: FinBoxApi = {
  getState: () => ipcRenderer.invoke("get-state"),
  forceRefresh: () => ipcRenderer.invoke("force-refresh"),
  openConfigFile: () => ipcRenderer.invoke("open-config-file"),
  openConfigDir: () => ipcRenderer.invoke("open-config-dir"),
  quit: () => ipcRenderer.invoke("quit"),
  searchStocks: (query: string) => ipcRenderer.invoke("search-stocks", query),
  addStock: (code: string, alias?: string) => ipcRenderer.invoke("add-stock", code, alias),
  updateAccountConfig: (patch) => ipcRenderer.invoke("update-account-config", patch),
  updateTheme: (themeName: string) => ipcRenderer.invoke("update-theme", themeName),
  updateStockAlias: (code: string, alias?: string) => ipcRenderer.invoke("update-stock-alias", code, alias),
  updateStockTags: (code: string, tags: string[]) => ipcRenderer.invoke("update-stock-tags", code, tags),
  updateStockPositions: (code: string, positions) => ipcRenderer.invoke("update-stock-positions", code, positions),
  fetchKLine: (code: string, scale: KLineScale) => ipcRenderer.invoke("fetch-kline", code, scale),
  getStockJournal: (code: string) => ipcRenderer.invoke("get-stock-journal", code),
  startStockJournal: (code: string, followedAt: string) => ipcRenderer.invoke("start-stock-journal", code, followedAt),
  saveStockJournalNote: (code, note) => ipcRenderer.invoke("save-stock-journal-note", code, note),
  archiveDailyKLine: (code, points) => ipcRenderer.invoke("archive-daily-kline", code, points),
  fetchMinuteData: (code: string) => ipcRenderer.invoke("fetch-minute-data", code),
  fetchStockNews: (code: string, page: number, keyword?: string) => ipcRenderer.invoke("fetch-stock-news", code, page, keyword),
  fetchStockNewsArticle: (url: string) => ipcRenderer.invoke("fetch-stock-news-article", url),
  fetchStockComments: (code: string, page: number) => ipcRenderer.invoke("fetch-stock-comments", code, page),
  listNotes: () => ipcRenderer.invoke("list-notes"),
  readNote: (notePath: string) => ipcRenderer.invoke("read-note", notePath),
  saveNote: (notePath: string, content: string) => ipcRenderer.invoke("save-note", notePath, content),
  createNote: (parentPath: string, type: "file" | "directory", name: string) => ipcRenderer.invoke("create-note", parentPath, type, name),
  renameNote: (notePath: string, name: string) => ipcRenderer.invoke("rename-note", notePath, name),
  deleteNote: (notePath: string) => ipcRenderer.invoke("delete-note", notePath),
  openNotesDir: () => ipcRenderer.invoke("open-notes-dir"),
  resizeWindow: (width: number, height: number) => ipcRenderer.invoke("resize-window", width, height),
  startDrag: () => ipcRenderer.invoke("start-drag"),
  openKLineWindow: (code: string, name: string) => ipcRenderer.invoke("open-kline-window", code, name),
  openMinuteWindow: (code: string, name: string) => ipcRenderer.invoke("open-minute-window", code, name),
  toggleFloatWindow: () => ipcRenderer.invoke("toggle-float-window"),
  minimizeWindow: () => ipcRenderer.invoke("window-minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window-toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window-close"),
  onState: (callback: (state: AppState) => void) => {
    // Subscription helpers return unsubscribe functions to avoid duplicate listeners.
    const listener = (_event: Electron.IpcRendererEvent, state: AppState) => callback(state);
    ipcRenderer.on("state", listener);
    return () => ipcRenderer.off("state", listener);
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
  }
};

contextBridge.exposeInMainWorld("finBox", api);
