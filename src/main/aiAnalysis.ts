import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AiAnalysisConfig, AiTerminalSessionInput, AiTerminalSessionLog, AiToolName, AiToolResult, JsonValue } from "../shared/types";

export type CodexProgress = {
  stream: "system" | "stdout" | "stderr";
  text: string;
};

export type CodexTerminalSession = {
  log: AiTerminalSessionLog;
  write: (input: string) => void;
  stop: () => void;
};

export type CodexTerminalToolRequest = {
  tool: AiToolName;
  params: Record<string, JsonValue>;
};

export type CodexTerminalOptions = {
  onUpdate: (log: AiTerminalSessionLog) => void;
  onToolCall?: (request: CodexTerminalToolRequest) => Promise<AiToolResult>;
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

export function startCodexTerminalSession(
  config: AiAnalysisConfig,
  input: AiTerminalSessionInput,
  cwd: string,
  options: CodexTerminalOptions
): CodexTerminalSession {
  const commandParts = parseCommand(config.codex_command);
  if (!commandParts) throw new Error("Codex command is empty.");

  const [rawCommand, ...baseArgs] = commandParts;
  const command = resolveCommand(rawCommand);
  if (!command) throw new Error(codexNotFoundMessage(rawCommand));

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
    "-"
  ];
  const log: AiTerminalSessionLog = {
    id: input.sessionId,
    code: input.code,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    status: "starting",
    command: [command, ...args].join(" "),
    output: `Resolved command: ${command}\nStarting Codex interactive session...\n`
  };

  const publish = () => {
    log.updatedAt = Date.now();
    log.output = trimProcessOutput(log.output);
    options.onUpdate(structuredClone(log));
  };
  let child: ChildProcessWithoutNullStreams | undefined;
  publish();

  const launchTurn = (prompt: string) => {
    if (child && !child.killed) throw new Error("AI terminal session is already running.");
    let closed = false;
    let turnOutput = "";
    child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    log.status = "running";
    log.error = undefined;
    log.exitCode = undefined;
    publish();

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      turnOutput += chunk;
      log.output += chunk;
      publish();
    });
    child.stderr.on("data", (chunk) => {
      turnOutput += chunk;
      log.output += chunk;
      publish();
    });
    child.on("error", (error) => {
      if (closed) return;
      closed = true;
      child = undefined;
      log.status = "error";
      log.error = error.message;
      log.output += `\nSession error: ${error.message}\n`;
      publish();
    });
    child.on("close", (code) => {
      if (closed) return;
      closed = true;
      child = undefined;
      log.exitCode = code ?? undefined;
      if (log.status === "stopped") {
        log.output += "\nSession stopped.\n";
      } else if (code === 0) {
        log.status = "exited";
        log.output += "\nCodex turn completed. You can send another line to continue this FinBox session.\n";
        const request = parseTerminalToolRequest(turnOutput);
        if (request && options.onToolCall) {
          log.status = "running";
          log.output += `\nFinBox tool request detected: ${request.tool}\n`;
          publish();
          void options.onToolCall(request)
            .then((result) => {
              log.output += `\nFinBox tool result:\n${JSON.stringify(result, null, 2)}\n`;
              publish();
              launchTurn(buildToolResultPrompt(input, request, result));
            })
            .catch((error) => {
              log.status = "error";
              log.error = error instanceof Error ? error.message : String(error);
              log.output += `\nFinBox tool call failed: ${log.error}\n`;
              publish();
            });
          return;
        }
      } else {
        log.status = "error";
        log.error = `Codex exited with code ${code}.`;
        log.output += `\nSession closed with code ${code}.\n`;
      }
      publish();
    });
    child.stdin.end(prompt, "utf8");
  };

  launchTurn(buildInitialTerminalPrompt(input));

  return {
    log,
    write: (value: string) => {
      if (log.status === "stopped") throw new Error("AI terminal session was stopped.");
      log.output += `\n> ${value.trim()}\n`;
      launchTurn(buildFollowUpTerminalPrompt(input, value));
    },
    stop: () => {
      log.status = "stopped";
      log.output += child && !child.killed ? "\nStopping session...\n" : "\nSession stopped.\n";
      publish();
      if (child && !child.killed) child.kill();
    }
  };
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

function buildInitialTerminalPrompt(input: AiTerminalSessionInput): string {
  return [
    "You are running inside FinBox AI analysis interactive mode.",
    "Use the provided initial user prompt as the first task.",
    "Do not request or assume access to general shell commands, arbitrary files, or unapproved private data.",
    terminalToolProtocolPrompt(),
    input.code ? `Primary symbol: ${input.code}` : "Primary symbol: not selected.",
    input.contextBundle ? `InitialContext JSON:\n${JSON.stringify(input.contextBundle, null, 2)}` : "InitialContext: none.",
    `User prompt:\n${input.prompt}`,
    ""
  ].join("\n\n");
}

function buildFollowUpTerminalPrompt(input: AiTerminalSessionInput, value: string): string {
  return [
    "You are continuing a FinBox AI analysis terminal session.",
    "Use only the same authorization boundary described here.",
    terminalToolProtocolPrompt(),
    input.code ? `Primary symbol: ${input.code}` : "Primary symbol: not selected.",
    input.contextBundle ? `InitialContext JSON:\n${JSON.stringify(input.contextBundle, null, 2)}` : "InitialContext: none.",
    `User input:\n${value}`,
    ""
  ].join("\n\n");
}

function buildToolResultPrompt(input: AiTerminalSessionInput, request: CodexTerminalToolRequest, result: AiToolResult): string {
  return [
    "You are continuing a FinBox AI analysis terminal session after a controlled FinBox tool call.",
    "Use the tool result below to answer the user's original task. If the tool result is a structured error, explain the limitation and do not invent missing data.",
    terminalToolProtocolPrompt(),
    input.code ? `Primary symbol: ${input.code}` : "Primary symbol: not selected.",
    `FinBox tool request:\n${JSON.stringify(request, null, 2)}`,
    `FinBox tool result:\n${JSON.stringify(result, null, 2)}`,
    ""
  ].join("\n\n");
}

function terminalToolProtocolPrompt(): string {
  return [
    "Controlled FinBox data tools are available only through this exact protocol:",
    "When more app data is required, end your response with one fenced block whose info string is finbox-tool.",
    "The block JSON must contain only: tool and params.",
    "Allowed tool names: get_quote, get_kline, get_minute, get_position_summary, get_trading_logic.",
    "Example:",
    "```finbox-tool",
    "{\"tool\":\"get_quote\",\"params\":{\"code\":\"sz002594\"}}",
    "```"
  ].join("\n");
}

function parseTerminalToolRequest(output: string): CodexTerminalToolRequest | undefined {
  const match = output.match(/```finbox-tool\s*([\s\S]*?)```/i);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as { tool?: unknown; params?: unknown };
    if (!isAiToolName(record.tool)) return undefined;
    if (!record.params || typeof record.params !== "object" || Array.isArray(record.params)) return undefined;
    return {
      tool: record.tool,
      params: sanitizeJsonRecord(record.params as Record<string, unknown>)
    };
  } catch {
    return undefined;
  }
}

function isAiToolName(value: unknown): value is AiToolName {
  return value === "get_quote"
    || value === "get_kline"
    || value === "get_minute"
    || value === "get_position_summary"
    || value === "get_trading_logic";
}

function sanitizeJsonRecord(value: Record<string, unknown>): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

function trimProcessOutput(output: string): string {
  const limit = 120000;
  return output.length > limit ? output.slice(output.length - limit) : output;
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
