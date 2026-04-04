import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG_FILE } from "../constants.mjs";
import { registerKey } from "../share/client.mjs";

const WRAPPER_PATH = join(homedir(), "bin", "claude");
const CACHE_FIX_PATH = join(homedir(), ".claude", "cache-fix-preload.mjs");

/**
 * Setup command — detects environment and integrates the interceptor.
 */
export async function setupCommand(args) {
  console.log("claude-meter setup\n");

  // 1. Detect existing infrastructure
  const hasWrapper = existsSync(WRAPPER_PATH);
  const hasCacheFix = existsSync(CACHE_FIX_PATH);

  console.log(`Wrapper (~/bin/claude): ${hasWrapper ? "found" : "not found"}`);
  console.log(`Cache-fix interceptor:  ${hasCacheFix ? "found" : "not found"}`);

  // 2. Find the preload path
  // Prefer the installed npm package path, fall back to local
  let preloadPath;
  const npmGlobalPath = join(
    homedir(),
    ".npm-global",
    "lib",
    "node_modules",
    "@claude-meter",
    "collector",
    "src",
    "interceptor",
    "preload.mjs",
  );
  if (existsSync(npmGlobalPath)) {
    preloadPath = npmGlobalPath;
  } else {
    // Try to find relative to this script
    const localPath = new URL("../interceptor/preload.mjs", import.meta.url);
    preloadPath = localPath.pathname;
  }

  console.log(`Preload path:           ${preloadPath}\n`);

  // 3. Integrate with wrapper
  if (hasWrapper) {
    const wrapper = readFileSync(WRAPPER_PATH, "utf-8");
    if (wrapper.includes("claude-meter")) {
      console.log("Wrapper already includes claude-meter. Skipping.");
    } else {
      // Add METER preload line after CACHE_FIX line (or at the end of NODE_OPTS building)
      const meterLine = `METER="${preloadPath}"`;
      const meterCheck = `if [ -f "$METER" ]; then\n  NODE_OPTS="\${NODE_OPTS:+$NODE_OPTS }--import $METER"\nfi`;

      // Find insertion point — after the last NODE_OPTS building block
      const insertAfter = "NODE_OPTS=";
      const lines = wrapper.split("\n");
      let lastNodeOptsLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(insertAfter) && !lines[i].trimStart().startsWith("#")) {
          lastNodeOptsLine = i;
        }
      }

      if (lastNodeOptsLine >= 0) {
        // Find the end of the if/fi block containing that line
        let insertIdx = lastNodeOptsLine;
        for (let i = lastNodeOptsLine; i < lines.length; i++) {
          if (lines[i].trim() === "fi") {
            insertIdx = i + 1;
            break;
          }
        }
        lines.splice(insertIdx, 0, "", `# claude-meter usage collector`, meterLine, meterCheck);
        writeFileSync(WRAPPER_PATH, lines.join("\n"), "utf-8");
        console.log("Updated ~/bin/claude with claude-meter preload.");
      } else {
        console.log("Could not find insertion point in wrapper. Add manually:");
        console.log(`  NODE_OPTIONS="--import ${preloadPath}" in your claude wrapper.`);
      }
    }
  } else {
    console.log("No wrapper found. To use claude-meter, create ~/bin/claude:");
    console.log(`  #!/bin/bash`);
    console.log(`  CLAUDE_NPM_CLI="$HOME/.npm-global/lib/node_modules/@anthropic-ai/claude-code/cli.js"`);
    console.log(`  exec env NODE_OPTIONS="--import ${preloadPath}" node "$CLAUDE_NPM_CLI" "$@"`);
  }

  // 4. Register API key for community sharing
  if (args.endpoint) {
    console.log(`\nRegistering with community endpoint: ${args.endpoint}`);
    try {
      const { api_key } = await registerKey(args.endpoint);
      const config = { endpoint: args.endpoint, api_key };
      writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
      console.log(`API key stored in ${CONFIG_FILE}`);
    } catch (e) {
      console.log(`Registration failed: ${e.message}`);
      console.log("You can register later with: claude-meter setup --endpoint <url>");
    }
  } else {
    console.log("\nSkipping community registration (no --endpoint specified).");
    console.log("To enable sharing later: claude-meter setup --endpoint <url>");
  }

  console.log("\nSetup complete. Restart Claude Code to start collecting metrics.");
}
