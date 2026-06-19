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

// Accepted --plan values. The ledger's `tier` field is keyed on this set, so
// `rates --refit` validates against it before persisting (Phase 2's drift
// comparison joins on the same (tier, model, speed) identity).
const ACCEPTED_PLANS = ["pro", "max-5x", "max-20x", "api", "unknown"];

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
    // rates: window-mode regression flags
    by: { type: "string", default: "window" },
    "tier-start-date": { type: "string" },
    // rates: weight-history ledger (Phase 1)
    refit: { type: "boolean" },
    history: { type: "boolean" },
    model: { type: "string" },
    "ledger-file": { type: "string" },
    // rates: drift detection (Phase 2)
    "dismiss-drift": { type: "boolean" },
    "drift-seen-file": { type: "string" },
    // analyze: by-plan L(t) split
    "by-plan": { type: "boolean" },
    "per-session": { type: "boolean" },
    "burn-intensity": { type: "boolean" },
    "plan-transitions": { type: "string" },
    "list-price-override": { type: "string" },
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
  -s, --session <id>  Filter analysis to one session (full sid or unique prefix)
  -d, --days <n>      Number of days for history (default: 7)
  -p, --plan <tier>   Plan tier: pro, max-5x, max-20x, api, unknown
  -e, --endpoint <url> Community API endpoint
  -c, --community     Use community dataset for rates
  --share             Include share preview with analyze output
  --log-file <path>   Path to claude-meter.jsonl (default: ~/.claude/claude-meter.jsonl)

  rates-only flags:
  --by <window|row>   Regression granularity (default: window). --by row is
                      deprecated and produces unreliable weights.
  --tier-start-date <YYYY-MM-DD>  Required for --by window. Filters rows to
                      ts >= date so the fit stays within a single (model, tier)
                      regime. See https://github.com/cnighswonger/claude-code-meter/issues/33
  --refit             Run the window-mode fit and append it to the weight
                      history ledger. Requires --tier-start-date and --plan.
  --history           Print the weight history ledger (most-recent first).
                      Filter with --model and/or --plan.
  --dismiss-drift     Acknowledge the current drift warning so it stops
                      printing above rates output until the next drift event.

  analyze-only flags:
  --by-plan           Per-tier amortized L(t) (cost / (sub_price * calendar_days))
  --per-session       Per-session "sub-days consumed" (cost / sub_daily_price)
  --burn-intensity    Per-tier burn rate over session span (diagnostic, not L(t))
  --plan-transitions <spec>     "YYYY-MM-DD=tier,YYYY-MM-DD=tier" for mid-window plan changes
  --list-price-override <spec>  "tier=N.NN,..." override list-price defaults

  ingest flags:
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
    const by = values.by;
    const tsd = values["tier-start-date"];
    const validTsd = tsd && /^\d{4}-\d{2}-\d{2}$/.test(tsd);

    if (values.history || values["dismiss-drift"]) {
      // Read-only ledger inspection / dotfile-only op — no regression flags.
    } else if (values.refit) {
      // Refit runs window-mode and records the result; needs both the
      // tier-start-date (window contract) and --plan (ledger tier identity).
      if (!validTsd) {
        process.stderr.write(
          "--tier-start-date <YYYY-MM-DD> is required for --refit.\n",
        );
        process.exit(2);
      }
      if (!values.plan) {
        process.stderr.write(
          "--plan <pro|max-5x|max-20x|api|unknown> is required for --refit " +
            "(populates the ledger's tier field).\n",
        );
        process.exit(2);
      }
      if (!ACCEPTED_PLANS.includes(values.plan)) {
        process.stderr.write(
          `Invalid --plan value: "${values.plan}". ` +
            `Accepted: ${ACCEPTED_PLANS.join(" | ")}.\n`,
        );
        process.exit(2);
      }
    } else {
      if (by !== "window" && by !== "row") {
        process.stderr.write(`Invalid --by value: "${by}". Accepted: window | row.\n`);
        process.exit(2);
      }
      if (by === "window" && !validTsd) {
        process.stderr.write(
          "--tier-start-date <YYYY-MM-DD> is required for window-mode regression. " +
            "Use --by row to skip the v1 window contract (deprecated; produces unreliable weights).\n",
        );
        process.exit(2);
      }
    }

    const { ratesCommand } = await import("../src/cli/rates.mjs");
    ratesCommand({
      ...args,
      logFile: values["log-file"],
      by,
      "tier-start-date": values["tier-start-date"],
      refit: values.refit,
      history: values.history,
      model: values.model,
      ledgerFile: values["ledger-file"],
      "dismiss-drift": values["dismiss-drift"],
      driftSeenFile: values["drift-seen-file"],
    });
    break;
  }
  case "share": {
    const { shareCommand } = await import("../src/cli/share.mjs");
    await shareCommand(args);
    break;
  }
  case "analyze": {
    const { analyzeCommand } = await import("../src/cli/analyze.mjs");
    await analyzeCommand({
      ...args,
      share: values.share,
      logFile: values["log-file"],
      "by-plan": values["by-plan"],
      "per-session": values["per-session"],
      "burn-intensity": values["burn-intensity"],
      "plan-transitions": values["plan-transitions"],
      "list-price-override": values["list-price-override"],
    });
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
