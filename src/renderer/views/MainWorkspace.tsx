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
import type { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
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
import type { AppConfig, AppState, MottoConfig, NoteTreeItem, Position, StockCommentItem, StockCommentPage, StockNewsPage, StockSearchResult, StockStatus, Theme, UpdateStatus } from "../../shared/types";
import { KLineView } from "../components/KLineView";
import { MarketStatusBar } from "../components/MarketStatusBar";
import { MinutePanel } from "../components/MinutePanel";
import { SearchPane } from "../components/SearchPane";
import { TickerSummary } from "../components/TickerSummary";
import { TradingIntensityPanel } from "../components/TradingIntensityPanel";
import { GroupedWatchlist, mergeWatchGroups, normalizeWatchGroupName } from "../components/WatchTree";
import type { WatchTreeSelection } from "../components/WatchTree";
import { formatMaybe, formatSigned, stockPercent, themeStyle } from "../utils";
import { useI18n } from "../i18n";

const api = window.finBox;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
type ActivityView = "watchlist" | "news" | "notes" | "help";
type ActiveView = "details" | "chart" | "note" | "help";
type StockView = "details" | "chart";
type TitleMenu = "file" | "view" | "window" | "language" | "help";
type WatchPromptKind = "create-group" | "rename-group" | "edit-alias";
type WatchPromptState = {
  kind: WatchPromptKind;
  title: string;
  label: string;
  value: string;
  tag?: string;
  stockCode?: string;
};
const defaultMotto: MottoConfig = {
  text: "\u51b7\u9759\uff0c\u8010\u5fc3\uff0c\u53ea\u505a\u770b\u5f97\u61c2\u7684\u51b3\u5b9a\u3002",
  font_family: "Microsoft YaHei",
  font_size: 14,
  color: "#f8fafc"
};
function MenuCheckItem({ checked, radio = false, onClick, children }: { checked: boolean; radio?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className="menu-check-option" role={radio ? "menuitemradio" : "menuitemcheckbox"} aria-checked={checked} onClick={onClick}>
      <span className="menu-check-slot">{checked && <Check size={13} aria-hidden="true" />}</span>
      <span>{children}</span>
    </button>
  );
}

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
  const { locale, setLocale, t } = useI18n();
  const state = useAppState();
  const visibleStocks = useVisibleStocks(state);
  const holdStocks = useHoldStocks(visibleStocks);
  const [selectedCode, setSelectedCode] = useState<string>();
  const [selectedWatchNode, setSelectedWatchNode] = useState<WatchTreeSelection>();
  const [watchPrompt, setWatchPrompt] = useState<WatchPromptState>();
  const [watchPromptValue, setWatchPromptValue] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTargetGroup, setSearchTargetGroup] = useState<string>();
  const [activeView, setActiveView] = useState<ActiveView>();
  const [openStockViews, setOpenStockViews] = useState<Set<StockView>>(() => new Set());
  const [explorerVisible, setExplorerVisible] = useState(true);
  const [editorVisible, setEditorVisible] = useState(true);
  const [sideVisible, setSideVisible] = useState(true);
  const [statusBarVisible, setStatusBarVisible] = useState(true);
  const [activeTitleMenu, setActiveTitleMenu] = useState<TitleMenu>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [themeError, setThemeError] = useState("");
  const [explorerWidth, setExplorerWidth] = useState(332);
  const [sideWidth, setSideWidth] = useState(420);
  const [activityView, setActivityView] = useState<ActivityView>("watchlist");
  const [marketNewsPage, setMarketNewsPage] = useState(1);
  const [marketNews, setMarketNews] = useState<StockNewsPage>();
  const [marketNewsLoading, setMarketNewsLoading] = useState(false);
  const [marketNewsError, setMarketNewsError] = useState("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: "idle", currentVersion: "" });
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
    let cancelled = false;
    void api.getUpdateStatus().then((status) => { if (!cancelled) setUpdateStatus(status); }).catch(() => undefined);
    const unsubscribe = api.onUpdateStatus(setUpdateStatus);
    return () => { cancelled = true; unsubscribe(); };
  }, []);

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
    void Promise.resolve().then(() => api.fetchStockNews("", marketNewsPage))
      .then((page) => {
        if (!cancelled) setMarketNews(page);
      })
      .catch((error) => {
        if (!cancelled) setMarketNewsError(error instanceof Error ? error.message : t("error.loadNewsFailed"));
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

  useEffect(() => {
    if (!searchOpen && !watchPrompt) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSearchOpen(false);
      setSearchTargetGroup(undefined);
      setQuery("");
      setWatchPrompt(undefined);
      setWatchPromptValue("");
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen, watchPrompt]);

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

  const updateWindowCloseBehavior = (behavior: AppConfig["window_close_behavior"]) => {
    void api.updateWindowCloseBehavior(behavior);
  };

  const toggleMaximizeFromTitleBar = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, select, input, textarea, .no-drag, .title-menu, .layout-actions, .window-controls")) return;
    void api.toggleMaximizeWindow();
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

  const openWatchPrompt = (prompt: WatchPromptState) => {
    setWatchPrompt(prompt);
    setWatchPromptValue(prompt.value);
  };

  const closeWatchPrompt = () => {
    setWatchPrompt(undefined);
    setWatchPromptValue("");
  };

  const createWatchGroup = () => {
    if (!state) return;
    openWatchPrompt({
      kind: "create-group",
      title: "New Stock Group",
      label: "Group name",
      value: "New Group"
    });
  };

  const openSearch = (targetGroup?: string) => {
    setSearchTargetGroup(targetGroup);
    setQuery("");
    setSearchOpen(true);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchTargetGroup(undefined);
    setQuery("");
  };

  const addStockFromSearch = async (stock: StockSearchResult) => {
    if (!state) return;
    const existingStock = state.stocks.find((item) => item.config.code.toLowerCase() === stock.code.toLowerCase());
    await api.addStock(stock.code, stock.name);

    if (searchTargetGroup) {
      await api.updateStockTags(stock.code, mergeWatchGroups([...(existingStock?.config.tags ?? []), searchTargetGroup]));
      setSelectedWatchNode({ type: "stock", tag: searchTargetGroup, code: stock.code });
    }

    setSelectedCode(stock.code);
    closeSearch();
  };

  const addStockToWatchGroup = (tag: string) => {
    if (!state) return;
    openSearch(tag);
  };

  const renameWatchGroup = (tag: string) => {
    if (!state) return;
    openWatchPrompt({
      kind: "rename-group",
      title: "Rename Stock Group",
      label: "Group name",
      value: tag,
      tag
    });
  };

  const editSelectedWatchNode = () => {
    if (!state) return;

    if (selectedWatchNode?.type === "group") {
      renameWatchGroup(selectedWatchNode.tag);
      return;
    }

    const targetCode = selectedWatchNode?.type === "stock" ? selectedWatchNode.code : selectedCode;
    if (!targetCode) return;
    const stock = state.stocks.find((item) => item.config.code.toLowerCase() === targetCode.toLowerCase());
    if (!stock) return;

    openWatchPrompt({
      kind: "edit-alias",
      title: "Edit Stock Alias",
      label: "Alias",
      value: stock.config.alias ?? "",
      stockCode: stock.config.code
    });
  };

  const submitWatchPrompt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!state || !watchPrompt) return;

    const value = watchPromptValue.trim();

    if (watchPrompt.kind === "create-group") {
      const groupName = normalizeWatchGroupName(value);
      if (!groupName) return;
      await api.updateStockGroups(mergeWatchGroups([...(state.config.stock_groups ?? []), groupName]));
      setSelectedWatchNode({ type: "group", tag: groupName });
      closeWatchPrompt();
      return;
    }

    if (watchPrompt.kind === "rename-group") {
      const oldTag = watchPrompt.tag;
      const nextName = normalizeWatchGroupName(value);
      if (!oldTag || !nextName || nextName === oldTag) {
        closeWatchPrompt();
        return;
      }

      const nextGroups = mergeWatchGroups((state.config.stock_groups ?? []).map((group) => (group === oldTag ? nextName : group)));
      const affectedStocks = state.stocks.filter((stock) => stock.config.tags.includes(oldTag));
      for (const stock of affectedStocks) {
        await api.updateStockTags(stock.config.code, mergeWatchGroups(stock.config.tags.map((stockTag) => (stockTag === oldTag ? nextName : stockTag))));
      }
      await api.updateStockGroups(nextGroups);
      const previousOrder = state.config.stock_group_order[oldTag];
      if (previousOrder) await api.updateStockGroupOrder(nextName, previousOrder);
      setSelectedWatchNode((selection) => {
        if (!selection || selection.tag !== oldTag) return selection;
        return selection.type === "group" ? { type: "group", tag: nextName } : { ...selection, tag: nextName };
      });
      closeWatchPrompt();
      return;
    }

    if (watchPrompt.kind === "edit-alias") {
      const stockCode = watchPrompt.stockCode;
      if (!stockCode) return;
      const stock = state.stocks.find((item) => item.config.code.toLowerCase() === stockCode.toLowerCase());
      if (!stock || value === (stock.config.alias ?? "")) {
        closeWatchPrompt();
        return;
      }
      await api.updateStockAlias(stock.config.code, value || undefined);
      closeWatchPrompt();
    }
  };

  const moveStockToWatchGroup = async (
    code: string,
    sourceTag: string,
    targetTag: string,
    copy: boolean,
    sourceOrder: string[],
    targetOrder: string[]
  ) => {
    if (!state) return;
    const stock = state.stocks.find((item) => item.config.code.toLowerCase() === code.toLowerCase());
    if (!stock) return;

    if (sourceTag !== targetTag) {
      const currentTags = stock.config.tags.length ? stock.config.tags : ["watchlist"];
      const nextTags = copy
        ? mergeWatchGroups([...currentTags, targetTag])
        : mergeWatchGroups([...currentTags.filter((tag) => tag !== sourceTag), targetTag]);
      await api.updateStockTags(stock.config.code, nextTags);
      if (!copy) await api.updateStockGroupOrder(sourceTag, sourceOrder);
    }

    await api.updateStockGroupOrder(targetTag, targetOrder);
  };
  const deleteSelectedWatchNode = async () => {
    if (!state || !selectedWatchNode) return;

    if (selectedWatchNode.type === "stock") {
      const stock = state.stocks.find((item) => item.config.code.toLowerCase() === selectedWatchNode.code.toLowerCase());
      if (!stock) return;
      if (!window.confirm(`Delete ${displayName(stock)} from watchlist?`)) return;

      await api.removeStock(stock.config.code);
      if (selectedCode === stock.config.code) setSelectedCode(undefined);
      return;
    }

    const tag = selectedWatchNode.tag;
    if (!window.confirm(`Delete group ${tag}? Symbols in this group will not be deleted.`)) return;

    const nextGroups = mergeWatchGroups((state.config.stock_groups ?? []).filter((group) => group !== tag));
    const affectedStocks = state.stocks.filter((stock) => stock.config.tags.includes(tag));
    for (const stock of affectedStocks) {
      await api.updateStockTags(stock.config.code, stock.config.tags.filter((stockTag) => stockTag !== tag));
    }
    await api.updateStockGroups(nextGroups);
    setSelectedWatchNode(undefined);
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
      setMottoError(error instanceof Error ? error.message : t("error.saveMottoFailed"));
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
    <main className={`workspace ${statusBarVisible ? "" : "hide-status-bar"}`}>
      <header className="title-bar" onDoubleClick={toggleMaximizeFromTitleBar}>
        <nav className="title-menu" aria-label={t("menu.application")}>
          <img className="title-logo" src="./assets/app-icon.svg" alt="" />
          <div className={`title-menu-group ${activeTitleMenu === "file" ? "open" : ""}`}>
            <button className="title-menu-root" aria-haspopup="menu" aria-expanded={activeTitleMenu === "file"} onClick={() => setActiveTitleMenu((menu) => (menu === "file" ? undefined : "file"))}>{t("menu.file")}</button>
            <div className="title-menu-dropdown" role="menu">
              <button role="menuitem" onClick={() => runTitleMenuAction(() => openSearch())}>{t("menu.addSymbol")}</button>
              <button role="menuitem" onClick={() => runTitleMenuAction(() => void api.forceRefresh())}>{t("menu.refresh")}</button>
              <span className="title-menu-separator" />
              <button role="menuitem" onClick={() => runTitleMenuAction(() => void api.openConfigFile())}>{t("menu.openConfig")}</button>
              <button role="menuitem" onClick={() => runTitleMenuAction(() => void api.openConfigDir())}>{t("menu.openConfigFolder")}</button>
              <span className="title-menu-separator" />
              <button role="menuitem" onClick={() => runTitleMenuAction(() => void api.quit())}>{t("menu.quit")}</button>
            </div>
          </div>
          <div className={`title-menu-group ${activeTitleMenu === "view" ? "open" : ""}`}>
            <button className="title-menu-root" aria-haspopup="menu" aria-expanded={activeTitleMenu === "view"} onClick={() => setActiveTitleMenu((menu) => (menu === "view" ? undefined : "view"))}>{t("menu.view")}</button>
            <div className="title-menu-dropdown" role="menu">
              <MenuCheckItem checked={explorerVisible} onClick={() => runTitleMenuAction(() => setExplorerVisible((value) => !value))}>{t("menu.explorer")}</MenuCheckItem>
              <MenuCheckItem checked={editorVisible} onClick={() => runTitleMenuAction(() => setEditorVisible((value) => !value))}>{t("menu.editor")}</MenuCheckItem>
              <MenuCheckItem checked={sideVisible} onClick={() => runTitleMenuAction(() => setSideVisible((value) => !value))}>{t("menu.sidePanel")}</MenuCheckItem>
              <MenuCheckItem checked={statusBarVisible} onClick={() => runTitleMenuAction(() => setStatusBarVisible((value) => !value))}>{t("menu.statusBar")}</MenuCheckItem>
              <span className="title-menu-separator" />
              <button
                role="menuitem"
                onClick={() => runTitleMenuAction(() => {
                  openStockView("details");
                })}
                disabled={!selectedStock}
              >
                {t("menu.details")}
              </button>
              <button
                role="menuitem"
                onClick={() => runTitleMenuAction(() => {
                  openStockView("chart");
                })}
                disabled={!selectedStock}
              >
                {t("menu.chart")}
              </button>
            </div>
          </div>
          <div className={`title-menu-group ${activeTitleMenu === "window" ? "open" : ""}`}>
            <button className="title-menu-root" aria-haspopup="menu" aria-expanded={activeTitleMenu === "window"} onClick={() => setActiveTitleMenu((menu) => (menu === "window" ? undefined : "window"))}>{t("menu.window")}</button>
            <div className="title-menu-dropdown" role="menu">
              <button role="menuitem" onClick={() => runTitleMenuAction(() => void api.toggleFloatWindow())}><span>{t("menu.toggleStockFloat")}</span><kbd>Ctrl+Alt+9</kbd></button>
              <button role="menuitem" onClick={() => runTitleMenuAction(() => void api.toggleWatchFloatWindow())}><span>{t("menu.toggleWatchFloat")}</span><kbd>Ctrl+Alt+0</kbd></button>
              <button role="menuitem" onClick={() => runTitleMenuAction(() => void api.toggleMottoWindow())}>{t("menu.toggleMottoWindow")}</button>
            </div>
          </div>
          <div className={`title-menu-group ${activeTitleMenu === "language" ? "open" : ""}`}>
            <button className="title-menu-root" aria-haspopup="menu" aria-expanded={activeTitleMenu === "language"} onClick={() => setActiveTitleMenu((menu) => (menu === "language" ? undefined : "language"))}>{t("menu.language")}</button>
            <div className="title-menu-dropdown" role="menu">
              <MenuCheckItem checked={locale === "zh-CN"} radio onClick={() => runTitleMenuAction(() => setLocale("zh-CN"))}>{t("language.chinese")}</MenuCheckItem>
              <MenuCheckItem checked={locale === "en-US"} radio onClick={() => runTitleMenuAction(() => setLocale("en-US"))}>{t("language.english")}</MenuCheckItem>
            </div>
          </div>
          <div className={`title-menu-group ${activeTitleMenu === "help" ? "open" : ""}`}>
            <button className="title-menu-root" aria-haspopup="menu" aria-expanded={activeTitleMenu === "help"} onClick={() => setActiveTitleMenu((menu) => (menu === "help" ? undefined : "help"))}>{t("menu.help")}</button>
            <div className="title-menu-dropdown" role="menu">
              <button role="menuitem" onClick={() => runTitleMenuAction(() => { setActivityView("help"); setExplorerVisible(true); setEditorVisible(true); setActiveView("help"); })}>{t("menu.usageGuide")}</button>
              <span className="title-menu-separator" />
              <button role="menuitem" disabled={updateStatus.state === "checking" || updateStatus.state === "downloading"} onClick={() => runTitleMenuAction(() => updateStatus.state === "downloaded" ? void api.installUpdate() : updateStatus.state === "available" ? void api.downloadUpdate() : void api.checkForUpdates())}>{updateStatus.state === "downloaded" ? t("update.restartInstall") : updateStatus.state === "available" ? t("update.download") : updateStatus.state === "checking" ? t("update.checking") : updateStatus.state === "downloading" ? `${t("update.downloading")} ${updateStatus.percent ?? 0}%` : t("update.check")}</button>
              {updateStatus.state === "error" && <button className="update-menu-status" role="menuitem" disabled>{t("update.failed")}{updateStatus.message ? `: ${updateStatus.message}` : ""}</button>}
              {updateStatus.state === "not-available" && <button className="update-menu-status" role="menuitem" disabled>{t("update.latest")}</button>}
              <span className="title-menu-separator" />
              <button role="menuitem" onClick={() => runTitleMenuAction(() => setAboutOpen(true))}>{t("menu.about")}</button>
            </div>
          </div>
        </nav>
        <div className="window-title">FinBox</div>
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
            <button className={`activity-item ${activityView === "watchlist" ? "active" : ""}`} onClick={() => { setActivityView("watchlist"); setExplorerVisible(true); if (activeView === "note" || activeView === "help") setActiveView(detailsOpen ? "details" : chartOpen ? "chart" : undefined); }} aria-label="Explorer"><Files size={24} /></button>
            <button className={`activity-item ${activityView === "news" ? "active" : ""}`} onClick={() => { setActivityView("news"); setExplorerVisible(true); }} aria-label="7x24"><Newspaper size={23} /></button>
            <button className={`activity-item ${activityView === "help" ? "active" : ""}`} onClick={() => { setActivityView("help"); setExplorerVisible(true); setEditorVisible(true); setActiveView("help"); }} aria-label="使用说明" title="使用说明"><BookOpen size={23} /></button>
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
            {activityView !== "watchlist" && <span>{activityView === "news" ? "7X24" : "使用说明"}</span>}
            {activityView === "watchlist" ? (
              <div className="explorer-actions">
                <button onClick={() => openSearch()} title="Add symbol" aria-label="Add symbol"><Plus size={15} /></button>
                <button onClick={() => void createWatchGroup()} title="New stock group" aria-label="New stock group"><Folder size={14} /></button>
                <button onClick={() => void editSelectedWatchNode()} title="Edit selected" aria-label="Edit selected"><Edit3 size={14} /></button>
                <button onClick={() => void deleteSelectedWatchNode()} disabled={!selectedWatchNode} title="Delete selected" aria-label="Delete selected"><Trash2 size={14} /></button>
                <button onClick={() => void api.forceRefresh()} title="Refresh quotes" aria-label="Refresh quotes"><RefreshCw size={14} /></button>
                <button title={t("side.more")} aria-label={t("side.more")}><MoreHorizontal size={15} /></button>
              </div>
            ) : activityView === "news" ? (
              <div className="explorer-actions">
                <button onClick={() => { setMarketNewsPage(1); setMarketNewsReload((value) => value + 1); }} disabled={marketNewsLoading} title="Refresh 7x24" aria-label="Refresh 7x24"><RefreshCw size={14} /></button>
              </div>
            ) : (
              <span />
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
          ) : activityView === "help" ? (
            <HelpOutline />
          ) : (
            <GroupedWatchlist
              stocks={visibleStocks}
              groupNames={state.config.stock_groups}
              groupOrder={state.config.stock_group_order}
              selectedCode={selectedStock?.config.code}
              selectedSelection={selectedWatchNode}
              theme={theme}
              onCreateGroup={() => void createWatchGroup()}
              onAddStockToGroup={(tag) => void addStockToWatchGroup(tag)}
              onMoveStockToGroup={(code, sourceTag, targetTag, copy, sourceOrder, targetOrder) =>
                void moveStockToWatchGroup(code, sourceTag, targetTag, copy, sourceOrder, targetOrder)
              }
              onReorderGroups={(groups) => void api.updateStockGroups(groups)}
              onSelectNode={setSelectedWatchNode}
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
            {activeView === "help" && (
              <button className="editor-tab active">
                <BookOpen size={14} />
                使用说明
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
            <span>{activeView === "help" ? "使用说明" : selectedStock ? selectedStock.config.code : "portfolio"}</span>
          </div>
          <div className="editor-panel">
            {activeView === "help" ? (
              <HelpDocument />
            ) : selectedStock && activeView === "details" ? (
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
            <button onClick={() => void api.openConfigDir()} title={t("side.openConfigFolder")} aria-label={t("side.openConfigFolder")}><FolderOpen size={15} /></button>
            <button onClick={() => void api.toggleFloatWindow()} title={t("side.toggleStockFloat")} aria-label={t("side.toggleStockFloat")}><Maximize2 size={15} /></button>
            <button onClick={() => void api.toggleWatchFloatWindow()} title={t("side.toggleWatchFloat")} aria-label={t("side.toggleWatchFloat")}><Files size={15} /></button>
            <button title={t("side.more")} aria-label={t("side.more")}><MoreHorizontal size={15} /></button>
          </div>
          <div className="codex-content">
            <span className="muted">{t("side.selectedSymbol")}</span>
            <span>{selectedStock ? displayName(selectedStock) : t("side.none")}</span>
            <span className="muted">{t("side.code")}</span>
            <span>{selectedStock?.config.code ?? "--"}</span>
            <button className="tool-button" onClick={() => void api.forceRefresh()}>
              <RefreshCw size={14} />
              {t("side.refresh")}
            </button>
            <button className="tool-button" onClick={() => void api.openConfigFile()}>
              <FileText size={14} />
              {t("side.config")}
            </button>
                        <section className="app-settings">
              <div className="motto-editor-title">
                <span>{t("side.window")}</span>
              </div>
              <label>
                <span>{t("side.closeButton")}</span>
                <select value={state.config.window_close_behavior ?? "tray"} onChange={(event) => updateWindowCloseBehavior(event.target.value as AppConfig["window_close_behavior"])}>
                  <option value="tray">{t("side.minimizeToTray")}</option>
                  <option value="close">{t("side.close")}</option>
                </select>
              </label>
            </section>

            <section className="motto-editor">
              <div className="motto-editor-title">
                <span>{t("side.motto")}</span>
                <button className="icon-tool compact" onClick={() => void api.toggleMottoWindow()} title={t("side.toggleMottoWindow")} aria-label={t("side.toggleMottoWindow")}>
                  <Maximize2 size={14} />
                </button>
              </div>
              <textarea
                value={mottoDraft.text}
                onChange={(event) => updateMottoDraft({ text: event.target.value })}
                placeholder={t("side.mottoPlaceholder")}
              />
              <div className="motto-style-grid">
                <label>
                  <span>{t("side.font")}</span>
                  <input value={mottoDraft.font_family} onChange={(event) => updateMottoDraft({ font_family: event.target.value })} />
                </label>
                <label>
                  <span>{t("side.size")}</span>
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
                  <span>{t("side.color")}</span>
                  <input type="color" value={mottoDraft.color} onChange={(event) => updateMottoDraft({ color: event.target.value })} />
                </label>
              </div>
              <div className="motto-actions">
                {mottoDirty && <span className="edit-state">{t("side.unsavedMotto")}</span>}
                {mottoError && <span className="save-error">{mottoError}</span>}
                <button className="tool-button" onClick={() => setMottoDraft(savedMotto)} disabled={!mottoDirty || mottoSaving}>
                  {t("common.cancel")}
                </button>
                <button className="tool-button accent" onClick={() => void saveMotto()} disabled={!mottoDirty || mottoSaving}>
                  {mottoSaving ? t("common.saving") : t("side.saveMotto")}
                </button>
              </div>
            </section>
          </div>
        </aside>
        )}
      </section>

      {statusBarVisible && <MarketStatusBar state={state} theme={theme} />}

      {searchOpen && (
        <div className="modal-backdrop" onMouseDown={closeSearch}>
          <section className="search-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-title">
              <span>{searchTargetGroup ? `Add Symbol to ${searchTargetGroup}` : "Add Symbol"}</span>
              <button className="icon-tool compact" onClick={closeSearch} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <SearchPane
              query={query}
              results={results}
              onQuery={setQuery}
              onClose={closeSearch}
              onAdd={(stock) => void addStockFromSearch(stock)}
            />
          </section>
        </div>
      )}

      {watchPrompt && (
        <div className="modal-backdrop" onMouseDown={closeWatchPrompt}>
          <form className="search-modal watch-prompt-modal" onSubmit={(event) => void submitWatchPrompt(event)} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-title">
              <span>{watchPrompt.title}</span>
              <button type="button" className="icon-tool compact" onClick={closeWatchPrompt} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <label className="watch-prompt-field">
              <span>{watchPrompt.label}</span>
              <input
                type="text"
                autoFocus
                value={watchPromptValue}
                onChange={(event) => setWatchPromptValue(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") closeWatchPrompt();
                }}
              />
            </label>
            <div className="watch-prompt-actions">
              <button type="button" className="tool-button" onClick={closeWatchPrompt}>Cancel</button>
              <button type="submit" className="tool-button accent">
                <Check size={14} />
                Save
              </button>
            </div>
          </form>
        </div>
      )}
      {aboutOpen && (
        <div className="modal-backdrop" onMouseDown={() => setAboutOpen(false)}>
          <section className="search-modal about-modal" role="dialog" aria-modal="true" aria-labelledby="about-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-title">
              <span id="about-title">{t("about.title")}</span>
              <button className="icon-tool compact" onClick={() => setAboutOpen(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="about-content">
              <strong>FinBox</strong>
              <span>{t("about.version")} {updateStatus.currentVersion || "--"}</span>
              <p>{t("about.description")}</p>
            </div>
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
export function WatchFloatView() {
  const state = useAppState();
  const visibleStocks = useVisibleStocks(state);
  const [selectedCode, setSelectedCode] = useState<string>();
  const [selectedGroup, setSelectedGroup] = useState("");
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const theme = state ? currentTheme(state.config) : undefined;
  const watchGroups = useMemo(() => buildWatchFloatGroups(visibleStocks, state?.config.stock_groups ?? []), [visibleStocks, state?.config.stock_groups]);
  const selectedGroupData = selectedGroup ? watchGroups.find((group) => group.tag === selectedGroup) : undefined;
  const selectedGroupStocks = selectedGroupData?.stocks ?? [];

  useEffect(() => {
    if (!visibleStocks.length) {
      setSelectedCode(undefined);
      return;
    }
    if (!selectedCode || !visibleStocks.some((stock) => stock.config.code === selectedCode)) {
      setSelectedCode(visibleStocks[0].config.code);
    }
  }, [selectedCode, visibleStocks]);

  useEffect(() => {
    if (!watchGroups.length) {
      setSelectedGroup("");
      return;
    }
    if (!selectedGroup || !watchGroups.some((group) => group.tag === selectedGroup)) {
      setSelectedGroup(watchGroups[0].tag);
    }
  }, [selectedGroup, watchGroups]);

  return (
    <main className="watch-float-shell drag-region" style={themeStyle(theme)}>
      <div className={`watch-float-title ${groupPickerOpen ? "open" : "collapsed"}`}>
        {groupPickerOpen && (
          <select
            className="watch-float-select no-drag"
            value={selectedGroup}
            onChange={(event) => setSelectedGroup(event.target.value)}
            aria-label="Watch float group"
          >
            {watchGroups.map((group) => (
              <option value={group.tag} key={group.tag}>{group.tag}</option>
            ))}
          </select>
        )}
        <span className="watch-float-title-right">
          <button
            type="button"
            className="watch-float-collapse no-drag"
            onClick={() => setGroupPickerOpen((open) => !open)}
            aria-label="Toggle group picker"
            title="Toggle group picker"
          >
            <ChevronRight size={11} />
          </button>
          <span className="watch-float-drag-hint" aria-hidden="true" />
        </span>
      </div>
      <div className="watch-float-body no-drag">
        {state ? (
          <WatchFloatStockList
            stocks={selectedGroupStocks}
            selectedCode={selectedCode}
            theme={currentTheme(state.config)}
            onSelect={(stock) => setSelectedCode(stock.config.code)}
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
  onSelect
}: {
  stocks: StockStatus[];
  selectedCode?: string;
  theme: Theme;
  onSelect: (stock: StockStatus) => void;
}) {
  if (!stocks.length) return <div className="watch-float-empty">No symbols</div>;

  return (
    <div className="watch-float-list">
      {stocks.map((stock) => (
        <button
          className={`watch-float-row ${stock.config.code === selectedCode ? "active" : ""}`}
          key={stock.config.code}
          onClick={() => onSelect(stock)}
        >
          <span className="stock-name">{stock.config.alias || stock.market?.name || "--"}</span>
          <SignedMetric value={stockPercent(stock)} digits={2} suffix="" theme={theme} />
        </button>
      ))}
    </div>
  );
}

function buildWatchFloatGroups(stocks: StockStatus[], groupNames: string[]) {
  const groups = new Map<string, StockStatus[]>();
  for (const tag of mergeWatchGroups(groupNames)) {
    groups.set(tag, []);
  }

  for (const stock of stocks) {
    const tags = stock.config.tags.length ? stock.config.tags : ["watchlist"];
    for (const tag of tags) {
      const key = normalizeWatchGroupName(tag) || "watchlist";
      groups.set(key, [...(groups.get(key) ?? []), stock]);
    }
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tag, groupStocks]) => ({ tag, stocks: groupStocks }));
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

function HelpOutline() {
  return (
    <nav className="help-outline" aria-label="使用说明目录">
      <strong>FinBox 使用说明</strong>
      <span>快速开始</span><span>自选股票</span><span>行情详情</span><span>K线与分时</span><span>资讯与浮窗</span><span>界面与设置</span>
    </nav>
  );
}

function HelpDocument() {
  return (
    <article className="help-document">
      <h1>FinBox 功能使用说明</h1>
      <p>FinBox 是一款用于查看股票行情、管理自选分组、记录持仓并快速浏览市场资讯的桌面工具。</p>
      <h2>一、快速开始</h2><p>通过顶部“文件”菜单添加股票或刷新行情。左侧活动栏可切换自选股票、7X24 资讯和使用说明。</p>
      <h2>二、自选股票与分组</h2><p>在左侧自选区域新建分组，并使用“添加股票”将股票加入指定分组。股票可以拖动到其他分组；按住 Ctrl、Alt 或 Shift 拖动时会复制到目标分组。双击股票可打开详情页。</p>
      <h2>三、股票详情与持仓</h2><p>详情页展示最新价、涨跌幅、市值、今日盈亏和累计盈亏。可编辑股票别名、标签及不同账户的持仓数量和成本，修改后请点击保存。</p>
      <h2>四、K线、分时与交易强度</h2><p>在“视图”菜单或详情页打开图表。详情页的“分时”按钮用于查看盘中走势；“交易强度”可展开查看当前成交量、估算成交量和历史排名。</p>
      <h2>五、7X24 资讯</h2><p>点击左侧报纸图标查看实时市场资讯，可翻页或刷新。数据加载失败时会在资讯面板内显示错误，不影响其他功能。</p>
      <h2>六、浮窗功能</h2><p>通过“窗口”菜单打开股票浮窗、自选浮窗或格言窗口。股票浮窗快捷键为 Ctrl+Alt+9，自选浮窗快捷键为 Ctrl+Alt+0。</p>
      <h2>七、界面显示</h2><p>“视图”菜单中的勾选项控制资源管理器、编辑区、侧边栏和状态栏是否显示。勾选表示展示，取消勾选表示隐藏。</p>
      <h2>八、语言与主题</h2><p>顶部“语言”菜单可切换中文和 English。左下角设置按钮可切换颜色主题。</p>
      <h2>九、右侧设置</h2><p>右侧面板可刷新行情、打开配置文件、设置关闭按钮行为，并编辑格言内容、字体、大小和颜色。</p>
      <h2>十、底部状态栏</h2><p>状态栏显示上证指数、今日盈亏、账户盈亏、市值和刷新间隔，还可维护总投资与现金数据。</p>
    </article>
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
  const { t } = useI18n();
  const items = Array.isArray(news?.items) ? news.items.filter((item) => item && typeof item === "object") : [];

  return (
    <div className="market-news-pane">
      <div className="market-news-actions">
        <button className="icon-tool compact" onClick={onPrev} disabled={page <= 1 || loading} title={t("common.previousPage")} aria-label={t("common.previousPage")}>
          <ChevronRight className="reverse-icon" size={14} />
        </button>
        <span>{page}</span>
        <button className="icon-tool compact" onClick={onNext} disabled={loading || news?.hasMore === false} title={t("common.nextPage")} aria-label={t("common.nextPage")}>
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="market-news-list">
        {loading && <div className="news-state">{t("common.loading")}</div>}
        {error && <div className="save-error market-news-error">{error}</div>}
        {!loading && !error && items.length === 0 && <div className="news-state">{t("news.noNews")}</div>}
        {items.map((item) => (
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

function StockDetail({ state, stock, theme, onOpenChart }: { state: AppState; stock?: StockStatus; theme: Theme; onOpenChart: () => void }) {
  const { locale, t } = useI18n();
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
        if (!cancelled) setCommentsError(error instanceof Error ? error.message : t("error.loadCommentsFailed"));
      })
      .finally(() => {
        if (!cancelled) setCommentsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [stock?.config.code, commentsOpen, commentsPage]);


  if (!stock) return <div className="empty-state">{t("detail.selectSymbol")}</div>;

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
        throw new Error(t("error.tagEditorUnavailable"));
      }
      await api.updateStockTags(stock.config.code, tagDraft);
      setTagDirty(false);
    } catch (error) {
      setTagError(error instanceof Error ? error.message : t("error.saveTagsFailed"));
    } finally {
      setTagSaving(false);
    }
  };
  const savePositions = async () => {
    setSaving(true);
    setSaveError("");
    try {
      if (typeof api.updateStockPositions !== "function") {
        throw new Error(t("error.positionEditorUnavailable"));
      }
      await api.updateStockPositions(stock.config.code, draft);
      setDirty(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t("error.savePositionsFailed"));
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
        throw new Error(t("error.aliasEditorUnavailable"));
      }
      await api.updateStockAlias(stock.config.code, nextAlias || undefined);
      setAliasEditing(false);
    } catch (error) {
      setAliasError(error instanceof Error ? error.message : t("error.saveAliasFailed"));
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
            <button className="icon-tool compact" onClick={() => void saveAlias()} disabled={aliasSaving} title={t("detail.saveAlias")} aria-label={t("detail.saveAlias")}>
              <Save size={13} />
            </button>
            <button className="icon-tool compact" onClick={resetAlias} disabled={aliasSaving} title={t("detail.cancelAliasEdit")} aria-label={t("detail.cancelAliasEdit")}>
              <X size={13} />
            </button>
          </span>
        ) : (
          <span className="detail-heading">
            <span>{displayName(stock)}</span>
            <button className="icon-tool compact" onClick={() => { setAliasDraft(stock.config.alias ?? ""); setAliasEditing(true); }} disabled={aliasSaving} title={t("detail.editAlias")} aria-label={t("detail.editAlias")}>
              <Edit3 size={13} />
            </button>
          </span>
        )}
        <div className="detail-actions">
          <button className="tool-button" onClick={() => setMinuteOpen((value) => !value)} title={t("detail.toggleMinuteChart")} aria-label={t("detail.toggleMinuteChart")}>
            <RefreshCw size={14} />
            {t(minuteOpen ? "detail.closeMinute" : "detail.minute")}
          </button>
          <button className="tool-button" onClick={onOpenChart} title={t("detail.openChart")} aria-label={t("detail.openChart")}>
            <Maximize2 size={15} />
            {t("menu.chart")}
          </button>
        </div>
      </div>
      {aliasError && <div className="save-error alias-error">{aliasError}</div>}
      <div className="detail-table" aria-label={t("detail.quoteTable")}>
        <DetailItem label={t("detail.lastPrice")} value={formatMaybe(price, 2)} color={profitColor(theme, percent ?? 0)} strong />
        <DetailItem label={t("detail.change")} value={formatOptionalSigned(priceChange, 2)} color={priceChange === undefined ? undefined : profitColor(theme, priceChange)} />
        <DetailItem label={t("detail.changePercent")} value={formatOptionalSigned(percent, 2, "%")} color={percent === undefined ? undefined : profitColor(theme, percent)} />
        <DetailItem label={t("detail.open")} value={formatMaybe(stock.market?.open, 2)} />
        <DetailItem label={t("detail.high")} value={formatMaybe(stock.market?.high, 2)} />
        <DetailItem label={t("detail.low")} value={formatMaybe(stock.market?.low, 2)} />
        <DetailItem label={t("detail.prevClose")} value={formatMaybe(stock.market?.prev_close, 2)} />
        <DetailItem label={t("detail.shares")} value={`${totalShares(stock) || "--"}`} />
        <DetailItem label={t("detail.marketValue")} value={formatMaybe(marketValue(stock), 0)} />
        <DetailItem label={t("detail.dayProfitLoss")} value={formatOptionalSigned(dayProfit(stock), 0)} color={profitColor(theme, dayProfit(stock))} />
        <DetailItem label={t("detail.totalProfitLoss")} value={formatOptionalSigned(totalProfit(stock), 0)} color={profitColor(theme, totalProfit(stock) ?? 0)} />
        <DetailItem label={t("detail.returnRate")} value={formatOptionalSigned(totalProfitPoints(stock), 2, "%")} color={profitColor(theme, totalProfitPoints(stock) ?? 0)} />
        <DetailItem label={t("detail.quoteTime")} value={stock.market?.time || "--"} />
        <DetailItem label={t("detail.updated")} value={state.last_market_update ? new Date(state.last_market_update).toLocaleTimeString(locale) : "--"} />
      </div>
      <TradingIntensityPanel stock={stock} theme={theme} />
      {minuteOpen && <MinutePanel stock={stock} theme={theme} onClose={() => setMinuteOpen(false)} />}
      <section className="tags-editor">
        <div className="tags-title">
          <span>{t("detail.tags")}</span>
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
              {t("common.add")}
            </button>
          </div>
        </div>
        <div className="tag-list">
          {tagDraft.length === 0 ? (
            <span className="muted">{t("detail.noTags")}</span>
          ) : (
            tagDraft.map((tag) => (
              <button className="tag-chip" key={tag} onClick={() => removeTag(tag)} title={t("detail.removeTag")}>
                <Tag size={13} />
                <span>{tag}</span>
                <X size={13} />
              </button>
            ))
          )}
        </div>
        <div className="tags-actions">
          {tagDirty && <span className="edit-state">{t("detail.unsavedTagChanges")}</span>}
          {tagError && <span className="save-error">{tagError}</span>}
          <button className="tool-button" onClick={resetTags} disabled={!tagDirty || tagSaving}>
            {t("common.cancel")}
          </button>
          <button className="tool-button accent" onClick={() => void saveTags()} disabled={!tagDirty || tagSaving}>
            {t(tagSaving ? "common.saving" : "detail.saveTags")}
          </button>
        </div>
      </section>
      <section className="positions-editor">
        <div className="positions-title">
          <span>{t("detail.positions")}</span>
          <button className="tool-button" onClick={addPosition}>
            <Plus size={14} />
            {t("detail.row")}
          </button>
        </div>
        <div className="positions-grid">
          <span>{t("detail.account")}</span>
          <span>{t("detail.shares")}</span>
          <span>{t("detail.cost")}</span>
          <span />
          {draft.length === 0 ? (
            <div className="positions-empty">{t("detail.noPositions")}</div>
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
                <button className="icon-tool compact" onClick={() => removePosition(index)} aria-label={t("detail.removePosition")}>
                  <X size={14} />
                </button>
              </div>
            ))
          )}
        </div>
        <div className="positions-actions">
          {dirty && <span className="edit-state">{t("detail.unsavedPositionChanges")}</span>}
          {saveError && <span className="save-error">{saveError}</span>}
          <button className="tool-button" onClick={resetPositions} disabled={!dirty || saving}>
            {t("common.cancel")}
          </button>
          <button className="tool-button accent" onClick={() => void savePositions()} disabled={!dirty || saving}>
            {t(saving ? "common.saving" : "detail.savePositions")}
          </button>
        </div>
      </section>
      <section className="comments-panel">
        <div className="news-title">
          <span>{t("detail.discussions")}</span>
          {!commentsOpen ? (
            <button className="tool-button" onClick={openComments}>
              <MessageSquare size={14} />
              {t("common.load")}
            </button>
          ) : (
            <div className="news-actions">
              <button className="icon-tool compact" onClick={() => setCommentsPage((page) => Math.max(1, page - 1))} disabled={commentsPage <= 1 || commentsLoading} title={t("common.previousPage")} aria-label={t("common.previousPage")}>
                <ChevronRight className="reverse-icon" size={14} />
              </button>
              <span>{commentsPage}</span>
              <button className="icon-tool compact" onClick={() => setCommentsPage((page) => page + 1)} disabled={commentsLoading || comments?.hasMore === false} title={t("common.nextPage")} aria-label={t("common.nextPage")}>
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
        {!commentsOpen ? (
          <div className="news-placeholder">{t("detail.loadDiscussionsHint")}</div>
        ) : (
          <div className="comments-list">
            {commentsLoading && <div className="news-state">{t("common.loading")}</div>}
            {commentsError && <div className="save-error comments-error">{commentsError}</div>}
            {!commentsLoading && !commentsError && comments?.items.length === 0 && <div className="news-state">{t("detail.noComments")}</div>}
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

