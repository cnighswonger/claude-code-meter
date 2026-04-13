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
  share               Submit anonymized data to community dataset
  setup               Install interceptor and configure sharing

Options:
  -s, --session <id>  Target a specific session
  -d, --days <n>      Number of days for history (default: 7)
  -p, --plan <tier>   Plan tier: pro, max_5, max_20, team, enterprise
  -e, --endpoint <url> Community API endpoint
  -c, --community     Use community dataset for rates
  --share             Include share preview with analyze output
  --log-file <path>   Path to claude-meter.jsonl (default: ~/.claude/claude-meter.jsonl)
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
  case "setup": {
    const { setupCommand } = await import("../src/cli/setup.mjs");
    await setupCommand(args);
    break;
  }
  default:
    console.log(`Unknown command: ${command}. Run claude-meter --help for usage.`);
    process.exit(1);
}
