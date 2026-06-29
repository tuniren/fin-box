import { useEffect, useMemo, useRef, useState } from "react";
import {
  Blocks,
  BookOpen,
  Check,
  ChevronRight,
  Edit3,
  Files,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  Maximize2,
  MessageSquare,
  Minus,
  MoreHorizontal,
  Newspaper,
  PanelLeft,
  PanelRight,
  Plus,
  RefreshCw,
  Save,
  Square,
  Settings,
  Tag,
  Trash2,
  UserCircle,
  X
} from "lucide-react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import {
  dayProfit,
  displayName,
  effectivePrice,
  marketValue,
  totalProfit,
  totalProfitPoints,
  totalShares
} from "../../shared/finance";
import { currentTheme, profitColor } from "../../shared/theme";
import type { AppState, MottoConfig, NoteTreeItem, Position, StockCommentItem, StockCommentPage, StockNewsPage, StockSearchResult, StockStatus, Theme } from "../../shared/types";
import { KLineView } from "../components/KLineView";
import { MarketStatusBar } from "../components/MarketStatusBar";
import { MinutePanel } from "../components/MinutePanel";
import { SearchPane } from "../components/SearchPane";
import { TickerSummary } from "../components/TickerSummary";
import { TradingIntensityPanel } from "../components/TradingIntensityPanel";
import { formatMaybe, formatSigned, stockPercent, themeStyle } from "../utils";

const api = window.finBox;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
type ActivityView = "watchlist" | "news" | "notes";
type ActiveView = "details" | "chart" | "note";
type StockView = "details" | "chart";
type TitleMenu = "file" | "view" | "window";
const defaultMotto: MottoConfig = {
  text: "\u51b7\u9759\uff0c\u8010\u5fc3\uff0c\u53ea\u505a\u770b\u5f97\u61c2\u7684\u51b3\u5b9a\u3002",
  font_family: "Microsoft YaHei",
  font_size: 14,
  color: "#f8fafc"
};
function useAppState() {
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

function parentNotePath(notePath: string) {
  const normalized = notePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

function ensureMarkdownName(name: string) {
  const trimmed = name.trim();
  return trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
}

function joinNotePath(parentPath: string, name: string) {
  const normalizedParent = parentPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const normalizedName = name.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalizedParent ? `${normalizedParent}/${normalizedName}` : normalizedName;
}

function sameMotto(left: MottoConfig, right: MottoConfig) {
  return left.text === right.text && left.font_family === right.font_family && left.font_size === right.font_size && left.color === right.color;
}

export function MainWorkspace() {
  const state = useAppState();
  const visibleStocks = useVisibleStocks(state);
  const holdStocks = useHoldStocks(visibleStocks);
  const [selectedCode, setSelectedCode] = useState<string>();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>();
  const [openStockViews, setOpenStockViews] = useState<Set<StockView>>(() => new Set());
  const [explorerVisible, setExplorerVisible] = useState(true);
  const [editorVisible, setEditorVisible] = useState(true);
  const [sideVisible, setSideVisible] = useState(true);
  const [activeTitleMenu, setActiveTitleMenu] = useState<TitleMenu>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeError, setThemeError] = useState("");
  const [explorerWidth, setExplorerWidth] = useState(332);
  const [sideWidth, setSideWidth] = useState(420);
  const [activityView, setActivityView] = useState<ActivityView>("watchlist");
  const [marketNewsPage, setMarketNewsPage] = useState(1);
  const [marketNews, setMarketNews] = useState<StockNewsPage>();
  const [marketNewsLoading, setMarketNewsLoading] = useState(false);
  const [marketNewsError, setMarketNewsError] = useState("");
  const [marketNewsReload, setMarketNewsReload] = useState(0);
  const [noteTree, setNoteTree] = useState<NoteTreeItem[]>([]);
  const [selectedNotePath, setSelectedNotePath] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [savedNoteContent, setSavedNoteContent] = useState("");
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState("");
  const [notesReload, setNotesReload] = useState(0);
  const [mottoDraft, setMottoDraft] = useState<MottoConfig>(defaultMotto);
  const [savedMotto, setSavedMotto] = useState<MottoConfig>(defaultMotto);
  const [mottoSaving, setMottoSaving] = useState(false);
  const [mottoError, setMottoError] = useState("");

  useEffect(() => {
    if (!visibleStocks.length) {
      setSelectedCode(undefined);
      setOpenStockViews(new Set());
      setActiveView((view) => (view === "details" || view === "chart" ? undefined : view));
      return;
    }
    if (!selectedCode || !visibleStocks.some((stock) => stock.config.code === selectedCode)) {
      setSelectedCode(visibleStocks[0].config.code);
    }
  }, [selectedCode, visibleStocks]);

  useEffect(() => {
    let cancelled = false;
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void api.searchStocks(query.trim()).then((items) => {
        if (!cancelled) setResults(items.slice(0, 16));
      });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const offCycle = api.onCycleStock(() => {
      setSelectedCode((code) => {
        if (!holdStocks.length) return code;
        const index = holdStocks.findIndex((stock) => stock.config.code === code);
        return holdStocks[index === -1 ? 0 : (index + 1) % holdStocks.length].config.code;
      });
    });
    return offCycle;
  }, [holdStocks]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if ((event.target as HTMLElement | null)?.closest(".title-menu")) return;
      setActiveTitleMenu(undefined);
    };

    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (activityView !== "news") return;

    setMarketNewsLoading(true);
    setMarketNewsError("");
    void api.fetchStockNews("", marketNewsPage)
      .then((page) => {
        if (!cancelled) setMarketNews(page);
      })
      .catch((error) => {
        if (!cancelled) setMarketNewsError(error instanceof Error ? error.message : "Failed to load 7x24.");
      })
      .finally(() => {
        if (!cancelled) setMarketNewsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activityView, marketNewsPage, marketNewsReload]);

  useEffect(() => {
    let cancelled = false;
    if (activityView !== "notes") return;

    setNotesLoading(true);
    setNoteError("");
    void api.listNotes()
      .then((items) => {
        if (!cancelled) setNoteTree(items);
      })
      .catch((error) => {
        if (!cancelled) setNoteError(error instanceof Error ? error.message : "Failed to load notes.");
      })
      .finally(() => {
        if (!cancelled) setNotesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activityView, notesReload]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedNotePath) {
      setNoteContent("");
      setSavedNoteContent("");
      return;
    }

    setNoteLoading(true);
    setNoteError("");
    void api.readNote(selectedNotePath)
      .then((note) => {
        if (cancelled) return;
        setNoteContent(note.content);
        setSavedNoteContent(note.content);
      })
      .catch((error) => {
        if (!cancelled) setNoteError(error instanceof Error ? error.message : "Failed to open note.");
      })
      .finally(() => {
        if (!cancelled) setNoteLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedNotePath]);

  useEffect(() => {
    if (!state) return;
    const nextMotto = state.config.motto;
    setSavedMotto((currentSaved) => {
      if (sameMotto(currentSaved, nextMotto)) return currentSaved;
      setMottoDraft((currentDraft) => (sameMotto(currentDraft, currentSaved) ? nextMotto : currentDraft));
      return nextMotto;
    });
  }, [state?.config.motto.text, state?.config.motto.font_family, state?.config.motto.font_size, state?.config.motto.color]);

  const theme = state ? currentTheme(state.config) : undefined;
  const selectedStock = visibleStocks.find((stock) => stock.config.code === selectedCode) ?? visibleStocks[0];
  const selectedNoteName = selectedNotePath ? selectedNotePath.split("/").pop() ?? selectedNotePath : "";
  const noteDirty = noteContent !== savedNoteContent;
  const mottoDirty = !sameMotto(mottoDraft, savedMotto);
  const detailsOpen = openStockViews.has("details");
  const chartOpen = openStockViews.has("chart");

  const openStockView = (view: StockView) => {
    if (!selectedStock) return;
    setOpenStockViews((items) => new Set(items).add(view));
    setActiveView(view);
    setEditorVisible(true);
  };

  const closeStockView = (view: StockView) => {
    setOpenStockViews((items) => {
      const next = new Set(items);
      next.delete(view);
      return next;
    });
    setActiveView((current) => {
      if (current !== view) return current;
      if (view !== "details" && detailsOpen) return "details";
      if (view !== "chart" && chartOpen) return "chart";
      return undefined;
    });
  };

  const startResize = (target: "explorer" | "side", startEvent: ReactMouseEvent<HTMLDivElement>) => {
    startEvent.preventDefault();
    const startX = startEvent.clientX;
    const startExplorerWidth = explorerWidth;
    const startSideWidth = sideWidth;

    const onMouseMove = (event: MouseEvent) => {
      const delta = event.clientX - startX;
      if (target === "explorer") {
        setExplorerWidth(clamp(startExplorerWidth + delta, 220, 520));
      } else {
        setSideWidth(clamp(startSideWidth - delta, 260, 640));
      }
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const refreshNotes = () => setNotesReload((value) => value + 1);

  const updateMottoDraft = (patch: Partial<MottoConfig>) => {
    setMottoDraft((motto) => ({ ...motto, ...patch }));
  };

  const runTitleMenuAction = (action: () => void) => {
    action();
    setActiveTitleMenu(undefined);
  };

  const selectTheme = async (themeName: string) => {
    setThemeError("");
    try {
      await api.updateTheme(themeName);
      setSettingsOpen(false);
    } catch (error) {
      setThemeError(error instanceof Error ? error.message : "Failed to switch theme.");
    }
  };

  const createNoteItem = async (type: "file" | "directory", parentPath = parentNotePath(selectedNotePath)) => {
    const name = window.prompt(type === "file" ? "New markdown file" : "New folder", type === "file" ? "Untitled.md" : "New Folder");
    if (!name) return;
    setNoteError("");
    try {
      const items = await api.createNote(parentPath, type, name);
      setNoteTree(items);
      if (type === "file") {
        setSelectedNotePath(joinNotePath(parentPath, ensureMarkdownName(name)));
        setActiveView("note");
        setEditorVisible(true);
      }
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : "Failed to create note.");
    }
  };

  const renameNoteItem = async (item: NoteTreeItem) => {
    const name = window.prompt("Rename", item.name);
    if (!name || name === item.name) return;
    setNoteError("");
    try {
      const items = await api.renameNote(item.path, name);
      setNoteTree(items);
      if (item.type === "file" && selectedNotePath === item.path) {
        setSelectedNotePath(joinNotePath(parentNotePath(item.path), ensureMarkdownName(name)));
      }
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : "Failed to rename note.");
    }
  };

  const deleteNoteItem = async (item: NoteTreeItem) => {
    if (!window.confirm(`Delete ${item.name}?`)) return;
    setNoteError("");
    try {
      const items = await api.deleteNote(item.path);
      setNoteTree(items);
      if (selectedNotePath === item.path || selectedNotePath.startsWith(`${item.path}/`)) {
        setSelectedNotePath("");
        setActiveView(detailsOpen ? "details" : chartOpen ? "chart" : undefined);
      }
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : "Failed to delete note.");
    }
  };

  const saveMotto = async () => {
    setMottoSaving(true);
    setMottoError("");
    try {
      await api.updateMotto(mottoDraft);
      setSavedMotto(mottoDraft);
    } catch (error) {
      setMottoError(error instanceof Error ? error.message : "Failed to save motto.");
    } finally {
      setMottoSaving(false);
    }
  };

  const saveNote = async () => {
    if (!selectedNotePath) return;
    setNoteSaving(true);
    setNoteError("");
    try {
      await api.saveNote(selectedNotePath, noteContent);
      setSavedNoteContent(noteContent);
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : "Failed to save note.");
    } finally {
      setNoteSaving(false);
    }
  };

  if (!state || !theme) {
    return (
      <main className="workspace loading-screen">
        <span>Loading market data...</span>
      </main>
    );
  }

  return (
    <main className="workspace">
      <header className="title-bar">
        <nav className="title-menu" aria-label="Application menu">
          <img className="title-logo" src="./assets/app-icon.svg" alt="" />
          <div className={`title-menu-group ${activeTitleMenu === "file" ? "open" : ""}`}>
            <button className="title-menu-root" aria-haspopup="menu" aria-expanded={activeTitleMenu === "file"} onClick={() => setActiveTitleMenu((menu) => (menu === "file" ? undefined : "file"))}>File</button>
            <div className="title-menu-dropdown" role="menu">
              <button role="menuitem" onClick={() => runTitleMenuAction(() => setSearchOpen(true))}>Add Symbol</button>
              <button role="menuitem" onClick={() => runTitleMenuAction(() => void api.forceRefresh())}>Refresh</button>
              <span className="title-menu-separator" />
              <button role="menuitem" onClick={() => runTitleMenuAction(() => void api.openConfigFile())}>Open Config</button>
              <button role="menuitem" onClick={() => runTitleMenuAction(() => void api.openConfigDir())}>Open Config Folder</button>
              <span className="title-menu-separator" />
              <button role="menuitem" onClick={() => runTitleMenuAction(() => void api.quit())}>Quit</button>
            </div>
          </div>
          <div className={`title-menu-group ${activeTitleMenu === "view" ? "open" : ""}`}>
            <button className="title-menu-root" aria-haspopup="menu" aria-expanded={activeTitleMenu === "view"} onClick={() => setActiveTitleMenu((menu) => (menu === "view" ? undefined : "view"))}>View</button>
            <div className="title-menu-dropdown" role="menu">
              <button role="menuitem" onClick={() => runTitleMenuAction(() => setExplorerVisible((value) => !value))}>{explorerVisible ? "Hide Explorer" : "Show Explorer"}</button>
              <button role="menuitem" onClick={() => runTitleMenuAction(() => setEditorVisible((value) => !value))}>{editorVisible ? "Hide Editor" : "Show Editor"}</button>
              <button role="menuitem" onClick={() => runTitleMenuAction(() => setSideVisible((value) => !value))}>{sideVisible ? "Hide Side Panel" : "Show Side Panel"}</button>
              <span className="title-menu-separator" />
              <button
                role="menuitem"
                onClick={() => runTitleMenuAction(() => {
                  openStockView("details");
                })}
                disabled={!selectedStock}
              >
                Details
              </button>
              <button
                role="menuitem"
                onClick={() => runTitleMenuAction(() => {
                  openStockView("chart");
                })}
                disabled={!selectedStock}
              >
                Chart
              </button>
            </div>
          </div>
          <div className={`title-menu-group ${activeTitleMenu === "window" ? "open" : ""}`}>
            <button className="title-menu-root" aria-haspopup="menu" aria-expanded={activeTitleMenu === "window"} onClick={() => setActiveTitleMenu((menu) => (menu === "window" ? undefined : "window"))}>Window</button>
            <div className="title-menu-dropdown" role="menu">
              <button role="menuitem" onClick={() => runTitleMenuAction(() => void api.toggleFloatWindow())}>Toggle Stock Float</button>
              <button role="menuitem" onClick={() => runTitleMenuAction(() => void api.toggleMottoWindow())}>Toggle Motto Window</button>
            </div>
          </div>
        </nav>
        <div className="window-title">electron-react</div>
        <div className="layout-actions" aria-label="Layout actions">
          <button className={explorerVisible ? "active" : ""} onClick={() => setExplorerVisible((value) => !value)} aria-label="Toggle explorer"><PanelLeft size={16} /></button>
          <button className={editorVisible ? "active" : ""} onClick={() => setEditorVisible((value) => !value)} aria-label="Toggle editor"><PanelRight size={16} /></button>
          <button className={sideVisible ? "active" : ""} onClick={() => setSideVisible((value) => !value)} aria-label="Toggle side panel"><PanelRight size={16} /></button>
        </div>
        <div className="window-controls" aria-label="Window controls">
          <button onClick={() => void api.minimizeWindow()} aria-label="Minimize"><Minus size={15} /></button>
          <button onClick={() => void api.toggleMaximizeWindow()} aria-label="Maximize"><Square size={12} /></button>
          <button className="close" onClick={() => void api.closeWindow()} aria-label="Close"><X size={15} /></button>
        </div>
      </header>

      <section
        className={`workbench ${explorerVisible ? "" : "hide-explorer"} ${editorVisible ? "" : "hide-editor"} ${sideVisible ? "" : "hide-side"}`}
        style={{ "--explorer-width": `${explorerWidth}px`, "--side-width": `${sideWidth}px` } as CSSProperties}
      >
        <aside className="activity-bar" aria-label="Activity bar">
          <div className="activity-top">
            <button className={`activity-item ${activityView === "watchlist" ? "active" : ""}`} onClick={() => { setActivityView("watchlist"); setExplorerVisible(true); if (activeView === "note") setActiveView(detailsOpen ? "details" : chartOpen ? "chart" : undefined); }} aria-label="Explorer"><Files size={24} /></button>
            <button className={`activity-item ${activityView === "news" ? "active" : ""}`} onClick={() => { setActivityView("news"); setExplorerVisible(true); }} aria-label="7x24"><Newspaper size={23} /></button>
            <button className={`activity-item ${activityView === "notes" ? "active" : ""}`} onClick={() => { setActivityView("notes"); setExplorerVisible(true); setActiveView("note"); }} aria-label="Notes"><BookOpen size={23} /></button>
            <button className="activity-item" aria-label="Source Control"><GitBranch size={23} /><span className="activity-badge">{visibleStocks.length}</span></button>
            <button className="activity-item" aria-label="Extensions"><Blocks size={23} /></button>
          </div>
          <div className="activity-bottom">
            <button className="activity-item" aria-label="Accounts"><UserCircle size={24} /></button>
            <button className={`activity-item ${settingsOpen ? "active" : ""}`} onClick={() => setSettingsOpen((value) => !value)} aria-label="Settings"><Settings size={23} /></button>
          </div>
        </aside>

        {settingsOpen && (
          <ThemeQuickPick
            currentThemeName={state.config.current_theme}
            themes={state.config.themes}
            error={themeError}
            onClose={() => setSettingsOpen(false)}
            onSelect={(themeName) => void selectTheme(themeName)}
          />
        )}

        {explorerVisible && (
        <aside className="explorer-panel">
          <div className="explorer-header">
            <span>{activityView === "news" ? "7X24" : activityView === "notes" ? "NOTES" : "EXPLORER"}</span>
            {activityView === "watchlist" ? (
              <div className="explorer-actions">
                <button onClick={() => setSearchOpen(true)} title="Add symbol" aria-label="Add symbol"><Plus size={15} /></button>
                <button onClick={() => void api.forceRefresh()} title="Refresh quotes" aria-label="Refresh quotes"><RefreshCw size={14} /></button>
                <button onClick={() => void api.openConfigFile()} title="Open config file" aria-label="Open config file"><FileText size={14} /></button>
                <button title="More" aria-label="More"><MoreHorizontal size={15} /></button>
              </div>
            ) : activityView === "news" ? (
              <div className="explorer-actions">
                <button onClick={() => { setMarketNewsPage(1); setMarketNewsReload((value) => value + 1); }} disabled={marketNewsLoading} title="Refresh 7x24" aria-label="Refresh 7x24"><RefreshCw size={14} /></button>
              </div>
            ) : (
              <div className="explorer-actions">
                <button onClick={() => void createNoteItem("file")} title="New markdown file" aria-label="New markdown file"><FileText size={14} /></button>
                <button onClick={() => void createNoteItem("directory")} title="New folder" aria-label="New folder"><Folder size={14} /></button>
                <button onClick={refreshNotes} disabled={notesLoading} title="Refresh notes" aria-label="Refresh notes"><RefreshCw size={14} /></button>
                <button onClick={() => void api.openNotesDir()} title="Open notes folder" aria-label="Open notes folder"><FolderOpen size={14} /></button>
              </div>
            )}
          </div>
          {activityView === "news" ? (
            <MarketNewsPanel
              news={marketNews}
              loading={marketNewsLoading}
              error={marketNewsError}
              page={marketNewsPage}
              onPrev={() => setMarketNewsPage((page) => Math.max(1, page - 1))}
              onNext={() => setMarketNewsPage((page) => page + 1)}
            />
          ) : activityView === "notes" ? (
            <NotesPanel
              items={noteTree}
              selectedPath={selectedNotePath}
              loading={notesLoading}
              error={noteError}
              onSelect={(item) => {
                setSelectedNotePath(item.path);
                setActiveView("note");
                setEditorVisible(true);
              }}
              onNewFile={(parentPath) => void createNoteItem("file", parentPath)}
              onNewFolder={(parentPath) => void createNoteItem("directory", parentPath)}
              onRename={(item) => void renameNoteItem(item)}
              onDelete={(item) => void deleteNoteItem(item)}
            />
          ) : (
            <GroupedWatchlist
              stocks={visibleStocks}
              selectedCode={selectedStock?.config.code}
              theme={theme}
              onSelect={(stock) => setSelectedCode(stock.config.code)}
              onOpenDetails={(stock) => { setSelectedCode(stock.config.code); openStockView("details"); }}
            />
          )}
        </aside>
        )}

        {explorerVisible && editorVisible && <div className="resize-handle resize-handle-left" onMouseDown={(event) => startResize("explorer", event)} />}

        {editorVisible && (
        <section className="editor-region">
          <div className="tab-strip">
            {detailsOpen && (
              <button className={`editor-tab ${activeView === "details" ? "active" : ""}`} onClick={() => setActiveView("details")}>
                <FileText size={14} />
                {selectedStock ? `${displayName(selectedStock)}.tsx` : "Portfolio.tsx"}
                <span className="tab-status">U</span>
                <span className="tab-close" onClick={(event) => { event.stopPropagation(); closeStockView("details"); }} role="button" aria-label="Close details tab" title="Close details tab">
                  <X size={14} />
                </span>
              </button>
            )}
            {chartOpen && (
              <button className={`editor-tab ${activeView === "chart" ? "active" : ""}`} onClick={() => setActiveView("chart")} disabled={!selectedStock}>
                <span className="react-dot">K</span>
                KLine
                <span className="tab-close" onClick={(event) => { event.stopPropagation(); closeStockView("chart"); }} role="button" aria-label="Close KLine tab" title="Close KLine tab">
                  <X size={14} />
                </span>
              </button>
            )}
          </div>
          <div className="breadcrumbs">
            <span>src</span>
            <ChevronRight size={14} />
            <span>renderer</span>
            <ChevronRight size={14} />
            <span>{selectedStock ? selectedStock.config.code : "portfolio"}</span>
          </div>
          <div className="editor-panel">
            {selectedStock && activeView === "details" ? (
              <StockDetail state={state} stock={selectedStock} theme={theme} onOpenChart={() => openStockView("chart")} />
            ) : selectedStock && activeView === "chart" ? (
              <KLineView code={selectedStock.config.code} name={displayName(selectedStock)} />
            ) : (
              <div className="empty-state">Open Details or Chart to start</div>
            )}
          </div>
        </section>
        )}

        {sideVisible && editorVisible && <div className="resize-handle resize-handle-right" onMouseDown={(event) => startResize("side", event)} />}

        {sideVisible && (
        <aside className="codex-panel">
          <div className="codex-title">FINBOX</div>
          <div className="codex-toolbar">
            <button onClick={() => void api.openConfigDir()} title="Open config folder" aria-label="Open config folder"><FolderOpen size={15} /></button>
            <button onClick={() => void api.toggleFloatWindow()} title="Toggle floating window" aria-label="Toggle floating window"><Maximize2 size={15} /></button>
            <button title="More" aria-label="More"><MoreHorizontal size={15} /></button>
          </div>
          <div className="codex-content">
            <span className="muted">Selected Symbol</span>
            <span>{selectedStock ? displayName(selectedStock) : "None"}</span>
            <span className="muted">Code</span>
            <span>{selectedStock?.config.code ?? "--"}</span>
            <button className="tool-button" onClick={() => void api.forceRefresh()}>
              <RefreshCw size={14} />
              Refresh
            </button>
            <button className="tool-button" onClick={() => void api.openConfigFile()}>
              <FileText size={14} />
              Config
            </button>
            <section className="motto-editor">
              <div className="motto-editor-title">
                <span>Motto</span>
                <button className="icon-tool compact" onClick={() => void api.toggleMottoWindow()} title="Toggle motto window" aria-label="Toggle motto window">
                  <Maximize2 size={14} />
                </button>
              </div>
              <textarea
                value={mottoDraft.text}
                onChange={(event) => updateMottoDraft({ text: event.target.value })}
                placeholder="Write a reminder to keep in sight"
              />
              <div className="motto-style-grid">
                <label>
                  <span>Font</span>
                  <input value={mottoDraft.font_family} onChange={(event) => updateMottoDraft({ font_family: event.target.value })} />
                </label>
                <label>
                  <span>Size</span>
                  <input
                    type="number"
                    min="10"
                    max="36"
                    step="1"
                    value={mottoDraft.font_size || ""}
                    onChange={(event) => updateMottoDraft({ font_size: event.target.value === "" ? 0 : clamp(Number(event.target.value), 10, 36) })}
                  />
                </label>
                <label>
                  <span>Color</span>
                  <input type="color" value={mottoDraft.color} onChange={(event) => updateMottoDraft({ color: event.target.value })} />
                </label>
              </div>
              <div className="motto-actions">
                {mottoDirty && <span className="edit-state">Unsaved motto</span>}
                {mottoError && <span className="save-error">{mottoError}</span>}
                <button className="tool-button" onClick={() => setMottoDraft(savedMotto)} disabled={!mottoDirty || mottoSaving}>
                  Cancel
                </button>
                <button className="tool-button accent" onClick={() => void saveMotto()} disabled={!mottoDirty || mottoSaving}>
                  {mottoSaving ? "Saving..." : "Save Motto"}
                </button>
              </div>
            </section>
          </div>
        </aside>
        )}
      </section>

      <MarketStatusBar state={state} theme={theme} />

      {searchOpen && (
        <div className="modal-backdrop" onMouseDown={() => setSearchOpen(false)}>
          <section className="search-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-title">
              <span>Add Symbol</span>
              <button className="icon-tool compact" onClick={() => setSearchOpen(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <SearchPane
              query={query}
              results={results}
              onQuery={setQuery}
              onClose={() => setSearchOpen(false)}
              onAdd={(stock) => {
                void api.addStock(stock.code, stock.name);
                setSearchOpen(false);
                setQuery("");
              }}
            />
          </section>
        </div>
      )}
    </main>
  );
}

export function FloatTickerView() {
  const state = useAppState();
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
    <main
      ref={shellRef}
      className="ticker-shell drag-region"
      style={themeStyle(theme)}
    >
      {state && selectedStock ? <TickerSummary state={state} stock={selectedStock} compactRefreshBars /> : <span className="muted">No symbols</span>}
    </main>
  );
}

export function MottoWindowView() {
  const state = useAppState();
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

function GroupedWatchlist({
  stocks,
  selectedCode,
  theme,
  onSelect,
  onOpenDetails
}: {
  stocks: StockStatus[];
  selectedCode?: string;
  theme: Theme;
  onSelect: (stock: StockStatus) => void;
  onOpenDetails: (stock: StockStatus) => void;
}) {
  const groups = useMemo(() => groupStocksByTag(stocks), [stocks]);
  const initializedCollapsedTags = useRef<Set<string>>(new Set(groups.map((group) => group.tag)));
  const [collapsedTags, setCollapsedTags] = useState<Set<string>>(() => new Set(groups.map((group) => group.tag)));

  useEffect(() => {
    const newTags = groups.map((group) => group.tag).filter((tag) => !initializedCollapsedTags.current.has(tag));
    if (!newTags.length) return;
    newTags.forEach((tag) => initializedCollapsedTags.current.add(tag));
    setCollapsedTags((items) => new Set([...items, ...newTags]));
  }, [groups]);

  if (!stocks.length) return <div className="empty-state">No symbols in watchlist</div>;

  const toggleTag = (tag: string) => {
    setCollapsedTags((items) => {
      const next = new Set(items);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  return (
    <div className="watch-groups">
      {groups.map((group) => {
        const collapsed = collapsedTags.has(group.tag);
        return (
          <section className="watch-group" key={group.tag}>
            <button
              className={`watch-group-title ${collapsed ? "collapsed" : ""}`}
              onClick={() => toggleTag(group.tag)}
              aria-expanded={!collapsed}
            >
              <ChevronRight size={16} />
              <Folder size={15} />
              <span>{group.tag}</span>
              <small>{group.stocks.length}</small>
            </button>
            {!collapsed && (
              <StockTable
                stocks={group.stocks}
                selectedCode={selectedCode}
                theme={theme}
                onSelect={onSelect}
                onOpenDetails={onOpenDetails}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

function MarketNewsPanel({
  news,
  loading,
  error,
  page,
  onPrev,
  onNext
}: {
  news?: StockNewsPage;
  loading: boolean;
  error: string;
  page: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="market-news-pane">
      <div className="market-news-actions">
        <button className="icon-tool compact" onClick={onPrev} disabled={page <= 1 || loading} title="Previous page" aria-label="Previous page">
          <ChevronRight className="reverse-icon" size={14} />
        </button>
        <span>{page}</span>
        <button className="icon-tool compact" onClick={onNext} disabled={loading || news?.hasMore === false} title="Next page" aria-label="Next page">
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="market-news-list">
        {loading && <div className="news-state">Loading...</div>}
        {error && <div className="save-error market-news-error">{error}</div>}
        {!loading && !error && news?.items.length === 0 && <div className="news-state">No news</div>}
        {news?.items.map((item) => (
          <a className="market-news-row" href={item.url} target="_blank" rel="noreferrer" key={item.id}>
            <span>{item.title}</span>
            <small>{[item.date, item.source].filter(Boolean).join(" ") || "--"}</small>
          </a>
        ))}
      </div>
    </div>
  );
}

function NotesPanel({
  items,
  selectedPath,
  loading,
  error,
  onSelect,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete
}: {
  items: NoteTreeItem[];
  selectedPath: string;
  loading: boolean;
  error: string;
  onSelect: (item: NoteTreeItem) => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onRename: (item: NoteTreeItem) => void;
  onDelete: (item: NoteTreeItem) => void;
}) {
  if (loading && items.length === 0) return <div className="empty-state">Loading notes...</div>;
  if (!loading && items.length === 0) return <div className="empty-state">No notes</div>;

  return (
    <div className="notes-tree">
      {error && <div className="save-error notes-error">{error}</div>}
      {items.map((item) => (
        <NoteTreeRow
          item={item}
          selectedPath={selectedPath}
          level={0}
          onSelect={onSelect}
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
          onRename={onRename}
          onDelete={onDelete}
          key={item.path}
        />
      ))}
    </div>
  );
}

function NoteTreeRow({
  item,
  selectedPath,
  level,
  onSelect,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete
}: {
  item: NoteTreeItem;
  selectedPath: string;
  level: number;
  onSelect: (item: NoteTreeItem) => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onRename: (item: NoteTreeItem) => void;
  onDelete: (item: NoteTreeItem) => void;
}) {
  const isDirectory = item.type === "directory";
  return (
    <div className="note-tree-branch">
      <div className={`note-tree-row ${selectedPath === item.path ? "active" : ""}`} style={{ paddingLeft: 8 + level * 14 }}>
        <button className="note-tree-main" onClick={() => isDirectory ? undefined : onSelect(item)}>
          {isDirectory ? <Folder size={14} /> : <FileText size={14} />}
          <span>{item.name}</span>
        </button>
        <div className="note-tree-actions">
          {isDirectory && (
            <>
              <button onClick={() => onNewFile(item.path)} title="New file" aria-label="New file"><FileText size={12} /></button>
              <button onClick={() => onNewFolder(item.path)} title="New folder" aria-label="New folder"><Folder size={12} /></button>
            </>
          )}
          <button onClick={() => onRename(item)} title="Rename" aria-label="Rename"><Edit3 size={12} /></button>
          <button onClick={() => onDelete(item)} title="Delete" aria-label="Delete"><Trash2 size={12} /></button>
        </div>
      </div>
      {item.children?.map((child) => (
        <NoteTreeRow
          item={child}
          selectedPath={selectedPath}
          level={level + 1}
          onSelect={onSelect}
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
          onRename={onRename}
          onDelete={onDelete}
          key={child.path}
        />
      ))}
    </div>
  );
}

function groupStocksByTag(stocks: StockStatus[]) {
  const groups = new Map<string, StockStatus[]>();
  for (const stock of stocks) {
    const tags = stock.config.tags.length ? stock.config.tags : ["watchlist"];
    for (const tag of tags) {
      const key = tag.trim() || "watchlist";
      groups.set(key, [...(groups.get(key) ?? []), stock]);
    }
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tag, groupStocks]) => ({ tag, stocks: groupStocks }));
}

function StockTable({
  stocks,
  selectedCode,
  theme,
  onSelect,
  onOpenDetails
}: {
  stocks: StockStatus[];
  selectedCode?: string;
  theme: Theme;
  onSelect: (stock: StockStatus) => void;
  onOpenDetails: (stock: StockStatus) => void;
}) {
  if (!stocks.length) return <div className="empty-state">No symbols in watchlist</div>;

  return (
    <div className="watch-table">
      <div className="watch-head">
        <span>Name</span>
        <span>Last</span>
        <span>Chg%</span>
        <span>Day P/L</span>
      </div>
      {stocks.map((stock) => (
        <button
          className={`watch-row ${stock.config.code === selectedCode ? "active" : ""}`}
          key={stock.config.code}
          onClick={() => onSelect(stock)}
          onDoubleClick={() => onOpenDetails(stock)}
        >
          <span>
            <span className="stock-name">{displayName(stock)}</span>
            <small>{stock.config.code}</small>
          </span>
          <span>{formatMaybe(effectivePrice(stock.market), 2)}</span>
          <SignedMetric value={stockPercent(stock)} digits={2} suffix="%" theme={theme} />
          <SignedMetric value={dayProfit(stock)} digits={0} theme={theme} />
        </button>
      ))}
    </div>
  );
}

function StockDetail({ state, stock, theme, onOpenChart }: { state: AppState; stock?: StockStatus; theme: Theme; onOpenChart: () => void }) {
  const [draft, setDraft] = useState<Position[]>([]);
  const [aliasDraft, setAliasDraft] = useState("");
  const [aliasEditing, setAliasEditing] = useState(false);
  const [tagDraft, setTagDraft] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [aliasSaving, setAliasSaving] = useState(false);
  const [tagSaving, setTagSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [tagDirty, setTagDirty] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [aliasError, setAliasError] = useState("");
  const [tagError, setTagError] = useState("");
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsPage, setCommentsPage] = useState(1);
  const [comments, setComments] = useState<StockCommentPage>();
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState("");
  const [minuteOpen, setMinuteOpen] = useState(false);

  useEffect(() => {
    setDraft(stock?.config.positions.map((position) => ({ ...position })) ?? []);
    setAliasDraft(stock?.config.alias ?? "");
    setAliasEditing(false);
    setTagDraft(stock?.config.tags ?? []);
    setTagInput("");
    setDirty(false);
    setTagDirty(false);
    setSaveError("");
    setAliasError("");
    setTagError("");
    setCommentsOpen(false);
    setCommentsPage(1);
    setComments(undefined);
    setCommentsLoading(false);
    setCommentsError("");
    setMinuteOpen(false);
  }, [stock?.config.code]);

  useEffect(() => {
    let cancelled = false;
    if (!stock || !commentsOpen) return;

    setCommentsLoading(true);
    setCommentsError("");
    void api.fetchStockComments(stock.config.code, commentsPage)
      .then((page) => {
        if (!cancelled) setComments(page);
      })
      .catch((error) => {
        if (!cancelled) setCommentsError(error instanceof Error ? error.message : "Failed to load comments.");
      })
      .finally(() => {
        if (!cancelled) setCommentsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [stock?.config.code, commentsOpen, commentsPage]);


  if (!stock) return <div className="empty-state">Select a symbol</div>;

  const price = effectivePrice(stock.market);
  const priceChange = price !== undefined && stock.market ? price - stock.market.prev_close : undefined;
  const percent = stockPercent(stock);
  const updateDraft = (index: number, patch: Partial<Position>) => {
    setDirty(true);
    setSaveError("");
    setDraft((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };
  const addPosition = () => {
    setDirty(true);
    setSaveError("");
    setDraft((items) => [...items, { account: "", shares: 0, cost: 0 }]);
  };
  const removePosition = (index: number) => {
    setDirty(true);
    setSaveError("");
    setDraft((items) => items.filter((_, itemIndex) => itemIndex !== index));
  };
  const resetPositions = () => {
    setDraft(stock.config.positions.map((position) => ({ ...position })));
    setDirty(false);
    setSaveError("");
  };
  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag) return;
    setTagError("");
    setTagDirty(true);
    setTagInput("");
    setTagDraft((items) => normalizeTags([...items, tag]));
  };
  const removeTag = (tag: string) => {
    setTagError("");
    setTagDirty(true);
    setTagDraft((items) => items.filter((item) => item !== tag));
  };
  const resetTags = () => {
    setTagDraft(stock.config.tags);
    setTagInput("");
    setTagDirty(false);
    setTagError("");
  };
  const saveTags = async () => {
    setTagSaving(true);
    setTagError("");
    try {
      if (typeof api.updateStockTags !== "function") {
        throw new Error("Tag editor IPC is not available. Restart the app.");
      }
      await api.updateStockTags(stock.config.code, tagDraft);
      setTagDirty(false);
    } catch (error) {
      setTagError(error instanceof Error ? error.message : "Failed to save tags.");
    } finally {
      setTagSaving(false);
    }
  };
  const savePositions = async () => {
    setSaving(true);
    setSaveError("");
    try {
      if (typeof api.updateStockPositions !== "function") {
        throw new Error("Position editor IPC is not available. Restart the app.");
      }
      await api.updateStockPositions(stock.config.code, draft);
      setDirty(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save positions.");
    } finally {
      setSaving(false);
    }
  };
  const resetAlias = () => {
    setAliasDraft(stock.config.alias ?? "");
    setAliasEditing(false);
    setAliasError("");
  };
  const saveAlias = async () => {
    const nextAlias = aliasDraft.trim();
    if (nextAlias === (stock.config.alias ?? "")) {
      setAliasEditing(false);
      return;
    }

    setAliasSaving(true);
    setAliasError("");
    try {
      if (typeof api.updateStockAlias !== "function") {
        throw new Error("Alias editor IPC is not available. Restart the app.");
      }
      await api.updateStockAlias(stock.config.code, nextAlias || undefined);
      setAliasEditing(false);
    } catch (error) {
      setAliasError(error instanceof Error ? error.message : "Failed to save alias.");
    } finally {
      setAliasSaving(false);
    }
  };
  const openComments = () => {
    setCommentsOpen(true);
    setCommentsPage(1);
  };

  return (
    <div className="stock-detail-view">
      <div className="panel-title">
        {aliasEditing ? (
          <span className="detail-heading alias-editor">
            <input
              autoFocus
              value={aliasDraft}
              onChange={(event) => setAliasDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveAlias();
                if (event.key === "Escape") resetAlias();
              }}
              placeholder={stock.market?.name || stock.config.code}
            />
            <button className="icon-tool compact" onClick={() => void saveAlias()} disabled={aliasSaving} title="Save alias" aria-label="Save alias">
              <Save size={13} />
            </button>
            <button className="icon-tool compact" onClick={resetAlias} disabled={aliasSaving} title="Cancel alias edit" aria-label="Cancel alias edit">
              <X size={13} />
            </button>
          </span>
        ) : (
          <span className="detail-heading">
            <span>{displayName(stock)}</span>
            <button className="icon-tool compact" onClick={() => { setAliasDraft(stock.config.alias ?? ""); setAliasEditing(true); }} disabled={aliasSaving} title="Edit alias" aria-label="Edit alias">
              <Edit3 size={13} />
            </button>
          </span>
        )}
        <div className="detail-actions">
          <button className="tool-button" onClick={() => setMinuteOpen((value) => !value)} title="Toggle minute chart" aria-label="Toggle minute chart">
            <RefreshCw size={14} />
            {minuteOpen ? "Close Minute" : "Minute"}
          </button>
          <button className="tool-button" onClick={onOpenChart} title="Open chart" aria-label="Open chart">
            <Maximize2 size={15} />
            Chart
          </button>
        </div>
      </div>
      {aliasError && <div className="save-error alias-error">{aliasError}</div>}
      <div className="detail-table" aria-label="Stock detail quote table">
        <DetailItem label="Last Price" value={formatMaybe(price, 2)} color={profitColor(theme, percent ?? 0)} strong />
        <DetailItem label="Change" value={formatOptionalSigned(priceChange, 2)} color={priceChange === undefined ? undefined : profitColor(theme, priceChange)} />
        <DetailItem label="Change %" value={formatOptionalSigned(percent, 2, "%")} color={percent === undefined ? undefined : profitColor(theme, percent)} />
        <DetailItem label="Open" value={formatMaybe(stock.market?.open, 2)} />
        <DetailItem label="High" value={formatMaybe(stock.market?.high, 2)} />
        <DetailItem label="Low" value={formatMaybe(stock.market?.low, 2)} />
        <DetailItem label="Prev Close" value={formatMaybe(stock.market?.prev_close, 2)} />
        <DetailItem label="Shares" value={`${totalShares(stock) || "--"}`} />
        <DetailItem label="Market Value" value={formatMaybe(marketValue(stock), 0)} />
        <DetailItem label="Day P/L" value={formatOptionalSigned(dayProfit(stock), 0)} color={profitColor(theme, dayProfit(stock))} />
        <DetailItem label="Total P/L" value={formatOptionalSigned(totalProfit(stock), 0)} color={profitColor(theme, totalProfit(stock) ?? 0)} />
        <DetailItem label="Return" value={formatOptionalSigned(totalProfitPoints(stock), 2, "%")} color={profitColor(theme, totalProfitPoints(stock) ?? 0)} />
        <DetailItem label="Quote Time" value={stock.market?.time || "--"} />
        <DetailItem label="Updated" value={state.last_market_update ? new Date(state.last_market_update).toLocaleTimeString() : "--"} />
      </div>
      <TradingIntensityPanel stock={stock} theme={theme} />
      {minuteOpen && <MinutePanel stock={stock} theme={theme} onClose={() => setMinuteOpen(false)} />}
      <section className="tags-editor">
        <div className="tags-title">
          <span>Tags</span>
          <div className="tag-entry">
            <input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTag();
                }
              }}
            />
            <button className="tool-button" onClick={addTag}>
              <Plus size={14} />
              Add
            </button>
          </div>
        </div>
        <div className="tag-list">
          {tagDraft.length === 0 ? (
            <span className="muted">No tags</span>
          ) : (
            tagDraft.map((tag) => (
              <button className="tag-chip" key={tag} onClick={() => removeTag(tag)} title="Remove tag">
                <Tag size={13} />
                <span>{tag}</span>
                <X size={13} />
              </button>
            ))
          )}
        </div>
        <div className="tags-actions">
          {tagDirty && <span className="edit-state">Unsaved tag changes</span>}
          {tagError && <span className="save-error">{tagError}</span>}
          <button className="tool-button" onClick={resetTags} disabled={!tagDirty || tagSaving}>
            Cancel
          </button>
          <button className="tool-button accent" onClick={() => void saveTags()} disabled={!tagDirty || tagSaving}>
            {tagSaving ? "Saving..." : "Save Tags"}
          </button>
        </div>
      </section>
      <section className="positions-editor">
        <div className="positions-title">
          <span>Positions</span>
          <button className="tool-button" onClick={addPosition}>
            <Plus size={14} />
            Row
          </button>
        </div>
        <div className="positions-grid">
          <span>Account</span>
          <span>Shares</span>
          <span>Cost</span>
          <span />
          {draft.length === 0 ? (
            <div className="positions-empty">No positions</div>
          ) : (
            draft.map((position, index) => (
              <div className="position-row" key={`${stock.config.code}-${index}`}>
                <input value={position.account ?? ""} onChange={(event) => updateDraft(index, { account: event.target.value })} />
                <input
                  type="number"
                  step="1"
                  value={position.shares}
                  onChange={(event) => updateDraft(index, { shares: Number(event.target.value) })}
                />
                <input
                  type="number"
                  step="0.001"
                  value={position.cost}
                  onChange={(event) => updateDraft(index, { cost: Number(event.target.value) })}
                />
                <button className="icon-tool compact" onClick={() => removePosition(index)} aria-label="Remove position">
                  <X size={14} />
                </button>
              </div>
            ))
          )}
        </div>
        <div className="positions-actions">
          {dirty && <span className="edit-state">Unsaved position changes</span>}
          {saveError && <span className="save-error">{saveError}</span>}
          <button className="tool-button" onClick={resetPositions} disabled={!dirty || saving}>
            Cancel
          </button>
          <button className="tool-button accent" onClick={() => void savePositions()} disabled={!dirty || saving}>
            {saving ? "Saving..." : "Save Positions"}
          </button>
        </div>
      </section>
      <section className="comments-panel">
        <div className="news-title">
          <span>THS Discussions</span>
          {!commentsOpen ? (
            <button className="tool-button" onClick={openComments}>
              <MessageSquare size={14} />
              Load
            </button>
          ) : (
            <div className="news-actions">
              <button className="icon-tool compact" onClick={() => setCommentsPage((page) => Math.max(1, page - 1))} disabled={commentsPage <= 1 || commentsLoading} title="Previous page" aria-label="Previous page">
                <ChevronRight className="reverse-icon" size={14} />
              </button>
              <span>{commentsPage}</span>
              <button className="icon-tool compact" onClick={() => setCommentsPage((page) => page + 1)} disabled={commentsLoading || comments?.hasMore === false} title="Next page" aria-label="Next page">
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
        {!commentsOpen ? (
          <div className="news-placeholder">Click Load to fetch THS discussions</div>
        ) : (
          <div className="comments-list">
            {commentsLoading && <div className="news-state">Loading...</div>}
            {commentsError && <div className="save-error comments-error">{commentsError}</div>}
            {!commentsLoading && !commentsError && comments?.items.length === 0 && <div className="news-state">No comments</div>}
            {comments?.items.map((item) => (
              <a className="comment-row" href={item.url} target="_blank" rel="noreferrer" key={item.id}>
                <span>{item.text}</span>
                <small>{formatCommentMeta(item)}</small>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ThemeQuickPick({
  currentThemeName,
  themes,
  error,
  onClose,
  onSelect
}: {
  currentThemeName: string;
  themes: Record<string, Theme>;
  error: string;
  onClose: () => void;
  onSelect: (themeName: string) => void;
}) {
  const entries = Object.entries(themes).sort(([left], [right]) => left.localeCompare(right));

  return (
    <div className="quick-pick-backdrop" onMouseDown={onClose}>
      <section className="theme-quick-pick" aria-label="Color theme picker" onMouseDown={(event) => event.stopPropagation()}>
        <div className="quick-pick-input" role="presentation">
          <span>Color Theme</span>
          <button className="icon-tool compact" onClick={onClose} aria-label="Close theme picker" title="Close">
            <X size={14} />
          </button>
        </div>
        <div className="quick-pick-list">
          {entries.map(([themeName, themeValue]) => (
            <button
              className={`quick-pick-row ${themeName === currentThemeName ? "active" : ""}`}
              key={themeName}
              onClick={() => onSelect(themeName)}
            >
              <span className="quick-pick-check">{themeName === currentThemeName && <Check size={15} />}</span>
              <ThemeSwatch theme={themeValue} />
              <span className="quick-pick-name">{formatThemeName(themeName)}</span>
              <small>{themeName}</small>
            </button>
          ))}
        </div>
        {error && <div className="save-error quick-pick-error">{error}</div>}
      </section>
    </div>
  );
}

function ThemeSwatch({ theme }: { theme: Theme }) {
  return (
    <span className="theme-swatch" aria-hidden="true">
      <span style={{ background: theme.background === "transparent" ? theme.menu_bg : theme.background }} />
      <span style={{ background: theme.accent }} />
      <span style={{ background: theme.color_up }} />
      <span style={{ background: theme.color_down }} />
    </span>
  );
}

function DetailItem({ label, value, color, strong = false }: { label: string; value: string; color?: string; strong?: boolean }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <span className={`detail-value ${strong ? "strong" : ""}`} style={{ color }}>{value}</span>
    </div>
  );
}

function SignedMetric({
  value,
  digits,
  suffix = "",
  theme
}: {
  value: number | undefined;
  digits: number;
  suffix?: string;
  theme: Pick<Theme, "color_up" | "color_down">;
}) {
  if (value === undefined) return <span className="muted">--</span>;
  return <span style={{ color: profitColor(theme, value) }}>{formatSigned(value, digits)}{suffix}</span>;
}

function formatOptionalSigned(value: number | undefined, digits: number, suffix = "") {
  return value === undefined ? "--" : `${formatSigned(value, digits)}${suffix}`;
}

function formatThemeName(themeName: string) {
  return themeName
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function normalizeTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function formatCommentMeta(item: StockCommentItem): string {
  const counts = [
    item.replyCount !== undefined ? `reply ${item.replyCount}` : "",
    item.retweetCount !== undefined ? `share ${item.retweetCount}` : "",
    item.likeCount !== undefined ? `like ${item.likeCount}` : ""
  ].filter(Boolean);
  return [item.user, item.date, counts.join(" ")].filter(Boolean).join(" ");
}

