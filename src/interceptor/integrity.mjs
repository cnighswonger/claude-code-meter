import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// Replaced at publish time by the build script
const EXPECTED_HASH = "__INTEGRITY_HASH__";

/**
 * Verify that the interceptor source hasn't been modified since install.
 * Returns true if integrity check passes (or can't be verified).
 * Returns false and logs a warning if the source was modified.
 */
export function checkIntegrity(importMetaUrl) {
  try {
    const selfPath = fileURLToPath(importMetaUrl);
    const selfHash = createHash("sha256")
      .update(readFileSync(selfPath))
      .digest("hex");

    if (EXPECTED_HASH !== "__INTEGRITY_HASH__" && selfHash !== EXPECTED_HASH) {
      console.error(
        "[claude-meter] WARNING: interceptor source has been modified since install.",
        "Expected:", EXPECTED_HASH.slice(0, 12) + "...",
        "Got:", selfHash.slice(0, 12) + "...",
      );
      return false;
    }
  } catch {
    // Can't check — not fatal
  }
  return true;
}
