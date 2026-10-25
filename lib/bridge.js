/**
 * Bridge lifecycle helpers: script installation, SynthV process control, IPC
 * stop/reload signals and the end-to-end readiness check.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findInstallation, ipcDirectory } from "./paths.js";
import {
  bridgeReloadFile,
  bridgeStatusFile,
  bridgeStopFile,
  inspectInstalledScripts,
  readBridgeStatus,
} from "./detect.js";
import { installBridgeScripts, prepareBridgeSources, uninstallBridgeScripts } from "./lua.js";
import { exists, isDirectory } from "./util.js";

const execFileAsync = promisify(execFile);

/** @returns {Promise<boolean>} whether synthv-studio.exe is running. */
export async function isSynthVRunning() {
  if (process.platform !== "win32") return false;
  try {
    const { stdout } = await execFileAsync(
      "tasklist.exe",
      ["/FI", "IMAGENAME eq synthv-studio.exe", "/FO", "CSV", "/NH"],
      { windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 },
    );
    return /synthv-studio\.exe/i.test(stdout);
  } catch {
    return false;
  }
}

let lastLaunchAt = 0;

/**
 * Start Synthesizer V Studio 2 Pro detached (does not steal focus beyond the
 * normal window creation of the app itself).
 * @returns {Promise<{ ok: boolean, message: string, alreadyRunning: boolean }>}
 */
export async function launchSynthV() {
  if (await isSynthVRunning()) {
    return { ok: true, alreadyRunning: true, message: "Synthesizer V Studio 2 Pro 已在运行。" };
  }
  const installation = findInstallation();
  if (!installation) {
    return {
      ok: false,
      alreadyRunning: false,
      message: "未找到 synthv-studio.exe，无法启动 SynthV。请先确认安装路径。",
    };
  }
  if (Date.now() - lastLaunchAt < 8000) {
    return {
      ok: true,
      alreadyRunning: true,
      message: "刚刚已请求启动 SynthV，正在等待窗口出现。",
    };
  }
  lastLaunchAt = Date.now();
  const { spawn } = await import("node:child_process");
  const child = spawn(installation.executable, [], {
    detached: true,
    stdio: "ignore",
    cwd: installation.directory,
    windowsHide: false,
  });
  child.unref();
  return { ok: true, alreadyRunning: false, message: `已启动 ${installation.executable}` };
}

/**
 * Ask the running bridge to shut down on its next poll.
 * @returns {{ ok: boolean, message: string }}
 */
export function requestBridgeStop() {
  const status = readBridgeStatus();
  if (!status.present) {
    return { ok: false, message: "没有检测到正在运行的 Bridge（无 status 心跳文件）。" };
  }
  try {
    fs.writeFileSync(bridgeStopFile(), "stop\n", "utf8");
    return { ok: true, message: `已写入停止信号：${bridgeStopFile()}` };
  } catch (error) {
    return { ok: false, message: `写入停止信号失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Ask a running bridge to hot-reload its Lua executor. */
export function requestBridgeReload() {
  try {
    fs.writeFileSync(bridgeReloadFile(), "reload\n", "utf8");
    return { ok: true, message: `已写入重载信号：${bridgeReloadFile()}` };
  } catch (error) {
    return { ok: false, message: `写入重载信号失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Ensure the scripts exist, hot-reload a running stale bridge, then wait
 * briefly for a fresh heartbeat whose build id matches the bundled server.
 * @param {{ waitSeconds?: number }} [options]
 * @returns {Promise<Record<string, any>>}
 */
export async function ensureBridgeReady(options = {}) {
  const waitSeconds = Math.max(0, Math.min(180, Number(options.waitSeconds ?? 0)));
  const prepared = prepareBridgeSources();
  const install = installBridgeScripts();
  const synthvRunning = await isSynthVRunning();
  let status = readBridgeStatus();
  let reloaded = false;

  // A bridge started from unsubstituted templates reports a placeholder build
  // id, which makes every write illegal. The executor supports hot reload, so
  // fix it without asking the user to restart the script.
  if (
    status.present &&
    status.fresh &&
    prepared.executorBuildId &&
    status.executorBuildId !== prepared.executorBuildId
  ) {
    if (requestBridgeReload().ok) {
      reloaded = true;
      const deadline = Date.now() + Math.max(15, waitSeconds) * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        status = readBridgeStatus();
        if (status.present && status.fresh && status.executorBuildId === prepared.executorBuildId) {
          break;
        }
      }
    }
  }

  const startedAt = Date.now();
  while (waitSeconds > 0 && Date.now() - startedAt < waitSeconds * 1000) {
    if (status.present && status.fresh) break;
    await new Promise((resolve) => setTimeout(resolve, 700));
    status = readBridgeStatus();
  }
  const scripts = inspectInstalledScripts();
  const ready = status.present && status.fresh;
  const buildMatch = Boolean(
    status.executorBuildId && status.executorBuildId === prepared.executorBuildId,
  );
  return {
    ok: install.ok,
    synthvRunning,
    install,
    scripts,
    status,
    reloaded,
    ready,
    buildMatch,
    build: {
      executorBuildId: prepared.executorBuildId,
      runningExecutorBuildId: status.executorBuildId,
      expectedExecutorBuildId: prepared.expectedExecutorBuildId,
    },
    ipcDirectory: ipcDirectory(),
    statusFile: bridgeStatusFile(),
    stopFile: bridgeStopFile(),
    steps: buildStartSteps({ synthvRunning, ready, installOk: install.ok, buildMatch }),
  };
}

/**
 * Human/agent actionable start instructions.
 * @param {{ synthvRunning: boolean, ready: boolean, installOk: boolean, buildMatch?: boolean }} state
 * @returns {string[]}
 */
export function buildStartSteps(state) {
  const steps = [];
  if (!state.installOk) {
    steps.push("先运行 synthv_bridge { action: 'install' } 安装桥脚本（需要 SynthV 已经启动过一次以创建脚本目录）。");
  }
  if (!state.synthvRunning) {
    steps.push("运行 synthv_bridge { action: 'launch' } 启动 Synthesizer V Studio 2 Pro（或手动打开）。");
  }
  if (!state.ready) {
    steps.push("在 SynthV 菜单中点击：脚本 → 重新扫描（首次安装后需要一次）。");
    steps.push("再点击：脚本 → SynthV Agent Bridge → Start SynthV Agent Bridge，保持该脚本运行。");
    steps.push("运行 synthv_bridge { action: 'ensure', waitSeconds: 30 } 验证连接。");
  } else if (state.buildMatch === false) {
    steps.push("已连接的桥来自旧版脚本，运行 synthv_bridge { action: 'reload' } 热重载；若仍不匹配，停止并重新启动桥脚本。");
  }
  return steps;
}

/** @returns {Record<string, any>} local (filesystem-only) bridge status. */
export function bridgeStatusSnapshot() {
  const scripts = inspectInstalledScripts();
  const status = readBridgeStatus();
  return {
    ipcDirectory: ipcDirectory(),
    ipcDirectoryPresent: isDirectory(ipcDirectory()),
    statusFile: bridgeStatusFile(),
    statusFilePresent: exists(bridgeStatusFile()),
    scripts,
    status,
    running: status.present && status.fresh,
  };
}

/** @returns {{ ok: boolean, removed: boolean, directory: string, reason: string }} */
export function removeBridgeScripts() {
  return uninstallBridgeScripts();
}

/** Re-exported for tools that only need the status file location. */
export { bridgeStatusFile };

/** @returns {string} absolute path of the bridge executable for diagnostics. */
export function bridgeServerPathHint() {
  const installation = findInstallation();
  return installation ? path.join(installation.directory, "synthv-studio.exe") : "";
}
