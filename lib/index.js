/**
 * dsh-synthv-studio — Host plugin entry.
 *
 * Registers the SynthV Studio tools plus one small system-prompt section so
 * every agent in this profile knows how to drive Synthesizer V Studio 2 Pro.
 */
import path from "node:path";
import { BridgeMcpClient } from "./mcp.js";
import { ipcDirectory, SERVER_BUNDLE } from "./paths.js";
import { registerSynthVTools } from "./tools.js";

export const name = "synthv-studio";
export const inject = ["tools", "systemPrompt"];

const PROMPT_SECTION = `# Synthesizer V Studio 2 Pro（dsh-synthv-studio）

本机已接入 Synthesizer V Studio 2 Pro。它能把“音符 + 歌词”合成为真人般演唱，是获得演唱/人声创作能力的主通道；VST3 插件可把它接进 DAW 编曲。

工具顺序：
1. \`synthv_detect\` — 先确认安装、授权、VST3/ARA、DAW 与常驻桥状态。
2. \`synthv_bridge\` — \`{action:"install"}\` 安装桥脚本；用户在 SynthV 里执行「脚本 → SynthV Agent Bridge → Start SynthV Agent Bridge」后，用 \`{action:"ensure"}\` 验证。
3. \`synthv_compose\` — 一步写入速度、轨道名与“音符+歌词”演唱；onset/duration 用四分音符拍，pitch 用 MIDI 音高。
4. \`synthv_do\` — 需要精细编辑时直接调用桥的原生工具（sv_status/sv_describe/sv_query/sv_command/sv_ui/sv_review）。先用 \`sv_describe\` 查动作 schema；写操作必须先 \`sv_query\` 取 writeIntent contextId。
5. \`synthv_daw\` — 检测 DAW、校验 VST3/ARA、导出 MIDI、生成 DAW 集成指南。

规则：桥未连接时不要凭空创作，先按 \`synthv_bridge\` 的步骤恢复连接；每次写入后用读回结果确认；写完提醒用户在 SynthV 右侧「歌声」面板为该音符组选择歌手（官方 API 无法代选）；SynthV 的渲染/保存按钮属于 GUI 操作，需要时提示用户在 SynthV 内保存或渲染。`;

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ serverBundle?: string, ipcDirectory?: string }} [config]
 */
export function apply(ctx, config = {}) {
  const client = new BridgeMcpClient({
    serverPath: config.serverBundle
      ? path.resolve(config.serverBundle)
      : SERVER_BUNDLE,
    ipcDirectory: config.ipcDirectory ? path.resolve(config.ipcDirectory) : ipcDirectory(),
  });

  registerSynthVTools(ctx, { client });

  ctx.systemPrompt.section({
    name: "tool:synthv-studio",
    order: 3100,
    text: PROMPT_SECTION,
  });

  // Dispose the long-lived MCP child with the plugin's own fiber.
  const dispose = () => client.close();
  if (typeof ctx.effect === "function") {
    ctx.effect(() => dispose);
  } else if (typeof ctx.on === "function") {
    ctx.on("dispose", dispose);
  }
}

export default { name, inject, apply };
