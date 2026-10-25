/**
 * MCP handshake test for the bundled bridge server. No Synthesizer V needed:
 * it proves the vendored server starts, speaks JSON-RPC over stdio, and exposes
 * the six expected tools.
 *
 * Run with:  node test/mcp-handshake.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";

const serverPath = path.join(import.meta.dirname, "..", "server", "server.bundle.mjs");
const strict = process.argv.includes("--strict");
const child = spawn(process.execPath, [serverPath], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
  env: { ...process.env, SYNTHV_AGENT_BRIDGE_DIR: process.env.SYNTHV_AGENT_BRIDGE_DIR ?? "" },
});

let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr = `${stderr}${chunk}`.slice(-4000);
});

/** @type {Map<number, (message: any) => void>} */
const pending = new Map();
let nextId = 1;
const reader = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
reader.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  const entry = pending.get(message.id);
  if (entry) {
    pending.delete(message.id);
    entry(message);
  }
});

/** @returns {Promise<any>} */
function request(method, params, timeoutMs = 15_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout after ${timeoutMs}ms calling ${method}`));
    }, timeoutMs);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

let failures = 0;
function check(condition, label, detail = "") {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "dsh-synthv-studio-selftest", version: "0.1.0" },
  });
  check(init.result?.serverInfo?.name === "synthv-agent-bridge", "server identifies itself", JSON.stringify(init.error));
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);

  const tools = await request("tools/list", {});
  const names = (tools.result?.tools ?? []).map((tool) => tool.name);
  const expected = ["sv_status", "sv_describe", "sv_query", "sv_command", "sv_ui", "sv_review"];
  check(expected.length === names.length, "server exposes six tools", names.join(", "));
  for (const name of expected) check(names.includes(name), `tool ${name} exposed`);

  const status = await request("tools/call", { name: "sv_status", arguments: { operation: "bridge" } });
  const text = status.result?.content?.find?.((block) => block.type === "text")?.text ?? "";
  check(typeof text === "string" && text.includes("connected"), "sv_status returns a bridge projection");
  check(status.result?.isError !== true, "sv_status call succeeds without SynthV");

  const parsed = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })();
  if (parsed) {
    console.log(`      connected=${parsed.connected} ipcDirectory=${parsed.ipcDirectory}`);
    if (strict) check(parsed.connected === true, "--strict requires a running bridge");
  }
} catch (error) {
  failures += 1;
  console.error(`FAIL  handshake threw: ${error instanceof Error ? error.message : String(error)}`);
  if (stderr) console.error(stderr);
} finally {
  reader.close();
  child.kill();
  // Give the child a moment to exit so this process does not linger on Windows.
  await new Promise((resolve) => setTimeout(resolve, 300));
}

console.log(`\nMCP handshake: ${failures === 0 ? "OK" : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
