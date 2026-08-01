const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const electronPath = require("electron");

async function main() {
  const { createServer } = await import("vite");
  const server = await createServer({
    server: { host: "127.0.0.1", port: 0, strictPort: false }
  });
  await server.listen();

  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("无法取得 Vite 开发服务器端口");
  }
  const devServerUrl = `http://127.0.0.1:${address.port}`;
  console.log(`[fin-box] Vite 开发服务器：${devServerUrl}`);

  const env = { ...process.env, VITE_DEV_SERVER_URL: devServerUrl };
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

  child.on("exit", async (code) => {
    await server.close();
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
