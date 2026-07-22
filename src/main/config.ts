import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { defaultThemes } from "../shared/theme";
import type { AppConfig, MottoConfig, StockConfig, WatchFloatColumn, WatchFloatConfig, WatchFloatStyle } from "../shared/types";

export const DEFAULT_TRADING_REFRESH_INTERVAL_MS = 1000;
export const MIN_TRADING_REFRESH_INTERVAL_MS = 500;
export const MAX_TRADING_REFRESH_INTERVAL_MS = 10000;

const defaultMotto: MottoConfig = {
  text: "\u51b7\u9759\uff0c\u8010\u5fc3\uff0c\u53ea\u505a\u770b\u5f97\u61c2\u7684\u51b3\u5b9a\u3002",
  font_family: "Microsoft YaHei",
  font_size: 14,
  color: "#f8fafc"
};

const defaultWatchFloatStyle: WatchFloatStyle = {
  font_family: "Microsoft YaHei",
  font_size: 12,
  text_color: "#334155",
  column_colors: {
    name: "#334155",
    price: "#334155",
    change: "#334155",
    day_profit: "#334155"
  },
  metric_colors: {
    change: { up: "#334155", down: "#334155" },
    day_profit: { up: "#334155", down: "#334155" }
  },
  background_color: "#ffffff",
  background_opacity: 0,
  border_color: "#334155",
  show_border: false
};

const builtInWatchFloatProfiles: Record<string, WatchFloatStyle> = {
  simple: defaultWatchFloatStyle,
  sublime: {
      ...defaultWatchFloatStyle,
      font_family: "Consolas",
      font_size: 12,
      text_color: "#f8f8f2",
      column_colors: {
        name: "#f8f8f2",
        price: "#a6e22e",
        change: "#66d9ef",
        day_profit: "#fd971f"
      },
      metric_colors: {
        change: { up: "#a6e22e", down: "#f92672" },
        day_profit: { up: "#a6e22e", down: "#f92672" }
      },
      background_color: "#272822",
      background_opacity: 0.86,
      border_color: "#49483e",
      show_border: true
  },
  "赛博朋克": {
      ...defaultWatchFloatStyle,
      font_family: "Microsoft YaHei",
      font_size: 12,
      text_color: "#e7f9ff",
      column_colors: {
        name: "#e7f9ff",
        price: "#00f5ff",
        change: "#ff2bd6",
        day_profit: "#f9f871"
      },
      metric_colors: {
        change: { up: "#00f5ff", down: "#ff2bd6" },
        day_profit: { up: "#f9f871", down: "#ff2bd6" }
      },
      background_color: "#080b1f",
      background_opacity: 0.78,
      border_color: "#00f5ff",
      show_border: true
  }
};

export class ConfigManager {
  private readonly configPath: string;
  private lastModified = 0;

  constructor() {
    this.configPath = path.join(app.getPath("appData"), "fin-box", "config.yaml");
  }

  path(): string {
    return this.configPath;
  }

  dir(): string {
    return path.dirname(this.configPath);
  }

  loadOrDefault(): AppConfig {
    const loaded = this.loadFromFile();
    if (loaded) return loaded;

    const config: AppConfig = {
      total_investment: 100000,
      cash: 50000,
      motto: defaultMotto,
      watch_float: {
        stock_codes: ["sz002594"],
        columns: ["name", "change"],
        layout: "vertical",
        show_news: false,
        horizontal_stock_ratio: 3,
        horizontal_news_ratio: 2,
        style: defaultWatchFloatStyle,
        active_profile: "simple",
        profiles: builtInWatchFloatProfiles
      },
      trading_refresh_interval_ms: DEFAULT_TRADING_REFRESH_INTERVAL_MS,
      window_close_behavior: "close",
      hide_zero_shares: false,
      stock_groups: ["watchlist"],
      stock_group_order: {},
      stocks: [
        {
          code: "sz002594",
          alias: "BYD",
          tags: ["watchlist"],
          positions: [{ account: "Account A", shares: 100, cost: 250 }]
        }
      ],
      current_theme: "simple",
      themes: { ...defaultThemes }
    };
    this.save(config);
    return config;
  }

  forceReload(): AppConfig | undefined {
    this.refreshModifiedTime();
    return this.loadFromFile();
  }

  reloadIfChanged(): AppConfig | undefined {
    try {
      const modified = fs.statSync(this.configPath).mtimeMs;
      if (modified !== this.lastModified) {
        this.lastModified = modified;
        return this.loadFromFile();
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  save(config: AppConfig): void {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, yaml.dump(config, { lineWidth: 120 }), "utf8");
    this.refreshModifiedTime();
  }

  private loadFromFile(): AppConfig | undefined {
    try {
      const raw = fs.readFileSync(this.configPath, "utf8");
      const config = yaml.load(raw) as Partial<AppConfig> | undefined;
      if (!config) return undefined;
      const stockGroups = normalizeOrderedTags(config.stock_groups);
      const stocks: StockConfig[] = (config.stocks ?? []).map((stock) => ({
        code: stock.code,
        alias: stock.alias,
        tags: normalizeTags(stock.tags),
        positions: stock.positions ?? []
      }));
      const normalized: AppConfig = {
        total_investment: config.total_investment,
        cash: config.cash,
        motto: normalizeMotto(config.motto),
        watch_float: normalizeWatchFloat(config.watch_float, stocks),
        trading_refresh_interval_ms: normalizeTradingRefreshInterval(config.trading_refresh_interval_ms),
        window_close_behavior: config.window_close_behavior === "close" ? "close" : "tray",
        hide_zero_shares: config.hide_zero_shares ?? false,
        stocks,
        stock_groups: stockGroups.length ? stockGroups : ["watchlist"],
        stock_group_order: normalizeStockGroupOrder(config.stock_group_order),
        current_theme: config.current_theme ?? "simple",
        themes: { ...defaultThemes, ...(config.themes ?? {}) }
      };
      this.refreshModifiedTime();
      return normalized;
    } catch {
      return undefined;
    }
  }

  private refreshModifiedTime(): void {
    try {
      this.lastModified = fs.statSync(this.configPath).mtimeMs;
    } catch {
      this.lastModified = 0;
    }
  }
}

const watchFloatColumns: WatchFloatColumn[] = ["name", "price", "change", "day_profit"];

function normalizeWatchFloat(value: unknown, stocks: StockConfig[]): WatchFloatConfig {
  const knownCodes = new Map(stocks.map((stock) => [stock.code.toLowerCase(), stock.code]));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      stock_codes: stocks.map((stock) => stock.code),
      columns: ["name", "change"],
      layout: "vertical",
      show_news: false,
      horizontal_stock_ratio: 3,
      horizontal_news_ratio: 2,
      style: defaultWatchFloatStyle,
      active_profile: "simple",
      profiles: withBuiltInWatchFloatProfiles({})
    };
  }

  const config = value as Partial<WatchFloatConfig>;
  const profiles = normalizeWatchFloatProfiles(config.profiles, stocks);
  const stockCodes = Array.isArray(config.stock_codes)
    ? [...new Set(config.stock_codes.map((code) => knownCodes.get(String(code).toLowerCase())).filter((code): code is string => Boolean(code)))]
    : stocks.map((stock) => stock.code);
  const columns = Array.isArray(config.columns)
    ? [...new Set(config.columns.filter((column): column is WatchFloatColumn => watchFloatColumns.includes(column as WatchFloatColumn)))]
    : [];
  const legacyStyle = config.style as ({ layout?: unknown } & Partial<WatchFloatStyle>) | undefined;

  return {
    stock_codes: stockCodes,
    columns: columns.length ? columns : ["name", "change"],
    layout: normalizeWatchFloatLayout(config.layout ?? legacyStyle?.layout),
    show_news: Boolean(config.show_news),
    horizontal_stock_ratio: normalizeWatchFloatRatio(config.horizontal_stock_ratio, 3),
    horizontal_news_ratio: normalizeWatchFloatRatio(config.horizontal_news_ratio, 2),
    style: normalizeWatchFloatStyle(config.style),
    active_profile: typeof config.active_profile === "string" && config.active_profile.trim() ? config.active_profile.trim() : "custom",
    profiles
  };
}

function normalizeWatchFloatRatio(value: unknown, fallback: number): number {
  const ratio = Number(value);
  if (!Number.isFinite(ratio)) return fallback;
  return Math.min(Math.max(Math.round(ratio), 1), 10);
}

function normalizeWatchFloatProfiles(value: unknown, stocks: StockConfig[]): Record<string, WatchFloatStyle> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return withBuiltInWatchFloatProfiles({});
  const profiles: Record<string, WatchFloatStyle> = {};
  for (const [name, profile] of Object.entries(value)) {
    const normalizedName = name.trim();
    if (!normalizedName || !profile || typeof profile !== "object" || Array.isArray(profile)) continue;
    profiles[normalizedName] = normalizeWatchFloatProfileStyle(profile);
  }
  return withBuiltInWatchFloatProfiles(profiles);
}

function normalizeWatchFloatProfileStyle(profile: object): WatchFloatStyle {
  const legacyProfile = profile as { style?: unknown };
  return normalizeWatchFloatStyle(legacyProfile.style ?? profile);
}

function withBuiltInWatchFloatProfiles(profiles: Record<string, WatchFloatStyle>): Record<string, WatchFloatStyle> {
  return {
    ...profiles,
    ...builtInWatchFloatProfiles
  };
}

function normalizeWatchFloatStyle(value: unknown): WatchFloatStyle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultWatchFloatStyle;
  const style = value as Partial<WatchFloatStyle>;
  const fontSize = Number(style.font_size);
  const opacity = Number(style.background_opacity);
  return {
    font_family: typeof style.font_family === "string" && style.font_family.trim() ? style.font_family.trim() : defaultWatchFloatStyle.font_family,
    font_size: Number.isFinite(fontSize) ? Math.min(Math.max(fontSize, 9), 32) : defaultWatchFloatStyle.font_size,
    text_color: normalizeHexColor(style.text_color, defaultWatchFloatStyle.text_color),
    column_colors: normalizeWatchFloatColumnColors(style.column_colors, style.text_color),
    metric_colors: normalizeWatchFloatMetricColors(style.metric_colors, style.column_colors, style.text_color),
    background_color: normalizeHexColor(style.background_color, defaultWatchFloatStyle.background_color),
    background_opacity: Number.isFinite(opacity) ? Math.min(Math.max(opacity, 0), 1) : defaultWatchFloatStyle.background_opacity,
    border_color: normalizeHexColor(style.border_color, defaultWatchFloatStyle.border_color),
    show_border: Boolean(style.show_border)
  };
}

function normalizeWatchFloatLayout(value: unknown): WatchFloatConfig["layout"] {
  return value === "horizontal" ? "horizontal" : "vertical";
}

function normalizeWatchFloatMetricColors(value: unknown, columnColors: unknown, fallbackColor: unknown): WatchFloatStyle["metric_colors"] {
  const fallback = normalizeHexColor(fallbackColor, defaultWatchFloatStyle.text_color);
  const colors = columnColors && typeof columnColors === "object" && !Array.isArray(columnColors)
    ? columnColors as Partial<Record<WatchFloatColumn, string>>
    : {};
  const metrics = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<WatchFloatStyle["metric_colors"]>
    : {};
  const changeFallback = normalizeHexColor(colors.change, fallback);
  const profitFallback = normalizeHexColor(colors.day_profit, fallback);
  return {
    change: {
      up: normalizeHexColor(metrics.change?.up, changeFallback),
      down: normalizeHexColor(metrics.change?.down, changeFallback)
    },
    day_profit: {
      up: normalizeHexColor(metrics.day_profit?.up, profitFallback),
      down: normalizeHexColor(metrics.day_profit?.down, profitFallback)
    }
  };
}

function normalizeWatchFloatColumnColors(value: unknown, fallbackColor: unknown): Record<WatchFloatColumn, string> {
  const fallback = normalizeHexColor(fallbackColor, defaultWatchFloatStyle.text_color);
  const colors = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<Record<WatchFloatColumn, string>> : {};
  return {
    name: normalizeHexColor(colors.name, fallback),
    price: normalizeHexColor(colors.price, fallback),
    change: normalizeHexColor(colors.change, fallback),
    day_profit: normalizeHexColor(colors.day_profit, fallback)
  };
}

function normalizeHexColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

export function normalizeTradingRefreshInterval(value: unknown): number {
  const interval = Number(value);
  if (!Number.isFinite(interval)) return DEFAULT_TRADING_REFRESH_INTERVAL_MS;
  return Math.min(Math.max(Math.round(interval), MIN_TRADING_REFRESH_INTERVAL_MS), MAX_TRADING_REFRESH_INTERVAL_MS);
}

function normalizeMotto(value: unknown): MottoConfig {
  if (typeof value === "string") {
    return { ...defaultMotto, text: value };
  }
  if (!value || typeof value !== "object") return defaultMotto;

  const motto = value as Partial<MottoConfig>;
  const fontSize = Number(motto.font_size);
  return {
    text: typeof motto.text === "string" ? motto.text : defaultMotto.text,
    font_family: typeof motto.font_family === "string" && motto.font_family.trim() ? motto.font_family.trim() : defaultMotto.font_family,
    font_size: Number.isFinite(fontSize) ? Math.min(Math.max(fontSize, 10), 36) : defaultMotto.font_size,
    color: typeof motto.color === "string" && /^#[0-9a-fA-F]{6}$/.test(motto.color) ? motto.color : defaultMotto.color
  };
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return ["watchlist"];
  const normalized = tags
    .map((tag) => String(tag).trim())
    .filter(Boolean);
  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
}

function normalizeOrderedTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))];
}

function normalizeStockGroupOrder(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string[]> = {};
  for (const [tag, codes] of Object.entries(value)) {
    const normalizedTag = tag.trim();
    if (!normalizedTag || !Array.isArray(codes)) continue;
    result[normalizedTag] = [...new Set(codes.map((code) => String(code).trim()).filter(Boolean))];
  }
  return result;
}
