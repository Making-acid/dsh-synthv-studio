# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
