/**
 * Filesystem helpers shared by the SynthV Studio tools. Deliberately
 * dependency-free: the plugin must load inside the DSH Host process without
 * pulling any extra package into the profile.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** @returns {boolean} whether the path exists (any type). */
export function exists(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} whether the path is a directory. */
export function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** @returns {boolean} whether the path is a regular file. */
export function isFile(target) {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

/** @returns {import('node:fs').Stats | null} stat or null when missing. */
export function statSafe(target) {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

/** @returns {number} file size in bytes, 0 when missing. */
export function fileSizeSafe(target) {
  const info = statSafe(target);
  return info && info.isFile() ? info.size : 0;
}

/** @returns {any | null} parsed JSON, or null when missing/unparsable. */
export function readJsonSafe(target) {
  try {
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    return null;
  }
}

/** @returns {string | null} UTF-8 text, or null when missing. */
export function readTextSafe(target) {
  try {
    return fs.readFileSync(target, "utf8");
  } catch {
    return null;
  }
}

/**
 * Sum file sizes under a directory with a hard budget so a huge cache cannot
 * stall a tool call. Approximation is reported by the caller.
 * @param {string} directory
 * @param {{ maxFiles?: number, budgetMs?: number }} [limits]
 * @returns {{ bytes: number, files: number, complete: boolean }}
 */
export function boundedDirSize(directory, limits = {}) {
  const maxFiles = limits.maxFiles ?? 4000;
  const budgetMs = limits.budgetMs ?? 750;
  const startedAt = Date.now();
  let bytes = 0;
  let files = 0;
  let complete = true;

  const stack = [directory];
  while (stack.length > 0) {
    if (files >= maxFiles || Date.now() - startedAt > budgetMs) {
      complete = false;
      break;
    }
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
      } else if (entry.isFile()) {
        files += 1;
        bytes += fileSizeSafe(child);
        if (files >= maxFiles) {
          complete = false;
          break;
        }
      }
    }
  }
  return { bytes, files, complete };
}

/** @returns {string} human readable byte size. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** @returns {number} file mtime in epoch ms, 0 when missing. */
export function mtimeSafe(target) {
  const info = statSafe(target);
  return info ? info.mtimeMs : 0;
}

/**
 * Run a Windows `reg.exe` query and return stdout, or "" on failure.
 * @param {string[]} args
 * @returns {Promise<string>}
 */
export async function runReg(args) {
  if (process.platform !== "win32") return "";
  try {
    const { stdout } = await execFileAsync("reg.exe", args, {
      windowsHide: true,
      timeout: 8000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return "";
  }
}

/**
 * Parse the Inno Setup uninstall entry for Synthesizer V Studio 2 Pro.
 * @returns {Promise<{ version: string, installLocation: string } | null>}
 */
export async function querySynthVUninstallEntry() {
  const keys = [
    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SynthesizerVStudio2Pro_is1",
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SynthesizerVStudio2Pro_is1",
    "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SynthesizerVStudio2Pro_is1",
  ];
  for (const key of keys) {
    const stdout = await runReg(["query", key]);
    if (!stdout) continue;
    const display = /DisplayName\s+REG_SZ\s+(.+)/i.exec(stdout)?.[1]?.trim() ?? "";
    const location = /InstallLocation\s+REG_SZ\s+(.+)/i.exec(stdout)?.[1]?.trim() ?? "";
    const version = /(\d+\.\d+\.\d+)/.exec(display)?.[1] ?? "unknown";
    return { version, installLocation: location.replace(/\\+$/, "") };
  }
  return null;
}

/** @returns {string} ISO-ish timestamp for tool output. */
export function nowIso() {
  return new Date().toISOString();
}
