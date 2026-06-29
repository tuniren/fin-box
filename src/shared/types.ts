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

export type AppConfig = {
  total_investment?: number;
  cash?: number;
  motto: MottoConfig;
  hide_zero_shares: boolean;
  stocks: StockConfig[];
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

export type FinBoxApi = {
  getState: () => Promise<AppState>;
  forceRefresh: () => Promise<void>;
  openConfigFile: () => Promise<void>;
  openConfigDir: () => Promise<void>;
  quit: () => Promise<void>;
  searchStocks: (query: string) => Promise<StockSearchResult[]>;
  addStock: (code: string, alias?: string) => Promise<void>;
  updateAccountConfig: (patch: Pick<AppConfig, "total_investment" | "cash">) => Promise<void>;
  updateMotto: (motto: MottoConfig) => Promise<void>;
  updateTheme: (themeName: string) => Promise<void>;
  updateStockAlias: (code: string, alias?: string) => Promise<void>;
  updateStockTags: (code: string, tags: string[]) => Promise<void>;
  updateStockPositions: (code: string, positions: Position[]) => Promise<void>;
  fetchKLine: (code: string, scale: KLineScale) => Promise<KLinePoint[]>;
  getStockJournal: (code: string) => Promise<StockJournal>;
  startStockJournal: (code: string, followedAt: string) => Promise<StockJournal>;
  saveStockJournalNote: (code: string, note: Pick<StockJournalNote, "id" | "date" | "content">) => Promise<StockJournal>;
  archiveDailyKLine: (code: string, points: KLinePoint[]) => Promise<StockJournal>;
  fetchMinuteData: (code: string) => Promise<MinutePoint[]>;
  fetchStockNews: (code: string, page: number, keyword?: string) => Promise<StockNewsPage>;
  fetchStockNewsArticle: (url: string) => Promise<StockNewsArticle>;
  fetchStockComments: (code: string, page: number) => Promise<StockCommentPage>;
  listNotes: () => Promise<NoteTreeItem[]>;
  readNote: (notePath: string) => Promise<NoteFile>;
  saveNote: (notePath: string, content: string) => Promise<void>;
  createNote: (parentPath: string, type: "file" | "directory", name: string) => Promise<NoteTreeItem[]>;
  renameNote: (notePath: string, name: string) => Promise<NoteTreeItem[]>;
  deleteNote: (notePath: string) => Promise<NoteTreeItem[]>;
  openNotesDir: () => Promise<void>;
  resizeWindow: (width: number, height: number) => Promise<void>;
  startDrag: () => Promise<void>;
  openKLineWindow: (code: string, name: string) => Promise<void>;
  toggleFloatWindow: () => Promise<void>;
  toggleMottoWindow: () => Promise<void>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  onState: (callback: (state: AppState) => void) => () => void;
  onCycleStock: (callback: () => void) => () => void;
  onToggleExpand: (callback: () => void) => () => void;
};
