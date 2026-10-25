/**
 * Minimal MCP (Model Context Protocol) stdio client for the bundled SynthV
 * Agent Bridge server. Newline-delimited JSON-RPC 2.0; no SDK dependency, so
 * the plugin stays installable without any profile-side package install.
 */
import { spawn } from "node:child_process";
import readline from "node:readline";

const DEFAULT_TIMEOUT_MS = 120_000;
const INIT_TIMEOUT_MS = 30_000;
const CLIENT_INFO = { name: "dsh-synthv-studio", version: "0.1.0" };

/** MCP tool names exposed by the bridge server. */
export const BRIDGE_TOOL_NAMES = [
  "sv_status",
  "sv_describe",
  "sv_query",
  "sv_command",
  "sv_ui",
  "sv_review",
];

/**
 * Long-lived bridge connection. The child server is spawned lazily on the
 * first call and respawned after an unexpected exit.
 */
export class BridgeMcpClient {
  /** @type {import('node:child_process').ChildProcess | null} */
  #child = null;
  /** @type {import('node:readline').Interface | null} */
  #reader = null;
  /** @type {Map<number, { resolve: (value: any) => void, reject: (error: Error) => void, timer: NodeJS.Timeout }>} */
  #pending = new Map();
  #nextId = 1;
  #starting = null;
  #stderrTail = "";
  #closed = false;

  /**
   * @param {{ serverPath: string, ipcDirectory: string, execPath?: string, env?: Record<string, string> }} options
   */
  constructor(options) {
    this.serverPath = options.serverPath;
    this.ipcDirectory = options.ipcDirectory;
    this.execPath = options.execPath ?? process.execPath;
    this.extraEnv = options.env ?? {};
  }

  /** @returns {boolean} whether a child process is currently running. */
  get running() {
    return this.#child !== null && this.#child.exitCode === null && !this.#closed;
  }

  /** @returns {string} bounded tail of the server's stderr for diagnostics. */
  get stderrTail() {
    return this.#stderrTail;
  }

  /**
   * Spawn and handshake if needed.
   * @returns {Promise<void>}
   */
  async ensureStarted() {
    if (this.running) return;
    if (this.#starting) return this.#starting;
    this.#starting = this.#start().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  async #start() {
    this.#closed = false;
    const env = {
      ...process.env,
      ...this.extraEnv,
      SYNTHV_AGENT_BRIDGE_DIR: this.ipcDirectory,
    };
    // The DSH Host runs inside Electron; ELECTRON_RUN_AS_NODE makes the same
    // executable behave as a plain Node runtime for the bundled server.
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
    else delete env.ELECTRON_RUN_AS_NODE;

    const child = spawn(this.execPath, [this.serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env,
    });
    this.#child = child;
    this.#reader = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.#reader.on("line", (line) => this.#onLine(line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.#stderrTail = `${this.#stderrTail}${chunk}`.slice(-4000);
    });
    child.on("exit", () => this.#onExit());
    child.stdin.on("error", () => {});

    const init = await this.#request(
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: CLIENT_INFO,
      },
      INIT_TIMEOUT_MS,
    );
    this.#notify("notifications/initialized", {});
    return init;
  }

  /**
   * Call one bridge tool and return its parsed JSON payload.
   * @param {string} name
   * @param {Record<string, unknown>} args
   * @param {number} [timeoutMs]
   * @returns {Promise<any>}
   */
  async callTool(name, args, timeoutMs = DEFAULT_TIMEOUT_MS) {
    await this.ensureStarted();
    const response = await this.#request("tools/call", { name, arguments: args }, timeoutMs);
    const result = response?.result;
    if (result === undefined) {
      const failure = response?.error;
      throw new Error(
        `SynthV bridge rejected ${name}: ${typeof failure === "string" ? failure : JSON.stringify(failure)}`,
      );
    }
    const text = result.content?.find?.((block) => block?.type === "text")?.text;
    const payload = typeof text === "string" ? tryParseJson(text) : undefined;
    if (result.isError) {
      const message =
        payload && typeof payload === "object" && payload.error
          ? JSON.stringify(payload.error)
          : typeof text === "string"
            ? text
            : "unknown bridge error";
      throw new Error(`${name} failed: ${message}`);
    }
    return payload !== undefined ? payload : text;
  }

  /** @returns {Promise<any>} bridge connection status projection. */
  async status() {
    return this.callTool("sv_status", { operation: "bridge" }, 45_000);
  }

  /** @returns {Promise<any>} bounded diagnostics. */
  async hostInfo() {
    return this.callTool("sv_status", { operation: "host" }, 45_000);
  }

  /** Terminate the child server and fail any in-flight request. */
  close() {
    this.#closed = true;
    const child = this.#child;
    this.#child = null;
    if (this.#reader) {
      this.#reader.close();
      this.#reader = null;
    }
    for (const [id, entry] of this.#pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("SynthV bridge client closed"));
      this.#pending.delete(id);
    }
    if (child) {
      try {
        child.stdin.end();
        child.kill();
      } catch {
        // Already gone.
      }
    }
  }

  #onLine(line) {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (typeof message !== "object" || message === null) return;
    if (typeof message.id !== "number") return;
    const entry = this.#pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.#pending.delete(message.id);
    entry.resolve(message);
  }

  #onExit() {
    this.#child = null;
    if (this.#reader) {
      this.#reader.close();
      this.#reader = null;
    }
    for (const [id, entry] of this.#pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("SynthV bridge server exited"));
      this.#pending.delete(id);
    }
  }

  #send(message) {
    const child = this.#child;
    if (!child || child.exitCode !== null || !child.stdin.writable) {
      throw new Error("SynthV bridge server is not running");
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #notify(method, params) {
    this.#send({ jsonrpc: "2.0", method, params });
  }

  #request(method, params, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`SynthV bridge timed out after ${timeoutMs} ms while calling ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.#send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }
}

/** @returns {any} parsed JSON or undefined for non-JSON text. */
function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
