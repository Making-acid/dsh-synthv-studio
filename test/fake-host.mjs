/**
 * Load the plugin the way the DSH Host does, using a minimal fake context.
 * Shared by the offline self-test and the end-to-end script.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * @returns {Promise<{
 *   plugin: any,
 *   registered: any[],
 *   sections: any[],
 *   byName: Map<string, any>,
 * }>}
 */
export async function loadPlugin() {
  /** @type {any[]} */
  const registered = [];
  /** @type {any[]} */
  const sections = [];
  /** @type {Array<() => void>} */
  const disposers = [];
  const fakeCtx = {
    tools: {
      register(definition) {
        registered.push(definition);
        return () => {};
      },
    },
    systemPrompt: {
      section(section) {
        sections.push(section);
        return () => {};
      },
    },
    effect(callback) {
      const disposer = callback();
      if (typeof disposer === "function") disposers.push(disposer);
      return () => {};
    },
    on() {
      return () => {};
    },
  };
  const pluginUrl = pathToFileURL(path.join(import.meta.dirname, "..", "lib", "index.js")).href;
  const plugin = await import(pluginUrl);
  plugin.apply(fakeCtx, {});
  return {
    plugin,
    registered,
    sections,
    byName: new Map(registered.map((tool) => [tool.name, tool])),
    /** Run the plugin's cleanup hooks (closes the bridge child process). */
    async dispose() {
      for (const disposer of disposers.splice(0)) {
        try {
          disposer();
        } catch {
          // Cleanup is best effort in tests.
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
  };
}

/**
 * Try to load the Harness' own JSON-schema validator so the self-test checks the
 * exact subset the tool registry enforces. Returns null outside a DSH install.
 * @returns {Promise<((schema: any) => void) | null>}
 */
export async function loadHarnessSchemaValidator() {
  const candidates = [
    process.env.DSH_APP_DIR,
    "C:\\Program Files\\DSH NEXT\\resources\\app",
    "/Applications/DSH NEXT.app/Contents/Resources/app",
  ].filter(Boolean);
  for (const appDir of candidates) {
    try {
      const moduleUrl = pathToFileURL(
        path.join(appDir, "node_modules", "@deepseek-ai", "dsh-tools", "lib", "index.js"),
      ).href;
      const module = await import(moduleUrl);
      if (typeof module.assertSupportedJsonSchema === "function") {
        return module.assertSupportedJsonSchema;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}
