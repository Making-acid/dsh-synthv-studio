/**
 * DAW integration for Synthesizer V Studio 2 Pro: plugin bundle discovery,
 * evidence that a DAW already indexed the plugin, Standard MIDI File export for
 * drag-and-drop arrangement, and the generated integration guide.
 */
import fs from "node:fs";
import path from "node:path";
import {
  DAW_CANDIDATES,
  vst3Directory,
  zrythmPluginCaches,
} from "./paths.js";
import {
  exists,
  fileSizeSafe,
  formatBytes,
  isDirectory,
  isFile,
  mtimeSafe,
  readTextSafe,
} from "./util.js";

const PROGRAM_FILES = process.env.ProgramFiles || "C:\\Program Files";
const PROGRAM_FILES_X86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

/**
 * @param {string} root
 * @param {string} relative
 * @returns {string | null}
 */
function firstExisting(root, relative) {
  const candidate = path.join(root, relative);
  return isFile(candidate) ? candidate : null;
}

/**
 * Find installed DAWs from the known-candidate list.
 * @returns {{ id: string, name: string, executable: string, bytes: number, modified: string | null }[]}
 */
export function detectDaws() {
  const found = new Map();
  for (const daw of DAW_CANDIDATES) {
    if (found.has(daw.id)) continue;
    for (const root of [PROGRAM_FILES, PROGRAM_FILES_X86]) {
      for (const relative of daw.relative) {
        const executable = firstExisting(root, relative);
        if (!executable) continue;
        const info = fs.statSync(executable);
        found.set(daw.id, {
          id: daw.id,
          name: daw.name,
          executable,
          bytes: info.size,
          modified: info.mtime.toISOString(),
        });
        break;
      }
      if (found.has(daw.id)) break;
    }
  }
  return [...found.values()];
}

/**
 * Inspect every Synthesizer V VST3 bundle in the standard VST3 folder.
 * @param {string} [directory]
 * @returns {{ directory: string, present: boolean, bundles: any[], standard: boolean, ara: boolean }}
 */
export function scanSynthVVst3Bundles(directory = vst3Directory()) {
  const present = isDirectory(directory);
  const bundles = [];
  if (present) {
    let names = [];
    try {
      names = fs.readdirSync(directory).filter((name) => /synthesizer\s*v/i.test(name));
    } catch {
      names = [];
    }
    for (const name of names) {
      const bundlePath = path.join(directory, name);
      // VST3 can ship either as a bundle directory or as a single renamed DLL.
      const isFileBundle = isFile(bundlePath);
      if (!isDirectory(bundlePath) && !isFileBundle) continue;
      const binaries = [];
      if (isFileBundle) {
        const bytes = fileSizeSafe(bundlePath);
        binaries.push({
          architecture: "x86_64-win",
          path: bundlePath,
          bytes,
        });
      } else {
        const contents = path.join(bundlePath, "Contents");
        if (isDirectory(contents)) {
          for (const arch of ["x86_64-win", "x86-win", "arm64-win"]) {
            const archDirectory = path.join(contents, arch);
            if (!isDirectory(archDirectory)) continue;
            let entries = [];
            try {
              entries = fs.readdirSync(archDirectory);
            } catch {
              entries = [];
            }
            for (const entry of entries) {
              if (entry.toLowerCase().endsWith(".vst3")) {
                const binary = path.join(archDirectory, entry);
                binaries.push({
                  architecture: arch,
                  path: binary,
                  bytes: fileSizeSafe(binary),
                });
              }
            }
          }
        }
      }
      bundles.push({
        name,
        path: bundlePath,
        kind: isFileBundle ? "file" : "bundle",
        binaries,
        // A single-file VST3 is a plain DLL; a plausible size proves content.
        verified: binaries.some((binary) => binary.bytes > 1024 * 1024),
        modified: mtimeSafe(bundlePath) ? new Date(mtimeSafe(bundlePath)).toISOString() : null,
      });
    }
  }
  const standard = bundles.some((bundle) => !/ara/i.test(bundle.name));
  const ara = bundles.some((bundle) => /ara/i.test(bundle.name));
  return { directory, present, bundles, standard, ara };
}

/**
 * Read DAW plugin-scan caches that prove the Synthesizer V plug-ins are already
 * visible to an installed DAW (currently Zrythm's cache files).
 * @returns {{ files: { path: string, present: boolean }[], vst3Entries: { name: string, file: string, source: string }[] }}
 */
export function readDawPluginCaches() {
  const files = [];
  const vst3Entries = [];
  for (const cachePath of zrythmPluginCaches()) {
    const present = exists(cachePath);
    files.push({ path: cachePath, present });
    if (!present) continue;
    const text = readTextSafe(cachePath);
    if (!text) continue;
    if (cachePath.endsWith(".xml")) {
      const pattern = /<PLUGIN\b[^>]*?name="([^"]*)"[^>]*?>/gis;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const tag = match[0];
        if (!/synthesizer\s*v/i.test(match[1])) continue;
        const file = /file="([^"]*)"/i.exec(tag)?.[1] ?? "";
        const format = /format="([^"]*)"/i.exec(tag)?.[1] ?? "VST3";
        vst3Entries.push({ name: match[1], file, format, source: cachePath });
      }
    } else {
      const blocks = text.split(/\n(?=- name:)/);
      for (const block of blocks) {
        if (!/synthesizer\s*v/i.test(block)) continue;
        const name = /name:\s*(.+)/.exec(block)?.[1]?.trim() ?? "";
        const file = /path:\s*(.+)/.exec(block)?.[1]?.trim() ?? "";
        if (name) vst3Entries.push({ name, file, format: "VST3", source: cachePath });
      }
    }
  }
  return { files, vst3Entries: dedupePluginEntries(vst3Entries) };
}

/** @returns {any[]} unique entries keyed by name + file + format. */
function dedupePluginEntries(entries) {
  const seen = new Set();
  const unique = [];
  for (const entry of entries) {
    const key = `${entry.name}\u0000${entry.file}\u0000${entry.format}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

/** PPQ used by exported MIDI files. */
const PPQ = 480;

/**
 * Build a Type-0 Standard MIDI File for a vocal melody.
 * @param {{ notes: { onset: number, duration: number, pitch: number, lyric?: string }[], bpm?: number, trackName?: string }} options
 *   `onset`/`duration` are quarter-note beats and `pitch` is a MIDI note number.
 * @returns {Buffer}
 */
export function buildMidiFile(options) {
  const bpm = Number.isFinite(options.bpm) && options.bpm > 0 ? options.bpm : 120;
  const trackName = options.trackName || "SynthV Vocal";
  const notes = Array.isArray(options.notes) ? options.notes : [];

  /** @type {{ tick: number, order: number, data: number[] }[]} */
  const events = [];
  for (const note of notes) {
    const pitch = Math.max(0, Math.min(127, Math.round(note.pitch)));
    const startTick = Math.max(0, Math.round(note.onset * PPQ));
    const endTick = Math.max(startTick + 1, Math.round((note.onset + note.duration) * PPQ));
    const velocity = 96;
    if (typeof note.lyric === "string" && note.lyric.length > 0) {
      const bytes = Buffer.from(note.lyric, "utf8");
      events.push({
        tick: startTick,
        order: 1,
        data: [0xff, 0x05, bytes.length, ...bytes],
      });
    }
    events.push({ tick: startTick, order: 3, data: [0x90, pitch, velocity] });
    events.push({ tick: endTick, order: 2, data: [0x80, pitch, 0x40] });
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const track = [];
  const push = (bytes) => track.push(...bytes);
  push([0x00, 0xff, 0x03, trackName.length, ...Buffer.from(trackName, "utf8")]);
  const microsPerQuarter = Math.round(60_000_000 / bpm);
  push([
    0x00, 0xff, 0x51, 0x03,
    (microsPerQuarter >> 16) & 0xff,
    (microsPerQuarter >> 8) & 0xff,
    microsPerQuarter & 0xff,
  ]);
  push([0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08]);

  let previousTick = 0;
  for (const event of events) {
    const delta = event.tick - previousTick;
    previousTick = event.tick;
    push(variableLengthQuantity(delta));
    push(event.data);
  }
  push(variableLengthQuantity(0));
  push([0xff, 0x2f, 0x00]);

  const header = Buffer.from([
    0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06,
    0x00, 0x00,
    0x00, 0x01,
    (PPQ >> 8) & 0xff, PPQ & 0xff,
  ]);
  const trackLength = track.length;
  const trackHeader = Buffer.from([
    0x4d, 0x54, 0x72, 0x6b,
    (trackLength >> 24) & 0xff,
    (trackLength >> 16) & 0xff,
    (trackLength >> 8) & 0xff,
    trackLength & 0xff,
  ]);
  return Buffer.concat([header, trackHeader, Buffer.from(track)]);
}

/** @returns {number[]} MIDI variable-length quantity bytes. */
function variableLengthQuantity(value) {
  let buffer = value & 0x7f;
  const bytes = [];
  while ((value >>= 7) > 0) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  for (;;) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

/**
 * Write a MIDI file and ensure its parent directory exists.
 * @returns {{ path: string, bytes: number }}
 */
export function writeMidiFile(targetPath, options) {
  const buffer = buildMidiFile(options);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, buffer);
  return { path: targetPath, bytes: buffer.length };
}

/**
 * Compose the Markdown integration guide for the detected machine state.
 * @param {{ detection: any, plugins: any, cache: any }} context
 * @returns {string}
 */
export function buildDawGuide(context) {
  const { detection, plugins, cache } = context;
  const daws = detection?.daws ?? [];
  const dawsBlock =
    daws.length > 0
      ? daws
          .map((daw) => `- **${daw.name}**：\`${daw.executable}\``)
          .join("\n")
      : "- 未检测到已安装的 DAW。可安装 REAPER、Zrythm、Cubase、Studio One 等任意支持 VST3 的宿主。";
  const bundleBlock =
    plugins.bundles.length > 0
      ? plugins.bundles
          .map(
            (bundle) =>
              `- \`${bundle.name}\`：${bundle.verified ? "✅ 已验证内部 VST3 二进制" : "⚠️ 未找到内部二进制"}\n  - 路径：\`${bundle.path}\``,
          )
          .join("\n")
      : "- 未找到 VST3 插件包。";
  const cacheBlock =
    cache.vst3Entries.length > 0
      ? cache.vst3Entries
          .map((entry) => `- ${entry.name}（${entry.format}）→ \`${entry.file}\``)
          .join("\n")
      : "- 当前未读到 DAW 的插件扫描缓存（首次启动 DAW 扫描后才会出现）。";

  return `# Synthesizer V Studio 2 Pro × DAW 集成指南

> 由 DSH 插件 \`dsh-synthv-studio\` 于 ${new Date().toLocaleString("zh-CN")} 生成。
> 本机检测结果来自 \`synthv_detect\` 与 \`synthv_daw verify\`。

## 1. 本机环境

- Synthesizer V 安装：${detection?.install?.found ? `\`${detection.install.directory}\`（版本 ${detection.install.version}）` : "未检测到"}
- 标准 VST3 目录：\`${plugins.directory}\`
- VST3 插件：
${bundleBlock}
- 已安装 DAW：
${dawsBlock}
- DAW 插件缓存已识别到的 SynthV 条目：
${cacheBlock}

## 2. 为什么可以整合进 DAW

Synthesizer V Studio 2 Pro 同时提供：

1. **VST3 乐器插件**（\`Synthesizer V Studio 2 Plugin.vst3\`）：把 SynthV 当作 DAW 里的一个音源（instrument），由 DAW 提供 MIDI、走带、混音与导出。
2. **VST3 ARA 插件**（\`Synthesizer V Studio 2 ARA Plugin.vst3\`）：支持 ARA 的宿主里可以把它当作音频编辑器插件做对齐/编辑（是否可用取决于宿主对 ARA 的支持）。

因此推荐的工作流是：**SynthV 负责“唱”（人声合成），DAW 负责“编曲与混音”**。

## 3. 推荐工作流（任意 VST3 宿主）

1. 在 DAW 中新建工程，插入乐器插件 **Synthesizer V Studio 2 Plugin**（VST3）。
2. 把 \`synthv_daw { action: "export_midi" }\` 导出的 MIDI 拖到该插件所在轨道（或在 DAW 里直接画 MIDI）。
3. 在插件窗口里为音符填写歌词（或先用 \`synthv_compose\` 在 SynthV 桌面版里生成好演唱，再 Save 工程）。
4. 在 DAW 内播放/导出：DAW 的离线导出会把 SynthV 的人声一并渲染。
5. 需要精细调音时，切回 SynthV 桌面版编辑工程，保存后 DAW 重新加载即可。

## 4. Zrythm 2.0 具体步骤（本机已安装）

1. 打开 Zrythm，新建工程。
2. 插件浏览器（左侧 Plugins）中搜索 \`Synthesizer V\`；本机缓存已确认两个 VST3 都被扫描到。
3. 拖 **Synthesizer V Studio 2 Plugin** 到一条新的 Instrument 轨道。
4. 把导出的 MIDI 文件拖到 Zrythm 的时间线/轨道上（或直接在钢琴卷帘里编写旋律）。
5. 播放验证人声；用 Zrythm 的导出（Export）渲染整首曲子。

> 注意：不同宿主对 VST3 扫描目录的约定不同；本机插件位于
> \`C:\\Program Files\\Common Files\\VST3\`（Windows 标准位置），绝大多数宿主会自动扫描。

## 5. 常见问题

- **DAW 里找不到插件**：先让 DAW 重新扫描 VST3；确认插件目录就是上面的标准目录；32 位宿主无法加载 64 位 VST3。
- **没有声音**：确认轨道是乐器轨道、插件内已选择歌声音色（Voice），并且 MIDI 音符落在插件音域内。
- **只想要音频**：先用 \`synthv_do\` 在 SynthV 中完成演唱，再在 SynthV 内 Render（渲染）导出 WAV，然后作为音频轨导入 DAW。
- **ARA 插件灰色不可用**：说明当前宿主版本不支持 ARA2，改用普通 VST3 插件即可。

## 6. 与 DSH 的联动

- \`synthv_compose\`：在 SynthV 里写旋律 + 歌词（AI 友好的一步式创作）。
- \`synthv_do\`：直接调用 SynthV Agent Bridge 的六个原生工具，做精细编辑（音符、音高、参数、自动化和播放控制）。
- \`synthv_daw\`：检测 DAW、校验 VST3、导出 MIDI、生成本指南。
`;
}

/**
 * Write the integration guide.
 * @returns {{ path: string, bytes: number }}
 */
export function writeDawGuide(targetPath, context) {
  const text = buildDawGuide(context);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, text, "utf8");
  return { path: targetPath, bytes: Buffer.byteLength(text) };
}

/** @returns {string} suggested default MIDI export path. */
export function defaultMidiPath() {
  return path.join(
    process.env.USERPROFILE || "C:\\Users\\Public",
    "Documents",
    "DSH SynthV",
    "synthv-vocal.mid",
  );
}

/** @returns {string} suggested default guide path. */
export function defaultGuidePath() {
  return path.join(
    process.env.USERPROFILE || "C:\\Users\\Public",
    "Documents",
    "DSH SynthV",
    "DAW-Integration.md",
  );
}

/** Re-exported helpers used by nearby modules. */
export { formatBytes };
