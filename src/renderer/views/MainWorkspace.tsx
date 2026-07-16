import { useEffect, useMemo, useRef, useState } from "react";
import { Input, Tag as AntTag, Tree } from "antd";
import type { TreeDataNode } from "antd";
import {
  Blocks,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Files,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  GripVertical,
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
import type { CSSProperties, DragEvent as ReactDragEvent, FormEvent, Key, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
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
import type { AppConfig, AppState, MottoConfig, NoteTreeItem, Position, StockCommentItem, StockCommentPage, StockJournal, StockNewsPage, StockSearchResult, StockStatus, Theme, UpdateStatus, WatchFloatColumn, WatchFloatConfig } from "../../shared/types";
import { KLineView } from "../components/KLineView";
import { MarketStatusBar } from "../components/MarketStatusBar";
import { MinutePanel } from "../components/MinutePanel";
import { SearchPane } from "../components/SearchPane";
import { TradingIntensityPanel } from "../components/TradingIntensityPanel";
import { GroupedWatchlist, mergeWatchGroups, normalizeWatchGroupName } from "../components/WatchTree";
import type { WatchTreeSelection } from "../components/WatchTree";
import { formatMaybe, formatSigned, stockPercent } from "../utils";
import { useI18n } from "../i18n";

const api = window.finBox;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const DEFAULT_TRADING_REFRESH_INTERVAL_MS = 1000;
const MIN_TRADING_REFRESH_INTERVAL_MS = 500;
const MAX_TRADING_REFRESH_INTERVAL_MS = 10000;
const STOCK_NOTES_SPLIT_STORAGE_KEY = "fin-box.stockNotesSplit";
const watchFloatColumnOptions: Array<{ value: WatchFloatColumn; label: string }> = [
  { value: "name", label: "名称" },
  { value: "price", label: "股价" },
  { value: "change", label: "涨幅" },
  { value: "day_profit", label: "今日收益" }
];
const watchFloatFlatColorOptions: Array<{ value: "name" | "price"; label: string }> = [
  { value: "name", label: "名称" },
  { value: "price", label: "股价" }
];
const watchFloatMetricColorOptions: Array<{ value: "change" | "day_profit"; label: string }> = [
  { value: "change", label: "涨幅" },
  { value: "day_profit", label: "今日收益" }
];
type ActivityView = "watchlist" | "news" | "notes" | "help" | "settings";
type ActiveView = "details" | "chart" | "note" | "help" | "settings";
type StockView = "details" | "chart";
type TitleMenu = "file" | "view" | "window" | "language" | "help";
type SettingsView = "general" | "market-refresh" | "motto" | "watch-float" | "camouflage-float";
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
const settingsNavItems: Array<{ value: SettingsView; labelKey: `settings.${"general" | "marketRefresh" | "mottoFloat" | "watchlistFloat" | "camouflageFloat"}` }> = [
  { value: "general", labelKey: "settings.general" },
  { value: "market-refresh", labelKey: "settings.marketRefresh" },
  { value: "motto", labelKey: "settings.mottoFloat" },
  { value: "watch-float", labelKey: "settings.watchlistFloat" },
  { value: "camouflage-float", labelKey: "settings.camouflageFloat" }
];
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

function formatLocalDate(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseLocalDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function monthStart(value: string) {
  const date = parseLocalDate(value);
  return new Date(date.getFullYear(), date.getMonth(), 1);
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
  const [aboutOpen, setAboutOpen] = useState(false);
  const [themeError, setThemeError] = useState("");
  const [explorerWidth, setExplorerWidth] = useState(332);
  const [sideWidth, setSideWidth] = useState(420);
  const [activityView, setActivityView] = useState<ActivityView>("watchlist");
  const [settingsView, setSettingsView] = useState<SettingsView>("general");
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
  const [stockJournal, setStockJournal] = useState<StockJournal>();
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalSaving, setJournalSaving] = useState(false);
  const [journalError, setJournalError] = useState("");
  const [strategyDraft, setStrategyDraft] = useState("");
  const [savedStrategy, setSavedStrategy] = useState("");
  const [dailyNoteDate, setDailyNoteDate] = useState(() => formatLocalDate(new Date()));
  const [dailyNoteDraft, setDailyNoteDraft] = useState("");
  const [savedDailyNote, setSavedDailyNote] = useState("");
  const selectedStock = visibleStocks.find((stock) => stock.config.code === selectedCode) ?? visibleStocks[0];
  const detailStockCode = activeView === "details" && selectedStock ? selectedStock.config.code : "";

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

  useEffect(() => api.onOpenWatchlistFloatSettings(() => {
    setActivityView("settings");
    setSettingsView("watch-float");
    setExplorerVisible(true);
    setEditorVisible(true);
    setActiveView("settings");
  }), []);

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
    let cancelled = false;
    if (!detailStockCode) {
      setStockJournal(undefined);
      setStrategyDraft("");
      setSavedStrategy("");
      setDailyNoteDraft("");
      setSavedDailyNote("");
      setJournalError("");
      setJournalLoading(false);
      return;
    }

    setJournalLoading(true);
    setJournalError("");
    void api.getStockJournal(detailStockCode)
      .then((journal) => {
        if (!cancelled) setStockJournal(journal);
      })
      .catch((error) => {
        if (!cancelled) setJournalError(error instanceof Error ? error.message : "Failed to load stock notes.");
      })
      .finally(() => {
        if (!cancelled) setJournalLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [detailStockCode]);

  useEffect(() => {
    const strategy = stockJournal?.notes.find((note) => !note.date)?.content ?? "";
    setSavedStrategy(strategy);
    setStrategyDraft(strategy);
  }, [stockJournal?.code, stockJournal?.updatedAt]);

  useEffect(() => {
    const daily = stockJournal?.notes.find((note) => note.date === dailyNoteDate)?.content ?? "";
    setSavedDailyNote(daily);
    setDailyNoteDraft(daily);
  }, [stockJournal?.code, stockJournal?.updatedAt, dailyNoteDate]);

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

  const updateWatchFloatConfig = (patch: Partial<WatchFloatConfig>) => {
    if (!state) return;
    void api.updateWatchFloatConfig({
      stock_codes: patch.stock_codes ?? state.config.watch_float.stock_codes,
      columns: patch.columns ?? state.config.watch_float.columns,
      layout: patch.layout ?? state.config.watch_float.layout,
      style: patch.style ?? state.config.watch_float.style,
      active_profile: patch.active_profile ?? state.config.watch_float.active_profile,
      profiles: patch.profiles ?? state.config.watch_float.profiles
    });
  };

  const updateTradingRefreshInterval = (intervalMs: number) => {
    void api.updateTradingRefreshInterval(intervalMs);
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

  const saveStrategyNote = async () => {
    if (!detailStockCode) return;
    setJournalSaving(true);
    setJournalError("");
    try {
      const journal = await api.saveStockJournalNote(detailStockCode, {
        id: "strategy",
        content: strategyDraft
      });
      setStockJournal(journal);
      setSavedStrategy(strategyDraft.trim());
    } catch (error) {
      setJournalError(error instanceof Error ? error.message : "Failed to save stock note.");
    } finally {
      setJournalSaving(false);
    }
  };

  const saveDailyStockNote = async () => {
    if (!detailStockCode) return;
    setJournalSaving(true);
    setJournalError("");
    try {
      const journal = await api.saveStockJournalNote(detailStockCode, {
        id: `daily-${dailyNoteDate}`,
        date: dailyNoteDate,
        content: dailyNoteDraft
      });
      setStockJournal(journal);
      setSavedDailyNote(dailyNoteDraft.trim());
    } catch (error) {
      setJournalError(error instanceof Error ? error.message : "Failed to save daily note.");
    } finally {
      setJournalSaving(false);
    }
  };

  const toggleActivityPane = (view: ActivityView) => {
    if (activityView === view && explorerVisible) {
      setExplorerVisible(false);
      return;
    }

    setActivityView(view);
    setExplorerVisible(true);
    if (view === "help") {
      setEditorVisible(true);
      setActiveView("help");
      return;
    }
    if (view === "settings") {
      setEditorVisible(true);
      setActiveView("settings");
      return;
    }
    if (view === "watchlist" && (activeView === "note" || activeView === "help" || activeView === "settings")) {
      setActiveView(detailsOpen ? "details" : chartOpen ? "chart" : undefined);
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
              <button role="menuitem" onClick={() => runTitleMenuAction(() => void api.openNotesDir())}>{t("menu.openNotesFolder")}</button>
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
              <button role="menuitem" onClick={() => runTitleMenuAction(() => void api.toggleCamouflageFloatWindow())}><span>{t("menu.toggleCamouflageFloat")}</span><kbd>Ctrl+Alt+9</kbd></button>
              <button role="menuitem" onClick={() => runTitleMenuAction(() => void api.toggleWatchlistFloatWindow())}><span>{t("menu.toggleWatchlistFloat")}</span><kbd>Ctrl+Alt+0</kbd></button>
              <button role="menuitem" onClick={() => runTitleMenuAction(() => void api.toggleMottoFloatWindow())}>{t("menu.toggleMottoFloat")}</button>
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
          <button className={sideVisible ? "active" : ""} onClick={() => setSideVisible((value) => !value)} aria-label={t("menu.sidePanel")}><PanelRight size={16} /></button>
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
            <button className={`activity-item ${activityView === "watchlist" ? "active" : ""}`} onClick={() => toggleActivityPane("watchlist")} aria-label="Explorer"><Files size={24} /></button>
            <button className={`activity-item ${activityView === "news" ? "active" : ""}`} onClick={() => toggleActivityPane("news")} aria-label="7x24"><Newspaper size={23} /></button>
            <button className={`activity-item ${activityView === "help" ? "active" : ""}`} onClick={() => toggleActivityPane("help")} aria-label="使用说明" title="使用说明"><BookOpen size={23} /></button>
            <button className="activity-item" aria-label="Source Control"><GitBranch size={23} /><span className="activity-badge">{visibleStocks.length}</span></button>
            <button className="activity-item" aria-label="Extensions"><Blocks size={23} /></button>
          </div>
          <div className="activity-bottom">
            <button className="activity-item" aria-label="Accounts"><UserCircle size={24} /></button>
            <button className={`activity-item ${activityView === "settings" ? "active" : ""}`} onClick={() => toggleActivityPane("settings")} aria-label="Settings"><Settings size={23} /></button>
          </div>
        </aside>

        {explorerVisible && (
        <aside className="explorer-panel">
          <div className="explorer-header">
            {activityView !== "watchlist" && <span>{activityView === "news" ? "7X24" : activityView === "settings" ? "设置" : "使用说明"}</span>}
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
            ) : activityView === "settings" ? (
              <span />
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
          ) : activityView === "settings" ? (
            <SettingsOutline active={settingsView} onSelect={(view) => { setSettingsView(view); setEditorVisible(true); setActiveView("settings"); }} />
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
            {activeView === "settings" && (
              <button className="editor-tab active">
                <Settings size={14} />
                {settingsViewLabel(settingsView, t)}
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
            <span>{activeView === "help" ? "使用说明" : activeView === "settings" ? settingsViewLabel(settingsView, t) : selectedStock ? selectedStock.config.code : "portfolio"}</span>
          </div>
          <div className="editor-panel">
            {activeView === "help" ? (
              <HelpDocument />
            ) : activeView === "settings" ? (
              <SettingsPage
                view={settingsView}
                state={state}
                mottoDraft={mottoDraft}
                savedMotto={savedMotto}
                mottoDirty={mottoDirty}
                mottoSaving={mottoSaving}
                mottoError={mottoError}
                themeError={themeError}
                onWindowCloseBehaviorChange={updateWindowCloseBehavior}
                onWatchFloatConfigChange={updateWatchFloatConfig}
                onTradingRefreshIntervalChange={updateTradingRefreshInterval}
                onThemeSelect={(themeName) => void selectTheme(themeName)}
                onOpenConfigFile={() => void api.openConfigFile()}
                onOpenConfigDir={() => void api.openConfigDir()}
                onToggleFloatWindow={() => void api.toggleCamouflageFloatWindow()}
                onToggleWatchlistWindow={() => void api.toggleWatchlistFloatWindow()}
                onToggleMottoWindow={() => void api.toggleMottoFloatWindow()}
                onMottoDraftChange={updateMottoDraft}
                onCancelMotto={() => setMottoDraft(savedMotto)}
                onSaveMotto={() => void saveMotto()}
              />
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
          <StockNotesPanelView
            stock={activeView === "details" ? selectedStock : undefined}
            journal={stockJournal}
            loading={journalLoading}
            saving={journalSaving}
            error={journalError}
            strategyDraft={strategyDraft}
            savedStrategy={savedStrategy}
            dailyDate={dailyNoteDate}
            dailyDraft={dailyNoteDraft}
            savedDaily={savedDailyNote}
            onStrategyChange={setStrategyDraft}
            onDailyDateChange={setDailyNoteDate}
            onDailyChange={setDailyNoteDraft}
            onSaveStrategy={() => void saveStrategyNote()}
            onSaveDaily={() => void saveDailyStockNote()}
          />
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

function HelpOutline() {
  return (
    <nav className="help-outline" aria-label="使用说明目录">
      <strong>FinBox 使用说明</strong>
      <span>快速开始</span><span>自选股票</span><span>行情详情</span><span>K线与分时</span><span>资讯与浮窗</span><span>界面与设置</span>
    </nav>
  );
}

function StockNotesPanelView({
  stock,
  journal,
  loading,
  saving,
  error,
  strategyDraft,
  savedStrategy,
  dailyDate,
  dailyDraft,
  savedDaily,
  onStrategyChange,
  onDailyDateChange,
  onDailyChange,
  onSaveStrategy,
  onSaveDaily
}: {
  stock?: StockStatus;
  journal?: StockJournal;
  loading: boolean;
  saving: boolean;
  error: string;
  strategyDraft: string;
  savedStrategy: string;
  dailyDate: string;
  dailyDraft: string;
  savedDaily: string;
  onStrategyChange: (value: string) => void;
  onDailyDateChange: (value: string) => void;
  onDailyChange: (value: string) => void;
  onSaveStrategy: () => void;
  onSaveDaily: () => void;
}) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const [splitRatio, setSplitRatio] = useState(() => {
    const saved = Number(window.localStorage.getItem(STOCK_NOTES_SPLIT_STORAGE_KEY));
    return Number.isFinite(saved) ? clamp(saved, 0.25, 0.75) : 0.46;
  });
  const notedDates = useMemo(() => new Set((journal?.notes ?? []).map((note) => note.date).filter((date): date is string => Boolean(date))), [journal]);
  const strategyDirty = strategyDraft.trim() !== savedStrategy.trim();
  const dailyDirty = dailyDraft.trim() !== savedDaily.trim();
  const onNoteKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>, dirty: boolean, save: () => void) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
    event.preventDefault();
    if (!saving && dirty) save();
  };

  useEffect(() => {
    window.localStorage.setItem(STOCK_NOTES_SPLIT_STORAGE_KEY, splitRatio.toFixed(3));
  }, [splitRatio]);

  const startPanelResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const panel = panelRef.current;
    if (!panel) return;

    const resize = (clientY: number) => {
      const panelRect = panel.getBoundingClientRect();
      const headerHeight = headerRef.current?.getBoundingClientRect().height ?? 0;
      const errorHeight = errorRef.current?.getBoundingClientRect().height ?? 0;
      const splitterHeight = 6;
      const available = panelRect.height - headerHeight - errorHeight - splitterHeight;
      if (available <= 0) return;
      const next = (clientY - panelRect.top - headerHeight - errorHeight) / available;
      setSplitRatio(clamp(next, 0.25, 0.75));
    };

    const onMouseMove = (moveEvent: MouseEvent) => resize(moveEvent.clientY);
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    resize(event.clientY);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  if (!stock) {
    return (
      <div className="stock-notes-empty">
        <strong>{t("stockNotes.title")}</strong>
        <span>{t("stockNotes.empty")}</span>
      </div>
    );
  }

  return (
    <div
      className="stock-notes-panel"
      ref={panelRef}
      style={{ "--strategy-note-size": `${splitRatio}fr`, "--daily-note-size": `${1 - splitRatio}fr` } as CSSProperties}
    >
      <header className="stock-notes-header" ref={headerRef}>
        <div>
          <strong>{t("stockNotes.title")}</strong>
          <span>{displayName(stock)} · {stock.config.code}</span>
        </div>
        {loading && <small>{t("common.loading")}</small>}
      </header>

      {error && <div className="save-error stock-notes-error" ref={errorRef}>{error}</div>}

      <section className="stock-note-section strategy-note-section">
        <div className="stock-note-title">
          <span>{t("stockNotes.strategy")}</span>
          {strategyDirty && <small>{t("stockNotes.unsaved")} · {t("stockNotes.saveShortcut")}</small>}
          <button className="tool-button compact-text" onClick={onSaveStrategy} disabled={saving || !strategyDirty}>
            <Save size={13} />
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
        <textarea
          value={strategyDraft}
          onChange={(event) => onStrategyChange(event.target.value)}
          onKeyDown={(event) => onNoteKeyDown(event, strategyDirty, onSaveStrategy)}
          placeholder={t("stockNotes.strategyPlaceholder")}
        />
      </section>

      <div className="stock-note-splitter" onMouseDown={startPanelResize} role="separator" aria-orientation="horizontal" aria-label={t("stockNotes.resizePanels")} />

      <section className="stock-note-section daily-note-section">
        <div className="stock-note-title">
          <span>{t("stockNotes.daily")}</span>
          {dailyDirty && <small>{t("stockNotes.unsaved")} · {t("stockNotes.saveShortcut")}</small>}
          <button className="tool-button compact-text" onClick={onSaveDaily} disabled={saving || !dailyDirty}>
            <Save size={13} />
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
        <StockNoteCalendarView value={dailyDate} notedDates={notedDates} onChange={onDailyDateChange} />
        <textarea
          value={dailyDraft}
          onChange={(event) => onDailyChange(event.target.value)}
          onKeyDown={(event) => onNoteKeyDown(event, dailyDirty, onSaveDaily)}
          placeholder={`${dailyDate} ${t("stockNotes.dailyPlaceholder")}`}
        />
      </section>
    </div>
  );
}

function StockNoteCalendarView({ value, notedDates, onChange }: { value: string; notedDates: Set<string>; onChange: (value: string) => void }) {
  const { t } = useI18n();
  const shiftDay = (offset: number) => {
    const date = parseLocalDate(value);
    date.setDate(date.getDate() + offset);
    onChange(formatLocalDate(date));
  };

  return (
    <div className="stock-note-calendar">
      <button className="icon-tool compact" onClick={() => shiftDay(-1)} aria-label={t("stockNotes.previousDay")} title={t("stockNotes.previousDay")}>
        <ChevronLeft size={14} />
      </button>
      <label className={`stock-note-date-field ${notedDates.has(value) ? "has-note" : ""}`}>
        <input type="date" value={value} onChange={(event) => onChange(event.target.value || value)} />
      </label>
      <button className="icon-tool compact" onClick={() => shiftDay(1)} aria-label={t("stockNotes.nextDay")} title={t("stockNotes.nextDay")}>
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

function StockNotesPanel({
  stock,
  journal,
  loading,
  saving,
  error,
  strategyDraft,
  savedStrategy,
  dailyDate,
  dailyDraft,
  savedDaily,
  onStrategyChange,
  onDailyDateChange,
  onDailyChange,
  onSaveStrategy,
  onSaveDaily
}: {
  stock?: StockStatus;
  journal?: StockJournal;
  loading: boolean;
  saving: boolean;
  error: string;
  strategyDraft: string;
  savedStrategy: string;
  dailyDate: string;
  dailyDraft: string;
  savedDaily: string;
  onStrategyChange: (value: string) => void;
  onDailyDateChange: (value: string) => void;
  onDailyChange: (value: string) => void;
  onSaveStrategy: () => void;
  onSaveDaily: () => void;
}) {
  const { t } = useI18n();
  const notedDates = useMemo(() => new Set((journal?.notes ?? []).map((note) => note.date).filter((date): date is string => Boolean(date))), [journal]);
  const strategyDirty = strategyDraft.trim() !== savedStrategy.trim();
  const dailyDirty = dailyDraft.trim() !== savedDaily.trim();

  if (!stock) {
    return (
      <div className="stock-notes-empty">
        <strong>股票笔记</strong>
        <span>打开某只股票的详情页后，在这里记录策略和每日复盘。</span>
      </div>
    );
  }

  return (
    <div className="stock-notes-panel">
      <header className="stock-notes-header">
        <div>
          <strong>{displayName(stock)}</strong>
          <span>{stock.config.code}</span>
        </div>
        {loading && <small>加载中...</small>}
      </header>

      {error && <div className="save-error stock-notes-error">{error}</div>}

      <section className="stock-note-section strategy-note-section">
        <div className="stock-note-title">
          <span>策略笔记</span>
          <button className="tool-button compact-text" onClick={onSaveStrategy} disabled={saving || !strategyDirty}>
            <Save size={13} />
            保存
          </button>
        </div>
        <textarea
          value={strategyDraft}
          onChange={(event) => onStrategyChange(event.target.value)}
          placeholder="记录这只股票的操作策略、买卖条件、仓位计划。"
        />
      </section>

      <section className="stock-note-section daily-note-section">
        <div className="stock-note-title">
          <span>每日笔记</span>
          <button className="tool-button compact-text" onClick={onSaveDaily} disabled={saving || !dailyDirty}>
            <Save size={13} />
            保存
          </button>
        </div>
        <StockNoteCalendar value={dailyDate} notedDates={notedDates} onChange={onDailyDateChange} />
        <textarea
          value={dailyDraft}
          onChange={(event) => onDailyChange(event.target.value)}
          placeholder={`${dailyDate} 的观察、盘中变化、复盘结论。`}
        />
      </section>
    </div>
  );
}

function StockNoteCalendar({ value, notedDates, onChange }: { value: string; notedDates: Set<string>; onChange: (value: string) => void }) {
  const [viewMonth, setViewMonth] = useState(() => monthStart(value));

  useEffect(() => {
    setViewMonth(monthStart(value));
  }, [value]);

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: firstDay + daysInMonth }, (_, index) => (index < firstDay ? 0 : index - firstDay + 1));
  const changeMonth = (offset: number) => setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));

  return (
    <div className="stock-note-calendar">
      <div className="stock-note-calendar-head">
        <button className="icon-tool compact" onClick={() => changeMonth(-1)} aria-label="上个月" title="上个月">
          <ChevronLeft size={14} />
        </button>
        <strong>{year}-{`${month + 1}`.padStart(2, "0")}</strong>
        <button className="icon-tool compact" onClick={() => changeMonth(1)} aria-label="下个月" title="下个月">
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="stock-note-weekdays">
        <span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>
      </div>
      <div className="stock-note-days">
        {cells.map((day, index) => {
          if (!day) return <span className="stock-note-day empty" key={`empty-${index}`} />;
          const date = formatLocalDate(new Date(year, month, day));
          return (
            <button
              className={`stock-note-day ${date === value ? "active" : ""} ${notedDates.has(date) ? "has-note" : ""}`}
              key={date}
              onClick={() => onChange(date)}
            >
              <span>{day}</span>
            </button>
          );
        })}
      </div>
    </div>
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
      <h2>六、浮窗功能</h2><p>通过“窗口”菜单打开伪装浮窗、自选浮窗或座右铭浮窗。伪装浮窗快捷键为 Ctrl+Alt+9，自选浮窗快捷键为 Ctrl+Alt+0。</p>
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

function SettingsOutline({ active, onSelect }: { active: SettingsView; onSelect: (view: SettingsView) => void }) {
  const { t } = useI18n();
  return (
    <nav className="settings-outline" aria-label="Settings sections">
      {settingsNavItems.map((item) => (
        <button
          type="button"
          className={`settings-outline-item ${active === item.value ? "active" : ""}`}
          onClick={() => onSelect(item.value)}
          key={item.value}
        >
          <Settings size={14} />
          <span>{t(item.labelKey)}</span>
        </button>
      ))}
    </nav>
  );
}

function settingsViewLabel(view: SettingsView, t: (key: `settings.${"title" | "general" | "marketRefresh" | "mottoFloat" | "watchlistFloat" | "camouflageFloat"}`) => string): string {
  const key = settingsNavItems.find((item) => item.value === view)?.labelKey;
  return key ? t(key) : t("settings.title");
}

function settingsViewDescription(view: SettingsView, t: (key: `settings.${"generalDescription" | "marketRefreshDescription" | "mottoDescription" | "watchlistDescription" | "camouflageDescription"}`) => string): string {
  if (view === "general") return t("settings.generalDescription");
  if (view === "market-refresh") return t("settings.marketRefreshDescription");
  if (view === "motto") return t("settings.mottoDescription");
  if (view === "watch-float") return t("settings.watchlistDescription");
  return t("settings.camouflageDescription");
}

const WATCH_FLOAT_STOCK_KEY_PREFIX = "watch-float-stock:";
const WATCH_FLOAT_GROUP_KEY_PREFIX = "watch-float-group:";
const builtInWatchFloatProfileNames = new Set(["simple", "sublime", "赛博朋克"]);

function watchFloatStockKey(code: string) {
  return `${WATCH_FLOAT_STOCK_KEY_PREFIX}${code}`;
}

function parseWatchFloatStockKey(key: Key) {
  const value = String(key);
  return value.startsWith(WATCH_FLOAT_STOCK_KEY_PREFIX) ? value.slice(WATCH_FLOAT_STOCK_KEY_PREFIX.length) : undefined;
}

function buildWatchFloatTree(stocks: StockStatus[], groupNames: string[], search: string): { treeData: TreeDataNode[]; expandedKeys: Key[] } {
  const query = search.trim().toLowerCase();
  const groups = new Map<string, StockStatus[]>();
  const ensureGroup = (tag: string) => {
    const key = normalizeWatchGroupName(tag) || "watchlist";
    if (!groups.has(key)) groups.set(key, []);
    return key;
  };

  for (const tag of mergeWatchGroups(groupNames)) ensureGroup(tag);
  for (const stock of stocks) {
    const tag = stock.config.tags.find((item) => item.trim()) ?? "watchlist";
    const groupKey = ensureGroup(tag);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), stock]);
  }

  const expandedKeys: Key[] = [];
  const treeData = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map<TreeDataNode | undefined>(([tag, groupStocks]) => {
      const groupMatches = !query || tag.toLowerCase().includes(query);
      const children = groupStocks
        .filter((stock) => {
          if (groupMatches) return true;
          return displayName(stock).toLowerCase().includes(query) || stock.config.code.toLowerCase().includes(query);
        })
        .map<TreeDataNode>((stock) => ({
          key: watchFloatStockKey(stock.config.code),
          title: (
            <span className="watch-float-tree-stock">
              <span>{displayName(stock)}</span>
              <small>{stock.config.code}</small>
            </span>
          ),
          isLeaf: true
        }));

      if (query && children.length) expandedKeys.push(`${WATCH_FLOAT_GROUP_KEY_PREFIX}${tag}`);
      if (!groupMatches && !children.length) return undefined;

      return {
        key: `${WATCH_FLOAT_GROUP_KEY_PREFIX}${tag}`,
        title: tag,
        children
      };
    })
    .filter((node): node is TreeDataNode => Boolean(node));

  return { treeData, expandedKeys };
}

function orderedWatchFloatColumns(columns: WatchFloatColumn[]) {
  const configured = columns
    .map((column) => watchFloatColumnOptions.find((option) => option.value === column))
    .filter((option): option is { value: WatchFloatColumn; label: string } => Boolean(option));
  const configuredValues = new Set(configured.map((option) => option.value));
  return [
    ...configured,
    ...watchFloatColumnOptions.filter((option) => !configuredValues.has(option.value))
  ];
}

function moveWatchFloatColumn(options: Array<{ value: WatchFloatColumn; label: string }>, source: WatchFloatColumn, target: WatchFloatColumn) {
  const next = options.map((option) => option.value);
  const sourceIndex = next.indexOf(source);
  const targetIndex = next.indexOf(target);
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return next;
  const [item] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, item);
  return next;
}

function watchFloatProfileLabel(name: string) {
  return builtInWatchFloatProfileNames.has(name) ? name : name;
}

function SettingsPageHeader({
  view,
  onOpenConfigFile,
  onOpenConfigDir
}: {
  view: SettingsView;
  onOpenConfigFile?: () => void;
  onOpenConfigDir?: () => void;
}) {
  const { t } = useI18n();

  return (
    <header className="settings-header">
      <div>
        <h2>{settingsViewLabel(view, t)}</h2>
        <p>{settingsViewDescription(view, t)}</p>
      </div>
      {view === "general" && onOpenConfigFile && onOpenConfigDir && (
        <div className="settings-header-actions">
          <button className="tool-button" onClick={onOpenConfigFile}>
            <FileText size={14} />
            {t("side.config")}
          </button>
          <button className="tool-button" onClick={onOpenConfigDir}>
            <FolderOpen size={14} />
            {t("side.openConfigFolder")}
          </button>
        </div>
      )}
    </header>
  );
}

function SettingsPage({
  view,
  state,
  mottoDraft,
  savedMotto,
  mottoDirty,
  mottoSaving,
  mottoError,
  themeError,
  onWindowCloseBehaviorChange,
  onWatchFloatConfigChange,
  onTradingRefreshIntervalChange,
  onThemeSelect,
  onOpenConfigFile,
  onOpenConfigDir,
  onToggleFloatWindow,
  onToggleWatchlistWindow,
  onToggleMottoWindow,
  onMottoDraftChange,
  onCancelMotto,
  onSaveMotto
}: {
  view: SettingsView;
  state: AppState;
  mottoDraft: MottoConfig;
  savedMotto: MottoConfig;
  mottoDirty: boolean;
  mottoSaving: boolean;
  mottoError: string;
  themeError: string;
  onWindowCloseBehaviorChange: (behavior: AppConfig["window_close_behavior"]) => void;
  onWatchFloatConfigChange: (patch: Partial<WatchFloatConfig>) => void;
  onTradingRefreshIntervalChange: (intervalMs: number) => void;
  onThemeSelect: (themeName: string) => void;
  onOpenConfigFile: () => void;
  onOpenConfigDir: () => void;
  onToggleFloatWindow: () => void;
  onToggleWatchlistWindow: () => void;
  onToggleMottoWindow: () => void;
  onMottoDraftChange: (patch: Partial<MottoConfig>) => void;
  onCancelMotto: () => void;
  onSaveMotto: () => void;
}) {
  const { t } = useI18n();
  const [watchFloatSearch, setWatchFloatSearch] = useState("");
  const [watchFloatExpandedKeys, setWatchFloatExpandedKeys] = useState<Key[]>([]);
  const [draggedWatchFloatColumn, setDraggedWatchFloatColumn] = useState<WatchFloatColumn>();
  const [watchFloatProfileName, setWatchFloatProfileName] = useState("");
  const [refreshIntervalDraft, setRefreshIntervalDraft] = useState(() => String(state.config.trading_refresh_interval_ms ?? DEFAULT_TRADING_REFRESH_INTERVAL_MS));
  const entries = Object.keys(state.config.themes).sort((left, right) => left.localeCompare(right));
  const watchFloatColumns = new Set(state.config.watch_float.columns);
  const orderedColumnOptions = useMemo(() => orderedWatchFloatColumns(state.config.watch_float.columns), [state.config.watch_float.columns]);
  const watchFloatTree = useMemo(
    () => buildWatchFloatTree(state.stocks, state.config.stock_groups, watchFloatSearch),
    [state.stocks, state.config.stock_groups, watchFloatSearch]
  );
  const selectedWatchFloatStocks = state.config.watch_float.stock_codes
    .map((code) => state.stocks.find((stock) => stock.config.code.toLowerCase() === code.toLowerCase()))
    .filter((stock): stock is StockStatus => Boolean(stock));
  const checkedWatchFloatKeys = selectedWatchFloatStocks.map((stock) => watchFloatStockKey(stock.config.code));
  const setWatchFloatStocks = (codes: string[]) => {
    const knownOrder = new Map(state.stocks.map((stock, index) => [stock.config.code.toLowerCase(), index]));
    onWatchFloatConfigChange({
      stock_codes: [...new Set(codes)].sort((left, right) => (knownOrder.get(left.toLowerCase()) ?? 0) - (knownOrder.get(right.toLowerCase()) ?? 0))
    });
  };
  const handleWatchFloatTreeCheck = (checked: Key[] | { checked: Key[]; halfChecked: Key[] }) => {
    const checkedKeys = Array.isArray(checked) ? checked : checked.checked;
    setWatchFloatStocks(checkedKeys.map(parseWatchFloatStockKey).filter((code): code is string => Boolean(code)));
  };
  const removeWatchFloatStock = (code: string) => {
    setWatchFloatStocks(state.config.watch_float.stock_codes.filter((item) => item.toLowerCase() !== code.toLowerCase()));
  };
  const setWatchFloatColumn = (column: WatchFloatColumn, checked: boolean) => {
    const selected = new Set(state.config.watch_float.columns);
    if (checked) {
      selected.add(column);
    } else {
      selected.delete(column);
    }
    onWatchFloatConfigChange({ columns: orderedColumnOptions.map((option) => option.value).filter((value) => selected.has(value)) });
  };
  const reorderWatchFloatColumn = (target: WatchFloatColumn) => {
    if (!draggedWatchFloatColumn || draggedWatchFloatColumn === target) return;
    const nextOrder = moveWatchFloatColumn(orderedColumnOptions, draggedWatchFloatColumn, target);
    onWatchFloatConfigChange({ columns: nextOrder.filter((column) => watchFloatColumns.has(column)) });
    setDraggedWatchFloatColumn(undefined);
  };
  const updateWatchFloatStyle = (patch: Partial<WatchFloatConfig["style"]>) => {
    onWatchFloatConfigChange({ style: { ...state.config.watch_float.style, ...patch } });
  };
  const updateWatchFloatColumnColor = (column: WatchFloatColumn, color: string) => {
    updateWatchFloatStyle({
      column_colors: {
        ...state.config.watch_float.style.column_colors,
        [column]: color
      }
    });
  };
  const updateWatchFloatMetricColor = (column: "change" | "day_profit", direction: "up" | "down", color: string) => {
    updateWatchFloatStyle({
      metric_colors: {
        ...state.config.watch_float.style.metric_colors,
        [column]: {
          ...state.config.watch_float.style.metric_colors[column],
          [direction]: color
        }
      }
    });
  };
  const watchFloatProfiles = Object.keys(state.config.watch_float.profiles).sort((left, right) => {
    const leftBuiltIn = builtInWatchFloatProfileNames.has(left);
    const rightBuiltIn = builtInWatchFloatProfileNames.has(right);
    if (leftBuiltIn !== rightBuiltIn) return leftBuiltIn ? -1 : 1;
    return left.localeCompare(right);
  });
  const applyWatchFloatProfile = (name: string) => {
    const style = state.config.watch_float.profiles[name];
    if (!style) return;
    onWatchFloatConfigChange({
      style,
      active_profile: name
    });
  };
  const saveWatchFloatProfile = () => {
    const normalizedName = watchFloatProfileName.trim();
    if (!normalizedName || builtInWatchFloatProfileNames.has(normalizedName)) return;
    onWatchFloatConfigChange({
      active_profile: normalizedName,
      profiles: {
        ...state.config.watch_float.profiles,
        [normalizedName]: state.config.watch_float.style
      }
    });
    setWatchFloatProfileName("");
  };
  const resetWatchFloatProfile = () => applyWatchFloatProfile("simple");
  const commitRefreshInterval = () => {
    const parsed = Number(refreshIntervalDraft);
    const next = Number.isFinite(parsed)
      ? clamp(Math.round(parsed), MIN_TRADING_REFRESH_INTERVAL_MS, MAX_TRADING_REFRESH_INTERVAL_MS)
      : DEFAULT_TRADING_REFRESH_INTERVAL_MS;
    setRefreshIntervalDraft(String(next));
    if (next !== state.config.trading_refresh_interval_ms) onTradingRefreshIntervalChange(next);
  };

  useEffect(() => {
    setRefreshIntervalDraft(String(state.config.trading_refresh_interval_ms ?? DEFAULT_TRADING_REFRESH_INTERVAL_MS));
  }, [state.config.trading_refresh_interval_ms]);

  useEffect(() => {
    if (watchFloatSearch.trim()) setWatchFloatExpandedKeys(watchFloatTree.expandedKeys);
  }, [watchFloatSearch, watchFloatTree.expandedKeys]);

  if (view === "general") {
    return (
      <div className="settings-page">
        <SettingsPageHeader view={view} onOpenConfigFile={onOpenConfigFile} onOpenConfigDir={onOpenConfigDir} />
        <section className="settings-section">
          <div className="settings-section-title">
            <h3>{t("side.window")}</h3>
            <p>{t("settings.windowCloseDescription")}</p>
          </div>
          <label className="settings-field">
            <span>{t("side.closeButton")}</span>
            <select value={state.config.window_close_behavior ?? "close"} onChange={(event) => onWindowCloseBehaviorChange(event.target.value as AppConfig["window_close_behavior"])}>
              <option value="close">{t("side.close")}</option>
              <option value="tray">{t("side.minimizeToTray")}</option>
            </select>
          </label>
        </section>
        <section className="settings-section">
          <div className="settings-section-title">
            <h3>{t("settings.appearance")}</h3>
            <p>{t("settings.appearanceDescription")}</p>
          </div>
          <label className="settings-field">
            <span>{t("side.theme")}</span>
            <select value={state.config.current_theme} onChange={(event) => onThemeSelect(event.target.value)}>
              {entries.map((themeName) => (
                <option value={themeName} key={themeName}>
                  {formatThemeName(themeName)}
                </option>
              ))}
            </select>
          </label>
          {themeError && <div className="save-error quick-pick-error">{themeError}</div>}
        </section>
      </div>
    );
  }

  if (view === "market-refresh") {
    return (
      <div className="settings-page">
        <SettingsPageHeader view={view} />
        <section className="settings-section">
          <div className="settings-section-title">
            <h3>{t("settings.marketRefresh")}</h3>
            <p>{t("settings.marketRefreshDescription")}</p>
          </div>
          <label className="settings-field refresh-interval-field">
            <span>{t("settings.tradingRefreshInterval")}</span>
            <input
              type="number"
              min={MIN_TRADING_REFRESH_INTERVAL_MS}
              max={MAX_TRADING_REFRESH_INTERVAL_MS}
              step={100}
              value={refreshIntervalDraft}
              onChange={(event) => setRefreshIntervalDraft(event.target.value)}
              onBlur={commitRefreshInterval}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
            <small>{t("settings.tradingRefreshIntervalHint")}</small>
          </label>
        </section>
      </div>
    );
  }

  if (view === "watch-float") {
    return (
      <div className="settings-page">
        <SettingsPageHeader view={view} />
        <section className="settings-section">
          <div className="settings-section-title">
            <h3>{t("settings.watchlistFloat")}</h3>
            <p>{t("settings.watchlistDescription")}</p>
          </div>
          <div className="settings-motto-actions">
            <button className="tool-button" onClick={onToggleWatchlistWindow}>
              <Maximize2 size={14} />
              {t("side.toggleWatchlistFloat")}
            </button>
          </div>
          <div className="watch-float-settings">
            <div className="watch-float-settings-block">
              <span className="watch-float-settings-label">{t("settings.watchlistSymbols")}</span>
              <div className="watch-float-tree-panel">
                <Input.Search
                  allowClear
                  size="small"
                  value={watchFloatSearch}
                  placeholder={t("settings.searchWatchlistSymbols")}
                  onChange={(event) => setWatchFloatSearch(event.target.value)}
                />
                <Tree
                  checkable
                  blockNode
                  className="watch-float-select-tree"
                  checkedKeys={checkedWatchFloatKeys}
                  expandedKeys={watchFloatExpandedKeys}
                  treeData={watchFloatTree.treeData}
                  onCheck={handleWatchFloatTreeCheck}
                  onExpand={(keys) => setWatchFloatExpandedKeys(keys)}
                />
                <div className="watch-float-selected-tags" aria-label={t("settings.selectedWatchlistSymbols")}>
                  {selectedWatchFloatStocks.length ? selectedWatchFloatStocks.map((stock) => (
                    <AntTag closable onClose={() => removeWatchFloatStock(stock.config.code)} key={stock.config.code}>
                      {displayName(stock)} {stock.config.code}
                    </AntTag>
                  )) : <span className="muted">{t("settings.noWatchlistSymbols")}</span>}
                </div>
              </div>
            </div>
            <div className="watch-float-settings-block">
              <span className="watch-float-settings-label">{t("settings.watchlistColumns")}</span>
              <div className="watch-float-column-options">
                {orderedColumnOptions.map((column) => (
                  <label
                    className={`settings-check-row compact draggable ${draggedWatchFloatColumn === column.value ? "dragging" : ""}`}
                    draggable
                    key={column.value}
                    onDragStart={() => setDraggedWatchFloatColumn(column.value)}
                    onDragEnd={() => setDraggedWatchFloatColumn(undefined)}
                    onDragOver={(event: ReactDragEvent<HTMLLabelElement>) => event.preventDefault()}
                    onDrop={() => reorderWatchFloatColumn(column.value)}
                  >
                    <GripVertical size={14} aria-hidden="true" />
                    <input
                      type="checkbox"
                      checked={watchFloatColumns.has(column.value)}
                      onChange={(event) => setWatchFloatColumn(column.value, event.target.checked)}
                    />
                    <span>{column.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="watch-float-settings-block">
              <span className="watch-float-settings-label">{t("settings.layout")}</span>
              <label className="settings-field compact">
                <span>{t("settings.layout")}</span>
                <select
                  value={state.config.watch_float.layout}
                  onChange={(event) => onWatchFloatConfigChange({ layout: event.target.value === "horizontal" ? "horizontal" : "vertical" })}
                >
                  <option value="vertical">{t("settings.verticalLayout")}</option>
                  <option value="horizontal">{t("settings.horizontalLayout")}</option>
                </select>
              </label>
            </div>
            <div className="watch-float-settings-block">
              <span className="watch-float-settings-label">{t("settings.watchlistStyle")}</span>
              <div className="watch-float-style-grid">
                <label className="settings-field compact">
                  <span>{t("settings.fontFamily")}</span>
                  <input
                    value={state.config.watch_float.style.font_family}
                    onChange={(event) => updateWatchFloatStyle({ font_family: event.target.value })}
                  />
                </label>
                <label className="settings-field compact">
                  <span>{t("settings.fontSize")}</span>
                  <input
                    type="number"
                    min={9}
                    max={32}
                    value={state.config.watch_float.style.font_size}
                    onChange={(event) => updateWatchFloatStyle({ font_size: Number(event.target.value) })}
                  />
                </label>
                <label className="settings-field compact">
                  <span>{t("settings.textColor")}</span>
                  <div className="watch-float-color-grid">
                    {watchFloatFlatColorOptions.map((column) => (
                      <label className="watch-float-column-color" key={column.value}>
                        <span>{column.label}</span>
                        <input
                          type="color"
                          value={state.config.watch_float.style.column_colors[column.value]}
                          onChange={(event) => updateWatchFloatColumnColor(column.value, event.target.value)}
                        />
                      </label>
                    ))}
                    {watchFloatMetricColorOptions.map((column) => (
                      <div className="watch-float-metric-color" key={column.value}>
                        <span>{column.label}</span>
                        <label>
                          <small>{t("settings.upColor")}</small>
                          <input
                            type="color"
                            value={state.config.watch_float.style.metric_colors[column.value].up}
                            onChange={(event) => updateWatchFloatMetricColor(column.value, "up", event.target.value)}
                          />
                        </label>
                        <label>
                          <small>{t("settings.downColor")}</small>
                          <input
                            type="color"
                            value={state.config.watch_float.style.metric_colors[column.value].down}
                            onChange={(event) => updateWatchFloatMetricColor(column.value, "down", event.target.value)}
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                </label>
                <label className="settings-field compact">
                  <span>{t("settings.backgroundColor")}</span>
                  <input
                    type="color"
                    value={state.config.watch_float.style.background_color}
                    onChange={(event) => updateWatchFloatStyle({ background_color: event.target.value })}
                  />
                </label>
                <label className="settings-field compact">
                  <span>{t("settings.backgroundOpacity")}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={state.config.watch_float.style.background_opacity}
                    onChange={(event) => updateWatchFloatStyle({ background_opacity: Number(event.target.value) })}
                  />
                </label>
                <label className="settings-field compact">
                  <span>{t("settings.borderColor")}</span>
                  <input
                    type="color"
                    value={state.config.watch_float.style.border_color}
                    onChange={(event) => updateWatchFloatStyle({ border_color: event.target.value })}
                  />
                </label>
                <label className="watch-float-style-toggle">
                  <span>{t("settings.showBorder")}</span>
                  <input
                    type="checkbox"
                    checked={state.config.watch_float.style.show_border}
                    onChange={(event) => updateWatchFloatStyle({ show_border: event.target.checked })}
                  />
                </label>
              </div>
            </div>
            <div className="watch-float-settings-block">
              <span className="watch-float-settings-label">{t("settings.watchlistProfile")}</span>
              <div className="watch-float-profile-row">
                <label className="settings-field compact">
                  <span>{t("settings.watchlistProfile")}</span>
                  <select
                    value={state.config.watch_float.active_profile}
                    onChange={(event) => applyWatchFloatProfile(event.target.value)}
                  >
                    {watchFloatProfiles.map((name) => (
                      <option value={name} key={name}>{watchFloatProfileLabel(name)}</option>
                    ))}
                    {!state.config.watch_float.profiles[state.config.watch_float.active_profile] && (
                      <option value={state.config.watch_float.active_profile}>{state.config.watch_float.active_profile}</option>
                    )}
                  </select>
                </label>
                <label className="settings-field compact">
                  <span>{t("settings.profileName")}</span>
                  <input
                    value={watchFloatProfileName}
                    placeholder={t("settings.profileName")}
                    onChange={(event) => setWatchFloatProfileName(event.target.value)}
                  />
                </label>
                <div className="watch-float-profile-actions">
                  <button
                    className="tool-button"
                    type="button"
                    disabled={!watchFloatProfileName.trim() || builtInWatchFloatProfileNames.has(watchFloatProfileName.trim())}
                    onClick={saveWatchFloatProfile}
                  >
                    {t("settings.saveProfile")}
                  </button>
                  <button className="tool-button" type="button" onClick={resetWatchFloatProfile}>{t("settings.resetDefault")}</button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (view === "camouflage-float") {
    return (
      <div className="settings-page">
        <SettingsPageHeader view={view} />
        <section className="settings-section">
          <div className="settings-section-title">
            <h3>{t("settings.camouflageFloat")}</h3>
            <p>{t("settings.camouflageDescription")}</p>
          </div>
          <div className="settings-motto-actions">
            <button className="tool-button" onClick={onToggleFloatWindow}>
              <Maximize2 size={14} />
              {t("side.toggleCamouflageFloat")}
            </button>
          </div>
          <div className="camouflage-preview">
            <span>{t("settings.displayMode")}</span>
            <strong>CPU / NET / I/O</strong>
            <small>{t("settings.camouflagePreview")}</small>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <SettingsPageHeader view={view} />
      <section className="settings-section">
        <div className="settings-section-title">
          <h3>{t("side.motto")}</h3>
          <p>{t("settings.mottoDescription")}</p>
        </div>
        <div className="settings-motto-actions">
          <button className="tool-button" onClick={onToggleMottoWindow}>
            <Maximize2 size={14} />
            {t("side.toggleMottoFloat")}
          </button>
        </div>
        <textarea
          className="settings-textarea"
          value={mottoDraft.text}
          onChange={(event) => onMottoDraftChange({ text: event.target.value })}
          placeholder={t("side.mottoPlaceholder")}
        />
        <div className="motto-style-grid">
          <label>
            <span>{t("side.font")}</span>
            <input value={mottoDraft.font_family} onChange={(event) => onMottoDraftChange({ font_family: event.target.value })} />
          </label>
          <label>
            <span>{t("side.size")}</span>
            <input
              type="number"
              min="10"
              max="36"
              step="1"
              value={mottoDraft.font_size || ""}
              onChange={(event) => onMottoDraftChange({ font_size: event.target.value === "" ? 0 : clamp(Number(event.target.value), 10, 36) })}
            />
          </label>
          <label>
            <span>{t("side.color")}</span>
            <input type="color" value={mottoDraft.color} onChange={(event) => onMottoDraftChange({ color: event.target.value })} />
          </label>
        </div>
        <div className="motto-actions">
          {mottoDirty && <span className="edit-state">{t("side.unsavedMotto")}</span>}
          {mottoError && <span className="save-error">{mottoError}</span>}
          <button className="tool-button" onClick={onCancelMotto} disabled={!mottoDirty || mottoSaving || sameMotto(mottoDraft, savedMotto)}>
            {t("common.cancel")}
          </button>
          <button className="tool-button accent" onClick={onSaveMotto} disabled={!mottoDirty || mottoSaving}>
            {mottoSaving ? t("common.saving") : t("side.saveMotto")}
          </button>
        </div>
      </section>
    </div>
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

