import * as yaml from "js-yaml";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import enUsYaml from "./locales/en-US.yaml?raw";
import zhCnYaml from "./locales/zh-CN.yaml?raw";

export type Locale = "zh-CN" | "en-US";
export type TranslationKey =
  | `menu.${"application" | "file" | "view" | "window" | "language" | "help" | "usageGuide" | "addSymbol" | "refresh" | "openConfig" | "openConfigFolder" | "quit" | "explorer" | "editor" | "sidePanel" | "statusBar" | "details" | "chart" | "toggleStockFloat" | "toggleWatchFloat" | "toggleMottoWindow"}`
  | `language.${"chinese" | "english"}`
  | `common.${"add" | "cancel" | "save" | "saving" | "load" | "loading" | "previousPage" | "nextPage"}`
  | `detail.${"selectSymbol" | "saveAlias" | "cancelAliasEdit" | "editAlias" | "toggleMinuteChart" | "closeMinute" | "minute" | "openChart" | "quoteTable" | "lastPrice" | "change" | "changePercent" | "open" | "high" | "low" | "prevClose" | "shares" | "marketValue" | "dayProfitLoss" | "totalProfitLoss" | "returnRate" | "quoteTime" | "updated" | "tags" | "noTags" | "removeTag" | "unsavedTagChanges" | "saveTags" | "positions" | "row" | "account" | "cost" | "noPositions" | "removePosition" | "unsavedPositionChanges" | "savePositions" | "discussions" | "loadDiscussionsHint" | "noComments"}`
  | `update.${"title" | "check" | "download" | "checking" | "available" | "downloading" | "downloaded" | "latest" | "failed" | "packagedOnly" | "autoCheck" | "restartInstall"}`
  | `side.${"openConfigFolder" | "toggleStockFloat" | "toggleWatchFloat" | "more" | "selectedSymbol" | "none" | "code" | "refresh" | "config" | "window" | "closeButton" | "minimizeToTray" | "close" | "motto" | "toggleMottoWindow" | "mottoPlaceholder" | "font" | "size" | "color" | "unsavedMotto" | "saveMotto"}`
  | `news.${"noNews"}`
  | `status.${"shIndex" | "accountProfitLoss" | "refreshInterval" | "accountConfig" | "totalInvestment" | "cash"}`
  | `error.${"invalidNumbers" | "saveAccountFailed" | "loadCommentsFailed" | "tagEditorUnavailable" | "saveTagsFailed" | "positionEditorUnavailable" | "savePositionsFailed" | "aliasEditorUnavailable" | "saveAliasFailed" | "loadNewsFailed" | "saveMottoFailed"}`;

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
  return window.navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
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
