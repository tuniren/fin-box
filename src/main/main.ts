import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import fs from "node:fs";
import path from "node:path";
import { AppCore } from "./core";
import type { AppConfig, KLinePoint, KLineScale, MottoConfig, NoteTreeItem, Position, StockJournalNote } from "../shared/types";

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";

const APP_USER_MODEL_ID = "com.finbox.desktop.appicon";

app.setName("Code");
if (process.platform === "win32") {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

let mainWindow: BrowserWindow | undefined;
let floatWindow: BrowserWindow | undefined;
let watchFloatWindow: BrowserWindow | undefined;
let mottoWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let isQuitting = false;
let core: AppCore;
const klineWindows = new Map<string, BrowserWindow>();
let appIcon: Electron.NativeImage | undefined;

function notesRoot(): string {
  return path.join(app.getPath("userData"), "notes");
}

function ensureNotesRoot(): string {
  const root = notesRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function normalizeRelativeNotePath(notePath: string): string {
  return notePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function resolveNotePath(notePath = ""): string {
  const root = ensureNotesRoot();
  const normalized = normalizeRelativeNotePath(notePath);
  const resolved = path.resolve(root, normalized);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Note path is outside the notes folder.");
  }
  return resolved;
}

function noteRelativePath(absolutePath: string): string {
  return path.relative(notesRoot(), absolutePath).replace(/\\/g, "/");
}

function sanitizeNoteName(name: string, type: "file" | "directory"): string {
  const trimmed = name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "-");
  if (!trimmed || trimmed === "." || trimmed === "..") {
    throw new Error("Enter a valid name.");
  }
  return type === "file" && !trimmed.toLowerCase().endsWith(".md") ? `${trimmed}.md` : trimmed;
}

function readNotesTree(): NoteTreeItem[] {
  const root = ensureNotesRoot();
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || (entry.isFile() && entry.name.toLowerCase().endsWith(".md")))
    .sort(compareNoteEntries)
    .map((entry) => readNoteEntry(path.join(root, entry.name), entry));
}

function readNoteEntry(absolutePath: string, entry: fs.Dirent): NoteTreeItem {
  if (entry.isDirectory()) {
    const children = fs.readdirSync(absolutePath, { withFileTypes: true })
      .filter((child) => child.isDirectory() || (child.isFile() && child.name.toLowerCase().endsWith(".md")))
      .sort(compareNoteEntries)
      .map((child) => readNoteEntry(path.join(absolutePath, child.name), child));
    return { name: entry.name, path: noteRelativePath(absolutePath), type: "directory", children };
  }
  return { name: entry.name, path: noteRelativePath(absolutePath), type: "file" };
}

function compareNoteEntries(left: fs.Dirent, right: fs.Dirent): number {
  if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
}

function getAppIcon(): Electron.NativeImage {
  if (appIcon && !appIcon.isEmpty()) return appIcon;

  const icoIconPath = path.join(app.getAppPath(), "public", "assets", "app-icon.ico");
  if (fs.existsSync(icoIconPath)) {
    appIcon = nativeImage.createFromPath(icoIconPath);
  }

  if (!appIcon || appIcon.isEmpty()) {
    const svgIconPath = path.join(app.getAppPath(), "public", "assets", "app-icon.svg");
    if (fs.existsSync(svgIconPath)) {
      const svg = fs.readFileSync(svgIconPath, "utf8");
      appIcon = nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    }
  }

  if (!appIcon || appIcon.isEmpty()) {
    const fallbackIconPath = path.join(app.getPath("userData"), "app-icon-svg.ico");
    if (!fs.existsSync(fallbackIconPath)) {
      fs.writeFileSync(fallbackIconPath, createVSCodeStyleIco());
    }
    appIcon = nativeImage.createFromPath(fallbackIconPath);
  }

  return appIcon;
}
function createIcoFromSvgContent(svg: string): Buffer {
  const background = readSvgColor(svg, /<rect[^>]*fill="([^"]+)"/, [0, 0, 0, 0]);
  const primary = readSvgColor(svg, /<path[^>]*fill="([^"]+)"/, [0, 0, 0, 255]);
  const width = 32;
  const height = 32;
  const pixels = new Uint8ClampedArray(width * height * 4);

  fillPolygon(pixels, width, height, [[0, 0], [256, 0], [256, 256], [0, 256]], background);
  fillPolygon(pixels, width, height, [[188, 28], [70, 137], [32, 108], [14, 123], [69, 173], [188, 28]], withAlpha(primary, 42));
  fillPolygon(pixels, width, height, [[188, 228], [70, 119], [32, 148], [14, 133], [69, 83], [188, 228]], withAlpha(primary, 72));
  fillPolygon(pixels, width, height, [[188, 28], [238, 52], [238, 204], [188, 228]], withAlpha(primary, 235));
  clearPolygon(pixels, width, height, [[188, 70], [217, 84], [217, 172], [188, 186]]);

  return createIcoFromPixels(pixels, width, height);
}

function readSvgColor(svg: string, pattern: RegExp, fallback: number[]): number[] {
  const match = svg.match(pattern);
  if (!match) return fallback;
  return parseColor(match[1], fallback);
}

function parseColor(value: string, fallback: number[]): number[] {
  const normalized = value.trim().toLowerCase();
  if (normalized === "#fff" || normalized === "white") return [255, 255, 255, 255];
  if (normalized === "#000" || normalized === "black") return [0, 0, 0, 255];
  const longHex = normalized.match(/^#([0-9a-f]{6})$/);
  if (!longHex) return fallback;
  const hex = longHex[1];
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 255];
}

function withAlpha(rgba: number[], alpha: number): number[] {
  return [rgba[0], rgba[1], rgba[2], alpha];
}

function createVSCodeStyleIco(): Buffer {
  const width = 32;
  const height = 32;
  const pixels = new Uint8ClampedArray(width * height * 4);

  fillPolygon(pixels, width, height, [[188, 28], [70, 137], [32, 108], [14, 123], [69, 173], [188, 28]], [0, 0, 0, 120]);
  fillPolygon(pixels, width, height, [[188, 228], [70, 119], [32, 148], [14, 133], [69, 83], [188, 228]], [0, 0, 0, 170]);
  fillPolygon(pixels, width, height, [[188, 28], [238, 52], [238, 204], [188, 228]], [0, 0, 0, 255]);
  clearPolygon(pixels, width, height, [[188, 70], [217, 84], [217, 172], [188, 186]]);

  return createIcoFromPixels(pixels, width, height);
}

function createIcoFromPixels(pixels: Uint8ClampedArray, width: number, height: number): Buffer {
  const headerSize = 40;
  const xorSize = width * height * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  const maskSize = maskStride * height;
  const imageSize = headerSize + xorSize + maskSize;
  const buffer = Buffer.alloc(6 + 16 + imageSize);

  buffer.writeUInt16LE(0, 0);
  buffer.writeUInt16LE(1, 2);
  buffer.writeUInt16LE(1, 4);
  buffer.writeUInt8(width, 6);
  buffer.writeUInt8(height, 7);
  buffer.writeUInt8(0, 8);
  buffer.writeUInt8(0, 9);
  buffer.writeUInt16LE(1, 10);
  buffer.writeUInt16LE(32, 12);
  buffer.writeUInt32LE(imageSize, 14);
  buffer.writeUInt32LE(22, 18);

  const dibOffset = 22;
  buffer.writeUInt32LE(headerSize, dibOffset);
  buffer.writeInt32LE(width, dibOffset + 4);
  buffer.writeInt32LE(height * 2, dibOffset + 8);
  buffer.writeUInt16LE(1, dibOffset + 12);
  buffer.writeUInt16LE(32, dibOffset + 14);
  buffer.writeUInt32LE(0, dibOffset + 16);
  buffer.writeUInt32LE(xorSize, dibOffset + 20);
  buffer.writeInt32LE(0, dibOffset + 24);
  buffer.writeInt32LE(0, dibOffset + 28);
  buffer.writeUInt32LE(0, dibOffset + 32);
  buffer.writeUInt32LE(0, dibOffset + 36);

  const pixelOffset = dibOffset + headerSize;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = ((height - 1 - y) * width + x) * 4;
      const dst = pixelOffset + (y * width + x) * 4;
      buffer[dst] = pixels[src + 2];
      buffer[dst + 1] = pixels[src + 1];
      buffer[dst + 2] = pixels[src];
      buffer[dst + 3] = pixels[src + 3];
    }
  }

  return buffer;
}

function fillPolygon(pixels: Uint8ClampedArray, width: number, height: number, points: number[][], rgba: number[]): void {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const px = ((x + 0.5) / width) * 256;
      const py = ((y + 0.5) / height) * 256;
      if (!insidePolygon(px, py, points)) continue;

      const index = (y * width + x) * 4;
      const alpha = rgba[3] / 255;
      pixels[index] = Math.round(rgba[0] * alpha + pixels[index] * (1 - alpha));
      pixels[index + 1] = Math.round(rgba[1] * alpha + pixels[index + 1] * (1 - alpha));
      pixels[index + 2] = Math.round(rgba[2] * alpha + pixels[index + 2] * (1 - alpha));
      pixels[index + 3] = Math.max(pixels[index + 3], rgba[3]);
    }
  }
}

function clearPolygon(pixels: Uint8ClampedArray, width: number, height: number, points: number[][]): void {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const px = ((x + 0.5) / width) * 256;
      const py = ((y + 0.5) / height) * 256;
      if (!insidePolygon(px, py, points)) continue;

      const index = (y * width + x) * 4;
      pixels[index] = 0;
      pixels[index + 1] = 0;
      pixels[index + 2] = 0;
      pixels[index + 3] = 0;
    }
  }
}

function insidePolygon(x: number, y: number, points: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function createTray(): Tray {
  if (tray && !tray.isDestroyed()) return tray;

  tray = new Tray(getAppIcon());
  tray.setToolTip("Code");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show Code", click: () => showMainWindow() },
    { type: "separator" },
    { label: "Quit", click: () => quitApp() }
  ]));
  tray.on("double-click", () => showMainWindow());
  return tray;
}

function showMainWindow(): void {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createMainWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function quitApp(): void {
  isQuitting = true;
  app.quit();
}

function closeMainWindowByPreference(win: BrowserWindow): void {
  if (core?.getState().config.window_close_behavior === "close") {
    win.close();
    return;
  }

  createTray();
  win.hide();
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1240,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    title: "Code",
    frame: false,
    icon: getAppIcon(),
    backgroundColor: "#f8f8f8",
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  applyWindowIcon(win);
  win.setMenuBarVisibility(false);
  win.on("close", (event) => {
    if (isQuitting || core?.getState().config.window_close_behavior === "close") return;
    event.preventDefault();
    createTray();
    win.hide();
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = undefined;
    closeDerivedWindows();
  });
  void loadRenderer(win);
  return win;
}

function closeDerivedWindows(): void {
  if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.close();
  }
  floatWindow = undefined;

  if (watchFloatWindow && !watchFloatWindow.isDestroyed()) {
    watchFloatWindow.close();
  }
  watchFloatWindow = undefined;

  if (mottoWindow && !mottoWindow.isDestroyed()) {
    mottoWindow.close();
  }
  mottoWindow = undefined;

  for (const win of klineWindows.values()) {
    if (!win.isDestroyed()) win.close();
  }
  klineWindows.clear();
}

function createFloatWindow(): BrowserWindow {
  if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.show();
    floatWindow.focus();
    return floatWindow;
  }

  const win = new BrowserWindow({
    width: 180,
    height: 22,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  applyWindowIcon(win);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setMenuBarVisibility(false);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.on("closed", () => {
    if (floatWindow === win) floatWindow = undefined;
  });
  floatWindow = win;
  void loadRenderer(win, "#/float");
  return win;
}

function createWatchFloatWindow(): BrowserWindow {
  if (watchFloatWindow && !watchFloatWindow.isDestroyed()) {
    watchFloatWindow.show();
    watchFloatWindow.focus();
    return watchFloatWindow;
  }

  const win = new BrowserWindow({
    width: 128,
    height: 180,
    minWidth: 1,
    minHeight: 1,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    icon: getAppIcon(),
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  applyWindowIcon(win);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setMenuBarVisibility(false);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.on("closed", () => {
    if (watchFloatWindow === win) watchFloatWindow = undefined;
  });
  watchFloatWindow = win;
  void loadRenderer(win, "#/watch-float");
  return win;
}

function createMottoWindow(): BrowserWindow {
  if (mottoWindow && !mottoWindow.isDestroyed()) {
    mottoWindow.show();
    mottoWindow.focus();
    return mottoWindow;
  }

  const win = new BrowserWindow({
    width: 260,
    height: 70,
    minWidth: 120,
    minHeight: 42,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    icon: getAppIcon(),
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  applyWindowIcon(win);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setMenuBarVisibility(false);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.on("closed", () => {
    if (mottoWindow === win) mottoWindow = undefined;
  });
  mottoWindow = win;
  void loadRenderer(win, "#/motto");
  return win;
}

function createKLineWindow(code: string, name: string): BrowserWindow {
  const existed = klineWindows.get(code);
  if (existed && !existed.isDestroyed()) {
    existed.show();
    existed.focus();
    return existed;
  }

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    title: `${name} - ${code}`,
    icon: getAppIcon(),
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [`--kline=${code}`, `--kline-name=${encodeURIComponent(name)}`]
    }
  });
  applyWindowIcon(win);
  win.setMenuBarVisibility(false);
  win.on("closed", () => klineWindows.delete(code));
  klineWindows.set(code, win);
  void loadRenderer(win, `#/kline/${encodeURIComponent(code)}/${encodeURIComponent(name)}`);
  return win;
}

function applyWindowIcon(win: BrowserWindow): void {
  if (process.platform === "win32") {
    win.setIcon(getAppIcon());
  }
}

async function loadRenderer(win: BrowserWindow, hash = ""): Promise<void> {
  if (process.env.VITE_DEV_SERVER_URL) {
    await win.loadURL(`${process.env.VITE_DEV_SERVER_URL}${hash}`);
  } else {
    await win.loadFile(path.join(__dirname, "../../dist/index.html"), { hash: hash.replace(/^#/, "") });
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  core = new AppCore(() => BrowserWindow.getAllWindows());
  mainWindow = createMainWindow();
  createTray();
  core.start();

  globalShortcut.register("CommandOrControl+Alt+8", () => {
    mainWindow?.webContents.send("cycle-stock");
    floatWindow?.webContents.send("cycle-stock");
  });
  globalShortcut.register("CommandOrControl+Alt+9", () => {
    if (floatWindow && !floatWindow.isDestroyed()) {
      if (floatWindow.isVisible()) {
        floatWindow.hide();
      } else {
        floatWindow.show();
      }
    } else {
      createFloatWindow();
    }
  });
  globalShortcut.register("CommandOrControl+Alt+0", () => {
    if (watchFloatWindow && !watchFloatWindow.isDestroyed()) {
      if (watchFloatWindow.isVisible()) {
        watchFloatWindow.hide();
      } else {
        watchFloatWindow.show();
      }
    } else {
      createWatchFloatWindow();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  core?.stop();
});

ipcMain.handle("get-state", () => core.getState());
ipcMain.handle("force-refresh", () => core.forceRefresh());
ipcMain.handle("open-config-file", () => core.openConfigFile());
ipcMain.handle("open-config-dir", () => core.openConfigDir());
ipcMain.handle("quit", () => quitApp());
ipcMain.handle("search-stocks", (_event, query: string) => core.searchStocks(query));
ipcMain.handle("add-stock", (_event, code: string, alias?: string) => core.addStock(code, alias));
ipcMain.handle("remove-stock", (_event, code: string) => core.removeStock(code));
ipcMain.handle("update-account-config", (_event, patch: Pick<AppConfig, "total_investment" | "cash">) => core.updateAccountConfig(patch));
ipcMain.handle("update-motto", (_event, motto: MottoConfig) => core.updateMotto(motto));
ipcMain.handle("update-window-close-behavior", (_event, behavior: AppConfig["window_close_behavior"]) => core.updateWindowCloseBehavior(behavior));
ipcMain.handle("update-theme", (_event, themeName: string) => core.updateTheme(themeName));
ipcMain.handle("update-stock-alias", (_event, code: string, alias?: string) => core.updateStockAlias(code, alias));
ipcMain.handle("update-stock-tags", (_event, code: string, tags: string[]) => core.updateStockTags(code, tags));
ipcMain.handle("update-stock-groups", (_event, groups: string[]) => core.updateStockGroups(groups));
ipcMain.handle("update-stock-positions", (_event, code: string, positions: Position[]) => core.updateStockPositions(code, positions));
ipcMain.handle("fetch-kline", (_event, code: string, scale: KLineScale, force?: boolean) => core.fetchKLine(code, scale, force));
ipcMain.handle("get-stock-journal", (_event, code: string) => core.getStockJournal(code));
ipcMain.handle("start-stock-journal", (_event, code: string, followedAt: string) => core.startStockJournal(code, followedAt));
ipcMain.handle("save-stock-journal-note", (_event, code: string, note: Pick<StockJournalNote, "id" | "date" | "content">) => core.saveStockJournalNote(code, note));
ipcMain.handle("archive-daily-kline", (_event, code: string, points: KLinePoint[]) => core.archiveDailyKLine(code, points));
ipcMain.handle("fetch-minute-data", (_event, code: string) => core.fetchMinuteData(code));
ipcMain.handle("fetch-stock-news", (_event, code: string, page: number, keyword?: string) => core.fetchStockNews(code, page, keyword));
ipcMain.handle("fetch-stock-news-article", (_event, url: string) => core.fetchStockNewsArticle(url));
ipcMain.handle("fetch-stock-comments", (_event, code: string, page: number) => core.fetchStockComments(code, page));
ipcMain.handle("list-notes", () => readNotesTree());
ipcMain.handle("read-note", (_event, notePath: string) => {
  const absolutePath = resolveNotePath(notePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error("Note does not exist.");
  }
  return { path: normalizeRelativeNotePath(notePath), content: fs.readFileSync(absolutePath, "utf8") };
});
ipcMain.handle("save-note", (_event, notePath: string, content: string) => {
  const absolutePath = resolveNotePath(notePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error("Note does not exist.");
  }
  fs.writeFileSync(absolutePath, content, "utf8");
});
ipcMain.handle("create-note", (_event, parentPath: string, type: "file" | "directory", name: string) => {
  const parent = resolveNotePath(parentPath);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error("Parent folder does not exist.");
  }
  const target = path.join(parent, sanitizeNoteName(name, type));
  if (fs.existsSync(target)) throw new Error("A note with that name already exists.");
  if (type === "directory") {
    fs.mkdirSync(target);
  } else {
    fs.writeFileSync(target, "", "utf8");
  }
  return readNotesTree();
});
ipcMain.handle("rename-note", (_event, notePath: string, name: string) => {
  const current = resolveNotePath(notePath);
  if (!fs.existsSync(current)) throw new Error("Note does not exist.");
  const stats = fs.statSync(current);
  const target = path.join(path.dirname(current), sanitizeNoteName(name, stats.isDirectory() ? "directory" : "file"));
  if (fs.existsSync(target)) throw new Error("A note with that name already exists.");
  fs.renameSync(current, target);
  return readNotesTree();
});
ipcMain.handle("delete-note", async (_event, notePath: string) => {
  const absolutePath = resolveNotePath(notePath);
  if (!fs.existsSync(absolutePath)) return readNotesTree();
  await shell.trashItem(absolutePath);
  return readNotesTree();
});
ipcMain.handle("open-notes-dir", () => {
  void shell.openPath(ensureNotesRoot());
});
ipcMain.handle("resize-window", (event, width: number, height: number) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;

  const nextWidth = Math.round(width);
  const nextHeight = Math.round(height);
  const [currentWidth, currentHeight] = win.getSize();
  if (currentWidth === nextWidth && currentHeight === nextHeight) return;

  const wasResizable = win.isResizable();
  if (!wasResizable) win.setResizable(true);
  win.setBounds({ width: nextWidth, height: nextHeight }, false);
  if (!wasResizable) win.setResizable(false);
});
ipcMain.handle("start-drag", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.moveTop();
});
ipcMain.handle("open-kline-window", (_event, code: string, name: string) => createKLineWindow(code, name));
ipcMain.handle("toggle-motto-window", () => {
  if (mottoWindow && !mottoWindow.isDestroyed()) {
    mottoWindow.close();
    mottoWindow = undefined;
    return;
  }
  createMottoWindow();
});
ipcMain.handle("toggle-float-window", () => {
  if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.close();
    floatWindow = undefined;
    return;
  }
  createFloatWindow();
});
ipcMain.handle("toggle-watch-float-window", () => {
  if (watchFloatWindow && !watchFloatWindow.isDestroyed()) {
    watchFloatWindow.close();
    watchFloatWindow = undefined;
    return;
  }
  createWatchFloatWindow();
});
ipcMain.handle("window-minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});
ipcMain.handle("window-toggle-maximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
});
ipcMain.handle("window-close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win === mainWindow) {
    closeMainWindowByPreference(win);
    return;
  }
  win.close();
});
