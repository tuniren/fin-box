import * as yaml from "js-yaml";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import enUsYaml from "./locales/en-US.yaml?raw";
import zhCnYaml from "./locales/zh-CN.yaml?raw";

export type Locale = "zh-CN" | "en-US";
export type TranslationKey =
  | `menu.${"application" | "file" | "view" | "window" | "language" | "help" | "usageGuide" | "about" | "addSymbol" | "refresh" | "openConfig" | "openConfigFolder" | "openNotesFolder" | "quit" | "explorer" | "editor" | "sidePanel" | "statusBar" | "details" | "chart" | "toggleCamouflageFloat" | "toggleWatchlistFloat" | "toggleMottoFloat"}`
  | `language.${"chinese" | "english"}`
  | `common.${"add" | "cancel" | "close" | "save" | "saving" | "load" | "loading" | "previousPage" | "nextPage"}`
  | `detail.${"selectSymbol" | "saveAlias" | "cancelAliasEdit" | "editAlias" | "toggleMinuteChart" | "closeMinute" | "minute" | "openChart" | "quoteTable" | "lastPrice" | "change" | "changePercent" | "open" | "high" | "low" | "prevClose" | "shares" | "marketValue" | "volume" | "amount" | "dayProfitLoss" | "totalProfitLoss" | "returnRate" | "quoteTime" | "updated" | "aiAnalysis" | "aiAnalyzing" | "aiHistory" | "aiProcess" | "aiRiskNotice" | "aiDisabledTitle" | "aiDisabledHint" | "openAiSettings" | "tags" | "noTags" | "removeTag" | "unsavedTagChanges" | "saveTags" | "positions" | "row" | "account" | "cost" | "noPositions" | "removePosition" | "unsavedPositionChanges" | "savePositions" | "discussions" | "loadDiscussionsHint" | "noComments"}`
  | `update.${"title" | "check" | "download" | "checking" | "available" | "downloading" | "downloaded" | "latest" | "failed" | "packagedOnly" | "autoCheck" | "restartInstall"}`
  | `about.${"title" | "version" | "description"}`
  | `side.${"openConfigFolder" | "toggleCamouflageFloat" | "toggleWatchlistFloat" | "more" | "watchTreeColumns" | "selectedSymbol" | "none" | "code" | "refresh" | "config" | "window" | "closeButton" | "minimizeToTray" | "close" | "theme" | "motto" | "toggleMottoFloat" | "mottoPlaceholder" | "font" | "size" | "color" | "unsavedMotto" | "saveMotto"}`
  | `settings.${"title" | "general" | "marketRefresh" | "aiAnalysis" | "mottoFloat" | "watchlistFloat" | "camouflageFloat" | "generalDescription" | "marketRefreshDescription" | "aiAnalysisDescription" | "aiAnalysisGuide" | "mottoDescription" | "watchlistDescription" | "camouflageDescription" | "windowCloseDescription" | "appearance" | "appearanceDescription" | "tradingRefreshInterval" | "tradingRefreshIntervalHint" | "enableAiAnalysis" | "codexCommand" | "codexCommandHint" | "aiTimeout" | "aiTimeoutHint" | "includeNotes" | "includeNews" | "includeComments" | "watchlistProfile" | "profileName" | "saveProfile" | "resetDefault" | "profileNamePrompt" | "watchlistSymbols" | "watchlistColumns" | "watchlistStyle" | "watchlistNews" | "showWatchlistNews" | "horizontalStockRatio" | "horizontalNewsRatio" | "searchWatchlistSymbols" | "selectedWatchlistSymbols" | "noWatchlistSymbols" | "layout" | "verticalLayout" | "horizontalLayout" | "fontFamily" | "fontSize" | "textColor" | "upColor" | "downColor" | "backgroundColor" | "backgroundOpacity" | "borderColor" | "showBorder" | "displayMode" | "camouflagePreview"}`
  | `float.${"addWatchlistSymbols" | "openWatchlistSettings" | "openNewsDetail"}`
  | `stockNotes.${"title" | "empty" | "strategy" | "strategyPlaceholder" | "daily" | "dailyPlaceholder" | "previousDay" | "nextDay" | "resizePanels" | "unsaved" | "saveShortcut"}`
  | `aiTab.${"defaultSubtitle" | "chatInput" | "promptPlaceholder" | "defaultSymbol" | "noSymbol" | "confirmContextOnSend" | "contextOptions" | "contextCollapsedHint" | "contextExpandedHint" | "stage2Notice" | "send" | "emptyTitle" | "emptyHint" | "disabledTitle" | "disabledHint" | "openAiSettings" | "userMessage" | "authorizationSummary" | "targetSymbol" | "selectedContexts" | "noContext" | "stage2Summary" | "unspecified" | "collapseAll" | "expandAll" | "collapseBlock" | "expandBlock" | "copyBlock"}`
  | `aiContext.${"quote" | "dailyKline" | "minute" | "positionSummary" | "positionDetail" | "profit" | "notes" | "tradingLogic" | "news" | "comments"}`
  | `aiScope.${"marketData" | "privateData" | "tradingLogic" | "noiseData"}`
  | `aiBlock.${"message" | "answer" | "analysis" | "toolResult"}`
  | `news.${"noNews" | "pullLatest" | "refreshingLatest" | "latestLoaded" | "latestUpToDate" | "noMore"}`
  | `status.${"shIndex" | "accountProfitLoss" | "refreshInterval" | "accountConfig" | "totalInvestment" | "cash"}`
  | `error.${"invalidNumbers" | "saveAccountFailed" | "loadCommentsFailed" | "tagEditorUnavailable" | "saveTagsFailed" | "positionEditorUnavailable" | "savePositionsFailed" | "aliasEditorUnavailable" | "saveAliasFailed" | "loadNewsFailed" | "saveMottoFailed" | "aiAnalysisUnavailable" | "aiAnalysisFailed"}`;

type MessageTree = { [key: string]: string | MessageTree };
type I18nValue = { locale: Locale; setLocale: (locale: Locale) => void; t: (key: TranslationKey) => string };
const STORAGE_KEY = "fin-box.locale";

function parseMessages(source: string, locale: Locale): MessageTree {
  const value = yaml.load(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid i18n YAML for ${locale}`);
  return value as MessageTree;
}

function getMessage(messages: MessageTree, key: TranslationKey): string | undefined {
  let current: string | MessageTree = messages;
  for (const segment of key.split(".")) {
    if (typeof current === "string") return undefined;
    current = current[segment];
    if (current === undefined) return undefined;
  }
  return typeof current === "string" ? current : undefined;
}

const resources: Record<Locale, MessageTree> = {
  "zh-CN": parseMessages(zhCnYaml, "zh-CN"),
  "en-US": parseMessages(enUsYaml, "en-US")
};
const I18nContext = createContext<I18nValue | undefined>(undefined);

function initialLocale(): Locale {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "zh-CN" || saved === "en-US") return saved;
  return "zh-CN";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  useEffect(() => { window.localStorage.setItem(STORAGE_KEY, locale); document.documentElement.lang = locale; }, [locale]);
  const value = useMemo<I18nValue>(() => ({
    locale, setLocale,
    t: (key) => getMessage(resources[locale], key) ?? getMessage(resources["en-US"], key) ?? key
  }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
