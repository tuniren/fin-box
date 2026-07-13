const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const electronPath = require("electron");

const env = {
  ...process.env,
  VITE_DEV_SERVER_URL: "http://127.0.0.1:5173"
};

delete env.ELECTRON_RUN_AS_NODE;

const devDataDir = path.join(os.tmpdir(), "fin-box-electron-dev");
const devCacheDir = path.join(devDataDir, "cache");

const child = spawn(electronPath, [
  ".",
  `--user-data-dir=${devDataDir}`,
  `--disk-cache-dir=${devCacheDir}`
], {
  env,
  stdio: "inherit",
  windowsHide: false
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
