/**
 * Local machine discovery for Synthesizer V Studio 2 Pro and its ecosystem.
 * Pure, read-only filesystem/registry inspection — never launches anything.
 */
import fs from "node:fs";
import path from "node:path";
import {
  appDataDirectory,
  findInstallation,
  ipcDirectory,
  licenseSessionFile,
  renderCacheDirectory,
  vst3Directory,
  voiceDatabaseDirectory,
  INSTALL_DIR_CANDIDATES,
  installedScriptsDirectory,
  scriptsDirectory,
} from "./paths.js";
import {
  boundedDirSize,
  exists,
  fileSizeSafe,
  isDirectory,
  querySynthVUninstallEntry,
  readJsonSafe,
  statSafe,
} from "./util.js";
import { detectDaws, scanSynthVVst3Bundles } from "./daw.js";

/** @returns {string} IPC status file path used by the Lua bridge heartbeat. */
export function bridgeStatusFile() {
  return path.join(ipcDirectory(), "synthv-agent-bridge.status.json");
}

/** @returns {string} IPC stop file path handled by the Stop script/bridge. */
export function bridgeStopFile() {
  return path.join(ipcDirectory(), "synthv-agent-bridge.stop");
}

/** @returns {string} IPC reload file path handled by the bridge. */
export function bridgeReloadFile() {
  return path.join(ipcDirectory(), "synthv-agent-bridge.reload");
}

/**
 * Read the heartbeats written by the running Lua executor.
 * @returns {{ present: boolean, fresh: boolean, ageSeconds: number | null, bridgeVersion: string | null, sessionId: string | null, raw: any }}
 */
export function readBridgeStatus() {
  const file = bridgeStatusFile();
  const info = statSafe(file);
  const raw = readJsonSafe(file);
  if (!info || !raw) {
    return {
      present: false,
      fresh: false,
      ageSeconds: null,
      bridgeVersion: null,
      executorBuildId: null,
      sessionId: null,
      raw: null,
    };
  }
  const ageSeconds = Math.max(0, Math.round((Date.now() - info.mtimeMs) / 1000));
  const rawSession = raw.sessionId ?? raw.session ?? raw.sessionUuid ?? null;
  return {
    present: true,
    fresh: ageSeconds <= 15,
    ageSeconds,
    bridgeVersion:
      raw.bridgeVersion ?? raw.version ?? raw.buildVersion ?? raw.builderVersion ?? null,
    executorBuildId: typeof raw.executorBuildId === "string" ? raw.executorBuildId : null,
    sessionId: typeof rawSession === "string" ? rawSession : null,
    raw,
  };
}

/**
 * @returns {{ installed: boolean, directory: string, files: string[], version: string | null, marker: any }}
 */
export function inspectInstalledScripts() {
  const directory = installedScriptsDirectory();
  if (!isDirectory(directory)) {
    return { installed: false, directory, files: [], version: null, marker: null };
  }
  let files = [];
  try {
    files = fs
      .readdirSync(directory)
      .filter((name) => name.endsWith(".lua") || name.endsWith(".js"));
  } catch {
    files = [];
  }
  const marker = readJsonSafe(path.join(directory, ".dsh-synthv-studio.json"));
  const bridgeFile = path.join(directory, "SynthVAgentBridge.lua");
  let version = null;
  const text = exists(bridgeFile) ? fs.readFileSync(bridgeFile, "utf8") : "";
  const match = /BRIDGE_VERSION\s*=\s*"([^"]+)"/.exec(text);
  if (match) version = match[1];
  return { installed: files.length > 0, directory, files, version, marker };
}

/**
 * Full machine scan used by the `synthv_detect` tool.
 * @param {{ refresh?: boolean }} [options]
 * @returns {Promise<Record<string, any>>}
 */
export async function detectSynthV(options = {}) {
  const installation = findInstallation();
  const uninstall = installation ? await querySynthVUninstallEntry() : null;
  const appData = appDataDirectory();

  const licenseFile = licenseSessionFile();
  const license = {
    sessionPresent: exists(licenseFile),
    sessionBytes: fileSizeSafe(licenseFile),
    licenseDirectory: path.dirname(licenseFile),
  };

  const databases = voiceDatabaseDirectory();
  const cache = renderCacheDirectory();
  let voiceDatabase = { directory: databases, present: false, entries: 0, bytes: 0, approximate: false };
  if (isDirectory(databases)) {
    let entries = 0;
    try {
      entries = fs.readdirSync(databases).length;
    } catch {
      entries = 0;
    }
    const size = boundedDirSize(databases, { maxFiles: 2500, budgetMs: 500 });
    voiceDatabase = {
      directory: databases,
      present: true,
      entries,
      bytes: size.bytes,
      approximate: !size.complete,
    };
  }
  let renderCache = { directory: cache, present: false, voiceCount: 0, bytes: 0, approximate: false };
  if (isDirectory(cache)) {
    let voiceCount = 0;
    try {
      voiceCount = fs.readdirSync(cache, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
    } catch {
      voiceCount = 0;
    }
    const size = boundedDirSize(cache, { maxFiles: 2500, budgetMs: 500 });
    renderCache = {
      directory: cache,
      present: true,
      voiceCount,
      bytes: size.bytes,
      approximate: !size.complete,
    };
  }

  const plugins = scanSynthVVst3Bundles(vst3Directory());
  const daws = detectDaws();
  const status = readBridgeStatus();
  const scripts = inspectInstalledScripts();

  const issues = [];
  const nextSteps = [];
  if (!installation) {
    issues.push("未在本机找到 Synthesizer V Studio 2 Pro 安装目录。");
    nextSteps.push("安装 Synthesizer V Studio 2 Pro 后重新运行 synthv_detect。");
  }
  if (installation && !license.sessionPresent) {
    issues.push("未检测到 Synthesizer V 授权会话文件，首次使用可能需要在 SynthV 内登录/激活。");
  }
  if (plugins.bundles.length === 0) {
    issues.push("未在标准 VST3 目录找到 Synthesizer V 插件，DAW 集成将不可用。");
  }
  if (!scripts.installed) {
    nextSteps.push("运行 synthv_bridge { action: 'install' } 把常驻桥脚本安装到 SynthV 的 scripts 目录。");
  } else if (!status.present || !status.fresh) {
    nextSteps.push(
      "在 SynthV 中依次点击：脚本 → SynthV Agent Bridge → Start SynthV Agent Bridge，然后运行 synthv_bridge { action: 'ensure' } 验证连接。",
    );
  }
  if (daws.length === 0) {
    nextSteps.push("未检测到 DAW；安装 REAPER/Zrythm/Cubase 等支持 VST3 的宿主后即可把 SynthV 作为音源使用。");
  }

  return {
    ok: Boolean(installation),
    scannedAt: new Date().toISOString(),
    platform: `${process.platform} ${process.arch}`,
    install: installation
      ? {
          found: true,
          directory: installation.directory,
          executable: installation.executable,
          version: uninstall?.version ?? "unknown",
          executableBytes: fileSizeSafe(installation.executable),
          candidatesChecked: INSTALL_DIR_CANDIDATES,
        }
      : { found: false, candidatesChecked: INSTALL_DIR_CANDIDATES },
    appData: {
      directory: appData,
      present: isDirectory(appData),
      scriptsDirectory: scriptsDirectory(),
      license,
      voiceDatabase,
      renderCache,
    },
    bridge: {
      ipcDirectory: ipcDirectory(),
      scripts,
      status,
      running: status.present && status.fresh,
    },
    plugins,
    daws,
    issues,
    nextSteps,
  };
}
