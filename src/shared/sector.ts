import type { IndustrySector, StockConfig, StockIndustryConfig } from "./types";

export function chinaDate(now = Date.now()): string {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}

export function normalizeIndustry(value: unknown): StockIndustryConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<StockIndustryConfig>;
  const sectors: IndustrySector[] = [];
  for (const item of Array.isArray(raw.sectors) ? raw.sectors : []) {
    if (!item || typeof item.id !== "string" || !/^01[A-Za-z0-9]{2,18}$/.test(item.id)
      || typeof item.name !== "string" || !item.name.trim() || sectors.some((entry) => entry.id === item.id)) continue;
    sectors.push({ id: item.id, name: item.name.trim(), level: Number(item.level) || 1 });
  }
  const date = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  return {
    sectors,
    selected_id: sectors.some((item) => item.id === raw.selected_id) ? raw.selected_id
      : [...sectors].sort((a, b) => b.level - a.level)[0]?.id,
    attempted_on: date(raw.attempted_on),
    updated_on: date(raw.updated_on),
    show_near_price: raw.show_near_price === true,
    show_in_float: raw.show_in_float === true
  };
}

export function selectedIndustry(stock: StockConfig): IndustrySector | undefined {
  return stock.industry?.sectors.find((item) => item.id === stock.industry?.selected_id);
}
