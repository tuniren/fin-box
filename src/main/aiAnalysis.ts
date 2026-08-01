import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AiAnalysisConfig } from "../shared/types";

export type CodexProgress = {
  stream: "system" | "stdout" | "stderr";
  text: string;
};

export async function runCodexAnalysis(config: AiAnalysisConfig, prompt: string, cwd: string, onProgress?: (progress: CodexProgress) => void): Promise<string> {
  const commandParts = parseCommand(config.codex_command);
  if (!commandParts) throw new Error("Codex command is empty.");

  const [rawCommand, ...baseArgs] = commandParts;
  const command = resolveCommand(rawCommand);
  if (!command) throw new Error(codexNotFoundMessage(rawCommand));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "finbox-ai-"));
  const outputPath = path.join(tempDir, "analysis.md");
  const args = [
    ...baseArgs,
    "--ask-for-approval",
    "never",
    "exec",
    "--sandbox",
    "read-only",
    "--ignore-rules",
    "--ephemeral",
    "--skip-git-repo-check",
    "--output-last-message",
    outputPath,
    "-"
  ];
  onProgress?.({ stream: "system", text: `Resolved command: ${command}` });
  onProgress?.({ stream: "system", text: `Starting Codex: ${[command, ...args].join(" ")}` });

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      cleanupTempDir(tempDir);
      reject(new Error("AI analysis timed out."));
    }, config.timeout_ms);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      onProgress?.({ stream: "stdout", text: chunk });
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      onProgress?.({ stream: "stderr", text: chunk });
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanupTempDir(tempDir);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        cleanupTempDir(tempDir);
        reject(new Error(stderr.trim() || `Codex exited with code ${code}.`));
        return;
      }
      const content = readOutput(outputPath) || stdout.trim();
      onProgress?.({ stream: "system", text: readOutput(outputPath) ? "Codex final message file was written." : "Codex final message file is empty; using stdout." });
      cleanupTempDir(tempDir);
      if (!content) {
        reject(new Error("Codex returned empty output."));
        return;
      }
      resolve(content);
    });
    child.stdin.end(prompt, "utf8");
  });
}

function resolveCommand(command: string): string | undefined {
  if (path.isAbsolute(command) || command.includes("\\") || command.includes("/")) {
    return fs.existsSync(command) ? command : undefined;
  }

  for (const candidate of executableCandidates(command)) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return undefined;
}

function executableCandidates(command: string): string[] {
  const candidates: string[] = [];
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of pathEntries()) {
    for (const extension of extensions) {
      candidates.push(path.join(dir, command.endsWith(extension) ? command : `${command}${extension}`));
    }
  }
  if (command.toLowerCase() === "codex") candidates.push(...codexFallbackCandidates());
  return [...new Set(candidates)];
}

function pathEntries(): string[] {
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function codexFallbackCandidates(): string[] {
  if (process.platform !== "win32") return [];
  const userProfile = process.env.USERPROFILE;
  const appData = process.env.APPDATA;
  const localAppData = process.env.LOCALAPPDATA;
  const candidates: string[] = [];

  for (const extensionRoot of [
    userProfile && path.join(userProfile, ".vscode", "extensions"),
    userProfile && path.join(userProfile, ".cursor", "extensions"),
    userProfile && path.join(userProfile, ".windsurf", "extensions")
  ].filter((item): item is string => Boolean(item))) {
    candidates.push(...findCodexInExtensionRoot(extensionRoot));
  }

  for (const npmRoot of [
    appData && path.join(appData, "npm"),
    localAppData && path.join(localAppData, "npm")
  ].filter((item): item is string => Boolean(item))) {
    candidates.push(path.join(npmRoot, "codex.exe"), path.join(npmRoot, "codex.cmd"));
  }

  return candidates;
}

function findCodexInExtensionRoot(root: string): string[] {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith("openai.chatgpt"))
      .flatMap((entry) => [
        path.join(root, entry.name, "bin", "windows-x86_64", "codex.exe"),
        path.join(root, entry.name, "bin", "codex.exe")
      ]);
  } catch {
    return [];
  }
}

function codexNotFoundMessage(command: string): string {
  return [
    `Cannot find Codex executable: ${command}.`,
    "If Codex is installed but FinBox was launched outside a terminal, set the full codex.exe path in Settings > AI Analysis."
  ].join(" ");
}

function readOutput(outputPath: string): string {
  try {
    return fs.readFileSync(outputPath, "utf8").trim();
  } catch {
    return "";
  }
}

function cleanupTempDir(tempDir: string): void {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Temporary analysis output is best-effort cleanup only.
  }
}

function parseCommand(command: string): string[] | undefined {
  const parts: string[] = [];
  let current = "";
  let quote: "\"" | "'" | undefined;
  for (const char of command.trim()) {
    if ((char === "\"" || char === "'") && !quote) {
      quote = char;
      continue;
    }
    if (quote && char === quote) {
      quote = undefined;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts.length ? parts : undefined;
}
