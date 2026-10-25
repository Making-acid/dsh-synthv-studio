# Tests

| Script | Needs Synthesizer V? | What it proves |
|---|---|---|
| `selftest.mjs` | no | Plugin surface the DSH Host consumes: 5 tool definitions, prompt section, JSON-schema subset, note normalization, MIDI file structure, DAW guide, bridge status parsing, local discovery. |
| `mcp-handshake.mjs` | no | The bundled bridge server starts, speaks MCP/JSON-RPC over stdio, and exposes the six `sv_*` tools. |
| `e2e-synthv.mjs` | yes | Bridge readiness, dry-run composition planning, DAW verification. With `--write`, actually writes a 5-note phrase with lyrics and reads it back. |

```sh
node test/selftest.mjs
node test/mcp-handshake.mjs
node test/e2e-synthv.mjs            # dry run against a running bridge
node test/e2e-synthv.mjs --write    # writes into the open SynthV project
```

`selftest.mjs` also uses the DSH installation's own JSON-schema validator when
it can find one (`DSH_APP_DIR`, then the default Windows/macOS install path), so
the schemas are checked against the exact subset the tool registry enforces.
Outside a DSH install that single check is reported as skipped.

`e2e-synthv.mjs` never modifies your project unless `--write` is passed, and the
write is a normal SynthV edit that one Ctrl+Z undoes.
