import { readFileSync } from "node:fs";
import { CONFIG_FILE } from "../constants.mjs";

/**
 * Read the stored API key and endpoint from config.
 */
function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Submit a share payload to the community API endpoint.
 * Returns { ok, status, body }.
 */
export async function submitPayload(payload) {
  const config = loadConfig();
  if (!config?.api_key || !config?.endpoint) {
    return { ok: false, status: 0, body: "Not configured. Run: claude-meter setup" };
  }

  const response = await fetch(`${config.endpoint}/api/v1/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": config.api_key,
    },
    body: JSON.stringify(payload),
  });

  const body = await response.text();
  return { ok: response.ok, status: response.status, body };
}

/**
 * Register a new API key with the community endpoint.
 */
export async function registerKey(endpoint) {
  const response = await fetch(`${endpoint}/api/v1/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  if (!response.ok) {
    throw new Error(`Registration failed: ${response.status}`);
  }

  return response.json();
}
