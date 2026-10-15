import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { dayProfit, displayName, effectivePrice, marketValue, totalProfit, totalProfitPoints, totalShares } from "../shared/finance";
import type {
  AppState,
  KLinePoint,
  MinutePoint,
  StrategyContext,
  StrategyRunLog,
  StrategyScript,
  StrategyScriptInput,
  StrategyScriptParam,
  StrategySignal,
  StrategySignalType,
  StrategyTrigger
} from "../shared/types";

const STRATEGY_RUNTIME_TIMEOUT_MS = 1000;
const DEFAULT_COOLDOWN_MS = 60000;
const STRATEGY_LOG_LIMIT = 500;

type StrategyStoreFile = {
  scripts?: Partial<StrategyScript>[];
};

type StrategySignalStoreFile = {
  signals?: Partial<StrategySignal>[];
};

type StrategyRunLogStoreFile = {
  logs?: Partial<StrategyRunLog>[];
};

export type StrategyRuntimeDataLoader = {
  fetchKLine: (code: string, limit: number) => Promise<KLinePoint[]>;
  fetchMinute: (code: string) => Promise<MinutePoint[]>;
};

export class StrategyScriptManager {
  private autoRunPending = false;
  private readonly lastRunAt = new Map<string, number>();

  listScripts(): StrategyScript[] {
    if (fs.existsSync(strategyScriptsPath())) return this.readScripts();
    const scripts = defaultStrategyScripts();
    this.writeScripts(scripts);
    return scripts;
  }

  saveScript(input: Partial<StrategyScriptInput> & { id?: string }): StrategyScript {
    const scripts = this.listScripts();
    const now = Date.now();
    const existing = input.id ? scripts.find((script) => script.id === input.id) : undefined;
    const script: StrategyScript = normalizeStrategyScript({
      ...existing,
      ...input,
      id: existing?.id ?? input.id ?? `strategy-${now}`,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });
    const next = existing
      ? scripts.map((item) => (item.id === script.id ? script : item))
      : [...scripts, script];
    this.writeScripts(next);
    return structuredClone(script);
  }

  deleteScript(id: string): void {
    this.writeScripts(this.listScripts().filter((script) => script.id !== id));
  }

  listSignals(): StrategySignal[] {
    return this.readSignals();
  }

  deleteSignal(id: string): void {
    this.writeSignals(this.listSignals().filter((signal) => signal.id !== id));
  }

  listRunLogs(): StrategyRunLog[] {
    return this.readRunLogs();
  }

  async runScript(scriptId: string, code: string, state: AppState, loader: StrategyRuntimeDataLoader, triggerType: StrategyTrigger["type"] = "manual"): Promise<StrategySignal | undefined> {
    const script = this.listScripts().find((item) => item.id === scriptId);
    if (!script) throw new Error("Strategy script does not exist.");
    return this.runScriptObject(script, code, state, loader, { type: triggerType, code });
  }

  runAutoStrategies(state: AppState, loader: StrategyRuntimeDataLoader, onChanged: () => void): void {
    if (this.autoRunPending) return;
    this.autoRunPending = true;
    void Promise.resolve()
      .then(async () => {
        const scripts = this.listScripts().filter((script) => script.enabled && script.triggers.includes("market_refresh"));
        for (const script of scripts) {
          const key = `${script.id}:${script.targetCode.toLowerCase()}`;
          const now = Date.now();
          if (now - (this.lastRunAt.get(key) ?? 0) < script.cooldownMs) continue;
          this.lastRunAt.set(key, now);
          await this.runScriptObject(script, script.targetCode, state, loader, { type: "market_refresh", code: script.targetCode });
        }
      })
      .then(onChanged)
      .catch((error) => {
        console.error("[FinBox] Strategy auto run failed", error);
      })
      .finally(() => {
        this.autoRunPending = false;
      });
  }

  private async runScriptObject(script: StrategyScript, code: string, state: AppState, loader: StrategyRuntimeDataLoader, trigger: StrategyTrigger): Promise<StrategySignal | undefined> {
    const startedAt = Date.now();
    const normalizedCode = code.toLowerCase();
    const stock = state.stocks.find((item) => item.config.code.toLowerCase() === normalizedCode);
    if (!stock) throw new Error("Stock does not exist.");

    try {
      const [kline, minute] = await Promise.all([
        loader.fetchKLine(stock.config.code, 80),
        loader.fetchMinute(stock.config.code)
      ]);
      const ctx = createStrategyContext(script, stock, state, kline, minute, trigger);
      const result = executeStrategyScript(script, ctx);
      const finishedAt = Date.now();
      const signal = normalizeStrategySignal(result, script, stock.config.code, trigger, finishedAt);
      const savedSignal = signal.signal === "none" ? undefined : this.saveSignal(signal, script.cooldownMs);
      this.appendRunLog({
        id: `strategy-run-${finishedAt}`,
        scriptId: script.id,
        scriptName: script.name,
        code: stock.config.code,
        trigger,
        startedAt,
        finishedAt,
        status: "success",
        signalId: savedSignal?.id
      });
      return savedSignal;
    } catch (error) {
      const finishedAt = Date.now();
      this.appendRunLog({
        id: `strategy-run-${finishedAt}`,
        scriptId: script.id,
        scriptName: script.name,
        code: stock.config.code,
        trigger,
        startedAt,
        finishedAt,
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private saveSignal(signal: StrategySignal, cooldownMs: number): StrategySignal {
    const signals = this.listSignals();
    const mergeIndex = signals.findIndex((item) =>
      item.scriptId === signal.scriptId &&
      item.code.toLowerCase() === signal.code.toLowerCase() &&
      item.signal === signal.signal &&
      signal.generatedAt - item.updatedAt <= cooldownMs
    );
    if (mergeIndex !== -1) {
      const merged: StrategySignal = {
        ...signals[mergeIndex],
        ...signal,
        id: signals[mergeIndex].id,
        generatedAt: signals[mergeIndex].generatedAt,
        updatedAt: signal.generatedAt,
        triggerCount: signals[mergeIndex].triggerCount + 1
      };
      const next = [...signals];
      next[mergeIndex] = merged;
      this.writeSignals(next);
      return structuredClone(merged);
    }
    this.writeSignals([signal, ...signals]);
    return structuredClone(signal);
  }

  private appendRunLog(log: StrategyRunLog): void {
    this.writeRunLogs([log, ...this.listRunLogs()].slice(0, STRATEGY_LOG_LIMIT));
  }

  private readScripts(): StrategyScript[] {
    return readJson<StrategyStoreFile>(strategyScriptsPath(), {}).scripts?.map(normalizeStrategyScript) ?? [];
  }

  private writeScripts(scripts: StrategyScript[]): void {
    writeJson(strategyScriptsPath(), { scripts });
  }

  private readSignals(): StrategySignal[] {
    return (readJson<StrategySignalStoreFile>(strategySignalsPath(), {}).signals ?? [])
      .map(normalizeStoredSignal)
      .filter((signal): signal is StrategySignal => Boolean(signal));
  }

  private writeSignals(signals: StrategySignal[]): void {
    writeJson(strategySignalsPath(), { signals });
  }

  private readRunLogs(): StrategyRunLog[] {
    return (readJson<StrategyRunLogStoreFile>(strategyRunLogsPath(), {}).logs ?? [])
      .map(normalizeRunLog)
      .filter((log): log is StrategyRunLog => Boolean(log));
  }

  private writeRunLogs(logs: StrategyRunLog[]): void {
    writeJson(strategyRunLogsPath(), { logs });
  }
}

function createStrategyContext(script: StrategyScript, stock: AppState["stocks"][number], state: AppState, kline: KLinePoint[], minute: MinutePoint[], trigger: StrategyTrigger): StrategyContext {
  const price = effectivePrice(stock.market);
  const change = price !== undefined && stock.market ? price - stock.market.prev_close : undefined;
  const changePercent = price !== undefined && stock.market?.prev_close
    ? ((price - stock.market.prev_close) / stock.market.prev_close) * 100
    : undefined;
  return {
    now: new Date().toISOString(),
    trigger,
    script: {
      id: script.id,
      name: script.name,
      targetCode: script.targetCode,
      params: structuredClone(script.params)
    },
    params: paramsRecord(script.params),
    stock: structuredClone(stock),
    quote: {
      current_price: price,
      change,
      change_percent: changePercent,
      open: stock.market?.open,
      high: stock.market?.high,
      low: stock.market?.low,
      volume: stock.market?.volume,
      amount: stock.market?.amount,
      prev_close: stock.market?.prev_close,
      quote_time: stock.market?.time
    },
    position: {
      shares: totalShares(stock),
      market_value: marketValue(stock),
      day_profit: dayProfit(stock),
      total_profit: totalProfit(stock),
      return_rate_percent: totalProfitPoints(stock),
      lots: structuredClone(stock.config.positions)
    },
    indices: {
      sh000001: structuredClone(state.sh_index)
    },
    kline: structuredClone(kline),
    minute: structuredClone(minute)
  };
}

function executeStrategyScript(script: StrategyScript, ctx: StrategyContext): unknown {
  const compiled = script.language === "ts"
    ? transpileStrategyTypeScript(script.code)
    : script.code;
  const runner = `
    const module = { exports: {} };
    const exports = module.exports;
    ${compiled}
    const fn = module.exports.default || module.exports.analyze || exports.default || exports.analyze;
    if (typeof fn !== "function") throw new Error("Strategy script must export default function or analyze function.");
    __result = fn(__ctx);
  `;
  const sandbox = {
    __ctx: structuredClone(ctx),
    __result: undefined as unknown,
    console: {
      log: () => undefined,
      warn: () => undefined,
      error: () => undefined
    },
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Date,
    JSON
  };
  vm.runInNewContext(runner, sandbox, { timeout: STRATEGY_RUNTIME_TIMEOUT_MS });
  return sandbox.__result;
}

function transpileStrategyTypeScript(code: string): string {
  return code
    .replace(/^import\s+type\s+.*$/gm, "")
    .replace(/export\s+default\s+function\s*/g, "module.exports.default = function ")
    .replace(/export\s+default\s+/g, "module.exports.default = ")
    .replace(/export\s+function\s+analyze\s*/g, "module.exports.analyze = function analyze")
    .replace(/\s+as\s+const\b/g, "")
    .replace(/:\s*[A-Za-z_$][\w$<>,\s|&[\]{}"'.]*(?=[,)=;{])/g, "");
}

function normalizeStrategySignal(value: unknown, script: StrategyScript, code: string, trigger: StrategyTrigger, generatedAt: number): StrategySignal {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Strategy script must return a signal object.");
  }
  const input = value as Partial<StrategySignal>;
  const signal = normalizeSignalType(input.signal);
  return {
    id: input.id || `strategy-signal-${generatedAt}`,
    code,
    scriptId: script.id,
    scriptName: script.name,
    generatedAt,
    updatedAt: generatedAt,
    triggerCount: 1,
    trigger,
    signal,
    action: normalizeAction(input.action),
    confidence: clampNumber(input.confidence, 0, 1, signal === "none" ? 0 : 0.5),
    severity: input.severity === "critical" || input.severity === "warning" || input.severity === "notice" || input.severity === "info" ? input.severity : "notice",
    title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : "策略信号",
    reasons: Array.isArray(input.reasons) ? input.reasons.map(String).filter(Boolean).slice(0, 12) : [],
    levels: input.levels && typeof input.levels === "object" ? normalizeLevels(input.levels) : undefined,
    suggestedShares: normalizeOptionalNumber(input.suggestedShares),
    expiresAt: normalizeOptionalNumber(input.expiresAt)
  };
}

function normalizeStoredSignal(value: Partial<StrategySignal>): StrategySignal | undefined {
  if (!value || typeof value !== "object" || !value.id || !value.scriptId || !value.code) return undefined;
  const generatedAt = Number(value.generatedAt) || Date.now();
  return {
    id: String(value.id),
    code: String(value.code),
    scriptId: String(value.scriptId),
    scriptName: String(value.scriptName || value.scriptId),
    generatedAt,
    updatedAt: Number(value.updatedAt) || generatedAt,
    triggerCount: Math.max(1, Math.round(Number(value.triggerCount) || 1)),
    trigger: normalizeTrigger(value.trigger, String(value.code)),
    signal: normalizeSignalType(value.signal),
    action: normalizeAction(value.action),
    confidence: clampNumber(value.confidence, 0, 1, 0.5),
    severity: value.severity === "critical" || value.severity === "warning" || value.severity === "notice" || value.severity === "info" ? value.severity : "notice",
    title: String(value.title || "策略信号"),
    reasons: Array.isArray(value.reasons) ? value.reasons.map(String).filter(Boolean).slice(0, 12) : [],
    levels: value.levels && typeof value.levels === "object" ? normalizeLevels(value.levels) : undefined,
    suggestedShares: normalizeOptionalNumber(value.suggestedShares),
    expiresAt: normalizeOptionalNumber(value.expiresAt)
  };
}

function normalizeRunLog(value: Partial<StrategyRunLog>): StrategyRunLog | undefined {
  if (!value || !value.id || !value.scriptId || !value.code) return undefined;
  const startedAt = Number(value.startedAt) || Date.now();
  return {
    id: String(value.id),
    scriptId: String(value.scriptId),
    scriptName: String(value.scriptName || value.scriptId),
    code: String(value.code),
    trigger: normalizeTrigger(value.trigger, String(value.code)),
    startedAt,
    finishedAt: Number(value.finishedAt) || startedAt,
    status: value.status === "error" || value.status === "skipped" ? value.status : "success",
    signalId: value.signalId ? String(value.signalId) : undefined,
    error: value.error ? String(value.error) : undefined
  };
}

function normalizeStrategyScript(value: Partial<StrategyScript>): StrategyScript {
  const now = Date.now();
  const language = value.language === "ts" ? "ts" : "js";
  const targetCode = typeof value.targetCode === "string" && value.targetCode.trim() ? value.targetCode.trim() : "sz002594";
  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id.trim() : `strategy-${now}`,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : "未命名策略",
    enabled: Boolean(value.enabled),
    language,
    code: typeof value.code === "string" ? value.code : defaultRepairScriptCode(),
    targetCode,
    params: normalizeParams(value.params),
    triggers: normalizeTriggers(value.triggers),
    cooldownMs: clampNumber(value.cooldownMs, 10000, 3600000, DEFAULT_COOLDOWN_MS),
    createdAt: Number(value.createdAt) || now,
    updatedAt: Number(value.updatedAt) || now
  };
}

function normalizeParams(params: unknown): StrategyScriptParam[] {
  if (!Array.isArray(params)) return [];
  return params.map((param) => {
    if (!param || typeof param !== "object") return undefined;
    const input = param as Partial<StrategyScriptParam>;
    const key = typeof input.key === "string" ? input.key.trim() : "";
    const label = typeof input.label === "string" && input.label.trim() ? input.label.trim() : key;
    if (!key) return undefined;
    if (input.type === "boolean") return { key, label, type: "boolean" as const, value: Boolean(input.value) };
    if (input.type === "string") return { key, label, type: "string" as const, value: String(input.value ?? "") };
    const numberValue = Number(input.value);
    return {
      key,
      label,
      type: "number" as const,
      value: Number.isFinite(numberValue) ? numberValue : 0,
      min: normalizeOptionalNumber((input as { min?: unknown }).min),
      max: normalizeOptionalNumber((input as { max?: unknown }).max),
      step: normalizeOptionalNumber((input as { step?: unknown }).step)
    };
  }).filter((param): param is StrategyScriptParam => Boolean(param));
}

function normalizeTriggers(triggers: unknown): Array<StrategyTrigger["type"]> {
  if (!Array.isArray(triggers)) return ["manual"];
  const next = [...new Set(triggers.filter((trigger): trigger is StrategyTrigger["type"] => trigger === "manual" || trigger === "market_refresh"))];
  return next.length ? next : ["manual"];
}

function normalizeTrigger(trigger: unknown, code: string): StrategyTrigger {
  if (trigger && typeof trigger === "object" && !Array.isArray(trigger)) {
    const input = trigger as Partial<StrategyTrigger>;
    return {
      type: input.type === "market_refresh" ? "market_refresh" : "manual",
      code: typeof input.code === "string" && input.code.trim() ? input.code.trim() : code
    };
  }
  return { type: "manual", code };
}

function normalizeSignalType(value: unknown): StrategySignalType {
  const allowed: StrategySignalType[] = ["volume_up", "volume_down", "buy_watch", "buy_trigger", "sell_watch", "sell_trigger", "t_watch", "t_trigger", "risk_break", "repairing", "main_wave_candidate", "none"];
  return allowed.includes(value as StrategySignalType) ? value as StrategySignalType : "none";
}

function normalizeAction(value: unknown): StrategySignal["action"] {
  const allowed: StrategySignal["action"][] = ["watch", "small_buy", "buy", "hold", "reduce", "sell", "ignore"];
  return allowed.includes(value as StrategySignal["action"]) ? value as StrategySignal["action"] : "watch";
}

function normalizeLevels(value: object): StrategySignal["levels"] {
  const input = value as StrategySignal["levels"];
  return {
    support: normalizeOptionalNumber(input?.support),
    resistance: normalizeOptionalNumber(input?.resistance),
    buyLow: normalizeOptionalNumber(input?.buyLow),
    buyHigh: normalizeOptionalNumber(input?.buyHigh),
    breakout: normalizeOptionalNumber(input?.breakout),
    stopLoss: normalizeOptionalNumber(input?.stopLoss),
    takeProfit: normalizeOptionalNumber(input?.takeProfit),
    trailingActivation: normalizeOptionalNumber(input?.trailingActivation),
    trailingDrawdownPercent: normalizeOptionalNumber(input?.trailingDrawdownPercent)
  };
}

function paramsRecord(params: StrategyScriptParam[]): Record<string, string | number | boolean> {
  return Object.fromEntries(params.map((param) => [param.key, param.value]));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(Math.max(numberValue, min), max);
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function strategyRoot(): string {
  return path.join(app.getPath("userData"), "strategy-monitoring");
}

function strategyScriptsPath(): string {
  return path.join(strategyRoot(), "scripts.json");
}

function strategySignalsPath(): string {
  return path.join(strategyRoot(), "signals.json");
}

function strategyRunLogsPath(): string {
  return path.join(strategyRoot(), "run-logs.json");
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function defaultStrategyScripts(): StrategyScript[] {
  const now = Date.now();
  return [
    {
      id: "default-volume-up",
      name: "放量上涨观察",
      enabled: false,
      language: "js",
      targetCode: "sz002594",
      params: [
        { key: "amountRatio", label: "成交额放大倍数", type: "number", value: 1.3, step: 0.1 },
        { key: "minChangePercent", label: "最小涨幅", type: "number", value: 1, step: 0.1 }
      ],
      triggers: ["manual"],
      cooldownMs: 60000,
      code: defaultVolumeUpScriptCode(),
      createdAt: now,
      updatedAt: now
    },
    {
      id: "default-risk-break",
      name: "风险破位提示",
      enabled: false,
      language: "js",
      targetCode: "sz002594",
      params: [
        { key: "risk", label: "风险线", type: "number", value: 88, step: 0.01 }
      ],
      triggers: ["manual"],
      cooldownMs: 30000,
      code: defaultRiskBreakScriptCode(),
      createdAt: now,
      updatedAt: now
    },
    {
      id: "default-repair",
      name: "修复确认观察",
      enabled: false,
      language: "js",
      targetCode: "sz002594",
      params: [
        { key: "relativeStrength", label: "相对强度阈值", type: "number", value: 1.5, step: 0.1 },
        { key: "breakout", label: "突破确认价", type: "number", value: 96.8, step: 0.01 }
      ],
      triggers: ["manual"],
      cooldownMs: 60000,
      code: defaultRepairScriptCode(),
      createdAt: now,
      updatedAt: now
    },
    {
      id: "default-t-watch",
      name: "做 T 观察",
      enabled: false,
      language: "js",
      targetCode: "sz002594",
      params: [
        { key: "resistance", label: "日内压力位", type: "number", value: 96, step: 0.01 },
        { key: "support", label: "日内支撑位", type: "number", value: 92, step: 0.01 },
        { key: "suggestedShares", label: "建议观察股数", type: "number", value: 300, step: 100 }
      ],
      triggers: ["manual"],
      cooldownMs: 60000,
      code: defaultTWatchScriptCode(),
      createdAt: now,
      updatedAt: now
    }
  ];
}

function defaultVolumeUpScriptCode(): string {
  return `module.exports.analyze = function analyze(ctx) {
  const amountRatio = Number(ctx.params.amountRatio || 1.3);
  const minChangePercent = Number(ctx.params.minChangePercent || 1);
  const recent = ctx.kline.slice(-20);
  const avgAmount = recent.length
    ? recent.reduce((sum, item) => sum + item.close * item.volume, 0) / recent.length
    : 0;
  const currentAmount = Number(ctx.quote.amount || 0);
  const change = Number(ctx.quote.change_percent || 0);
  if (avgAmount > 0 && currentAmount > avgAmount * amountRatio && change >= minChangePercent) {
    return {
      signal: "volume_up",
      action: "watch",
      confidence: 0.65,
      severity: "notice",
      title: "放量上涨观察",
      reasons: ["当前成交额高于近20日均额阈值", "价格涨幅达到策略要求"],
      levels: { resistance: ctx.quote.high }
    };
  }
  return { signal: "none", action: "ignore", confidence: 0, severity: "info", title: "未触发", reasons: [] };
};`;
}

function defaultRiskBreakScriptCode(): string {
  return `module.exports.analyze = function analyze(ctx) {
  const risk = Number(ctx.params.risk || 0);
  const price = Number(ctx.quote.current_price || 0);
  if (risk > 0 && price > 0 && price < risk) {
    return {
      signal: "risk_break",
      action: "reduce",
      confidence: 0.78,
      severity: "warning",
      title: "风险破位",
      reasons: ["当前价格跌破用户设定风险线", "应检查原交易假设是否仍成立"],
      levels: { stopLoss: risk },
      suggestedShares: Number(ctx.params.suggestedShares || 0) || undefined
    };
  }
  return { signal: "none", action: "ignore", confidence: 0, severity: "info", title: "未触发", reasons: [] };
};`;
}

function defaultRepairScriptCode(): string {
  return `module.exports.analyze = function analyze(ctx) {
  const requiredStrength = Number(ctx.params.relativeStrength || 1.5);
  const breakout = Number(ctx.params.breakout || 0);
  const price = Number(ctx.quote.current_price || 0);
  const change = Number(ctx.quote.change_percent || 0);
  const index = ctx.indices.sh000001;
  const indexChange = index && index.prev_close ? ((index.current_price - index.prev_close) / index.prev_close) * 100 : 0;
  const relativeStrength = change - indexChange;
  if (relativeStrength >= requiredStrength && (!breakout || price >= breakout)) {
    return {
      signal: "repairing",
      action: "hold",
      confidence: 0.62,
      severity: "notice",
      title: "修复确认观察",
      reasons: ["个股相对上证指数明显走强", "价格达到或接近用户设定突破确认位"],
      levels: { breakout }
    };
  }
  return { signal: "none", action: "ignore", confidence: 0, severity: "info", title: "未触发", reasons: [] };
};`;
}

function defaultTWatchScriptCode(): string {
  return `module.exports.analyze = function analyze(ctx) {
  const resistance = Number(ctx.params.resistance || 0);
  const support = Number(ctx.params.support || 0);
  const price = Number(ctx.quote.current_price || 0);
  const suggestedShares = Number(ctx.params.suggestedShares || 0);
  if (resistance > 0 && price >= resistance) {
    return {
      signal: "t_watch",
      action: "watch",
      confidence: 0.58,
      severity: "notice",
      title: "做 T 高位观察",
      reasons: ["当前价格接近日内压力位", "需要观察是否冲高回落或量能衰减"],
      levels: { resistance, support },
      suggestedShares: suggestedShares || undefined
    };
  }
  if (support > 0 && price > 0 && price <= support) {
    return {
      signal: "t_watch",
      action: "watch",
      confidence: 0.55,
      severity: "notice",
      title: "做 T 低位观察",
      reasons: ["当前价格接近日内支撑位", "需要观察是否缩量企稳或重新站回分时均价"],
      levels: { resistance, support },
      suggestedShares: suggestedShares || undefined
    };
  }
  return { signal: "none", action: "ignore", confidence: 0, severity: "info", title: "未触发", reasons: [] };
};`;
}
