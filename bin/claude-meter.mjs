#!/usr/bin/env node

/**
 * claude-meter — Community usage metrics collector for Claude Code.
 *
 * Commands:
 *   status    Current session summary
 *   history   Daily/weekly usage aggregates
 *   rates     Estimated billing rates via regression
 *   share     Submit anonymized session data to community dataset
 *   setup     Install interceptor and configure
 */

import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    session: { type: "string", short: "s" },
    days: { type: "string", short: "d" },
    plan: { type: "string", short: "p" },
    endpoint: { type: "string", short: "e" },
    community: { type: "boolean", short: "c" },
    yes: { type: "boolean", short: "y" },
    share: { type: "boolean" },
    fit: { type: "boolean" },
    "log-file": { type: "string" },
    // ingest subcommand
    source: { type: "string" },
    once: { type: "boolean" },
    watch: { type: "boolean" },
    "reset-offset": { type: "boolean" },
  },
});

const command = positionals[0];

if (values.help || !command) {
  console.log(`claude-meter — Usage metrics collector for Claude Code

Commands:
  status              Current session summary
  history             Daily/weekly usage aggregates
  rates               Estimated billing rates via regression analysis
  analyze             Session-level cost model regression (the good stuff)
  consent             Grant consent for anonymous data sharing (required before --share)
  opt-out             Revoke data sharing consent (immediate, permanent until re-consented)
  share               Submit anonymized data to community dataset
  setup               Install interceptor and configure sharing
  ingest              Ingest validated rows from cache-fix proxy's usage.jsonl

Options:
  -s, --session <id>  Target a specific session
  -d, --days <n>      Number of days for history (default: 7)
  -p, --plan <tier>   Plan tier: pro, max_5, max_20, team, enterprise
  -e, --endpoint <url> Community API endpoint
  -c, --community     Use community dataset for rates
  --share             Include share preview with analyze output
  --log-file <path>   Path to claude-meter.jsonl (default: ~/.claude/claude-meter.jsonl)
  --source <path>     ingest: path to proxy usage.jsonl (default: ~/.claude/usage.jsonl)
  --once              ingest: read to current EOF and exit (default behavior)
  --watch             ingest: tick periodically until Ctrl-C
  --reset-offset      ingest: delete offset file before reading (re-process from start)
  -y, --yes           Skip confirmation prompts
  -h, --help          Show this help
`);
  process.exit(0);
}

const args = {
  session: values.session,
  days: values.days ? parseInt(values.days) : undefined,
  plan: values.plan,
  endpoint: values.endpoint,
  community: values.community,
  yes: values.yes,
};

switch (command) {
  case "status": {
    const { statusCommand } = await import("../src/cli/status.mjs");
    statusCommand(args);
    break;
  }
  case "history": {
    const { historyCommand } = await import("../src/cli/history.mjs");
    historyCommand(args);
    break;
  }
  case "rates": {
    const { ratesCommand } = await import("../src/cli/rates.mjs");
    ratesCommand(args);
    break;
  }
  case "share": {
    const { shareCommand } = await import("../src/cli/share.mjs");
    await shareCommand(args);
    break;
  }
  case "analyze": {
    const { analyzeCommand } = await import("../src/cli/analyze.mjs");
    await analyzeCommand({ ...args, share: values.share, logFile: values["log-file"] });
    break;
  }
  case "consent": {
    const { requestConsent } = await import("../src/consent.mjs");
    await requestConsent(false);
    break;
  }
  case "opt-out": {
    const { revokeConsent } = await import("../src/consent.mjs");
    revokeConsent();
    break;
  }
  case "setup": {
    const { setupCommand } = await import("../src/cli/setup.mjs");
    await setupCommand(args);
    break;
  }
  case "ingest": {
    const { ingestCommand } = await import("../src/cli/ingest.mjs");
    await ingestCommand({
      source: values.source,
      once: values.once,
      watch: values.watch,
      resetOffset: values["reset-offset"],
      yes: values.yes,
    });
    break;
  }
  default:
    console.log(`Unknown command: ${command}. Run claude-meter --help for usage.`);
    process.exit(1);
}
