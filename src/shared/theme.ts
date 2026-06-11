import type { Theme } from "./types";

export const defaultThemes: Record<string, Theme> = {
  default: {
    background: "#141414E6",
    border: "#3C3C3C",
    text_normal: "#D3D3D3",
    text_white: "#FFFFFF",
    text_gray: "#808080",
    color_up: "#FF6464",
    color_down: "#64FF64",
    accent: "#FFA500",
    menu_bg: "#232323",
    rounding: 8,
    border_width: 1
  },
  cyberpunk: {
    background: "#0A0A10F0",
    border: "#00F0FF",
    text_normal: "#00F0FF",
    text_white: "#DCF5FF",
    text_gray: "#647882",
    color_up: "#FF2828",
    color_down: "#28FF28",
    accent: "#FF00FF",
    menu_bg: "#0F0F19",
    rounding: 2,
    border_width: 1
  },
  light: {
    background: "#F5F5F7F2",
    border: "#D1D1D6",
    text_normal: "#1D1D1F",
    text_white: "#000000",
    text_gray: "#86868B",
    color_up: "#EA4C89",
    color_down: "#4CAF50",
    accent: "#007AFF",
    menu_bg: "#FFFFFF",
    rounding: 6,
    border_width: 1
  },
  sublime: {
    background: "#272822F0",
    border: "#171814",
    text_normal: "#F8F8F2",
    text_white: "#FFFFFF",
    text_gray: "#75715E",
    color_up: "#F92672",
    color_down: "#A6E22E",
    accent: "#66D9EF",
    menu_bg: "#272822",
    rounding: 4,
    border_width: 1
  },
  transparent: {
    background: "transparent",
    border: "#3C3C3C",
    text_normal: "#D3D3D3",
    text_white: "#FFFFFF",
    text_gray: "#A0A0A0",
    color_up: "#FF6464",
    color_down: "#64FF64",
    accent: "#FFA500",
    menu_bg: "transparent",
    rounding: 8,
    border_width: 1
  }
};

export function currentTheme(config: { current_theme: string; themes: Record<string, Theme> }): Theme {
  return config.themes[config.current_theme] ?? config.themes.default ?? Object.values(config.themes)[0] ?? defaultThemes.default;
}

export function profitColor(theme: Pick<Theme, "color_up" | "color_down">, value: number): string {
  return value >= 0 ? theme.color_up : theme.color_down;
}
