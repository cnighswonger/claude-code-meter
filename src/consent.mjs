/**
 * Consent framework for claude-code-meter data sharing.
 *
 * Design principles:
 * - No data leaves the machine without explicit interactive consent
 * - Consent is cryptographically bound to the install (consent token)
 * - Server rejects submissions without a valid consent token
 * - --yes flag and cron cannot bypass first-run consent
 * - Opt-out is immediate and permanent until re-consented
 * - Uninstall/reinstall resets consent (new install_id = new consent required)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { CONFIG_FILE, DEFAULT_SERVER } from "./constants.mjs";

const CONSENT_TEXT = `
claude-code-meter — Data Sharing Consent

You are about to enable anonymous usage data sharing with the
claude-code-meter community analytics server.

WHAT IS SHARED (per submission):
  - Session-level aggregate statistics (R-squared, OLS coefficients)
  - Pearson correlations between token types and quota drain
  - Cumulative cost exponent (linear vs superlinear)
  - Peak vs off-peak cost averages
  - Model family breakdown (e.g. "opus: 80%, haiku: 20%")
  - Plan tier (if you provide it)
  - fallback_percentage header value
  - Total call count and session count
  - Your install_id (random, not tied to your identity)

WHAT IS NEVER SHARED:
  - Prompts, responses, or message content
  - File paths, repo names, project structure
  - Account IDs, organization IDs, API keys
  - IP addresses (server sees CF-Connecting-IP but does not store it)
  - Timestamps more precise than session date range

WHERE IT GOES:
  ${DEFAULT_SERVER}
  Source: https://github.com/cnighswonger/claude-code-meter
  Operator: Veritas Supera IT Solutions LLC

You can revoke consent at any time with: claude-meter opt-out
`;

/**
 * Read the config file, returning {} if missing or corrupt.
 */
function readConfig() {
  try {
    if (existsSync(CONFIG_FILE)) return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {}
  return {};
}

/**
 * Write config file.
 */
function writeConfig(config) {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Get or create install_id.
 */
export function getInstallId() {
  const config = readConfig();
  if (!config.install_hash) {
    config.install_hash = randomBytes(8).toString("hex");
    writeConfig(config);
  }
  return config.install_hash;
}

/**
 * Consent scope.
 *
 * Bound to the corporate domain. Changing this string invalidates every
 * stored consent token (token = SHA-256(install_id + timestamp + scope)),
 * which forces re-consent. We're OK with that because the install base is
 * still pre-public; a rebrand-driven re-prompt has no real-world impact.
 */
const CONSENT_SCOPE = "share_anonymous_usage_data_with_meter.vsits.co";

/**
 * Generate a consent token from install_id + timestamp.
 * Token = SHA-256(install_id + consent_timestamp + consent_scope)
 */
function generateConsentToken(installId, timestamp) {
  const input = `${installId}:${timestamp}:${CONSENT_SCOPE}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

/**
 * Check if this install has consented to data sharing.
 * Returns { consented: true, token, timestamp } or { consented: false }.
 */
export function getConsentStatus() {
  const config = readConfig();
  if (config.opted_out) {
    return { consented: false, reason: "opted_out" };
  }
  if (config.consent_token && config.consent_timestamp && config.install_hash) {
    const expected = generateConsentToken(config.install_hash, config.consent_timestamp);
    if (config.consent_token === expected) {
      return {
        consented: true,
        token: config.consent_token,
        timestamp: config.consent_timestamp,
        installId: config.install_hash,
      };
    }
  }
  return { consented: false, reason: "no_consent" };
}

/**
 * Interactive consent flow. Shows what will be shared, requires "yes".
 * Returns the consent token if granted, null if denied.
 *
 * skipInteractive: if true AND user has previously consented, skip the prompt.
 * This is for --yes flag and cron — but ONLY after first-run consent.
 */
export async function requestConsent(skipInteractive = false) {
  const status = getConsentStatus();

  // Already consented and skip requested (cron/--yes after first run)
  if (status.consented && skipInteractive) {
    return status.token;
  }

  // Opted out — refuse if non-interactive (--yes/cron), allow re-consent if interactive
  if (status.reason === "opted_out" && skipInteractive) {
    console.error("Data sharing is opted out. Run 'claude-meter consent' to re-enable.");
    return null;
  }

  // First-run or re-consent — must be interactive
  if (skipInteractive && !status.consented) {
    console.error("First-run consent required. Run 'claude-meter consent' interactively before using --yes or cron.");
    return null;
  }

  // Show consent text
  console.log(CONSENT_TEXT);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question('Type "I consent" to enable data sharing: ', resolve);
  });
  rl.close();

  if (answer.trim().toLowerCase() !== "i consent") {
    console.log("Consent not granted. No data will be shared.");
    return null;
  }

  // Grant consent
  const installId = getInstallId();
  const timestamp = new Date().toISOString();
  const token = generateConsentToken(installId, timestamp);

  const config = readConfig();
  config.consent_token = token;
  config.consent_timestamp = timestamp;
  config.install_hash = installId;
  delete config.opted_out;
  delete config.opted_out_at;
  writeConfig(config);

  console.log(`\nConsent granted. Token: ${token.slice(0, 8)}...`);
  console.log("You can revoke at any time with: claude-meter opt-out\n");

  return token;
}

/**
 * Revoke consent permanently until re-consented.
 */
export function revokeConsent() {
  const config = readConfig();
  delete config.consent_token;
  delete config.consent_timestamp;
  config.opted_out = true;
  config.opted_out_at = new Date().toISOString();
  writeConfig(config);
  console.log("Data sharing opted out. No data will be sent to the community server.");
  console.log("To re-enable, run: claude-meter consent");
}
