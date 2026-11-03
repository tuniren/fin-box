import iconv from "iconv-lite";
import { chinaDate, normalizeIndustry } from "../shared/sector";
import type { AppConfig, IndustrySector, SectorMinute, SectorQuote } from "../shared/types";
import { loggedFetch } from "./requestLog";

const headers = { Referer: "https://gu.qq.com/", "User-Agent": "Mozilla/5.0" };
const validId = (id: string) => /^01[A-Za-z0-9]{2,18}$/.test(id);

async function request(url: string, source: string): Promise<Response> {
  const response = await loggedFetch(url, { headers, signal: AbortSignal.timeout(10000) }, source);
  if (!response.ok) {
    const error = new Error(`腾讯行业接口 HTTP ${response.status}`) as Error & { retryAfter?: number };
    const retry = response.headers.get("retry-after");
    if (retry) error.retryAfter = /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now());
    throw error;
  }
  return response;
}

export async function fetchIndustryMembership(code: string): Promise<IndustrySector[]> {
  if (!/^(sh|sz|bj)\d{6}$/.test(code)) throw new Error("行业板块暂仅支持 A 股");
  const response = await request(`https://proxy.finance.qq.com/ifzqgtimg/appstock/app/stockinfo/plateNew?code=${code}&app=wzq&zdf=1`, "Tencent Industry Membership");
  const payload = await response.json();
  if (payload.code !== 0 || !payload.data || !Array.isArray(payload.data.plate)) throw new Error("腾讯行业归属响应无效");
  const rows = payload.data.plate.map((item: Record<string, unknown>) => ({
    id: item.id ?? item.code, name: item.name, level: item.level
  }));
  const sectors = normalizeIndustry({ sectors: rows })!.sectors;
  if (rows.length && !sectors.length) throw new Error("腾讯行业归属字段无效");
  return sectors;
}

export function parseSectorQuotes(text: string, now = Date.now()): Record<string, SectorQuote> {
  const result: Record<string, SectorQuote> = {};
  for (const match of text.matchAll(/v_pt([A-Za-z0-9]+)="([^"]*)"/g)) {
    const id = match[1];
    const row = match[2].split("~");
    if (!validId(id) || !row[3]?.trim() || !row[4]?.trim() || !row[32]?.trim()) continue;
    const price = Number(row[3]), previous = Number(row[4]), change = Number(row[32]);
    if (![price, previous, change].every(Number.isFinite) || price <= 0 || previous <= 0) continue;
    result[id] = { id, name: row[1], price, previous_close: previous, change_percent: change, time: row[30] || "", fetched_at: now };
  }
  return result;
}

export async function fetchSectorQuotes(ids: string[]): Promise<Record<string, SectorQuote>> {
  const symbols = [...new Set(ids.filter(validId))].map((id) => `pt${id}`);
  if (!symbols.length) return {};
  const response = await request(`https://qt.gtimg.cn/q=${symbols.join(",")}`, "Tencent Industry Quotes");
  return parseSectorQuotes(iconv.decode(Buffer.from(await response.arrayBuffer()), "gbk"));
}

export function parseSectorMinute(payload: unknown, id: string, now = Date.now()): SectorMinute {
  const value = payload as { code?: number; data?: Record<string, { data?: { date?: string; data?: unknown[] }; qt?: Record<string, unknown> }> };
  const data = value.data?.[`pt${id}`]?.data;
  if (value.code !== 0 || !data || !/^\d{8}$/.test(data.date ?? "") || !Array.isArray(data.data)) throw new Error("腾讯行业分时响应无效");
  const points = data.data.flatMap((row) => {
    if (typeof row !== "string") return [];
    const [time, price] = row.trim().split(/\s+/);
    if (!/^(09|10|11|13|14|15)\d{2}$/.test(time) || !price || !Number.isFinite(Number(price)) || Number(price) <= 0) return [];
    return [{ time: `${time.slice(0, 2)}:${time.slice(2)}`, price: Number(price) }];
  });
  if (data.data.length && !points.length) throw new Error("腾讯行业分时字段无效");
  const row = value.data?.[`pt${id}`]?.qt?.[`pt${id}`];
  const quote = Array.isArray(row) ? parseSectorQuotes(`v_pt${id}="${row.join("~")}";`, now)[id] : undefined;
  return { date: data.date!, points, fetched_at: now, quote };
}

export async function fetchSectorMinute(id: string): Promise<SectorMinute> {
  if (!validId(id)) throw new Error("无效行业代码");
  const response = await request(`https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=pt${id}`, "Tencent Industry Minute");
  return parseSectorMinute(await response.json(), id);
}

export class IndustryMembershipService {
  readonly errors: Record<string, string> = {};
  private readonly pending = new Map<string, Promise<void>>();
  constructor(
    private readonly read: () => AppConfig,
    private readonly save: (config: AppConfig) => void,
    private readonly fetchMembership = fetchIndustryMembership,
    private readonly today = chinaDate
  ) {}

  open(code: string): Promise<void> {
    code = code.toLowerCase();
    if (!/^(sh|sz|bj)\d{6}$/.test(code)) return Promise.resolve();
    const day = this.today();
    const key = `${code}:${day}`;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const config = this.read();
    const stock = config.stocks.find((item) => item.code.toLowerCase() === code);
    if (!stock || stock.industry?.attempted_on === day) return Promise.resolve();
    // Persist the attempt BEFORE networking: a restart or failed response must not cause another query today.
    stock.industry = normalizeIndustry(stock.industry) ?? { sectors: [], show_near_price: false, show_in_float: false };
    stock.industry.attempted_on = day;
    this.save(config);
    const job = this.fetchMembership(code).then((sectors) => {
      // Read the latest configuration to preserve edits made while the request was in flight.
      const latest = this.read();
      const current = latest.stocks.find((item) => item.code.toLowerCase() === code);
      if (!current || current.industry?.attempted_on !== day) return;
      current.industry = normalizeIndustry({ ...current.industry, sectors, updated_on: day });
      this.save(latest);
      delete this.errors[code];
    }).catch((error) => {
      this.errors[code] = error instanceof Error ? error.message : String(error);
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, job);
    return job;
  }
}

type Dependencies = {
  quotes: typeof fetchSectorQuotes;
  minute: typeof fetchSectorMinute;
  now: () => number;
};

/** Shared by all windows. No timer: AppCore's market refresh is the only scheduler. */
export class SectorMarketService {
  readonly quotes: Record<string, SectorQuote> = {};
  readonly minutes: Record<string, SectorMinute> = {};
  readonly errors: Record<string, string> = {};
  private readonly pending = new Map<string, Promise<void>>();
  private readonly started = new Map<string, number>();
  private readonly failures = new Map<string, { count: number; retryAt: number }>();

  constructor(private readonly onChange: () => void, private readonly deps: Dependencies = {
    quotes: fetchSectorQuotes, minute: fetchSectorMinute, now: Date.now
  }) {}

  async refresh(ids: string[], chartIds: string[], intervalMs: number): Promise<void> {
    const now = this.deps.now();
    const due = (key: string) => !this.pending.has(key)
      && now >= (this.failures.get(key)?.retryAt ?? 0)
      && now - (this.started.get(key) ?? -Infinity) >= intervalMs;
    const chartSet = new Set(chartIds.filter(validId));
    // The minute response already contains its quote. Reuse it instead of requesting that quote twice.
    const quoteIds = [...new Set(ids.filter(validId))].filter((id) => due(`q:${id}`) && (
      !chartSet.has(id) || this.failures.has(`m:${id}`) || Boolean(this.minutes[id] && !this.minutes[id].quote)
    ));
    const jobs: Promise<void>[] = [];
    // Keep URLs bounded; one request normally serves all visible sectors.
    for (let offset = 0; offset < quoteIds.length; offset += 80) {
      const batch = quoteIds.slice(offset, offset + 80);
      const keys = batch.map((id) => `q:${id}`);
      keys.forEach((key) => this.started.set(key, now));
      const job = this.deps.quotes(batch).then((quotes) => {
        for (const id of batch) {
          const key = `q:${id}`;
          if (quotes[id]) { this.quotes[id] = quotes[id]; this.succeeded(key); }
          else this.failed(key, new Error("腾讯未返回该行业行情"));
        }
      }).catch((error) => keys.forEach((key) => this.failed(key, error)))
        .finally(() => { keys.forEach((key) => this.pending.delete(key)); this.onChange(); });
      keys.forEach((key) => this.pending.set(key, job));
      jobs.push(job);
    }
    for (const id of chartSet) {
      const key = `m:${id}`;
      if (!due(key)) continue;
      this.started.set(key, now);
      const job = this.deps.minute(id).then((minute) => {
        this.minutes[id] = minute; this.succeeded(key);
        if (minute.quote) {
          this.quotes[id] = minute.quote;
          this.started.set(`q:${id}`, now);
          this.succeeded(`q:${id}`);
        }
      })
        .catch((error) => this.failed(key, error))
        .finally(() => { this.pending.delete(key); this.onChange(); });
      this.pending.set(key, job);
      jobs.push(job);
    }
    await Promise.all(jobs);
  }

  private succeeded(key: string): void { this.failures.delete(key); delete this.errors[key]; }
  private failed(key: string, error: unknown): void {
    const count = (this.failures.get(key)?.count ?? 0) + 1;
    const delay = [60000, 300000, 900000][Math.min(count - 1, 2)];
    const retryAfter = Number((error as { retryAfter?: number })?.retryAfter) || 0;
    this.failures.set(key, { count, retryAt: this.deps.now() + Math.max(delay, retryAfter) });
    this.errors[key] = error instanceof Error ? error.message : String(error);
  }
}
