# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-11-09

Compatibility pass for the DSH 0.2.1 / 0.2.2 line (upstream latest: `0.2.2-rc.1`).

### Changed

- `engines.dsh` is now `>=0.2.0-rc.2 <0.3.0-0` (was an open-ended `>=0.2.0-rc.1`). DSH 0.2.1
  started preferring `engines.dsh` for third-party plugin compatibility, and an explicit
  `<0.3.0-0` ceiling keeps a future breaking 0.3 from being treated as supported.
- MCP `clientInfo` version follows the package (`0.1.1`).
- README / README.zh requirements state the verified DSH floor and that DSH itself needs
  Node ≥ 24.9 from 0.2.2 on.

### Added

- `scripts/check-dsh.mjs` (`npm run test:dsh`): validates the manifest, the five tool
  definitions against the **installed Host's own** `@deepseek-ai/dsh-tools` schema contract,
  and that `engines.dsh` covers the running DSH version. Read-only; skips cleanly when no
  DSH installation is present.

### Verified against DSH 0.2.2-rc.1

No API change was needed:

- `tools.register(definition, options)` with `output: { schema, render }` and a disposer is
  unchanged; all five tool definitions pass the 0.2.2 schema-subset validator.
- `ctx.systemPrompt.section({ name, order, text })` and `ctx.effect()` / `ctx.on()` still
  behave as before under Cordis 4.1.0 (the plugin also tolerates a context without
  `effect`, keeping the old `ctx.on('dispose')` fallback).
- `cordis.patch.yml` rows (`insert`) remain the supported Loader 1.1.0 / Include 1.1.0 patch
  format.

## [0.1.0] - 2026-10-25

### Added

- Host plugin registered on the DSH tool registry with five tools:
  `synthv_detect`, `synthv_bridge`, `synthv_compose`, `synthv_do`, `synthv_daw`.
- Machine discovery for Synthesizer V Studio 2 Pro: install directory and
  registry version, license session, voice database, VST3 + ARA plugin bundles,
  installed DAWs, and bridge heartbeat state.
- Persistent in-app Lua bridge: bundled executor/sidebar/stop scripts, build-id
  injection at install time (`sv3-lua-<version>-<sha256>`), install manifest for
  hot reload, and automatic repair of a running bridge built from stale
  templates.
- One-step vocal composition: tempo, track naming, notes with lyrics, group
  reuse by name, and independent read-back verification. Reports when the note
  group has no singer selected (the official API cannot pick one).
- Native bridge passthrough: `sv_status`, `sv_describe`, `sv_query`,
  `sv_command`, `sv_ui` and `sv_review`, including write-intent contexts.
- DAW integration: DAW detection, VST3/ARA verification, DAW plugin-cache
  evidence, Standard MIDI File export, and generated Markdown integration guide.
- End-to-end verification against Synthesizer V Studio 2 Pro 2.2.1 on Windows 11:
  13 notes with Chinese lyrics written and read back, build coherence `matched`,
  `writesAllowed: true`; Zrythm 2.0 had both VST3 bundles scanned.
