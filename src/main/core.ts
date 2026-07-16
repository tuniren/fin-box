import { app, BrowserWindow, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { ConfigManager, normalizeTradingRefreshInterval } from "./config";
import { fetchKLineData, fetchMultipleStocks, fetchStockComments as fetchThsStockComments, fetchStockNews as fetchSinaStockNews, fetchStockNewsArticle as fetchSinaStockNewsArticle, fetchTencentFiveDayMinuteData, fetchTencentMinuteData, searchStocks } from "./sina";
import type { AppConfig, AppState, KLinePoint, KLineScale, MottoConfig, Position, StockConfig, StockJournal, StockJournalNote, WatchFloatColumn, WatchFloatConfig, WatchFloatStyle } from "../shared/types";

const INDEX_CODE = "sh000001";
const OFF_HOURS_REFRESH_MS = 300000;
const DAY_MS = 24 * 60 * 60 * 1000;
const INTRADAY_KLINE_CACHE_MS = 60 * 1000;

type KLineCacheEntry = {
  expiresAt: number;
  data?: Awaited<ReturnType<typeof fetchKLineData>>;
  pending?: ReturnType<typeof fetchKLineData>;
};

type StockJournalMetaFile = {
  code?: string;
  followedAt?: string;
  notes?: Partial<StockJournalNote>[];
  updatedAt?: number;
};

type StockJournalDayFile = {
  code?: string;
  date?: string;
  kline?: Partial<KLinePoint>;
  notes?: Partial<StockJournalNote>[];
  updatedAt?: number;
};

type StockNotesFile = {
  code?: string;
  strategy?: string;
  daily?: Record<string, string>;
  updatedAt?: number;
};

export class AppCore {
  private readonly configManager = new ConfigManager();
  private readonly klineCache = new Map<string, KLineCacheEntry>();
  private state: AppState;
  private timer?: NodeJS.Timeout;

  constructor(private readonly getWindows: () => BrowserWindow[]) {
    const config = this.configManager.loadOrDefault();
    this.state = createState(config);
  }

  start(): void {
    void this.refresh(false).finally(() => this.scheduleNextRefresh());
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  getState(): AppState {
    return structuredClone(this.state);
  }

  async forceRefresh(): Promise<void> {
    await this.refresh(true);
    this.scheduleNextRefresh();
  }

  openConfigFile(): void {
    void shell.openPath(this.configManager.path());
  }

  openConfigDir(): void {
    void shell.openPath(this.configManager.dir());
  }

  openStockNotesDir(): void {
    fs.mkdirSync(stockNotesRoot(), { recursive: true });
    void shell.openPath(stockNotesRoot());
  }

  async searchStocks(query: string) {
    return searchStocks(query);
  }

  addStock(code: string, alias?: string): void {
    const config = this.configManager.loadOrDefault();
    if (config.stocks.some((stock) => stock.code.toLowerCase() === code.toLowerCase())) return;

    const stock: StockConfig = {
      code,
      alias,
      tags: ["watchlist"],
      positions: [{ account: "Default", shares: 0, cost: 0 } as Position]
    };
    config.stocks.push(stock);
    this.configManager.save(config);
    void this.forceRefresh();
  }

  removeStock(code: string): void {
    const config = this.configManager.loadOrDefault();
    const nextStocks = config.stocks.filter((stock) => stock.code.toLowerCase() !== code.toLowerCase());
    if (nextStocks.length === config.stocks.length) return;

    config.stocks = nextStocks;
    this.configManager.save(config);
    this.applyConfig(config);
  }

  updateAccountConfig(patch: Pick<AppConfig, "total_investment" | "cash">): void {
    const config = this.configManager.loadOrDefault();
    config.total_investment = normalizeOptionalNumber(patch.total_investment);
    config.cash = normalizeOptionalNumber(patch.cash);

    this.configManager.save(config);
    this.applyConfig(config);
  }

  updateMotto(motto: MottoConfig): void {
    const config = this.configManager.loadOrDefault();
    config.motto = {
      text: motto.text.trim(),
      font_family: motto.font_family.trim() || "Microsoft YaHei",
      font_size: Math.min(Math.max(Number(motto.font_size) || 14, 10), 36),
      color: /^#[0-9a-fA-F]{6}$/.test(motto.color) ? motto.color : "#f8fafc"
    };

    this.configManager.save(config);
    this.applyConfig(config);
  }

  updateWatchFloatConfig(watchFloat: WatchFloatConfig): void {
    const config = this.configManager.loadOrDefault();
    const knownCodes = new Map(config.stocks.map((stock) => [stock.code.toLowerCase(), stock.code]));
    const columns: WatchFloatColumn[] = ["name", "price", "change", "day_profit"];
    const nextColumns = [...new Set(watchFloat.columns.filter((column) => columns.includes(column)))];

    config.watch_float = {
      stock_codes: [...new Set(watchFloat.stock_codes.map((code) => knownCodes.get(code.toLowerCase())).filter((code): code is string => Boolean(code)))],
      columns: nextColumns.length ? nextColumns : ["name", "change"],
      layout: watchFloat.layout === "horizontal" ? "horizontal" : "vertical",
      style: normalizeWatchFloatStyle(watchFloat.style, config.watch_float.style),
      active_profile: watchFloat.active_profile.trim() || "custom",
      profiles: normalizeWatchFloatProfiles(watchFloat.profiles, config.watch_float.profiles)
    };

    this.configManager.save(config);
    this.applyConfig(config);
  }

  updateTradingRefreshInterval(intervalMs: number): void {
    const config = this.configManager.loadOrDefault();
    config.trading_refresh_interval_ms = normalizeTradingRefreshInterval(intervalMs);

    this.configManager.save(config);
    this.applyConfig(config);
    this.scheduleNextRefresh();
  }

  updateWindowCloseBehavior(behavior: AppConfig["window_close_behavior"]): void {
    const config = this.configManager.loadOrDefault();
    config.window_close_behavior = behavior === "close" ? "close" : "tray";

    this.configManager.save(config);
    this.applyConfig(config);
  }

  updateTheme(themeName: string): void {
    const config = this.configManager.loadOrDefault();
    if (!Object.prototype.hasOwnProperty.call(config.themes, themeName)) return;

    config.current_theme = themeName;
    this.configManager.save(config);
    this.applyConfig(config);
  }

  updateStockAlias(code: string, alias?: string): void {
    const config = this.configManager.loadOrDefault();
    const stock = config.stocks.find((item) => item.code.toLowerCase() === code.toLowerCase());
    if (!stock) return;

    const normalizedAlias = alias?.trim();
    stock.alias = normalizedAlias || undefined;

    this.configManager.save(config);
    this.applyConfig(config);
  }

  updateStockTags(code: string, tags: string[]): void {
    const config = this.configManager.loadOrDefault();
    const stock = config.stocks.find((item) => item.code.toLowerCase() === code.toLowerCase());
    if (!stock) return;

    stock.tags = normalizeTags(tags);
    config.stock_groups = normalizeOrderedTags([...(config.stock_groups ?? []), ...stock.tags]);

    this.configManager.save(config);
    this.applyConfig(config);
  }

  updateStockGroups(groups: string[]): void {
    const config = this.configManager.loadOrDefault();
    config.stock_groups = normalizeOrderedTags(groups);
    const activeGroups = new Set([...config.stock_groups, ...config.stocks.flatMap((stock) => stock.tags)]);
    config.stock_group_order = Object.fromEntries(
      Object.entries(config.stock_group_order).filter(([tag]) => activeGroups.has(tag))
    );

    this.configManager.save(config);
    this.applyConfig(config);
  }

  updateStockGroupOrder(tag: string, codes: string[]): void {
    const config = this.configManager.loadOrDefault();
    const normalizedTag = tag.trim();
    if (!normalizedTag) return;

    const knownCodes = new Map(config.stocks.map((stock) => [stock.code.toLowerCase(), stock.code]));
    const orderedCodes = [...new Set(codes.map((code) => knownCodes.get(code.toLowerCase())).filter((code): code is string => Boolean(code)))];
    config.stock_group_order[normalizedTag] = orderedCodes;

    this.configManager.save(config);
    this.applyConfig(config);
  }

  updateStockPositions(code: string, positions: Position[]): void {
    const config = this.configManager.loadOrDefault();
    const stock = config.stocks.find((item) => item.code.toLowerCase() === code.toLowerCase());
    if (!stock) return;

    stock.positions = positions
      .map((position) => ({
        account: position.account?.trim() || undefined,
        shares: Number(position.shares) || 0,
        cost: Number(position.cost) || 0
      }))
      .filter((position) => position.account || position.shares !== 0 || position.cost !== 0);

    this.configManager.save(config);
    this.applyConfig(config);
    void this.forceRefresh();
  }

  async fetchKLine(code: string, scale: KLineScale, force = false) {
    const normalizedCode = code.toLowerCase();
    const cacheKey = `${normalizedCode}:${scale}`;
    const now = Date.now();
    const cached = this.klineCache.get(cacheKey);
    if (!force && cached?.data && cached.expiresAt > now) return structuredClone(cached.data);
    if (!force && cached?.pending) return structuredClone(await cached.pending);

    const pending = fetchKLineData(normalizedCode, scale);
    this.klineCache.set(cacheKey, {
      pending,
      expiresAt: now + INTRADAY_KLINE_CACHE_MS
    });
    const data = await pending;
    this.klineCache.set(cacheKey, {
      data,
      expiresAt: scale === 240 ? nextLocalDayStart(Date.now()) : Date.now() + INTRADAY_KLINE_CACHE_MS
    });
    return structuredClone(data);
  }

  getStockJournal(code: string): StockJournal {
    return structuredClone(this.readStockJournal(code));
  }

  startStockJournal(code: string, followedAt: string): StockJournal {
    const journal = this.readStockJournal(code);
    journal.followedAt = normalizeDate(followedAt) || todayDate();
    journal.updatedAt = Date.now();
    this.writeStockJournal(journal);
    return structuredClone(journal);
  }

  saveStockJournalNote(code: string, note: Pick<StockJournalNote, "id" | "date" | "content">): StockJournal {
    const journal = this.readStockJournal(code);
    const now = Date.now();
    const normalizedId = note.id || `note-${now}`;
    const content = note.content.trim();
    const normalizedDate = normalizeDate(note.date);
    const index = journal.notes.findIndex((item) => item.id === normalizedId);

    if (!content) {
      journal.notes = journal.notes.filter((item) => item.id !== normalizedId);
    } else if (index === -1) {
      journal.notes.push({
        id: normalizedId,
        date: normalizedDate,
        content,
        createdAt: now,
        updatedAt: now
      });
    } else {
      journal.notes[index] = {
        ...journal.notes[index],
        date: normalizedDate,
        content,
        updatedAt: now
      };
    }

    journal.notes.sort(compareJournalNotes);
    journal.updatedAt = now;
    this.writeStockJournal(journal);
    return structuredClone(journal);
  }

  archiveDailyKLine(code: string, points: KLinePoint[]): StockJournal {
    const journal = this.readStockJournal(code);
    if (!journal.followedAt) return structuredClone(journal);

    const byDay = new Map(journal.dailyKLine.map((point) => [normalizeDate(point.day), point]));
    for (const point of points) {
      const day = normalizeDate(point.day);
      if (!day || day < journal.followedAt) continue;
      byDay.set(day, { ...point, day });
    }

    journal.dailyKLine = [...byDay.values()].sort((left, right) => left.day.localeCompare(right.day));
    journal.updatedAt = Date.now();
    this.writeStockJournal(journal);
    return structuredClone(journal);
  }

  fetchMinuteData(code: string) {
    return fetchTencentMinuteData(code);
  }

  fetchFiveDayMinuteData(code: string) {
    return fetchTencentFiveDayMinuteData(code);
  }

  fetchStockNews(code: string, page: number, keyword?: string) {
    return fetchSinaStockNews(code, page, keyword);
  }

  fetchStockNewsArticle(url: string) {
    return fetchSinaStockNewsArticle(url);
  }

  fetchStockComments(code: string, page: number) {
    return fetchThsStockComments(code, page);
  }

  private scheduleNextRefresh(): void {
    if (this.timer) clearTimeout(this.timer);
    const interval = dataRefreshIntervalMs(
      this.state.config.stocks.some((stock) => /^hk\d{5}$/i.test(stock.code)),
      this.state.config.trading_refresh_interval_ms
    );
    this.state.next_market_refresh = Date.now() + interval;
    this.broadcast();
    this.timer = setTimeout(() => {
      void this.refresh(false).finally(() => this.scheduleNextRefresh());
    }, interval);
  }

  private async refresh(force: boolean): Promise<void> {
    const config = force ? this.configManager.forceReload() : this.configManager.reloadIfChanged();
    if (config) this.applyConfig(config);

    const codes = [...this.state.config.stocks.map((stock) => stock.code), INDEX_CODE];
    try {
      const marketData = await fetchMultipleStocks(codes);
      this.state.stocks = this.state.stocks.map((stock) => ({
        ...stock,
        market: marketData.get(stock.config.code.toLowerCase()) ?? stock.market
      }));
      this.state.sh_index = marketData.get(INDEX_CODE) ?? this.state.sh_index;
      this.state.last_market_update = Date.now();
      this.broadcast();
    } catch (error) {
      console.error("[FinBox] Failed to refresh market data", error);
    }
  }

  private applyConfig(config: AppConfig): void {
    const oldMarket = new Map(this.state.stocks.map((stock) => [stock.config.code.toLowerCase(), stock.market]));
    this.state = {
      ...this.state,
      config,
      stocks: config.stocks.map((stock) => ({
        config: stock,
        market: oldMarket.get(stock.code.toLowerCase())
      }))
    };
    this.broadcast();
  }

  private broadcast(): void {
    const state = this.getState();
    for (const win of this.getWindows()) {
      if (!win.isDestroyed()) win.webContents.send("state", state);
    }
  }

  private readStockJournal(code: string): StockJournal {
    const normalizedCode = normalizeCode(code);
    const journal = emptyStockJournal(normalizedCode);

    try {
      const meta = JSON.parse(fs.readFileSync(stockJournalMetaPath(normalizedCode), "utf8")) as StockJournalMetaFile;
      journal.followedAt = normalizeDate(meta.followedAt) ?? journal.followedAt;
      journal.updatedAt = Math.max(journal.updatedAt, Number(meta.updatedAt) || 0);
      for (const note of meta.notes ?? []) {
        const normalizedNote = normalizeJournalNote({ ...note, date: undefined });
        if (normalizedNote) upsertJournalNote(journal, normalizedNote);
      }
    } catch {
      // Missing metadata is fine; daily files can still be read below.
    }

    try {
      const dir = stockJournalCodeDir(normalizedCode);
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !/^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name)) continue;
        const daily = JSON.parse(fs.readFileSync(path.join(dir, entry.name), "utf8")) as StockJournalDayFile;
        const date = normalizeDate(daily.date) ?? entry.name.slice(0, 10);
        const kline = normalizeKLinePoint({ ...daily.kline, day: date });
        if (kline) upsertKLinePoint(journal, kline);
        for (const note of daily.notes ?? []) {
          const normalizedNote = normalizeJournalNote({ ...note, date });
          if (normalizedNote) upsertJournalNote(journal, normalizedNote);
        }
        journal.updatedAt = Math.max(journal.updatedAt, Number(daily.updatedAt) || 0);
      }
    } catch {
      // No per-day records yet.
    }

    try {
      const noteFile = yaml.load(fs.readFileSync(stockNotesPath(normalizedCode), "utf8")) as StockNotesFile | undefined;
      const now = Number(noteFile?.updatedAt) || Date.now();
      const strategy = noteFile?.strategy?.trim();
      if (strategy) {
        upsertJournalNote(journal, {
          id: "strategy",
          content: strategy,
          createdAt: now,
          updatedAt: now
        });
      }
      for (const [dateValue, contentValue] of Object.entries(noteFile?.daily ?? {})) {
        const date = normalizeDate(dateValue);
        const content = contentValue.trim();
        if (!date || !content) continue;
        upsertJournalNote(journal, {
          id: `daily-${date}`,
          date,
          content,
          createdAt: now,
          updatedAt: now
        });
      }
      journal.updatedAt = Math.max(journal.updatedAt, now);
    } catch {
      // Stock notes are created lazily per symbol.
    }

    journal.dailyKLine.sort((left, right) => left.day.localeCompare(right.day));
    journal.notes.sort(compareJournalNotes);
    return journal;
  }

  private writeStockJournal(journal: StockJournal): void {
    const normalizedCode = normalizeCode(journal.code);
    const dir = stockJournalCodeDir(normalizedCode);
    fs.mkdirSync(dir, { recursive: true });

    const meta: StockJournalMetaFile = {
      code: normalizedCode,
      followedAt: journal.followedAt,
      notes: [],
      updatedAt: journal.updatedAt
    };
    fs.writeFileSync(stockJournalMetaPath(normalizedCode), `${JSON.stringify(meta, null, 2)}\n`, "utf8");

    const days = new Set<string>();
    for (const point of journal.dailyKLine) days.add(point.day);
    for (const note of journal.notes) {
      if (note.date) days.add(note.date);
    }

    for (const day of [...days].sort()) {
      const daily: StockJournalDayFile = {
        code: normalizedCode,
        date: day,
        kline: journal.dailyKLine.find((point) => point.day === day),
        notes: [],
        updatedAt: journal.updatedAt
      };
      fs.writeFileSync(stockJournalDayPath(normalizedCode, day), `${JSON.stringify(daily, null, 2)}\n`, "utf8");
    }

    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !/^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name)) continue;
        const day = entry.name.slice(0, 10);
        if (!days.has(day)) fs.rmSync(path.join(dir, entry.name));
      }
    } catch {
      // The directory was just created above, so this is only a defensive guard.
    }

    writeStockNotes(journal);
  }

}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function normalizeOrderedTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}
function stockJournalRoot(): string {
  return path.join(app.getPath("userData"), "stock-journals");
}

function stockNotesRoot(): string {
  return path.join(app.getPath("userData"), "stock-notes");
}

function stockJournalCodeDir(code: string): string {
  return path.join(stockJournalRoot(), normalizeCode(code));
}

function stockJournalMetaPath(code: string): string {
  return path.join(stockJournalCodeDir(code), "_meta.json");
}

function stockJournalDayPath(code: string, day: string): string {
  const normalizedDay = normalizeDate(day);
  if (!normalizedDay) throw new Error("Invalid journal date.");
  return path.join(stockJournalCodeDir(code), `${normalizedDay}.json`);
}

function stockNotesPath(code: string): string {
  return path.join(stockNotesRoot(), `${normalizeCode(code)}.yaml`);
}

function normalizeCode(code: string): string {
  const normalized = code.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!normalized) throw new Error("Invalid stock code.");
  return normalized;
}

function emptyStockJournal(code: string): StockJournal {
  return {
    code,
    dailyKLine: [],
    notes: [],
    updatedAt: Date.now()
  };
}

function upsertKLinePoint(journal: StockJournal, point: KLinePoint): void {
  const index = journal.dailyKLine.findIndex((item) => item.day === point.day);
  if (index === -1) {
    journal.dailyKLine.push(point);
  } else {
    journal.dailyKLine[index] = point;
  }
}

function upsertJournalNote(journal: StockJournal, note: StockJournalNote): void {
  const index = journal.notes.findIndex((item) => item.id === note.id);
  if (index === -1) {
    journal.notes.push(note);
  } else if (note.updatedAt >= journal.notes[index].updatedAt) {
    journal.notes[index] = note;
  }
}

function writeStockNotes(journal: StockJournal): void {
  const normalizedCode = normalizeCode(journal.code);
  const strategy = journal.notes.find((note) => !note.date)?.content.trim() ?? "";
  const daily = Object.fromEntries(
    journal.notes
      .filter((note) => note.date && note.content.trim())
      .sort(compareJournalNotes)
      .map((note) => [note.date as string, note.content.trim()])
  );
  const data: StockNotesFile = {
    code: normalizedCode,
    strategy,
    daily,
    updatedAt: journal.updatedAt
  };

  fs.mkdirSync(stockNotesRoot(), { recursive: true });
  fs.writeFileSync(stockNotesPath(normalizedCode), yaml.dump(data, { lineWidth: 120 }), "utf8");
}

function normalizeKLinePoint(point: Partial<KLinePoint> | undefined): KLinePoint | undefined {
  const day = normalizeDate(point?.day);
  if (!point || !day) return undefined;
  return {
    day,
    open: Number(point.open) || 0,
    high: Number(point.high) || 0,
    low: Number(point.low) || 0,
    close: Number(point.close) || 0,
    volume: Number(point.volume) || 0
  };
}

function normalizeJournalNote(note: Partial<StockJournalNote> | undefined): StockJournalNote | undefined {
  const content = note?.content?.trim();
  if (!note?.id || !content) return undefined;
  const now = Date.now();
  return {
    id: note.id,
    date: normalizeDate(note.date),
    content,
    createdAt: Number(note.createdAt) || now,
    updatedAt: Number(note.updatedAt) || Number(note.createdAt) || now
  };
}

function normalizeDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1];
}

function todayDate(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function compareJournalNotes(left: StockJournalNote, right: StockJournalNote): number {
  const leftDate = left.date ?? "9999-12-31";
  const rightDate = right.date ?? "9999-12-31";
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
  return left.createdAt - right.createdAt;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

function normalizeWatchFloatStyle(style: WatchFloatStyle | undefined, fallback: WatchFloatStyle): WatchFloatStyle {
  const fontSize = Number(style?.font_size);
  const opacity = Number(style?.background_opacity);
  return {
    font_family: style?.font_family.trim() || fallback.font_family,
    font_size: Number.isFinite(fontSize) ? Math.min(Math.max(fontSize, 9), 32) : fallback.font_size,
    text_color: normalizeHexColor(style?.text_color, fallback.text_color),
    column_colors: normalizeWatchFloatColumnColors(style?.column_colors, style?.text_color ?? fallback.text_color, fallback.column_colors),
    metric_colors: normalizeWatchFloatMetricColors(style?.metric_colors, style?.column_colors, style?.text_color ?? fallback.text_color, fallback.metric_colors),
    background_color: normalizeHexColor(style?.background_color, fallback.background_color),
    background_opacity: Number.isFinite(opacity) ? Math.min(Math.max(opacity, 0), 1) : fallback.background_opacity,
    border_color: normalizeHexColor(style?.border_color, fallback.border_color),
    show_border: Boolean(style?.show_border)
  };
}

function normalizeWatchFloatProfiles(
  profiles: Record<string, WatchFloatStyle> | undefined,
  fallback: Record<string, WatchFloatStyle>
): Record<string, WatchFloatStyle> {
  if (!profiles) return fallback;
  const next: Record<string, WatchFloatStyle> = {};
  for (const [name, style] of Object.entries(profiles)) {
    const normalizedName = name.trim();
    if (!normalizedName) continue;
    const fallbackStyle = fallback[normalizedName] ?? fallback.simple ?? defaultWatchFloatStyle();
    next[normalizedName] = normalizeWatchFloatStyle(style, fallbackStyle);
  }
  return {
    ...next,
    simple: fallback.simple,
    sublime: fallback.sublime,
    "赛博朋克": fallback["赛博朋克"]
  };
}

function defaultWatchFloatStyle(): WatchFloatStyle {
  return {
    font_family: "Microsoft YaHei",
    font_size: 12,
    text_color: "#334155",
    column_colors: { name: "#334155", price: "#334155", change: "#334155", day_profit: "#334155" },
    metric_colors: { change: { up: "#334155", down: "#334155" }, day_profit: { up: "#334155", down: "#334155" } },
    background_color: "#ffffff",
    background_opacity: 0,
    border_color: "#334155",
    show_border: false
  };
}

function normalizeWatchFloatColumnColors(
  colors: Record<WatchFloatColumn, string> | undefined,
  fallbackColor: unknown,
  fallbackColors?: Record<WatchFloatColumn, string>
): Record<WatchFloatColumn, string> {
  const fallback = normalizeHexColor(fallbackColor, "#334155");
  return {
    name: normalizeHexColor(colors?.name, fallbackColors?.name ?? fallback),
    price: normalizeHexColor(colors?.price, fallbackColors?.price ?? fallback),
    change: normalizeHexColor(colors?.change, fallbackColors?.change ?? fallback),
    day_profit: normalizeHexColor(colors?.day_profit, fallbackColors?.day_profit ?? fallback)
  };
}

function normalizeWatchFloatMetricColors(
  metrics: WatchFloatStyle["metric_colors"] | undefined,
  columnColors: Partial<Record<WatchFloatColumn, string>> | undefined,
  fallbackColor: unknown,
  fallbackMetrics?: WatchFloatStyle["metric_colors"]
): WatchFloatStyle["metric_colors"] {
  const fallback = normalizeHexColor(fallbackColor, "#334155");
  const changeFallback = normalizeHexColor(columnColors?.change, fallback);
  const profitFallback = normalizeHexColor(columnColors?.day_profit, fallback);
  return {
    change: {
      up: normalizeHexColor(metrics?.change?.up, fallbackMetrics?.change.up ?? changeFallback),
      down: normalizeHexColor(metrics?.change?.down, fallbackMetrics?.change.down ?? changeFallback)
    },
    day_profit: {
      up: normalizeHexColor(metrics?.day_profit?.up, fallbackMetrics?.day_profit.up ?? profitFallback),
      down: normalizeHexColor(metrics?.day_profit?.down, fallbackMetrics?.day_profit.down ?? profitFallback)
    }
  };
}

function normalizeHexColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function createState(config: AppConfig): AppState {
  return {
    config,
    stocks: config.stocks.map((stock) => ({ config: stock })),
    sh_index: undefined,
    last_market_update: undefined,
    next_market_refresh: undefined
  };
}

function dataRefreshIntervalMs(hasHongKongStocks: boolean, tradingRefreshIntervalMs: number): number {
  if (!isTradingTime(hasHongKongStocks)) return OFF_HOURS_REFRESH_MS;
  return normalizeTradingRefreshInterval(tradingRefreshIntervalMs);
}

function nextLocalDayStart(now: number): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() || now + DAY_MS;
}

function isTradingTime(hasHongKongStocks: boolean): boolean {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const value = now.getHours() * 100 + now.getMinutes();
  const morningClose = hasHongKongStocks ? 1200 : 1130;
  const afternoonClose = hasHongKongStocks ? 1600 : 1500;
  return (value >= 915 && value <= morningClose) || (value >= 1300 && value <= afternoonClose);
}
