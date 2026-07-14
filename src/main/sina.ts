import iconv from "iconv-lite";
import type { FiveDayMinutePoint, KLinePoint, KLineScale, MarketData, MinutePoint, StockCommentItem, StockCommentPage, StockNewsArticle, StockNewsItem, StockNewsPage, StockSearchResult } from "../shared/types";

const referer = "https://finance.sina.com.cn/";
const thsNewsPageSize = 20;
const thsSourcePagesPerResultPage = 8;

export async function fetchMultipleStocks(codes: string[]): Promise<Map<string, MarketData>> {
  if (codes.length === 0) return new Map();
  const quoteCodes = codes.map(toSinaQuoteCode);
  const url = `http://hq.sinajs.cn/list=${quoteCodes.join(",")}`;
  const response = await fetch(url, {
    headers: {
      Referer: referer,
      "User-Agent": "Mozilla/5.0"
    }
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return parseSinaQuote(iconv.decode(bytes, "gbk"));
}

export async function searchStocks(query: string): Promise<StockSearchResult[]> {
  const url = `http://suggest3.sinajs.cn/suggest/type=&key=${encodeURIComponent(query)}&name=suggestdata_${Date.now()}`;
  const response = await fetch(url, { headers: { Referer: referer } });
  const bytes = Buffer.from(await response.arrayBuffer());
  const results = parseSuggest(iconv.decode(bytes, "gbk"));
  const directHongKongCode = normalizeHongKongSearchCode(query);
  if (directHongKongCode && !results.some((item) => item.code === directHongKongCode)) {
    results.unshift({ code: directHongKongCode, name: directHongKongCode });
  }
  return results;
}

export async function fetchKLineData(code: string, scale: KLineScale): Promise<KLinePoint[]> {
  const symbol = code.toLowerCase();
  if (isHongKongCode(symbol)) return fetchTencentKLineData(symbol, scale);

  const url =
    `http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData` +
    `?symbol=${symbol}&scale=${scale}&ma=no&datalen=300`;
  const response = await fetch(url);
  const text = await response.text();
  const data = JSON.parse(text) as Array<Record<string, string>>;
  return data.map((point) => ({
    day: point.day,
    open: Number(point.open),
    high: Number(point.high),
    low: Number(point.low),
    close: Number(point.close),
    volume: Number(point.volume)
  }));
}

async function fetchTencentKLineData(symbol: string, scale: KLineScale): Promise<KLinePoint[]> {
  const period = scale === 240 ? "day" : `m${scale}`;
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${encodeURIComponent(`${symbol},${period},,,300,qfq`)}`;
  const response = await fetch(url, {
    headers: {
      Referer: "https://gu.qq.com/",
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json, text/plain, */*"
    }
  });
  const payload = await response.json() as TencentKLineResponse;
  const root = payload.data?.[symbol] ?? payload.data?.[symbol.toUpperCase()];
  const rows = root?.[`qfq${period}`] ?? root?.[period] ?? [];
  return rows.map(parseTencentKLineRow).filter((point): point is KLinePoint => point !== undefined);
}

export async function fetchTencentFiveDayMinuteData(code: string): Promise<FiveDayMinutePoint[]> {
  const symbol = code.toLowerCase();
  const url = `https://web.ifzq.gtimg.cn/appstock/app/day/query?code=${encodeURIComponent(symbol)}`;
  const response = await fetch(url, {
    headers: {
      Referer: "https://gu.qq.com/",
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json, text/plain, */*"
    }
  });
  const payload = await response.json() as TencentFiveDayResponse;
  const root = payload.data?.[symbol] ?? payload.data?.[symbol.toUpperCase()];
  if (!root) return [];

  const volumeUnit = isHongKongCode(symbol) ? 1 : 100;
  const previousClose = parseTencentPrevClose(root);
  const days = (Array.isArray(root.data) ? root.data : []).slice(-5);
  const result: FiveDayMinutePoint[] = [];

  for (const day of days) {
    if (!day || typeof day.date !== "string" || !Array.isArray(day.data)) continue;
    const normalizedDay = normalizeTencentDay(day.date);
    const dayPreviousClose = numberOrUndefined(day.prec) ?? previousClose;
    let previousVolume = 0;
    for (const row of day.data) {
      const timeValue = String(row).trim().split(/\s+/)[0] ?? "";
      if (!isRegularTradingMinute(timeValue, isHongKongCode(symbol))) continue;
      const point = parseTencentMinuteRow(row, dayPreviousClose, previousVolume, volumeUnit);
      if (!point) continue;
      previousVolume = point.cumulativeVolume;
      result.push({ ...point.value, day: normalizedDay });
    }
  }
  return result;
}

export async function fetchTencentMinuteData(code: string): Promise<MinutePoint[]> {
  const symbol = code.toLowerCase();
  const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${encodeURIComponent(symbol)}`;
  const response = await fetch(url, {
    headers: {
      Referer: "https://gu.qq.com/",
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json, text/plain, */*"
    }
  });
  const text = await response.text();
  return parseTencentMinuteData(text, symbol);
}

export async function fetchStockNews(code: string, page: number, keyword?: string): Promise<StockNewsPage> {
  const currentPage = Math.max(1, Math.floor(page) || 1);
  const terms = stockNewsTerms(code, keyword);
  const matches: StockNewsItem[] = [];
  let lastSourcePageCount = 0;
  const sourcePageLimit = currentPage * thsSourcePagesPerResultPage;

  for (let sourcePage = 1; sourcePage <= sourcePageLimit && matches.length <= currentPage * thsNewsPageSize; sourcePage += 1) {
    const items = await fetchThsRealtimeNewsPage(sourcePage);
    lastSourcePageCount = items.length;
    matches.push(...items.filter((item) => isRelatedNewsItem(item, terms)));
    if (items.length < thsNewsPageSize) break;
  }

  const start = (currentPage - 1) * thsNewsPageSize;
  const end = start + thsNewsPageSize;
  return {
    items: matches.slice(start, end),
    page: currentPage,
    hasMore: matches.length > end || lastSourcePageCount >= thsNewsPageSize
  };
}

export async function fetchStockComments(code: string, page: number): Promise<StockCommentPage> {
  const currentPage = Math.max(1, Math.floor(page) || 1);
  const comments = await fetchThsDiscussionPage(code, currentPage);
  if (comments.length > 0) {
    return {
      items: comments,
      page: currentPage,
      hasMore: comments.length >= thsNewsPageSize
    };
  }

  const newsPage = await fetchStockNews(code, page);
  return {
    items: newsPage.items.map((item) => thsNewsToComment(item)),
    page: newsPage.page,
    hasMore: newsPage.hasMore
  };
}

async function fetchThsDiscussionPage(code: string, page: number): Promise<StockCommentItem[]> {
  const simpleCode = code.replace(/\D/g, "");
  if (!/^\d{6}$/.test(simpleCode)) return [];

  const url = page <= 1
    ? `https://guba.10jqka.com.cn/${simpleCode}/`
    : `https://guba.10jqka.com.cn/${simpleCode}/index_${page}.html`;
  const response = await fetch(url, {
    headers: {
      Referer: `https://guba.10jqka.com.cn/${simpleCode}/`,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  if (!response.ok) return [];

  const bytes = Buffer.from(await response.arrayBuffer());
  const html = decodeHtmlResponse(bytes, response.headers.get("content-type"));
  return parseThsDiscussion(html, simpleCode, page);
}

async function fetchThsRealtimeNewsPage(page: number): Promise<StockNewsItem[]> {
  const url = `https://news.10jqka.com.cn/tapp/news/push/stock?page=${page}&tag=&track=website&pagesize=${thsNewsPageSize}`;
  const response = await fetch(url, {
    headers: {
      Referer: "https://news.10jqka.com.cn/realtimenews.html",
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json, text/plain, */*"
    }
  });
  const payload = await response.json() as ThsRealtimeNewsResponse;
  return parseThsRealtimeNews(payload);
}

export async function fetchStockNewsArticle(url: string): Promise<StockNewsArticle> {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Unsupported news URL.");
  }

  const response = await fetch(parsedUrl.toString(), {
    headers: {
      Referer: referer,
      "User-Agent": "Mozilla/5.0"
    }
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const html = decodeHtmlResponse(bytes, response.headers.get("content-type"));
  return parseStockNewsArticle(html, parsedUrl.toString());
}

function parseSinaQuote(body: string): Map<string, MarketData> {
  const result = new Map<string, MarketData>();

  for (const line of body.split(/\r?\n/)) {
    const eqIndex = line.indexOf("=");
    if (eqIndex < 0) continue;

    const varPart = line.slice(0, eqIndex);
    const quoteCode = varPart.slice(varPart.lastIndexOf("str_") + 4).trim().toLowerCase();
    const code = fromSinaQuoteCode(quoteCode);
    const startQuote = line.indexOf('"', eqIndex);
    const endQuote = line.lastIndexOf('"');
    if (startQuote < 0 || endQuote <= startQuote) continue;

    const parts = line.slice(startQuote + 1, endQuote).split(",");
    if (parts.length < 4) continue;

    if (isHongKongCode(code)) {
      result.set(code, {
        name: parts[1] || parts[0] || code,
        open: numberAt(parts, 2),
        prev_close: numberAt(parts, 3),
        current_price: numberAt(parts, 6),
        high: numberAt(parts, 4),
        low: numberAt(parts, 5),
        time: `${parts[17] ?? ""} ${parts[18] ?? ""}`.trim()
      });
      continue;
    }

    result.set(code, {
      name: parts[0],
      open: numberAt(parts, 1),
      prev_close: numberAt(parts, 2),
      current_price: numberAt(parts, 3),
      high: numberAt(parts, 4),
      low: numberAt(parts, 5),
      time: `${parts[30] ?? ""} ${parts[31] ?? ""}`.trim()
    });
  }

  return result;
}

function parseTencentMinuteData(body: string, symbol: string): MinutePoint[] {
  const payload = parseJsonLike(body) as TencentMinuteResponse;
  const dataRoot = payload.data?.[symbol] ?? payload.data?.[symbol.toUpperCase()];
  if (!dataRoot) return [];

  const rows = Array.isArray(dataRoot.data?.data) ? dataRoot.data.data : [];
  const prevClose = parseTencentPrevClose(dataRoot);
  const points: MinutePoint[] = [];
  let previousVolume = 0;

  for (const row of rows) {
    const point = parseTencentMinuteRow(row, prevClose, previousVolume, isHongKongCode(symbol) ? 1 : 100);
    if (!point) continue;
    previousVolume = point.cumulativeVolume;
    points.push(point.value);
  }

  return points;
}

type TencentFiveDayResponse = {
  data?: Record<string, TencentFiveDayRoot>;
};

type TencentFiveDayRoot = {
  data?: Array<{ date?: string; data?: unknown[]; prec?: string }>;
  qt?: Record<string, unknown[]>;
};
type TencentKLineResponse = {
  data?: Record<string, Record<string, unknown[][]>>;
};

function parseTencentKLineRow(row: unknown[]): KLinePoint | undefined {
  if (!Array.isArray(row) || row.length < 6) return undefined;
  const open = Number(row[1]);
  const close = Number(row[2]);
  const high = Number(row[3]);
  const low = Number(row[4]);
  const volume = Number(row[5]);
  if (![open, close, high, low, volume].every(Number.isFinite)) return undefined;
  return { day: String(row[0]), open, high, low, close, volume };
}

type TencentMinuteResponse = {
  data?: Record<string, TencentMinuteRoot>;
};

type TencentMinuteRoot = {
  data?: {
    data?: unknown[];
  };
  qt?: Record<string, unknown[]>;
};

function parseTencentMinuteRow(row: unknown, prevClose: number | undefined, previousVolume: number, volumeUnit: number): { value: MinutePoint; cumulativeVolume: number } | undefined {
  const parts = Array.isArray(row) ? row.map(String) : String(row).trim().split(/\s+/);
  if (parts.length < 2) return undefined;

  const price = Number(parts[1]);
  if (!Number.isFinite(price) || price <= 0) return undefined;

  const cumulativeVolume = numberOrUndefined(parts[2]) ?? 0;
  const cumulativeAmount = numberOrUndefined(parts[3]);
  const avgPrice =
    cumulativeAmount !== undefined && cumulativeVolume > 0
      ? cumulativeAmount / (cumulativeVolume * volumeUnit)
      : undefined;
  return {
    value: {
      time: formatMinuteLabel(parts[0]),
      price,
      avgPrice,
      volume: Math.max(0, cumulativeVolume - previousVolume),
      prevClose
    },
    cumulativeVolume
  };
}

function parseTencentPrevClose(root: { qt?: Record<string, unknown[]> }): number | undefined {
  const qtItems = Object.values(root.qt ?? {});
  for (const item of qtItems) {
    const prevClose = numberOrUndefined(item[4]);
    if (prevClose !== undefined && prevClose > 0) return prevClose;
  }
  return undefined;
}

function parseJsonLike(body: string): unknown {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  return JSON.parse(trimmed.slice(start, end + 1));
}

function normalizeTencentDay(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 8) return value;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function isRegularTradingMinute(value: string, hongKong: boolean): boolean {
  const digits = value.replace(/\D/g, "").slice(-4).padStart(4, "0");
  const time = Number(digits);
  const morningClose = hongKong ? 1200 : 1130;
  const afternoonClose = hongKong ? 1600 : 1500;
  return (time >= 930 && time <= morningClose) || (time >= 1300 && time <= afternoonClose);
}
function formatMinuteLabel(value: string): string {
  const digits = value.replace(/\D/g, "");
  const time = digits.length >= 4 ? digits.slice(-4) : digits.padStart(4, "0");
  return `${time.slice(0, 2)}:${time.slice(2, 4)}`;
}

function numberOrUndefined(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function parseStockNews(html: string): StockNewsItem[] {
  const items: StockNewsItem[] = [];
  const seen = new Set<string>();
  const linkPattern = /<a\b[^>]*href=(["'])(https?:\/\/[^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(html)) !== null) {
    const url = decodeHtml(match[2]);
    const title = normalizeText(stripTags(match[3]));
    if (!title || seen.has(url) || !isLikelyNewsUrl(url)) continue;

    const context = html.slice(Math.max(0, match.index - 220), Math.min(html.length, linkPattern.lastIndex + 220));
    items.push({
      id: url,
      title,
      url,
      date: context.match(/\d{4}-\d{2}-\d{2}/)?.[0],
      source: pickSource(context)
    });
    seen.add(url);
  }

  return items;
}

type ThsRealtimeNewsResponse = {
  data?: {
    list?: ThsRealtimeNewsItem[];
  } | ThsRealtimeNewsItem[];
};

type ThsRealtimeNewsItem = {
  seq?: string | number;
  id?: string | number;
  title?: string;
  digest?: string;
  summary?: string;
  url?: string;
  source?: string;
  ctime?: string | number;
  rtime?: string | number;
};

function parseThsRealtimeNews(payload: ThsRealtimeNewsResponse): StockNewsItem[] {
  const list = Array.isArray(payload.data) ? payload.data : payload.data?.list ?? [];
  const items: StockNewsItem[] = [];
  list.forEach((item, index) => {
    const title = normalizeText(item.title ?? item.digest ?? "");
    if (!title) return;

    const digest = normalizeText(item.digest ?? item.summary ?? "");
    const id = String(item.seq ?? item.id ?? `${item.ctime ?? ""}-${index}`);
    const url = normalizeNewsUrl(item.url) ?? `https://news.10jqka.com.cn/realtimenews.html#10jqka-${encodeURIComponent(id)}`;
    items.push({
      id,
      title,
      url,
      date: formatThsTime(item.ctime ?? item.rtime),
      source: item.source ? normalizeText(item.source) : "同花顺7x24",
      html: renderInlineNewsHtml(title, digest, url)
    });
  });
  return items;
}

function thsNewsToComment(item: StockNewsItem): StockCommentItem {
  const text = normalizeText(stripTags(item.html ?? item.title));
  return {
    id: item.id,
    user: item.source || "THS",
    text: text || item.title,
    url: item.url,
    date: item.date
  };
}

function parseThsDiscussion(html: string, simpleCode: string, page: number): StockCommentItem[] {
  const items: StockCommentItem[] = [];
  const seen = new Set<string>();
  const rowPattern = /<(li|tr)\b[^>]*>[\s\S]*?<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = rowPattern.exec(html)) !== null && items.length < thsNewsPageSize) {
    const item = parseThsDiscussionRow(match[0], simpleCode, page, items.length);
    if (!item || seen.has(item.url)) continue;
    seen.add(item.url);
    items.push(item);
  }

  if (items.length > 0) return items;
  return parseThsDiscussionLinks(html, simpleCode, page);
}

function parseThsDiscussionRow(rowHtml: string, simpleCode: string, page: number, index: number): StockCommentItem | undefined {
  const link = pickThsDiscussionLink(rowHtml, simpleCode);
  if (!link) return undefined;

  const title = normalizeText(stripTags(link.html));
  if (!title || /^(post|title|author|reply|read|time)$/i.test(title)) return undefined;

  const rowText = normalizeText(stripTags(rowHtml));
  const counts = parseThsDiscussionCounts(rowText);
  return {
    id: `${simpleCode}-${page}-${index}-${link.url}`,
    user: pickThsDiscussionUser(rowHtml) ?? "THS User",
    text: title,
    url: link.url,
    date: pickThsDiscussionDate(rowText),
    replyCount: counts.replyCount
  };
}

function parseThsDiscussionLinks(html: string, simpleCode: string, page: number): StockCommentItem[] {
  const items: StockCommentItem[] = [];
  const seen = new Set<string>();
  const linkPattern = /<a\b[^>]*href=(['"])([^'"]+)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(html)) !== null && items.length < thsNewsPageSize) {
    const url = normalizeThsDiscussionUrl(match[2], simpleCode);
    const text = normalizeText(stripTags(match[3]));
    if (!url || !text || seen.has(url)) continue;
    seen.add(url);
    items.push({
      id: `${simpleCode}-${page}-${items.length}-${url}`,
      user: "THS User",
      text,
      url
    });
  }

  return items;
}

function pickThsDiscussionLink(rowHtml: string, simpleCode: string): { url: string; html: string } | undefined {
  const linkPattern = /<a\b[^>]*href=(['"])([^'"]+)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(rowHtml)) !== null) {
    const url = normalizeThsDiscussionUrl(match[2], simpleCode);
    const text = normalizeText(stripTags(match[3]));
    if (url && text) return { url, html: match[3] };
  }
  return undefined;
}

function normalizeThsDiscussionUrl(value: string | undefined, simpleCode: string): string | undefined {
  if (!value || /^javascript:/i.test(value) || value === "#") return undefined;
  if (/^\/\//.test(value)) return `https:${value}`;
  if (/^https?:\/\//i.test(value)) return /guba\.10jqka\.com\.cn/i.test(value) ? value : undefined;
  if (value.startsWith("/")) return `https://guba.10jqka.com.cn${value}`;
  return `https://guba.10jqka.com.cn/${simpleCode}/${value}`;
}

function pickThsDiscussionUser(rowHtml: string): string | undefined {
  const userMatch = rowHtml.match(/<(?:a|span|td)\b[^>]*(?:class|data-field)=(['"])[^'"]*(?:author|user|name|writer)[^'"]*\1[^>]*>([\s\S]*?)<\/(?:a|span|td)>/i);
  const user = userMatch ? normalizeText(stripTags(userMatch[2])) : undefined;
  return user || undefined;
}

function pickThsDiscussionDate(rowText: string): string | undefined {
  return rowText.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}\s*\d{1,2}:\d{2}(?::\d{2})?/)?.[0]
    ?? rowText.match(/\d{1,2}[-/]\d{1,2}\s*\d{1,2}:\d{2}/)?.[0]
    ?? rowText.match(/\d{1,2}:\d{2}/)?.[0];
}

function parseThsDiscussionCounts(rowText: string): { replyCount?: number; readCount?: number } {
  const replyCount = numberOrUndefined(rowText.match(/(?:reply|comment)\s*:?\s*(\d+)/i)?.[1]);
  return { replyCount };
}

function stockNewsTerms(code: string, keyword: string | undefined): string[] {
  const simpleCode = code.replace(/^(sh|sz|bj|hk)/i, "");
  const rawTerms = [code, simpleCode, ...(keyword ?? "").split(/\s+/)];
  return [...new Set(rawTerms.map((term) => normalizeSearchTerm(term)).filter((term) => term.length >= 2))];
}

function isRelatedNewsItem(item: StockNewsItem, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const text = normalizeSearchTerm([item.title, item.source, item.url, item.html].filter(Boolean).join(" "));
  return terms.some((term) => text.includes(term));
}

function parseStockNewsArticle(html: string, url: string): StockNewsArticle {
  const title = normalizeText(
    stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "News")
      .replace(/[_-].*新浪.*/, "")
  );
  const date = html.match(/\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{1,2}/)?.[0] ?? html.match(/\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2}/)?.[0];
  const source = pickSource(html);

  return {
    title,
    url,
    date,
    source,
    html: prepareArticleHtml(html, url)
  };
}

function parseSuggest(body: string): StockSearchResult[] {
  const start = body.indexOf('"') + 1;
  const end = body.lastIndexOf('"');
  if (start <= 0 || end <= start) return [];

  return body
    .slice(start, end)
    .split(";")
    .map((item) => item.split(","))
    .map((parts) => pickSuggestResult(parts))
    .filter((item): item is StockSearchResult => item !== undefined);
}

function decodeHtmlResponse(bytes: Buffer, contentType: string | null): string {
  const charset = contentType?.match(/charset=([^;\s]+)/i)?.[1]?.toLowerCase();
  if (charset && charset !== "utf-8" && charset !== "utf8") return iconv.decode(bytes, charset);

  const head = bytes.subarray(0, 2048).toString("ascii");
  const metaCharset = head.match(/charset=["']?([\w-]+)/i)?.[1]?.toLowerCase();
  if (metaCharset && metaCharset !== "utf-8" && metaCharset !== "utf8") return iconv.decode(bytes, metaCharset);

  return bytes.toString("utf8");
}

function isLikelyNewsUrl(url: string): boolean {
  return /finance\.sina\.com\.cn|sina\.com\.cn\/stock|stock\.sina\.com\.cn|10jqka\.com\.cn/i.test(url);
}

function normalizeNewsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^\/\//.test(value)) return `https:${value}`;
  if (/^\//.test(value)) return `https://news.10jqka.com.cn${value}`;
  if (/^https?:\/\//i.test(value)) return value;
  return undefined;
}

function formatThsTime(value: string | number | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value === "string" && /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(value)) return value;

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  const timestamp = numeric < 10000000000 ? numeric * 1000 : numeric;
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

function renderInlineNewsHtml(title: string, digest: string, url: string): string {
  return `<!doctype html>
<html>
<head>
  <base href="${escapeAttribute(url)}">
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; background: #fff; color: #333; font-family: "Microsoft YaHei", "PingFang SC", system-ui, sans-serif; }
    body { padding: 16px; font-size: 14px; line-height: 1.75; }
    h1 { margin: 0 0 12px; font-size: 20px; line-height: 1.45; font-weight: 600; }
    p { margin: 0 0 10px; }
    a { color: #006ab1; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(digest || title)}</p>
</body>
</html>`;
}

function prepareArticleHtml(html: string, url: string): string {
  const baseTag = `<base href="${escapeAttribute(url)}">`;
  const styleTag = `<style>
    html, body { margin: 0; padding: 0; background: #fff; color: #333; font-family: "Microsoft YaHei", "PingFang SC", system-ui, sans-serif; }
    body { padding: 12px; font-size: 14px; line-height: 1.7; }
    img, video, table { max-width: 100%; }
    table { border-collapse: collapse; }
  </style>`;

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}${styleTag}`);
  }
  return `<!doctype html><html><head>${baseTag}${styleTag}</head><body>${html}</body></html>`;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function pickSource(value: string): string | undefined {
  const source = value.match(/来源[:：]\s*<\/?[^>]*>\s*([^<\s]+)/)?.[1] ?? value.match(/source[:：]\s*([^<\s]+)/i)?.[1];
  return source ? normalizeText(source) : undefined;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function normalizeText(value: string): string {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function normalizeSearchTerm(value: string): string {
  return normalizeText(stripTags(value)).replace(/[.\-_\s]/g, "").toLowerCase();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function pickSuggestResult(parts: string[]): StockSearchResult | undefined {
  let code = "";
  let name = "";

  if (parts[3] && isPrefixedCode(parts[3])) {
    code = parts[3];
    name = parts[4] ?? "";
  }

  if (!code && parts[0] && isPrefixedCode(parts[0])) {
    code = parts[0];
    name = parts[2] ?? "";
  }

  if (!code) {
    const simpleCode = [parts[3], parts[2], parts[0]].find((part) => /^\d{5,6}$/.test(part ?? ""));
    if (simpleCode) {
      code = prefixSimpleCode(simpleCode);
      name = parts[3] === simpleCode ? parts[4] ?? "" : parts[2] ?? "";
    }
  }

  return code ? { code: code.toLowerCase(), name: name || code } : undefined;
}

function isPrefixedCode(value: string): boolean {
  return /^(sh|sz|bj)\d+$/i.test(value) || /^hk\d{5}$/i.test(value);
}

function prefixSimpleCode(value: string): string {
  if (/^\d{5}$/.test(value)) return `hk${value}`;
  if (value.startsWith("6")) return `sh${value}`;
  if (value.startsWith("0") || value.startsWith("3")) return `sz${value}`;
  if (value.startsWith("4") || value.startsWith("8")) return `bj${value}`;
  return value;
}

function normalizeHongKongSearchCode(query: string): string | undefined {
  const normalized = query.trim().toLowerCase();
  if (/^\d{5}$/.test(normalized)) return `hk${normalized}`;
  return isHongKongCode(normalized) ? normalized : undefined;
}

function isHongKongCode(code: string): boolean {
  return /^hk\d{5}$/i.test(code);
}

function toSinaQuoteCode(code: string): string {
  const normalized = code.trim().toLowerCase();
  return isHongKongCode(normalized) ? `rt_${normalized}` : normalized;
}

function fromSinaQuoteCode(code: string): string {
  const normalized = code.trim().toLowerCase();
  return normalized.startsWith("rt_hk") ? normalized.slice(3) : normalized;
}

function numberAt(parts: string[], index: number): number {
  return Number(parts[index] ?? 0) || 0;
}
