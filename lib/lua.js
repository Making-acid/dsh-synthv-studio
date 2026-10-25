/**
 * Install / verify / remove the in-app Lua half of the bridge.
 *
 * The bundled `.lua` files are build templates: their build-id markers must be
 * replaced with `sv3-lua-<version>-<sha256(template)>` (and the sidebar
 * equivalent) exactly the way the upstream installer prepares them. The Node
 * server rejects a mismatched executor build id, so this substitution is what
 * makes writes legal.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  BUNDLED_SCRIPTS,
  SCRIPT_FOLDER_NAME,
  SCRIPT_MARKER_NAME,
  installedScriptsDirectory,
  ipcDirectory,
  scriptsDirectory,
  SERVER_BUNDLE,
} from "./paths.js";
import { exists, isDirectory, nowIso, readTextSafe } from "./util.js";

/** Files installed into `<SynthV scripts>/SynthV Agent Bridge/`. */
export const SCRIPT_FILES = [
  "SynthVAgentBridge.lua",
  "StopSynthVAgentBridge.lua",
  "SynthVAgentSidebar.lua",
];

const EXECUTOR_MARKER = "__SYNTHV_AGENT_EXECUTOR_BUILD_ID__";
const SIDEBAR_MARKER = "__SYNTHV_AGENT_SIDEBAR_BUILD_ID__";

/** @returns {string} sha256 hex of a UTF-8 string. */
function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** @returns {string} build id embedded in a prepared script. */
function buildIdInSource(source) {
  const match = /\bsv3-(?:lua|sidebar)-[0-9A-Za-z.\-]+-[0-9a-f]{64}\b/.exec(source);
  return match ? match[0] : "";
}

/**
 * Prepare the executor/sidebar sources by injecting their content-derived
 * build ids, and report what the bundled server expects.
 * @returns {{
 *   ok: boolean,
 *   version: string,
 *   executorBuildId: string,
 *   sidebarBuildId: string,
 *   expectedExecutorBuildId: string,
 *   expectedSidebarBuildId: string,
 *   files: { name: string, source: string, sha256: string }[],
 *   warnings: string[],
 * }}
 */
export function prepareBridgeSources() {
  const warnings = [];
  const bridgeTemplate = readTextSafe(path.join(BUNDLED_SCRIPTS, "SynthVAgentBridge.lua"));
  const sidebarTemplate = readTextSafe(path.join(BUNDLED_SCRIPTS, "SynthVAgentSidebar.lua"));
  if (!bridgeTemplate || !sidebarTemplate) {
    return {
      ok: false,
      version: "unknown",
      executorBuildId: "",
      sidebarBuildId: "",
      expectedExecutorBuildId: "",
      expectedSidebarBuildId: "",
      files: [],
      warnings: ["插件包缺少内置 Lua 脚本模板。"],
    };
  }

  const version =
    /\bBRIDGE_VERSION\s*=\s*"([^"]+)"/.exec(bridgeTemplate)?.[1] ??
    /\bSIDEBAR_VERSION\s*=\s*"([^"]+)"/.exec(sidebarTemplate)?.[1] ??
    "0.3.1";
  const executorBuildId = `sv3-lua-${version}-${sha256(bridgeTemplate)}`;
  const sidebarBuildId = `sv3-sidebar-${version}-${sha256(sidebarTemplate)}`;

  if (!bridgeTemplate.includes(EXECUTOR_MARKER)) {
    warnings.push("执行器模板缺少 build-id 占位符（可能已被替换过的成品）。");
  }
  if (!sidebarTemplate.includes(SIDEBAR_MARKER)) {
    warnings.push("侧边栏模板缺少 build-id 占位符（可能已被替换过的成品）。");
  }

  const preparedBridge = bridgeTemplate.replace(EXECUTOR_MARKER, executorBuildId);
  const preparedSidebar = sidebarTemplate.replace(SIDEBAR_MARKER, sidebarBuildId);

  // The Node half carries the ids it will accept; mismatch means the bundled
  // pair came from different builds and every write would be rejected.
  const serverText = readTextSafe(SERVER_BUNDLE) ?? "";
  const expectedExecutorBuildId = /\bsv3-lua-0\.3\.1-[0-9a-f]{64}\b/.exec(serverText)?.[0] ?? "";
  const expectedSidebarBuildId =
    /\bsv3-sidebar-0\.3\.1-[0-9a-f]{64}\b/.exec(serverText)?.[0] ?? "";
  if (expectedExecutorBuildId && expectedExecutorBuildId !== executorBuildId) {
    warnings.push(
      `执行器 build-id 与内置服务端不一致：计算 ${executorBuildId}，期望 ${expectedExecutorBuildId}。`,
    );
  }

  const files = [
    { name: "SynthVAgentBridge.lua", source: preparedBridge, sha256: sha256(preparedBridge) },
    { name: "StopSynthVAgentBridge.lua", source: readTextSafe(path.join(BUNDLED_SCRIPTS, "StopSynthVAgentBridge.lua")) ?? "", sha256: "" },
    { name: "SynthVAgentSidebar.lua", source: preparedSidebar, sha256: sha256(preparedSidebar) },
  ];
  for (const file of files) {
    if (file.sha256 === "" && file.source) file.sha256 = sha256(file.source);
  }
  for (const file of files) {
    if (!file.source) warnings.push(`插件包缺少内置脚本：${file.name}`);
  }

  return {
    ok: warnings.length === 0,
    version,
    executorBuildId,
    sidebarBuildId,
    executorSourceFingerprint: sha256(bridgeTemplate),
    sidebarSourceFingerprint: sha256(sidebarTemplate),
    expectedExecutorBuildId,
    expectedSidebarBuildId,
    files,
    warnings,
  };
}

/** @returns {{ name: string, bytes: number, sha256: string, present: boolean }[]} */
export function bundledScriptInventory() {
  const prepared = prepareBridgeSources();
  return SCRIPT_FILES.map((name) => {
    const entry = prepared.files.find((file) => file.name === name);
    return {
      name,
      present: Boolean(entry?.source),
      bytes: entry?.source ? Buffer.byteLength(entry.source, "utf8") : 0,
      sha256: entry?.sha256 ?? "",
    };
  });
}

/**
 * Copy prepared scripts into SynthV's scripts folder, replacing an older bridge
 * copy in place. Never touches other user scripts.
 * @param {{ force?: boolean }} [_options]
 * @returns {{
 *   ok: boolean,
 *   directory: string,
 *   actions: string[],
 *   needsRescan: boolean,
 *   reloadRequired: boolean,
 *   build: { version: string, executorBuildId: string, sidebarBuildId: string },
 *   warnings: string[],
 * }}
 */
export function installBridgeScripts(_options = {}) {
  const targetDirectory = installedScriptsDirectory();
  const prepared = prepareBridgeSources();
  const build = {
    version: prepared.version,
    executorBuildId: prepared.executorBuildId,
    sidebarBuildId: prepared.sidebarBuildId,
  };
  const actions = [];
  if (!isDirectory(scriptsDirectory())) {
    return {
      ok: false,
      directory: targetDirectory,
      actions: [`SynthV 脚本目录不存在：${scriptsDirectory()}（请先启动一次 SynthV Studio 2 Pro）`],
      needsRescan: false,
      reloadRequired: false,
      build,
      warnings: prepared.warnings,
    };
  }
  if (!prepared.ok && prepared.files.some((file) => !file.source)) {
    return {
      ok: false,
      directory: targetDirectory,
      actions: ["插件包内置脚本不完整，无法安装。"],
      needsRescan: false,
      reloadRequired: false,
      build,
      warnings: prepared.warnings,
    };
  }

  fs.mkdirSync(targetDirectory, { recursive: true });
  let changed = false;
  for (const file of prepared.files) {
    const target = path.join(targetDirectory, file.name);
    const existing = readTextSafe(target);
    const existingHash = existing ? sha256(existing) : "";
    if (existingHash === file.sha256) {
      actions.push(`${file.name}: 已是最新`);
      continue;
    }
    fs.writeFileSync(target, file.source, "utf8");
    changed = true;
    actions.push(`${file.name}: ${existingHash ? "已更新" : "已安装"}`);
  }

  const marker = {
    owner: "dsh-synthv-studio",
    installedAt: nowIso(),
    build,
    files: prepared.files.map((file) => ({
      name: file.name,
      sha256: file.sha256,
      bytes: Buffer.byteLength(file.source, "utf8"),
    })),
  };
  fs.writeFileSync(
    path.join(targetDirectory, SCRIPT_MARKER_NAME),
    JSON.stringify(marker, null, 2),
    "utf8",
  );

  // The executor resolves the file to hot-reload from this manifest (schema 2)
  // before falling back to debug.getinfo, which is absent in the SynthV Lua
  // sandbox. Without it a repair of a running stale bridge needs a manual
  // stop/start instead of a transparent reload.
  const manifestWritten = writeInstallManifest({
    scriptFile: path.join(targetDirectory, "SynthVAgentBridge.lua"),
    build,
    prepared,
  });

  return {
    ok: true,
    directory: targetDirectory,
    actions,
    needsRescan: !exists(path.join(targetDirectory, "SynthVAgentBridge.lua")),
    reloadRequired: changed,
    manifestWritten,
    build,
    warnings: prepared.warnings,
  };
}

/**
 * Write `<ipc>/synthv-agent-bridge.install.json` (schemaVersion 2) that the
 * Lua executor uses to locate itself for hot reload.
 * @param {{ scriptFile: string, build: any, prepared: any }} options
 * @returns {boolean}
 */
export function writeInstallManifest({ scriptFile, build, prepared }) {
  try {
    const directory = ipcDirectory();
    fs.mkdirSync(directory, { recursive: true });
    const manifest = {
      schemaVersion: 2,
      scriptFile,
      packageVersion: build.version,
      protocolVersion: 3,
      executorBuildId: build.executorBuildId,
      sidebarBuildId: build.sidebarBuildId,
      executorSourceFingerprint: prepared.executorSourceFingerprint,
      sidebarSourceFingerprint: prepared.sidebarSourceFingerprint,
      installedFiles: Object.fromEntries(
        prepared.files.map((file) => [file.name, file.sha256]),
      ),
      writtenAtEpochMs: Date.now(),
    };
    fs.writeFileSync(
      path.join(directory, "synthv-agent-bridge.install.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove the installed bridge folder when (and only when) this plugin owns it.
 * @returns {{ ok: boolean, removed: boolean, directory: string, reason: string }}
 */
export function uninstallBridgeScripts() {
  const targetDirectory = installedScriptsDirectory();
  const markerPath = path.join(targetDirectory, SCRIPT_MARKER_NAME);
  if (!isDirectory(targetDirectory)) {
    return { ok: true, removed: false, directory: targetDirectory, reason: "未安装" };
  }
  if (!exists(markerPath)) {
    return {
      ok: false,
      removed: false,
      directory: targetDirectory,
      reason: "目录存在但没有本插件的安装标记，出于安全考虑不删除",
    };
  }
  fs.rmSync(targetDirectory, { recursive: true, force: true });
  return {
    ok: true,
    removed: true,
    directory: targetDirectory,
    reason: `已删除 ${SCRIPT_FOLDER_NAME}`,
  };
}

/** @returns {string} the prepared executor build id (diagnostics). */
export function preparedExecutorBuildId() {
  const prepared = prepareBridgeSources();
  return buildIdInSource(prepared.files.find((file) => file.name === "SynthVAgentBridge.lua")?.source ?? "") || prepared.executorBuildId;
}
