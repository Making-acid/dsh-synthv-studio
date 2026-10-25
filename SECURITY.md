# Security policy

## Scope

`dsh-synthv-studio` runs inside the DSH Host process and spawns one local
child process (`node server/server.bundle.mjs`, the bundled SynthV Agent Bridge
server). It also installs three Lua files into Synthesizer V Studio's per-user
scripts folder so the user can start the bridge from SynthV's Scripts menu.

What it intentionally does:

- read local Synthesizer V Studio 2 Pro installation and data paths;
- copy bundled Lua bridge scripts into
  `%APPDATA%\Dreamtonics\Synthesizer V Studio 2\scripts\SynthV Agent Bridge\`;
- exchange JSON files with the running bridge in the user's `%TEMP%` directory;
- write MIDI files and Markdown guides only to paths the user/agent asks for;
- never parse or rewrite `.svp` project files, never open a network port, and
  never call an online service.

What it does **not** do:

- no network access from the bridge or the bundled server;
- no credential collection, no telemetry;
- no writes outside the Synthesizer V data directory, the temp IPC directory,
  and explicitly requested output paths.

## Reporting

Please open a GitHub security advisory (Security → Advisories → Report a
vulnerability) or a private issue if the report contains exploit details.
Do not include credentials, license files, or personal data in a public issue.

## Third-party code

`server/server.bundle.mjs` and `synthv/*.lua` are vendored from
[SynthVCopilot/synthv-agent-bridge](https://github.com/SynthVCopilot/synthv-agent-bridge)
(Apache-2.0). See `NOTICE` for the exact provenance and the build-id injection
this plugin performs at install time.
