import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { defaultThemes } from "../shared/theme";
import type { AppConfig } from "../shared/types";

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

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return ["watchlist"];
  const normalized = tags
    .map((tag) => String(tag).trim())
    .filter(Boolean);
  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
}
