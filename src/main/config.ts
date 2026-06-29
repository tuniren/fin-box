import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { defaultThemes } from "../shared/theme";
import type { AppConfig, MottoConfig } from "../shared/types";

const defaultMotto: MottoConfig = {
  text: "\u51b7\u9759\uff0c\u8010\u5fc3\uff0c\u53ea\u505a\u770b\u5f97\u61c2\u7684\u51b3\u5b9a\u3002",
  font_family: "Microsoft YaHei",
  font_size: 14,
  color: "#f8fafc"
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
      hide_zero_shares: false,
      stocks: [
        {
          code: "sz002594",
          alias: "BYD",
          tags: ["watchlist"],
          positions: [{ account: "Account A", shares: 100, cost: 250 }]
        }
      ],
      current_theme: "default",
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
      const normalized: AppConfig = {
        total_investment: config.total_investment,
        cash: config.cash,
        motto: normalizeMotto(config.motto),
        hide_zero_shares: config.hide_zero_shares ?? false,
        stocks: (config.stocks ?? []).map((stock) => ({
          code: stock.code,
          alias: stock.alias,
          tags: normalizeTags(stock.tags),
          positions: stock.positions ?? []
        })),
        current_theme: config.current_theme ?? "default",
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
