/**
 * End-to-end test against a real Synthesizer V Studio 2 Pro with the bridge
 * running. Defaults to a dry run: it plans the write and never mutates the open
 * project. Pass `--write` to actually add a short phrase and read it back.
 *
 * Prerequisites:
 *   1. Synthesizer V Studio 2 Pro is open with any project.
 *   2. The bridge is running: Scripts → SynthV Agent Bridge → Start SynthV Agent Bridge.
 *
 * Run with:
 *   node test/e2e-synthv.mjs            # dry run (safe)
 *   node test/e2e-synthv.mjs --write    # write a 5-note phrase and verify
 */
import { loadPlugin } from "./fake-host.mjs";

const write = process.argv.includes("--write");
const { byName } = await loadPlugin();
let failures = 0;

/** @param {string} name @param {Record<string, unknown>} args */
async function run(name, args) {
  const tool = byName.get(name);
  if (!tool) throw new Error(`tool ${name} is not registered`);
  const value = await tool.execute(args, {});
  console.log(`\n===== ${name} =====`);
  console.log(`ok=${value.ok}`);
  console.log(String(value.text).slice(0, 3000));
  if (!value.ok) failures += 1;
  return value;
}

try {
  const ensured = await run("synthv_bridge", { action: "ensure", waitSeconds: 20 });
  if (!ensured.ok) {
    console.log("\nBridge is not ready. Start Synthesizer V Studio and run");
    console.log("Scripts → SynthV Agent Bridge → Start SynthV Agent Bridge, then retry.");
    process.exit(2);
  }

  await run("synthv_do", { tool: "sv_status", arguments: { operation: "bridge" } });

  await run("synthv_compose", {
    tempoBpm: 96,
    trackName: write ? "DSH E2E" : undefined,
    groupName: write ? `DSH E2E ${new Date().toISOString().slice(11, 19)}` : undefined,
    dryRun: !write,
    notes: [
      { onset: 0, duration: 1, pitch: 67, lyric: "夜" },
      { onset: 1, duration: 0.5, pitch: 69, lyric: "空" },
      { onset: 1.5, duration: 1.5, pitch: 71, lyric: "里" },
      { onset: 3, duration: 0.5, pitch: 69, lyric: "的" },
      { onset: 3.5, duration: 1.5, pitch: 67, lyric: "风" },
    ],
  });

  await run("synthv_daw", { action: "verify" });

  console.log(
    write
      ? "\nE2E finished: the phrase was written and read back. Undo it in SynthV with Ctrl+Z if you do not want to keep it."
      : "\nE2E finished in dry-run mode. Pass --write to add the phrase for real.",
  );
} catch (error) {
  failures += 1;
  console.error(`\nE2E threw: ${error instanceof Error ? error.message : String(error)}`);
}

console.log(`\nE2E: ${failures === 0 ? "OK" : `${failures} failure(s)`}`);
process.exitCode = failures === 0 ? 0 : 1;
