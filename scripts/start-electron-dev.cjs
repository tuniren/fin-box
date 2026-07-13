const { spawn } = require("node:child_process");
const electronPath = require("electron");

const env = {
  ...process.env,
  VITE_DEV_SERVER_URL: "http://127.0.0.1:5173"
};

delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ["."], {
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
