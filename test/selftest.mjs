/**
 * Offline self-test: no Synthesizer V and no running bridge required.
 *
 * It validates the plugin surface the DSH Host consumes (tool definitions,
 * prompt section, JSON schemas) and the pure logic (note normalization, MIDI
 * file structure, DAW guide rendering, bridge status parsing, local discovery).
 *
 * Run with:  node test/selftest.mjs
 */
import { loadHarnessSchemaValidator, loadPlugin } from "./fake-host.mjs";
import { detectSynthV, readBridgeStatus } from "../lib/detect.js";
import { buildDawGuide, buildMidiFile, scanSynthVVst3Bundles } from "../lib/daw.js";
import { beatsToBlicks, normalizeNotes } from "../lib/compose.js";

let failures = 0;
let checks = 0;

/** @param {boolean} condition @param {string} label @param {string} [detail] */
function check(condition, label, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const expectedTools = [
  "synthv_detect",
  "synthv_bridge",
  "synthv_do",
  "synthv_compose",
  "synthv_daw",
];

const host = await loadPlugin();
const { plugin, registered, sections, byName } = host;
check(Array.isArray(plugin.inject) && plugin.inject.includes("tools"), "plugin exports inject");
check(typeof plugin.apply === "function", "plugin exports apply()");
check(sections.length === 1 && sections[0].name === "tool:synthv-studio", "prompt section registered");
check(sections[0]?.text?.includes("synthv_compose"), "prompt section mentions workflow tools");

check(registered.length === expectedTools.length, `registers ${expectedTools.length} tools`, `got ${registered.length}`);
for (const name of expectedTools) {
  check(byName.has(name), `tool ${name} registered`);
}

const validator = await loadHarnessSchemaValidator();
if (validator) {
  console.log("INFO  DSH JSON-schema validator found; validating tool schemas against the registry subset");
} else {
  console.log("INFO  DSH JSON-schema validator not found (outside a DSH install); registry-subset validation skipped");
}

for (const toolDefinition of registered) {
  check(
    typeof toolDefinition.description === "string" && toolDefinition.description.length > 20,
    `${toolDefinition.name} has a description`,
  );
  check(typeof toolDefinition.execute === "function", `${toolDefinition.name} has execute()`);
  check(
    toolDefinition.output &&
      typeof toolDefinition.output.render === "function" &&
      toolDefinition.output.schema?.type === "object",
    `${toolDefinition.name} has object-rooted output schema + render`,
  );
  check(toolDefinition.parameters?.type === "object", `${toolDefinition.name} parameters are an object schema`);
  if (validator) {
    let schemaOk = true;
    try {
      validator(toolDefinition.parameters);
      validator(toolDefinition.output.schema);
    } catch (error) {
      schemaOk = false;
      console.log(`      schema error: ${error instanceof Error ? error.message : String(error)}`);
    }
    check(schemaOk, `${toolDefinition.name} schemas pass the registry subset`);
  }
}

// --- pure logic -----------------------------------------------------------
const { notes, warnings } = normalizeNotes([
  { onset: 0, duration: 1, pitch: 67, lyric: "la" },
  { onset: 1, duration: 0.5, pitch: 69 },
]);
check(notes[0].onset === 0, "first note onset is 0");
check(notes[0].duration === beatsToBlicks(1), "one quarter-note beat = 705600000 blicks");
check(notes[1].lyrics === "la", "missing lyric falls back to default");
check(warnings.length === 1, "missing lyric produces a warning");

let invalidNoteRejected = false;
try {
  normalizeNotes([{ onset: -1, duration: 1, pitch: 60 }]);
} catch {
  invalidNoteRejected = true;
}
check(invalidNoteRejected, "invalid onset is rejected");

const midi = buildMidiFile({
  bpm: 96,
  notes: [{ onset: 0, duration: 1, pitch: 60, lyric: "la" }],
});
check(midi.subarray(0, 4).toString("ascii") === "MThd", "MIDI file starts with MThd");
check(midi.subarray(8, 14).toString("hex") === "0000000101e0", "MIDI header is format 0 with 480 PPQ");
check(midi.includes(Buffer.from("MTrk", "ascii")), "MIDI file contains a track chunk");

const detection = await detectSynthV({ refresh: true });
check(typeof detection.ok === "boolean", "detectSynthV returns an ok flag");
check(detection.install && detection.appData && detection.bridge, "detection reports install/appData/bridge");
check(Array.isArray(detection.plugins?.bundles), "detection reports VST3 bundle list");
check(Array.isArray(detection.daws), "detection reports DAW list");
check(detection.plugins.bundles.length === scanSynthVVst3Bundles().bundles.length, "VST3 scan is stable");

const status = readBridgeStatus();
check(typeof status.present === "boolean" && typeof status.fresh === "boolean", "bridge status parses");

const guide = buildDawGuide({
  detection,
  plugins: detection.plugins,
  cache: { files: [], vst3Entries: [] },
});
check(guide.length > 500 && guide.includes("DAW"), "DAW guide renders");

console.log(`\n${checks - failures}/${checks} checks passed`);
if (detection.ok) {
  console.log(
    `Detected Synthesizer V Studio 2 Pro ${detection.install.version} at ${detection.install.directory}; ` +
      `${detection.plugins.bundles.length} VST3 bundle(s); DAWs: ${detection.daws.map((daw) => daw.name).join(", ") || "none"}.`,
  );
} else {
  console.log("Synthesizer V Studio 2 Pro is not installed on this machine; discovery checks ran in the negative path.");
}
await host.dispose();
process.exitCode = failures === 0 ? 0 : 1;
