# Verification

This page records the real end-to-end verification of `dsh-synthv-studio` on the
development machine. It is evidence, not a promise about other machines.

## Environment

| Item | Value |
|---|---|
| OS | Windows 11 (10.0.26100), x64 |
| Harness | DSH Desktop Next 2.0.17-next, runtime `@deepseek-ai/dsh` 0.2.0-rc.2 |
| Synthesizer V | Synthesizer V Studio 2 Pro **2.2.1**, host version number 131585 |
| Voice | one voice selected manually in SynthV (the script API cannot select one) |
| DAW | Zrythm 2.0 (`C:\Program Files\Zrythm 2.0\bin\zrythm.exe`) |
| Bridge | SynthV Agent Bridge 0.3.1, protocol 3, executor build `sv3-lua-0.3.1-2567375a…` |

## 1. Plugin surface (offline)

```text
node test/selftest.mjs
```

- plugin exports `apply` and `inject = ["tools", "systemPrompt"]`;
- exactly five tools registered: `synthv_detect`, `synthv_bridge`, `synthv_do`,
  `synthv_compose`, `synthv_daw`;
- every tool definition has an object-rooted parameter schema, an object-rooted
  output schema and a `render` function, and passes the DSH tool registry's own
  JSON-schema subset validator;
- one system-prompt section (`tool:synthv-studio`, order 3100) registered;
- note normalization, MIDI file structure, DAW guide, bridge status parsing and
  local discovery all pass.

```text
node test/mcp-handshake.mjs
```

- the bundled `server/server.bundle.mjs` starts as a child process, completes the
  MCP initialize handshake, exposes the six `sv_*` tools, and answers
  `sv_status` with a bridge projection even when SynthV is not running.

## 2. Discovery on this machine

```text
synthv_detect
```

```text
✅ Synthesizer V Studio 2 Pro 2.2.1
   C:\Program Files\Synthesizer V Studio 2 Pro
🔑 license session present
🎙️ voice database ≈286 MB
🔌 2 VST3 bundles (standard + ARA), both binaries verified
🎛️ DAW: Zrythm
🌉 bridge scripts installed (v0.3.1)
```

The two plug-ins are single-file VST3 modules (19 MB each):

```text
C:\Program Files\Common Files\VST3\Synthesizer V Studio 2 Plugin.vst3
C:\Program Files\Common Files\VST3\Synthesizer V Studio 2 ARA Plugin.vst3
```

## 3. Bridge

After the user starts **Scripts → SynthV Agent Bridge → Start SynthV Agent
Bridge** once, `synthv_bridge { action: "ensure" }` reports:

```text
端到端状态：✅ 已连接
构建一致性：✅ 执行器与内置服务端一致
执行器 build：sv3-lua-0.3.1-2567375a…
```

`sv_status { operation: "bridge" }` returned
`coherence.state = "matched"`, `coherence.writesAllowed = true`, heartbeat age
≈1 s.

The first attempt was made with the unsubstituted Lua template, which reports a
placeholder executor build id and makes the server reject every write. The
plugin now injects the build id at install time and writes the schema-2 install
manifest, so a stale running bridge is repaired by an automatic hot reload
(verified: placeholder → matched without restarting SynthV).

## 4. Vocal composition

Two phrases were written into a blank project and read back independently:

| Phrase | Notes | Result |
|---|---|---|
| 夜 空 里 的 风 啊 | 6 | written into a new dedicated group; read-back 0 → 6 |
| 星 光 洒 落 啊 | 5 | written into a new group `DSH Vocal 2`; read-back 6 → 11 |
| 再 见 | 2 | appended to the existing `DSH Vocal 2` group by name; read-back 11 → 13 |

The final state was 13 notes with Chinese lyrics, pitch and duration preserved,
visible in Synthesizer V's piano roll together with the rendered pitch curve and
waveform (see `assets/screenshot-1.png`).

The tool also reported that the target group had no singer selected yet — the
official scripting API cannot enumerate or choose voices, so that one step stays
manual in SynthV.

## 5. DAW integration

`synthv_daw { action: "verify" }`:

- both VST3 bundles exist and contain a plausible binary;
- Zrythm's plugin caches already list both:
  - `known_plugins.xml` → `Synthesizer V Studio 2 ARA Plugin` / `… 2 Plugin`
  - `cached_plugin_descriptors.yaml` → `Synthesizer V Studio 2 Plugin`
- verdict: plug-ins complete and loadable by a VST3 host.

`synthv_daw { action: "export_midi" }` wrote a valid type-0 Standard MIDI File
(`MThd`, format 0, 480 PPQ, tempo and lyric meta events), and
`synthv_daw { action: "write_guide" }` produced a machine-specific Markdown
integration guide.

## Reproducing

```sh
node test/selftest.mjs          # offline
node test/mcp-handshake.mjs     # offline
node test/e2e-synthv.mjs        # requires SynthV + running bridge; dry run
node test/e2e-synthv.mjs --write
```

The screenshot in this repository was captured from the real Synthesizer V
window after the second phrase had been written.
