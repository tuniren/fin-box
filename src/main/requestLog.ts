import type { RequestLogItem } from "../shared/types";

const REQUEST_LOG_LIMIT = 500;
const RESPONSE_BODY_PREVIEW_LIMIT = 8192;

let sequence = 0;
let requestLogs: RequestLogItem[] = [];
const listeners = new Set<(logs: RequestLogItem[]) => void>();

export function getRequestLogs(): RequestLogItem[] {
  return requestLogs.map((item) => ({ ...item }));
}

export function clearRequestLogs(): void {
  requestLogs = [];
  notifyRequestLogListeners();
}

export function onRequestLogsChanged(listener: (logs: RequestLogItem[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loggedFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1], source?: string): Promise<Response> {
  const startedAt = Date.now();
  const url = requestUrl(input);
  const method = requestMethod(input, init);
  const requestHeaders = headersToRecord(requestHeadersFrom(input, init));
  const requestBody = requestBodyPreview(input, init);
  const id = `${startedAt}-${++sequence}`;

  try {
    const response = await fetch(input, init);
    pushRequestLog({
      id,
      method,
      url,
      source,
      requestHeaders,
      requestBody,
      status: response.status,
      statusText: response.statusText,
      responseHeaders: headersToRecord(response.headers),
      ok: response.ok,
      durationMs: Date.now() - startedAt,
      startedAt
    });
    void captureResponseBodyPreview(id, response.clone());
    return response;
  } catch (error) {
    pushRequestLog({
      id,
      method,
      url,
      source,
      requestHeaders,
      requestBody,
      ok: false,
      durationMs: Date.now() - startedAt,
      startedAt,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

function pushRequestLog(item: RequestLogItem): void {
  requestLogs = [item, ...requestLogs].slice(0, REQUEST_LOG_LIMIT);
  notifyRequestLogListeners();
}

function updateRequestLog(id: string, patch: Partial<RequestLogItem>): void {
  let changed = false;
  requestLogs = requestLogs.map((item) => {
    if (item.id !== id) return item;
    changed = true;
    return { ...item, ...patch };
  });
  if (changed) notifyRequestLogListeners();
}

async function captureResponseBodyPreview(id: string, response: Response): Promise<void> {
  try {
    const text = await response.text();
    updateRequestLog(id, {
      responseBodyPreview: text.slice(0, RESPONSE_BODY_PREVIEW_LIMIT),
      responseBodyTruncated: text.length > RESPONSE_BODY_PREVIEW_LIMIT
    });
  } catch (error) {
    updateRequestLog(id, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function notifyRequestLogListeners(): void {
  const snapshot = getRequestLogs();
  listeners.forEach((listener) => listener(snapshot));
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  if (input instanceof URL) return input.toString();
  return String(input);
}

function requestMethod(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

function requestHeadersFrom(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Headers {
  const headers = new Headers();
  if (typeof Request !== "undefined" && input instanceof Request) {
    input.headers.forEach((value, key) => headers.set(key, value));
  }
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function requestBodyPreview(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): string | undefined {
  if (typeof init?.body === "string") return init.body.slice(0, RESPONSE_BODY_PREVIEW_LIMIT);
  if (typeof Request !== "undefined" && input instanceof Request) return "Request body is not captured.";
  return init?.body ? "Request body is not text." : undefined;
}
