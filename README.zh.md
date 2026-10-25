# dsh-synthv-studio

**一个 DSH 插件：自动找到本机的 Synthesizer V Studio 2 Pro，通过它自带的
Lua 脚本 API 建立常驻连接，并给 Agent 提供发现、桥接、演唱创作、音符编辑与
DAW 集成五个工具。**

中文 | [English](README.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%E2%89%A50.2.0--rc.1-6c8cff.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![Platform](https://img.shields.io/badge/platform-Windows-0078d4.svg)](#环境要求)
[![Synthesizer V](https://img.shields.io/badge/Synthesizer%20V%20Studio%202%20Pro-2.1.2%2B-b06cff.svg)](#环境要求)

![dsh-synthv-studio：把带歌词的演唱写进 Synthesizer V Studio 2 Pro](assets/screenshot-1.png)

Synthesizer V Studio 2 Pro 没有对外 API，只提供**应用内 Lua 脚本**和
**VST3/ARA 插件**。本插件把脚本 API 变成 Agent 可调用的工具：
常驻 Lua 执行器 + 文件 IPC + 内置本地 MCP 服务端。它**不解析/不改写 `.svp` 工程文件**、
不开放网络端口、不调用任何在线服务，工程状态的唯一权威始终是 SynthV 本身。

## 环境要求

- **Windows 10/11**（在 Windows 11 上开发与验证；发现逻辑和 DAW 探测是 Windows 专用）。
- **Synthesizer V Studio 2 Pro 2.1.2 或更新版本**，正常安装并打开一个工程；实测 2.2.1。
- **DSH 运行时 `dsh` ≥ 0.2.0-rc.1**（实测 DSH Desktop Next 2.0.17-next 自带的 0.2.0-rc.2）。
- Host 可用的 **Node.js 20+**（内置桥服务端是一个普通 Node 脚本）。
- 可选：任意 VST3 宿主（REAPER、Zrythm、Cubase、Studio One…）用于 DAW 编曲。

## 安装

```sh
dsh plugin --profile desktop add github:Making-acid/dsh-synthv-studio
```

（`--profile web` 同理。）安装后**重启一次 DSH**，Host 插件才会加载；
之后在「设置 → 插件」能看到卡片，新会话里出现 5 个 `synthv_*` 工具。

> npm 包正在准备；发布后可以直接 `dsh plugin add dsh-synthv-studio`。
> 当前从 GitHub 安装即可用。

## 首次连接（每次启动 SynthV 后一次）

1. 在 DSH 里调用 `synthv_bridge { "action": "ensure" }`：第一次会把桥脚本写入
   `%APPDATA%\Dreamtonics\Synthesizer V Studio 2\scripts\SynthV Agent Bridge\`。
2. 在 SynthV 菜单执行：**脚本 → 重新扫描**（仅首次安装后需要），再执行
   **脚本 → SynthV Agent Bridge → Start SynthV Agent Bridge**，保持它运行。
3. 再次调用 `synthv_bridge { "action": "ensure", "waitSeconds": 30 }`：
   看到 `connected`、心跳新鲜、`coherence.state = "matched"` 即连接成功。

桥是一个 SynthV 脚本，随 SynthV 关闭而停止，下次启动需要再点一次 Start。
如果之前装过旧模板的桥，`ensure` 会自动热重载修复，不必手动重启脚本。

## 工具

| 工具 | 作用 |
|---|---|
| `synthv_detect` | 只读扫描：安装目录与版本、授权会话、声音数据库、VST3 + ARA、已装 DAW、桥心跳与 IPC 目录。 |
| `synthv_bridge` | `status` / `install` / `ensure` / `launch` / `stop` / `reload` / `uninstall`：安装内置 Lua 脚本、热重载修复旧桥、校验构建一致性、启动 SynthV。 |
| `synthv_compose` | 写一段演唱：速度、轨道名、带歌词的音符，自动复用或新建音符组，并独立回读校验。`dryRun` 只演练不写入。 |
| `synthv_do` | 调用桥自带的 MCP 工具：`sv_status`、`sv_describe`、`sv_query`、`sv_command`、`sv_ui`、`sv_review`。桥提供 17 个读动作、38 个写动作、9 个 UI 动作，覆盖音符、歌词、音素、音高控制、自动化、歌手/唱法、混音与播放。 |
| `synthv_daw` | `detect` / `verify` / `export_midi` / `write_guide`：DAW 检测、VST3/ARA 校验、DAW 插件缓存取证、标准 MIDI 导出、生成集成指南。 |

`synthv_compose` 的音符坐标：`onset` / `duration` 用**四分音符拍**，`pitch` 用
**MIDI 音高**，`lyric` 一个字一个音节。

```json
{
  "tempoBpm": 104,
  "trackName": "主唱",
  "groupName": "主唱",
  "notes": [
    { "onset": 0,   "duration": 1,   "pitch": 72, "lyric": "星" },
    { "onset": 1,   "duration": 0.5, "pitch": 74, "lyric": "光" },
    { "onset": 1.5, "duration": 1.5, "pitch": 76, "lyric": "洒" },
    { "onset": 3,   "duration": 1,   "pitch": 74, "lyric": "落" },
    { "onset": 4,   "duration": 2,   "pitch": 72, "lyric": "啊" }
  ]
}
```

做精细编辑时：先用 `synthv_do` 调 `sv_describe` 查动作 schema，再用 `sv_query`
（`contextMode: "writeIntent"`）取 `contextId`，最后 `sv_command` 写入；
桥会在写入后对 SynthV 当前状态做校验。

## 工作原理

```text
DSH Agent
   │  5 个 synthv_* 工具
   ▼
dsh-synthv-studio（Host 插件，lib/）
   │  MCP over stdio（子进程）
   ▼
server/server.bundle.mjs（内置的 SynthV Agent Bridge 服务端）
   │  %TEMP% 里的 JSON 文件 IPC
   ▼
SynthV Agent Bridge（应用内 Lua 执行器，SV:setTimeout 常驻轮询）
   │  SynthV 官方 Lua 脚本 API
   ▼
Synthesizer V Studio 2 Pro  ──▶  VST3 / ARA 插件  ──▶  DAW
```

Lua 执行器与 Node 服务端共享内容派生的构建号
（`sv3-lua-<version>-<sha256(模板)>`）。插件在安装时注入构建号，并写入执行器
用于定位自身做热重载的 install manifest，因此两端不会悄悄失配。

## 接入 DAW

Synthesizer V Studio 2 Pro 同时提供 **VST3 乐器插件**和 **VST3 ARA 插件**。常见流程：

1. 在 DAW 里把 `Synthesizer V Studio 2 Plugin` 插到一条乐器轨；
2. `synthv_daw { "action": "export_midi", "bpm": 104, "notes": [...] }` 导出 `.mid`，
   拖到该轨道（或直接在 DAW 里画 MIDI）；
3. 在插件窗口里填歌词/调音，或先用 `synthv_compose` 在 SynthV 桌面版创作并保存工程；
4. 由 DAW 渲染/导出，人声随编曲一起输出；
5. 想要成品音频：在 SynthV 桌面版 Render 导出 WAV，再作为音频轨导入 DAW。

`synthv_daw { "action": "write_guide" }` 会按本机实际路径生成一份 Markdown 集成指南。

## 已知限制

- **歌手必须手动选。** 官方脚本 API 读不到当前歌手、也枚举不了已安装歌手，
  听之前要在 SynthV 右侧「歌声」面板为该音符组选一个。
- **保存/渲染留在 GUI。** 官方 API 不提供保存工程或渲染音频；本插件也不碰 `.svp` 文件。
- **桥在 SynthV 内。** SynthV 关闭后桥停止，下次启动需从脚本菜单再启动一次。
- **仅 Windows。** macOS/Linux 的路径、进程检测与 DAW 发现尚未实现。
- 一次 `synthv_compose` 只针对一条轨道；多轨请先用 `synthv_do`（`sv_command` 的
  `add_track`）建轨，再用 `trackIndex` 指定。

## 测试

```sh
node test/selftest.mjs          # 离线：插件接口、schema、纯逻辑
node test/mcp-handshake.mjs     # 离线：内置服务端 MCP 握手
node test/e2e-synthv.mjs        # 需要 SynthV + 运行中的桥；默认 dry-run
node test/e2e-synthv.mjs --write
```

真机验证记录见 [docs/verification.md](docs/verification.md)。

## 许可与致谢

Apache-2.0。内置的桥服务端（`server/server.bundle.mjs`）与应用内 Lua 脚本
（`synthv/*.lua`）来自
[SynthVCopilot/synthv-agent-bridge](https://github.com/SynthVCopilot/synthv-agent-bridge)
（Apache-2.0），来源与本插件在安装时做的构建号注入见 [NOTICE](NOTICE)。
“Synthesizer V” 是 Dreamtonics Co., Ltd. 的产品；本项目与 Dreamtonics 无隶属关系。
