/**
 * Tool definitions registered on the DSH tool registry. Every tool returns the
 * compact `{ ok, text }` shape and renders that same text for the model.
 */
import { detectSynthV } from "./detect.js";
import {
  buildStartSteps,
  bridgeStatusSnapshot,
  ensureBridgeReady,
  isSynthVRunning,
  launchSynthV,
  removeBridgeScripts,
  requestBridgeReload,
  requestBridgeStop,
} from "./bridge.js";
import {
  buildDawGuide,
  defaultGuidePath,
  defaultMidiPath,
  readDawPluginCaches,
  scanSynthVVst3Bundles,
  writeDawGuide,
  writeMidiFile,
} from "./daw.js";
import { installBridgeScripts, prepareBridgeSources } from "./lua.js";
import { composeVocalPart } from "./compose.js";
import { BRIDGE_TOOL_NAMES } from "./mcp.js";
import { formatBytes } from "./util.js";

/** Shared `{ ok, text }` output schema. */
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "text"],
  properties: {
    ok: { type: "boolean", description: "Whether the operation succeeded." },
    text: { type: "string", description: "Human-readable result, including key JSON fields." },
  },
};

/** @returns {any[]} rendered content blocks. */
function renderText(_args, value) {
  return [{ type: "text", text: typeof value?.text === "string" ? value.text : "" }];
}

/**
 * Build one registry-ready tool definition.
 * @param {string} toolName
 * @param {string} description
 * @param {any} parameters JSON schema for the implicit arguments object
 * @param {(args: any, exec: any) => Promise<{ ok?: boolean, text: string }>} execute
 */
function tool(toolName, description, parameters, execute) {
  return {
    name: toolName,
    description,
    parameters,
    output: { schema: OUTPUT_SCHEMA, render: renderText },
    async execute(args, exec) {
      try {
        const value = await execute(args ?? {}, exec);
        return { ok: value?.ok !== false, text: String(value?.text ?? "") };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, text: `❌ ${toolName} 失败：${message}` };
      }
    },
  };
}

/** @returns {string} trimmed JSON for embedding in a tool text result. */
function jsonText(value, maxChars = 6000) {
  let text;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…（已截断，共 ${text.length} 字符）`;
}

/** Reusable note array schema for composition / MIDI export. */
const NOTES_SCHEMA = {
  type: "array",
  description:
    "Melody notes. onset/duration are in quarter-note beats; pitch is a MIDI note number (0-127); lyric is one syllable for the note.",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["onset", "duration", "pitch"],
    properties: {
      onset: { type: "number", description: "Start position in quarter-note beats." },
      duration: { type: "number", description: "Length in quarter-note beats." },
      pitch: { type: "integer", description: "MIDI pitch, 0-127." },
      lyric: { type: "string", description: "Lyric syllable for this note, e.g. 你 or la." },
    },
  },
};

const DAW_ACTIONS = ["detect", "verify", "export_midi", "write_guide"];

/**
 * Register every SynthV tool on the Host plugin context.
 * @param {any} ctx DSH plugin context (injects `tools` and `systemPrompt`)
 * @param {{ client: import('./mcp.js').BridgeMcpClient }} runtime
 */
export function registerSynthVTools(ctx, runtime) {
  const { client } = runtime;

  ctx.tools.register(
    tool(
      "synthv_detect",
      "Locate Synthesizer V Studio 2 Pro on this PC and report its install/version, license session, voice database, VST3 + ARA plugins, installed DAWs and the live Lua-bridge status. Read-only scan; run it first before any music operation.",
      {
        type: "object",
        additionalProperties: false,
        properties: {
          refresh: {
            type: "boolean",
            description: "Re-scan now instead of relying on cached values (default false).",
          },
        },
      },
      async () => {
        const detection = await detectSynthV({ refresh: true });
        const lines = [];
        const install = detection.install;
        if (install.found) {
          lines.push(`✅ 找到 Synthesizer V Studio 2 Pro ${install.version}`);
          lines.push(`   安装目录：${install.directory}`);
        } else {
          lines.push("❌ 未找到 Synthesizer V Studio 2 Pro 安装。");
          lines.push(`   已检查：${install.candidatesChecked.join("；")}`);
        }
        lines.push(
          `🔑 授权会话：${detection.appData.license.sessionPresent ? "存在" : "未找到（首次使用需在 SynthV 内激活）"}`,
        );
        const voiceDb = detection.appData.voiceDatabase;
        lines.push(
          `🎙️ 声音数据库：${voiceDb.present ? `${voiceDb.entries} 个条目，约 ${formatBytes(voiceDb.bytes)}${voiceDb.approximate ? "（近似）" : ""}` : "不存在"}`,
        );
        const plugins = detection.plugins;
        lines.push(
          `🔌 VST3 插件：${plugins.bundles.length} 个${plugins.standard ? "（含标准乐器版）" : ""}${plugins.ara ? "（含 ARA 版）" : ""}`,
        );
        for (const bundle of plugins.bundles) {
          lines.push(
            `   - ${bundle.name}: ${bundle.verified ? "✅ 已验证" : "⚠️ 未找到二进制"} → ${bundle.path}`,
          );
        }
        lines.push(
          `🎛️ 已安装 DAW：${detection.daws.length > 0 ? detection.daws.map((daw) => daw.name).join("、") : "未检测到"}`,
        );
        const bridge = detection.bridge;
        lines.push(
          `🌉 常驻桥：脚本${bridge.scripts.installed ? `已安装${bridge.scripts.version ? ` (v${bridge.scripts.version})` : ""}` : "未安装"}；运行状态：${
            bridge.running ? `✅ 已连接（心跳 ${bridge.status.ageSeconds}s 前）` : "❌ 未运行"
          }`,
        );
        lines.push(`   IPC 目录：${bridge.ipcDirectory}`);
        if (detection.issues.length > 0) {
          lines.push("");
          lines.push("⚠️ 需要注意：");
          detection.issues.forEach((issue) => lines.push(`- ${issue}`));
        }
        if (detection.nextSteps.length > 0) {
          lines.push("");
          lines.push("👉 下一步：");
          detection.nextSteps.forEach((step) => lines.push(`- ${step}`));
        }
        lines.push("");
        lines.push("```json");
        lines.push(jsonText({ install: detection.install, plugins: detection.plugins, daws: detection.daws }));
        lines.push("```");
        return { ok: detection.ok, text: lines.join("\n") };
      },
    ),
  );

  ctx.tools.register(
    tool(
      "synthv_bridge",
      "Install, inspect, start, stop or reload the persistent SynthV Agent Bridge (in-app Lua executor + local file IPC). Use action='ensure' for an end-to-end readiness check. The bridge must run inside SynthV before any synthv_compose / synthv_do write.",
      {
        type: "object",
        additionalProperties: false,
        required: ["action"],
        properties: {
          action: {
            type: "string",
            enum: ["status", "install", "ensure", "launch", "stop", "reload", "uninstall"],
            description:
              "status: local check; install: copy bundled Lua scripts into SynthV; ensure: install + verify end-to-end; launch: start SynthV; stop/reload: signal the running bridge; uninstall: remove only this plugin's scripts.",
          },
          waitSeconds: {
            type: "integer",
            description: "For action='ensure': wait up to this many seconds for a fresh heartbeat (0-180).",
          },
        },
      },
      async (args) => {
        const action = String(args.action ?? "status");
        switch (action) {
          case "status": {
            const snapshot = bridgeStatusSnapshot();
            const prepared = prepareBridgeSources();
            const synthvRunning = await isSynthVRunning();
            const buildMatch = Boolean(
              snapshot.status.executorBuildId &&
                snapshot.status.executorBuildId === prepared.executorBuildId,
            );
            const lines = [
              `SynthV 进程：${synthvRunning ? "运行中" : "未运行"}`,
              `桥脚本：${snapshot.scripts.installed ? `已安装${snapshot.scripts.version ? ` (v${snapshot.scripts.version})` : ""}` : "未安装"} → ${snapshot.scripts.directory}`,
              `心跳：${snapshot.status.present ? `存在，${snapshot.status.ageSeconds}s 前${snapshot.status.fresh ? "（新鲜）" : "（已过期）"}` : "不存在"}`,
              `构建一致性：${buildMatch ? "✅ 与内置服务端一致" : `❌ 运行中 build=${snapshot.status.executorBuildId ?? "(无)"}，期望=${prepared.executorBuildId}`}`,
              `IPC 目录：${snapshot.ipcDirectory}`,
              `状态文件：${snapshot.statusFile}`,
            ];
            if (snapshot.running && !buildMatch) {
              lines.push("");
              lines.push("👉 运行 synthv_bridge { action: 'ensure' }，插件会自动热重载成正确版本。");
            }
            return { ok: snapshot.running && buildMatch, text: lines.join("\n") };
          }
          case "install": {
            const result = installBridgeScripts();
            const lines = [
              result.ok ? "✅ 桥脚本安装/更新完成。" : "❌ 桥脚本安装失败。",
              `目标目录：${result.directory}`,
              `执行器 build-id：${result.build.executorBuildId}`,
              ...result.actions.map((entry) => `- ${entry}`),
            ];
            if (result.warnings?.length > 0) {
              lines.push("");
              lines.push("⚠️ 警告：");
              result.warnings.forEach((warning) => lines.push(`- ${warning}`));
            }
            if (result.needsRescan) {
              lines.push("");
              lines.push(
                "👉 接着在 SynthV 中执行：脚本 → 重新扫描，然后 脚本 → SynthV Agent Bridge → Start SynthV Agent Bridge。",
              );
            } else if (result.reloadRequired) {
              lines.push("");
              lines.push("👉 脚本已更新；运行 synthv_bridge { action: 'ensure' } 会自动热重载正在运行的桥。");
            }
            return { ok: result.ok, text: lines.join("\n") };
          }
          case "ensure": {
            const ensured = await ensureBridgeReady({ waitSeconds: args.waitSeconds });
            const lines = [
              `SynthV 进程：${ensured.synthvRunning ? "运行中" : "未运行"}`,
              `桥脚本：${ensured.scripts.installed ? "已安装" : "未安装"}`,
              `心跳：${ensured.status.present ? `${ensured.status.ageSeconds}s 前${ensured.status.fresh ? "（新鲜）" : "（过期）"}` : "不存在"}`,
              `端到端状态：${ensured.ready ? "✅ 已连接" : "❌ 未连接"}`,
              `构建一致性：${ensured.buildMatch ? "✅ 执行器与内置服务端一致" : "❌ 不一致"}${
                ensured.reloaded ? "（已自动热重载）" : ""
              }`,
              `执行器 build：${ensured.build.runningExecutorBuildId ?? "(无)"}`,
            ];
            if (!ensured.ready || !ensured.buildMatch) {
              lines.push("");
              lines.push("👉 请按顺序操作：");
              const steps = ensured.steps.length > 0 ? ensured.steps : buildStartSteps(ensured);
              steps.forEach((step) => lines.push(`- ${step}`));
              return { ok: false, text: lines.join("\n") };
            }
            try {
              const status = await client.status();
              lines.push("");
              lines.push("桥自检（sv_status/bridge）：");
              lines.push("```json");
              lines.push(jsonText(status, 2500));
              lines.push("```");
              const writable = status?.coherence?.writesAllowed !== false;
              return {
                ok: Boolean(status?.connected) && writable,
                text: lines.join("\n"),
              };
            } catch (error) {
              lines.push("");
              lines.push(`⚠️ 心跳存在但 MCP 自检失败：${error instanceof Error ? error.message : String(error)}`);
              return { ok: false, text: lines.join("\n") };
            }
          }
          case "launch": {
            const launched = await launchSynthV();
            return { ok: launched.ok, text: launched.message };
          }
          case "stop": {
            const result = requestBridgeStop();
            return { ok: result.ok, text: result.message };
          }
          case "reload": {
            const result = requestBridgeReload();
            return { ok: result.ok, text: result.message };
          }
          case "uninstall": {
            const result = removeBridgeScripts();
            return { ok: result.ok, text: `${result.reason}\n目录：${result.directory}` };
          }
          default:
            return { ok: false, text: `未知 action：${action}` };
        }
      },
    ),
  );

  ctx.tools.register(
    tool(
      "synthv_do",
      "Call one of the SynthV Agent Bridge's native MCP tools directly: sv_status, sv_describe, sv_query, sv_command, sv_ui or sv_review. Use sv_describe first for an unfamiliar action schema; every sv_command write needs a writeIntent contextId from the matching sv_query read. Indices are 1-based.",
      {
        type: "object",
        additionalProperties: false,
        required: ["tool"],
        properties: {
          tool: {
            type: "string",
            enum: BRIDGE_TOOL_NAMES,
            description: "Bridge tool to call.",
          },
          arguments: {
            type: "object",
            additionalProperties: true,
            description:
              "Tool arguments, e.g. {\"operation\":\"bridge\"} for sv_status or {\"action\":\"get_project_info\",\"args\":{}} for sv_query.",
          },
          timeoutMs: {
            type: "integer",
            description: "Optional call timeout in milliseconds (default 120000).",
          },
        },
      },
      async (args) => {
        const name = String(args.tool ?? "");
        if (!BRIDGE_TOOL_NAMES.includes(name)) {
          return { ok: false, text: `不支持的桥工具：${name}（可用：${BRIDGE_TOOL_NAMES.join(", ")}）` };
        }
        const toolArguments = args.arguments && typeof args.arguments === "object" ? args.arguments : {};
        const timeoutMs = Number.isFinite(args.timeoutMs) ? Number(args.timeoutMs) : 120_000;
        try {
          const result = await client.callTool(name, toolArguments, timeoutMs);
          return {
            ok: true,
            text: `${name} 调用成功：\n\`\`\`json\n${jsonText(result, 20_000)}\n\`\`\``,
          };
        } catch (error) {
          return {
            ok: false,
            text: `${name} 调用失败：${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    ),
  );

  ctx.tools.register(
    tool(
      "synthv_compose",
      "Create a vocal part in the SynthV project that is currently open: optionally set tempo and track name, then write notes with lyrics into a track/group and read the result back for verification. Requires a running bridge (see synthv_bridge). Notes use quarter-note beats for onset/duration and MIDI pitch numbers.",
      {
        type: "object",
        additionalProperties: false,
        required: ["notes"],
        properties: {
          notes: NOTES_SCHEMA,
          tempoBpm: { type: "number", description: "Optional project tempo in BPM (writes a tempo mark at position 0)." },
          trackIndex: { type: "integer", description: "1-based track index (default 1)." },
          groupIndex: { type: "integer", description: "1-based note-group index inside the track (default 1)." },
          trackName: { type: "string", description: "Optional new name for the track." },
          groupName: { type: "string", description: "Optional name for a newly created note group." },
          displayColor: { type: "string", description: "Optional track color such as #6C8CFF." },
          fallbackLyric: { type: "string", description: "Lyric used when a note omits one (default 'la')." },
          dryRun: { type: "boolean", description: "Validate and plan only; write nothing." },
        },
      },
      async (args) => {
        const summary = await composeVocalPart(client, args);
        const lines = [
          summary.dryRun ? "🔎 试运行通过（未写入）。" : "✅ 演唱片段已写入 SynthV。",
          ...summary.steps.map((step) => `- ${step}`),
        ];
        if (summary.warnings?.length > 0) {
          lines.push("");
          lines.push("⚠️ 提示：");
          summary.warnings.forEach((warning) => lines.push(`- ${warning}`));
        }
        lines.push("");
        lines.push("```json");
        lines.push(
          jsonText({
            addedNotes: summary.addedNotes,
            noteCountBefore: summary.noteCountBefore,
            noteCountAfter: summary.noteCountAfter,
            verification: summary.verification,
          }),
        );
        lines.push("```");
        lines.push("");
        lines.push("👉 在 SynthV 内播放试听；满意后用 文件 → 保存，或在 synthv_daw 里导出 MIDI 给 DAW。");
        return { ok: true, text: lines.join("\n") };
      },
    ),
  );

  ctx.tools.register(
    tool(
      "synthv_daw",
      "DAW integration for Synthesizer V Studio 2 Pro: detect installed DAWs, verify the VST3/ARA plugin bundles and existing DAW scan caches, export a Standard MIDI File for arrangement, and write a ready-to-follow integration guide.",
      {
        type: "object",
        additionalProperties: false,
        required: ["action"],
        properties: {
          action: {
            type: "string",
            enum: DAW_ACTIONS,
            description:
              "detect: list DAWs + plugins; verify: checklist + DAW cache evidence; export_midi: write a .mid from notes; write_guide: write the integration guide.",
          },
          notes: {
            ...NOTES_SCHEMA,
            description: "For action='export_midi': melody notes (same shape as synthv_compose).",
          },
          bpm: { type: "number", description: "For action='export_midi': tempo in BPM (default 120)." },
          path: {
            type: "string",
            description: "Optional absolute output path for export_midi / write_guide.",
          },
        },
      },
      async (args) => {
        const action = String(args.action ?? "detect");
        const detection = await detectSynthV({ refresh: true });
        const plugins = scanSynthVVst3Bundles();
        const caches = readDawPluginCaches();

        if (action === "detect" || action === "verify") {
          const lines = [
            `🎛️ DAW：${detection.daws.length > 0 ? detection.daws.map((daw) => `${daw.name}`).join("、") : "未检测到"}`,
            `🔌 VST3 目录：${plugins.directory}`,
          ];
          for (const bundle of plugins.bundles) {
            const bytes = bundle.binaries.reduce((sum, binary) => sum + binary.bytes, 0);
            lines.push(
              `   - ${bundle.name}: ${bundle.verified ? "✅ 二进制存在" : "⚠️ 缺少二进制"}（${formatBytes(bytes)}）`,
            );
          }
          lines.push(
            `🔍 DAW 插件缓存：${caches.vst3Entries.length > 0 ? `已识别 ${caches.vst3Entries.length} 条 SynthV 插件记录` : "未读到记录"}`,
          );
          for (const entry of caches.vst3Entries.slice(0, 6)) {
            lines.push(`   - ${entry.name}（${entry.format}）`);
          }
          const verdict =
            plugins.bundles.length > 0 && plugins.bundles.every((bundle) => bundle.verified)
              ? "✅ 插件包完整，可被 VST3 宿主加载"
              : "⚠️ 插件包不完整，请重新安装 SynthV 或检查 VST3 目录权限";
          lines.push("");
          lines.push(verdict);
          if (detection.daws.length > 0) {
            lines.push("");
            lines.push(
              "👉 在 DAW 中插入乐器插件「Synthesizer V Studio 2 Plugin」，把 synthv_daw { action: 'export_midi' } 导出的 MIDI 拖到该轨道即可听到演唱。",
            );
          }
          lines.push("");
          lines.push("```json");
          lines.push(jsonText({ daws: detection.daws, plugins, cacheFiles: caches.files }, 7000));
          lines.push("```");
          return { ok: plugins.bundles.length > 0, text: lines.join("\n") };
        }

        if (action === "export_midi") {
          if (!Array.isArray(args.notes) || args.notes.length === 0) {
            return { ok: false, text: "export_midi 需要 notes 参数（[{onset,duration,pitch,lyric}]）。" };
          }
          const targetPath =
            typeof args.path === "string" && args.path.trim().length > 0 ? args.path : defaultMidiPath();
          const written = writeMidiFile(targetPath, {
            notes: args.notes,
            bpm: Number.isFinite(args.bpm) ? args.bpm : 120,
            trackName: "SynthV Vocal",
          });
          return {
            ok: true,
            text: `✅ 已导出 MIDI：${written.path}（${written.bytes} 字节，${args.notes.length} 个音符）\n把该文件拖进 DAW 的 SynthV 插件轨道即可。`,
          };
        }

        if (action === "write_guide") {
          const targetPath =
            typeof args.path === "string" && args.path.trim().length > 0 ? args.path : defaultGuidePath();
          const written = writeDawGuide(targetPath, { detection, plugins, cache: caches });
          return {
            ok: true,
            text: `✅ 已生成 DAW 集成指南：${written.path}（${written.bytes} 字节）\n指南包含本机 VST3/ARA 路径、Zrythm 具体步骤与常见问题。`,
          };
        }

        return { ok: false, text: `未知 action：${action}` };
      },
    ),
  );
}

/** `buildDawGuide` is exported for reuse by future UI surfaces. */
export { buildDawGuide };
