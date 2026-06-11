import { effectivePrice } from "../shared/finance";
import type { CSSProperties } from "react";
import type { KLineScale, StockStatus, Theme } from "../shared/types";

export function stockPercent(stock: StockStatus): number | undefined {
  const price = effectivePrice(stock.market);
  if (!stock.market || price === undefined || stock.market.prev_close <= 0) return undefined;
  return ((price - stock.market.prev_close) / stock.market.prev_close) * 100;
}

export function formatMaybe(value: number | undefined, digits: number): string {
  return value === undefined ? "--" : value.toFixed(digits);
}

export function formatSigned(value: number, digits: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export function cssColor(value: string): string {
  return value.toLowerCase() === "transparent" ? "transparent" : value;
}

function isTransparentColor(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "transparent" || normalized === "#00000000";
}

export function scaleLabel(scale: KLineScale): string {
  if (scale === 1) return "1m";
  return scale === 240 ? "Daily" : `${scale}m`;
}

export function themeStyle(theme?: Theme): CSSProperties | undefined {
  if (!theme) return undefined;
  const transparentSurface = isTransparentColor(theme.background);
  const transparentMenu = isTransparentColor(theme.menu_bg);
  const border = transparentSurface && isTransparentColor(theme.border) ? "#3C3C3C" : cssColor(theme.border);
  const borderWidth = transparentSurface ? Math.max(theme.border_width, 1) : theme.border_width;
  const menuSurface = transparentMenu ? (transparentSurface ? "#232323E6" : cssColor(theme.background)) : cssColor(theme.menu_bg);

  return {
    "--bg": cssColor(theme.background),
    "--border": border,
    "--text": cssColor(theme.text_normal),
    "--text-strong": cssColor(theme.text_white),
    "--muted": cssColor(theme.text_gray),
    "--up": cssColor(theme.color_up),
    "--down": cssColor(theme.color_down),
    "--accent": cssColor(theme.accent),
    "--menu-bg": cssColor(theme.menu_bg),
    "--menu-surface": menuSurface,
    "--radius": `${Math.min(theme.rounding, 8)}px`,
    "--border-width": `${borderWidth}px`
  } as CSSProperties;
}
