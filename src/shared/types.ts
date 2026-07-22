export type Theme = {
  background: string;
  border: string;
  text_normal: string;
  text_white: string;
  text_gray: string;
  color_up: string;
  color_down: string;
  accent: string;
  menu_bg: string;
  rounding: number;
  border_width: number;
};

export type Position = {
  account?: string;
  shares: number;
  cost: number;
};

export type StockConfig = {
  code: string;
  alias?: string;
  tags: string[];
  positions: Position[];
};

export type MottoConfig = {
  text: string;
  font_family: string;
  font_size: number;
  color: string;
};

export type WatchFloatColumn = "name" | "price" | "change" | "day_profit";

export type WatchFloatMetricColumn = "change" | "day_profit";

export type WatchFloatLayout = "vertical" | "horizontal";

export type WatchFloatMetricColors = Record<WatchFloatMetricColumn, {
  up: string;
  down: string;
}>;

export type WatchFloatStyle = {
  font_family: string;
  font_size: number;
  text_color: string;
  column_colors: Record<WatchFloatColumn, string>;
  metric_colors: WatchFloatMetricColors;
  background_color: string;
  background_opacity: number;
  border_color: string;
  show_border: boolean;
};

export type WatchFloatConfig = {
  stock_codes: string[];
  columns: WatchFloatColumn[];
  layout: WatchFloatLayout;
  show_news: boolean;
  horizontal_stock_ratio: number;
  horizontal_news_ratio: number;
  style: WatchFloatStyle;
  active_profile: string;
  profiles: Record<string, WatchFloatStyle>;
};

export type AppConfig = {
  total_investment?: number;
  cash?: number;
  motto: MottoConfig;
  watch_float: WatchFloatConfig;
  trading_refresh_interval_ms: number;
  window_close_behavior: "tray" | "close";
  hide_zero_shares: boolean;
  stocks: StockConfig[];
  stock_groups: string[];
  stock_group_order: Record<string, string[]>;
  current_theme: string;
  themes: Record<string, Theme>;
};

export type MarketData = {
  name: string;
  current_price: number;
  prev_close: number;
  open: number;
  high: number;
  low: number;
  time: string;
};

export type StockStatus = {
  config: StockConfig;
  market?: MarketData;
};

export type StockSearchResult = {
  code: string;
  name: string;
};

export type KLineScale = 1 | 5 | 15 | 30 | 60 | 240;

export type KLinePoint = {
  day: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type StockJournalNote = {
  id: string;
  date?: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type StockJournal = {
  code: string;
  followedAt?: string;
  dailyKLine: KLinePoint[];
  notes: StockJournalNote[];
  updatedAt: number;
};

export type MinutePoint = {
  time: string;
  price: number;
  avgPrice?: number;
  volume: number;
  prevClose?: number;
};

export type FiveDayMinutePoint = MinutePoint & {
  day: string;
};
export type StockNewsItem = {
  id: string;
  title: string;
  url: string;
  date?: string;
  source?: string;
  html?: string;
};

export type StockNewsPage = {
  items: StockNewsItem[];
  page: number;
  hasMore: boolean;
};

export type StockNewsArticle = {
  title: string;
  url: string;
  date?: string;
  source?: string;
  html: string;
};

export type StockCommentItem = {
  id: string;
  user: string;
  text: string;
  url: string;
  date?: string;
  replyCount?: number;
  retweetCount?: number;
  likeCount?: number;
};

export type StockCommentPage = {
  items: StockCommentItem[];
  page: number;
  hasMore: boolean;
};

export type NoteTreeItem = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: NoteTreeItem[];
};

export type NoteFile = {
  path: string;
  content: string;
};

export type AppState = {
  config: AppConfig;
  stocks: StockStatus[];
  sh_index?: MarketData;
  last_market_update?: number;
  next_market_refresh?: number;
};

export type UpdateStatus = {
  state: "idle" | "checking" | "available" | "downloading" | "downloaded" | "not-available" | "error" | "disabled";
  currentVersion: string;
  version?: string;
  percent?: number;
  message?: string;
};

export type FinBoxApi = {
  getState: () => Promise<AppState>;
  forceRefresh: () => Promise<void>;
  getUpdateStatus: () => Promise<UpdateStatus>;
  checkForUpdates: () => Promise<UpdateStatus>;
  downloadUpdate: () => Promise<UpdateStatus>;
  installUpdate: () => Promise<void>;
  openConfigFile: () => Promise<void>;
  openConfigDir: () => Promise<void>;
  quit: () => Promise<void>;
  searchStocks: (query: string) => Promise<StockSearchResult[]>;
  addStock: (code: string, alias?: string) => Promise<void>;
  removeStock: (code: string) => Promise<void>;
  updateAccountConfig: (patch: Pick<AppConfig, "total_investment" | "cash">) => Promise<void>;
  updateMotto: (motto: MottoConfig) => Promise<void>;
  updateWatchFloatConfig: (config: WatchFloatConfig) => Promise<void>;
  updateTradingRefreshInterval: (intervalMs: number) => Promise<void>;
  updateWindowCloseBehavior: (behavior: AppConfig["window_close_behavior"]) => Promise<void>;
  updateTheme: (themeName: string) => Promise<void>;
  updateStockAlias: (code: string, alias?: string) => Promise<void>;
  updateStockTags: (code: string, tags: string[]) => Promise<void>;
  updateStockGroups: (groups: string[]) => Promise<void>;
  updateStockGroupOrder: (tag: string, codes: string[]) => Promise<void>;
  updateStockPositions: (code: string, positions: Position[]) => Promise<void>;
  fetchKLine: (code: string, scale: KLineScale, force?: boolean) => Promise<KLinePoint[]>;
  getStockJournal: (code: string) => Promise<StockJournal>;
  startStockJournal: (code: string, followedAt: string) => Promise<StockJournal>;
  saveStockJournalNote: (code: string, note: Pick<StockJournalNote, "id" | "date" | "content">) => Promise<StockJournal>;
  archiveDailyKLine: (code: string, points: KLinePoint[]) => Promise<StockJournal>;
  fetchMinuteData: (code: string) => Promise<MinutePoint[]>;
  fetchFiveDayMinuteData: (code: string) => Promise<FiveDayMinutePoint[]>;
  fetchStockNews: (code: string, page: number, keyword?: string) => Promise<StockNewsPage>;
  fetchStockNewsArticle: (url: string) => Promise<StockNewsArticle>;
  openExternalUrl: (url: string) => Promise<void>;
  fetchStockComments: (code: string, page: number) => Promise<StockCommentPage>;
  listNotes: () => Promise<NoteTreeItem[]>;
  readNote: (notePath: string) => Promise<NoteFile>;
  saveNote: (notePath: string, content: string) => Promise<void>;
  createNote: (parentPath: string, type: "file" | "directory", name: string) => Promise<NoteTreeItem[]>;
  renameNote: (notePath: string, name: string) => Promise<NoteTreeItem[]>;
  deleteNote: (notePath: string) => Promise<NoteTreeItem[]>;
  openNotesDir: () => Promise<void>;
  resizeWindow: (width: number, height: number) => Promise<void>;
  resizeWindowHeight: (height: number) => Promise<void>;
  startDrag: () => Promise<void>;
  openKLineWindow: (code: string, name: string) => Promise<void>;
  toggleCamouflageFloatWindow: () => Promise<void>;
  toggleWatchlistFloatWindow: () => Promise<void>;
  toggleMottoFloatWindow: () => Promise<void>;
  openWatchlistFloatSettings: () => Promise<void>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  onState: (callback: (state: AppState) => void) => () => void;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
  onCycleStock: (callback: () => void) => () => void;
  onToggleExpand: (callback: () => void) => () => void;
  onOpenWatchlistFloatSettings: (callback: () => void) => () => void;
};
