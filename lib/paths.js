/**
 * Location knowledge for this PC: the Synthesizer V Studio 2 Pro install,
 * its roaming data (scripts/license/voice database), the VST3 bundles and the
 * file-IPC directory shared by the in-app Lua bridge and the Host bridge
 * client.
 */
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exists, isDirectory } from "./util.js";

/** Absolute plugin package root (…/dsh-synthv-studio). */
export const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Bundled single-file MCP server that speaks the bridge file protocol. */
export const SERVER_BUNDLE = path.join(PACKAGE_ROOT, "server", "server.bundle.mjs");

/** Bundled SynthV Lua scripts (the in-app half of the bridge). */
export const BUNDLED_SCRIPTS = path.join(PACKAGE_ROOT, "synthv");

/** Name of the folder installed under SynthV's scripts directory. */
export const SCRIPT_FOLDER_NAME = "SynthV Agent Bridge";

/** Marker written next to installed scripts so uninstall only removes ours. */
export const SCRIPT_MARKER_NAME = ".dsh-synthv-studio.json";

const PROGRAM_FILES = process.env.ProgramFiles || "C:\\Program Files";
const PROGRAM_FILES_X86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
const COMMON_PROGRAM_FILES =
  process.env.CommonProgramFiles || "C:\\Program Files\\Common Files";
const ROAMING = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");

/** Candidate install directories for Synthesizer V Studio 2 Pro. */
export const INSTALL_DIR_CANDIDATES = [
  path.join(PROGRAM_FILES, "Synthesizer V Studio 2 Pro"),
  path.join(PROGRAM_FILES, "Synthesizer V Studio 2"),
  path.join(PROGRAM_FILES_X86, "Synthesizer V Studio 2 Pro"),
  path.join(PROGRAM_FILES_X86, "Synthesizer V Studio 2"),
];

/** Synthesizer V Studio 2 per-user data directory. */
export function appDataDirectory() {
  return path.join(ROAMING, "Dreamtonics", "Synthesizer V Studio 2");
}

/** Folder SynthV watches for user scripts. */
export function scriptsDirectory() {
  return path.join(appDataDirectory(), "scripts");
}

/** Folder the bundled Lua bridge is installed into. */
export function installedScriptsDirectory() {
  return path.join(scriptsDirectory(), SCRIPT_FOLDER_NAME);
}

/** License session file (presence only; contents are never read). */
export function licenseSessionFile() {
  return path.join(appDataDirectory(), "license", "session");
}

/** Voice database directory (LMDB stores; large). */
export function voiceDatabaseDirectory() {
  return path.join(appDataDirectory(), "databases");
}

/** Render cache directory (one folder per voice visited). */
export function renderCacheDirectory() {
  return path.join(appDataDirectory(), "cache");
}

/** Standard VST3 bundle folder. */
export function vst3Directory() {
  return path.join(COMMON_PROGRAM_FILES, "VST3");
}

/** Zrythm's scanned plugin caches (evidence a DAW already sees the plugin). */
export function zrythmPluginCaches() {
  return [
    path.join(LOCAL, "Zrythm.org", "Zrythm", "known_plugins.xml"),
    path.join(LOCAL, "zrythm", "cached_plugin_descriptors.yaml"),
  ];
}

/** Candidate DAW executables, relative to Program Files / Program Files (x86). */
export const DAW_CANDIDATES = [
  { id: "zrythm", name: "Zrythm", relative: ["Zrythm 2.0\\bin\\zrythm.exe", "Zrythm\\bin\\zrythm.exe"] },
  { id: "reaper", name: "REAPER", relative: ["REAPER (x64)\\reaper.exe", "REAPER\\reaper.exe"] },
  { id: "flstudio", name: "FL Studio", relative: ["Image-Line\\FL Studio 2024\\FL64.exe", "Image-Line\\FL Studio 21\\FL64.exe", "Image-Line\\FL Studio 20\\FL64.exe"] },
  { id: "ableton", name: "Ableton Live", relative: ["Ableton\\Live 12 Suite\\Program\\Ableton Live 12 Suite.exe", "Ableton\\Live 11 Suite\\Program\\Ableton Live 11 Suite.exe"] },
  { id: "cubase", name: "Steinberg Cubase", relative: ["Steinberg\\Cubase 14\\Cubase14.exe", "Steinberg\\Cubase 13\\Cubase13.exe", "Steinberg\\Cubase 12\\Cubase12.exe"] },
  { id: "nuendo", name: "Steinberg Nuendo", relative: ["Steinberg\\Nuendo 13\\Nuendo13.exe", "Steinberg\\Nuendo 12\\Nuendo12.exe"] },
  { id: "studioone", name: "Studio One", relative: ["PreSonus\\Studio One 6\\Studio One.exe", "PreSonus\\Studio One 5\\Studio One.exe"] },
  { id: "bitwig", name: "Bitwig Studio", relative: ["Bitwig Studio\\Bitwig Studio.exe"] },
  { id: "cakewalk", name: "Cakewalk by BandLab", relative: ["Cakewalk\\Cakewalk Core\\cakewalk.exe"] },
  { id: "lmms", name: "LMMS", relative: ["LMMS\\lmms.exe"] },
  { id: "ardour", name: "Ardour", relative: ["Ardour\\ardour.exe", "Ardour8\\bin\\ardour.exe", "Ardour7\\bin\\ardour.exe"] },
  { id: "mixcraft", name: "Mixcraft", relative: ["Acoustica Mixcraft 10\\mixcraft10.exe", "Acoustica Mixcraft 9\\mixcraft9.exe"] },
  { id: "reason", name: "Reason", relative: ["Propellerhead\\Reason\\reason.exe", "Reason Studios\\Reason 12\\Reason.exe"] },
  { id: "waveform", name: "Waveform", relative: ["Tracktion\\Waveform 13\\Waveform.exe", "Tracktion\\Waveform 12\\Waveform.exe"] },
  { id: "audacity", name: "Audacity", relative: ["Audacity\\audacity.exe"] },
  { id: "reaper6", name: "REAPER", relative: ["REAPER (x64)\\reaper.exe"] },
];

/**
 * Directory where the Lua bridge and the Host client exchange JSON files.
 * SynthV resolves its own TEMP at script start; this Host resolves the same
 * real user temp (a sandboxed per-call TEMP would break the rendezvous).
 * @returns {string}
 */
export function ipcDirectory() {
  if (process.platform !== "win32") return path.join(os.tmpdir());
  const fromEnv = process.env.SYNTHV_AGENT_BRIDGE_DIR;
  if (fromEnv && path.isAbsolute(fromEnv)) return fromEnv;
  const envTemp = process.env.TEMP;
  if (
    envTemp &&
    path.isAbsolute(envTemp) &&
    exists(envTemp) &&
    !/\\dsh-[^\\]+$/i.test(envTemp)
  ) {
    return envTemp;
  }
  return path.join(LOCAL, "Temp");
}

/**
 * Locate the Synthesizer V Studio 2 Pro installation directory.
 * @returns {{ directory: string, executable: string } | null}
 */
export function findInstallation() {
  for (const directory of INSTALL_DIR_CANDIDATES) {
    const executable = path.join(directory, "synthv-studio.exe");
    if (isDirectory(directory) && exists(executable)) {
      return { directory, executable };
    }
  }
  return null;
}
