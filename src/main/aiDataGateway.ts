import { dayProfit, displayName, effectivePrice, marketValue, totalProfit, totalProfitPoints, totalShares } from "../shared/finance";
import type { AiDataScope, AiToolCall, AiToolName, AiToolRequest, AiToolResult, AppState, JsonValue, KLinePoint, MinutePoint, StockJournal } from "../shared/types";

type AiDataGatewayDeps = {
  getState: () => AppState;
  fetchKLine: (code: string, limit: number) => Promise<KLinePoint[]>;
  fetchMinute: (code: string, limit: number) => Promise<MinutePoint[]>;
  readStockJournal: (code: string) => StockJournal;
};

const TOOL_SCOPES: Record<AiToolName, AiDataScope[]> = {
  get_quote: ["public_market_data"],
  get_kline: ["public_market_data"],
  get_minute: ["public_market_data"],
  get_position_summary: ["user_private_summary"],
  get_trading_logic: ["user_strategy_data"]
};

const PRIVATE_SCOPES = new Set<AiDataScope>(["user_private_summary", "user_private_detail", "user_strategy_data"]);

export class AiDataGateway {
  private readonly callCounts = new Map<string, number>();

  constructor(private readonly deps: AiDataGatewayDeps) {}

  async call(request: AiToolRequest): Promise<AiToolResult> {
    const now = Date.now();
    const call = this.createCall(request, now);
    const validation = this.validateRequest(request, call, now);
    if (validation) return validation;

    try {
      const data = await this.dispatch(request);
      return {
        call: { ...call, status: "success", updatedAt: Date.now() },
        ok: true,
        data
      };
    } catch (error) {
      return this.errorResult(call, "tool_failed", error instanceof Error ? error.message : String(error));
    }
  }

  private validateRequest(request: AiToolRequest, call: AiToolCall, now: number): AiToolResult | undefined {
    const policy = request.policy;
    if (!policy.sessionId.trim()) return this.errorResult(call, "invalid_policy", "AI session policy is missing a session id.");
    if (policy.expiresAt <= now) return this.errorResult(call, "policy_expired", "AI session policy has expired.");
    if (!policy.allowedTools.includes(request.tool)) return this.errorResult(call, "tool_not_allowed", `Tool is not allowed: ${request.tool}.`);

    const count = this.callCounts.get(policy.sessionId) ?? 0;
    if (count >= policy.maxToolCalls) return this.errorResult(call, "tool_call_limit", "AI session tool call limit was reached.");

    const missingScopes = call.dataScopes.filter((scope) => !policy.allowedDataScopes.includes(scope));
    if (missingScopes.length) return this.errorResult(call, "scope_not_allowed", `Data scope is not allowed: ${missingScopes.join(", ")}.`);

    const targetCode = readStringParam(request.params, "code") || policy.code;
    if (!targetCode.trim()) return this.errorResult(call, "missing_code", "Tool call requires a stock or index code.");
    if (!sameCode(targetCode, policy.code) && !policy.allowCrossSymbolData) {
      return this.errorResult(call, "cross_symbol_denied", "AI session policy does not allow cross-symbol data access.");
    }

    if (call.privateData && policy.requirePrivateDataConfirmation) {
      return this.errorResult(call, "confirmation_required", "Private or strategy data requires user confirmation before it can be returned.");
    }

    this.callCounts.set(policy.sessionId, count + 1);
    return undefined;
  }

  private async dispatch(request: AiToolRequest): Promise<JsonValue> {
    if (request.tool === "get_quote") return toJsonValue(this.getQuote(request));
    if (request.tool === "get_kline") return toJsonValue(await this.getKLine(request));
    if (request.tool === "get_minute") return toJsonValue(await this.getMinute(request));
    if (request.tool === "get_position_summary") return toJsonValue(this.getPositionSummary(request));
    return toJsonValue(this.getTradingLogic(request));
  }

  private getQuote(request: AiToolRequest) {
    const state = this.deps.getState();
    const code = targetCode(request);
    const stock = findStock(state, code);
    if (!stock) throw new Error(`Symbol does not exist: ${code}.`);
    const price = effectivePrice(stock.market);
    return {
      code: stock.config.code,
      name: displayName(stock),
      price,
      change: price !== undefined && stock.market ? price - stock.market.prev_close : undefined,
      change_percent: price !== undefined && stock.market?.prev_close ? ((price - stock.market.prev_close) / stock.market.prev_close) * 100 : undefined,
      open: stock.market?.open,
      high: stock.market?.high,
      low: stock.market?.low,
      prev_close: stock.market?.prev_close,
      volume: stock.market?.volume,
      amount: stock.market?.amount,
      quote_time: stock.market?.time,
      app_last_market_update: state.last_market_update ? new Date(state.last_market_update).toISOString() : undefined
    };
  }

  private async getKLine(request: AiToolRequest) {
    const limit = readLimit(request.params, 120, 500);
    const points = await this.deps.fetchKLine(targetCode(request), limit);
    return {
      code: targetCode(request),
      limit,
      points: points.slice(-limit)
    };
  }

  private async getMinute(request: AiToolRequest) {
    const limit = readLimit(request.params, 240, 1000);
    const points = await this.deps.fetchMinute(targetCode(request), limit);
    return {
      code: targetCode(request),
      limit,
      points: points.slice(-limit)
    };
  }

  private getPositionSummary(request: AiToolRequest) {
    const stock = findStock(this.deps.getState(), targetCode(request));
    if (!stock) throw new Error(`Symbol does not exist: ${targetCode(request)}.`);
    return {
      code: stock.config.code,
      name: displayName(stock),
      shares: totalShares(stock),
      market_value: marketValue(stock),
      day_profit: dayProfit(stock),
      total_profit: totalProfit(stock),
      return_rate_percent: totalProfitPoints(stock)
    };
  }

  private getTradingLogic(request: AiToolRequest) {
    const code = targetCode(request);
    const journal = this.deps.readStockJournal(code);
    const strategy = journal.notes.find((note) => !note.date)?.content.trim() ?? "";
    return {
      code,
      library_status: "stock_strategy_note_only",
      strategy_note: strategy || undefined,
      updated_at: journal.updatedAt,
      note: "TradingLogicLibrary YAML store is scheduled for a later phase; this tool currently returns the existing per-stock strategy note when present."
    };
  }

  private createCall(request: AiToolRequest, now: number): AiToolCall {
    const dataScopes = TOOL_SCOPES[request.tool];
    const privateData = dataScopes.some((scope) => PRIVATE_SCOPES.has(scope));
    return {
      id: `ai-tool-${now}-${request.tool}`,
      sessionId: request.policy.sessionId,
      tool: request.tool,
      requestedAt: now,
      updatedAt: now,
      status: "pending",
      params: request.params,
      dataScopes,
      privateData,
      requiresConfirmation: privateData && request.policy.requirePrivateDataConfirmation
    };
  }

  private errorResult(call: AiToolCall, code: string, message: string): AiToolResult {
    return {
      call: { ...call, status: "error", updatedAt: Date.now(), error: message },
      ok: false,
      error: { code, message }
    };
  }
}

function targetCode(request: AiToolRequest): string {
  return readStringParam(request.params, "code") || request.policy.code;
}

function readStringParam(params: Record<string, JsonValue>, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value.trim() : "";
}

function readLimit(params: Record<string, JsonValue>, fallback: number, max: number): number {
  const value = params.limit;
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(Math.max(Math.round(numberValue), 1), max);
}

function findStock(state: AppState, code: string) {
  const normalizedCode = code.trim().toLowerCase();
  if (normalizedCode === "sh000001" && state.sh_index) {
    return { config: { code: "sh000001", tags: [], positions: [] }, market: state.sh_index };
  }
  return state.stocks.find((stock) => sameCode(stock.config.code, normalizedCode));
}

function sameCode(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
